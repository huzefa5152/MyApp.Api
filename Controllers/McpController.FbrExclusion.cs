using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Helpers;

namespace MyApp.Api.Controllers;

/// <summary>
/// Keep bills out of FBR, or bring them back, one at a time or in bulk by date range.
///
/// Each bill goes through <c>InvoiceService.SetFbrExcludedAsync</c>, the Bills screen's own
/// toggle, so the stock purge or re-insert and the ledger re-post run exactly as they do there.
/// An excluded bill is refused by every FBR validate and submit path (<c>FbrService</c>).
/// A bill already submitted, being submitted, or with an unconfirmed outcome is never touched.
/// </summary>
public partial class McpController
{
    private const int FbrExclusionsPerHour = 20;
    private const int MaxBillsPerExclusion = 500;

    private static void AddFbrExclusionTools(List<ExpandedTool> tools)
    {
        tools.Add(new("prepare_fbr_exclusion",
            "Prepare excluding bills from FBR (excluded=true, the default) or including them again (excluded=false). " +
            "Pass invoiceIds for specific bills, or dateTo (and optionally dateFrom) to cover every bill of the company in that range, " +
            "e.g. dateTo = today for every bill so far. Bills already submitted to FBR, being submitted, with an unconfirmed FBR outcome, " +
            "cancelled, or outside FBR are skipped and listed. Excluding a bill also takes its goods out of stock movements and re-posts it to the ledger, " +
            "as the Bills screen's toggle does. Nothing is saved: returns a plan to show the user. Call commit_action only after they approve.",
            ExpandedSchema(new
            {
                companyId = new { type = "integer", minimum = 1 },
                excluded = new { type = "boolean", description = "true = keep out of FBR (default); false = include in FBR again." },
                invoiceIds = new { type = "array", minItems = 1, maxItems = MaxBillsPerExclusion, items = new { type = "integer", minimum = 1 } },
                dateFrom = new { type = "string", format = "date", description = "Bulk: first bill date, inclusive. Omit to start from the first bill." },
                dateTo = new { type = "string", format = "date", description = "Bulk: last bill date, inclusive. Required when invoiceIds is omitted." },
                idempotencyKey = new { type = "string", maxLength = 100 },
            }, "companyId"),
            new[] { "invoices.fbr.exclude" }, McpScopes.FbrExclusion, Writes: true));
    }

    private sealed record ExclusionCandidate(int Id, int InvoiceNumber, DateTime Date, string? ClientName, decimal GrandTotal,
        bool IsFbrExcluded, bool IsCancelled, string? FbrStatus, string TaxTreatment);

    /// <summary>Why a bill cannot move to the requested state, or null when it can.</summary>
    private static string? ExclusionSkipReason(ExclusionCandidate b, bool excluded) =>
        b.IsCancelled ? "cancelled"
        : b.FbrStatus == FbrSubmissionStatus.Submitted ? "already submitted to FBR"
        : b.FbrStatus == FbrSubmissionStatus.Submitting ? "submission in progress"
        : b.FbrStatus == FbrSubmissionStatus.Uncertain ? "FBR outcome unconfirmed"
        : BillTaxTreatment.IsOutsideFbr(b.TaxTreatment) ? "outside FBR"
        : b.IsFbrExcluded == excluded ? (excluded ? "already excluded" : "already included")
        : null;

    /// <summary>The company's sale bills (not credit or debit notes), filtered before projection so EF can translate it.</summary>
    private IQueryable<MyApp.Api.Models.Invoice> ExclusionBills(int companyId) =>
        _context.Invoices.AsNoTracking().Where(i => i.CompanyId == companyId && i.NoteKind == 0);

    private static IQueryable<ExclusionCandidate> AsCandidates(IQueryable<MyApp.Api.Models.Invoice> q) =>
        q.Select(i => new ExclusionCandidate(i.Id, i.InvoiceNumber, i.Date, i.Client != null ? i.Client.Name : null, i.GrandTotal,
                i.IsFbrExcluded, i.IsCancelled, i.FbrStatus, i.TaxTreatment));

    private async Task<object> PrepareFbrExclusionAsync(JsonElement args)
    {
        var agent = await RequireWriterAsync(McpScopes.FbrExclusion);
        var companyId = await CompanyArg(args);
        await Need("invoices.fbr.exclude");
        await Need("bills.list.view", "invoices.list.view");
        var key = IdemKey(args);
        if (await PriorForKeyAsync(agent, key, companyId, McpScopes.FbrExclusion) is { } prior) return prior;

        var excluded = true;
        if (Has(args, "excluded"))
        {
            var e = args.GetProperty("excluded");
            if (e.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw new ToolError("excluded must be true or false.");
            excluded = e.GetBoolean();
        }

        List<ExclusionCandidate> bills;
        string scopeText;
        DateTime? dateFrom = null, dateTo = null;
        if (Has(args, "invoiceIds"))
        {
            if (Has(args, "dateFrom") || Has(args, "dateTo")) throw new ToolError("Pass either invoiceIds or a date range, not both.");
            var idsEl = args.GetProperty("invoiceIds");
            if (idsEl.ValueKind != JsonValueKind.Array || idsEl.GetArrayLength() is < 1 or > MaxBillsPerExclusion)
                throw new ToolError($"invoiceIds must list between 1 and {MaxBillsPerExclusion} bills.");
            var ids = new HashSet<int>();
            foreach (var v in idsEl.EnumerateArray())
                ids.Add(v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) && n > 0 ? n : throw new ToolError("invoiceIds must be positive integers."));
            bills = await AsCandidates(ExclusionBills(companyId).Where(i => ids.Contains(i.Id))).ToListAsync();
            // Another company's bill (or a missing id) answers exactly like a missing one.
            if (bills.Count != ids.Count) throw new ToolError("Resource unavailable or access denied.");
            scopeText = $"{ids.Count} named bill(s)";
        }
        else
        {
            dateTo = OptDate(args, "dateTo") ?? throw new ToolError("Pass invoiceIds, or dateTo (with an optional dateFrom) for a date range.");
            dateFrom = OptDate(args, "dateFrom");
            if (dateFrom > dateTo) throw new ToolError("dateFrom is after dateTo.");
            var end = dateTo.Value.Date.AddDays(1);
            var q = ExclusionBills(companyId).Where(i => i.Date < end);
            if (dateFrom is { } from) q = q.Where(i => i.Date >= from.Date);
            bills = await AsCandidates(q.OrderBy(i => i.Date).ThenBy(i => i.InvoiceNumber)).ToListAsync();
            scopeText = dateFrom is { } f ? $"bills dated {f:yyyy-MM-dd} to {dateTo:yyyy-MM-dd}" : $"bills dated up to {dateTo:yyyy-MM-dd}";
        }

        var change = bills.Where(b => ExclusionSkipReason(b, excluded) == null).ToList();
        var skipped = bills.Where(b => ExclusionSkipReason(b, excluded) != null)
            .GroupBy(b => ExclusionSkipReason(b, excluded)!).Select(g => new { reason = g.Key, count = g.Count() }).ToList();
        if (change.Count == 0)
            throw new ToolError($"No bill to change among {scopeText}: " +
                (skipped.Count == 0 ? "none found." : string.Join(", ", skipped.Select(s => $"{s.count} {s.reason}")) + "."));
        if (change.Count > MaxBillsPerExclusion)
            throw new ToolError($"{change.Count} bills would change; at most {MaxBillsPerExclusion} per plan. Narrow the date range and prepare it in parts.");

        var verb = excluded ? "Exclude from FBR" : "Include in FBR";
        var payload = new
        {
            excluded, scope = scopeText,
            dateFrom = dateFrom?.ToString("yyyy-MM-dd"), dateTo = dateTo?.ToString("yyyy-MM-dd"),
            invoiceIds = change.Select(b => b.Id).ToArray(),
            bills = change.Take(100).Select(b => new { b.Id, b.InvoiceNumber, date = Ymd(b.Date), b.ClientName, b.GrandTotal, b.FbrStatus }),
            billsListed = Math.Min(change.Count, 100), billsToChange = change.Count, skipped,
            totalValue = change.Sum(b => b.GrandTotal), currency = "PKR",
            note = excluded
                ? "Excluded bills are refused by FBR validate and submit, single or bulk. Their goods leave the stock movements and each bill is re-posted to the ledger, as the Bills screen's toggle does. Include them again to undo."
                : "These bills become eligible for FBR validation and submission again, their stock movements are re-recorded and each is re-posted to the ledger.",
        };
        var summary = $"{verb}: {change.Count} bill(s) of company {companyId} ({scopeText}), total {change.Sum(b => b.GrandTotal):0.00} PKR" +
                      (skipped.Count > 0 ? $"; skipping {skipped.Sum(s => s.count)}" : "");
        return await StorePlanAsync(agent, "fbrexclusion.set", companyId, payload, summary, key);
    }

    private async Task<(string Ref, string Summary)> CommitFbrExclusionAsync(int companyId, JsonElement p)
    {
        var excluded = p.GetProperty("excluded").GetBoolean();
        var ids = p.GetProperty("invoiceIds").EnumerateArray().Select(x => x.GetInt32()).ToList();
        // Re-read every bill NOW: its stored company must still be this one, and a bill submitted
        // to FBR since the plan was made is left alone rather than desynced from a filed supply.
        var current = await AsCandidates(ExclusionBills(companyId).Where(i => ids.Contains(i.Id))).ToDictionaryAsync(b => b.Id);
        int changed = 0, skipped = 0, failed = 0;
        foreach (var id in ids)
        {
            if (!current.TryGetValue(id, out var bill) || ExclusionSkipReason(bill, excluded) != null) { skipped++; continue; }
            try
            {
                if (await _invoices.SetFbrExcludedAsync(id, excluded) == null) skipped++;
                else changed++;
            }
            catch (InvalidOperationException ex)
            {
                // One refused bill (a closed period, say) does not undo the ones already done.
                failed++;
                _logger.LogWarning(ex, "MCP FBR exclusion refused for invoice {InvoiceId}", id);
            }
        }
        if (changed == 0 && failed > 0) throw new InvalidOperationException("Every bill in the plan was refused.");
        var verb = excluded ? "Excluded" : "Included";
        return ($"FbrExclusion:{companyId}:{changed}",
            $"{verb} {changed} bill(s) {(excluded ? "from" : "in")} FBR" +
            (skipped > 0 ? $"; {skipped} skipped (changed since the plan)" : "") +
            (failed > 0 ? $"; {failed} refused, check them on the Bills screen" : ""));
    }
}

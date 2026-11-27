using System.Globalization;
using System.Text.Json;
using MyApp.Api.Services.Interfaces;
using MyApp.Api.Helpers;

namespace MyApp.Api.Controllers;

/// <summary>
/// Change the site, PO number and PO date of an existing document, the fields
/// Edit Bill and Edit Challan show for them.
///
/// A bill goes through <c>InvoiceService.UpdateStandaloneDetailsAsync</c>: standalone
/// bills only (a challan bill takes both from its challans), under Edit Bill's own
/// locks. A challan goes through <c>DeliveryChallanService.UpdateChallanAsync</c>, the
/// Edit Challan screen's own save, with every other field sent back unchanged; a
/// challan already on a bill is refused here. A new site joins the customer's sites
/// (<see cref="ICustomerSiteMemory"/>), as on the screens.
/// </summary>
public partial class McpController
{
    private const int DetailChangesPerHour = 30;

    private static object DetailFields(string what) => new
    {
        site = new { type = "string", maxLength = 200, description = $"The {what}'s site / department. A site the customer does not have yet is added to their sites. Empty clears it." },
        poNumber = new { type = "string", maxLength = 100, description = "Empty clears the PO number and its date." },
        poDate = new { type = "string", format = "date", description = "Set with poNumber." },
    };

    private static void AddDocumentDetailTools(List<ExpandedTool> tools)
    {
        tools.Add(new("prepare_bill_details",
            "Prepare changing the site, PO number and PO date of a standalone bill (one with no delivery challan). Pass only the fields to change. " +
            "Refused for a bill made from challans (change those on the challan), a cancelled bill, a note, or a bill already filed with FBR. " +
            "Amounts, stock and the ledger are not touched. Nothing is saved: returns a plan to show the user. Call commit_action only after they approve.",
            ExpandedSchema(Merge(new { companyId = new { type = "integer", minimum = 1 }, billId = new { type = "integer", minimum = 1 } }, DetailFields("bill")), "companyId", "billId"),
            new[] { "bills.manage.update" }, McpScopes.Bills, Writes: true));
        tools.Add(new("prepare_challan_details",
            "Prepare changing the site, PO number and PO date of a delivery challan that is not on a bill yet. Pass only the fields to change. " +
            "It saves through the Edit Challan screen's own path, so status follows the PO as it does there. Nothing is saved: returns a plan to show the user. Call commit_action only after they approve.",
            ExpandedSchema(Merge(new { companyId = new { type = "integer", minimum = 1 }, challanId = new { type = "integer", minimum = 1 } }, DetailFields("challan")), "companyId", "challanId"),
            new[] { "challans.manage.update" }, McpScopes.Challans, Writes: true));
    }

    private static Dictionary<string, object> Merge(object a, object b)
    {
        var d = new Dictionary<string, object>();
        foreach (var o in new[] { a, b })
            foreach (var p in o.GetType().GetProperties()) d[p.Name] = p.GetValue(o)!;
        return d;
    }

    private sealed record DetailChange(string? Site, string? PoNumber, DateTime? PoDate);

    private static DetailChange DetailArgs(JsonElement args)
    {
        var site = Has(args, "site") ? OptText(args, "site", 200) ?? "" : null;
        if (site != null && site.Contains(';')) throw new ToolError("A site cannot contain \";\": it separates a customer's sites.");
        var po = Has(args, "poNumber") ? OptText(args, "poNumber", 100) ?? "" : null;
        var poDate = OptDate(args, "poDate");
        if (poDate.HasValue && po == null) throw new ToolError("Give poNumber with poDate.");
        if (site == null && po == null) throw new ToolError("Give at least one of site, poNumber.");
        return new DetailChange(site, po, poDate);
    }

    private async Task<object> PrepareBillDetailsAsync(JsonElement args)
    {
        var agent = await RequireWriterAsync(McpScopes.Bills);
        var companyId = await CompanyArg(args);
        await Need("bills.manage.update");
        var key = IdemKey(args);
        if (await PriorForKeyAsync(agent, key, companyId, McpScopes.Bills) is { } prior) return prior;

        var billId = IntArg(args, "billId") ?? throw new ToolError("billId is required.");
        var bill = billId > 0 ? await _invoices.GetByIdAsync(billId) : null;
        if (bill == null || bill.CompanyId != companyId) throw new ToolError("Resource unavailable or access denied.");
        if (bill.ChallanNumbers.Count > 0) throw new ToolError("This bill takes its site and PO from its delivery challans. Use prepare_challan_details on the challan.");
        if (!bill.IsEditable) throw new ToolError("This bill cannot be edited: it is cancelled or already filed with FBR.");
        if (bill.DocumentType is 9 or 10) throw new ToolError("A Debit/Credit Note cannot be edited.");
        var change = DetailArgs(args);

        var payload = new
        {
            billId = bill.Id,
            bill.InvoiceNumber,
            bill.ClientId,
            bill.ClientName,
            before = new { site = bill.Site, bill.PoNumber, poDate = bill.PoDate?.ToString("yyyy-MM-dd") },
            site = change.Site,
            poNumber = change.PoNumber,
            poDate = change.PoNumber is { Length: > 0 } ? change.PoDate?.ToString("yyyy-MM-dd") : null,
            note = "Only the fields given change. Amounts, stock and the ledger are not touched.",
        };
        var summary = $"Change bill #{bill.InvoiceNumber} (\"{bill.ClientName}\") in company {companyId}:"
            + (change.Site != null ? $" site \"{change.Site}\"" : "")
            + (change.PoNumber != null ? $" PO \"{change.PoNumber}\"{(change.PoDate.HasValue ? $" dated {change.PoDate:yyyy-MM-dd}" : "")}" : "");
        return await StorePlanAsync(agent, "bill.details", companyId, payload, summary, key);
    }

    private async Task<object> PrepareChallanDetailsAsync(JsonElement args)
    {
        var agent = await RequireWriterAsync(McpScopes.Challans);
        var companyId = await CompanyArg(args);
        await Need("challans.manage.update");
        var key = IdemKey(args);
        if (await PriorForKeyAsync(agent, key, companyId, McpScopes.Challans) is { } prior) return prior;

        var challanId = IntArg(args, "challanId") ?? throw new ToolError("challanId is required.");
        var c = challanId > 0 ? await _challans.GetByIdAsync(challanId) : null;
        if (c == null || c.CompanyId != companyId) throw new ToolError("Resource unavailable or access denied.");
        if (c.InvoiceId != null) throw new ToolError("This challan is on a bill. Change its site or PO on the Edit Challan screen.");
        if (!c.IsEditable) throw new ToolError("This challan cannot be edited (it is cancelled).");
        var change = DetailArgs(args);

        var payload = new
        {
            challanId = c.Id,
            c.ChallanNumber,
            c.ClientId,
            c.ClientName,
            before = new { c.Site, c.PoNumber, poDate = c.PoDate?.ToString("yyyy-MM-dd"), c.Status },
            site = change.Site,
            poNumber = change.PoNumber,
            poDate = change.PoNumber is { Length: > 0 } ? change.PoDate?.ToString("yyyy-MM-dd") : null,
            note = "Only the fields given change; the status follows the PO as on Edit Challan.",
        };
        var summary = $"Change challan #{c.ChallanNumber} (\"{c.ClientName}\") in company {companyId}:"
            + (change.Site != null ? $" site \"{change.Site}\"" : "")
            + (change.PoNumber != null ? $" PO \"{change.PoNumber}\"{(change.PoDate.HasValue ? $" dated {change.PoDate:yyyy-MM-dd}" : "")}" : "");
        return await StorePlanAsync(agent, "challan.details", companyId, payload, summary, key);
    }

    private static DetailChange PlanDetailChange(JsonElement p)
    {
        string? S(string n) => p.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        return new DetailChange(S("site"), S("poNumber"),
            S("poDate") is { } d ? DateTime.ParseExact(d, "yyyy-MM-dd", CultureInfo.InvariantCulture) : null);
    }

    private async Task<(string Ref, string Summary)> CommitBillDetailsAsync(int companyId, JsonElement p)
    {
        var id = p.GetProperty("billId").GetInt32();
        var bill = await _invoices.GetByIdAsync(id);
        if (bill == null || bill.CompanyId != companyId) throw new KeyNotFoundException("The bill no longer exists.");
        var change = PlanDetailChange(p);
        var updated = await _invoices.UpdateStandaloneDetailsAsync(id, change.Site, change.PoNumber, change.PoDate)
            ?? throw new KeyNotFoundException("The bill no longer exists.");
        await OperationService<ICustomerSiteMemory>().RememberAsync(CurrentUserId, updated.ClientId, companyId, change.Site);
        return ($"Invoice:{updated.Id}", $"Bill #{updated.InvoiceNumber}: site \"{updated.Site}\", PO \"{updated.PoNumber}\"");
    }

    private async Task<(string Ref, string Summary)> CommitChallanDetailsAsync(int companyId, JsonElement p)
    {
        var id = p.GetProperty("challanId").GetInt32();
        var dto = await _challans.GetByIdAsync(id);
        if (dto == null || dto.CompanyId != companyId) throw new KeyNotFoundException("The challan no longer exists.");
        if (dto.InvoiceId != null) throw new InvalidOperationException("This challan was billed after the plan was made.");
        var change = PlanDetailChange(p);
        if (change.Site != null) dto.Site = string.IsNullOrWhiteSpace(change.Site) ? null : change.Site.Trim();
        if (change.PoNumber != null)
        {
            dto.PoNumber = change.PoNumber.Trim();
            dto.PoDate = dto.PoNumber.Length == 0 ? null : change.PoDate;
        }
        var updated = await _challans.UpdateChallanAsync(id, dto) ?? throw new KeyNotFoundException("The challan no longer exists.");
        await OperationService<ICustomerSiteMemory>().RememberAsync(CurrentUserId, updated.ClientId, companyId, change.Site);
        return ($"DeliveryChallan:{updated.Id}", $"Challan #{updated.ChallanNumber}: site \"{updated.Site}\", PO \"{updated.PoNumber}\", status {updated.Status}");
    }
}

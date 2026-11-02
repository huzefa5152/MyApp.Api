using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers;

/// <summary>
/// The tax consultant's step between a bill and FBR: classify each filing row against the
/// company's catalog (the dual-book overlay), then validate the result with FBR.
///
/// Saving goes through <c>InvoiceService.SaveTaxFilingAsync</c>, the Invoices screen's own
/// path, so its version check, coverage rule, quantity-permission rule, duplicate-row guard and
/// stock reflow all apply. Validation calls PRAL's validate endpoint only; submitting stays a
/// human action on the screen.
/// </summary>
public partial class McpController
{
    private const int TaxFilingsPerHour = 30;
    private const int FbrValidationsPerHour = 30;

    private static void AddTaxFilingTools(List<ExpandedTool> tools)
    {
        var company = new { type = "integer", minimum = 1 };
        var id = new { type = "integer", minimum = 1 };
        tools.Add(new("get_bill_tax_filing", "Read a bill's tax filing rows for FBR: the bill lines, the current filing rows (saved or the initial grouping), the company's filing rules, and the version prepare_bill_tax_filing needs.",
            ExpandedSchema(new { companyId = company, invoiceId = id }, "companyId", "invoiceId"),
            new[] { "invoices.list.view" }));
        tools.Add(new("prepare_bill_tax_filing", "Prepare the FBR classification of a bill: every bill line must be in exactly one row, each row naming an item from this company's catalog (search_item_types; for a new code, search_fbr_hs_codes then prepare_item_type) with a complete HS code. Follow companyRules from get_bill_tax_filing: when printsOriginalBillLines is true every bill line is its own row (no combining) and FBR receives each line's own bill description, so several rows may share one item; otherwise rows may combine lines and FBR receives the row description, which defaults to the item name. FBR receives a blank description when omitsFbrProductDescription is true. Changing quantities or amounts needs the consultant quantity permission. Read get_bill_tax_filing first and pass its version. Nothing is saved: returns a plan to show the user. Call commit_action only after they approve. Never submits to FBR.",
            ExpandedSchema(new
            {
                companyId = company, invoiceId = id,
                version = new { type = "string", minLength = 1, maxLength = 200 },
                rows = new
                {
                    type = "array", minItems = 1, maxItems = 100,
                    items = new
                    {
                        type = "object", additionalProperties = false, required = new[] { "sourceLineIds", "itemTypeId", "quantity", "valueExclTax" },
                        properties = new
                        {
                            sourceLineIds = new { type = "array", minItems = 1, maxItems = 100, items = new { type = "integer", minimum = 1 } },
                            itemTypeId = new { type = "integer", minimum = 1 },
                            description = new { type = "string", maxLength = 500 },
                            quantity = new { type = "string", description = "Filing quantity, up to 4 decimals." },
                            valueExclTax = new { type = "string", description = "Value excluding tax in PKR, up to 2 decimals." },
                            saleType = new { type = "string", maxLength = 100, description = "Optional; defaults to the item's sale type." },
                            fbrUomId = new { type = "integer", minimum = 1, description = "Optional; one of FBR's units for the HS code." },
                        },
                    },
                },
                idempotencyKey = new { type = "string", maxLength = 100 },
            }, "companyId", "invoiceId", "version", "rows"),
            new[] { "invoices.manage.update.itemtype", "invoices.manage.update.itemtype.qty" }, McpScopes.TaxFiling, Writes: true));
        tools.Add(new("validate_bill_fbr", "Validate a bill with FBR (PRAL's validate endpoint) and return FBR's verdict and item errors. Does not submit and issues no invoice number. Uses the company's own FBR token.",
            ExpandedSchema(new { companyId = company, invoiceId = id, scenarioId = new { type = "string", maxLength = 10, description = "Optional FBR scenario such as SN001." } }, "companyId", "invoiceId"),
            new[] { "invoices.fbr.validate" }, McpScopes.FbrValidate));
    }

    private async Task<object> CallTaxFilingToolAsync(string name, JsonElement args) => name switch
    {
        "get_bill_tax_filing" => await GetBillTaxFilingAsync(args),
        "prepare_bill_tax_filing" => await PrepareBillTaxFilingAsync(args),
        "validate_bill_fbr" => await ValidateBillFbrAsync(args),
        _ => throw new ToolError("Unknown tool."),
    };

    /// <summary>The bill, asserted against its STORED company: one answer for missing and someone else's.</summary>
    private async Task<InvoiceDto> OwnBillAsync(int companyId, int invoiceId)
    {
        var bill = invoiceId > 0 ? await _invoices.GetByIdAsync(invoiceId) : null;
        if (bill == null || bill.CompanyId != companyId) throw new ToolError("Resource unavailable or access denied.");
        return bill;
    }

    private static object FilingRow(TaxFilingRowDto r) => new
    {
        r.SourceLineIds, r.ItemTypeId, r.Description, r.HSCode, r.UOM, r.FbrUOMId, r.SaleType, r.Quantity, r.ValueExclTax,
    };

    // GET /api/invoices/{id}/tax-filing: invoices.list.view, access asserted against the stored company.
    private async Task<object> GetBillTaxFilingAsync(JsonElement args)
    {
        await Need("invoices.list.view");
        var companyId = await CompanyArg(args);
        var bill = await OwnBillAsync(companyId, OperationId(args, "invoiceId"));
        var editor = await _invoices.GetTaxFilingAsync(bill.Id) ?? throw new ToolError("Resource unavailable or access denied.");
        return new
        {
            invoiceId = bill.Id, bill.InvoiceNumber, date = Ymd(bill.Date), bill.ClientName, bill.FbrStatus, bill.TaxTreatment,
            bill.Subtotal, bill.GSTAmount, bill.GrandTotal,
            editor.Version, editor.HasSavedRows, editor.RequiresReview,
            companyRules = new
            {
                printsOriginalBillLines = editor.Bill.TaxInvoiceUseOriginalBillLines,
                omitsFbrProductDescription = editor.Bill.FbrOmitProductDescription,
                rows = editor.Bill.TaxInvoiceUseOriginalBillLines
                    ? "One row per bill line; never combine lines. Several lines may share one item: FBR receives each line's own bill description."
                    : "Rows may combine bill lines that share an item, unit and tax treatment. FBR receives the row description (default: the item name).",
            },
            lines = editor.Bill.Items.Select(i => new { i.Id, i.Description, i.Quantity, i.UOM, i.UnitPrice, i.LineTotal, i.ItemTypeId, i.ItemTypeName, i.HSCode }),
            rows = editor.Rows.Select(FilingRow),
            initialRows = editor.Rows.Count == editor.InitialRows.Count ? null : editor.InitialRows.Select(FilingRow),
            currency = "PKR",
        };
    }

    private async Task<object> PrepareBillTaxFilingAsync(JsonElement args)
    {
        var agent = await RequireWriterAsync(McpScopes.TaxFiling);
        var companyId = await CompanyArg(args);
        await Need("invoices.manage.update.itemtype", "invoices.manage.update.itemtype.qty");
        await Need("invoices.list.view");
        var key = IdemKey(args);
        if (await PriorForKeyAsync(agent, key, companyId, McpScopes.TaxFiling) is { } prior) return prior;

        var bill = await OwnBillAsync(companyId, OperationId(args, "invoiceId"));
        var editor = await _invoices.GetTaxFilingAsync(bill.Id) ?? throw new ToolError("Resource unavailable or access denied.");
        var version = OptText(args, "version", 200) ?? "";
        // The screen's own optimistic check, surfaced at prepare; commit re-checks it under a lock.
        if (version != editor.Version) throw new ToolError("The bill or its filing rows changed. Read get_bill_tax_filing again and use its version.");

        if (!args.TryGetProperty("rows", out var rowsEl) || rowsEl.ValueKind != JsonValueKind.Array) throw new ToolError("rows is required.");
        if (rowsEl.GetArrayLength() is < 1 or > 100) throw new ToolError("Use between 1 and 100 rows.");
        var lineIds = editor.Bill.Items.Select(i => i.Id).ToHashSet();
        var used = new HashSet<int>();
        var rows = new List<TaxFilingRowDto>();
        foreach (var r in rowsEl.EnumerateArray())
        {
            if (r.ValueKind != JsonValueKind.Object) throw new ToolError("Each row must be an object.");
            if (!r.TryGetProperty("sourceLineIds", out var src) || src.ValueKind != JsonValueKind.Array || src.GetArrayLength() == 0)
                throw new ToolError("Each row needs sourceLineIds.");
            var ids = new List<int>();
            foreach (var s in src.EnumerateArray())
            {
                if (s.ValueKind != JsonValueKind.Number || !s.TryGetInt32(out var lineId) || !lineIds.Contains(lineId))
                    throw new ToolError("A source line id is not a line of this bill.");
                if (!used.Add(lineId)) throw new ToolError($"Bill line {lineId} is in more than one row.");
                ids.Add(lineId);
            }
            var itemTypeId = IntArg(r, "itemTypeId") is { } t and > 0 ? t : throw new ToolError("Each row needs an itemTypeId from search_item_types.");
            if (!r.TryGetProperty("quantity", out var q) || !r.TryGetProperty("valueExclTax", out var v)) throw new ToolError("Each row needs quantity and valueExclTax.");
            int? fbrUom = null;
            if (Has(r, "fbrUomId")) fbrUom = IntArg(r, "fbrUomId") is { } u and > 0 ? u : throw new ToolError("fbrUomId must be a positive integer.");
            rows.Add(new TaxFilingRowDto
            {
                SourceLineIds = ids, ItemTypeId = itemTypeId, Description = OptText(r, "description", 500) ?? "",
                Quantity = Dec(q, "quantity", 0m, 999_999_999m, 4, minInclusive: false),
                ValueExclTax = Dec(v, "valueExclTax", 0m, 9_999_999_999m, 2),
                SelectedSaleType = OptText(r, "saleType", 100) is { Length: > 0 } st ? st : null, SelectedFbrUOMId = fbrUom,
            });
        }
        if (used.Count != lineIds.Count) throw new ToolError("Every bill line must be in exactly one row.");

        var typeIds = rows.Select(r => r.ItemTypeId!.Value).Distinct().ToList();
        var types = await _context.ItemTypes.AsNoTracking().Where(i => typeIds.Contains(i.Id) && i.CompanyId == companyId && !i.IsDeleted)
            .Select(i => new { i.Id, i.Name, i.HSCode, i.IsHsCodePartial, i.UOM, i.SaleType }).ToDictionaryAsync(i => i.Id);
        if (types.Count != typeIds.Count) throw new ToolError("An item is outside this company's catalog.");
        if (types.Values.FirstOrDefault(i => string.IsNullOrWhiteSpace(i.HSCode) || i.IsHsCodePartial) is { } partial)
            throw new ToolError($"Item \"{partial.Name}\" has no complete HS code. Classify it first (prepare_item_type).");
        // The save's own rules for a company that prints its original lines, answered now with their reason.
        if (editor.Bill.TaxInvoiceUseOriginalBillLines)
        {
            var problem = TaxFilingProjection.MergedRow(editor.HasSavedRows ? editor.Rows : null, rows)
                ?? TaxFilingProjection.RepeatedHsCode(editor.Bill.Items.Select(i => new MyApp.Api.Models.InvoiceItem { Id = i.Id, Description = i.Description }),
                    rows.Select(r => new TaxFilingRowDto { SourceLineIds = r.SourceLineIds, HSCode = types[r.ItemTypeId!.Value].HSCode }));
            if (problem != null) throw new ToolError(problem);
        }

        var payload = new
        {
            invoiceId = bill.Id, bill.InvoiceNumber, bill.ClientName, version,
            rows = rows.Select(r => new
            {
                r.SourceLineIds, r.ItemTypeId, itemName = types[r.ItemTypeId!.Value].Name, hsCode = types[r.ItemTypeId!.Value].HSCode,
                r.Description, r.Quantity, r.ValueExclTax, saleType = r.SelectedSaleType, fbrUomId = r.SelectedFbrUOMId,
            }),
            filingTotal = rows.Sum(r => r.ValueExclTax), billSubtotal = bill.Subtotal, currency = "PKR",
            note = "Saved as the bill's FBR filing rows. The commercial bill is unchanged. Nothing is sent to FBR.",
        };
        var summary = $"Classify bill #{bill.InvoiceNumber} (id {bill.Id}) for FBR in company {companyId}: {rows.Count} filing row(s), value {rows.Sum(r => r.ValueExclTax):0.00} PKR excl. tax";
        return await StorePlanAsync(agent, "taxfiling.save", companyId, payload, summary, key);
    }

    private async Task<(string Ref, string Summary)> CommitTaxFilingAsync(int companyId, JsonElement p)
    {
        var invoiceId = p.GetProperty("invoiceId").GetInt32();
        await OwnBillAsync(companyId, invoiceId);
        var dto = new SaveTaxFilingDto
        {
            Version = p.GetProperty("version").GetString()!,
            Rows = p.GetProperty("rows").EnumerateArray().Select(r => new TaxFilingRowDto
            {
                SourceLineIds = r.GetProperty("sourceLineIds").EnumerateArray().Select(x => x.GetInt32()).ToList(),
                ItemTypeId = r.GetProperty("itemTypeId").GetInt32(),
                Description = r.TryGetProperty("description", out var d) && d.ValueKind == JsonValueKind.String ? d.GetString()! : "",
                Quantity = r.GetProperty("quantity").GetDecimal(), ValueExclTax = r.GetProperty("valueExclTax").GetDecimal(),
                SelectedSaleType = r.TryGetProperty("saleType", out var s) && s.ValueKind == JsonValueKind.String ? s.GetString() : null,
                SelectedFbrUOMId = r.TryGetProperty("fbrUomId", out var u) && u.ValueKind == JsonValueKind.Number ? u.GetInt32() : null,
            }).ToList(),
        };
        // The quantity right is read at commit, exactly as the screen reads it on save.
        var canAdjust = await _permissions.HasPermissionAsync(CurrentUserId, "invoices.manage.update.itemtype.qty");
        var username = await _context.Users.AsNoTracking().Where(u => u.Id == CurrentUserId).Select(u => u.Username).FirstOrDefaultAsync() ?? "";
        var saved = await _invoices.SaveTaxFilingAsync(invoiceId, dto, CurrentUserId, username, canAdjust)
            ?? throw new KeyNotFoundException("The bill no longer exists.");
        return ($"Invoice:{invoiceId}", $"Saved {saved.Rows.Count} FBR filing row(s) for bill #{saved.Bill.InvoiceNumber}. Not submitted to FBR");
    }

    // POST /api/fbr/{id}/validate: invoices.fbr.validate, access asserted against the stored company.
    private async Task<object> ValidateBillFbrAsync(JsonElement args)
    {
        await Need("invoices.fbr.validate");
        var companyId = await CompanyArg(args);
        var bill = await OwnBillAsync(companyId, OperationId(args, "invoiceId"));
        var scenario = OptText(args, "scenarioId", 10) is { Length: > 0 } sc ? sc : null;
        // Each validation spends the company's PRAL quota, so a runaway loop is capped per user.
        var since = DateTime.UtcNow.AddHours(-1);
        var done = await _context.McpActivities.CountAsync(a => a.UserId == CurrentUserId && a.Tool == "validate_bill_fbr" && a.Outcome == "ok" && a.At > since);
        if (done >= FbrValidationsPerHour) throw new ToolError($"Your AI agents have already validated {FbrValidationsPerHour} bills with FBR in the last hour. Try again later.");
        var result = await OperationService<IFbrService>().ValidateInvoiceAsync(bill.Id, scenario);
        _resultSummary = $"FBR validation of bill #{bill.InvoiceNumber}: {(result.Success ? "valid" : "rejected")}";
        return new
        {
            invoiceId = bill.Id, bill.InvoiceNumber, valid = result.Success, result.FbrStatus, result.ErrorMessage,
            itemErrors = result.ItemErrors?.Select(e => new { e.ItemSNo, e.StatusCode, e.Status, e.ErrorCode, e.Error }),
            submitted = false, note = "Validation only. Submitting to FBR stays a human action on the Invoices screen.",
        };
    }
}

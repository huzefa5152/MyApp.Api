using System.Text.Json;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Edits of existing documents. The prepare_* tool that creates a document takes the record's
    /// id to edit it instead: its own Build has already checked the arguments and the ownership of
    /// every linked record for this company; here the STORED record is loaded and must belong to
    /// the same company (a body or argument cannot move it), the screen's division rule is applied
    /// to its stored tag, kept lines must be lines of this record, and the commit calls the screen's
    /// own UpdateAsync. Fields the agent does not send keep their stored value where the screen's
    /// form would.
    /// </summary>
    public partial class McpController
    {
        private static void KeepOwnLines(IEnumerable<int?> sent, IEnumerable<int> own, string what)
        {
            var ok = own.ToHashSet();
            var stray = sent.Where(i => i is int n && !ok.Contains(n)).Select(i => i!.Value).ToList();
            if (stray.Count > 0) throw new ToolError($"Line {stray[0]} is not a line of this {what}.");
            var dup = sent.Where(i => i != null).GroupBy(i => i).FirstOrDefault(g => g.Count() > 1);
            if (dup != null) throw new ToolError($"Line {dup.Key} is given twice.");
        }

        private static object EditPreview(string what, int id, object number, object after) =>
            new { editing = new { what, id, number }, after };

        private async Task<Built> EditQuoteAsync(int companyId, int id, SalesQuoteDto dto, List<Line> lines, object preview, JsonElement args)
        {
            var svc = Svc<ISalesQuoteService>();
            var existing = await svc.GetByIdAsync(id);
            if (existing == null || existing.CompanyId != companyId) throw new ToolError(Denied);
            await AssertDivisionReadAsync(companyId, existing.DivisionId);
            // Moving it needs write access to the target scope (checked by Build); not sending a division keeps it.
            if (!Has(args, "divisionId")) dto.DivisionId = existing.DivisionId;
            KeepOwnLines(lines.Select(l => l.Id), existing.Items.Select(i => i.Id), "quotation");
            for (var i = 0; i < lines.Count; i++) dto.Items[i].Id = lines[i].Id ?? 0;
            return new Built(EditPreview("quotation", id, existing.QuoteNumber, preview),
                $"Update quotation #{existing.QuoteNumber} in company {companyId}: {lines.Count} line(s)",
                async () =>
                {
                    var q = await svc.UpdateAsync(id, dto) ?? throw new ToolError("The quotation no longer exists.");
                    return ($"SalesQuote:{q.Id}", $"Updated quotation #{q.QuoteNumber} (id {q.Id}), total {q.GrandTotal:0.00} PKR");
                });
        }

        private async Task<Built> EditSalesOrderAsync(int companyId, int id, SalesOrderDto dto, List<Line> lines, object preview, JsonElement args)
        {
            var svc = Svc<ISalesOrderService>();
            var existing = await svc.GetByIdAsync(id);
            if (existing == null || existing.CompanyId != companyId) throw new ToolError(Denied);
            await AssertDivisionReadAsync(companyId, existing.DivisionId);
            if (Has(args, "divisionId") && dto.DivisionId != existing.DivisionId) throw new ToolError("A sales order's division cannot change.");
            dto.DivisionId = existing.DivisionId;
            KeepOwnLines(lines.Select(l => l.Id), existing.Items.Select(i => i.Id), "sales order");
            for (var i = 0; i < lines.Count; i++) dto.Items[i].Id = lines[i].Id ?? 0;
            return new Built(EditPreview("sales order", id, existing.SalesOrderNumber, preview),
                $"Update sales order #{existing.SalesOrderNumber} in company {companyId}: {lines.Count} line(s)",
                async () =>
                {
                    var o = await svc.UpdateAsync(id, dto) ?? throw new ToolError("The sales order no longer exists.");
                    return ($"SalesOrder:{o.Id}", $"Updated sales order #{o.SalesOrderNumber} (id {o.Id})");
                });
        }

        private async Task<Built> EditChallanAsync(int companyId, int id, DeliveryChallanDto dto, List<Line> lines, object preview, JsonElement args)
        {
            var svc = Svc<IDeliveryChallanService>();
            var existing = await svc.GetByIdAsync(id);
            if (existing == null || existing.CompanyId != companyId) throw new ToolError(Denied);
            await AssertDivisionReadAsync(companyId, existing.DivisionId);
            if (Has(args, "divisionId") && dto.DivisionId != existing.DivisionId) throw new ToolError("A challan's division cannot change.");
            dto.DivisionId = existing.DivisionId;
            KeepOwnLines(lines.Select(l => l.Id), existing.Items.Select(i => i.Id), "challan");
            for (var i = 0; i < lines.Count; i++) dto.Items[i].Id = lines[i].Id ?? 0;
            return new Built(EditPreview("challan", id, existing.ChallanNumber, preview),
                $"Update challan #{existing.ChallanNumber} in company {companyId}: {lines.Count} line(s)",
                async () =>
                {
                    var c = await svc.UpdateChallanAsync(id, dto) ?? throw new ToolError("The challan no longer exists.");
                    return ($"DeliveryChallan:{c.Id}", $"Updated challan #{c.ChallanNumber} (id {c.Id}), status {c.Status}");
                });
        }

        // PUT /api/invoices/{id}: bills.manage.update, against the bill's STORED company and division.
        private async Task<Built> EditBillAsync(int companyId, int id, JsonElement args)
        {
            await Need("bills.manage.update");
            var existing = await OwnBillAsync(companyId, id);
            if (Has(args, "challanIds") || Has(args, "prices")) throw new ToolError("Editing a bill takes its lines as items (with their id from get_invoice), not challans.");
            var clientId = await ClientInCompanyAsync(args, companyId, required: false) ?? existing.ClientId;
            var moving = Has(args, "divisionId");
            var division = moving ? OptId(args, "divisionId") : existing.DivisionId;
            if (moving && division != existing.DivisionId) await AssertDivisionWriteAsync(companyId, division);
            var date = DateArg(args, "date") ?? existing.Date;
            if (PakistanClock.IsFutureInvoiceDate(date)) throw new ToolError("A bill cannot be dated in the future (FBR rule 0043).");
            var lines = await DocLinesAsync(args, companyId, pricesRequired: true);
            if (lines.Any(l => l.ItemTypeId == null)) throw new ToolError("Every bill line needs an itemTypeId (search_item_types).");
            KeepOwnLines(lines.Select(l => l.Id), existing.Items.Select(i => i.Id), "bill");
            var stored = existing.Items.ToDictionary(i => i.Id);
            var dto = new UpdateInvoiceDto
            {
                Date = date, GSTRate = Has(args, "gstRate") ? Gst(args) : existing.GSTRate, ClientId = clientId,
                PaymentTerms = Has(args, "paymentTerms") ? OptText(args, "paymentTerms", 200) : existing.PaymentTerms,
                PaymentMode = Has(args, "paymentMode") ? OptText(args, "paymentMode", 50) : existing.PaymentMode,
                DocumentType = existing.DocumentType, UpdateDivision = moving, DivisionId = division,
                WithholdingTaxRate = existing.WithholdingTaxRate, WithholdingTaxAmount = existing.WithholdingTaxAmount,
                FurtherTaxRate = Has(args, "furtherTaxRate") ? OptDec(args, "furtherTaxRate", 0, 100, 2) : existing.FurtherTaxRate,
                AdvanceTaxSection = Has(args, "advanceTaxSection") ? (OptText(args, "advanceTaxSection", 20) is { Length: > 0 } s ? s : null) : existing.AdvanceTaxSection,
                AdvanceTaxFilerActive = Has(args, "advanceTaxFilerActive") ? OptBool(args, "advanceTaxFilerActive") : existing.AdvanceTaxFilerActive,
                TaxRateOverrideReason = OptText(args, "taxRateOverrideReason", 500) is { Length: > 0 } why ? why : existing.TaxRateOverrideReason,
                Items = lines.Select(l => new UpdateInvoiceItemDto
                {
                    Id = l.Id ?? 0, DeliveryItemId = l.Id is int k ? stored[k].DeliveryItemId : null,
                    Description = l.Description, Quantity = l.Quantity, UOM = l.Unit, UnitPrice = l.UnitPrice!.Value, ItemTypeId = l.ItemTypeId,
                }).ToList(),
            };
            var sub = Math.Round(lines.Sum(l => l.Quantity * l.UnitPrice!.Value), 2, MidpointRounding.AwayFromZero);
            var preview = new
            {
                clientId, divisionId = division, date = Ymd(date), gstRate = dto.GSTRate, furtherTaxRate = dto.FurtherTaxRate,
                lines = dto.Items.Select(i => new { i.Id, i.Description, i.Quantity, unit = i.UOM, i.UnitPrice, i.ItemTypeId }),
                subtotalAbout = sub, currency = "PKR", note = "Totals and taxes are worked out by the ERP when saved. Nothing is sent to FBR.",
            };
            return new Built(EditPreview("bill", id, existing.InvoiceNumber, preview),
                $"Update bill #{existing.InvoiceNumber} in company {companyId}: {lines.Count} line(s), subtotal about {sub:0.00} PKR",
                async () =>
                {
                    var b = await Svc<IInvoiceService>().UpdateAsync(id, dto) ?? throw new ToolError("The bill no longer exists.");
                    return ($"Invoice:{b.Id}", $"Updated bill #{b.InvoiceNumber} (id {b.Id}), total {b.GrandTotal:0.00} PKR. Not submitted to FBR");
                });
        }

        private async Task<Built> EditPurchaseBillAsync(int companyId, int id, CreatePurchaseBillDto created, List<int?> lineIds, object preview, JsonElement args)
        {
            var svc = Svc<IPurchaseBillService>();
            var existing = await svc.GetByIdAsync(id);
            if (existing == null || existing.CompanyId != companyId) throw new ToolError(Denied);
            await AssertDivisionReadAsync(companyId, existing.DivisionId);
            if (created.SupplierId != existing.SupplierId) throw new ToolError("A purchase bill's supplier cannot change; record a new bill instead.");
            KeepOwnLines(lineIds, existing.Items.Select(i => i.Id), "purchase bill");
            var dto = new UpdatePurchaseBillDto
            {
                Date = created.Date, SupplierBillNumber = created.SupplierBillNumber ?? existing.SupplierBillNumber, SupplierIRN = created.SupplierIRN ?? existing.SupplierIRN,
                GSTRate = Has(args, "gstRate") ? created.GSTRate : existing.GSTRate, PaymentTerms = created.PaymentTerms ?? existing.PaymentTerms,
                DocumentType = existing.DocumentType, PaymentMode = existing.PaymentMode,
                WithholdingTaxRate = existing.WithholdingTaxRate, WithholdingTaxAmount = existing.WithholdingTaxAmount,
                Items = created.Items.Select((it, i) => new UpdatePurchaseItemDto
                {
                    Id = lineIds[i] ?? 0, ItemTypeId = it.ItemTypeId, Description = it.Description, Quantity = it.Quantity,
                    UOM = it.UOM ?? "", UnitPrice = it.UnitPrice, HSCode = it.HSCode,
                }).ToList(),
            };
            return new Built(EditPreview("purchase bill", id, existing.PurchaseBillNumber, preview),
                $"Update purchase bill #{existing.PurchaseBillNumber} in company {companyId}: {dto.Items.Count} line(s)",
                async () =>
                {
                    var b = await svc.UpdateAsync(id, dto) ?? throw new ToolError("The purchase bill no longer exists.");
                    return ($"PurchaseBill:{b.Id}", $"Updated purchase bill #{b.PurchaseBillNumber} (id {b.Id}), total {b.GrandTotal:0.00} PKR");
                });
        }

        private async Task<Built> EditGoodsReceiptAsync(int companyId, int id, CreateGoodsReceiptDto created, List<int?> lineIds, object preview, JsonElement args)
        {
            var svc = Svc<IGoodsReceiptService>();
            var existing = await svc.GetByIdAsync(id);
            if (existing == null || existing.CompanyId != companyId) throw new ToolError(Denied);
            await AssertDivisionReadAsync(companyId, existing.DivisionId);
            KeepOwnLines(lineIds, existing.Items.Select(i => i.Id), "goods receipt");
            var dto = new UpdateGoodsReceiptDto
            {
                ReceiptDate = created.ReceiptDate, SupplierId = created.SupplierId, PurchaseBillId = created.PurchaseBillId,
                SupplierChallanNumber = created.SupplierChallanNumber, Site = created.Site, Status = existing.Status,
                Items = created.Items.Select((it, i) => new UpdateGoodsReceiptItemDto
                {
                    Id = lineIds[i] ?? 0, ItemTypeId = it.ItemTypeId, Description = it.Description, Quantity = it.Quantity, Unit = it.Unit,
                }).ToList(),
            };
            return new Built(EditPreview("goods receipt", id, existing.GoodsReceiptNumber, preview),
                $"Update goods receipt #{existing.GoodsReceiptNumber} in company {companyId}: {dto.Items.Count} line(s)",
                async () =>
                {
                    var g = await svc.UpdateAsync(id, dto) ?? throw new ToolError("The goods receipt no longer exists.");
                    return ($"GoodsReceipt:{g.Id}", $"Updated goods receipt #{g.GoodsReceiptNumber} (id {g.Id})");
                });
        }

        private async Task<Built> EditMoneyAsync(int companyId, int id, CreatePaymentDto dto, object preview, bool receipt)
        {
            var svc = Svc<IPaymentService>();
            var existing = await svc.GetByIdAsync(id);
            if (existing == null || existing.CompanyId != companyId || existing.Direction != dto.Direction) throw new ToolError(Denied);
            await AssertDivisionReadAsync(companyId, existing.DivisionId);
            var what = receipt ? "receipt" : "payment";
            return new Built(EditPreview(what, id, existing.Reference, preview),
                $"Update {what} {existing.Reference} in company {companyId}: {dto.Amount:0.00} PKR",
                async () =>
                {
                    var p = await svc.UpdateAsync(id, dto) ?? throw new ToolError($"The {what} no longer exists.");
                    return ($"Payment:{p.Id}", $"Updated {what} {p.Reference} (id {p.Id}), {p.Amount:0.00} PKR");
                });
        }

        private async Task<Built> EditJournalAsync(int companyId, int id, CreateJournalEntryDto dto, object preview)
        {
            var svc = Svc<IJournalEntryService>();
            var existing = await svc.GetByIdAsync(id);
            if (existing == null || existing.CompanyId != companyId) throw new ToolError(Denied);
            await AssertDivisionReadAsync(companyId, existing.DivisionId);
            if (existing.SourceDocType != "ManualJournal") throw new ToolError("Only manual journal entries can be edited; this one is posted by a document.");
            return new Built(EditPreview("journal entry", id, existing.Reference, preview),
                $"Update journal entry {existing.Reference} in company {companyId}",
                async () =>
                {
                    var je = await svc.UpdateManualAsync(id, dto) ?? throw new ToolError("The journal entry no longer exists.");
                    return ($"JournalEntry:{je.Id}", $"Updated journal entry {je.Reference} (id {je.Id}) of {je.TotalDebit:0.00} PKR");
                });
        }
    }
}

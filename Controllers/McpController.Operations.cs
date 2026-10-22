using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Stock, withholding-tax receipts, receipt allocation and single-record reads.
    ///
    /// Some screens keep their logic in the controller (stock adjustment and the stock reads are
    /// hundreds of lines there). Those tools run the screen's own action in-process as the signed-in
    /// user (<see cref="Screen{T}"/>). Called that way the action's attribute filters do NOT run, so
    /// every caller here first does what they would: the permission key (Need), the company
    /// (CompanyArg / the plan's pinned company, which also applies the agent token's company list),
    /// and the stored company of every record reached by id. The action's own guards then run on top.
    /// </summary>
    public partial class McpController
    {
        private T Screen<T>() where T : ControllerBase
        {
            var c = ActivatorUtilities.CreateInstance<T>(HttpContext.RequestServices);
            c.ControllerContext = new ControllerContext { HttpContext = HttpContext };
            return c;
        }

        private static string ScreenMessage(object? value)
        {
            if (value == null) return "The ERP refused this.";
            var el = JsonSerializer.SerializeToElement(value);
            foreach (var key in new[] { "error", "message", "Error", "Message" })
                if (el.ValueKind == JsonValueKind.Object && el.TryGetProperty(key, out var m) && m.ValueKind == JsonValueKind.String) return m.GetString()!;
            return "The ERP refused this.";
        }

        /// <summary>The value of an action result, or the screen's own refusal as a tool error.</summary>
        private static async Task<object> ScreenAsync(Func<Task<IActionResult>> run)
        {
            IActionResult r;
            try { r = await run(); }
            catch (UnauthorizedAccessException) { throw new ToolError(Denied); }
            return r switch
            {
                OkObjectResult ok => ok.Value ?? new { },
                CreatedAtActionResult created => created.Value ?? new { },
                ObjectResult o when o.StatusCode is null or < 300 => o.Value ?? new { },
                OkResult or NoContentResult => new { ok = true },
                NotFoundResult or NotFoundObjectResult => throw new ToolError(Denied),
                ObjectResult o => throw new ToolError(ScreenMessage(o.Value)),
                _ => throw new ToolError("The ERP refused this."),
            };
        }

        private static Task<object> ScreenAsync<TOut>(Func<Task<ActionResult<TOut>>> run) =>
            ScreenAsync(async () =>
            {
                var r = await run();
                return r.Result ?? new OkObjectResult(r.Value);
            });

        private static T As<T>(object value) =>
            value is T t ? t : JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(value))!;

        private void AddOperationTools(List<Tool> t)
        {
            var windowed = new { companyId = CompanyProp, search = Str(200), offset = new { type = "integer", minimum = 0 }, limit = new { type = "integer", minimum = 1, maximum = MaxToolRows } };
            t.AddRange(new Tool[]
            {
                // ── stock reads ──
                new("get_stock_values", "Stock on hand WITH value per item, as the Stock screen shows it: quantity, value excluding tax, sales tax, rate, GD numbers (actual cost only for users who may see it).",
                    Obj(windowed, "companyId"), Read: GetStockValuesAsync),
                new("get_stock_movements", "The stock movement feed (in/out, source document, date, value), newest first.",
                    Obj(new { companyId = CompanyProp, itemTypeId = Int(), sourceType = Str(40), dateFrom = DateProp, dateTo = DateProp, page = new { type = "integer", minimum = 1 }, pageSize = new { type = "integer", minimum = 1, maximum = 100 } }, "companyId"),
                    Read: GetStockMovementsAsync),
                new("get_stock_gd_details", "Which GD lines an item's stock sits in (FIFO pools): GD number, date, claim month, remaining quantity and value.",
                    Obj(new { companyId = CompanyProp, itemTypeId = Int() }, "companyId", "itemTypeId"), Read: GetStockGdDetailsAsync),
                new("get_stock_tie_out", "Month-end tie-out: stock screen vs the Inventory account vs Annex-H1, and GD balances vs Import Clearing, with the reasons for any difference.",
                    Obj(new { companyId = CompanyProp, month = Str(7, "yyyy-MM; default the current month.") }, "companyId"), Read: GetStockTieOutAsync),
                new("prepare_stock_adjustment", "Prepare a stock correction for damaged, lost or miscounted goods: mode 'set' gives the figures it should be (quantity and/or value), 'delta' gives the change. A SOLD item needs its sale bill, not an adjustment. Nothing is saved until commit_action.",
                    Obj(new
                    {
                        companyId = CompanyProp, itemTypeId = Int(), mode = new { type = "string", @enum = new[] { "set", "delta" } },
                        targetQuantity = new { type = "string" }, targetValueExcludingTax = MoneyProp, delta = new { type = "string" }, valueDelta = MoneyProp,
                        unitCostExcludingTax = MoneyProp, salesTaxRate = new { type = "string" }, movementDate = DateProp, notes = Str(500), idempotencyKey = IdemProp,
                    }, "companyId", "itemTypeId", "mode"),
                    Build: BuildStockAdjustmentAsync, PerHour: 30, Noun: "stock adjustments"),

                // ── withholding tax receipts ──
                new("search_withholding_receipts", "Withholding tax certificates received from customers (number, customer, date, amount).",
                    Obj(new { companyId = CompanyProp, clientId = Int(), offset = new { type = "integer", minimum = 0 }, limit = new { type = "integer", minimum = 1, maximum = MaxToolRows } }, "companyId"),
                    Read: SearchWithholdingReceiptsAsync),
                new("get_withholding_receipt", "One withholding tax receipt.", Obj(new { companyId = CompanyProp, withholdingReceiptId = Int() }, "companyId", "withholdingReceiptId"), Read: GetWithholdingReceiptAsync),
                new("prepare_withholding_receipt", "Prepare a withholding tax receipt (the tax a customer deducted and certified), or an edit when withholdingReceiptId is given. Nothing is saved until commit_action.",
                    Obj(new { companyId = CompanyProp, withholdingReceiptId = Int("Edit this receipt."), clientId = Int(), divisionId = DivisionProp, date = DateProp, amount = MoneyProp, description = Str(500), idempotencyKey = IdemProp }, "companyId", "clientId", "amount"),
                    Build: BuildWithholdingReceiptAsync, PerHour: 20, Noun: "withholding tax receipts"),

                // ── receipt allocation ──
                new("prepare_receipt_allocation", "Prepare settling customer bills from money already received: mode 'lines' applies a receipt's unallocated balance to the bills you list, 'auto' spreads it over the customer's oldest bills, 'advances' applies every advance the customer holds. Nothing is saved until commit_action.",
                    Obj(new
                    {
                        companyId = CompanyProp, mode = new { type = "string", @enum = new[] { "lines", "auto", "advances" } }, receiptId = Int("For lines and auto."), clientId = Int("For advances."),
                        lines = new { type = "array", minItems = 1, maxItems = 50, items = new { type = "object", additionalProperties = false, required = new[] { "invoiceId", "amount" }, properties = new { invoiceId = Int(), amount = MoneyProp } } },
                        idempotencyKey = IdemProp,
                    }, "companyId", "mode"),
                    Build: BuildReceiptAllocationAsync, PerHour: 30, Noun: "receipt allocations"),

                // ── single records ──
                new("get_receipt", "One customer receipt with its allocations to bills and its unallocated balance.", Obj(new { companyId = CompanyProp, receiptId = Int() }, "companyId", "receiptId"), Read: a => GetMoneyAsync(a, receipt: true)),
                new("get_payment", "One supplier payment with its allocations to purchase bills.", Obj(new { companyId = CompanyProp, paymentId = Int() }, "companyId", "paymentId"), Read: a => GetMoneyAsync(a, receipt: false)),
                new("get_goods_receipt", "One goods receipt with its lines (line ids are what prepare_goods_receipt takes to edit).", Obj(new { companyId = CompanyProp, goodsReceiptId = Int() }, "companyId", "goodsReceiptId"), Read: GetGoodsReceiptAsync),
                new("get_journal_entry", "One journal entry with its lines.", Obj(new { companyId = CompanyProp, journalEntryId = Int() }, "companyId", "journalEntryId"), Read: GetJournalEntryAsync),
            });
        }

        // ── stock ──────────────────────────────────────────────────────────

        private async Task<object> GetStockValuesAsync(JsonElement args)
        {
            await Need("stock.dashboard.view");
            var companyId = await CompanyArg(args);
            var rows = As<List<StockOnHandRowDto>>(await ScreenAsync(() => Screen<StockController>().GetOnHand(companyId)));
            var search = StrArg(args, "search");
            var (offset, limit) = Window(args);
            var list = rows.Where(r => search == "" || r.ItemTypeName.Contains(search, StringComparison.OrdinalIgnoreCase) || (r.HSCode ?? "").Contains(search)).ToList();
            return new
            {
                totalCount = list.Count, offset, totalValueExcludingTax = list.Sum(r => r.ValueExcludingTax), currency = "PKR",
                items = list.Skip(offset).Take(limit),
            };
        }

        private async Task<object> GetStockMovementsAsync(JsonElement args)
        {
            await Need("stock.movements.view");
            var companyId = await CompanyArg(args);
            var item = await ItemInCompanyAsync(args, "itemTypeId", companyId);
            var (from, to) = Dates(args);
            return await ScreenAsync(() => Screen<StockController>().GetMovements(companyId, IntArg(args, "page") ?? 1, IntArg(args, "pageSize"),
                item, OptText(args, "sourceType", 40) is { Length: > 0 } st ? st : null, from, to));
        }

        private async Task<object> GetStockGdDetailsAsync(JsonElement args)
        {
            await Need("stock.dashboard.view");
            var companyId = await CompanyArg(args);
            var item = await ItemInCompanyAsync(args, "itemTypeId", companyId) ?? throw new ToolError("itemTypeId is required.");
            return await ScreenAsync(() => Screen<StockController>().GetGdDetails(companyId, item));
        }

        private async Task<object> GetStockTieOutAsync(JsonElement args)
        {
            await Need("importcosting.taxdesk.view");
            var companyId = await CompanyArg(args);
            return await ScreenAsync(() => Screen<StockController>().GetTieOut(companyId, OptText(args, "month", 7) is { Length: > 0 } m ? m : PakistanClock.Today.ToString("yyyy-MM")));
        }

        // POST /api/stock/adjust: stock.adjust.create, company-level (policy D2), item must be this company's.
        private async Task<Built> BuildStockAdjustmentAsync(int companyId, JsonElement args)
        {
            await Need("stock.adjust.create");
            await AssertDivisionWriteAsync(companyId, null);
            var item = await ItemInCompanyAsync(args, "itemTypeId", companyId) ?? throw new ToolError("itemTypeId is required.");
            var mode = OptText(args, "mode", 10) is "set" or "delta" ? OptText(args, "mode", 10)! : throw new ToolError("mode must be set or delta.");
            var dto = new CreateStockAdjustmentDto
            {
                CompanyId = companyId, ItemTypeId = item, Mode = mode,
                Delta = mode == "delta" ? OptDec(args, "delta", -999_999_999m, 999_999_999m, 4) ?? 0m : 0m,
                ValueDelta = mode == "delta" ? OptDec(args, "valueDelta", -99_999_999_999m, 99_999_999_999m, 2) : null,
                TargetQuantity = mode == "set" ? OptDec(args, "targetQuantity", 0m, 999_999_999m, 4) : null,
                TargetValueExcludingTax = mode == "set" ? OptDec(args, "targetValueExcludingTax", 0m, 99_999_999_999m, 2) : null,
                UnitCostExcludingTax = mode == "delta" ? OptDec(args, "unitCostExcludingTax", 0m, 99_999_999m, 4) : null,
                SalesTaxRate = OptDec(args, "salesTaxRate", 0m, 100m, 2),
                MovementDate = DateArg(args, "movementDate") ?? PakistanClock.Today, Notes = OptText(args, "notes", 500),
            };
            if (mode == "set" && dto.TargetQuantity == null && dto.TargetValueExcludingTax == null) throw new ToolError("Give targetQuantity and/or targetValueExcludingTax.");
            if (mode == "delta" && dto.Delta == 0m && dto.ValueDelta is null or 0m) throw new ToolError("Give a quantity change (delta) and/or a value change (valueDelta).");
            var name = await _context.ItemTypes.AsNoTracking().Where(i => i.Id == item).Select(i => i.Name).FirstAsync();
            var preview = new { itemTypeId = item, itemName = name, mode, dto.TargetQuantity, dto.TargetValueExcludingTax, dto.Delta, dto.ValueDelta, movementDate = Ymd(dto.MovementDate), dto.Notes,
                reminder = "Goods that were SOLD need their sale bill instead: an adjustment is not undone when the bill is entered later." };
            return new Built(preview, $"Adjust stock of \"{name}\" in company {companyId} ({mode})",
                async () =>
                {
                    var res = await ScreenAsync(() => Screen<StockController>().AdjustStock(dto));
                    return ($"StockAdjustment:{companyId}:{item}", ScreenMessage(res) is var m && m != "The ERP refused this." ? m : $"Stock of \"{name}\" adjusted");
                });
        }

        // ── withholding tax receipts ───────────────────────────────────────

        private async Task<object> SearchWithholdingReceiptsAsync(JsonElement args)
        {
            await Need("withholdingtax.list.view");
            var companyId = await CompanyArg(args);
            var client = await ClientInCompanyAsync(args, companyId, required: false);
            var rows = (await Svc<IWithholdingTaxReceiptService>().GetByCompanyAsync(companyId, await DivisionScopeAsync(companyId)))
                .Where(r => r.CompanyId == companyId && (client == null || r.ClientId == client)).ToList();
            var (offset, limit) = Window(args);
            return new { totalCount = rows.Count, offset, items = rows.Skip(offset).Take(limit).Select(r => new { r.Id, r.ReceiptNumber, r.ClientId, r.ClientName, date = Ymd(r.Date), r.Amount, r.Description, r.DivisionId }), currency = "PKR" };
        }

        private async Task<WithholdingTaxReceiptDto> OwnWithholdingAsync(int companyId, int id)
        {
            var r = await Svc<IWithholdingTaxReceiptService>().GetByIdAsync(id);
            if (r == null || r.CompanyId != companyId) throw new ToolError(Denied);
            await AssertDivisionReadAsync(companyId, r.DivisionId);
            return r;
        }

        private async Task<object> GetWithholdingReceiptAsync(JsonElement args)
        {
            await Need("withholdingtax.list.view");
            var companyId = await CompanyArg(args);
            var r = await OwnWithholdingAsync(companyId, IdArg(args, "withholdingReceiptId"));
            return new { r.Id, r.ReceiptNumber, r.ClientId, r.ClientName, date = Ymd(r.Date), r.Amount, r.Description, r.DivisionId, currency = "PKR" };
        }

        private async Task<Built> BuildWithholdingReceiptAsync(int companyId, JsonElement args)
        {
            var editId = OptId(args, "withholdingReceiptId");
            await Need(editId == null ? "withholdingtax.manage.create" : "withholdingtax.manage.update");
            var svc = Svc<IWithholdingTaxReceiptService>();
            var clientId = (await ClientInCompanyAsync(args, companyId))!.Value;
            var amount = ReqDec(args, "amount", 0m, 99_999_999_999m, 2, minInclusive: false);
            WithholdingTaxReceiptDto? existing = editId is int eid ? await OwnWithholdingAsync(companyId, eid) : null;
            var division = existing != null ? existing.DivisionId : OptId(args, "divisionId");
            if (existing == null) await AssertDivisionWriteAsync(companyId, division);
            var dto = new WithholdingTaxReceiptDto
            {
                CompanyId = companyId, ClientId = clientId, DivisionId = division, Amount = amount,
                Date = DateArg(args, "date") ?? existing?.Date ?? PakistanClock.Today, Description = OptText(args, "description", 500) ?? existing?.Description,
            };
            var name = await ClientNameAsync(clientId);
            var preview = new { clientId, clientName = name, divisionId = division, date = Ymd(dto.Date), amount, dto.Description, currency = "PKR" };
            if (existing != null)
                return new Built(EditPreview("withholding tax receipt", existing.Id, existing.ReceiptNumber, preview),
                    $"Update withholding tax receipt #{existing.ReceiptNumber} in company {companyId}: {amount:0.00} PKR",
                    async () =>
                    {
                        var r = await svc.UpdateAsync(existing.Id, dto) ?? throw new ToolError("The receipt no longer exists.");
                        return ($"WithholdingTaxReceipt:{r.Id}", $"Updated withholding tax receipt #{r.ReceiptNumber} (id {r.Id}), {r.Amount:0.00} PKR");
                    });
            return new Built(preview, $"Record a withholding tax receipt from \"{name}\" of {amount:0.00} PKR in company {companyId}",
                async () =>
                {
                    var r = await svc.CreateAsync(companyId, dto);
                    return ($"WithholdingTaxReceipt:{r.Id}", $"Recorded withholding tax receipt #{r.ReceiptNumber} (id {r.Id}), {r.Amount:0.00} PKR");
                });
        }

        // ── receipt allocation ─────────────────────────────────────────────

        private async Task<PaymentDto> OwnMoneyAsync(int companyId, int id, bool receipt)
        {
            var p = await Svc<IPaymentService>().GetByIdAsync(id);
            if (p == null || p.CompanyId != companyId || p.Direction != (receipt ? "Receipt" : "Payment")) throw new ToolError(Denied);
            await AssertDivisionReadAsync(companyId, p.DivisionId);
            return p;
        }

        private async Task<Built> BuildReceiptAllocationAsync(int companyId, JsonElement args)
        {
            await Need("accounting.receipts.create");
            var svc = Svc<IPaymentService>();
            var mode = OptText(args, "mode", 10);
            if (mode == "advances")
            {
                var clientId = (await ClientInCompanyAsync(args, companyId))!.Value;
                var name = await ClientNameAsync(clientId);
                return new Built(new { mode, clientId, clientName = name }, $"Apply every advance \"{name}\" holds to their outstanding bills in company {companyId}",
                    async () =>
                    {
                        var r = await svc.ApplyClientAdvancesAsync(companyId, clientId);
                        return ($"Advances:{companyId}:{clientId}", $"Applied advances for \"{name}\": " + JsonSerializer.Serialize(r));
                    });
            }
            var receipt = await OwnMoneyAsync(companyId, IdArg(args, "receiptId"), receipt: true);
            if (mode == "auto")
                return new Built(new { mode, receiptId = receipt.Id, receipt.Reference }, $"Auto-allocate receipt {receipt.Reference} to its customer's oldest bills in company {companyId}",
                    async () =>
                    {
                        var p = await svc.AutoAllocateAsync(receipt.Id) ?? throw new ToolError("The receipt no longer exists.");
                        return ($"Payment:{p.Id}", $"Allocated receipt {p.Reference}");
                    });
            if (mode != "lines") throw new ToolError("mode must be lines, auto or advances.");
            var lines = new List<CreatePaymentAllocationDto>();
            foreach (var l in Items(args, "lines", 1, 50))
            {
                var invoiceId = IdArg(l, "invoiceId");
                var inv = await _context.Invoices.AsNoTracking().Where(i => i.Id == invoiceId && i.CompanyId == companyId)
                    .Select(i => new { i.InvoiceNumber, i.ClientId, i.DivisionId, i.IsCancelled }).FirstOrDefaultAsync();
                if (inv == null || inv.ClientId != receipt.ContactId) throw new ToolError($"Bill {invoiceId} is not one of this customer's bills in this company.");
                await AssertDivisionReadAsync(companyId, inv.DivisionId);
                if (inv.IsCancelled) throw new ToolError($"Bill #{inv.InvoiceNumber} is cancelled.");
                if (lines.Any(x => x.InvoiceId == invoiceId)) throw new ToolError($"Bill #{inv.InvoiceNumber} is given twice.");
                lines.Add(new CreatePaymentAllocationDto { Kind = "Document", InvoiceId = invoiceId, Amount = ReqDec(l, "amount", 0m, 99_999_999_999m, 2, minInclusive: false) });
            }
            return new Built(new { mode, receiptId = receipt.Id, receipt.Reference, lines = lines.Select(x => new { x.InvoiceId, x.Amount }), total = lines.Sum(x => x.Amount), currency = "PKR" },
                $"Apply {lines.Sum(x => x.Amount):0.00} PKR of receipt {receipt.Reference} to {lines.Count} bill(s) in company {companyId}",
                async () =>
                {
                    var p = await svc.AllocateAsync(receipt.Id, lines) ?? throw new ToolError("The receipt no longer exists.");
                    return ($"Payment:{p.Id}", $"Allocated receipt {p.Reference}");
                });
        }

        // ── single records ─────────────────────────────────────────────────

        private async Task<object> GetMoneyAsync(JsonElement args, bool receipt)
        {
            await Need(receipt ? "accounting.receipts.view" : "accounting.payments.view");
            var companyId = await CompanyArg(args);
            return await OwnMoneyAsync(companyId, IdArg(args, receipt ? "receiptId" : "paymentId"), receipt);
        }

        private async Task<object> GetGoodsReceiptAsync(JsonElement args)
        {
            await Need("goodsreceipts.list.view");
            var companyId = await CompanyArg(args);
            var g = await Svc<IGoodsReceiptService>().GetByIdAsync(IdArg(args, "goodsReceiptId"));
            if (g == null || g.CompanyId != companyId) throw new ToolError(Denied);
            await AssertDivisionReadAsync(companyId, g.DivisionId);
            return g;
        }

        private async Task<object> GetJournalEntryAsync(JsonElement args)
        {
            await Need("accounting.journal.view");
            var companyId = await CompanyArg(args);
            var je = await Svc<IJournalEntryService>().GetByIdAsync(IdArg(args, "journalEntryId"));
            if (je == null || je.CompanyId != companyId) throw new ToolError(Denied);
            await AssertDivisionReadAsync(companyId, je.DivisionId);
            return je;
        }
    }
}

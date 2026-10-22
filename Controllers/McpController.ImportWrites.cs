using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Write tools for purchases, money, import costing, stock and the ledger. Same contract as
    /// the sales writes: Build checks permission, division and ownership for ONE company, runs at
    /// prepare and again at commit, and the commit calls the screen's own service.
    ///
    /// GD costing, GD charges and corrections, claim months and opening balances are
    /// company-level inventory state: a division-restricted user is refused, as on the screens
    /// (policy D2). Deleting a GD, switching the costing method, restating FIFO to agent-supplied
    /// lines and reconciling stock are deliberately not offered. The one restatement offered is
    /// the late-GD fix, whose lines the server works out exactly as the Stock screen's button does
    /// (StockRestatementService, shared with the screen and the GD save).
    /// </summary>
    public partial class McpController
    {
        private const int MaxGdLines = 50;

        private void AddImportWriteTools(List<Tool> t)
        {
            var purchaseLine = new
            {
                type = "object", additionalProperties = false, required = new[] { "description", "quantity", "unitPrice" },
                properties = new { description = Str(500), quantity = new { type = "string" }, unit = Str(50), unitPrice = MoneyProp, itemTypeId = Int(), hsCode = Str(20) },
            };
            var gdLine = new
            {
                type = "object", additionalProperties = false,
                required = new[] { "description", "hsCode", "quantity", "assessedValue" },
                properties = new
                {
                    description = Str(500), hsCode = Str(20), quantity = new { type = "string" }, unit = Str(50),
                    claimMonth = Str(10, "yyyy-MM, the month this line's input tax is claimed; omit if not known."),
                    assessedValue = MoneyProp, customsDuty = MoneyProp, acd = MoneyProp, regulatoryDuty = MoneyProp, others = MoneyProp,
                    salesTaxRate = new { type = "string", description = "Percent." }, astRate = new { type = "string", description = "Percent." },
                    incomeTaxRate = new { type = "string", description = "Percent." }, addOnProfit = MoneyProp, sellingValue = MoneyProp,
                    leaveOut = new { type = "boolean" }, chosenOpeningStockBalanceId = Int("Pick one of the line's candidates from a previous plan."),
                    confirmNewStock = new { type = "boolean", description = "Required to create stock for a line that matches nothing on the books." },
                    asNewItem = new { type = "boolean" },
                },
            };
            t.AddRange(new Tool[]
            {
                new("prepare_purchase_bill", "Prepare a purchase bill from a supplier. Nothing is saved until commit_action.",
                    Obj(new
                    {
                        companyId = CompanyProp, supplierId = Int(), divisionId = DivisionProp, date = DateProp, supplierBillNumber = Str(100), supplierIRN = Str(100),
                        gstRate = new { type = "string", description = "Percent. Default 18." }, paymentTerms = Str(200),
                        items = new { type = "array", minItems = 1, maxItems = MaxDocLines, items = purchaseLine }, idempotencyKey = IdemProp,
                    }, "companyId", "supplierId", "items"),
                    Build: BuildPurchaseBillAsync, PerHour: 10, Noun: "purchase bills"),
                new("prepare_goods_receipt", "Prepare a goods receipt (goods in from a supplier, optionally against a purchase bill). Whole quantities. Nothing is saved until commit_action.",
                    Obj(new
                    {
                        companyId = CompanyProp, supplierId = Int(), divisionId = DivisionProp, receiptDate = DateProp, purchaseBillId = Int(), supplierChallanNumber = Str(100), site = Str(300),
                        items = new { type = "array", minItems = 1, maxItems = MaxDocLines, items = new { type = "object", additionalProperties = false, required = new[] { "description", "quantity", "unit" }, properties = new { description = Str(500), quantity = new { type = "integer", minimum = 1 }, unit = Str(50), itemTypeId = Int() } } },
                        idempotencyKey = IdemProp,
                    }, "companyId", "supplierId", "items"),
                    Build: BuildGoodsReceiptAsync, PerHour: 30, Noun: "goods receipts"),
                new("prepare_receipt", "Prepare a customer receipt (money in): settle bills with allocations, and any remainder stays on the customer's account as an advance. Nothing is saved until commit_action.",
                    Obj(new
                    {
                        companyId = CompanyProp, clientId = Int(), divisionId = DivisionProp, date = DateProp, amount = MoneyProp,
                        method = Str(50, "Cash, Cheque, Bank Transfer, Online ..."), bankAccountId = Int("A bank or cash account of this company (search_accounts)."),
                        description = Str(500),
                        allocations = new { type = "array", maxItems = 50, items = new { type = "object", additionalProperties = false, required = new[] { "invoiceId", "amount" }, properties = new { invoiceId = Int(), amount = MoneyProp } } },
                        idempotencyKey = IdemProp,
                    }, "companyId", "clientId", "amount"),
                    Build: (c, a) => BuildMoneyAsync(c, a, receipt: true), PerHour: 20, Noun: "receipts"),
                new("prepare_supplier_payment", "Prepare a supplier payment (money out): settle purchase bills with allocations; any remainder is an advance on the supplier's account. Nothing is saved until commit_action.",
                    Obj(new
                    {
                        companyId = CompanyProp, supplierId = Int(), divisionId = DivisionProp, date = DateProp, amount = MoneyProp,
                        method = Str(50), bankAccountId = Int(), description = Str(500),
                        allocations = new { type = "array", maxItems = 50, items = new { type = "object", additionalProperties = false, required = new[] { "purchaseBillId", "amount" }, properties = new { purchaseBillId = Int(), amount = MoneyProp } } },
                        idempotencyKey = IdemProp,
                    }, "companyId", "supplierId", "amount"),
                    Build: (c, a) => BuildMoneyAsync(c, a, receipt: false), PerHour: 20, Noun: "supplier payments"),
                new("prepare_gd_costing", "Prepare a hand-entered GD (customs consignment): every line goes through the same match and cost rules as the GD Costing screen. The plan lists each line's problems, matched stock and cost; fix problems, choose an item for an ambiguous line or leave it out, and confirm new stock explicitly. Nothing is saved until commit_action.",
                    Obj(new
                    {
                        companyId = CompanyProp, gdNumber = Str(100), gdDate = DateProp,
                        mode = new { type = "string", @enum = new[] { "backfill", "new-arrivals" }, description = "backfill (stock already on the books) or new-arrivals (goods arriving now)." },
                        lines = new { type = "array", minItems = 1, maxItems = MaxGdLines, items = gdLine }, idempotencyKey = IdemProp,
                    }, "companyId", "gdNumber", "gdDate", "lines"),
                    Build: BuildGdCostingAsync, PerHour: 5, Noun: "GD costings"),
                new("prepare_gd_charge", "Prepare adding a charge to a GD (freight, clearing, wharfage, demurrage, port, other), or removing one (chargeId). Charges spread over the GD's landed cost.",
                    Obj(new
                    {
                        companyId = CompanyProp, gdId = Int(), action = new { type = "string", @enum = new[] { "add", "remove" } },
                        kind = new { type = "string", @enum = ImportChargeKinds.All }, amount = MoneyProp, description = Str(300), paidTo = Str(200), chargeDate = DateProp,
                        chargeId = Int("For remove."), idempotencyKey = IdemProp,
                    }, "companyId", "gdId", "action"),
                    Build: BuildGdChargeAsync, PerHour: 20, Noun: "GD charge changes"),
                new("prepare_gd_line_correction", "Prepare a correction to ONE line of a recorded GD (quantity, values, duties, rates). Only the fields you pass change; a reason is required. Costs and the ledger are re-derived by the ERP.",
                    Obj(new
                    {
                        companyId = CompanyProp, gdId = Int(), lineId = Int("From get_gd."), reason = Str(300),
                        quantity = new { type = "string" }, assessedValue = MoneyProp, customsDuty = MoneyProp, acd = MoneyProp, regulatoryDuty = MoneyProp, others = MoneyProp,
                        salesTaxRate = new { type = "string" }, astRate = new { type = "string" }, incomeTaxRate = new { type = "string" }, addOnProfit = MoneyProp,
                        sellingValue = MoneyProp, descriptionOnSheet = Str(500), idempotencyKey = IdemProp,
                    }, "companyId", "gdId", "lineId", "reason"),
                    Build: BuildGdLineCorrectionAsync, PerHour: 20, Noun: "GD line corrections"),
                new("prepare_gd_claim_month", "Prepare the month a GD's input tax is claimed: for a whole GD (gdNumber), or for one line (lineId from get_gd, or lotId of an opening-stock lot). A line's month wins over the GD's. Give claimMonth as yyyy-MM, or null to clear.",
                    Obj(new { companyId = CompanyProp, gdNumber = Str(100), lineId = Int(), lotId = Int(), claimMonth = new { type = new[] { "string", "null" }, maxLength = 10 }, idempotencyKey = IdemProp }, "companyId"),
                    Build: BuildClaimMonthAsync, PerHour: 50, Noun: "claim month changes"),
                new("prepare_lc", "Prepare a letter of credit: create one, update one (lcId), or link a GD to an LC (action link: gdId plus lcId, or lcId null to unlink, and an optional bill of lading).",
                    Obj(new
                    {
                        companyId = CompanyProp, action = new { type = "string", @enum = new[] { "create", "update", "link" } }, lcId = new { type = new[] { "integer", "null" }, minimum = 1 },
                        lcNumber = Str(60), bankName = Str(120), supplierName = Str(200), currency = Str(10), foreignAmount = new { type = "string" }, exchangeRate = new { type = "string" },
                        openedOn = DateProp, expiresOn = DateProp, status = new { type = "string", @enum = new[] { "open", "closed" } }, notes = Str(500),
                        gdId = Int(), blNumber = Str(60), idempotencyKey = IdemProp,
                    }, "companyId", "action"),
                    Build: BuildLcAsync, PerHour: 20, Noun: "LC changes"),
                new("prepare_opening_stock", "Prepare an item's opening balance (one per item; an existing one is replaced, and the plan shows the before and after). Posts the value change to Inventory and re-prices later sales when committed.",
                    Obj(new
                    {
                        companyId = CompanyProp, itemTypeId = Int(), quantity = new { type = "string" }, valueExcludingTax = MoneyProp,
                        salesTaxRate = new { type = "string", description = "Percent." }, actualCostExcludingTax = MoneyProp, asOfDate = DateProp, notes = Str(500), idempotencyKey = IdemProp,
                    }, "companyId", "itemTypeId", "quantity", "valueExcludingTax", "salesTaxRate", "asOfDate"),
                    Build: BuildOpeningStockAsync, PerHour: 30, Noun: "opening balances"),
                new("prepare_journal_entry", "Prepare a manual journal entry: at least two lines, each a debit OR a credit to one of this company's accounts (search_accounts), debits equal to credits. Nothing is saved until commit_action.",
                    Obj(new
                    {
                        companyId = CompanyProp, date = DateProp, narration = Str(500), divisionId = DivisionProp,
                        lines = new { type = "array", minItems = 2, maxItems = MaxDocLines, items = new { type = "object", additionalProperties = false, required = new[] { "accountId" }, properties = new { accountId = Int(), debit = MoneyProp, credit = MoneyProp, description = Str(300) } } },
                        idempotencyKey = IdemProp,
                    }, "companyId", "date", "lines"),
                    Build: BuildJournalAsync, PerHour: 10, Noun: "journal entries"),
                new("find_late_gd_value_fixes", "Items whose stock VALUE is off because a GD dated on or before their last stock-sheet match or value correction was entered after it. Quantities are right. Fix with prepare_late_gd_value_fix.",
                    Obj(new { companyId = CompanyProp }, "companyId"), Read: FindLateGdFixesAsync),
                new("prepare_late_gd_value_fix", "Prepare putting right the value of every item find_late_gd_value_fixes lists: each is restated on its match or correction date with the late GD lines added, worked out by the ERP. Quantities never change. Nothing is saved until commit_action.",
                    Obj(new { companyId = CompanyProp, idempotencyKey = IdemProp }, "companyId"),
                    Build: BuildLateGdFixAsync, PerHour: 5, Noun: "late GD value fixes"),
            });
        }

        // ── late GD value fix ──────────────────────────────────────────────

        /// <summary>The late-GD service the Stock screen and the GD save use; its refusals become tool errors.</summary>
        private async Task<T> LateGd<T>(Func<StockRestatementService, Task<T>> run)
        {
            try { return await run(Svc<StockRestatementService>()); }
            catch (StockRestatementRefusedException ex) { throw new ToolError(ex.Message); }
        }

        private async Task<object> FindLateGdFixesAsync(JsonElement args)
        {
            await Need("stock.policy.manage");
            var companyId = await CompanyArg(args);
            await AssertDivisionWriteAsync(companyId, null);
            var plan = await LateGd(svc => svc.PlanLateGdsAsync(companyId, CurrentUserId));
            return new
            {
                totalCount = plan.Affected.Count,
                items = plan.Affected.Select(a => new
                {
                    a.ItemTypeId, itemTypeName = plan.Items.FirstOrDefault(i => i.ItemTypeId == a.ItemTypeId)?.ItemTypeName ?? "",
                    anchor = a.Restatement.IsSheetMatch ? "stock-sheet match" : "value correction", anchorDate = Ymd(a.Restatement.Date),
                    lateGds = a.Lines.Select(l => new { l.GdNumber, gdDate = Ymd(l.GdDate), l.Quantity, l.ValueExcludingTax }),
                }),
                currency = "PKR",
            };
        }

        private async Task<Built> BuildLateGdFixAsync(int companyId, JsonElement args)
        {
            await Need("stock.policy.manage");
            await AssertDivisionWriteAsync(companyId, null);
            var plan = await LateGd(svc => svc.RestateLateGdsAsync(companyId, CurrentUserId, null, commit: false));
            if (plan.Items.Count == 0) throw new ToolError("Nothing to fix: every item is already valued with its late GDs.");
            if (!plan.CanCommit)
                throw new ToolError(string.Join("; ", plan.Items.Where(i => i.Error != null).Select(i => $"{i.ItemTypeName}: {i.Error}")));
            var preview = new
            {
                items = plan.Items.Select(i => new { i.ItemTypeId, i.ItemTypeName, i.OnHand, valueNow = i.FifoValue, valueAfter = i.SheetValue }),
                valueBefore = plan.ValueBefore, valueAfter = plan.ValueAfter, quantitiesChange = false, currency = "PKR",
            };
            return new Built(preview,
                $"Add late GDs to {plan.Items.Count} item(s) in company {companyId}: value {plan.ValueBefore:N2} -> {plan.ValueAfter:N2}",
                async () =>
                {
                    var done = await LateGd(svc => svc.RestateLateGdsAsync(companyId, CurrentUserId, User.Identity?.Name, commit: true));
                    if (!done.Committed) throw new ToolError(done.Messages.FirstOrDefault() ?? "The late GD fix was not applied.");
                    return ($"LateGdFix:{companyId}", done.Messages.FirstOrDefault() ?? "Late GDs added.");
                });
        }

        // ── purchases ──────────────────────────────────────────────────────

        private async Task<string> SupplierNameAsync(int supplierId) =>
            await _context.Suppliers.AsNoTracking().Where(s => s.Id == supplierId).Select(s => s.Name).FirstAsync();

        private async Task<Built> BuildPurchaseBillAsync(int companyId, JsonElement args)
        {
            await Need("purchasebills.manage.create");
            var supplierId = (await SupplierInCompanyAsync(args, companyId))!.Value;
            var division = OptId(args, "divisionId");
            await AssertDivisionWriteAsync(companyId, division);
            var items = new List<CreatePurchaseItemDto>();
            foreach (var it in Items(args, "items", 1, MaxDocLines))
            {
                var desc = OptText(it, "description", 500);
                if (string.IsNullOrEmpty(desc)) throw new ToolError("Item descriptions cannot be empty.");
                items.Add(new CreatePurchaseItemDto
                {
                    Description = desc, Quantity = ReqDec(it, "quantity", 0m, 999_999_999m, 4, minInclusive: false), UOM = OptText(it, "unit", 50),
                    UnitPrice = ReqDec(it, "unitPrice", 0m, 999_999_999m, 4, minInclusive: false), ItemTypeId = await ItemInCompanyAsync(it, "itemTypeId", companyId),
                    HSCode = OptText(it, "hsCode", 20) is { Length: > 0 } hs ? hs : null,
                });
            }
            if (items.Any(i => i.ItemTypeId == null)) throw new ToolError("Every purchase-bill line needs an itemTypeId (search_item_types).");
            var dto = new CreatePurchaseBillDto
            {
                CompanyId = companyId, DivisionId = division, SupplierId = supplierId, Date = DateArg(args, "date") ?? PakistanClock.Today,
                SupplierBillNumber = OptText(args, "supplierBillNumber", 100), SupplierIRN = OptText(args, "supplierIRN", 100),
                GSTRate = Gst(args), PaymentTerms = OptText(args, "paymentTerms", 200), Items = items,
            };
            var name = await SupplierNameAsync(supplierId);
            var subtotal = Math.Round(items.Sum(i => i.Quantity * i.UnitPrice), 2, MidpointRounding.AwayFromZero);
            var preview = new { supplierId, supplierName = name, divisionId = division, date = Ymd(dto.Date), dto.SupplierBillNumber, gstRate = dto.GSTRate,
                items = items.Select(i => new { i.Description, i.Quantity, unit = i.UOM, i.UnitPrice, i.ItemTypeId, hsCode = i.HSCode }), subtotalAbout = subtotal, currency = "PKR" };
            return new Built(preview, $"Record a purchase bill from \"{name}\" in company {companyId}: {items.Count} line(s), subtotal about {subtotal:0.00} PKR, GST {dto.GSTRate}%",
                async () =>
                {
                    var b = await Svc<IPurchaseBillService>().CreateAsync(dto);
                    return ($"PurchaseBill:{b.Id}", $"Recorded purchase bill #{b.PurchaseBillNumber} (id {b.Id}) from \"{b.SupplierName}\", total {b.GrandTotal:0.00} PKR");
                });
        }

        private async Task<Built> BuildGoodsReceiptAsync(int companyId, JsonElement args)
        {
            await Need("goodsreceipts.manage.create");
            var supplierId = (await SupplierInCompanyAsync(args, companyId))!.Value;
            var division = OptId(args, "divisionId");
            await AssertDivisionWriteAsync(companyId, division);
            var billId = OptId(args, "purchaseBillId");
            if (billId is int b && !await _context.PurchaseBills.AsNoTracking().AnyAsync(x => x.Id == b && x.CompanyId == companyId && x.SupplierId == supplierId))
                throw new ToolError("That purchase bill is not one of this supplier's in this company.");
            var items = new List<CreateGoodsReceiptItemDto>();
            foreach (var it in Items(args, "items", 1, MaxDocLines))
            {
                var desc = OptText(it, "description", 500);
                var unit = OptText(it, "unit", 50);
                if (string.IsNullOrEmpty(desc) || string.IsNullOrEmpty(unit)) throw new ToolError("Each item needs a description and a unit.");
                var qty = IntArg(it, "quantity") is int q and > 0 ? q : throw new ToolError("Goods receipt quantities are whole numbers above 0.");
                items.Add(new CreateGoodsReceiptItemDto { Description = desc, Quantity = qty, Unit = unit, ItemTypeId = await ItemInCompanyAsync(it, "itemTypeId", companyId) });
            }
            var dto = new CreateGoodsReceiptDto
            {
                CompanyId = companyId, DivisionId = division, SupplierId = supplierId, PurchaseBillId = billId, ReceiptDate = DateArg(args, "receiptDate") ?? PakistanClock.Today,
                SupplierChallanNumber = OptText(args, "supplierChallanNumber", 100), Site = OptText(args, "site", 300), Items = items,
            };
            var name = await SupplierNameAsync(supplierId);
            var preview = new { supplierId, supplierName = name, divisionId = division, receiptDate = Ymd(dto.ReceiptDate), purchaseBillId = billId, dto.SupplierChallanNumber,
                items = items.Select(i => new { i.Description, i.Quantity, i.Unit, i.ItemTypeId }) };
            return new Built(preview, $"Record a goods receipt from \"{name}\" in company {companyId}: {items.Count} line(s)",
                async () =>
                {
                    var g = await Svc<IGoodsReceiptService>().CreateAsync(dto);
                    return ($"GoodsReceipt:{g.Id}", $"Recorded goods receipt #{g.GoodsReceiptNumber} (id {g.Id}) from \"{g.SupplierName}\"");
                });
        }

        // ── receipts and payments ──────────────────────────────────────────

        private async Task<Built> BuildMoneyAsync(int companyId, JsonElement args, bool receipt)
        {
            await Need(receipt ? "accounting.receipts.create" : "accounting.payments.create");
            var partyId = receipt ? (await ClientInCompanyAsync(args, companyId))!.Value : (await SupplierInCompanyAsync(args, companyId))!.Value;
            var division = OptId(args, "divisionId");
            await AssertDivisionWriteAsync(companyId, division);
            var amount = ReqDec(args, "amount", 0m, 99_999_999_999m, 2, minInclusive: false);
            var bank = OptId(args, "bankAccountId");
            if (bank is int ba && !await _context.Accounts.AsNoTracking().AnyAsync(a => a.Id == ba && a.CompanyId == companyId && a.IsActive))
                throw new ToolError("That bank or cash account is not one of this company's.");
            var allocations = new List<CreatePaymentAllocationDto>();
            var shown = new List<object>();
            if (Has(args, "allocations"))
                foreach (var a in Items(args, "allocations", 0, 50))
                {
                    var cash = ReqDec(a, "amount", 0m, 99_999_999_999m, 2, minInclusive: false);
                    if (receipt)
                    {
                        var invoiceId = IdArg(a, "invoiceId");
                        var inv = await _context.Invoices.AsNoTracking().Where(i => i.Id == invoiceId && i.CompanyId == companyId)
                            .Select(i => new { i.Id, i.InvoiceNumber, i.ClientId, i.DivisionId, i.IsCancelled }).FirstOrDefaultAsync();
                        if (inv == null || inv.ClientId != partyId) throw new ToolError($"Bill {invoiceId} is not one of this customer's bills in this company.");
                        await AssertDivisionReadAsync(companyId, inv.DivisionId);
                        if (inv.IsCancelled) throw new ToolError($"Bill #{inv.InvoiceNumber} is cancelled.");
                        if (allocations.Any(x => x.InvoiceId == invoiceId)) throw new ToolError($"Bill #{inv.InvoiceNumber} is allocated twice.");
                        allocations.Add(new CreatePaymentAllocationDto { Kind = "Document", InvoiceId = invoiceId, Amount = cash });
                        shown.Add(new { invoiceId, inv.InvoiceNumber, amount = cash });
                    }
                    else
                    {
                        var billId = IdArg(a, "purchaseBillId");
                        var bill = await _context.PurchaseBills.AsNoTracking().Where(i => i.Id == billId && i.CompanyId == companyId)
                            .Select(i => new { i.Id, i.PurchaseBillNumber, i.SupplierId, i.DivisionId }).FirstOrDefaultAsync();
                        if (bill == null || bill.SupplierId != partyId) throw new ToolError($"Purchase bill {billId} is not one of this supplier's in this company.");
                        await AssertDivisionReadAsync(companyId, bill.DivisionId);
                        if (allocations.Any(x => x.PurchaseBillId == billId)) throw new ToolError($"Purchase bill #{bill.PurchaseBillNumber} is allocated twice.");
                        allocations.Add(new CreatePaymentAllocationDto { Kind = "Document", PurchaseBillId = billId, Amount = cash });
                        shown.Add(new { purchaseBillId = billId, bill.PurchaseBillNumber, amount = cash });
                    }
                }
            var applied = allocations.Sum(x => x.Amount);
            if (applied > amount) throw new ToolError($"Allocations apply {applied:0.00}, which is more than the amount {amount:0.00}.");
            var onAccount = amount - applied;
            // A receipt records an advance as its implicit remainder; money out needs an explicit line.
            if (!receipt && onAccount > 0) allocations.Add(new CreatePaymentAllocationDto { Kind = "OnAccount", Amount = onAccount });
            var dto = new CreatePaymentDto
            {
                Direction = receipt ? "Receipt" : "Payment", Date = DateArg(args, "date") ?? PakistanClock.Today,
                ContactType = receipt ? "Client" : "Supplier", ContactId = partyId, DivisionId = division, BankAccountId = bank,
                Method = OptText(args, "method", 50) is { Length: > 0 } m ? m : "Cash", Description = OptText(args, "description", 500),
                Amount = amount, Allocations = allocations,
            };
            var name = receipt ? await ClientNameAsync(partyId) : await SupplierNameAsync(partyId);
            var preview = new { direction = dto.Direction, partyId, partyName = name, divisionId = division, date = Ymd(dto.Date), amount, dto.Method, bankAccountId = bank,
                allocations = shown, onAccount, currency = "PKR" };
            var what = receipt ? "receipt from" : "payment to";
            return new Built(preview, $"Record a {what} \"{name}\" of {amount:0.00} PKR in company {companyId}: {shown.Count} document(s) settled, {onAccount:0.00} on account",
                async () =>
                {
                    var p = await Svc<IPaymentService>().CreateAsync(companyId, dto);
                    return ($"Payment:{p.Id}", $"Recorded {(receipt ? "receipt" : "payment")} {p.Reference} (id {p.Id}) of {p.Amount:0.00} PKR");
                });
        }

        // ── GD costing ─────────────────────────────────────────────────────

        private static DateTime? MonthArg(JsonElement args, string name)
        {
            var s = OptText(args, name, 10);
            if (string.IsNullOrEmpty(s)) return null;
            var formats = new[] { "yyyy-MM", "yyyy-MM-dd" };
            if (!DateTime.TryParseExact(s, formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d))
                throw new ToolError($"{name} must be yyyy-MM.");
            if (d.Day != 1) throw new ToolError("A claim month is the first day of a month.");
            return d;
        }

        private async Task<Built> BuildGdCostingAsync(int companyId, JsonElement args)
        {
            await Need("importcosting.sheet.run");
            await AssertDivisionWriteAsync(companyId, null);
            var gdNumber = OptText(args, "gdNumber", 100) is { Length: > 0 } g ? g : throw new ToolError("gdNumber is required.");
            var gdDate = DateArg(args, "gdDate") ?? throw new ToolError("gdDate is required.");
            var mode = GdCostingImportModeNames.Normalize(OptText(args, "mode", 20));
            var lines = new List<GdCostingManualLineDto>();
            var row = 0;
            foreach (var l in Items(args, "lines", 1, MaxGdLines))
            {
                row++;
                decimal Money(string n) => OptDec(l, n, 0m, 99_999_999_999m, 2) ?? 0m;
                decimal Rate(string n) => OptDec(l, n, 0m, 100m, 4) ?? 0m;
                var chosen = OptId(l, "chosenOpeningStockBalanceId");
                if (chosen is int bal && !await _context.OpeningStockBalances.AsNoTracking().AnyAsync(o => o.Id == bal && o.CompanyId == companyId))
                    throw new ToolError($"Line {row}: that opening balance is not one of this company's.");
                lines.Add(new GdCostingManualLineDto
                {
                    SourceRow = row, GdNumber = gdNumber, GdDate = gdDate, ClaimMonth = MonthArg(l, "claimMonth"),
                    Description = OptText(l, "description", 500) ?? "", HsCode = OptText(l, "hsCode", 20) ?? "",
                    Quantity = ReqDec(l, "quantity", 0m, 999_999_999m, 4), Unit = OptText(l, "unit", 50),
                    AssessedValue = Money("assessedValue"), CustomsDuty = Money("customsDuty"), Acd = Money("acd"), RegulatoryDuty = Money("regulatoryDuty"),
                    Others = Money("others"), SalesTaxRate = Rate("salesTaxRate"), AstRate = Rate("astRate"), IncomeTaxRate = Rate("incomeTaxRate"),
                    AddOnProfit = Money("addOnProfit"), SellingValue = OptDec(l, "sellingValue", 0m, 99_999_999_999m, 2),
                    LeaveOut = OptBool(l, "leaveOut"), ChosenOpeningStockBalanceId = chosen, ConfirmNewStock = OptBool(l, "confirmNewStock"), AsNewItem = OptBool(l, "asNewItem"),
                });
            }
            var costing = Svc<IGdCostingImportService>();
            GdCostingPreviewDto pv;
            try { pv = await costing.PreviewManualAsync(lines, companyId, mode); }
            catch (InvalidOperationException ex) { throw new ToolError(ex.Message); }

            // The screen's own checklist (gdCostingEntry.js entryChecklist), applied here so a
            // plan can only be stored when the screen would let the person press Import.
            var problems = new List<string>(pv.BlockingErrors);
            foreach (var l in pv.Lines.Where(l => !l.LeaveOut))
            {
                if (l.Problems.FirstOrDefault() is { } first) problems.Add($"Row {l.SourceRow}: {first.Message}");
                else if (l.Disposition == GdCostingDispositionNames.Ambiguous) problems.Add($"Row {l.SourceRow}: choose the item (chosenOpeningStockBalanceId from candidates), or leave the line out.");
                else if (l.Disposition == GdCostingDispositionNames.StockPosted && !l.ConfirmNewStock) problems.Add($"Row {l.SourceRow}: not on the books. Confirm it as new stock (confirmNewStock), or leave it out.");
            }
            if (pv.Lines.Count > 0 && pv.Lines.All(l => l.LeaveOut)) problems.Add("Every line is left out: include at least one.");
            var preview = new
            {
                gdNumber, gdDate = Ymd(gdDate), mode, canImport = problems.Count == 0 && pv.CanCommit, problems,
                warnings = pv.Warnings, dispositions = pv.DispositionCounts,
                totals = pv.Consignments.Select(c => new { c.GdNumber, c.LineCount, c.TotalCostExcludingTax, c.TotalSalesTax, c.TotalAst, c.TotalIncomeTax, c.TotalInputTax, c.TotalSellingValue }),
                lines = pv.Lines.Select(l => new
                {
                    l.SourceRow, l.Description, l.HsCode, l.Quantity, l.Unit, claimMonth = Ymd(l.ClaimMonth), l.Disposition, l.LeaveOut, l.ConfirmNewStock,
                    l.ItemTypeId, l.ItemTypeName, l.OpeningStockBalanceId, l.Cost, l.SalesTax, l.InputTax, l.SellingValue,
                    l.MatchNote, l.OverwriteWarning, l.CostPlausibilityWarning, l.RateWarning,
                    problems = l.Problems.Select(p => p.Message),
                    candidates = l.Candidates.Select(c => new { c.OpeningStockBalanceId, c.ItemTypeId, c.ItemTypeName, c.Quantity }),
                }),
                currency = "PKR",
            };
            if (problems.Count > 0)
            {
                // Nothing to approve yet: hand the review back so the agent fixes it and prepares again.
                var review = JsonSerializer.Serialize(preview.lines.Where(l => !l.LeaveOut && (l.problems.Any() || l.candidates.Any() || l.Disposition != GdCostingDispositionNames.CostOnly)).Take(15), Json);
                throw new ToolError("The GD is not ready to import: " + string.Join(" | ", problems.Take(8)) + " Lines to review: " + Trunc(review, 3000));
            }
            var total = pv.Consignments.Sum(c => c.TotalCostExcludingTax);
            return new Built(preview, $"Import GD {gdNumber} ({Ymd(gdDate)}, {mode}) into company {companyId}: {pv.Lines.Count(l => !l.LeaveOut)} line(s), cost {total:0.00} PKR excl. tax",
                async () =>
                {
                    var r = await costing.CommitAsync(new GdCostingCommitDto
                    {
                        CompanyId = companyId, FileSha256 = pv.FileSha256, FileName = pv.FileName, FileSizeBytes = pv.FileSizeBytes,
                        ImportProfileId = pv.ImportProfileId, ProfileVersion = pv.ProfileVersion, Lines = pv.Lines, CreateMissingStock = true, Mode = mode,
                    }, CurrentUserId);
                    var gdId = await _context.ImportConsignments.AsNoTracking().Where(c => c.CompanyId == companyId && c.GdNumber == gdNumber)
                        .OrderByDescending(c => c.Id).Select(c => c.Id).FirstOrDefaultAsync();
                    return ($"ImportConsignment:{gdId}", $"Imported GD {gdNumber}: {r.LinesWritten} line(s), {r.BalancesCosted} balance(s) costed, cost {r.TotalCostExcludingTax:0.00} PKR (run {r.ImportRunId})");
                });
        }

        private async Task<Built> BuildGdChargeAsync(int companyId, JsonElement args)
        {
            await Need("importcosting.sheet.run");
            // GD charges cover the whole GD, so they need access to every division (the screen's rule).
            await RequireWholeCompanyAsync(companyId, "A GD charge");
            var gd = await OwnGdAsync(companyId, IdArg(args, "gdId"));
            var service = Svc<IImportConsignmentService>();
            var action = OptText(args, "action", 10);
            if (action == "remove")
            {
                var chargeId = IdArg(args, "chargeId");
                var charge = (await service.GetChargesAsync(gd.Id)).FirstOrDefault(c => c.Id == chargeId)
                    ?? throw new ToolError("That charge is not on this GD.");
                var preview0 = new { gdId = gd.Id, gd.GdNumber, action, chargeId, charge.Kind, charge.Amount, charge.Description };
                return new Built(preview0, $"Remove the {charge.Kind} charge of {charge.Amount:0.00} PKR from GD {gd.GdNumber} in company {companyId}",
                    async () =>
                    {
                        var r = await service.DeleteChargeAsync(gd.Id, chargeId);
                        return ($"ImportConsignment:{gd.Id}", $"Removed a charge from GD {gd.GdNumber}; charges now {r.TotalCharges:0.00} PKR");
                    });
            }
            if (action != "add") throw new ToolError("action must be add or remove.");
            var kind = ImportChargeKinds.Normalize(OptText(args, "kind", 20)) ?? throw new ToolError("kind must be one of: " + string.Join(", ", ImportChargeKinds.All) + ".");
            var dto = new CreateImportConsignmentChargeDto
            {
                Kind = kind, Amount = ReqDec(args, "amount", 0m, 99_999_999_999m, 2, minInclusive: false), Description = OptText(args, "description", 300),
                PaidTo = OptText(args, "paidTo", 200), ChargeDate = DateArg(args, "chargeDate"),
            };
            var preview = new { gdId = gd.Id, gd.GdNumber, action, dto.Kind, dto.Amount, dto.Description, dto.PaidTo, chargeDate = Ymd(dto.ChargeDate), chargesNow = gd.TotalCharges, currency = "PKR" };
            return new Built(preview, $"Add a {kind} charge of {dto.Amount:0.00} PKR to GD {gd.GdNumber} in company {companyId}",
                async () =>
                {
                    var r = await service.AddChargeAsync(gd.Id, dto);
                    return ($"ImportConsignment:{gd.Id}", $"Added a {kind} charge to GD {gd.GdNumber}; charges now {r.TotalCharges:0.00} PKR, landed cost {r.LandedCostWithCharges:0.00} PKR");
                });
        }

        private async Task<Built> BuildGdLineCorrectionAsync(int companyId, JsonElement args)
        {
            await Need("importcosting.sheet.run");
            await AssertDivisionWriteAsync(companyId, null);
            var gd = await OwnGdAsync(companyId, IdArg(args, "gdId"));
            var lineId = IdArg(args, "lineId");
            var line = gd.Lines.FirstOrDefault(l => l.Id == lineId) ?? throw new ToolError("That line is not on this GD.");
            var reason = OptText(args, "reason", 300) is { Length: > 0 } r0 ? r0 : throw new ToolError("reason is required.");
            decimal Money(string n, decimal current) => OptDec(args, n, 0m, 99_999_999_999m, 2) ?? current;
            decimal Rate(string n, decimal current) => OptDec(args, n, 0m, 100m, 4) ?? current;
            var dto = new UpdateImportConsignmentLineDto
            {
                Quantity = OptDec(args, "quantity", 0m, 999_999_999m, 4) ?? line.Quantity,
                AssessedValue = Money("assessedValue", line.AssessedValue), CustomsDuty = Money("customsDuty", line.CustomsDuty), Acd = Money("acd", line.Acd),
                RegulatoryDuty = Money("regulatoryDuty", line.RegulatoryDuty), Others = Money("others", line.Others),
                SalesTaxRate = Rate("salesTaxRate", line.SalesTaxRate), AstRate = Rate("astRate", line.AstRate), IncomeTaxRate = Rate("incomeTaxRate", line.IncomeTaxRate),
                AddOnProfit = Money("addOnProfit", line.AddOnProfit),
                SellingValueExcludingTax = OptDec(args, "sellingValue", 0m, 99_999_999_999m, 2),
                DescriptionOnSheet = OptText(args, "descriptionOnSheet", 500) ?? line.DescriptionOnSheet, Reason = reason,
            };
            var preview = new
            {
                gdId = gd.Id, gd.GdNumber, lineId, line.SourceRow, reason,
                before = new { line.Quantity, line.AssessedValue, line.CustomsDuty, line.Acd, line.RegulatoryDuty, line.Others, line.SalesTaxRate, line.AstRate, line.IncomeTaxRate, line.AddOnProfit, line.CostExcludingTax, line.SellingValueExcludingTax, line.DescriptionOnSheet },
                after = new { dto.Quantity, dto.AssessedValue, dto.CustomsDuty, dto.Acd, dto.RegulatoryDuty, dto.Others, dto.SalesTaxRate, dto.AstRate, dto.IncomeTaxRate, dto.AddOnProfit, sellingValue = dto.SellingValueExcludingTax, dto.DescriptionOnSheet },
                note = "The ERP re-derives cost, the opening balances it fed and the GD's journal entry when committed.",
            };
            return new Built(preview, $"Correct row {line.SourceRow} of GD {gd.GdNumber} in company {companyId}: {reason}",
                async () =>
                {
                    var r = await Svc<IImportConsignmentService>().UpdateLineAsync(gd.Id, lineId, dto, CurrentUserId);
                    return ($"ImportConsignment:{gd.Id}", $"Corrected row {line.SourceRow} of GD {r.GdNumber}: cost {r.OldCostExcludingTax:0.00} -> {r.NewCostExcludingTax:0.00} PKR, {r.BalancesUpdated} balance(s) updated");
                });
        }

        private async Task<Built> BuildClaimMonthAsync(int companyId, JsonElement args)
        {
            await Need("stock.opening.manage");
            // A claim month changes company-level costing (FIFO order): policy D2, as on the screen.
            await AssertDivisionWriteAsync(companyId, null);
            if (args.ValueKind != JsonValueKind.Object || !args.TryGetProperty("claimMonth", out _)) throw new ToolError("claimMonth is required (null clears it).");
            var month = MonthArg(args, "claimMonth");
            var gdNumber = OptText(args, "gdNumber", 100) is { Length: > 0 } g ? g : null;
            var lineId = OptId(args, "lineId");
            var lotId = OptId(args, "lotId");
            if (new object?[] { gdNumber, lineId, lotId }.Count(x => x != null) != 1) throw new ToolError("Give exactly one of gdNumber, lineId or lotId.");
            var records = Svc<StockRecordService>();
            string target; DateTime? before;
            if (gdNumber != null)
            {
                var known = await _context.ImportConsignments.AsNoTracking().AnyAsync(c => c.CompanyId == companyId && c.GdNumber == gdNumber)
                    || await _context.OpeningStockLots.AsNoTracking().AnyAsync(l => l.OpeningStockBalance.CompanyId == companyId && l.LotRef == gdNumber);
                if (!known) throw new ToolError("This company has no stock GD with that number.");
                before = await _context.GdClaimPeriods.AsNoTracking().Where(x => x.CompanyId == companyId && x.GdNumber == gdNumber).Select(x => (DateTime?)x.ClaimMonth).FirstOrDefaultAsync();
                target = $"GD {gdNumber}";
            }
            else if (lineId != null)
            {
                var l = await _context.ImportConsignmentLines.AsNoTracking().Where(x => x.Id == lineId && x.ImportConsignment.CompanyId == companyId)
                    .Select(x => new { x.ClaimMonth, x.SourceRow, x.ImportConsignment.GdNumber }).FirstOrDefaultAsync() ?? throw new ToolError("This company has no such stock line.");
                before = l.ClaimMonth; target = $"GD {l.GdNumber} row {l.SourceRow}";
            }
            else
            {
                var l = await _context.OpeningStockLots.AsNoTracking().Where(x => x.Id == lotId && x.OpeningStockBalance.CompanyId == companyId)
                    .Select(x => new { x.ClaimMonth, x.SourceRow, x.LotRef }).FirstOrDefaultAsync() ?? throw new ToolError("This company has no such stock line.");
                before = l.ClaimMonth; target = $"opening lot {l.LotRef} row {l.SourceRow}";
            }
            var preview = new { target, gdNumber, lineId, lotId, before = before?.ToString("yyyy-MM"), after = month?.ToString("yyyy-MM") };
            return new Built(preview, $"Set the claim month of {target} in company {companyId} to {(month?.ToString("yyyy-MM") ?? "none")}",
                async () =>
                {
                    if (gdNumber != null) await records.SetGdClaimMonthAsync(companyId, gdNumber, month, User.Identity?.Name);
                    else await records.SetLineClaimMonthAsync(companyId, lotId, lineId, month, User.Identity?.Name);
                    return ($"ClaimMonth:{companyId}", $"Claim month of {target} {(month == null ? "cleared" : "set to " + month.Value.ToString("yyyy-MM"))}");
                });
        }

        // ── letters of credit ──────────────────────────────────────────────

        private async Task<Built> BuildLcAsync(int companyId, JsonElement args)
        {
            await Need("importcosting.lc.manage");
            var lcs = Svc<ImportLcService>();
            var action = OptText(args, "action", 10);
            if (action == "link")
            {
                var gd = await OwnGdAsync(companyId, IdArg(args, "gdId"));
                int? lcId = Has(args, "lcId") ? IdArg(args, "lcId") : null;
                if (lcId is int id && await lcs.CompanyOfAsync(id) != companyId) throw new ToolError("That LC is not one of this company's.");
                var link = new ImportLcLinkDto { LcId = lcId, BlNumber = OptText(args, "blNumber", 60) ?? gd.BlNumber };
                var preview0 = new { action, gdId = gd.Id, gd.GdNumber, lcBefore = gd.ImportLcId, lcAfter = lcId, blNumber = link.BlNumber };
                return new Built(preview0, lcId == null ? $"Unlink GD {gd.GdNumber} from its LC in company {companyId}" : $"Link GD {gd.GdNumber} to LC #{lcId} in company {companyId}",
                    async () =>
                    {
                        var (cid, lc, bl) = await lcs.LinkAsync(gd.Id, link);
                        return ($"ImportConsignment:{cid}", $"GD {gd.GdNumber} is now {(lc == null ? "not linked to an LC" : $"linked to LC #{lc}")}");
                    });
            }
            ImportLcDto dto;
            int? existingId = null;
            if (action == "update")
            {
                existingId = IdArg(args, "lcId");
                if (await lcs.CompanyOfAsync(existingId.Value) != companyId) throw new ToolError(Denied);
                dto = (await lcs.ListAsync(companyId)).First(l => l.Id == existingId);
            }
            else if (action == "create") dto = new ImportLcDto();
            else throw new ToolError("action must be create, update or link.");
            if (OptText(args, "lcNumber", 60) is { } n) dto.LcNumber = n;
            if (OptText(args, "bankName", 120) is { } bn) dto.BankName = bn;
            if (OptText(args, "supplierName", 200) is { } sn) dto.SupplierName = sn;
            if (OptText(args, "currency", 10) is { Length: > 0 } cur) dto.Currency = cur;
            if (OptDec(args, "foreignAmount", 0m, 99_999_999_999m, 2) is { } fa) dto.ForeignAmount = fa;
            if (OptDec(args, "exchangeRate", 0m, 1_000_000m, 6) is { } er) dto.ExchangeRate = er;
            if (DateArg(args, "openedOn") is { } on) dto.OpenedOn = on;
            if (DateArg(args, "expiresOn") is { } ex) dto.ExpiresOn = ex;
            if (OptText(args, "status", 10) is { Length: > 0 } st) dto.Status = st;
            if (OptText(args, "notes", 500) is { } nt) dto.Notes = nt;
            if (ImportLcService.Validate(dto) is { } error) throw new ToolError(error);
            var preview = new { action, lcId = existingId, dto.LcNumber, dto.BankName, dto.SupplierName, dto.Currency, dto.ForeignAmount, dto.ExchangeRate,
                openedOn = Ymd(dto.OpenedOn), expiresOn = Ymd(dto.ExpiresOn), dto.Status, dto.Notes };
            return new Built(preview, existingId == null ? $"Record LC {dto.LcNumber.Trim()} in company {companyId}" : $"Update LC #{existingId} ({dto.LcNumber.Trim()}) in company {companyId}",
                async () =>
                {
                    var saved = existingId == null ? await lcs.CreateAsync(companyId, dto) : await lcs.UpdateAsync(existingId.Value, dto);
                    return ($"ImportLc:{saved.Id}", $"{(existingId == null ? "Recorded" : "Updated")} LC {saved.LcNumber} (id {saved.Id})");
                });
        }

        // ── opening stock ──────────────────────────────────────────────────

        private async Task<Built> BuildOpeningStockAsync(int companyId, JsonElement args)
        {
            await Need("stock.opening.manage");
            await AssertDivisionWriteAsync(companyId, null);
            var itemTypeId = (await ItemInCompanyAsync(args, "itemTypeId", companyId))!.Value;
            var dto = new UpsertOpeningBalanceDto
            {
                CompanyId = companyId, ItemTypeId = itemTypeId,
                Quantity = ReqDec(args, "quantity", 0m, 999_999_999m, 4), ValueExcludingTax = ReqDec(args, "valueExcludingTax", 0m, 99_999_999_999m, 2),
                SalesTaxRate = ReqDec(args, "salesTaxRate", 0m, 100m, 2), ActualCostExcludingTax = OptDec(args, "actualCostExcludingTax", 0m, 99_999_999_999m, 2),
                AsOfDate = DateArg(args, "asOfDate") ?? throw new ToolError("asOfDate is required."), Notes = OptText(args, "notes", 500),
            };
            var existing = await _context.OpeningStockBalances.AsNoTracking().Where(o => o.CompanyId == companyId && o.ItemTypeId == itemTypeId)
                .Select(o => new { o.Id, o.Quantity, o.ValueExcludingTax, o.SalesTaxRate, o.ActualCostExcludingTax, o.AsOfDate }).FirstOrDefaultAsync();
            var names = await CompanyItemNames.ForCompanyAsync(_context, companyId, new[] { itemTypeId });
            var itemName = CompanyItemNames.Pick(names, itemTypeId, await _context.ItemTypes.AsNoTracking().Where(i => i.Id == itemTypeId).Select(i => i.Name).FirstAsync());
            var preview = new
            {
                itemTypeId, itemName, replaces = existing != null,
                before = existing == null ? null : new { existing.Quantity, existing.ValueExcludingTax, existing.SalesTaxRate, existing.ActualCostExcludingTax, asOfDate = Ymd(existing.AsOfDate) },
                after = new { dto.Quantity, dto.ValueExcludingTax, dto.SalesTaxRate, dto.ActualCostExcludingTax, asOfDate = Ymd(dto.AsOfDate), dto.Notes },
                inventoryChange = dto.ValueExcludingTax - (existing?.ValueExcludingTax ?? 0m), currency = "PKR",
            };
            return new Built(preview, $"{(existing == null ? "Enter" : "Replace")} the opening balance of \"{itemName}\" in company {companyId}: {dto.Quantity} at {dto.ValueExcludingTax:0.00} PKR",
                async () =>
                {
                    var saved = await Svc<StockRecordService>().UpsertOpeningBalanceAsync(dto, CurrentUserId);
                    return ($"OpeningStockBalance:{saved.Id}", $"Opening balance of \"{saved.ItemTypeName}\" set to {saved.Quantity} at {saved.ValueExcludingTax:0.00} PKR");
                });
        }

        // ── journal ────────────────────────────────────────────────────────

        private async Task<Built> BuildJournalAsync(int companyId, JsonElement args)
        {
            await Need("accounting.journal.create");
            var division = OptId(args, "divisionId");
            await AssertDivisionWriteAsync(companyId, division);
            var lines = new List<CreateJournalLineDto>();
            foreach (var l in Items(args, "lines", 2, MaxDocLines))
            {
                var debit = OptDec(l, "debit", 0m, 99_999_999_999m, 2) ?? 0m;
                var credit = OptDec(l, "credit", 0m, 99_999_999_999m, 2) ?? 0m;
                if ((debit > 0) == (credit > 0)) throw new ToolError("Each line is either a debit or a credit, above zero.");
                lines.Add(new CreateJournalLineDto { AccountId = IdArg(l, "accountId"), Debit = debit, Credit = credit, Description = OptText(l, "description", 300) });
            }
            var ids = lines.Select(l => l.AccountId).Distinct().ToList();
            var accounts = await _context.Accounts.AsNoTracking().Where(a => ids.Contains(a.Id) && a.CompanyId == companyId && a.IsActive)
                .Select(a => new { a.Id, a.Code, a.Name }).ToDictionaryAsync(a => a.Id);
            if (accounts.Count != ids.Count) throw new ToolError("An account is not one of this company's active accounts (search_accounts).");
            // The journal service's own rule, surfaced now: money accounts move only through receipts, payments and transfers.
            if (await _context.Accounts.AsNoTracking().AnyAsync(a => ids.Contains(a.Id) && (a.ControlType == MyApp.Api.Models.Accounting.ControlType.BankCash
                    || a.AccountGroup.Name.Contains("bank") || a.AccountGroup.Name.Contains("cash"))))
                throw new ToolError("Bank and cash accounts can't be posted via journal entries: use a receipt or payment.");
            if (lines.Sum(l => l.Debit) != lines.Sum(l => l.Credit)) throw new ToolError($"Debits ({lines.Sum(l => l.Debit):0.00}) must equal credits ({lines.Sum(l => l.Credit):0.00}).");
            var dto = new CreateJournalEntryDto { Date = DateArg(args, "date") ?? throw new ToolError("date is required."), Narration = OptText(args, "narration", 500), DivisionId = division, Lines = lines };
            var preview = new { date = Ymd(dto.Date), dto.Narration, divisionId = division,
                lines = lines.Select(l => new { l.AccountId, accounts[l.AccountId].Code, accounts[l.AccountId].Name, l.Debit, l.Credit, l.Description }),
                total = lines.Sum(l => l.Debit), currency = "PKR" };
            return new Built(preview, $"Post a manual journal entry of {lines.Sum(l => l.Debit):0.00} PKR dated {Ymd(dto.Date)} in company {companyId}: {lines.Count} line(s)",
                async () =>
                {
                    var je = await Svc<IJournalEntryService>().CreateManualAsync(companyId, dto);
                    return ($"JournalEntry:{je.Id}", $"Posted journal entry {je.Reference} (id {je.Id}) of {je.TotalDebit:0.00} PKR");
                });
        }
    }
}

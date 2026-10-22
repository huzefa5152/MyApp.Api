using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Account transfers, purchase debit notes, bank reconciliation and statements, and reconcile to
    /// a stock sheet (MCP parity phase 3). Each tool asserts the permission, the company and the
    /// stored company of every account, record and party it names, then runs the screen's own action.
    ///
    /// A GD costing SPREADSHEET is not uploaded through MCP: the agent reads the sheet itself and
    /// sends its lines to prepare_gd_costing, which runs the same match and cost rules as the screen.
    /// </summary>
    public partial class McpController
    {
        private void AddAccountingWriteTools(List<Tool> t)
        {
            var debitLine = new
            {
                type = "object", additionalProperties = false, required = new[] { "description", "quantity", "unitPrice" },
                properties = new { description = Str(500), quantity = new { type = "string" }, unit = Str(50), unitPrice = MoneyProp, itemTypeId = Int(), accountId = Int(), hsCode = Str(20) },
            };
            t.AddRange(new Tool[]
            {
                new("search_account_transfers", "Money moved between this company's own bank and cash accounts.",
                    Obj(new { companyId = CompanyProp, search = Str(200), dateFrom = DateProp, dateTo = DateProp, page = new { type = "integer", minimum = 1 }, pageSize = new { type = "integer", minimum = 1, maximum = 100 } }, "companyId"),
                    Read: SearchTransfersAsync),
                new("prepare_account_transfer", "Prepare moving money between two of this company's bank or cash accounts (search_accounts), or an edit when transferId is given. Nothing is saved until commit_action.",
                    Obj(new { companyId = CompanyProp, transferId = Int("Edit this transfer."), date = DateProp, fromAccountId = Int(), toAccountId = Int(), amount = MoneyProp, description = Str(500), divisionId = DivisionProp, idempotencyKey = IdemProp },
                        "companyId", "fromAccountId", "toAccountId", "amount"),
                    Build: BuildTransferAsync, PerHour: 20, Noun: "account transfers"),
                new("search_purchase_debit_notes", "Debit notes raised on suppliers (goods returned, price corrections).",
                    Obj(new { companyId = CompanyProp, offset = new { type = "integer", minimum = 0 }, limit = new { type = "integer", minimum = 1, maximum = MaxToolRows } }, "companyId"),
                    Read: SearchDebitNotesAsync),
                new("get_purchase_debit_note", "One supplier debit note with its lines.", Obj(new { companyId = CompanyProp, purchaseDebitNoteId = Int() }, "companyId", "purchaseDebitNoteId"), Read: GetDebitNoteAsync),
                new("prepare_purchase_debit_note", "Prepare a debit note on a supplier (goods returned to them, or a price correction), or an edit when purchaseDebitNoteId is given. Nothing is saved until commit_action.",
                    Obj(new { companyId = CompanyProp, purchaseDebitNoteId = Int("Edit this debit note."), supplierId = Int(), divisionId = DivisionProp, date = DateProp, supplierRef = Str(100), notes = Str(2000),
                        gstRate = new { type = "string" }, items = new { type = "array", minItems = 1, maxItems = MaxDocLines, items = debitLine }, idempotencyKey = IdemProp }, "companyId", "supplierId", "items"),
                    Build: BuildDebitNoteAsync, PerHour: 20, Noun: "supplier debit notes"),
                new("get_bank_reconciliation", "Bank reconciliation: without bankAccountId, each bank account's book and cleared balances; with it, that account's transactions (cleared or not), reconciliation history and imported statement lines.",
                    Obj(new { companyId = CompanyProp, bankAccountId = Int(), statementStatus = Str(30) }, "companyId"), Read: GetBankReconAsync),
                new("prepare_bank_clear", "Prepare marking a receipt/payment (kind 'payment') or a transfer (kind 'transfer') as cleared by the bank, or not cleared.",
                    Obj(new { companyId = CompanyProp, kind = new { type = "string", @enum = new[] { "payment", "transfer" } }, id = Int(), cleared = new { type = "boolean" }, clearedDate = DateProp, idempotencyKey = IdemProp }, "companyId", "kind", "id", "cleared"),
                    Build: BuildBankClearAsync, PerHour: 100, Noun: "bank clearing changes"),
                new("prepare_bank_reconciliation_lock", "Prepare closing a bank reconciliation at a statement date and balance.",
                    Obj(new { companyId = CompanyProp, bankAccountId = Int(), statementDate = DateProp, statementBalance = MoneyProp, idempotencyKey = IdemProp }, "companyId", "bankAccountId", "statementDate", "statementBalance"),
                    Build: BuildBankLockAsync, PerHour: 10, Noun: "bank reconciliations"),
                new("prepare_bank_statement_import", "Prepare importing a bank statement (CSV text, as exported by the bank) into a bank account for matching.",
                    Obj(new { companyId = CompanyProp, bankAccountId = Int(), fileName = Str(200), csvText = new { type = "string", maxLength = 500_000 }, idempotencyKey = IdemProp }, "companyId", "bankAccountId", "csvText"),
                    Build: BuildStatementImportAsync, PerHour: 10, Noun: "statement imports"),
                new("prepare_bank_statement_line", "Prepare handling one imported statement line: action 'categorize' books it to an account and/or a customer or supplier, 'ignore' drops it.",
                    Obj(new { companyId = CompanyProp, lineId = Int(), action = new { type = "string", @enum = new[] { "categorize", "ignore" } }, accountId = Int(),
                        contactType = new { type = "string", @enum = new[] { "Client", "Supplier", "Other" } }, contactId = Int(), description = Str(500), idempotencyKey = IdemProp }, "companyId", "lineId", "action"),
                    Build: BuildStatementLineAsync, PerHour: 100, Noun: "statement lines"),
                new("prepare_stock_reconcile", "Prepare reconciling the company's stock to its stock sheet as at a date: send the sheet's rows (item name as on the sheet, GD number, GD date, claim month, balance quantity, value, rate; chosenItemTypeId where the plan asks). The plan says per item what changes; quantity corrections apply only to items listed in useSheetQuantityItemTypeIds. Nothing is saved until commit_action.",
                    Obj(new
                    {
                        companyId = CompanyProp, asOf = DateProp, sourceFile = Str(200),
                        rows = new { type = "array", minItems = 1, maxItems = 2000, items = new { type = "object", additionalProperties = false, required = new[] { "sourceRow", "itemNameOnSheet", "balanceQuantity", "balanceValueExcludingTax" },
                            properties = new { sourceRow = Int(), itemNameOnSheet = Str(300), hsCode = Str(20), lotRef = Str(100), lotDate = DateProp, claimMonth = DateProp, unit = Str(50),
                                balanceQuantity = new { type = "string" }, balanceValueExcludingTax = MoneyProp, balanceSalesTaxRate = new { type = "string" }, chosenItemTypeId = Int() } } },
                        useSheetQuantityItemTypeIds = new { type = "array", maxItems = 2000, items = new { type = "integer", minimum = 1 } },
                        idempotencyKey = IdemProp,
                    }, "companyId", "asOf", "rows"),
                    Build: BuildStockReconcileAsync, PerHour: 5, Noun: "stock reconciliations"),
            });
        }

        // ── shared ownership checks ────────────────────────────────────────

        private async Task AccountInCompanyAsync(int companyId, int accountId, string what = "account")
        {
            if (!await _context.Accounts.AsNoTracking().AnyAsync(a => a.Id == accountId && a.CompanyId == companyId && a.IsActive))
                throw new ToolError($"That {what} is not one of this company's active accounts (search_accounts).");
        }

        // ── account transfers ──────────────────────────────────────────────

        private async Task<object> SearchTransfersAsync(JsonElement args)
        {
            await Need("accounting.transfers.view");
            var companyId = await CompanyArg(args);
            var (from, to) = Dates(args);
            return await ScreenAsync(() => Screen<AccountTransfersController>().GetPaged(companyId, IntArg(args, "page") ?? 1, IntArg(args, "pageSize"),
                StrArg(args, "search") is { Length: > 0 } s ? s : null, from, to));
        }

        private async Task<Built> BuildTransferAsync(int companyId, JsonElement args)
        {
            await Need("accounting.transfers.create");
            var from = IdArg(args, "fromAccountId");
            var to = IdArg(args, "toAccountId");
            if (from == to) throw new ToolError("The two accounts must differ.");
            await AccountInCompanyAsync(companyId, from, "paying account");
            await AccountInCompanyAsync(companyId, to, "receiving account");
            var editId = OptId(args, "transferId");
            int? division;
            if (editId is int eid)
            {
                var stored = await _context.AccountTransfers.AsNoTracking().Where(x => x.Id == eid).Select(x => new { x.CompanyId, x.DivisionId, x.Number }).FirstOrDefaultAsync();
                if (stored == null || stored.CompanyId != companyId) throw new ToolError(Denied);
                await AssertDivisionReadAsync(companyId, stored.DivisionId);
                division = stored.DivisionId;
            }
            else
            {
                division = OptId(args, "divisionId");
                await AssertDivisionWriteAsync(companyId, division);
            }
            var dto = new CreateAccountTransferDto
            {
                Date = DateArg(args, "date") ?? PakistanClock.Today, FromAccountId = from, ToAccountId = to,
                Amount = ReqDec(args, "amount", 0m, 99_999_999_999m, 2, minInclusive: false), Description = OptText(args, "description", 500), DivisionId = division,
            };
            var preview = new { transferId = editId, date = Ymd(dto.Date), dto.FromAccountId, dto.ToAccountId, dto.Amount, dto.Description, currency = "PKR" };
            return new Built(preview, $"{(editId == null ? "Transfer" : "Update a transfer of")} {dto.Amount:0.00} PKR between accounts {from} and {to} in company {companyId}",
                async () =>
                {
                    var res = editId is int id
                        ? await ScreenAsync(() => Screen<AccountTransfersController>().Update(id, dto))
                        : await ScreenAsync(() => Screen<AccountTransfersController>().Create(companyId, dto));
                    var el = JsonSerializer.SerializeToElement(res);
                    var newId = el.TryGetProperty("id", out var i) ? i.GetInt32() : editId ?? 0;
                    return ($"AccountTransfer:{newId}", $"{(editId == null ? "Recorded" : "Updated")} transfer of {dto.Amount:0.00} PKR (id {newId})");
                });
        }

        // ── purchase debit notes ───────────────────────────────────────────

        private async Task<object> SearchDebitNotesAsync(JsonElement args)
        {
            await Need("purchasedebitnotes.list.view");
            var companyId = await CompanyArg(args);
            var rows = As<List<PurchaseDebitNoteDto>>(await ScreenAsync(() => Screen<PurchaseDebitNotesController>().GetByCompany(companyId)))
                .Where(r => r.CompanyId == companyId).ToList();
            var (offset, limit) = Window(args);
            return new { totalCount = rows.Count, offset, items = rows.Skip(offset).Take(limit) };
        }

        private async Task<PurchaseDebitNoteDto> OwnDebitNoteAsync(int companyId, int id)
        {
            var n = As<PurchaseDebitNoteDto>(await ScreenAsync(() => Screen<PurchaseDebitNotesController>().GetById(id)));
            if (n.CompanyId != companyId) throw new ToolError(Denied);
            await AssertDivisionReadAsync(companyId, n.DivisionId);
            return n;
        }

        private async Task<object> GetDebitNoteAsync(JsonElement args)
        {
            await Need("purchasedebitnotes.list.view");
            var companyId = await CompanyArg(args);
            return await OwnDebitNoteAsync(companyId, IdArg(args, "purchaseDebitNoteId"));
        }

        private async Task<Built> BuildDebitNoteAsync(int companyId, JsonElement args)
        {
            var editId = OptId(args, "purchaseDebitNoteId");
            await Need(editId == null ? "purchasedebitnotes.manage.create" : "purchasedebitnotes.manage.update");
            var supplierId = (await SupplierInCompanyAsync(args, companyId))!.Value;
            var items = new List<CreatePurchaseDebitNoteItemDto>();
            foreach (var it in Items(args, "items", 1, MaxDocLines))
            {
                var desc = OptText(it, "description", 500);
                if (string.IsNullOrEmpty(desc)) throw new ToolError("Item descriptions cannot be empty.");
                var account = OptId(it, "accountId");
                if (account is int acc) await AccountInCompanyAsync(companyId, acc);
                items.Add(new CreatePurchaseDebitNoteItemDto
                {
                    Description = desc, Quantity = ReqDec(it, "quantity", 0m, 999_999_999m, 4, minInclusive: false), UOM = OptText(it, "unit", 50),
                    UnitPrice = ReqDec(it, "unitPrice", 0m, 999_999_999m, 4, minInclusive: false), ItemTypeId = await ItemInCompanyAsync(it, "itemTypeId", companyId),
                    AccountId = account, HSCode = OptText(it, "hsCode", 20) is { Length: > 0 } hs ? hs : null,
                });
            }
            var name = await SupplierNameAsync(supplierId);
            var preview = new { supplierId, supplierName = name, date = Ymd(DateArg(args, "date")), gstRate = Gst(args), items = items.Select(i => new { i.Description, i.Quantity, unit = i.UOM, i.UnitPrice, i.ItemTypeId, i.AccountId }) };
            if (editId is int eid)
            {
                var existing = await OwnDebitNoteAsync(companyId, eid);
                if (existing.DivisionId != null) await AssertDivisionWriteAsync(companyId, existing.DivisionId);
                var udto = new UpdatePurchaseDebitNoteDto
                {
                    Date = DateArg(args, "date") ?? existing.Date, SupplierId = supplierId, SupplierRef = OptText(args, "supplierRef", 100) ?? existing.SupplierRef,
                    Notes = OptText(args, "notes", 2000) ?? existing.Notes, GSTRate = Has(args, "gstRate") ? Gst(args) : existing.GSTRate, Items = items,
                };
                return new Built(EditPreview("supplier debit note", eid, existing.DebitNoteNumber, preview), $"Update supplier debit note #{existing.DebitNoteNumber} in company {companyId}",
                    async () =>
                    {
                        var n = As<PurchaseDebitNoteDto>(await ScreenAsync(() => Screen<PurchaseDebitNotesController>().Update(eid, udto)));
                        return ($"PurchaseDebitNote:{n.Id}", $"Updated supplier debit note #{n.DebitNoteNumber} (id {n.Id})");
                    });
            }
            var division = OptId(args, "divisionId");
            await AssertDivisionWriteAsync(companyId, division);
            var dto = new CreatePurchaseDebitNoteDto
            {
                CompanyId = companyId, DivisionId = division, SupplierId = supplierId, Date = DateArg(args, "date") ?? PakistanClock.Today,
                SupplierRef = OptText(args, "supplierRef", 100), Notes = OptText(args, "notes", 2000), GSTRate = Gst(args), Items = items,
            };
            return new Built(preview, $"Raise a debit note on \"{name}\" in company {companyId}: {items.Count} line(s)",
                async () =>
                {
                    var n = As<PurchaseDebitNoteDto>(await ScreenAsync(() => Screen<PurchaseDebitNotesController>().Create(dto)));
                    return ($"PurchaseDebitNote:{n.Id}", $"Raised supplier debit note #{n.DebitNoteNumber} (id {n.Id}) on \"{name}\"");
                });
        }

        // ── bank reconciliation ────────────────────────────────────────────

        private async Task<object> GetBankReconAsync(JsonElement args)
        {
            await Need("accounting.reconciliation.view");
            var companyId = await CompanyArg(args);
            if (OptId(args, "bankAccountId") is not int account)
                return await ScreenAsync(() => Screen<BankReconciliationController>().GetSummary(companyId));
            await AccountInCompanyAsync(companyId, account, "bank account");
            var recon = Screen<BankReconciliationController>();
            return new
            {
                transactions = await ScreenAsync(() => recon.GetTransactions(account)),
                history = await ScreenAsync(() => recon.GetHistory(account)),
                statementLines = await ScreenAsync(() => Screen<BankStatementController>().GetLines(account, OptText(args, "statementStatus", 30) is { Length: > 0 } st ? st : null)),
            };
        }

        private async Task<Built> BuildBankClearAsync(int companyId, JsonElement args)
        {
            await Need("accounting.reconciliation.manage");
            var kind = OptText(args, "kind", 10);
            var id = IdArg(args, "id");
            var owner = kind switch
            {
                "payment" => await _context.Payments.AsNoTracking().Where(x => x.Id == id).Select(x => (int?)x.CompanyId).FirstOrDefaultAsync(),
                "transfer" => await _context.AccountTransfers.AsNoTracking().Where(x => x.Id == id).Select(x => (int?)x.CompanyId).FirstOrDefaultAsync(),
                _ => throw new ToolError("kind must be payment or transfer."),
            };
            if (owner != companyId) throw new ToolError(Denied);
            var dto = new SetClearedDto { Cleared = OptBool(args, "cleared") ?? throw new ToolError("cleared is required."), ClearedDate = DateArg(args, "clearedDate") };
            return new Built(new { kind, id, dto.Cleared, clearedDate = Ymd(dto.ClearedDate) }, $"Mark {kind} {id} as {(dto.Cleared ? "cleared" : "not cleared")} in company {companyId}",
                async () =>
                {
                    if (kind == "payment") await ScreenAsync(() => Screen<BankReconciliationController>().SetPaymentCleared(id, dto));
                    else await ScreenAsync(() => Screen<BankReconciliationController>().SetTransferCleared(id, dto));
                    return ($"{kind}:{id}", $"{kind} {id} {(dto.Cleared ? "cleared" : "not cleared")}");
                });
        }

        private async Task<Built> BuildBankLockAsync(int companyId, JsonElement args)
        {
            await Need("accounting.reconciliation.manage");
            var account = IdArg(args, "bankAccountId");
            await AccountInCompanyAsync(companyId, account, "bank account");
            var dto = new LockReconciliationDto
            {
                BankAccountId = account, StatementDate = DateArg(args, "statementDate") ?? throw new ToolError("statementDate is required."),
                StatementBalance = ReqDec(args, "statementBalance", -99_999_999_999m, 99_999_999_999m, 2),
            };
            return new Built(new { dto.BankAccountId, statementDate = Ymd(dto.StatementDate), dto.StatementBalance, currency = "PKR" },
                $"Close the bank reconciliation of account {account} at {Ymd(dto.StatementDate)} ({dto.StatementBalance:0.00} PKR) in company {companyId}",
                async () =>
                {
                    var r = As<BankReconciliationDto>(await ScreenAsync(() => Screen<BankReconciliationController>().Lock(companyId, dto)));
                    return ($"BankReconciliation:{r.Id}", $"Reconciliation closed; difference {r.Difference:0.00} PKR");
                });
        }

        private async Task<Built> BuildStatementImportAsync(int companyId, JsonElement args)
        {
            await Need("accounting.reconciliation.manage");
            var account = IdArg(args, "bankAccountId");
            await AccountInCompanyAsync(companyId, account, "bank account");
            var csv = args.TryGetProperty("csvText", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString()! : throw new ToolError("csvText is required.");
            if (csv.Length is 0 or > 500_000) throw new ToolError("csvText must be 1 to 500,000 characters.");
            var dto = new ImportStatementRequestDto { BankAccountId = account, FileName = OptText(args, "fileName", 200), CsvText = csv };
            var lines = csv.Split('\n', StringSplitOptions.RemoveEmptyEntries).Length;
            return new Built(new { bankAccountId = account, dto.FileName, lines }, $"Import a {lines}-line bank statement into account {account} in company {companyId}",
                async () =>
                {
                    var r = await ScreenAsync(() => Screen<BankStatementController>().Import(companyId, dto));
                    return ($"BankStatement:{account}", "Statement imported: " + JsonSerializer.Serialize(r));
                });
        }

        private async Task<Built> BuildStatementLineAsync(int companyId, JsonElement args)
        {
            await Need("accounting.reconciliation.manage");
            var lineId = IdArg(args, "lineId");
            var owner = await _context.BankStatementLines.AsNoTracking().Where(x => x.Id == lineId).Select(x => (int?)x.CompanyId).FirstOrDefaultAsync();
            if (owner != companyId) throw new ToolError(Denied);
            if (OptText(args, "action", 20) == "ignore")
                return new Built(new { lineId, action = "ignore" }, $"Ignore statement line {lineId} in company {companyId}",
                    async () => { await ScreenAsync(() => Screen<BankStatementController>().Ignore(lineId)); return ($"BankStatementLine:{lineId}", "Statement line ignored"); });
            var account = OptId(args, "accountId");
            if (account is int a) await AccountInCompanyAsync(companyId, a);
            var contactType = OptText(args, "contactType", 20) ?? "Other";
            int? contact = contactType switch
            {
                "Client" => await ClientInCompanyAsync(args, companyId, required: true, name: "contactId"),
                "Supplier" => await SupplierInCompanyAsync(args, companyId, required: true, name: "contactId"),
                "Other" => null,
                _ => throw new ToolError("contactType must be Client, Supplier or Other."),
            };
            var dto = new CategorizeLineDto { AccountId = account, ContactType = contactType, ContactId = contact, Description = OptText(args, "description", 500) };
            return new Built(new { lineId, action = "categorize", dto.AccountId, dto.ContactType, dto.ContactId, dto.Description }, $"Book statement line {lineId} in company {companyId}",
                async () => { await ScreenAsync(() => Screen<BankStatementController>().Categorize(lineId, dto)); return ($"BankStatementLine:{lineId}", "Statement line booked"); });
        }

        // ── reconcile to stock sheet ───────────────────────────────────────

        private async Task<Built> BuildStockReconcileAsync(int companyId, JsonElement args)
        {
            await Need("stock.policy.manage");
            await AssertDivisionWriteAsync(companyId, null);
            var rows = new List<StockReconcileSheetRowDto>();
            foreach (var r in Items(args, "rows", 1, 2000))
            {
                rows.Add(new StockReconcileSheetRowDto
                {
                    SourceRow = IdArg(r, "sourceRow"), ItemNameOnSheet = OptText(r, "itemNameOnSheet", 300) ?? throw new ToolError("itemNameOnSheet is required."),
                    HsCode = OptText(r, "hsCode", 20), LotRef = OptText(r, "lotRef", 100), LotDate = DateArg(r, "lotDate"), ClaimMonth = DateArg(r, "claimMonth"), Unit = OptText(r, "unit", 50),
                    BalanceQuantity = ReqDec(r, "balanceQuantity", 0m, 999_999_999m, 4), BalanceValueExcludingTax = ReqDec(r, "balanceValueExcludingTax", 0m, 99_999_999_999m, 2),
                    BalanceSalesTaxRate = OptDec(r, "balanceSalesTaxRate", 0m, 100m, 2) ?? 18m, ChosenItemTypeId = await ItemInCompanyAsync(r, "chosenItemTypeId", companyId),
                });
            }
            var useSheet = new List<int>();
            if (args.TryGetProperty("useSheetQuantityItemTypeIds", out var u) && u.ValueKind == JsonValueKind.Array)
                foreach (var e in u.EnumerateArray())
                {
                    var id = e.TryGetInt32(out var n) && n > 0 ? n : throw new ToolError("useSheetQuantityItemTypeIds must be item ids.");
                    if (!await ItemTypeMembership.IsVisibleAsync(_context, id, new[] { companyId })) throw new ToolError($"Item {id} is not one of this company's items.");
                    useSheet.Add(id);
                }
            var req = new StockReconcileRequestDto
            {
                AsOf = DateArg(args, "asOf") ?? throw new ToolError("asOf is required."), SourceFile = OptText(args, "sourceFile", 200), Rows = rows, UseSheetQuantityItemTypeIds = useSheet,
            };
            var plan = As<StockReconcilePlanDto>(await ScreenAsync(() => Screen<StockController>().PlanReconcile(companyId, req)));
            if (!plan.CanApply) throw new ToolError("The sheet cannot be applied yet: " + JsonSerializer.Serialize(plan.Messages) + " Resolve the rows the plan highlights (chosenItemTypeId) and prepare again.");
            return new Built(plan, $"Reconcile company {companyId}'s stock to {req.SourceFile ?? "the stock sheet"} as at {Ymd(req.AsOf)}: {plan.Items.Count} item(s)",
                async () =>
                {
                    var done = As<StockReconcilePlanDto>(await ScreenAsync(() => Screen<StockController>().ApplyReconcile(companyId, req)));
                    return ($"StockReconcile:{companyId}", done.Messages.FirstOrDefault() ?? "Stock reconciled to the sheet");
                });
        }
    }
}

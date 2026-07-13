using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Perpetual-GL migration (see FEATURE_PERPETUAL_GL_MIGRATION.md). Rebuilds a
    /// company's chart of accounts keyed by Manager GUID, opens each account at its
    /// Manager STARTING balance, and posts every historical document as a faithful
    /// balanced journal entry (ManualJournal, SourceDocId=null → the app's posting
    /// engine never recomputes them). The result: every account carries a
    /// Manager-style transaction ledger and the balance sheet / P&L reconcile.
    /// Recipe validated by scratch/perp_recon.py before porting here.
    /// </summary>
    public partial class ManagerImportService
    {
        public async Task<ManagerImportReport> BuildPerpetualGlAsync(
            int companyId, string trialBalanceText,
            IReadOnlyDictionary<string, JsonDocument> summaryDocs,
            IReadOnlyDictionary<string, JsonDocument> detailDocs,
            IReadOnlyDictionary<string, JsonDocument> refDocs,
            bool dryRun)
        {
            var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId)
                ?? throw new InvalidOperationException($"Company {companyId} not found.");
            var report = new ManagerImportReport { CompanyId = companyId, CompanyName = company.Name, DryRun = dryRun };

            // ── reference data ──────────────────────────────────────────────────
            static JsonElement RootOf(IReadOnlyDictionary<string, JsonDocument> m, string k) => m.TryGetValue(k, out var d) ? d.RootElement : default;
            static IEnumerable<JsonElement> ArrOf(IReadOnlyDictionary<string, JsonDocument> m, string k)
            { var r = RootOf(m, k); return r.ValueKind == JsonValueKind.Array ? r.EnumerateArray() : Enumerable.Empty<JsonElement>(); }

            var coaNameByGuid = new Dictionary<string, string>();
            var coaGuidByName = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var a in ArrOf(refDocs, "chart-of-accounts"))
            {
                var k = Str(a, "key"); if (k == null) continue;
                var n = (Str(a, "name") ?? "").Trim(); coaNameByGuid[k] = n; if (n.Length > 0) coaGuidByName.TryAdd(n, k);
            }
            var bankNameByGuid = new Dictionary<string, string>();
            var bankActual = new Dictionary<string, decimal>();   // reconciliation target = Manager's current bank balance
            foreach (var b in ArrOf(summaryDocs, "bank-and-cash-accounts"))
            { var k = Str(b, "key"); if (k != null) { bankNameByGuid[k] = (Str(b, "name") ?? "").Trim(); bankActual[k] = Money(b, "actualBalance"); } }

            var bankStart = new Dictionary<string, decimal>();
            foreach (var r in ArrOf(refDocs, "bank-starting-balances"))
            {
                var g = r.TryGetProperty("bankOrCashAccount", out var bc) && bc.ValueKind == JsonValueKind.Object ? Str(bc, "key") : null;
                if (g != null) bankStart[g] = Money(r, "clearedBalance");
            }
            // The one balance-sheet starting balance is the opening equity offset
            // (Retained earnings): Σ(credit − debit).
            decimal reStartCredit = 0m;
            foreach (var r in ArrOf(refDocs, "bs-starting-balances"))
                reStartCredit += Money(r, "credit") - Money(r, "debit");

            var taxRate = new Dictionary<string, decimal>(); var taxAcctGuid = new Dictionary<string, string>();
            var taxRoot = RootOf(refDocs, "taxcodes-resolved");
            if (taxRoot.ValueKind == JsonValueKind.Object)
                foreach (var p in taxRoot.EnumerateObject())
                {
                    if (p.Value.TryGetProperty("rate", out var rt) && rt.ValueKind == JsonValueKind.Number) taxRate[p.Name] = rt.GetDecimal();
                    if (p.Value.TryGetProperty("account", out var ac) && ac.ValueKind == JsonValueKind.String) taxAcctGuid[p.Name] = ac.GetString()!;
                }
            var noninvSale = new Dictionary<string, string?>(); var noninvPurch = new Dictionary<string, string?>();
            var niRoot = RootOf(refDocs, "noninv-resolved");
            if (niRoot.ValueKind == JsonValueKind.Object)
                foreach (var p in niRoot.EnumerateObject())
                {
                    noninvSale[p.Name] = p.Value.TryGetProperty("sale", out var s) && s.ValueKind == JsonValueKind.String ? s.GetString() : null;
                    noninvPurch[p.Name] = p.Value.TryGetProperty("purchase", out var pu) && pu.ValueKind == JsonValueKind.String ? pu.GetString() : null;
                }

            // account name → statement section (types) + signed balance (reconciliation
            // target), from the Trial Balance. Signed = debit-positive.
            var sectionByName = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            // CASE-SENSITIVE: Al-Qahera's CoA has two distinct accounts differing only
            // by case ("Discount" vs "DISCOUNT") — a case-insensitive target lookup
            // would give both the same balance and double-count it.
            var tbSignedByName = new Dictionary<string, decimal>(StringComparer.Ordinal);
            decimal tbIncome = 0m, tbExpense = 0m;
            foreach (var r in ParseTrialBalance(trialBalanceText))
            {
                sectionByName.TryAdd(r.name, r.section);
                var signed = r.isDebit ? r.amount : -r.amount;
                tbSignedByName[r.name] = tbSignedByName.GetValueOrDefault(r.name) + signed;
                if (r.section == "Income") tbIncome += signed;
                else if (r.section == "Expenses") tbExpense += signed;
            }
            decimal netProfitCredit = -tbIncome - tbExpense;   // profit → credit (raises equity)

            AccountType TypeOf(string name)
            {
                if (sectionByName.TryGetValue(name, out var s))
                    return s switch { "Assets" => AccountType.Asset, "Liabilities" => AccountType.Liability, "Equity" => AccountType.Equity, "Income" => AccountType.Income, _ => AccountType.Expense };
                var u = name.ToLowerInvariant();   // heuristic for zero-balance accounts absent from the TB
                if (u.Contains("expense") || u.Contains("cost of") || u.Contains("challan")) return AccountType.Expense;   // explicit expense markers first
                if (u.Contains("sales") || u.Contains("income") || u.Contains("freight") || u.Contains("received")) return AccountType.Income;
                if (u.Contains("payable")) return AccountType.Liability;
                if (u.Contains("receivable") || u.Contains("cash equivalent") || u.Contains("advance") || u.Contains("loan receiv") || u.Contains("withholding")) return AccountType.Asset;
                if (u.Contains("capital") || u.Contains("earning") || u.Contains("suspense")) return AccountType.Equity;
                return AccountType.Expense;
            }
            static ControlType ControlOf(string name) => name switch
            {
                "Accounts receivable" => ControlType.AccountsReceivable,
                "Accounts payable" => ControlType.AccountsPayable,
                "TT GST" => ControlType.OutputTax,
                "Suspense" => ControlType.Suspense,
                "Withholding tax receivable" => ControlType.WithholdingReceivable,
                "Withholding tax payable" => ControlType.WithholdingPayable,
                _ => ControlType.None,
            };
            static string SectionOf(AccountType t) => t switch
            { AccountType.Asset => "Assets", AccountType.Liability => "Liabilities", AccountType.Equity => "Equity", AccountType.Income => "Income", _ => "Expenses" };

            await using var tx = await _db.Database.BeginTransactionAsync();
            try
            {
                // wipe CoA + GL for the company (idempotent rebuild)
                await _db.JournalLines.Where(l => l.JournalEntry.CompanyId == companyId).ExecuteDeleteAsync();
                await _db.JournalEntries.Where(e => e.CompanyId == companyId).ExecuteDeleteAsync();
                await _db.AccountTransfers.Where(t => t.CompanyId == companyId).ExecuteDeleteAsync();
                // Unmap non-inventory items from the accounts about to be dropped
                // (the FKs are NoAction, so the account wipe would otherwise fail).
                // They're re-wired after the new CoA is built (see below).
                await _db.NonInventoryItems.Where(n => n.CompanyId == companyId)
                    .ExecuteUpdateAsync(s => s.SetProperty(n => n.SaleAccountId, (int?)null)
                                              .SetProperty(n => n.PurchaseAccountId, (int?)null));
                await _db.Accounts.Where(a => a.CompanyId == companyId).ExecuteDeleteAsync();
                await _db.AccountGroups.Where(g => g.CompanyId == companyId).ExecuteDeleteAsync();

                // groups: 5 sections + a Bank & Cash child under Assets
                var stmtOf = new Dictionary<string, FinancialStatement>
                { ["Assets"] = FinancialStatement.BalanceSheet, ["Liabilities"] = FinancialStatement.BalanceSheet, ["Equity"] = FinancialStatement.BalanceSheet, ["Income"] = FinancialStatement.ProfitAndLoss, ["Expenses"] = FinancialStatement.ProfitAndLoss };
                var groupId = new Dictionary<string, int>();
                int gpos = 0;
                foreach (var sec in new[] { "Assets", "Liabilities", "Equity", "Income", "Expenses" })
                {
                    var g = new AccountGroup { CompanyId = companyId, Name = sec, Statement = stmtOf[sec], Position = gpos++, ExternalRef = $"mgr-tbgrp:{sec}" };
                    _db.AccountGroups.Add(g); await _db.SaveChangesAsync(); groupId[sec] = g.Id;
                }
                var bankGroup = new AccountGroup { CompanyId = companyId, Name = "Bank & Cash Accounts", Statement = FinancialStatement.BalanceSheet, ParentGroupId = groupId["Assets"], Position = gpos++, ExternalRef = "mgr-bankcash-group" };
                _db.AccountGroups.Add(bankGroup); await _db.SaveChangesAsync();

                // Auto-detect the cash roll-up account: the asset line whose TB balance
                // equals the sum of the individual bank/cash accounts. The 13 banks
                // REPLACE it, so it must not be created (else cash double-counts and the
                // true-up would lock in the double). Works for any business regardless of
                // the roll-up's name; falls back to the common Manager names.
                decimal bankSum = bankActual.Values.Sum();
                string? rollupName = Math.Abs(bankSum) > 0.5m
                    ? tbSignedByName.Where(kv => sectionByName.GetValueOrDefault(kv.Key) == "Assets" && Math.Abs(kv.Value - bankSum) < 1m)
                        .Select(kv => kv.Key).FirstOrDefault()
                    : null;
                rollupName ??= coaNameByGuid.Values.FirstOrDefault(n =>
                    n.Equals("Cash & cash equivalents", StringComparison.OrdinalIgnoreCase) || n.Equals("Cash and cash equivalents", StringComparison.OrdinalIgnoreCase));
                if (rollupName != null) report.Notes.Add($"Cash roll-up account \"{rollupName}\" replaced by {bankActual.Count} individual bank/cash accounts.");

                // accounts: CoA accounts (skip the cash roll-up) + individual banks.
                // Ordered ALPHABETICALLY by name (Position = alpha rank) so the Chart
                // of Accounts lists them the same way Manager does, within each section.
                int apos = 0;
                foreach (var (guid, name) in coaNameByGuid.OrderBy(kv => kv.Value, StringComparer.OrdinalIgnoreCase))
                {
                    if (rollupName != null && name.Equals(rollupName, StringComparison.Ordinal)) continue;
                    var type = TypeOf(name);
                    decimal opening = 0m; bool isDebit = type is AccountType.Asset or AccountType.Expense;
                    if (name.Equals("Retained earnings", StringComparison.OrdinalIgnoreCase))
                    { opening = Math.Abs(reStartCredit); isDebit = reStartCredit < 0; }   // credit balance
                    _db.Accounts.Add(new Account
                    {
                        CompanyId = companyId, Name = name, AccountGroupId = groupId[SectionOf(type)], AccountType = type,
                        OpeningBalance = opening, OpeningBalanceIsDebit = isDebit, IsActive = true, Position = apos++,
                        ControlType = ControlOf(name), ExternalRef = $"mgr-acct:{guid}",
                    });
                }
                int bpos = 0;
                foreach (var (guid, name) in bankNameByGuid.OrderBy(kv => kv.Value, StringComparer.OrdinalIgnoreCase))
                {
                    decimal bal = bankStart.TryGetValue(guid, out var bs) ? bs : 0m;
                    _db.Accounts.Add(new Account
                    {
                        CompanyId = companyId, Name = string.IsNullOrWhiteSpace(name) ? "(bank)" : name, AccountGroupId = bankGroup.Id,
                        AccountType = AccountType.Asset, OpeningBalance = Math.Abs(bal), OpeningBalanceIsDebit = bal >= 0,
                        IsActive = true, Position = 1000 + bpos++, ControlType = ControlType.BankCash, ExternalRef = $"mgr-bankcash:{guid}",
                    });
                }
                await _db.SaveChangesAsync();

                // manager GUID → MyApp account id
                var acctId = new Dictionary<string, int>();
                await foreach (var a in _db.Accounts.Where(a => a.CompanyId == companyId).AsAsyncEnumerable())
                {
                    if (a.ExternalRef?.StartsWith("mgr-acct:") == true) acctId[a.ExternalRef["mgr-acct:".Length..]] = a.Id;
                    else if (a.ExternalRef?.StartsWith("mgr-bankcash:") == true) acctId[a.ExternalRef["mgr-bankcash:".Length..]] = a.Id;
                }
                int suspenseId = acctId.TryGetValue(coaGuidByName.GetValueOrDefault("Suspense") ?? "", out var sid) ? sid
                    : await _db.Accounts.Where(a => a.CompanyId == companyId && a.ControlType == ControlType.Suspense).Select(a => a.Id).FirstAsync();
                int Acct(string? guid) => guid != null && acctId.TryGetValue(guid, out var id) ? id : suspenseId;

                // ── Wire Non-Inventory Item masters to their mapped accounts ──
                // The masters were created during document import (RunAsync) with
                // null account FKs (the CoA didn't exist yet). Now that the
                // accounts do, resolve each item's Manager sale/purchase account
                // GUID (from noninv-resolved) → the created account. Matched by the
                // mgr-niitem:{guid} ExternalRef stamped at import. Unmapped → null
                // (posting falls back to Suspense).
                int niWired = 0;
                var niMasters = await _db.NonInventoryItems
                    .Where(n => n.CompanyId == companyId && n.ExternalRef != null).ToListAsync();
                foreach (var ni in niMasters)
                {
                    if (ni.ExternalRef?.StartsWith("mgr-niitem:") != true) continue;
                    var guid = ni.ExternalRef["mgr-niitem:".Length..];
                    int? sale = noninvSale.TryGetValue(guid, out var sg) && sg != null && acctId.TryGetValue(sg, out var sid2) ? sid2 : (int?)null;
                    int? purch = noninvPurch.TryGetValue(guid, out var pg) && pg != null && acctId.TryGetValue(pg, out var pid2) ? pid2 : (int?)null;
                    if (ni.SaleAccountId != sale || ni.PurchaseAccountId != purch) { ni.SaleAccountId = sale; ni.PurchaseAccountId = purch; niWired++; }
                }
                if (niWired > 0) { await _db.SaveChangesAsync(); _db.ChangeTracker.Clear(); }
                report.Created["nonInventoryItemsWired"] = niWired;

                string? arGuid = coaGuidByName.GetValueOrDefault("Accounts receivable");
                string? apGuid = coaGuidByName.GetValueOrDefault("Accounts payable");
                string? whtrGuid = coaGuidByName.GetValueOrDefault("Withholding tax receivable");
                string? whtpGuid = coaGuidByName.GetValueOrDefault("Withholding tax payable");

                // ── journal-entry builder (balanced; residual → Suspense) ─────────
                int entryNo = 0; int lineCount = 0; decimal plugged = 0m; DateTime maxDate = default;
                var pending = new List<JournalEntry>();
                async Task Flush()
                { if (pending.Count == 0) return; _db.JournalEntries.AddRange(pending); await _db.SaveChangesAsync(); _db.ChangeTracker.Clear(); pending.Clear(); }

                // Each posting carries its NATIVE SourceDocType so the app screens
                // categorise correctly: document/receipt/transfer GL = "system"
                // (view-only), only the real Manager journals = ManualJournal
                // (the editable "Journal Entries" list, mirroring Manager). All use
                // SourceDocId=null (exempt from the filtered unique index) since the
                // ManualJournal migration entries aren't tied to a MyApp doc row.
                void PostJE(DateTime date, string narration, SourceDocType docType, Dictionary<int, decimal> net)
                {
                    decimal bal = net.Values.Sum();
                    if (Math.Abs(bal) >= 0.005m) { net[suspenseId] = net.GetValueOrDefault(suspenseId) - bal; plugged += Math.Abs(bal); }
                    var lines = new List<JournalLine>();
                    foreach (var kv in net)
                    {
                        if (Math.Abs(kv.Value) < 0.005m) continue;
                        lines.Add(new JournalLine { AccountId = kv.Key, Debit = kv.Value > 0 ? kv.Value : 0m, Credit = kv.Value < 0 ? -kv.Value : 0m });
                    }
                    if (lines.Count == 0) return;
                    lineCount += lines.Count;
                    if (date > maxDate) maxDate = date;
                    pending.Add(new JournalEntry
                    {
                        CompanyId = companyId, EntryNo = ++entryNo, Date = date, Narration = narration,
                        SourceDocType = docType, SourceDocId = null, Lines = lines,
                    });
                }
                static void Add(Dictionary<int, decimal> m, int id, decimal debit = 0m, decimal credit = 0m) => m[id] = m.GetValueOrDefault(id) + debit - credit;
                static IEnumerable<JsonElement> Lines(JsonElement d) => d.TryGetProperty("Lines", out var L) && L.ValueKind == JsonValueKind.Array ? L.EnumerateArray() : Enumerable.Empty<JsonElement>();
                static bool BoolP(JsonElement d, string p) => d.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.True;
                static decimal DecP(JsonElement d, string p) => d.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDecimal() : 0m;
                decimal LineNet(JsonElement ln)
                {
                    decimal q = ln.TryGetProperty("Qty", out var qq) && qq.ValueKind == JsonValueKind.Number ? qq.GetDecimal() : 1m;
                    decimal p = ln.TryGetProperty("SalesUnitPrice", out var sp) && sp.ValueKind == JsonValueKind.Number ? sp.GetDecimal()
                              : ln.TryGetProperty("PurchaseUnitPrice", out var pp) && pp.ValueKind == JsonValueKind.Number ? pp.GetDecimal() : 0m;
                    return Math.Round(q * p, 2);
                }
                string? LineAcct(JsonElement ln, bool sale)
                {
                    var item = Str(ln, "Item");
                    if (item != null) return sale ? noninvSale.GetValueOrDefault(item) : noninvPurch.GetValueOrDefault(item);
                    return Str(ln, "Account");
                }
                DateTime DocDate(JsonElement d, string prop) => Date(d, prop) ?? new DateTime(2024, 1, 1);

                // ── Sales invoices ────────────────────────────────────────────────
                int nInv = 0, nNote = 0, nBill = 0, nRcp = 0, nPmt = 0, nXfer = 0, nJrnl = 0;
                void PostSale(JsonElement d, int sign, string label)
                {
                    var m = new Dictionary<int, decimal>(); decimal net = 0m, tax = 0m; string? taxAcc = null;
                    foreach (var ln in Lines(d))
                    {
                        decimal n = LineNet(ln); Add(m, Acct(LineAcct(ln, true)), credit: sign * n); net += n;
                        var tc = Str(ln, "TaxCode");
                        if (tc != null && taxRate.TryGetValue(tc, out var rate)) { tax += Math.Round(n * rate / 100m, 2); taxAcc = taxAcctGuid.GetValueOrDefault(tc); }
                    }
                    net = Math.Round(net, 2); tax = Math.Round(tax, 2);
                    if (tax != 0 && taxAcc != null) Add(m, Acct(taxAcc), credit: sign * tax);
                    decimal wht = 0m;
                    if (BoolP(d, "WithholdingTax")) { wht = Math.Round((net + tax) * DecP(d, "WithholdingTaxPercentage") / 100m, 2); if (wht != 0) Add(m, Acct(whtrGuid), debit: sign * wht); }
                    Add(m, Acct(arGuid), debit: sign * Math.Round(net + tax - wht, 2));
                    PostJE(DocDate(d, "IssueDate"), label, SourceDocType.Invoice, m);
                }
                foreach (var d in ArrOf(detailDocs, "sales-invoices")) { PostSale(d, +1, $"Sales Invoice {Str(d, "Reference")}"); nInv++; }
                foreach (var d in ArrOf(detailDocs, "credit-notes")) { PostSale(d, -1, $"Credit Note {Str(d, "Reference")}"); nNote++; }
                foreach (var d in ArrOf(detailDocs, "debit-notes")) { PostSale(d, +1, $"Debit Note {Str(d, "Reference")}"); nNote++; }
                await Flush();

                // ── Purchase bills ────────────────────────────────────────────────
                foreach (var d in ArrOf(detailDocs, "purchase-invoices"))
                {
                    var m = new Dictionary<int, decimal>(); decimal net = 0m, tax = 0m; string? taxAcc = null;
                    foreach (var ln in Lines(d))
                    {
                        decimal n = LineNet(ln); Add(m, Acct(LineAcct(ln, false)), debit: n); net += n;
                        var tc = Str(ln, "TaxCode");
                        if (tc != null && taxRate.TryGetValue(tc, out var rate)) { tax += Math.Round(n * rate / 100m, 2); taxAcc = taxAcctGuid.GetValueOrDefault(tc); }
                    }
                    net = Math.Round(net, 2); tax = Math.Round(tax, 2);
                    if (tax != 0 && taxAcc != null) Add(m, Acct(taxAcc), debit: tax);
                    decimal wht = 0m;
                    if (BoolP(d, "WithholdingTax")) { wht = Math.Round((net + tax) * DecP(d, "WithholdingTaxPercentage") / 100m, 2); if (wht != 0) Add(m, Acct(whtpGuid), credit: wht); }
                    Add(m, Acct(apGuid), credit: Math.Round(net + tax - wht, 2));
                    PostJE(DocDate(d, "IssueDate"), $"Purchase Invoice {Str(d, "Reference")}", SourceDocType.PurchaseBill, m); nBill++;
                }
                await Flush();

                // ── Receipts / payments ───────────────────────────────────────────
                foreach (var d in ArrOf(detailDocs, "receipts"))
                {
                    var m = new Dictionary<int, decimal>(); decimal tot = 0m;
                    foreach (var ln in Lines(d)) { var a = Money(ln, "Amount"); tot += a; Add(m, Acct(Str(ln, "Account")), credit: a); }
                    Add(m, Acct(Str(d, "ReceivedIn")), debit: Math.Round(tot, 2));
                    PostJE(DocDate(d, "Date"), "Receipt", SourceDocType.Payment, m); nRcp++;
                }
                await Flush();
                foreach (var d in ArrOf(detailDocs, "payments"))
                {
                    var m = new Dictionary<int, decimal>(); decimal tot = 0m;
                    foreach (var ln in Lines(d)) { var a = Money(ln, "Amount"); tot += a; Add(m, Acct(Str(ln, "Account")), debit: a); }
                    Add(m, Acct(Str(d, "PaidFrom")), credit: Math.Round(tot, 2));
                    PostJE(DocDate(d, "Date"), "Payment", SourceDocType.Payment, m); nPmt++;
                }
                await Flush();

                // ── Transfers / journals ──────────────────────────────────────────
                var transferRows = new List<AccountTransfer>(); int tnum = 0;
                foreach (var d in ArrOf(detailDocs, "inter-account-transfers"))
                {
                    var amt = Money(d, "CreditAmount"); var m = new Dictionary<int, decimal>();
                    int fromId = Acct(Str(d, "PaidFrom")), toId = Acct(Str(d, "ReceivedIn"));
                    Add(m, fromId, credit: amt); Add(m, toId, debit: amt);
                    PostJE(DocDate(d, "Date"), "Inter-account transfer", SourceDocType.AccountTransfer, m); nXfer++;
                    // First-class AccountTransfer row so it shows on the Transfers screen.
                    if (fromId != toId && amt != 0)
                        transferRows.Add(new AccountTransfer { CompanyId = companyId, Number = ++tnum, Date = DocDate(d, "Date"), FromAccountId = fromId, ToAccountId = toId, Amount = amt, Description = Str(d, "Description") });
                }
                // Manual journals: post the lines VERBATIM (preserve Manager's exact
                // line structure, incl. same-account contras) and ALWAYS create the
                // entry — even a blank/empty journal (0 lines) — so the count matches
                // Manager's Journal Entries tab to the record.
                foreach (var d in ArrOf(detailDocs, "journal-entries"))
                {
                    var lines = new List<JournalLine>(); decimal dr = 0m, cr = 0m;
                    foreach (var ln in Lines(d))
                    {
                        decimal deb = Money(ln, "Debit"), cre = Money(ln, "Credit");
                        if (deb == 0m && cre == 0m) continue;
                        lines.Add(new JournalLine { AccountId = Acct(Str(ln, "Account")), Debit = deb, Credit = cre, Description = Str(ln, "LineDescription") });
                        dr += deb; cr += cre;
                    }
                    if (Math.Abs(dr - cr) >= 0.005m)   // plug any imbalance to Suspense
                    {
                        var diff = dr - cr;
                        lines.Add(new JournalLine { AccountId = suspenseId, Debit = diff < 0 ? -diff : 0m, Credit = diff > 0 ? diff : 0m });
                        plugged += Math.Abs(diff);
                    }
                    var jdate = DocDate(d, "Date"); if (jdate > maxDate) maxDate = jdate;
                    lineCount += lines.Count;
                    pending.Add(new JournalEntry
                    {
                        CompanyId = companyId, EntryNo = ++entryNo, Date = jdate,
                        Narration = $"Journal {Str(d, "Reference")}".Trim(), SourceDocType = SourceDocType.ManualJournal,
                        SourceDocId = null, Lines = lines,
                    });
                    nJrnl++;
                }
                await Flush();
                if (transferRows.Count > 0) { _db.AccountTransfers.AddRange(transferRows); await _db.SaveChangesAsync(); _db.ChangeTracker.Clear(); }
                report.Created["accountTransfers"] = transferRows.Count;

                // ── Migration true-up: reconcile every account to Manager exactly ──
                // Set each account's opening balance so (opening + Σ postings) equals
                // its Manager target — the TB balance (Retained earnings un-baked) or
                // the bank's actualBalance. This absorbs the paisa-level rounding drift
                // and the AR/AP advance-timing so the Chart of Accounts / balance sheet
                // match Manager to the rupee, WITHOUT an extra journal (the 131 stay
                // 131). Σ(targets) == 0, so the adjusted openings still balance.
                var postingByAcct = await _db.JournalLines
                    .Where(l => l.JournalEntry.CompanyId == companyId)
                    .GroupBy(l => l.AccountId)
                    .Select(g => new { A = g.Key, Net = g.Sum(x => x.Debit - x.Credit) })
                    .ToDictionaryAsync(x => x.A, x => x.Net);
                var allAccts = await _db.Accounts.Where(a => a.CompanyId == companyId).ToListAsync();
                int trued = 0; decimal trueupAbs = 0m, sumOpen = 0m; Account? suspenseAcct = null;
                foreach (var a in allAccts)
                {
                    decimal target;
                    if (a.ExternalRef?.StartsWith("mgr-bankcash:") == true)
                        target = bankActual.GetValueOrDefault(a.ExternalRef["mgr-bankcash:".Length..], 0m);
                    else if (a.Name.Equals("Retained earnings", StringComparison.OrdinalIgnoreCase))
                        target = tbSignedByName.GetValueOrDefault("Retained earnings", 0m) + netProfitCredit;  // starting (un-baked)
                    else
                        target = tbSignedByName.GetValueOrDefault(a.Name, 0m);   // 0 for accounts absent from the TB
                    decimal newOpening = Math.Round(target - postingByAcct.GetValueOrDefault(a.Id, 0m), 2);
                    decimal cur = a.OpeningBalanceIsDebit ? a.OpeningBalance : -a.OpeningBalance;
                    if (Math.Abs(newOpening - cur) >= 0.005m) { trueupAbs += Math.Abs(newOpening - cur); trued++; }
                    a.OpeningBalance = Math.Abs(newOpening); a.OpeningBalanceIsDebit = newOpening >= 0;
                    sumOpen += newOpening;
                    if (a.ControlType == ControlType.Suspense) suspenseAcct = a;
                }
                // Safety: any residual (orphan TB name / rounding) → Suspense, so the GL always balances.
                if (Math.Abs(sumOpen) >= 0.005m && suspenseAcct != null)
                {
                    decimal adj = (suspenseAcct.OpeningBalanceIsDebit ? suspenseAcct.OpeningBalance : -suspenseAcct.OpeningBalance) - sumOpen;
                    suspenseAcct.OpeningBalance = Math.Abs(adj); suspenseAcct.OpeningBalanceIsDebit = adj >= 0;
                }
                await _db.SaveChangesAsync();
                report.Created["reconciledAccounts"] = trued;
                report.Notes.Add($"Migration true-up: reconciled {trued} account(s) to Manager's trial balance (Σ adjustments {trueupAbs:N2}) — Chart of Accounts matches Manager to the rupee.");

                // Perpetual GL is live: balances/ledgers derive from these entries.
                // Lock the migrated period (GlLockDate = latest migrated doc date):
                // migrated documents can't be edited into the ledger and a GL
                // rebuild skips them, while NEW documents dated after post normally
                // (the cutover). The ManualJournal entries above bypass this lock.
                // Re-load the company: the per-batch ChangeTracker.Clear() above
                // detached the instance fetched at the top, so mutating it wouldn't persist.
                var co = await _db.Companies.FirstAsync(c => c.Id == companyId);
                co.GlPostingEnabled = true;
                co.GlLockDate = maxDate == default ? null : maxDate.Date;
                await _db.SaveChangesAsync();
                if (co.GlLockDate is DateTime gl) report.Notes.Add($"GL cutover (lock) date set to {gl:dd/MM/yyyy}; new documents after it post to the live GL.");

                report.Created["coaGroups"] = groupId.Count + 1;
                report.Created["coaAccounts"] = coaNameByGuid.Count - 1 + bankNameByGuid.Count;   // −1 roll-up
                report.Created["journalEntries"] = entryNo;
                report.Created["journalLines"] = lineCount;
                report.Created["salesInvoices"] = nInv; report.Created["notes"] = nNote; report.Created["purchaseBills"] = nBill;
                report.Created["receipts"] = nRcp; report.Created["payments"] = nPmt; report.Created["transfers"] = nXfer; report.Created["journals"] = nJrnl;
                if (plugged > 0.005m) report.Notes.Add($"Rounding/residual plugged to Suspense: {plugged:N2} (across all entries).");
                report.Notes.Add("Perpetual GL posted as ManualJournal entries; GlPostingEnabled=true. Balances = starting balance + these entries.");

                if (dryRun) { await tx.RollbackAsync(); report.Notes.Add("DRY RUN — rolled back."); }
                else await tx.CommitAsync();
                return report;
            }
            catch { await tx.RollbackAsync(); throw; }
        }
    }
}

using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>See <see cref="IPostingService"/> for the contract. Account
    /// resolution order per role is documented on <see cref="ResolveAsync"/>;
    /// anything unresolvable lands on the Suspense account (created on demand)
    /// so the books stay balanced and the gap is visible on the CoA.</summary>
    public class PostingService : IPostingService
    {
        private readonly AppDbContext _context;
        private readonly ILogger<PostingService> _logger;

        public PostingService(AppDbContext context, ILogger<PostingService> logger)
        {
            _context = context;
            _logger = logger;
        }

        // Cached per scoped instance — one request never flips the flag mid-way.
        private readonly Dictionary<int, (bool Enabled, DateTime? LockDate)> _flags = new();

        private async Task<(bool Enabled, DateTime? LockDate)> FlagsAsync(int companyId)
        {
            if (_flags.TryGetValue(companyId, out var f)) return f;
            var row = await _context.Companies.AsNoTracking()
                .Where(c => c.Id == companyId)
                .Select(c => new { c.GlPostingEnabled, c.GlLockDate })
                .FirstOrDefaultAsync();
            var result = (row?.GlPostingEnabled ?? false, row?.GlLockDate);
            _flags[companyId] = result;
            return result;
        }

        public async Task<bool> IsEnabledAsync(int companyId) => (await FlagsAsync(companyId)).Enabled;

        public async Task AssertPeriodOpenAsync(int companyId, DateTime docDate)
        {
            var (enabled, lockDate) = await FlagsAsync(companyId);
            if (enabled && lockDate.HasValue && docDate.Date <= lockDate.Value.Date)
                throw new InvalidOperationException(
                    $"This period is locked (lock date {lockDate.Value:dd/MM/yyyy}). Documents dated on or before it can't be changed.");
        }

        // ── Payments / receipts ────────────────────────────────────────────────

        public async Task PostPaymentAsync(Payment payment)
        {
            if (!await IsEnabledAsync(payment.CompanyId)) return;
            if (payment.IsCancelled || payment.Amount == 0)
            {
                await RemoveForSourceAsync(payment.CompanyId, SourceDocType.Payment, payment.Id);
                return;
            }

            var accounts = await LoadAccountsAsync(payment.CompanyId);
            var bank = payment.BankAccountId.HasValue
                ? accounts.FirstOrDefault(a => a.Id == payment.BankAccountId.Value)
                : null;
            bank ??= await ResolveAsync(payment.CompanyId, accounts, ControlType.BankCash, "bank/cash");

            var isReceipt = payment.Direction == PaymentDirection.Receipt;
            var reference = $"{(isReceipt ? "RCP" : "PMT")}-{payment.Number:D4}";
            var lines = new List<JournalLine>();

            // The money leg: receipt debits the bank, payment credits it.
            AddLine(lines, bank.Id, debit: isReceipt ? payment.Amount : 0m,
                credit: isReceipt ? 0m : payment.Amount, payment.DivisionId, reference);

            // The settlement legs, one per allocation.
            foreach (var a in payment.Allocations)
            {
                if (a.Amount == 0) continue;
                Account target;
                string? partyType = null; int? partyId = null;
                if (a.InvoiceId.HasValue)
                {
                    target = await ResolveAsync(payment.CompanyId, accounts, ControlType.AccountsReceivable, "accounts receivable");
                    partyType = payment.ContactType == "Client" ? "Client" : null;
                    partyId = partyType != null ? payment.ContactId : null;
                }
                else if (a.PurchaseBillId.HasValue)
                {
                    target = await ResolveAsync(payment.CompanyId, accounts, ControlType.AccountsPayable, "accounts payable");
                    partyType = payment.ContactType == "Supplier" ? "Supplier" : null;
                    partyId = partyType != null ? payment.ContactId : null;
                }
                else if (a.AccountId.HasValue)
                {
                    // Direct income/expense line — post straight to the picked account.
                    target = accounts.FirstOrDefault(x => x.Id == a.AccountId.Value)
                        ?? await SuspenseAsync(payment.CompanyId, accounts);
                }
                else continue;

                lines.Add(new JournalLine
                {
                    AccountId = target.Id,
                    Debit = isReceipt ? 0m : a.Amount,
                    Credit = isReceipt ? a.Amount : 0m,
                    PartyType = partyType,
                    PartyId = partyId,
                    InvoiceId = a.InvoiceId,
                    PurchaseBillId = a.PurchaseBillId,
                    DivisionId = payment.DivisionId,
                    Description = payment.Description,
                });
            }

            // On-account remainder: money moved but not fully matched by settlement
            // legs — an advance/prepayment, a receipt/payment on account, or a
            // migrated document whose income/expense lines aren't mapped to
            // accounts. Plug the difference to Suspense so the entry balances,
            // honouring this engine's "unresolved amounts land on Suspense"
            // contract. Without it the lone bank leg throws "unbalanced posting"
            // and aborts a GL enable/rebuild.
            var drSum = lines.Sum(l => l.Debit);
            var crSum = lines.Sum(l => l.Credit);
            if (drSum != crSum)
            {
                var suspense = await SuspenseAsync(payment.CompanyId, accounts);
                var diff = drSum - crSum;   // > 0 → short a credit; < 0 → short a debit
                AddLine(lines, suspense.Id, debit: diff < 0 ? -diff : 0m, credit: diff > 0 ? diff : 0m,
                    payment.DivisionId, reference);
            }

            await WriteEntryAsync(payment.CompanyId, SourceDocType.Payment, payment.Id,
                payment.Date, Narration(reference, payment.Description), payment.DivisionId, lines);
        }

        // ── Sales invoices + credit/debit notes ────────────────────────────────

        public async Task PostInvoiceAsync(Invoice invoice)
        {
            if (!await IsEnabledAsync(invoice.CompanyId)) return;
            if (invoice.IsDemo || invoice.IsCancelled || invoice.GrandTotal == 0)
            {
                await RemoveForSourceAsync(invoice.CompanyId, SourceDocType.Invoice, invoice.Id);
                return;
            }

            var accounts = await LoadAccountsAsync(invoice.CompanyId);
            var ar = await ResolveAsync(invoice.CompanyId, accounts, ControlType.AccountsReceivable, "accounts receivable");
            var sales = await ResolveSalesAsync(invoice.CompanyId, accounts);
            var outputTax = invoice.GSTAmount != 0
                ? await ResolveAsync(invoice.CompanyId, accounts, ControlType.OutputTax, "output tax")
                : null;

            // Credit Note (10) reverses the sale; invoice + Debit Note (9) post
            // in the sale direction.
            var isCreditNote = invoice.DocumentType == 10;
            var label = invoice.DocumentType switch
            {
                10 => $"Credit Note #{invoice.InvoiceNumber}",
                9 => $"Debit Note #{invoice.InvoiceNumber}",
                _ => $"Invoice #{invoice.InvoiceNumber}",
            };
            var net = invoice.GrandTotal - invoice.GSTAmount;

            // Non-inventory lines (Freight, Discount, …) split their net off the
            // default Sales account onto their mapped SaleAccount (Suspense when
            // unmapped/inactive). The remainder posts to Sales — the entry stays
            // balanced because Σ(non-inv net) + salesNet == net.
            var nonInvRaw = await (
                from i in _context.InvoiceItems
                where i.InvoiceId == invoice.Id && i.NonInventoryItemId != null
                join n in _context.NonInventoryItems on i.NonInventoryItemId equals n.Id
                group i.LineTotal by n.SaleAccountId into g
                select new { AccountId = g.Key, Net = g.Sum() }).ToListAsync();
            var nonInvByAccount = await ResolveNonInvNetAsync(
                nonInvRaw.Select(x => (x.AccountId, x.Net)), accounts, invoice.CompanyId);
            var salesNet = net - nonInvByAccount.Values.Sum();

            var lines = new List<JournalLine>();
            var arLine = new JournalLine
            {
                AccountId = ar.Id,
                Debit = isCreditNote ? 0m : invoice.GrandTotal,
                Credit = isCreditNote ? invoice.GrandTotal : 0m,
                PartyType = "Client",
                PartyId = invoice.ClientId,
                InvoiceId = invoice.Id,
                DivisionId = invoice.DivisionId,
                Description = label,
            };
            lines.Add(arLine);
            AddLine(lines, sales.Id, debit: isCreditNote ? salesNet : 0m,
                credit: isCreditNote ? 0m : salesNet, invoice.DivisionId, label);
            foreach (var kv in nonInvByAccount)
                AddLine(lines, kv.Key, debit: isCreditNote ? kv.Value : 0m,
                    credit: isCreditNote ? 0m : kv.Value, invoice.DivisionId, label);
            if (outputTax != null)
                AddLine(lines, outputTax.Id, debit: isCreditNote ? invoice.GSTAmount : 0m,
                    credit: isCreditNote ? 0m : invoice.GSTAmount, invoice.DivisionId, label);

            await WriteEntryAsync(invoice.CompanyId, SourceDocType.Invoice, invoice.Id,
                invoice.Date, label, invoice.DivisionId, lines);
        }

        // ── Purchase bills ─────────────────────────────────────────────────────

        public async Task PostPurchaseBillAsync(PurchaseBill bill)
        {
            if (!await IsEnabledAsync(bill.CompanyId)) return;
            if (bill.GrandTotal == 0)
            {
                await RemoveForSourceAsync(bill.CompanyId, SourceDocType.PurchaseBill, bill.Id);
                return;
            }

            var accounts = await LoadAccountsAsync(bill.CompanyId);
            var ap = await ResolveAsync(bill.CompanyId, accounts, ControlType.AccountsPayable, "accounts payable");
            var purchases = await ResolvePurchasesAsync(bill.CompanyId, accounts);
            var inputTax = bill.GSTAmount != 0
                ? await ResolveAsync(bill.CompanyId, accounts, ControlType.InputTax, "input tax")
                : null;

            var label = $"Bill #{bill.PurchaseBillNumber}";
            var net = bill.GrandTotal - bill.GSTAmount;

            // Non-inventory lines split their net off the default Purchases
            // account onto their mapped PurchaseAccount (Suspense when unmapped).
            var nonInvRaw = await (
                from p in _context.PurchaseItems
                where p.PurchaseBillId == bill.Id && p.NonInventoryItemId != null
                join n in _context.NonInventoryItems on p.NonInventoryItemId equals n.Id
                group p.LineTotal by n.PurchaseAccountId into g
                select new { AccountId = g.Key, Net = g.Sum() }).ToListAsync();
            var nonInvByAccount = await ResolveNonInvNetAsync(
                nonInvRaw.Select(x => (x.AccountId, x.Net)), accounts, bill.CompanyId);
            var purchasesNet = net - nonInvByAccount.Values.Sum();

            var lines = new List<JournalLine>();
            AddLine(lines, purchases.Id, debit: purchasesNet, credit: 0m, bill.DivisionId, label);
            foreach (var kv in nonInvByAccount)
                AddLine(lines, kv.Key, debit: kv.Value, credit: 0m, bill.DivisionId, label);
            if (inputTax != null)
                AddLine(lines, inputTax.Id, debit: bill.GSTAmount, credit: 0m, bill.DivisionId, label);
            lines.Add(new JournalLine
            {
                AccountId = ap.Id,
                Debit = 0m,
                Credit = bill.GrandTotal,
                PartyType = "Supplier",
                PartyId = bill.SupplierId,
                PurchaseBillId = bill.Id,
                DivisionId = bill.DivisionId,
                Description = label,
            });

            await WriteEntryAsync(bill.CompanyId, SourceDocType.PurchaseBill, bill.Id,
                bill.Date, label, bill.DivisionId, lines);
        }

        // ── Inter-account transfers ────────────────────────────────────────────

        public async Task PostTransferAsync(AccountTransfer transfer)
        {
            if (!await IsEnabledAsync(transfer.CompanyId)) return;

            var label = $"TRF-{transfer.Number:D4}";
            var lines = new List<JournalLine>();
            AddLine(lines, transfer.ToAccountId, debit: transfer.Amount, credit: 0m, transfer.DivisionId, label);
            AddLine(lines, transfer.FromAccountId, debit: 0m, credit: transfer.Amount, transfer.DivisionId, label);

            await WriteEntryAsync(transfer.CompanyId, SourceDocType.AccountTransfer, transfer.Id,
                transfer.Date, Narration(label, transfer.Description), transfer.DivisionId, lines);
        }

        // ── Removal ────────────────────────────────────────────────────────────

        public async Task RemoveForSourceAsync(int companyId, SourceDocType type, int sourceDocId)
        {
            // ExecuteDelete: set-based, no tracking; lines go via ON DELETE CASCADE.
            await _context.JournalEntries
                .Where(e => e.CompanyId == companyId && e.SourceDocType == type && e.SourceDocId == sourceDocId)
                .ExecuteDeleteAsync();
        }

        // ── Entry writer ───────────────────────────────────────────────────────

        private async Task WriteEntryAsync(int companyId, SourceDocType type, int sourceDocId,
            DateTime date, string? narration, int? divisionId, List<JournalLine> lines)
        {
            lines = lines.Where(l => l.Debit != 0m || l.Credit != 0m).ToList();
            if (lines.Count == 0)
            {
                await RemoveForSourceAsync(companyId, type, sourceDocId);
                return;
            }

            // The engine's core invariant — never persist an unbalanced entry.
            var dr = lines.Sum(l => l.Debit);
            var cr = lines.Sum(l => l.Credit);
            if (dr != cr)
                throw new InvalidOperationException(
                    $"Unbalanced posting for {type} #{sourceDocId}: Dr {dr:0.00##} vs Cr {cr:0.00##}.");

            var (_, lockDate) = await FlagsAsync(companyId);
            if (lockDate.HasValue && date.Date <= lockDate.Value.Date)
                throw new InvalidOperationException(
                    $"This period is locked (lock date {lockDate.Value:dd/MM/yyyy}).");

            await RemoveForSourceAsync(companyId, type, sourceDocId); // replace-on-edit

            var entry = new JournalEntry
            {
                CompanyId = companyId,
                Date = date.Date,
                Narration = narration,
                SourceDocType = type,
                SourceDocId = sourceDocId,
                DivisionId = divisionId,
                Lines = lines,
            };
            _context.JournalEntries.Add(entry);

            await NumberAllocationRetry.ExecuteAsync(async _ =>
            {
                entry.EntryNo = (await _context.JournalEntries
                    .Where(e => e.CompanyId == companyId)
                    .MaxAsync(e => (int?)e.EntryNo) ?? 0) + 1;
                await _context.SaveChangesAsync();
                return entry.Id;
            });
        }

        private static void AddLine(List<JournalLine> lines, int accountId, decimal debit,
            decimal credit, int? divisionId, string? description)
        {
            if (debit == 0m && credit == 0m) return;
            lines.Add(new JournalLine
            {
                AccountId = accountId,
                Debit = debit,
                Credit = credit,
                DivisionId = divisionId,
                Description = description,
            });
        }

        private static string? Narration(string reference, string? description) =>
            string.IsNullOrWhiteSpace(description) ? reference : $"{reference} — {description.Trim()}";

        // ── Account resolution ─────────────────────────────────────────────────

        private async Task<List<Account>> LoadAccountsAsync(int companyId) =>
            await _context.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId && a.IsActive)
                .ToListAsync();

        /// <summary>Resolution order: the (first, lowest-id) active account with
        /// the requested control type, else the Suspense account. A Suspense
        /// fallback is logged — it means the CoA is missing a role account and
        /// the figures will visibly pool on Suspense until the operator fixes
        /// the chart (matching the reference product's behaviour).</summary>
        private async Task<Account> ResolveAsync(int companyId, List<Account> accounts,
            ControlType role, string roleName)
        {
            var hit = accounts.Where(a => a.ControlType == role).OrderBy(a => a.Id).FirstOrDefault();
            if (hit != null) return hit;
            _logger.LogWarning("Company {CompanyId} has no {Role} account — posting to Suspense.", companyId, roleName);
            return await SuspenseAsync(companyId, accounts);
        }

        /// <summary>Collapse a set of (mappedAccountId, net) pairs from a
        /// document's non-inventory lines into accountId → net, resolving each
        /// to an ACTIVE account of that company (unmapped / inactive / missing →
        /// Suspense). Amounts on the same target account merge.</summary>
        private async Task<Dictionary<int, decimal>> ResolveNonInvNetAsync(
            IEnumerable<(int? AccountId, decimal Net)> raw, List<Account> accounts, int companyId)
        {
            var result = new Dictionary<int, decimal>();
            Account? suspense = null;
            foreach (var (accountId, net) in raw)
            {
                if (net == 0m) continue;
                var target = accountId.HasValue ? accounts.FirstOrDefault(a => a.Id == accountId.Value) : null;
                if (target == null) target = suspense ??= await SuspenseAsync(companyId, accounts);
                result[target.Id] = result.GetValueOrDefault(target.Id) + net;
            }
            return result;
        }

        /// <summary>Sales income: seed:sales → an account literally named
        /// "Sales" → the first Income account → Suspense.</summary>
        private async Task<Account> ResolveSalesAsync(int companyId, List<Account> accounts)
        {
            var hit = accounts.FirstOrDefault(a => a.ExternalRef == "seed:sales")
                   ?? accounts.FirstOrDefault(a => a.AccountType == AccountType.Income &&
                            string.Equals(a.Name, "Sales", StringComparison.OrdinalIgnoreCase))
                   ?? accounts.Where(a => a.AccountType == AccountType.Income).OrderBy(a => a.Id).FirstOrDefault();
            if (hit != null) return hit;
            _logger.LogWarning("Company {CompanyId} has no income account — posting sales to Suspense.", companyId);
            return await SuspenseAsync(companyId, accounts);
        }

        /// <summary>Purchases: the Inventory control account when the company
        /// tracks stock, else seed:cogs → a "cost of goods"-named expense →
        /// the first Expense account → Suspense.</summary>
        private async Task<Account> ResolvePurchasesAsync(int companyId, List<Account> accounts)
        {
            var tracksInventory = await _context.Companies.AsNoTracking()
                .Where(c => c.Id == companyId).Select(c => c.InventoryTrackingEnabled).FirstOrDefaultAsync();
            if (tracksInventory)
            {
                var inv = accounts.Where(a => a.ControlType == ControlType.Inventory).OrderBy(a => a.Id).FirstOrDefault();
                if (inv != null) return inv;
            }
            var hit = accounts.FirstOrDefault(a => a.ExternalRef == "seed:cogs")
                   ?? accounts.FirstOrDefault(a => a.AccountType == AccountType.Expense &&
                            a.Name.Contains("cost of goods", StringComparison.OrdinalIgnoreCase))
                   ?? accounts.Where(a => a.AccountType == AccountType.Expense).OrderBy(a => a.Id).FirstOrDefault();
            if (hit != null) return hit;
            _logger.LogWarning("Company {CompanyId} has no purchases/COGS account — posting to Suspense.", companyId);
            return await SuspenseAsync(companyId, accounts);
        }

        /// <summary>Finds — or creates — the company's Suspense account (Equity
        /// side, like the reference product). Created rows use seed:suspense so
        /// the operation is idempotent, and get IsControlAccount so they can't
        /// be deleted out from under the engine.</summary>
        private async Task<Account> SuspenseAsync(int companyId, List<Account> accounts)
        {
            var existing = accounts.FirstOrDefault(a => a.ControlType == ControlType.Suspense);
            if (existing != null) return existing;

            // Not in the cached list — re-check the DB (another caller in this
            // request may have created it), then create.
            var fromDb = await _context.Accounts
                .FirstOrDefaultAsync(a => a.CompanyId == companyId && a.ControlType == ControlType.Suspense);
            if (fromDb != null) { accounts.Add(fromDb); return fromDb; }

            var equityGroup = await _context.AccountGroups
                .Where(g => g.CompanyId == companyId && g.Statement == FinancialStatement.BalanceSheet)
                .OrderByDescending(g => g.IsSystem && g.Name == "Equity")
                .ThenByDescending(g => g.Name == "Equity")
                .ThenBy(g => g.Id)
                .FirstOrDefaultAsync();
            if (equityGroup == null)
            {
                equityGroup = new AccountGroup
                {
                    CompanyId = companyId,
                    Name = "Equity",
                    Statement = FinancialStatement.BalanceSheet,
                    IsSystem = true,
                    ExternalRef = "seed:equity",
                };
                _context.AccountGroups.Add(equityGroup);
            }

            var suspense = new Account
            {
                CompanyId = companyId,
                Name = "Suspense",
                AccountGroup = equityGroup,
                AccountType = AccountType.Equity,
                IsControlAccount = true,
                ControlType = ControlType.Suspense,
                IsActive = true,
                ExternalRef = "seed:suspense",
            };
            _context.Accounts.Add(suspense);
            await _context.SaveChangesAsync();
            accounts.Add(suspense);
            _logger.LogWarning("Created Suspense account for company {CompanyId}.", companyId);
            return suspense;
        }
    }
}

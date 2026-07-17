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
        private readonly Dictionary<int, CompanyGlConfig> _flags = new();

        private sealed record CompanyGlConfig(
            bool Enabled, DateTime? LockDate,
            int? DefaultSalesAccountId, int? DefaultPurchaseAccountId);

        private async Task<CompanyGlConfig> FlagsAsync(int companyId)
        {
            if (_flags.TryGetValue(companyId, out var f)) return f;
            var row = await _context.Companies.AsNoTracking()
                .Where(c => c.Id == companyId)
                .Select(c => new { c.GlPostingEnabled, c.GlLockDate, c.DefaultSalesAccountId, c.DefaultPurchaseAccountId })
                .FirstOrDefaultAsync();
            var result = new CompanyGlConfig(
                row?.GlPostingEnabled ?? false, row?.GlLockDate,
                row?.DefaultSalesAccountId, row?.DefaultPurchaseAccountId);
            _flags[companyId] = result;
            return result;
        }

        public async Task<bool> IsEnabledAsync(int companyId) => (await FlagsAsync(companyId)).Enabled;

        public async Task AssertPeriodOpenAsync(int companyId, DateTime docDate)
        {
            var (enabled, lockDate, _, _) = await FlagsAsync(companyId);
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

            // Split the net across the per-line resolved income accounts (design
            // §4/§6). Inventory item-type lines resolve to line → item-type
            // overlay → company default → Sales; non-inventory lines keep their
            // dedicated mapped account (Suspense when unmapped); any rounding
            // residual plugs to Sales so Σ == net and the entry stays balanced.
            var lineRows = await _context.InvoiceItems
                .Where(i => i.InvoiceId == invoice.Id)
                .Select(i => new LineForPosting(
                    i.LineTotal, i.AccountId, i.ItemTypeId, i.NonInventoryItemId,
                    i.NonInventoryItem != null ? i.NonInventoryItem.SaleAccountId : null))
                .ToListAsync();
            var byAccount = await GroupLinesByAccountAsync(
                invoice.CompanyId, accounts, isSale: true, lineRows, sales, net);

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
            foreach (var kv in byAccount)
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

            // Split the net across the per-line resolved expense/COGS accounts
            // (design §4/§6): inventory lines resolve to line → item-type overlay
            // → company default → Purchases/COGS; non-inventory lines keep their
            // mapped PurchaseAccount (Suspense when unmapped); residual plugs to
            // the default purchases account so Σ == net.
            var lineRows = await _context.PurchaseItems
                .Where(p => p.PurchaseBillId == bill.Id)
                .Select(p => new LineForPosting(
                    p.LineTotal, p.AccountId, p.ItemTypeId, p.NonInventoryItemId,
                    p.NonInventoryItem != null ? p.NonInventoryItem.PurchaseAccountId : null))
                .ToListAsync();
            var byAccount = await GroupLinesByAccountAsync(
                bill.CompanyId, accounts, isSale: false, lineRows, purchases, net);

            var lines = new List<JournalLine>();
            foreach (var kv in byAccount)
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

        // ── Purchase (supplier) debit notes ────────────────────────────────────

        public async Task PostPurchaseDebitNoteAsync(PurchaseDebitNote note)
        {
            if (!await IsEnabledAsync(note.CompanyId)) return;
            // Migration-created notes carry their financial effect in the
            // chart-of-accounts opening balances already — never retro-post them.
            if (note.IsMigrated) return;
            if (note.GrandTotal == 0)
            {
                await RemoveForSourceAsync(note.CompanyId, SourceDocType.PurchaseDebitNote, note.Id);
                return;
            }

            var accounts = await LoadAccountsAsync(note.CompanyId);
            var ap = await ResolveAsync(note.CompanyId, accounts, ControlType.AccountsPayable, "accounts payable");
            var purchases = await ResolvePurchasesAsync(note.CompanyId, accounts);
            var inputTax = note.GSTAmount != 0
                ? await ResolveAsync(note.CompanyId, accounts, ControlType.InputTax, "input tax")
                : null;

            var label = $"Debit Note #{note.DebitNoteNumber}";
            var net = note.GrandTotal - note.GSTAmount;

            // Same per-line account resolution a purchase bill uses (line →
            // item-type overlay → company default → Purchases/Inventory); a
            // supplier debit note has no non-inventory lines, so those refs are null.
            var lineRows = await _context.PurchaseDebitNoteItems
                .Where(p => p.PurchaseDebitNoteId == note.Id)
                .Select(p => new LineForPosting(p.LineTotal, p.AccountId, p.ItemTypeId, null, null))
                .ToListAsync();
            var byAccount = await GroupLinesByAccountAsync(
                note.CompanyId, accounts, isSale: false, lineRows, purchases, net);

            // Every side is the OPPOSITE of a purchase bill: Dr AP, Cr the split
            // accounts, Cr input tax.
            var lines = new List<JournalLine>
            {
                new JournalLine
                {
                    AccountId = ap.Id,
                    Debit = note.GrandTotal,
                    Credit = 0m,
                    PartyType = "Supplier",
                    PartyId = note.SupplierId,
                    DivisionId = note.DivisionId,
                    Description = label,
                },
            };
            foreach (var kv in byAccount)
                AddLine(lines, kv.Key, debit: 0m, credit: kv.Value, note.DivisionId, label);
            if (inputTax != null)
                AddLine(lines, inputTax.Id, debit: 0m, credit: note.GSTAmount, note.DivisionId, label);

            await WriteEntryAsync(note.CompanyId, SourceDocType.PurchaseDebitNote, note.Id,
                note.Date, label, note.DivisionId, lines);
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

            var (_, lockDate, _, _) = await FlagsAsync(companyId);
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

        /// <summary>A document line reduced to just what account resolution needs.
        /// <c>NonInvAccountId</c> is the line's NonInventoryItem sale-or-purchase
        /// account (side-specific, projected by the caller).</summary>
        private sealed record LineForPosting(
            decimal LineTotal, int? AccountId, int? ItemTypeId, int? NonInvItemId, int? NonInvAccountId);

        /// <summary>
        /// Group a document's line nets by their resolved GL account (design §4).
        /// Per line, first ACTIVE non-null of:
        ///   • non-inventory line → line.AccountId → NonInventoryItem account →
        ///     Suspense (a non-inv item's whole job is its mapped account; unmapped
        ///     pools on Suspense exactly as before).
        ///   • otherwise (inventory item-type / plain line) → line.AccountId →
        ///     CompanyItemTypeSetting.Sale/PurchaseAccountId → Company default →
        ///     <paramref name="fallback"/> (the ResolveSales/ResolvePurchases chain,
        ///     which itself ends at Suspense).
        /// Any rounding residual (net − Σ assigned) plugs to <paramref name="fallback"/>
        /// so the split always sums to the document net and the entry balances.
        /// </summary>
        private async Task<Dictionary<int, decimal>> GroupLinesByAccountAsync(
            int companyId, List<Account> accounts, bool isSale,
            List<LineForPosting> lines, Account fallback, decimal net)
        {
            var (_, _, defaultSalesId, defaultPurchaseId) = await FlagsAsync(companyId);
            var companyDefaultId = isSale ? defaultSalesId : defaultPurchaseId;

            var itemTypeIds = lines.Where(l => l.ItemTypeId.HasValue)
                .Select(l => l.ItemTypeId!.Value).Distinct().ToList();
            var citsMap = itemTypeIds.Count == 0
                ? new Dictionary<int, (int? Sale, int? Purchase)>()
                : (await _context.CompanyItemTypeSettings.AsNoTracking()
                        .Where(s => s.CompanyId == companyId && itemTypeIds.Contains(s.ItemTypeId))
                        .Select(s => new { s.ItemTypeId, s.SaleAccountId, s.PurchaseAccountId })
                        .ToListAsync())
                    .ToDictionary(s => s.ItemTypeId, s => (Sale: s.SaleAccountId, Purchase: s.PurchaseAccountId));

            var byAccount = new Dictionary<int, decimal>();
            Account? suspense = null;
            var assigned = 0m;
            foreach (var ln in lines)
            {
                if (ln.LineTotal == 0m) continue;
                Account target;
                if (ln.NonInvItemId.HasValue)
                {
                    var cand = ln.AccountId ?? ln.NonInvAccountId;
                    target = (cand.HasValue ? accounts.FirstOrDefault(a => a.Id == cand.Value) : null)
                             ?? (suspense ??= await SuspenseAsync(companyId, accounts));
                }
                else
                {
                    int? itemAcct = ln.ItemTypeId.HasValue && citsMap.TryGetValue(ln.ItemTypeId.Value, out var m)
                        ? (isSale ? m.Sale : m.Purchase) : null;
                    var cand = ln.AccountId ?? itemAcct ?? companyDefaultId;
                    target = (cand.HasValue ? accounts.FirstOrDefault(a => a.Id == cand.Value) : null) ?? fallback;
                }
                byAccount[target.Id] = byAccount.GetValueOrDefault(target.Id) + ln.LineTotal;
                assigned += ln.LineTotal;
            }

            var residual = net - assigned;
            if (residual != 0m)
                byAccount[fallback.Id] = byAccount.GetValueOrDefault(fallback.Id) + residual;
            return byAccount;
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

        // ── Default inventory GL accounts (design §3.2.1) ───────────────────────

        /// <summary>
        /// Guarantees the company's Chart of Accounts holds a default inventory
        /// <b>sales</b> (income) and <b>purchase/COGS</b> (expense) account, and
        /// points <see cref="Company.DefaultSalesAccountId"/> /
        /// <see cref="Company.DefaultPurchaseAccountId"/> at them. Idempotent
        /// (adopts the seeded <c>seed:sales</c>/<c>seed:cogs</c> or any existing
        /// income/expense account before creating), so it's safe to call on the
        /// GL-enable path, at company setup, and lazily. Never creates a duplicate
        /// — lookup keys off <c>ExternalRef</c> then account type.
        /// </summary>
        public async Task EnsureDefaultInventoryAccountsAsync(int companyId)
        {
            var company = await _context.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
            if (company == null) return;

            var accounts = await _context.Accounts
                .Where(a => a.CompanyId == companyId).ToListAsync();

            bool Missing(int? id) => id == null || !accounts.Any(a => a.Id == id.Value && a.IsActive);

            if (Missing(company.DefaultSalesAccountId))
            {
                var sales = accounts.FirstOrDefault(a => a.ExternalRef == "seed:inv-sales")
                         ?? accounts.FirstOrDefault(a => a.ExternalRef == "seed:sales")
                         ?? accounts.FirstOrDefault(a => a.AccountType == AccountType.Income &&
                                string.Equals(a.Name, "Sales", StringComparison.OrdinalIgnoreCase))
                         ?? accounts.Where(a => a.AccountType == AccountType.Income).OrderBy(a => a.Id).FirstOrDefault();
                if (sales == null)
                {
                    var group = await EnsurePlGroupAsync(companyId, AccountType.Income, accounts);
                    sales = new Account
                    {
                        CompanyId = companyId,
                        Name = "Inventory – sales",
                        AccountGroup = group,
                        AccountType = AccountType.Income,
                        IsActive = true,
                        ExternalRef = "seed:inv-sales",
                    };
                    _context.Accounts.Add(sales);
                    await _context.SaveChangesAsync();
                    accounts.Add(sales);
                }
                company.DefaultSalesAccountId = sales.Id;
            }

            if (Missing(company.DefaultPurchaseAccountId))
            {
                // Match ResolvePurchasesAsync so pinning the default is behaviour-
                // neutral: an inventory-tracking company debits its Inventory asset
                // control account; everyone else uses COGS. Only item-type / line
                // overrides deviate from this baseline.
                Account? cogs = company.InventoryTrackingEnabled
                    ? accounts.Where(a => a.ControlType == ControlType.Inventory).OrderBy(a => a.Id).FirstOrDefault()
                    : null;
                cogs ??= accounts.FirstOrDefault(a => a.ExternalRef == "seed:inv-purchases")
                        ?? accounts.FirstOrDefault(a => a.ExternalRef == "seed:cogs")
                        ?? accounts.FirstOrDefault(a => a.AccountType == AccountType.Expense &&
                               a.Name.Contains("cost of goods", StringComparison.OrdinalIgnoreCase))
                        ?? accounts.Where(a => a.AccountType == AccountType.Expense).OrderBy(a => a.Id).FirstOrDefault();
                if (cogs == null)
                {
                    var group = await EnsurePlGroupAsync(companyId, AccountType.Expense, accounts);
                    cogs = new Account
                    {
                        CompanyId = companyId,
                        Name = "Cost of goods sold",
                        AccountGroup = group,
                        AccountType = AccountType.Expense,
                        IsActive = true,
                        ExternalRef = "seed:inv-purchases",
                    };
                    _context.Accounts.Add(cogs);
                    await _context.SaveChangesAsync();
                    accounts.Add(cogs);
                }
                company.DefaultPurchaseAccountId = cogs.Id;
            }

            await _context.SaveChangesAsync();
            _flags.Remove(companyId); // drop cached defaults so this request re-reads them
        }

        /// <summary>Find — or create — the P&amp;L income / expense statement group
        /// for a company (mirrors the CoA preset's "Income" / "Expenses" groups).
        /// Never touches the Balance Sheet.</summary>
        private async Task<AccountGroup> EnsurePlGroupAsync(int companyId, AccountType type, List<Account> _)
        {
            var isIncome = type == AccountType.Income;
            var seedRef = isIncome ? "seed:income" : "seed:expenses";
            var name = isIncome ? "Income" : "Expenses";

            var group = await _context.AccountGroups
                .Where(g => g.CompanyId == companyId && g.Statement == FinancialStatement.ProfitAndLoss)
                .OrderByDescending(g => g.ExternalRef == seedRef)
                .ThenByDescending(g => g.Name == name)
                .ThenBy(g => g.Id)
                .FirstOrDefaultAsync();
            if (group != null && (group.ExternalRef == seedRef || group.Name == name)) return group;

            var created = new AccountGroup
            {
                CompanyId = companyId,
                Name = name,
                Statement = FinancialStatement.ProfitAndLoss,
                IsSystem = true,
                ExternalRef = seedRef,
            };
            _context.AccountGroups.Add(created);
            await _context.SaveChangesAsync();
            return created;
        }
    }
}

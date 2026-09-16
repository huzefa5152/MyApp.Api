using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>See <see cref="IPostingService"/> for the contract. Account
    /// resolution per role is documented on <see cref="ResolveAsync"/>; anything
    /// unresolvable lands on a Suspense account created on demand, so the books
    /// stay balanced and the gap is visible on the chart instead of stopping the
    /// operator from saving their bill.</summary>
    public class PostingService : IPostingService
    {
        private readonly AppDbContext _context;
        private readonly IGeneralLedgerService _gl;
        private readonly ILogger<PostingService> _logger;

        public PostingService(AppDbContext context, IGeneralLedgerService gl, ILogger<PostingService> logger)
        {
            _context = context;
            _gl = gl;
            _logger = logger;
        }

        // Cached per scoped instance, so one request can't see the flag flip
        // half-way through posting a document.
        private readonly Dictionary<int, bool> _enabled = new();

        private async Task<bool> IsEnabledAsync(int companyId)
        {
            if (_enabled.TryGetValue(companyId, out var e)) return e;
            var v = await _gl.IsEnabledAsync(companyId);
            _enabled[companyId] = v;
            return v;
        }

        // ── Sales invoices, credit notes and debit notes ──────────────────────

        public async Task PostInvoiceAsync(Invoice invoice)
        {
            if (!await IsEnabledAsync(invoice.CompanyId)) return;

            // A demo bill is excluded from every KPI, a cancelled one has been
            // withdrawn, and a zero-total one moves nothing. None of the three
            // is a transaction, so none of them leaves an entry behind.
            if (invoice.IsDemo || invoice.IsCancelled || invoice.GrandTotal == 0m)
            {
                await RemoveForSourceAsync(invoice.CompanyId, SourceDocType.Invoice, invoice.Id);
                return;
            }

            var accounts = await LoadAccountsAsync(invoice.CompanyId);
            var ar = await ResolveAsync(invoice.CompanyId, accounts, ControlType.AccountsReceivable, "accounts receivable");
            var sales = await ResolveSalesAsync(invoice.CompanyId, accounts);

            // A credit note reverses the sale; an invoice and a debit note both
            // post in the sale direction.
            var isCreditNote = invoice.DocumentType == 10;
            var label = invoice.DocumentType switch
            {
                10 => $"Credit Note #{invoice.InvoiceNumber}",
                9 => $"Debit Note #{invoice.InvoiceNumber}",
                _ => $"Invoice #{invoice.InvoiceNumber}",
            };

            // THE SALE ITSELF, derived by subtraction. Further tax is INSIDE the
            // grand total, so it has to come off here as well as sales tax —
            // miss it and the tax is credited to Sales as revenue, the entry
            // still balances, and the income statement is quietly overstated by
            // exactly the tax collected. That is the worst shape a bug can take
            // in this file, which is why the figure is named and commented
            // rather than inlined.
            var net = invoice.GrandTotal - invoice.GSTAmount - invoice.FurtherTaxAmount;

            // Withholding splits the receivable: the customer settles only the
            // collectible, and the withheld slice becomes a receivable from FBR
            // rather than money we have lost.
            var wht = invoice.WithholdingTaxAmount;
            var collectible = invoice.GrandTotal - wht;

            var lines = new List<JournalLine>
            {
                new()
                {
                    AccountId = ar.Id,
                    Debit = isCreditNote ? 0m : collectible,
                    Credit = isCreditNote ? collectible : 0m,
                    PartyType = "Client",
                    PartyId = invoice.ClientId,
                    InvoiceId = invoice.Id,
                    Description = label,
                },
            };

            AddLine(lines, sales.Id, debit: isCreditNote ? net : 0m, credit: isCreditNote ? 0m : net, label);

            if (invoice.GSTAmount != 0m)
            {
                var outputTax = await ResolveAsync(invoice.CompanyId, accounts, ControlType.OutputTax, "output tax");
                AddLine(lines, outputTax.Id,
                    debit: isCreditNote ? invoice.GSTAmount : 0m,
                    credit: isCreditNote ? 0m : invoice.GSTAmount, label);
            }

            if (invoice.FurtherTaxAmount != 0m)
            {
                // Its OWN liability, never Output Sales Tax: the tax reports
                // read that account straight from the ledger and check it
                // against GST on sales, and a second rate mixed into it would
                // break exactly the check they exist to perform.
                var furtherTax = await ResolveAsync(invoice.CompanyId, accounts, ControlType.FurtherTaxPayable, "further tax payable");
                AddLine(lines, furtherTax.Id,
                    debit: isCreditNote ? invoice.FurtherTaxAmount : 0m,
                    credit: isCreditNote ? 0m : invoice.FurtherTaxAmount, label);
            }

            if (wht != 0m)
            {
                var whtReceivable = await ResolveAsync(invoice.CompanyId, accounts, ControlType.WithholdingReceivable, "withholding tax receivable");
                AddLine(lines, whtReceivable.Id,
                    debit: isCreditNote ? 0m : wht,
                    credit: isCreditNote ? wht : 0m, label);
            }

            await WriteAsync(invoice.CompanyId, SourceDocType.Invoice, invoice.Id, invoice.Date, label, lines);
        }

        // ── Purchase bills ────────────────────────────────────────────────────

        public async Task PostPurchaseBillAsync(PurchaseBill bill)
        {
            if (!await IsEnabledAsync(bill.CompanyId)) return;
            if (bill.GrandTotal == 0m)
            {
                await RemoveForSourceAsync(bill.CompanyId, SourceDocType.PurchaseBill, bill.Id);
                return;
            }

            var accounts = await LoadAccountsAsync(bill.CompanyId);
            var ap = await ResolveAsync(bill.CompanyId, accounts, ControlType.AccountsPayable, "accounts payable");
            var purchases = await ResolvePurchasesAsync(bill.CompanyId, accounts);

            var label = $"Bill #{bill.PurchaseBillNumber}";
            // No further tax on the purchase side: a supplier's further tax
            // arrives inside their bill total as part of what we owe them.
            var net = bill.GrandTotal - bill.GSTAmount;
            var wht = bill.WithholdingTaxAmount;
            var collectible = bill.GrandTotal - wht;

            var lines = new List<JournalLine>();
            AddLine(lines, purchases.Id, debit: net, credit: 0m, label);

            if (bill.GSTAmount != 0m)
            {
                var inputTax = await ResolveAsync(bill.CompanyId, accounts, ControlType.InputTax, "input tax");
                AddLine(lines, inputTax.Id, debit: bill.GSTAmount, credit: 0m, label);
            }

            lines.Add(new JournalLine
            {
                AccountId = ap.Id,
                Debit = 0m,
                Credit = collectible,
                PartyType = "Supplier",
                PartyId = bill.SupplierId,
                PurchaseBillId = bill.Id,
                Description = label,
            });

            if (wht != 0m)
            {
                // We withheld it, so we owe FBR rather than the supplier.
                var whtPayable = await ResolveAsync(bill.CompanyId, accounts, ControlType.WithholdingPayable, "withholding tax payable");
                AddLine(lines, whtPayable.Id, debit: 0m, credit: wht, label);
            }

            await WriteAsync(bill.CompanyId, SourceDocType.PurchaseBill, bill.Id, bill.Date, label, lines);
        }

        // ── Receipts and payments ─────────────────────────────────────────────

        public async Task PostPaymentAsync(Payment payment)
        {
            if (!await IsEnabledAsync(payment.CompanyId)) return;
            if (payment.IsCancelled || payment.Amount == 0m)
            {
                await RemoveForSourceAsync(payment.CompanyId, SourceDocType.Payment, payment.Id);
                return;
            }

            var accounts = await LoadAccountsAsync(payment.CompanyId);

            // An explicitly-chosen bank account posts to ITSELF even if it has
            // since been deactivated: `accounts` is active-only, so fall back to
            // a direct tenant-scoped load before the role default. Without this,
            // re-posting an old receipt whose bank account was later retired
            // would silently reroute the money to a different one.
            Account? bank = null;
            if (payment.BankAccountId.HasValue)
            {
                bank = accounts.FirstOrDefault(a => a.Id == payment.BankAccountId.Value)
                    ?? await _context.Accounts.AsNoTracking().FirstOrDefaultAsync(a =>
                           a.Id == payment.BankAccountId.Value && a.CompanyId == payment.CompanyId);
            }
            bank ??= await ResolveAsync(payment.CompanyId, accounts, ControlType.BankCash, "bank/cash");

            var isReceipt = payment.Direction == PaymentDirection.Receipt;
            var label = $"{(isReceipt ? "RCP" : "PMT")}-{payment.Number:D4}";
            var partyType = NormalizePartyType(payment.ContactType);

            var lines = new List<JournalLine>();

            // The money leg: a receipt debits the bank, a payment credits it.
            AddLine(lines, bank.Id,
                debit: isReceipt ? payment.Amount : 0m,
                credit: isReceipt ? 0m : payment.Amount, label);

            var allocations = payment.Allocations?.ToList()
                ?? await _context.PaymentAllocations.AsNoTracking()
                       .Where(a => a.PaymentId == payment.Id).ToListAsync();

            decimal allocated = 0m;
            foreach (var a in allocations)
            {
                if (a.Amount == 0m) continue;
                allocated += a.Amount;

                if (a.InvoiceId.HasValue)
                {
                    // Settling a sales invoice clears receivable.
                    var ar = await ResolveAsync(payment.CompanyId, accounts, ControlType.AccountsReceivable, "accounts receivable");
                    lines.Add(new JournalLine
                    {
                        AccountId = ar.Id,
                        Debit = isReceipt ? 0m : a.Amount,
                        Credit = isReceipt ? a.Amount : 0m,
                        PartyType = partyType ?? "Client",
                        PartyId = payment.ContactId,
                        InvoiceId = a.InvoiceId,
                        Description = label,
                    });
                }
                else if (a.PurchaseBillId.HasValue)
                {
                    var ap = await ResolveAsync(payment.CompanyId, accounts, ControlType.AccountsPayable, "accounts payable");
                    lines.Add(new JournalLine
                    {
                        AccountId = ap.Id,
                        Debit = isReceipt ? 0m : a.Amount,
                        Credit = isReceipt ? a.Amount : 0m,
                        PartyType = partyType ?? "Supplier",
                        PartyId = payment.ContactId,
                        PurchaseBillId = a.PurchaseBillId,
                        Description = label,
                    });
                }
                else if (a.AccountId.HasValue)
                {
                    // A direct income or expense line with no document behind it.
                    var target = accounts.FirstOrDefault(x => x.Id == a.AccountId.Value)
                              ?? await SuspenseAsync(payment.CompanyId, accounts);
                    lines.Add(new JournalLine
                    {
                        AccountId = target.Id,
                        Debit = isReceipt ? 0m : a.Amount,
                        Credit = isReceipt ? a.Amount : 0m,
                        PartyType = partyType,
                        PartyId = partyType == null ? null : payment.ContactId,
                        Description = label,
                    });
                }
                else
                {
                    // An allocation naming nothing at all is an advance in
                    // disguise; let the remainder handling below place it.
                    allocated -= a.Amount;
                }
            }

            var remainder = payment.Amount - allocated;
            if (remainder != 0m)
            {
                // Money received (or paid) beyond what it settles is an advance.
                // It posts to the PARTY's own control account — receivable for a
                // client, payable for a supplier — so it stays on that party's
                // balance where the ledger and the aged reports can see it, and
                // one rule covers customer advances, supplier advances and both
                // refunds. With no party named there is nothing to attribute it
                // to, so it goes to Suspense where it is visible.
                //
                // NOT REACHABLE THROUGH THE PAYMENTS API TODAY: PaymentService
                // sets Payment.Amount to the sum of its allocations, so the
                // remainder is always zero. This stays because Amount is a
                // stored column an import or a back-post could set on its own,
                // and a posting engine that cannot balance what it is handed is
                // worse than one that carries an unused branch.
                var target = partyType switch
                {
                    "Client" => await ResolveAsync(payment.CompanyId, accounts, ControlType.AccountsReceivable, "accounts receivable"),
                    "Supplier" => await ResolveAsync(payment.CompanyId, accounts, ControlType.AccountsPayable, "accounts payable"),
                    _ => await SuspenseAsync(payment.CompanyId, accounts),
                };
                lines.Add(new JournalLine
                {
                    AccountId = target.Id,
                    Debit = isReceipt ? 0m : remainder,
                    Credit = isReceipt ? remainder : 0m,
                    PartyType = partyType,
                    PartyId = partyType == null ? null : payment.ContactId,
                    Description = $"{label} — on account",
                });
            }

            await WriteAsync(payment.CompanyId, SourceDocType.Payment, payment.Id, payment.Date, label, lines);
        }

        // ── Removal ───────────────────────────────────────────────────────────

        public Task RemoveForSourceAsync(int companyId, SourceDocType type, int sourceDocId) =>
            _gl.RemoveForDocumentAsync(companyId, type, sourceDocId);

        // ── Rebuild ───────────────────────────────────────────────────────────

        public async Task<PostingRebuildResult> RebuildAsync(int companyId)
        {
            var result = new PostingRebuildResult();
            if (!await IsEnabledAsync(companyId)) return result;

            await EnsureDefaultAccountsAsync(companyId);

            // System-posted entries only. A manual journal is the operator's
            // own work and nothing here can reproduce it, so a rebuild that
            // took them out would destroy data no document can restore.
            result.RemovedEntries = await _context.JournalEntries
                .Where(e => e.CompanyId == companyId && e.SourceDocType != SourceDocType.ManualJournal)
                .ExecuteDeleteAsync();

            var invoices = await _context.Invoices
                .Where(i => i.CompanyId == companyId).ToListAsync();
            foreach (var i in invoices)
            {
                await PostInvoiceAsync(i);
                if (!i.IsDemo && !i.IsCancelled && i.GrandTotal != 0m) result.PostedInvoices++;
            }

            var bills = await _context.PurchaseBills
                .Where(b => b.CompanyId == companyId).ToListAsync();
            foreach (var b in bills)
            {
                await PostPurchaseBillAsync(b);
                if (b.GrandTotal != 0m) result.PostedPurchaseBills++;
            }

            var payments = await _context.Payments
                .Include(p => p.Allocations)
                .Where(p => p.CompanyId == companyId).ToListAsync();
            foreach (var p in payments)
            {
                await PostPaymentAsync(p);
                if (!p.IsCancelled && p.Amount != 0m) result.PostedPayments++;
            }

            return result;
        }

        // ── Writing ───────────────────────────────────────────────────────────

        /// <summary>Hands the legs to the ledger. Zero-value lines are dropped
        /// first, and an entry that ends up with nothing on it removes the
        /// document's entry rather than writing an empty one.</summary>
        private async Task WriteAsync(int companyId, SourceDocType type, int sourceDocId,
            DateTime date, string? narration, List<JournalLine> lines)
        {
            lines = lines.Where(l => l.Debit != 0m || l.Credit != 0m).ToList();
            if (lines.Count == 0)
            {
                await RemoveForSourceAsync(companyId, type, sourceDocId);
                return;
            }

            await _gl.WriteEntryAsync(new JournalEntry
            {
                CompanyId = companyId,
                Date = date.Date,
                Narration = narration,
                SourceDocType = type,
                SourceDocId = sourceDocId,
                Lines = lines,
            });
        }

        private static void AddLine(List<JournalLine> lines, int accountId, decimal debit, decimal credit, string? description)
        {
            if (debit == 0m && credit == 0m) return;
            lines.Add(new JournalLine
            {
                AccountId = accountId,
                Debit = debit,
                Credit = credit,
                Description = description,
            });
        }

        /// <summary>
        /// The canonical subledger party for a payment's ContactType, or null
        /// when the payee is neither.
        ///
        /// Trimmed and case-insensitive on purpose. The payment service
        /// canonicalises the value on write, but rows written before that landed
        /// can hold "client" or " Client ", and an ordinal test here would post
        /// their advance to Suspense while every read path still attributed it
        /// to the party.
        /// </summary>
        private static string? NormalizePartyType(string? contactType)
        {
            var t = contactType?.Trim();
            if (string.Equals(t, "Client", StringComparison.OrdinalIgnoreCase)) return "Client";
            if (string.Equals(t, "Supplier", StringComparison.OrdinalIgnoreCase)) return "Supplier";
            return null;
        }

        // ── Account resolution ────────────────────────────────────────────────

        private async Task<List<Account>> LoadAccountsAsync(int companyId) =>
            await _context.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId && a.IsActive)
                .ToListAsync();

        /// <summary>The first active account carrying the requested role, else
        /// Suspense. A Suspense fallback is logged as a warning: it means the
        /// chart is missing a role account, and the figures will visibly pool on
        /// Suspense until somebody fixes it — which is the point. Refusing to
        /// save the operator's bill over a chart problem would not be.</summary>
        private async Task<Account> ResolveAsync(int companyId, List<Account> accounts,
            ControlType role, string roleName)
        {
            var hit = accounts.Where(a => a.ControlType == role).OrderBy(a => a.Id).FirstOrDefault();
            if (hit != null) return hit;
            _logger.LogWarning("Company {CompanyId} has no {Role} account — posting to Suspense.", companyId, roleName);
            return await SuspenseAsync(companyId, accounts);
        }

        /// <summary>Revenue: the company's pinned default, then the seeded Sales
        /// account, then an account actually named "Sales", then any income
        /// account, then Suspense.</summary>
        private async Task<Account> ResolveSalesAsync(int companyId, List<Account> accounts)
        {
            var pinned = await _context.Companies.AsNoTracking()
                .Where(c => c.Id == companyId).Select(c => c.DefaultSalesAccountId).FirstOrDefaultAsync();
            var hit = (pinned.HasValue ? accounts.FirstOrDefault(a => a.Id == pinned.Value) : null)
                   ?? accounts.FirstOrDefault(a => a.ExternalRef == "seed:sales")
                   ?? accounts.FirstOrDefault(a => a.AccountType == AccountType.Income &&
                          string.Equals(a.Name, "Sales", StringComparison.OrdinalIgnoreCase))
                   ?? accounts.Where(a => a.AccountType == AccountType.Income).OrderBy(a => a.Id).FirstOrDefault();
            if (hit != null) return hit;
            _logger.LogWarning("Company {CompanyId} has no income account — posting sales to Suspense.", companyId);
            return await SuspenseAsync(companyId, accounts);
        }

        /// <summary>Cost: the Inventory control account when the company tracks
        /// stock (a purchase adds to the asset, it is not yet an expense), else
        /// the pinned default, the seeded Cost of goods sold, an account named
        /// for it, any expense account, then Suspense.</summary>
        private async Task<Account> ResolvePurchasesAsync(int companyId, List<Account> accounts)
        {
            var company = await _context.Companies.AsNoTracking()
                .Where(c => c.Id == companyId)
                .Select(c => new { c.InventoryTrackingEnabled, c.DefaultPurchaseAccountId })
                .FirstOrDefaultAsync();

            if (company?.InventoryTrackingEnabled == true)
            {
                var inv = accounts.Where(a => a.ControlType == ControlType.Inventory).OrderBy(a => a.Id).FirstOrDefault();
                if (inv != null) return inv;
            }

            var pinned = company?.DefaultPurchaseAccountId;
            var hit = (pinned.HasValue ? accounts.FirstOrDefault(a => a.Id == pinned.Value) : null)
                   ?? accounts.FirstOrDefault(a => a.ExternalRef == "seed:cogs")
                   ?? accounts.FirstOrDefault(a => a.AccountType == AccountType.Expense &&
                          a.Name.Contains("cost of goods", StringComparison.OrdinalIgnoreCase))
                   ?? accounts.Where(a => a.AccountType == AccountType.Expense).OrderBy(a => a.Id).FirstOrDefault();
            if (hit != null) return hit;
            _logger.LogWarning("Company {CompanyId} has no purchases/COGS account — posting to Suspense.", companyId);
            return await SuspenseAsync(companyId, accounts);
        }

        /// <summary>Finds — or creates — the company's Suspense account, on the
        /// equity side. Created rows carry <c>seed:suspense</c> so this is
        /// idempotent, and are control accounts so they cannot be deleted out
        /// from under the engine.</summary>
        private async Task<Account> SuspenseAsync(int companyId, List<Account> accounts)
        {
            var existing = accounts.FirstOrDefault(a => a.ControlType == ControlType.Suspense);
            if (existing != null) return existing;

            // Not in the cached list — re-check the database, because another
            // call in this same request may have created it, then create.
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
            _logger.LogWarning("Created a Suspense account for company {CompanyId} — its chart is missing a role account.", companyId);
            return suspense;
        }

        // ── Default sales / purchase accounts ─────────────────────────────────

        public async Task EnsureDefaultAccountsAsync(int companyId)
        {
            var company = await _context.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
            if (company == null) return;

            var accounts = await _context.Accounts
                .Where(a => a.CompanyId == companyId).ToListAsync();
            if (accounts.Count == 0) return;   // no chart yet — nothing to pin

            bool Has(int? id) => id.HasValue && accounts.Any(a => a.Id == id.Value);

            if (!Has(company.DefaultSalesAccountId))
            {
                var sales = accounts.FirstOrDefault(a => a.ExternalRef == "seed:sales")
                         ?? accounts.FirstOrDefault(a => a.AccountType == AccountType.Income &&
                                string.Equals(a.Name, "Sales", StringComparison.OrdinalIgnoreCase))
                         ?? accounts.Where(a => a.AccountType == AccountType.Income).OrderBy(a => a.Id).FirstOrDefault();
                if (sales != null) company.DefaultSalesAccountId = sales.Id;
            }

            if (!Has(company.DefaultPurchaseAccountId))
            {
                var cogs = accounts.FirstOrDefault(a => a.ExternalRef == "seed:cogs")
                        ?? accounts.FirstOrDefault(a => a.AccountType == AccountType.Expense &&
                               a.Name.Contains("cost of goods", StringComparison.OrdinalIgnoreCase))
                        ?? accounts.Where(a => a.AccountType == AccountType.Expense).OrderBy(a => a.Id).FirstOrDefault();
                if (cogs != null) company.DefaultPurchaseAccountId = cogs.Id;
            }

            await _context.SaveChangesAsync();
        }
    }
}

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

        /// <summary>Canonical subledger party for a payment's ContactType, or null
        /// when the payee is neither ("Other", or anything unrecognised).
        ///
        /// Trimmed and case-insensitive ON PURPOSE. PaymentService canonicalises
        /// the value on write, but rows written before that landed may hold
        /// "client" / " Client ", and every read path that attributes on-account
        /// money to a party — <see cref="Helpers.PartyOnAccount"/> in SQL,
        /// CustomerLedgerService in memory — matches those rows. An ordinal test
        /// here would post their advance to Suspense while all three credited it to
        /// the party: exactly the drift PartyOnAccount exists to prevent, and it
        /// became load-bearing when ContactType started choosing the target
        /// account rather than just a tag.</summary>
        private static string? NormalizePartyType(string? contactType)
        {
            var t = contactType?.Trim();
            if (string.Equals(t, "Client", StringComparison.OrdinalIgnoreCase)) return "Client";
            if (string.Equals(t, "Supplier", StringComparison.OrdinalIgnoreCase)) return "Supplier";
            return null;
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
            // An explicitly-chosen bank account must post to ITSELF even if it has
            // since been deactivated — `accounts` is active-only, so fall back to a
            // direct (tenant-scoped) load before the role default. Without this, a
            // re-post of an old payment whose bank account was later deactivated
            // would silently reroute to a different active bank/cash account.
            Account? bank = null;
            if (payment.BankAccountId.HasValue)
            {
                bank = accounts.FirstOrDefault(a => a.Id == payment.BankAccountId.Value)
                    ?? await _context.Accounts.FirstOrDefaultAsync(a =>
                           a.Id == payment.BankAccountId.Value && a.CompanyId == payment.CompanyId);
            }
            // Role default only when no bank account was chosen at all.
            bank ??= await ResolveAsync(payment.CompanyId, accounts, ControlType.BankCash, "bank/cash");

            var isReceipt = payment.Direction == PaymentDirection.Receipt;
            var reference = $"{(isReceipt ? "RCP" : "PMT")}-{payment.Number:D4}";
            var lines = new List<JournalLine>();

            // The money leg: receipt debits the bank, payment credits it.
            AddLine(lines, bank.Id, debit: isReceipt ? payment.Amount : 0m,
                credit: isReceipt ? 0m : payment.Amount, payment.DivisionId, reference);

            // The party named on the document, carried onto EVERY line — not just
            // the ones that settle an invoice/bill. Paying a supplier for a cash
            // expense is a normal thing to do, and that spend has to be visible in
            // that supplier's ledger, so an income/expense line gets tagged too.
            // "Other" payees have no row to point at, so they stay untagged.
            //
            // Compared case-insensitively, and NOT optional. PaymentService
            // canonicalises ContactType on write, but rows written before that
            // landed can still hold "client" / " Client ". An ordinal test used to
            // cost such a row only its party TAG; since the 2026-08-31 change it
            // decides the TARGET ACCOUNT, so a mis-cased row would send its
            // advance to Suspense while Helpers.PartyOnAccount — which compares in
            // SQL, under a case-insensitive collation — credits the same money to
            // the party on the A/R column, the aged report and their ledger. The
            // two must not be able to disagree; see PartyOnAccount.
            string? headerPartyType = NormalizePartyType(payment.ContactType);
            int? headerPartyId = headerPartyType != null ? payment.ContactId : null;

            // Where money held ON ACCOUNT for the party sits: the party's OWN
            // control account. Which one follows the PARTY, not the direction — a
            // client always sits in receivables and a supplier always in payables
            // — while the direction decides the side. One rule covers all four:
            //   receipt + client   Dr Bank / Cr AR   customer paid in advance
            //   payment + client   Dr AR   / Cr Bank refund to a customer
            //   payment + supplier Dr AP   / Cr Bank advance to a supplier
            //   receipt + supplier Dr Bank / Cr AP   refund from a supplier
            // Keeping it on the party's balance is what makes an advance visible
            // to their ledger, the A/R / A/P column and the aged reports; a
            // separate "Advance from Customers" liability (2026-08-29, superseded)
            // could not net against what the same party owes.
            //
            // Null for an "Other" payee — nobody's subledger can hold it, so the
            // caller falls back to Suspense. PaymentService rejects an OnAccount
            // line without a Client/Supplier, so this is a guard for legacy rows
            // re-posted by a GL enable/rebuild, not a reachable API shape.
            async Task<Account?> PartyControlAsync() => headerPartyType switch
            {
                "Client" => await ResolveAsync(payment.CompanyId, accounts,
                    ControlType.AccountsReceivable, "accounts receivable"),
                "Supplier" => await ResolveAsync(payment.CompanyId, accounts,
                    ControlType.AccountsPayable, "accounts payable"),
                _ => null,
            };

            // The settlement legs, one per allocation.
            foreach (var a in payment.Allocations)
            {
                if (a.Amount == 0m && a.AdjustmentAmount == 0m) continue;
                // Settled against the document = cash + settle-remainder adjustment.
                var settled = a.Amount + a.AdjustmentAmount;
                Account target;
                var partyType = headerPartyType; var partyId = headerPartyId;
                // Recoverable tax inside a direct income/expense line: the account
                // takes the net, the tax control account takes the rest.
                decimal lineTax = 0m;
                Account? taxAccount = null;

                if (a.InvoiceId.HasValue)
                {
                    target = await ResolveAsync(payment.CompanyId, accounts, ControlType.AccountsReceivable, "accounts receivable");
                    // AR is a Client subledger — a supplier can't own an AR balance.
                    if (partyType != "Client") { partyType = null; partyId = null; }
                }
                else if (a.PurchaseBillId.HasValue)
                {
                    target = await ResolveAsync(payment.CompanyId, accounts, ControlType.AccountsPayable, "accounts payable");
                    if (partyType != "Supplier") { partyType = null; partyId = null; }
                }
                else if (a.Kind == AllocationKind.OnAccount)
                {
                    // Advance / on account: the party's own control account, no
                    // document. See PartyControlAsync for the rule.
                    target = await PartyControlAsync()
                        ?? await SuspenseAsync(payment.CompanyId, accounts);
                }
                else if (a.AccountId.HasValue)
                {
                    // Direct income/expense line — post straight to the picked account.
                    target = accounts.FirstOrDefault(x => x.Id == a.AccountId.Value)
                        ?? await SuspenseAsync(payment.CompanyId, accounts);
                    if (a.TaxAmount != 0m)
                    {
                        // Money out → tax we paid a supplier, recoverable (Input Tax).
                        // Money in  → tax we charged a customer, payable (Output Tax).
                        taxAccount = await ResolveAsync(payment.CompanyId, accounts,
                            isReceipt ? ControlType.OutputTax : ControlType.InputTax,
                            isReceipt ? "output tax" : "input tax");
                        lineTax = a.TaxAmount;
                    }
                }
                else continue;

                lines.Add(new JournalLine
                {
                    AccountId = target.Id,
                    Debit = isReceipt ? 0m : settled - lineTax,
                    Credit = isReceipt ? settled - lineTax : 0m,
                    PartyType = partyType,
                    PartyId = partyId,
                    InvoiceId = a.InvoiceId,
                    PurchaseBillId = a.PurchaseBillId,
                    DivisionId = payment.DivisionId,
                    Description = payment.Description,
                });

                if (taxAccount != null && lineTax != 0m)
                {
                    AddLine(lines, taxAccount.Id,
                        debit: isReceipt ? 0m : lineTax,
                        credit: isReceipt ? lineTax : 0m,
                        payment.DivisionId, payment.Description);
                }

                // Settle-remainder adjustment (discount / write-off / any account):
                // sits on the same side as the bank leg (Dr on a receipt, Cr on a
                // payment) so the AR/AP leg above can clear the FULL settled amount
                // while cash moved is only a.Amount. Falls back to Suspense if the
                // chosen account can't be resolved (keeps the entry balanced).
                if (a.AdjustmentAmount != 0m)
                {
                    var adjAcct = (a.AdjustmentAccountId.HasValue
                        ? accounts.FirstOrDefault(x => x.Id == a.AdjustmentAccountId.Value)
                        : null) ?? await SuspenseAsync(payment.CompanyId, accounts);
                    AddLine(lines, adjAcct.Id,
                        debit: isReceipt ? a.AdjustmentAmount : 0m,
                        credit: isReceipt ? 0m : a.AdjustmentAmount,
                        payment.DivisionId, payment.Description);
                }
            }

            // Unallocated remainder of a receipt — CASH in hand that settles no
            // document and carries no explicit AllocationKind.OnAccount line. It
            // is the SAME thing as that line and gets the same treatment: money
            // held for the party, sitting on the party's own control account.
            // It stays an implicit rule because Payment.Amount is authoritative
            // for a customer receipt (2026-08-29) — a receipt may legitimately be
            // saved with no allocation lines at all, and inventing a line for it
            // would change the document the operator saved. Money-out has no
            // implicit remainder (PaymentService.ResolveAmount derives a payment's
            // Amount from its lines), so this only ever fires for a Receipt.
            //
            // Cash only, deliberately: a.Amount is what the customer actually
            // paid; a.AdjustmentAmount is a non-cash write-off that already
            // has its own Dr leg above (the settle-remainder adjustment) and
            // settles the INVOICE, not the receipt. Summing Amount +
            // AdjustmentAmount here would understate the unspent cash by the
            // adjustment and let the gap fall through to the unconditional
            // Suspense plug below instead — that still balances, so nothing
            // would catch it.
            //
            // Must run BEFORE that Suspense plug so a genuine advance lands on
            // the party's control account instead of pooling on Suspense. With
            // this cash-only formula, drSum/crSum already balance by the time we
            // reach it, so the Suspense plug is provably a no-op here — a
            // consequence of using cash, not a separate assumption.
            var allocatedCash = payment.Allocations.Sum(a => a.Amount);
            var unallocated = payment.Amount - allocatedCash;
            if (isReceipt && unallocated > 0m)
            {
                // No Client/Supplier on the header → no subledger can hold it, so
                // it falls through to the Suspense plug below, visible on the CoA.
                var party = await PartyControlAsync();
                if (party != null)
                {
                    lines.Add(new JournalLine
                    {
                        AccountId = party.Id,
                        Debit = 0m,
                        Credit = unallocated,
                        PartyType = headerPartyType,
                        PartyId = headerPartyId,
                        DivisionId = payment.DivisionId,
                        Description = reference,
                    });
                }
            }

            // Last-resort balance guard. An advance is NOT this case: it has its
            // own control-account leg above, whether it arrived as an
            // AllocationKind.OnAccount line or as a receipt's unallocated
            // remainder. What can still land here is a payee with no
            // Client/Supplier row holding money on account, or a migrated document
            // whose income/expense lines were never mapped to accounts. Plugging
            // it to Suspense honours this engine's "unresolved amounts land on
            // Suspense" contract and keeps a GL enable/rebuild from aborting on a
            // lone bank leg — the imbalance stays visible in Suspense instead of
            // failing the business operation.
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
            // Withholding tax (income-tax) splits the AR line: the customer
            // settles only the collectible (GrandTotal − WHT); the withheld
            // slice is a receivable reclaimable from FBR (Manager parity). WHT is
            // 0 on notes (out of scope), so this is a no-op there.
            var wht = invoice.WithholdingTaxAmount;
            var collectible = invoice.GrandTotal - wht;

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
                Debit = isCreditNote ? 0m : collectible,
                Credit = isCreditNote ? collectible : 0m,
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
            if (wht != 0m)
            {
                var whtReceivable = await ResolveAsync(invoice.CompanyId, accounts, ControlType.WithholdingReceivable, "withholding tax receivable");
                AddLine(lines, whtReceivable.Id, debit: isCreditNote ? 0m : wht,
                    credit: isCreditNote ? wht : 0m, invoice.DivisionId, label);
            }

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
            // Withholding tax splits the AP line: we owe the supplier only the
            // collectible (GrandTotal − WHT); the withheld slice is a payable we
            // remit to FBR (the "accounts payable increase" — Manager parity).
            var wht = bill.WithholdingTaxAmount;
            var collectible = bill.GrandTotal - wht;

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
                Credit = collectible,
                PartyType = "Supplier",
                PartyId = bill.SupplierId,
                PurchaseBillId = bill.Id,
                DivisionId = bill.DivisionId,
                Description = label,
            });
            if (wht != 0m)
            {
                var whtPayable = await ResolveAsync(bill.CompanyId, accounts, ControlType.WithholdingPayable, "withholding tax payable");
                AddLine(lines, whtPayable.Id, debit: 0m, credit: wht, bill.DivisionId, label);
            }

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

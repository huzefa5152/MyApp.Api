using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Customer and supplier reports — "who owes us, who do we owe, and how did
    /// that balance arise".
    ///
    /// ── Why the ledger, not the documents ──
    /// A party's balance is not just their invoices minus their receipts. It also
    /// moves on credit notes, debit notes, advances with no document, settlement
    /// write-offs, and any journal entry an accountant tagged to them. The AR and
    /// AP control accounts already carry every one of those, tagged by
    /// <c>JournalLine.PartyType</c> / <c>PartyId</c> — the posting engine writes the
    /// party onto every line it produces. So a party ledger is the SAME query as
    /// the account ledger with one extra predicate, and it is complete by
    /// construction rather than by remembering to add each document type.
    ///
    /// The existing <c>ClientService.GetStatementAsync</c> assembles a statement from
    /// documents instead. It is correct for what it covers and stays as the
    /// Clients screen's Statement tab; these reports are the ledger-true version
    /// with date ranges, an opening balance and no row cap.
    ///
    /// ── Sign ──
    /// Receivables are an asset: a customer who owes carries a debit balance, and
    /// the figures pass through. Payables are a liability: we owe on a credit
    /// balance, so supplier BALANCES are flipped (credit − debit) to read positive.
    /// Debit and Credit columns are never flipped.
    ///
    /// ── The unattributed gap ──
    /// A Manager.io snapshot import loads an opening receivable as one lump sum on
    /// the AR account with no party tag. The sum of the party rows then legitimately
    /// differs from the control-account balance. Balance Summary reports that gap as
    /// its own figure instead of hiding it, because a summary that silently
    /// disagrees with the Chart of Accounts is worse than one that explains itself.
    /// </summary>
    public partial class AccountingReportService
    {
        private static readonly List<ReportColumnDto> PartyLedgerColumns = new()
        {
            Col("date", "Date", "date"),
            Col("reference", "Reference"),
            Col("transaction", "Transaction"),
            Col("description", "Description"),
            Col("debit", "Debit", "money", totalled: true),
            Col("credit", "Credit", "money", totalled: true),
            Col("balance", "Balance", "money"),
        };

        /// <summary>All-parties view needs the party name; single-party does not.</summary>
        private static List<ReportColumnDto> PartyLedgerColumnsWithParty(string partyLabel)
        {
            var cols = new List<ReportColumnDto>(PartyLedgerColumns);
            cols.Insert(2, Col("party", partyLabel));
            return cols;
        }

        // ── Party ledger / statement ──────────────────────────────────────────────

        public async Task<PartyLedgerResultDto> GetPartyLedgerAsync(int companyId,
            ReportFilterDto filter, bool customers, bool asStatement = false)
        {
            var window = ResolveWindow(filter);
            var glOn = await _posting.IsEnabledAsync(companyId);
            var partyType = customers ? "Client" : "Supplier";
            var partyId = customers
                ? (filter.ClientId ?? filter.PayeeId)
                : (filter.SupplierId ?? filter.PayeeId);

            var title = asStatement
                ? (customers ? "Customer Statement" : "Supplier Statement")
                : (customers ? "Customer Ledger" : "Supplier Ledger");

            var envelope = await NewReportAsync(companyId, title, window, filter, glOn);
            var report = new PartyLedgerResultDto
            {
                Title = envelope.Title,
                CompanyName = envelope.CompanyName,
                PeriodLabel = envelope.PeriodLabel,
                From = envelope.From,
                To = envelope.To,
                FiltersApplied = envelope.FiltersApplied,
                GeneratedAt = envelope.GeneratedAt,
                LedgerSourced = glOn,
                PartyType = partyType,
                PartyId = partyId,
                Columns = partyId.HasValue
                    ? PartyLedgerColumns
                    : PartyLedgerColumnsWithParty(customers ? "Customer" : "Supplier"),
            };

            // A statement is addressed to one party, and it deliberately shows the
            // WHOLE period rather than page one — you send the statement, not a
            // page of it. Those two together mean an unscoped statement renders
            // every party's every transaction: the supplier statement came back at
            // 302,500 characters on a phone. So ask for the party instead.
            if (asStatement && !partyId.HasValue)
            {
                report.Notice = $"Choose a {(customers ? "customer" : "supplier")} to produce a "
                              + "statement — a statement is addressed to one of them. For everyone at "
                              + $"once, use the {(customers ? "Customer" : "Supplier")} Balance Summary "
                              + $"or the {(customers ? "Customer" : "Supplier")} Ledger.";
                return report;
            }

            // Two situations put the party detail out of the ledger's reach:
            //   • GL posting is off, so there are no journal lines at all;
            //   • the ledger was IMPORTED. ManagerImportService writes journal
            //     entries directly rather than through PostingService, so it never
            //     tags PartyType/PartyId — and for a migrated company the
            //     pre-cutover entries are frozen, so a GL rebuild will not tag them
            //     either. Al-Qahera has 15,376 lines and not one party tag.
            // In both cases the DOCUMENTS still know who they belong to, so the
            // report falls back to the invoice/bill subledger and says so. That is
            // a change of SOURCE, not a second set of accounting rules: the amounts
            // come from each document's own stored totals, exactly as the aging
            // report and the party summaries already read them.
            var partyTagged = glOn && await _context.JournalLines.AsNoTracking()
                .AnyAsync(l => l.JournalEntry.CompanyId == companyId && l.PartyType == partyType);

            if (!partyTagged)
            {
                report.LedgerSourced = false;
                report.Notice = glOn
                    ? "This company's ledger was imported, and the imported entries are not "
                      + $"attributed to individual {(customers ? "customers" : "suppliers")}. "
                      + "This ledger is therefore built from the documents themselves — correct, but it "
                      + "cannot show journal entries that moved the balance."
                    : "This company does not post to the general ledger, so this ledger is built from "
                      + "the documents themselves. Enable GL posting in Accounting → Dashboard for the "
                      + "full picture.";
                await FillPartyLedgerFromDocumentsAsync(companyId, filter, window, customers,
                    partyId, report, asStatement);
                return report;
            }

            // A statement is addressed to someone, so it needs the addressee and
            // the letterhead. Only meaningful for a single party.
            if (asStatement && partyId.HasValue)
            {
                report.Party = await LoadPartyContactAsync(companyId, partyType, partyId.Value);
                report.CompanyContact = await LoadCompanyContactAsync(companyId);
                report.PartyName = report.Party?.Name;
            }
            else if (partyId.HasValue)
            {
                report.PartyName = await PartyNameAsync(companyId, partyType, partyId.Value);
            }

            var q = BuildPartyLedgerQuery(companyId, filter, window, customers, partyId);

            // Opening: everything that hit this party's control account before the
            // window. Uses the same query shape with the window dropped, so the
            // opening and the rows can never be derived differently.
            var opening = window.From.HasValue
                ? await BuildPartyLedgerQuery(companyId, filter, new ReportWindow(null, null, ""), customers, partyId)
                    .Where(l => l.JournalEntry.Date < window.From!.Value)
                    .SumAsync(l => (decimal?)(l.Debit - l.Credit)) ?? 0m
                : 0m;

            var ordered = q
                .OrderBy(l => l.JournalEntry.Date)
                .ThenBy(l => l.JournalEntryId)
                .ThenBy(l => l.Id);

            report.TotalCount = await ordered.CountAsync();
            var (page, size) = ResolvePaging(filter, forExport: asStatement);
            report.Page = page;
            report.PageSize = size;
            var offset = (page - 1) * size;

            var beforePage = offset > 0
                ? await ordered.Take(offset).SumAsync(l => (decimal?)(l.Debit - l.Credit)) ?? 0m
                : 0m;

            var rows = await ordered.Skip(offset).Take(size)
                .Select(l => new
                {
                    l.Id,
                    l.JournalEntryId,
                    l.JournalEntry.EntryNo,
                    l.JournalEntry.Date,
                    l.JournalEntry.SourceDocType,
                    l.JournalEntry.SourceDocId,
                    l.JournalEntry.Narration,
                    l.Description,
                    l.Debit,
                    l.Credit,
                    l.PartyId,
                    l.InvoiceId,
                    l.PurchaseBillId,
                    EntryDivisionId = l.JournalEntry.DivisionId,
                })
                .ToListAsync();

            var refs = await LoadSourceReferencesAsync(companyId,
                rows.Select(r => (r.SourceDocType.ToString(), r.SourceDocId)).ToList());

            var partyNames = partyId.HasValue
                ? new Dictionary<(string, int), string>()
                : await LoadPartyNamesAsync(companyId,
                    rows.Where(r => r.PartyId.HasValue).Select(r => ((string?)partyType, r.PartyId)));

            var divisionIds = rows.Where(r => r.EntryDivisionId.HasValue)
                .Select(r => r.EntryDivisionId!.Value).Distinct().ToList();
            var divisionNames = divisionIds.Count == 0
                ? new Dictionary<int, string>()
                : await _context.Divisions.AsNoTracking()
                    .Where(d => d.CompanyId == companyId && divisionIds.Contains(d.Id))
                    .ToDictionaryAsync(d => d.Id, d => d.Name);

            // Signed running balance, then flipped for suppliers at the point of
            // display so "we owe" reads positive.
            var flip = customers ? 1m : -1m;
            var running = opening + beforePage;
            var built = new List<object>(rows.Count);
            foreach (var r in rows)
            {
                running += r.Debit - r.Credit;
                built.Add(new PartyLedgerRowDto
                {
                    Date = r.Date,
                    JournalEntryId = r.JournalEntryId,
                    EntryNo = r.EntryNo,
                    Transaction = DescribeTransaction(r.SourceDocType, r.Debit, r.Credit,
                        customers, r.InvoiceId, r.PurchaseBillId),
                    Reference = refs.GetValueOrDefault((r.SourceDocType.ToString(), r.SourceDocId))
                                ?? $"JE-{r.EntryNo}",
                    SourceType = r.SourceDocType.ToString(),
                    SourceId = r.SourceDocId,
                    Description = FirstNonEmpty(r.Description, r.Narration),
                    Party = partyId.HasValue || !r.PartyId.HasValue
                        ? null
                        : partyNames.GetValueOrDefault((partyType, r.PartyId.Value)),
                    PartyId = r.PartyId,
                    Debit = r.Debit,
                    Credit = r.Credit,
                    Balance = running * flip,
                    Division = r.EntryDivisionId.HasValue
                        ? divisionNames.GetValueOrDefault(r.EntryDivisionId.Value) : null,
                });
            }
            report.Rows = built;

            var totals = await q.GroupBy(_ => 1)
                .Select(g => new { Dr = g.Sum(x => x.Debit), Cr = g.Sum(x => x.Credit) })
                .FirstOrDefaultAsync();
            report.TotalDebit = totals?.Dr ?? 0m;
            report.TotalCredit = totals?.Cr ?? 0m;
            report.OpeningBalance = opening * flip;
            report.ClosingBalance = (opening + report.TotalDebit - report.TotalCredit) * flip;

            report.Totals["debit"] = report.TotalDebit;
            report.Totals["credit"] = report.TotalCredit;
            report.TotalLabels["debit"] = customers ? "Invoiced" : "Billed";
            report.TotalLabels["credit"] = customers ? "Received" : "Paid";
            report.Totals["closing"] = report.ClosingBalance;
            report.TotalLabels["closing"] = customers ? "Amount Due" : "Amount Owed";

            // A statement is a demand for payment, so it says how old the debt is.
            if (asStatement && partyId.HasValue)
                report.Aging = await PartyAgingAsync(companyId, partyId.Value, customers, window.To);

            return report;
        }

        /// <summary>
        /// Every journal line on the AR (or AP) control account for the party.
        /// One place, so the ledger rows, the opening balance and the totals are
        /// always derived the same way.
        /// </summary>
        private IQueryable<JournalLine> BuildPartyLedgerQuery(int companyId, ReportFilterDto f,
            ReportWindow window, bool customers, int? partyId)
        {
            var control = customers ? ControlType.AccountsReceivable : ControlType.AccountsPayable;
            var partyType = customers ? "Client" : "Supplier";

            var q = _context.JournalLines.AsNoTracking()
                .Where(l => l.JournalEntry.CompanyId == companyId
                         && l.Account.ControlType == control
                         && l.PartyType == partyType);

            q = ScopeToDivisions(q, f);

            if (partyId.HasValue) q = q.Where(l => l.PartyId == partyId.Value);
            if (window.From.HasValue) q = q.Where(l => l.JournalEntry.Date >= window.From!.Value);
            if (window.To.HasValue) q = q.Where(l => l.JournalEntry.Date <= window.To!.Value);

            if (f.DivisionId.HasValue)
                q = q.Where(l => l.JournalEntry.DivisionId == f.DivisionId!.Value
                              || l.DivisionId == f.DivisionId!.Value);

            // Transaction-type filter, expressed in the operator's vocabulary
            // rather than journal-source enums.
            if (!string.IsNullOrWhiteSpace(f.Status))
            {
                switch (f.Status.Trim().ToLowerInvariant())
                {
                    case "invoice":
                    case "bill":
                        q = q.Where(l => l.JournalEntry.SourceDocType ==
                            (customers ? SourceDocType.Invoice : SourceDocType.PurchaseBill)); break;
                    case "payment":
                    case "receipt":
                        q = q.Where(l => l.JournalEntry.SourceDocType == SourceDocType.Payment); break;
                    case "note":
                        q = q.Where(l => l.JournalEntry.SourceDocType == SourceDocType.Invoice
                                      || l.JournalEntry.SourceDocType == SourceDocType.PurchaseDebitNote); break;
                    case "journal":
                        q = q.Where(l => l.JournalEntry.SourceDocType == SourceDocType.ManualJournal); break;
                }
            }

            if (!string.IsNullOrWhiteSpace(f.Search))
            {
                var s = f.Search.Trim();
                q = q.Where(l => (l.Description != null && EF.Functions.Like(l.Description, $"%{s}%"))
                              || (l.JournalEntry.Narration != null
                                  && EF.Functions.Like(l.JournalEntry.Narration, $"%{s}%")));
            }

            return q;
        }

        /// <summary>
        /// What the operator should read in the Transaction column. The journal
        /// records a source type; a Credit Note and a Sales Invoice share it, so
        /// the SIDE of the control-account line disambiguates them — a sale debits
        /// receivables, a credit note credits them.
        /// </summary>
        private static string DescribeTransaction(SourceDocType type, decimal debit, decimal credit,
            bool customers, int? invoiceId, int? billId) => type switch
        {
            SourceDocType.Invoice => debit > 0m ? "Sales Invoice" : "Credit Note",
            SourceDocType.PurchaseBill => credit > 0m ? "Purchase Bill" : "Purchase Adjustment",
            SourceDocType.PurchaseDebitNote => "Debit Note",
            SourceDocType.Payment => (invoiceId == null && billId == null)
                // No document on the line means it was money against the running
                // balance rather than a settlement.
                ? "Advance / On account"
                : customers ? "Receipt" : "Payment",
            SourceDocType.AccountTransfer => "Transfer",
            SourceDocType.ManualJournal => "Journal",
            _ => type.ToString(),
        };

        private async Task<PartyContactDto?> LoadPartyContactAsync(int companyId, string partyType, int partyId)
        {
            if (partyType == "Supplier")
                return await _context.Suppliers.AsNoTracking()
                    .Where(s => s.Id == partyId && s.CompanyId == companyId)
                    .Select(s => new PartyContactDto
                    {
                        Name = s.Name, Address = s.Address, Phone = s.Phone,
                        Email = s.Email, Ntn = s.NTN, Strn = s.STRN,
                    })
                    .FirstOrDefaultAsync();

            return await _context.Clients.AsNoTracking()
                .Where(c => c.Id == partyId && c.CompanyId == companyId)
                .Select(c => new PartyContactDto
                {
                    Name = c.Name, Address = c.Address, Phone = c.Phone,
                    Email = c.Email, Ntn = c.NTN, Strn = c.STRN,
                })
                .FirstOrDefaultAsync();
        }

        private async Task<PartyContactDto?> LoadCompanyContactAsync(int companyId) =>
            await _context.Companies.AsNoTracking()
                .Where(c => c.Id == companyId)
                .Select(c => new PartyContactDto
                {
                    Name = string.IsNullOrWhiteSpace(c.BrandName) ? c.Name : c.BrandName!,
                    // Company stores its address as FullAddress and carries no
                    // email field, unlike Client/Supplier.
                    Address = c.FullAddress, Phone = c.Phone,
                    Ntn = c.NTN, Strn = c.STRN,
                })
                .FirstOrDefaultAsync();

        /// <summary>
        /// Age breakdown of one party's outstanding documents, for a statement
        /// footer. Reuses the aging report and picks out this party's row, so the
        /// statement and the aging report can never disagree.
        /// </summary>
        private async Task<AgingBucketsDto> PartyAgingAsync(int companyId, int partyId,
            bool customers, DateTime? asOf)
        {
            var aged = customers
                ? await _gl.GetAgedReceivablesAsync(companyId, asOf)
                : await _gl.GetAgedPayablesAsync(companyId, asOf);
            var row = aged.Rows.FirstOrDefault(r => r.PartyId == partyId);
            if (row == null) return new AgingBucketsDto();
            return new AgingBucketsDto
            {
                Total = row.Total, Current = row.Current, Days1To30 = row.Days1To30,
                Days31To60 = row.Days31To60, Days61To90 = row.Days61To90, Over90 = row.Over90,
            };
        }

        // ── Document-sourced fallback ─────────────────────────────────────────────

        /// <summary>
        /// One party movement, before it is turned into a ledger row. Kept as a
        /// local shape so the customer and supplier paths share the assembly and
        /// the sort, and only differ in what they read.
        /// </summary>
        private sealed class PartyMovement
        {
            public DateTime Date { get; init; }
            public string Transaction { get; init; } = "";
            public string Reference { get; init; } = "";
            public string SourceType { get; init; } = "";
            public int SourceId { get; init; }
            public string? Description { get; init; }
            public int PartyId { get; init; }
            public decimal Debit { get; init; }
            public decimal Credit { get; init; }
        }

        /// <summary>A document as the movement loader needs it, so the settlement
        /// residual can be reconciled per document.</summary>
        private sealed class PartyDocument
        {
            public int Id { get; init; }
            public DateTime Date { get; init; }
            public string Reference { get; init; } = "";
            public int PartyId { get; init; }
            public decimal AmountPaid { get; init; }
        }

        /// <summary>
        /// Build the party ledger from the DOCUMENTS instead of the journal, for a
        /// company whose ledger carries no party tags (GL off, or an imported
        /// ledger — see the caller).
        ///
        /// Deliberately mirrors what the aging report and
        /// <c>ClientService.GetStatementAsync</c> already read, so the three cannot
        /// disagree:
        ///   • an invoice/bill owes its COLLECTIBLE (grand total − withholding tax);
        ///   • a credit note reverses, a debit note adds;
        ///   • an allocation settles by its cash amount PLUS any settle-remainder
        ///     adjustment, because the adjustment clears the document just as cash
        ///     does (AmountPaid counts it);
        ///   • an on-account allocation moves the running balance with no document.
        /// </summary>
        private async Task FillPartyLedgerFromDocumentsAsync(int companyId, ReportFilterDto f,
            ReportWindow window, bool customers, int? partyId, PartyLedgerResultDto report,
            bool asStatement)
        {
            var partyType = customers ? "Client" : "Supplier";

            if (partyId.HasValue)
            {
                report.PartyName = await PartyNameAsync(companyId, partyType, partyId.Value);
                if (asStatement)
                {
                    report.Party = await LoadPartyContactAsync(companyId, partyType, partyId.Value);
                    report.CompanyContact = await LoadCompanyContactAsync(companyId);
                }
            }

            var moves = await LoadPartyMovementsAsync(companyId, f, customers, partyId);

            // Opening = everything before the window; the window itself is filtered
            // after, so the two can never be derived differently.
            var opening = window.From.HasValue
                ? moves.Where(m => m.Date.Date < window.From!.Value.Date).Sum(m => m.Debit - m.Credit)
                : 0m;

            var inWindow = moves
                .Where(m => (!window.From.HasValue || m.Date.Date >= window.From!.Value.Date)
                         && (!window.To.HasValue || m.Date.Date <= window.To!.Value.Date))
                .OrderBy(m => m.Date).ThenBy(m => m.Reference)
                .ToList();

            report.TotalDebit = inWindow.Sum(m => m.Debit);
            report.TotalCredit = inWindow.Sum(m => m.Credit);

            var flip = customers ? 1m : -1m;
            report.OpeningBalance = opening * flip;
            report.ClosingBalance = (opening + report.TotalDebit - report.TotalCredit) * flip;

            report.TotalCount = inWindow.Count;
            var (page, size) = ResolvePaging(f, forExport: asStatement);
            report.Page = page;
            report.PageSize = size;
            var offset = (page - 1) * size;

            var names = partyId.HasValue
                ? new Dictionary<(string, int), string>()
                : await LoadPartyNamesAsync(companyId,
                    inWindow.Select(m => ((string?)partyType, (int?)m.PartyId)));

            var running = opening + inWindow.Take(offset).Sum(m => m.Debit - m.Credit);
            var built = new List<object>();
            foreach (var m in inWindow.Skip(offset).Take(size))
            {
                running += m.Debit - m.Credit;
                built.Add(new PartyLedgerRowDto
                {
                    Date = m.Date,
                    Transaction = m.Transaction,
                    Reference = m.Reference,
                    SourceType = m.SourceType,
                    SourceId = m.SourceId,
                    Description = m.Description,
                    Party = partyId.HasValue ? null : names.GetValueOrDefault((partyType, m.PartyId)),
                    PartyId = m.PartyId,
                    Debit = m.Debit,
                    Credit = m.Credit,
                    Balance = running * flip,
                });
            }
            report.Rows = built;

            report.Totals["debit"] = report.TotalDebit;
            report.Totals["credit"] = report.TotalCredit;
            report.Totals["closing"] = report.ClosingBalance;
            report.TotalLabels["debit"] = customers ? "Invoiced" : "Billed";
            report.TotalLabels["credit"] = customers ? "Received" : "Paid";
            report.TotalLabels["closing"] = customers ? "Amount Due" : "Amount Owed";

            if (asStatement && partyId.HasValue)
                report.Aging = await PartyAgingAsync(companyId, partyId.Value, customers, window.To);
        }

        /// <summary>
        /// Every document movement for a party (or all parties), unfiltered by date
        /// so the caller can split opening from window. Four reads, not four per
        /// party.
        /// </summary>
        private async Task<List<PartyMovement>> LoadPartyMovementsAsync(int companyId,
            ReportFilterDto f, bool customers, int? partyId)
        {
            var moves = new List<PartyMovement>();
            var documents = new List<PartyDocument>();
            var allowed = f.AllowedDivisionIds;

            if (customers)
            {
                var invoices = _context.Invoices.AsNoTracking()
                    .Where(i => i.CompanyId == companyId && !i.IsDemo && !i.IsCancelled);
                if (partyId.HasValue) invoices = invoices.Where(i => i.ClientId == partyId.Value);
                if (f.DivisionId.HasValue) invoices = invoices.Where(i => i.DivisionId == f.DivisionId!.Value);
                if (allowed != null)
                    invoices = invoices.Where(i => i.DivisionId == null || allowed.Contains(i.DivisionId.Value));

                foreach (var i in await invoices.Select(i => new
                {
                    i.Id, i.InvoiceNumber, i.Date, i.ClientId, i.DocumentType,
                    Owed = i.GrandTotal - i.WithholdingTaxAmount, i.PaymentTerms, i.AmountPaid,
                }).ToListAsync())
                {
                    // Notes carry no AmountPaid of their own, so only real invoices
                    // take part in the settlement reconciliation below.
                    if (i.DocumentType != 9 && i.DocumentType != 10)
                        documents.Add(new PartyDocument
                        {
                            Id = i.Id, Date = i.Date, PartyId = i.ClientId,
                            Reference = $"INV-{i.InvoiceNumber}", AmountPaid = i.AmountPaid,
                        });

                    // A credit note reduces what the customer owes; an invoice and a
                    // debit note both increase it.
                    var isCredit = i.DocumentType == 10;
                    moves.Add(new PartyMovement
                    {
                        Date = i.Date,
                        Transaction = i.DocumentType switch
                        { 10 => "Credit Note", 9 => "Debit Note", _ => "Sales Invoice" },
                        Reference = i.DocumentType switch
                        { 10 => $"CN-{i.InvoiceNumber}", 9 => $"DN-{i.InvoiceNumber}", _ => $"INV-{i.InvoiceNumber}" },
                        SourceType = "Invoice",
                        SourceId = i.Id,
                        Description = i.PaymentTerms,
                        PartyId = i.ClientId,
                        Debit = isCredit ? 0m : i.Owed,
                        Credit = isCredit ? i.Owed : 0m,
                    });
                }
            }
            else
            {
                var bills = _context.PurchaseBills.AsNoTracking()
                    .Where(b => b.CompanyId == companyId);
                if (partyId.HasValue) bills = bills.Where(b => b.SupplierId == partyId.Value);
                if (f.DivisionId.HasValue) bills = bills.Where(b => b.DivisionId == f.DivisionId!.Value);
                if (allowed != null)
                    bills = bills.Where(b => b.DivisionId == null || allowed.Contains(b.DivisionId.Value));

                foreach (var b in await bills.Select(b => new
                {
                    b.Id, b.PurchaseBillNumber, b.Date, b.SupplierId,
                    Owed = b.GrandTotal - b.WithholdingTaxAmount, b.SupplierBillNumber, b.AmountPaid,
                }).ToListAsync())
                {
                    documents.Add(new PartyDocument
                    {
                        Id = b.Id, Date = b.Date, PartyId = b.SupplierId,
                        Reference = $"BILL-{b.PurchaseBillNumber}", AmountPaid = b.AmountPaid,
                    });

                    // A bill increases what we owe, so it CREDITS the payable side.
                    moves.Add(new PartyMovement
                    {
                        Date = b.Date,
                        Transaction = "Purchase Bill",
                        Reference = $"BILL-{b.PurchaseBillNumber}",
                        SourceType = "PurchaseBill",
                        SourceId = b.Id,
                        Description = b.SupplierBillNumber,
                        PartyId = b.SupplierId,
                        Debit = 0m,
                        Credit = b.Owed,
                    });
                }

                // Supplier debit notes reduce what we owe.
                var notes = _context.PurchaseDebitNotes.AsNoTracking()
                    .Where(dn => dn.CompanyId == companyId);
                if (partyId.HasValue) notes = notes.Where(dn => dn.SupplierId == partyId.Value);
                foreach (var dn in await notes.Select(dn => new
                {
                    dn.Id, dn.DebitNoteNumber, dn.Date, dn.SupplierId, dn.GrandTotal,
                }).ToListAsync())
                {
                    moves.Add(new PartyMovement
                    {
                        Date = dn.Date,
                        Transaction = "Debit Note",
                        Reference = $"PDN-{dn.DebitNoteNumber}",
                        SourceType = "PurchaseDebitNote",
                        SourceId = dn.Id,
                        PartyId = dn.SupplierId,
                        Debit = dn.GrandTotal,
                        Credit = 0m,
                    });
                }
            }

            // Settlements. The amount that clears the document is cash PLUS any
            // settle-remainder adjustment, because AmountPaid counts both — leaving
            // the adjustment out would show a paid document still carrying a balance.
            var direction = customers ? PaymentDirection.Receipt : PaymentDirection.Payment;
            var settlements = await (
                from a in _context.PaymentAllocations.AsNoTracking()
                join p in _context.Payments.AsNoTracking() on a.PaymentId equals p.Id
                where p.CompanyId == companyId && !p.IsCancelled
                      && (customers ? a.InvoiceId != null : a.PurchaseBillId != null)
                select new
                {
                    p.Id, p.Number, p.Date, p.Direction, p.Description, p.ContactId, p.ContactType,
                    a.Amount, a.AdjustmentAmount,
                    // Carried so the per-document settled total can be reconciled
                    // against AmountPaid below.
                    a.InvoiceId, a.PurchaseBillId,
                    ClientId = a.Invoice != null ? (int?)a.Invoice.ClientId : null,
                    SupplierId = a.PurchaseBill != null ? (int?)a.PurchaseBill.SupplierId : null,
                }).ToListAsync();

            var settledPerDoc = new Dictionary<int, decimal>();
            foreach (var sx in settlements)
            {
                var owner = customers ? sx.ClientId : sx.SupplierId;
                if (owner == null) continue;
                if (partyId.HasValue && owner.Value != partyId.Value) continue;
                var cleared = sx.Amount + sx.AdjustmentAmount;
                if (cleared == 0m) continue;

                var docKey = customers ? sx.InvoiceId : sx.PurchaseBillId;
                if (docKey.HasValue)
                    settledPerDoc[docKey.Value] = settledPerDoc.GetValueOrDefault(docKey.Value) + cleared;

                moves.Add(new PartyMovement
                {
                    Date = sx.Date,
                    Transaction = customers ? "Receipt" : "Payment",
                    Reference = PaymentRef(sx.Direction, sx.Number),
                    SourceType = "Payment",
                    SourceId = sx.Id,
                    Description = sx.Description,
                    PartyId = owner.Value,
                    // A receipt reduces the receivable; a payment reduces the payable.
                    Debit = customers ? 0m : cleared,
                    Credit = customers ? cleared : 0m,
                });
            }

            // ── Reconcile to AmountPaid ──
            // A migrated company can carry documents whose AmountPaid was written
            // directly by the importer with NO payment document behind it — 742 of
            // Al-Qahera's invoices, 23.5M in total. AmountPaid is what the rest of
            // the product treats as settled (the aging report, the payment status on
            // every invoice row, Outstanding Invoices), so a ledger built only from
            // allocation rows would show those documents as still owing and
            // disagree with all of them.
            //
            // The difference is emitted as one explicit row per document rather than
            // silently absorbed, so the operator can see that the settlement predates
            // the system. It is dated on the document itself, since no payment date
            // exists to use.
            foreach (var doc in documents)
            {
                var recorded = settledPerDoc.GetValueOrDefault(doc.Id);
                var residual = doc.AmountPaid - recorded;
                if (Math.Abs(residual) <= 0.005m) continue;

                // Symmetric on purpose. Reconciling only upwards left a real gap:
                // Al-Qahera has bills whose allocations EXCEED AmountPaid by
                // 381,520, and crediting the full allocation there made the ledger
                // disagree with the aging report by exactly that. AmountPaid is the
                // product's settled figure, so the ledger follows it in both
                // directions.
                var settledMore = residual > 0m;
                var amount = Math.Abs(residual);
                moves.Add(new PartyMovement
                {
                    Date = doc.Date,
                    Transaction = settledMore
                        ? "Settled before migration"
                        : "Settlement adjustment",
                    Reference = doc.Reference,
                    SourceType = customers ? "Invoice" : "PurchaseBill",
                    SourceId = doc.Id,
                    Description = settledMore
                        ? "Recorded as paid with no payment document"
                        : "Recorded payments exceed the amount marked paid",
                    PartyId = doc.PartyId,
                    // A further settlement moves the balance the same way a payment
                    // does; a negative residual moves it back.
                    Debit = customers == settledMore ? 0m : amount,
                    Credit = customers == settledMore ? amount : 0m,
                });
            }

            // Advances / refunds — no document, found by the party on the payment.
            var onAccount = await (
                from a in _context.PaymentAllocations.AsNoTracking()
                join p in _context.Payments.AsNoTracking() on a.PaymentId equals p.Id
                where p.CompanyId == companyId && !p.IsCancelled
                      && a.Kind == AllocationKind.OnAccount
                      && p.ContactType == (customers ? "Client" : "Supplier")
                      && p.ContactId != null
                select new { p.Id, p.Number, p.Date, p.Direction, p.Description, p.ContactId, a.Amount }
            ).ToListAsync();

            foreach (var oa in onAccount)
            {
                if (partyId.HasValue && oa.ContactId!.Value != partyId.Value) continue;
                if (oa.Amount == 0m) continue;
                // Direction decides the side: money in reduces a receivable, money
                // out (a refund) increases it. Mirrored for payables.
                var moneyIn = oa.Direction == PaymentDirection.Receipt;
                moves.Add(new PartyMovement
                {
                    Date = oa.Date,
                    Transaction = "Advance / On account",
                    Reference = PaymentRef(oa.Direction, oa.Number),
                    SourceType = "Payment",
                    SourceId = oa.Id,
                    Description = oa.Description,
                    PartyId = oa.ContactId!.Value,
                    Debit = moneyIn ? 0m : oa.Amount,
                    Credit = moneyIn ? oa.Amount : 0m,
                });
            }

            return moves;
        }

        // ── Balance summary ───────────────────────────────────────────────────────

        public async Task<PartyBalanceSummaryDto> GetPartyBalanceSummaryAsync(int companyId,
            ReportFilterDto filter, bool customers)
        {
            var window = ResolveWindow(filter);
            var glOn = await _posting.IsEnabledAsync(companyId);
            var partyType = customers ? "Client" : "Supplier";

            var envelope = await NewReportAsync(companyId,
                customers ? "Customer Balance Summary" : "Supplier Balance Summary",
                window, filter, glOn);
            var report = new PartyBalanceSummaryDto
            {
                Title = envelope.Title, CompanyName = envelope.CompanyName,
                PeriodLabel = envelope.PeriodLabel, From = envelope.From, To = envelope.To,
                FiltersApplied = envelope.FiltersApplied, GeneratedAt = envelope.GeneratedAt,
                LedgerSourced = glOn,
                Columns = new List<ReportColumnDto>
                {
                    Col("party", customers ? "Customer" : "Supplier"),
                    Col("opening", "Opening", "money", totalled: true),
                    Col("debit", customers ? "Invoiced" : "Billed", "money", totalled: true),
                    Col("credit", customers ? "Received" : "Paid", "money", totalled: true),
                    Col("closing", customers ? "Owes us" : "We owe", "money", totalled: true),
                    Col("openDocuments", "Open docs", "int"),
                    Col("status", "Status", "status"),
                },
            };

            // Same two cases as the ledger: no GL, or an imported GL with no party
            // tags. Fall back to the documents rather than showing an empty summary
            // beside a non-zero receivable.
            var partyTagged = glOn && await _context.JournalLines.AsNoTracking()
                .AnyAsync(l => l.JournalEntry.CompanyId == companyId && l.PartyType == partyType);

            if (!partyTagged)
            {
                report.LedgerSourced = false;
                report.Notice = glOn
                    ? "This company's ledger was imported and its entries are not attributed to "
                      + $"individual {(customers ? "customers" : "suppliers")}, so these balances are "
                      + "built from the documents themselves."
                    : "GL posting is off for this company, so these balances are built from the "
                      + "documents themselves.";
                await FillPartyBalancesFromDocumentsAsync(companyId, filter, window, customers, report);
                return report;
            }

            var flip = customers ? 1m : -1m;
            var all = BuildPartyLedgerQuery(companyId, filter, new ReportWindow(null, null, ""),
                customers, partyId: null);

            // Opening per party (before the window) and movement inside it, both in
            // SQL. Two grouped queries, not a per-party loop.
            var openings = window.From.HasValue
                ? (await all.Where(l => l.JournalEntry.Date < window.From!.Value)
                    .GroupBy(l => l.PartyId!.Value)
                    .Select(g => new { PartyId = g.Key, Net = g.Sum(x => x.Debit - x.Credit) })
                    .ToListAsync()).ToDictionary(x => x.PartyId, x => x.Net)
                : new Dictionary<int, decimal>();

            var windowed = BuildPartyLedgerQuery(companyId, filter, window, customers, partyId: null);
            var movement = await windowed
                .GroupBy(l => l.PartyId!.Value)
                .Select(g => new { PartyId = g.Key, Dr = g.Sum(x => x.Debit), Cr = g.Sum(x => x.Credit) })
                .ToListAsync();

            var partyIds = movement.Select(m => m.PartyId).Concat(openings.Keys).Distinct().ToList();
            var names = await LoadPartyNamesAsync(companyId,
                partyIds.Select(id => ((string?)partyType, (int?)id)));

            // Open-document counts come from the aging report rather than a second
            // "what is unpaid" query, so the two reports always agree.
            var aged = customers
                ? await _gl.GetAgedReceivablesAsync(companyId, window.To)
                : await _gl.GetAgedPayablesAsync(companyId, window.To);
            var openDocs = aged.Rows.ToDictionary(r => r.PartyId, r => r.OpenDocuments);

            var rows = new List<PartyBalanceRowDto>();
            foreach (var id in partyIds)
            {
                var mv = movement.FirstOrDefault(m => m.PartyId == id);
                var open = openings.GetValueOrDefault(id);
                var dr = mv?.Dr ?? 0m;
                var cr = mv?.Cr ?? 0m;
                var closing = (open + dr - cr) * flip;
                if (open == 0m && dr == 0m && cr == 0m) continue;

                rows.Add(new PartyBalanceRowDto
                {
                    PartyId = id,
                    Party = names.GetValueOrDefault((partyType, id)) ?? $"{partyType} #{id}",
                    Opening = open * flip,
                    Debit = dr,
                    Credit = cr,
                    Closing = closing,
                    OpenDocuments = openDocs.GetValueOrDefault(id),
                    Status = closing > 0.005m ? "Owing" : closing < -0.005m ? "In credit" : "Settled",
                });
            }

            rows = rows.OrderByDescending(r => r.Closing).ToList();
            report.Rows = rows.Cast<object>().ToList();
            report.TotalCount = rows.Count;
            report.Page = 1;
            report.PageSize = rows.Count;
            report.Totals["opening"] = rows.Sum(r => r.Opening);
            report.Totals["debit"] = rows.Sum(r => r.Debit);
            report.Totals["credit"] = rows.Sum(r => r.Credit);
            report.Totals["closing"] = rows.Sum(r => r.Closing);
            report.TotalLabels["closing"] = customers ? "Total Receivable" : "Total Payable";
            report.TotalLabels["debit"] = customers ? "Invoiced" : "Billed";
            report.TotalLabels["credit"] = customers ? "Received" : "Paid";

            // Reconcile to the control account and report any gap explicitly.
            var control = customers ? ControlType.AccountsReceivable : ControlType.AccountsPayable;
            var controlAccount = await _context.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId && a.ControlType == control)
                .Select(a => new { a.Id, a.Name })
                .FirstOrDefaultAsync();

            if (controlAccount != null)
            {
                var balances = await _gl.GetAccountBalancesAsync(companyId, window.To);
                var controlBalance = balances.GetValueOrDefault(controlAccount.Id) * flip;
                report.ControlAccountName = controlAccount.Name;
                report.ControlAccountBalance = controlBalance;
                report.Unattributed = controlBalance - report.Totals["closing"];
                if (Math.Abs(report.Unattributed) > 0.005m)
                    report.Notice = $"{Math.Abs(report.Unattributed):N2} of the {controlAccount.Name} "
                                  + "balance is not attributed to any party — usually an opening balance "
                                  + "loaded as a lump sum during a migration. The party rows below are "
                                  + "complete; the difference sits on the control account itself.";
            }

            return report;
        }

        /// <summary>
        /// Per-party balances from the documents, for a company whose ledger has no
        /// party tags. Uses the same movement loader as the document-sourced ledger,
        /// so a party's summary row always equals the closing balance of their
        /// ledger.
        /// </summary>
        private async Task FillPartyBalancesFromDocumentsAsync(int companyId, ReportFilterDto f,
            ReportWindow window, bool customers, PartyBalanceSummaryDto report)
        {
            var partyType = customers ? "Client" : "Supplier";
            var flip = customers ? 1m : -1m;
            var moves = await LoadPartyMovementsAsync(companyId, f, customers, partyId: null);

            var aged = customers
                ? await _gl.GetAgedReceivablesAsync(companyId, window.To)
                : await _gl.GetAgedPayablesAsync(companyId, window.To);
            var openDocs = aged.Rows.ToDictionary(r => r.PartyId, r => r.OpenDocuments);

            var names = await LoadPartyNamesAsync(companyId,
                moves.Select(m => ((string?)partyType, (int?)m.PartyId)).Distinct());

            var rows = new List<PartyBalanceRowDto>();
            foreach (var g in moves.GroupBy(m => m.PartyId))
            {
                var opening = window.From.HasValue
                    ? g.Where(m => m.Date.Date < window.From!.Value.Date).Sum(m => m.Debit - m.Credit)
                    : 0m;
                var inWindow = g.Where(m =>
                    (!window.From.HasValue || m.Date.Date >= window.From!.Value.Date)
                    && (!window.To.HasValue || m.Date.Date <= window.To!.Value.Date)).ToList();
                var dr = inWindow.Sum(m => m.Debit);
                var cr = inWindow.Sum(m => m.Credit);
                if (opening == 0m && dr == 0m && cr == 0m) continue;

                var closing = (opening + dr - cr) * flip;
                rows.Add(new PartyBalanceRowDto
                {
                    PartyId = g.Key,
                    Party = names.GetValueOrDefault((partyType, g.Key)) ?? $"{partyType} #{g.Key}",
                    Opening = opening * flip,
                    Debit = dr,
                    Credit = cr,
                    Closing = closing,
                    OpenDocuments = openDocs.GetValueOrDefault(g.Key),
                    Status = closing > 0.005m ? "Owing" : closing < -0.005m ? "In credit" : "Settled",
                });
            }

            rows = rows.OrderByDescending(r => r.Closing).ToList();
            report.Rows = rows.Cast<object>().ToList();
            report.TotalCount = rows.Count;
            report.Page = 1;
            report.PageSize = rows.Count;
            report.Totals["opening"] = rows.Sum(r => r.Opening);
            report.Totals["debit"] = rows.Sum(r => r.Debit);
            report.Totals["credit"] = rows.Sum(r => r.Credit);
            report.Totals["closing"] = rows.Sum(r => r.Closing);
            report.TotalLabels["closing"] = customers ? "Total Receivable" : "Total Payable";
            report.TotalLabels["debit"] = customers ? "Invoiced" : "Billed";
            report.TotalLabels["credit"] = customers ? "Received" : "Paid";

            // Reconcile against the aging report and explain any gap.
            //
            // The two answer different questions and can legitimately differ: aging
            // sums only the documents still carrying a positive balance, while this
            // summary is the party's whole position. Credit notes and supplier debit
            // notes reduce a position without being an open document, and a party in
            // credit nets off here but is simply absent there. Left unexplained, two
            // screens showing different "total receivable" figures destroys trust in
            // both — so the difference is named rather than left to be discovered.
            var agedForCheck = customers
                ? await _gl.GetAgedReceivablesAsync(companyId, window.To)
                : await _gl.GetAgedPayablesAsync(companyId, window.To);
            report.ControlAccountBalance = agedForCheck.Total;
            report.ControlAccountName = customers ? "Aged receivables" : "Aged payables";
            report.Unattributed = report.Totals["closing"] - agedForCheck.Total;

            if (Math.Abs(report.Unattributed) > 0.005m)
            {
                var sign = report.Unattributed < 0 ? "lower" : "higher";
                report.Notice = (report.Notice is null ? "" : report.Notice + " ")
                    + $"This position is {Math.Abs(report.Unattributed):N2} {sign} than the "
                    + $"{(customers ? "Accounts Receivable" : "Accounts Payable")} Aging total. "
                    + "That is expected: aging counts only documents that still carry a balance, "
                    + $"whereas this is the full position — {(customers ? "credit notes" : "debit notes")} "
                    + "and parties in credit move it without being an open document.";
            }
        }

        // ── Outstanding documents ─────────────────────────────────────────────────

        public async Task<ReportResultDto> GetOutstandingDocumentsAsync(int companyId,
            ReportFilterDto filter, bool customers)
        {
            var window = ResolveWindow(filter);
            var report = await NewReportAsync(companyId,
                customers ? "Outstanding Sales Invoices" : "Outstanding Purchase Bills",
                window, filter, ledgerSourced: true);
            report.Columns = new List<ReportColumnDto>
            {
                Col("date", "Date", "date"),
                Col("documentNo", customers ? "Invoice No." : "Bill No."),
                Col("party", customers ? "Customer" : "Supplier"),
                Col("dueDate", "Due", "date"),
                Col("grandTotal", "Total", "money", totalled: true),
                Col("paid", "Paid", "money", totalled: true),
                Col("outstanding", "Outstanding", "money", totalled: true),
                Col("daysOverdue", "Days overdue", "int"),
                Col("ageBucket", "Age"),
                Col("status", "Status", "status"),
            };

            var today = PakistanClock.Today;
            var partyId = customers
                ? (filter.ClientId ?? filter.PayeeId)
                : (filter.SupplierId ?? filter.PayeeId);

            // Outstanding = grand total − withholding tax − paid. Identical to the
            // aging report and the payment screens; a different expression here
            // would make the two disagree by exactly the withheld tax.
            List<OutstandingDocumentRowDto> rows;
            if (customers)
            {
                var q = _context.Invoices.AsNoTracking()
                    .Where(i => i.CompanyId == companyId && !i.IsDemo && !i.IsCancelled
                             && i.DocumentType != 9 && i.DocumentType != 10
                             && i.GrandTotal - i.WithholdingTaxAmount > i.AmountPaid);
                if (window.From.HasValue) q = q.Where(i => i.Date >= window.From!.Value);
                if (window.To.HasValue) q = q.Where(i => i.Date <= window.To!.Value);
                if (partyId.HasValue) q = q.Where(i => i.ClientId == partyId.Value);
                if (filter.DivisionId.HasValue) q = q.Where(i => i.DivisionId == filter.DivisionId!.Value);
                if (filter.AllowedDivisionIds != null)
                {
                    var allowed = filter.AllowedDivisionIds;
                    q = q.Where(i => i.DivisionId == null || allowed.Contains(i.DivisionId.Value));
                }
                if (!string.IsNullOrWhiteSpace(filter.Search))
                {
                    var s = filter.Search.Trim();
                    q = q.Where(i => EF.Functions.Like(i.Client!.Name, $"%{s}%"));
                }

                rows = (await q.Select(i => new
                {
                    i.Id, i.InvoiceNumber, i.Date, i.DueDate, i.ClientId,
                    Party = i.Client!.Name, i.GrandTotal, i.GSTAmount,
                    i.WithholdingTaxAmount, i.AmountPaid,
                    Division = i.Division != null ? i.Division.Name : null,
                }).ToListAsync())
                .Select(x => BuildOutstanding($"INV-{x.InvoiceNumber}", x.Id, x.Date, x.DueDate,
                    x.ClientId, x.Party, x.GrandTotal, x.GSTAmount, x.WithholdingTaxAmount,
                    x.AmountPaid, x.Division, today))
                .ToList();
            }
            else
            {
                var q = _context.PurchaseBills.AsNoTracking()
                    .Where(b => b.CompanyId == companyId
                             && b.GrandTotal - b.WithholdingTaxAmount > b.AmountPaid);
                if (window.From.HasValue) q = q.Where(b => b.Date >= window.From!.Value);
                if (window.To.HasValue) q = q.Where(b => b.Date <= window.To!.Value);
                if (partyId.HasValue) q = q.Where(b => b.SupplierId == partyId.Value);
                if (filter.DivisionId.HasValue) q = q.Where(b => b.DivisionId == filter.DivisionId!.Value);
                if (filter.AllowedDivisionIds != null)
                {
                    var allowed = filter.AllowedDivisionIds;
                    q = q.Where(b => b.DivisionId == null || allowed.Contains(b.DivisionId.Value));
                }
                if (!string.IsNullOrWhiteSpace(filter.Search))
                {
                    var s = filter.Search.Trim();
                    q = q.Where(b => EF.Functions.Like(b.Supplier!.Name, $"%{s}%"));
                }

                rows = (await q.Select(b => new
                {
                    b.Id, b.PurchaseBillNumber, b.Date, b.DueDate, b.SupplierId,
                    Party = b.Supplier!.Name, b.GrandTotal, b.GSTAmount,
                    b.WithholdingTaxAmount, b.AmountPaid,
                    Division = b.Division != null ? b.Division.Name : null,
                }).ToListAsync())
                .Select(x => BuildOutstanding($"BILL-{x.PurchaseBillNumber}", x.Id, x.Date, x.DueDate,
                    x.SupplierId, x.Party, x.GrandTotal, x.GSTAmount, x.WithholdingTaxAmount,
                    x.AmountPaid, x.Division, today))
                .ToList();
            }

            // Oldest debt first — this report exists to drive collection.
            rows = rows.OrderByDescending(r => r.DaysOverdue).ThenByDescending(r => r.Outstanding).ToList();

            report.TotalCount = rows.Count;
            var (page, size) = ResolvePaging(filter, forExport: false);
            report.Page = page;
            report.PageSize = size;
            report.Rows = rows.Skip((page - 1) * size).Take(size).Cast<object>().ToList();

            report.Totals["grandTotal"] = rows.Sum(r => r.GrandTotal);
            report.Totals["paid"] = rows.Sum(r => r.Paid);
            report.Totals["outstanding"] = rows.Sum(r => r.Outstanding);
            report.Totals["transactionCount"] = rows.Count;
            report.TotalLabels["outstanding"] = customers ? "Total Receivable" : "Total Payable";
            report.TotalLabels["grandTotal"] = "Documents Total";
            report.TotalLabels["paid"] = "Already Paid";
            report.TotalLabels["transactionCount"] = customers ? "Open Invoices" : "Open Bills";
            report.Totals["overdueAmount"] = rows.Where(r => r.DaysOverdue > 0).Sum(r => r.Outstanding);
            report.TotalLabels["overdueAmount"] = "Past Due";

            report.GroupSummaries.Add(new ReportGroupSummaryDto
            {
                Title = customers ? "Outstanding by Customer" : "Outstanding by Supplier",
                DrillFilter = customers ? "clientId" : "supplierId",
                Rows = rows.GroupBy(r => new { r.PartyId, r.Party })
                    .Select(g => new ReportGroupRowDto
                    {
                        DrillKey = g.Key.PartyId.ToString(),
                        Label = g.Key.Party,
                        Amount = g.Sum(x => x.Outstanding),
                        Count = g.Count(),
                    })
                    .OrderByDescending(g => g.Amount).ToList(),
                Total = rows.Sum(r => r.Outstanding),
            });

            return report;
        }

        private static OutstandingDocumentRowDto BuildOutstanding(string docNo, int id,
            DateTime date, DateTime? dueDate, int partyId, string party, decimal grandTotal,
            decimal tax, decimal wht, decimal paid, string? division, DateTime today)
        {
            var anchor = (dueDate ?? date).Date;
            var days = (today - anchor).Days;
            var outstanding = grandTotal - wht - paid;
            return new OutstandingDocumentRowDto
            {
                DocumentId = id,
                Date = date,
                DueDate = dueDate,
                DocumentNo = docNo,
                Party = party,
                PartyId = partyId,
                GrandTotal = grandTotal,
                Tax = tax,
                WithholdingTax = wht,
                Paid = paid,
                Outstanding = outstanding,
                DaysOverdue = days,
                AgeBucket = days <= 0 ? "Current" : days <= 30 ? "1-30"
                            : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+",
                Status = days > 0 ? "Overdue" : paid > 0m ? "Partial" : "Unpaid",
                Division = division,
            };
        }

        // ── Customer sales / supplier purchases ───────────────────────────────────

        public async Task<ReportResultDto> GetPartyTradeAsync(int companyId,
            ReportFilterDto filter, bool customers)
        {
            var window = ResolveWindow(filter);
            var report = await NewReportAsync(companyId,
                customers ? "Customer Sales" : "Supplier Purchases",
                window, filter, ledgerSourced: true);
            report.Columns = new List<ReportColumnDto>
            {
                Col("date", "Date", "date"),
                Col("documentNo", customers ? "Invoice No." : "Bill No."),
                Col("party", customers ? "Customer" : "Supplier"),
                Col("item", "Item"),
                Col("itemType", "Item Type"),
                Col("quantity", "Qty", "money"),
                Col("uom", "Unit"),
                Col("unitPrice", "Unit Price", "money"),
                Col("lineTotal", "Line Total", "money", totalled: true),
                // Labelled as apportioned because tax is recorded per document.
                Col("tax", "Tax (apportioned)", "money", totalled: true),
                Col("total", "Total", "money", totalled: true),
                Col("paymentStatus", "Payment", "status"),
            };

            var partyId = customers
                ? (filter.ClientId ?? filter.PayeeId)
                : (filter.SupplierId ?? filter.PayeeId);
            var today = PakistanClock.Today;

            List<PartyTradeRowDto> rows;
            if (customers)
            {
                var q = _context.InvoiceItems.AsNoTracking()
                    .Where(it => it.Invoice.CompanyId == companyId
                              && !it.Invoice.IsDemo && !it.Invoice.IsCancelled);
                if (window.From.HasValue) q = q.Where(it => it.Invoice.Date >= window.From!.Value);
                if (window.To.HasValue) q = q.Where(it => it.Invoice.Date <= window.To!.Value);
                if (partyId.HasValue) q = q.Where(it => it.Invoice.ClientId == partyId.Value);
                if (filter.ItemTypeId.HasValue) q = q.Where(it => it.ItemTypeId == filter.ItemTypeId!.Value);
                if (filter.DivisionId.HasValue)
                    q = q.Where(it => it.Invoice.DivisionId == filter.DivisionId!.Value);
                if (filter.AllowedDivisionIds != null)
                {
                    var allowed = filter.AllowedDivisionIds;
                    q = q.Where(it => it.Invoice.DivisionId == null
                                   || allowed.Contains(it.Invoice.DivisionId.Value));
                }
                if (!string.IsNullOrWhiteSpace(filter.Search))
                {
                    var s = filter.Search.Trim();
                    q = q.Where(it => EF.Functions.Like(it.Description, $"%{s}%")
                                   || EF.Functions.Like(it.ItemTypeName, $"%{s}%")
                                   || EF.Functions.Like(it.Invoice.Client!.Name, $"%{s}%"));
                }

                report.TotalCount = await q.CountAsync();
                var (page, size) = ResolvePaging(filter, forExport: false);
                report.Page = page; report.PageSize = size;

                rows = (await q
                    .OrderByDescending(it => it.Invoice.Date).ThenByDescending(it => it.InvoiceId).ThenBy(it => it.Id)
                    .Skip((page - 1) * size).Take(size)
                    .Select(it => new
                    {
                        it.Invoice.Date, it.InvoiceId, it.Invoice.InvoiceNumber,
                        it.Invoice.DocumentType, it.Invoice.ClientId,
                        Party = it.Invoice.Client!.Name,
                        it.Description, it.ItemTypeName, it.ItemTypeId,
                        it.Quantity, it.UOM, it.UnitPrice, it.LineTotal,
                        DocSubtotal = it.Invoice.Subtotal, DocTax = it.Invoice.GSTAmount,
                        it.Invoice.GrandTotal, it.Invoice.AmountPaid, it.Invoice.DueDate,
                        it.Invoice.WithholdingTaxAmount,
                        Division = it.Invoice.Division != null ? it.Invoice.Division.Name : null,
                    })
                    .ToListAsync())
                    .Select(x => new PartyTradeRowDto
                    {
                        Date = x.Date,
                        DocumentId = x.InvoiceId,
                        DocumentNo = x.DocumentType switch
                        {
                            10 => $"CN-{x.InvoiceNumber}",
                            9 => $"DN-{x.InvoiceNumber}",
                            _ => $"INV-{x.InvoiceNumber}",
                        },
                        DocumentType = x.DocumentType switch
                        {
                            10 => "Credit Note", 9 => "Debit Note", _ => "Sales Invoice",
                        },
                        Party = x.Party,
                        PartyId = x.ClientId,
                        Item = x.Description,
                        ItemType = x.ItemTypeName,
                        ItemTypeId = x.ItemTypeId,
                        Quantity = x.Quantity,
                        Uom = x.UOM,
                        UnitPrice = x.UnitPrice,
                        LineTotal = x.LineTotal,
                        Tax = Apportion(x.LineTotal, x.DocSubtotal, x.DocTax),
                        Total = x.LineTotal + Apportion(x.LineTotal, x.DocSubtotal, x.DocTax),
                        PaymentStatus = PaymentStatusCalculator.Status(
                            WithholdingTaxCalculator.Collectible(x.GrandTotal, x.WithholdingTaxAmount),
                            x.AmountPaid, x.DueDate).ToString(),
                        Division = x.Division,
                    })
                    .ToList();
            }
            else
            {
                var q = _context.PurchaseItems.AsNoTracking()
                    .Where(it => it.PurchaseBill.CompanyId == companyId);
                if (window.From.HasValue) q = q.Where(it => it.PurchaseBill.Date >= window.From!.Value);
                if (window.To.HasValue) q = q.Where(it => it.PurchaseBill.Date <= window.To!.Value);
                if (partyId.HasValue) q = q.Where(it => it.PurchaseBill.SupplierId == partyId.Value);
                if (filter.ItemTypeId.HasValue) q = q.Where(it => it.ItemTypeId == filter.ItemTypeId!.Value);
                if (filter.DivisionId.HasValue)
                    q = q.Where(it => it.PurchaseBill.DivisionId == filter.DivisionId!.Value);
                if (filter.AllowedDivisionIds != null)
                {
                    var allowed = filter.AllowedDivisionIds;
                    q = q.Where(it => it.PurchaseBill.DivisionId == null
                                   || allowed.Contains(it.PurchaseBill.DivisionId.Value));
                }
                if (!string.IsNullOrWhiteSpace(filter.Search))
                {
                    var s = filter.Search.Trim();
                    q = q.Where(it => EF.Functions.Like(it.Description, $"%{s}%")
                                   || EF.Functions.Like(it.ItemTypeName, $"%{s}%")
                                   || EF.Functions.Like(it.PurchaseBill.Supplier!.Name, $"%{s}%"));
                }

                report.TotalCount = await q.CountAsync();
                var (page, size) = ResolvePaging(filter, forExport: false);
                report.Page = page; report.PageSize = size;

                rows = (await q
                    .OrderByDescending(it => it.PurchaseBill.Date)
                    .ThenByDescending(it => it.PurchaseBillId).ThenBy(it => it.Id)
                    .Skip((page - 1) * size).Take(size)
                    .Select(it => new
                    {
                        it.PurchaseBill.Date, it.PurchaseBillId, it.PurchaseBill.PurchaseBillNumber,
                        it.PurchaseBill.SupplierId, Party = it.PurchaseBill.Supplier!.Name,
                        it.Description, it.ItemTypeName, it.ItemTypeId,
                        it.Quantity, it.UOM, it.UnitPrice, it.LineTotal,
                        DocSubtotal = it.PurchaseBill.Subtotal, DocTax = it.PurchaseBill.GSTAmount,
                        it.PurchaseBill.GrandTotal, it.PurchaseBill.AmountPaid, it.PurchaseBill.DueDate,
                        it.PurchaseBill.WithholdingTaxAmount,
                        Division = it.PurchaseBill.Division != null ? it.PurchaseBill.Division.Name : null,
                    })
                    .ToListAsync())
                    .Select(x => new PartyTradeRowDto
                    {
                        Date = x.Date,
                        DocumentId = x.PurchaseBillId,
                        DocumentNo = $"BILL-{x.PurchaseBillNumber}",
                        DocumentType = "Purchase Bill",
                        Party = x.Party,
                        PartyId = x.SupplierId,
                        Item = x.Description,
                        ItemType = x.ItemTypeName,
                        ItemTypeId = x.ItemTypeId,
                        Quantity = x.Quantity,
                        Uom = x.UOM,
                        UnitPrice = x.UnitPrice,
                        LineTotal = x.LineTotal,
                        Tax = Apportion(x.LineTotal, x.DocSubtotal, x.DocTax),
                        Total = x.LineTotal + Apportion(x.LineTotal, x.DocSubtotal, x.DocTax),
                        PaymentStatus = PaymentStatusCalculator.Status(
                            WithholdingTaxCalculator.Collectible(x.GrandTotal, x.WithholdingTaxAmount),
                            x.AmountPaid, x.DueDate).ToString(),
                        Division = x.Division,
                    })
                    .ToList();
            }

            report.Rows = rows.Cast<object>().ToList();
            await FillPartyTradeTotalsAsync(companyId, filter, window, customers, partyId, report);
            report.GroupSummaries.Add(
                await PartyTradeGroupAsync(companyId, filter, window, customers, partyId));
            return report;
        }

        /// <summary>Apportion a document-level tax to one line by its share of the
        /// subtotal. Guarded against a zero subtotal (a fully-discounted document).</summary>
        private static decimal Apportion(decimal lineTotal, decimal docSubtotal, decimal docTax)
        {
            if (docSubtotal == 0m || docTax == 0m) return 0m;
            return Math.Round(docTax * (lineTotal / docSubtotal), 2);
        }

        /// <summary>
        /// Totals over the whole filtered set. Summed at DOCUMENT level for tax and
        /// grand total — apportioning per line and adding it up would drift by the
        /// rounding residual on every document.
        /// </summary>
        private async Task FillPartyTradeTotalsAsync(int companyId, ReportFilterDto f,
            ReportWindow window, bool customers, int? partyId, ReportResultDto report)
        {
            if (customers)
            {
                var q = _context.InvoiceItems.AsNoTracking()
                    .Where(it => it.Invoice.CompanyId == companyId
                              && !it.Invoice.IsDemo && !it.Invoice.IsCancelled);
                if (window.From.HasValue) q = q.Where(it => it.Invoice.Date >= window.From!.Value);
                if (window.To.HasValue) q = q.Where(it => it.Invoice.Date <= window.To!.Value);
                if (partyId.HasValue) q = q.Where(it => it.Invoice.ClientId == partyId.Value);
                if (f.ItemTypeId.HasValue) q = q.Where(it => it.ItemTypeId == f.ItemTypeId!.Value);
                if (f.DivisionId.HasValue) q = q.Where(it => it.Invoice.DivisionId == f.DivisionId!.Value);

                report.Totals["lineTotal"] = await q.SumAsync(it => (decimal?)it.LineTotal) ?? 0m;
                var docs = await q.Select(it => it.InvoiceId).Distinct().ToListAsync();
                var docTotals = await _context.Invoices.AsNoTracking()
                    .Where(i => docs.Contains(i.Id))
                    .GroupBy(_ => 1)
                    .Select(g => new { Tax = g.Sum(x => x.GSTAmount), Grand = g.Sum(x => x.GrandTotal) })
                    .FirstOrDefaultAsync();
                report.Totals["tax"] = docTotals?.Tax ?? 0m;
                report.Totals["total"] = docTotals?.Grand ?? 0m;
                report.Totals["transactionCount"] = docs.Count;
                report.TotalLabels["lineTotal"] = "Total Sales (net)";
                report.TotalLabels["tax"] = "Total Tax";
                report.TotalLabels["total"] = "Total Invoiced";
                report.TotalLabels["transactionCount"] = "Invoices";
            }
            else
            {
                var q = _context.PurchaseItems.AsNoTracking()
                    .Where(it => it.PurchaseBill.CompanyId == companyId);
                if (window.From.HasValue) q = q.Where(it => it.PurchaseBill.Date >= window.From!.Value);
                if (window.To.HasValue) q = q.Where(it => it.PurchaseBill.Date <= window.To!.Value);
                if (partyId.HasValue) q = q.Where(it => it.PurchaseBill.SupplierId == partyId.Value);
                if (f.ItemTypeId.HasValue) q = q.Where(it => it.ItemTypeId == f.ItemTypeId!.Value);
                if (f.DivisionId.HasValue) q = q.Where(it => it.PurchaseBill.DivisionId == f.DivisionId!.Value);

                report.Totals["lineTotal"] = await q.SumAsync(it => (decimal?)it.LineTotal) ?? 0m;
                var docs = await q.Select(it => it.PurchaseBillId).Distinct().ToListAsync();
                var docTotals = await _context.PurchaseBills.AsNoTracking()
                    .Where(b => docs.Contains(b.Id))
                    .GroupBy(_ => 1)
                    .Select(g => new { Tax = g.Sum(x => x.GSTAmount), Grand = g.Sum(x => x.GrandTotal) })
                    .FirstOrDefaultAsync();
                report.Totals["tax"] = docTotals?.Tax ?? 0m;
                report.Totals["total"] = docTotals?.Grand ?? 0m;
                report.Totals["transactionCount"] = docs.Count;
                report.TotalLabels["lineTotal"] = "Total Purchases (net)";
                report.TotalLabels["tax"] = "Total Tax";
                report.TotalLabels["total"] = "Total Billed";
                report.TotalLabels["transactionCount"] = "Bills";
            }
        }

        /// <summary>Breakdown by item type — "what does this customer actually buy".</summary>
        private async Task<ReportGroupSummaryDto> PartyTradeGroupAsync(int companyId,
            ReportFilterDto f, ReportWindow window, bool customers, int? partyId)
        {
            List<(string Label, int? Id, decimal Amount, int Count)> rows;
            if (customers)
            {
                var q = _context.InvoiceItems.AsNoTracking()
                    .Where(it => it.Invoice.CompanyId == companyId
                              && !it.Invoice.IsDemo && !it.Invoice.IsCancelled);
                if (window.From.HasValue) q = q.Where(it => it.Invoice.Date >= window.From!.Value);
                if (window.To.HasValue) q = q.Where(it => it.Invoice.Date <= window.To!.Value);
                if (partyId.HasValue) q = q.Where(it => it.Invoice.ClientId == partyId.Value);
                if (f.DivisionId.HasValue) q = q.Where(it => it.Invoice.DivisionId == f.DivisionId!.Value);

                rows = (await q.GroupBy(it => new { it.ItemTypeId, it.ItemTypeName })
                    .Select(g => new
                    {
                        g.Key.ItemTypeId, g.Key.ItemTypeName,
                        Amount = g.Sum(x => x.LineTotal),
                        Count = g.Select(x => x.InvoiceId).Distinct().Count(),
                    }).ToListAsync())
                    .Select(x => (Label: string.IsNullOrWhiteSpace(x.ItemTypeName) ? "Unclassified" : x.ItemTypeName,
                                  Id: x.ItemTypeId, x.Amount, x.Count))
                    .ToList();
            }
            else
            {
                var q = _context.PurchaseItems.AsNoTracking()
                    .Where(it => it.PurchaseBill.CompanyId == companyId);
                if (window.From.HasValue) q = q.Where(it => it.PurchaseBill.Date >= window.From!.Value);
                if (window.To.HasValue) q = q.Where(it => it.PurchaseBill.Date <= window.To!.Value);
                if (partyId.HasValue) q = q.Where(it => it.PurchaseBill.SupplierId == partyId.Value);
                if (f.DivisionId.HasValue) q = q.Where(it => it.PurchaseBill.DivisionId == f.DivisionId!.Value);

                rows = (await q.GroupBy(it => new { it.ItemTypeId, it.ItemTypeName })
                    .Select(g => new
                    {
                        g.Key.ItemTypeId, g.Key.ItemTypeName,
                        Amount = g.Sum(x => x.LineTotal),
                        Count = g.Select(x => x.PurchaseBillId).Distinct().Count(),
                    }).ToListAsync())
                    .Select(x => (Label: string.IsNullOrWhiteSpace(x.ItemTypeName) ? "Unclassified" : x.ItemTypeName,
                                  Id: x.ItemTypeId, x.Amount, x.Count))
                    .ToList();
            }

            return new ReportGroupSummaryDto
            {
                Title = customers ? "Sales by Item Type" : "Purchases by Item Type",
                DrillFilter = "itemTypeId",
                Rows = rows.Select(r => new ReportGroupRowDto
                {
                    DrillKey = r.Id?.ToString(),
                    Label = r.Label,
                    Amount = r.Amount,
                    Count = r.Count,
                }).OrderByDescending(r => r.Amount).ToList(),
                Total = rows.Sum(r => r.Amount),
            };
        }

        // ── Aging (delegates to the GL service, adds drill-down + asOf) ───────────

        public async Task<ReportResultDto> GetAgingReportAsync(int companyId,
            ReportFilterDto filter, bool customers)
        {
            var window = ResolveWindow(filter);
            // Aging is a point-in-time view, so only the END of the window matters.
            var asOf = window.To;

            var report = await NewReportAsync(companyId,
                customers ? "Accounts Receivable Aging" : "Accounts Payable Aging",
                window, filter, ledgerSourced: true);
            report.PeriodLabel = asOf.HasValue
                ? $"As of {asOf.Value:d MMM yyyy}"
                : $"As of {PakistanClock.Today:d MMM yyyy}";
            report.Columns = new List<ReportColumnDto>
            {
                Col("party", customers ? "Customer" : "Supplier"),
                Col("openDocuments", "Open docs", "int"),
                Col("current", "Current", "money", totalled: true),
                Col("days1To30", "1–30", "money", totalled: true),
                Col("days31To60", "31–60", "money", totalled: true),
                Col("days61To90", "61–90", "money", totalled: true),
                Col("over90", "90+", "money", totalled: true),
                Col("total", "Total", "money", totalled: true),
            };

            // Reuse the existing aging outright — no second bucket calculation.
            var aged = customers
                ? await _gl.GetAgedReceivablesAsync(companyId, asOf)
                : await _gl.GetAgedPayablesAsync(companyId, asOf);

            var rows = aged.Rows.AsEnumerable();
            var partyId = customers
                ? (filter.ClientId ?? filter.PayeeId)
                : (filter.SupplierId ?? filter.PayeeId);
            if (partyId.HasValue) rows = rows.Where(r => r.PartyId == partyId.Value);
            if (!string.IsNullOrWhiteSpace(filter.Search))
            {
                var s = filter.Search.Trim();
                rows = rows.Where(r => r.Name.Contains(s, StringComparison.OrdinalIgnoreCase));
            }
            // "Only overdue" — the collection worklist.
            if (string.Equals(filter.Status, "overdue", StringComparison.OrdinalIgnoreCase))
                rows = rows.Where(r => r.Days1To30 + r.Days31To60 + r.Days61To90 + r.Over90 > 0m);

            var list = rows.ToList();
            report.Rows = list.Select(r => (object)new
            {
                partyId = r.PartyId,
                party = r.Name,
                openDocuments = r.OpenDocuments,
                current = r.Current,
                days1To30 = r.Days1To30,
                days31To60 = r.Days31To60,
                days61To90 = r.Days61To90,
                over90 = r.Over90,
                total = r.Total,
            }).ToList();

            report.TotalCount = list.Count;
            report.Page = 1;
            report.PageSize = list.Count;
            report.Totals["current"] = list.Sum(r => r.Current);
            report.Totals["days1To30"] = list.Sum(r => r.Days1To30);
            report.Totals["days31To60"] = list.Sum(r => r.Days31To60);
            report.Totals["days61To90"] = list.Sum(r => r.Days61To90);
            report.Totals["over90"] = list.Sum(r => r.Over90);
            report.Totals["total"] = list.Sum(r => r.Total);
            report.TotalLabels["total"] = customers ? "Total Receivable" : "Total Payable";
            report.TotalLabels["over90"] = "Over 90 Days";
            report.Totals["overdueAmount"] = list.Sum(r =>
                r.Days1To30 + r.Days31To60 + r.Days61To90 + r.Over90);
            report.TotalLabels["overdueAmount"] = "Past Due";

            // Clicking a party goes to their outstanding documents — the invoices
            // or bills the balance is actually made of.
            report.GroupSummaries.Add(new ReportGroupSummaryDto
            {
                Title = customers ? "Balance by Customer" : "Balance by Supplier",
                DrillFilter = customers ? "clientId" : "supplierId",
                Rows = list.Select(r => new ReportGroupRowDto
                {
                    DrillKey = r.PartyId.ToString(),
                    Label = r.Name,
                    Amount = r.Total,
                    Count = r.OpenDocuments,
                }).OrderByDescending(r => r.Amount).ToList(),
                Total = list.Sum(r => r.Total),
            });

            return report;
        }
    }
}

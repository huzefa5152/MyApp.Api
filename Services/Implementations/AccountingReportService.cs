using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Accounting reporting engine — shared plumbing. The report families live in
    /// partials so no single file carries every report:
    ///   • <c>AccountingReportService.Expenses.cs</c>
    ///   • <c>AccountingReportService.CashBank.cs</c>
    ///
    /// This file holds only what all of them need: period/filter resolution, the
    /// report envelope, company and lookup naming, and paging.
    /// </summary>
    public partial class AccountingReportService : IAccountingReportService
    {
        private readonly AppDbContext _context;
        private readonly IGeneralLedgerService _gl;
        private readonly IPostingService _posting;
        private readonly ILogger<AccountingReportService> _logger;

        public AccountingReportService(AppDbContext context, IGeneralLedgerService gl,
            IPostingService posting, ILogger<AccountingReportService> logger)
        {
            _context = context;
            _gl = gl;
            _posting = posting;
            _logger = logger;
        }

        /// <summary>Row ceiling for an export. Screen paging is 100; an export takes
        /// the whole filtered set up to here, then says it truncated.</summary>
        private const int ExportMaxRows = ReportExcelBuilder.MaxRows;

        public Task<bool> CompanyExistsAsync(int companyId) =>
            _context.Companies.AsNoTracking().AnyAsync(c => c.Id == companyId);

        // ── Period / paging ───────────────────────────────────────────────────────

        private static ReportWindow ResolveWindow(ReportFilterDto f) =>
            ReportPeriod.Resolve(ReportPeriod.ParsePreset(f.Period), f.From, f.To);

        /// <summary>Page size for a report: clamped for the screen, lifted to the
        /// export ceiling when the caller is building a workbook.</summary>
        private static (int Page, int Size) ResolvePaging(ReportFilterDto f, bool forExport)
        {
            if (forExport) return (1, ExportMaxRows);
            return (PaginationHelper.ClampPage(f.Page), PaginationHelper.Clamp(f.PageSize, 50));
        }

        // ── Envelope ──────────────────────────────────────────────────────────────

        private async Task<ReportResultDto> NewReportAsync(int companyId, string title,
            ReportWindow window, ReportFilterDto filter, bool ledgerSourced)
        {
            var report = new ReportResultDto
            {
                Title = title,
                CompanyName = await CompanyNameAsync(companyId),
                PeriodLabel = window.Label,
                From = window.From,
                To = window.To,
                LedgerSourced = ledgerSourced,
                GeneratedAt = PakistanClock.Now,
            };
            report.FiltersApplied = await DescribeFiltersAsync(companyId, filter);
            return report;
        }

        /// <summary>
        /// The company name for the report header. BrandName wins when set, but it
        /// is stored as an EMPTY STRING rather than NULL for most companies, so a
        /// plain <c>??</c> yields "" and the printed report loses its letterhead.
        /// Both fields are pulled and the choice is made in memory.
        /// </summary>
        private async Task<string> CompanyNameAsync(int companyId)
        {
            var row = await _context.Companies.AsNoTracking()
                .Where(c => c.Id == companyId)
                .Select(c => new { c.BrandName, c.Name })
                .FirstOrDefaultAsync();
            if (row == null) return "";
            return !string.IsNullOrWhiteSpace(row.BrandName) ? row.BrandName! : row.Name ?? "";
        }

        /// <summary>
        /// Turn the active filters into the human list the report header, print
        /// layout and Excel banner all print. Built once, server-side, so screen,
        /// print and export can never disagree about what shaped the numbers —
        /// a report whose provenance is ambiguous is not auditable.
        /// </summary>
        private async Task<List<string>> DescribeFiltersAsync(int companyId, ReportFilterDto f)
        {
            var parts = new List<string>();

            if (f.DivisionId.HasValue)
                parts.Add($"Branch: {await LookupNameAsync(_context.Divisions.AsNoTracking()
                    .Where(d => d.Id == f.DivisionId.Value && d.CompanyId == companyId)
                    .Select(d => d.Name))}");

            if (f.AccountId.HasValue)
                parts.Add($"Account: {await AccountNameAsync(companyId, f.AccountId.Value)}");

            if (f.AccountGroupId.HasValue)
                parts.Add($"Category: {await LookupNameAsync(_context.AccountGroups.AsNoTracking()
                    .Where(g => g.Id == f.AccountGroupId.Value && g.CompanyId == companyId)
                    .Select(g => g.Name))}");

            if (f.PaymentAccountId.HasValue)
                parts.Add($"Paid from: {await AccountNameAsync(companyId, f.PaymentAccountId.Value)}");

            if (!string.IsNullOrWhiteSpace(f.PayeeType))
                parts.Add($"Payee type: {f.PayeeType}");

            if (f.PayeeId.HasValue)
                parts.Add($"Payee: {await PartyNameAsync(companyId, f.PayeeType, f.PayeeId.Value)}");

            if (f.ClientId.HasValue)
                parts.Add($"Customer: {await PartyNameAsync(companyId, "Client", f.ClientId.Value)}");

            if (f.SupplierId.HasValue)
                parts.Add($"Supplier: {await PartyNameAsync(companyId, "Supplier", f.SupplierId.Value)}");

            if (!string.IsNullOrWhiteSpace(f.Tax))
                parts.Add($"Tax: {DescribeTax(f.Tax)}");

            if (!string.IsNullOrWhiteSpace(f.Status))
                parts.Add($"Status: {f.Status}");

            if (!string.IsNullOrWhiteSpace(f.Search))
                parts.Add($"Search: \"{f.Search.Trim()}\"");

            return parts;
        }

        private static string DescribeTax(string tax) => tax.Trim().ToLowerInvariant() switch
        {
            "taxed" => "With tax only",
            "untaxed" => "Without tax only",
            var rate => $"{rate}%",
        };

        private static async Task<string> LookupNameAsync(IQueryable<string> query) =>
            await query.FirstOrDefaultAsync() ?? "—";

        private async Task<string> AccountNameAsync(int companyId, int accountId) =>
            await LookupNameAsync(_context.Accounts.AsNoTracking()
                .Where(a => a.Id == accountId && a.CompanyId == companyId)
                .Select(a => a.Name));

        private async Task<string> PartyNameAsync(int companyId, string? partyType, int partyId) =>
            partyType == "Supplier"
                ? await LookupNameAsync(_context.Suppliers.AsNoTracking()
                    .Where(s => s.Id == partyId && s.CompanyId == companyId).Select(s => s.Name))
                : await LookupNameAsync(_context.Clients.AsNoTracking()
                    .Where(c => c.Id == partyId && c.CompanyId == companyId).Select(c => c.Name));

        // -- Division scoping (RBAC) --

        /// <summary>
        /// Narrow a journal-line query to the divisions the caller may read.
        ///
        /// This is a SECURITY filter, not a convenience one. A division-restricted
        /// user who supplies no divisionId must still not see another branch's
        /// figures, so the restriction applies whether or not they filtered. A null
        /// <see cref="ReportFilterDto.AllowedDivisionIds"/> means unrestricted and
        /// nothing is added. Company-level rows (null DivisionId) stay visible --
        /// division-RBAC policy D1.
        /// </summary>
        private static IQueryable<JournalLine> ScopeToDivisions(
            IQueryable<JournalLine> q, ReportFilterDto f)
        {
            if (f.AllowedDivisionIds == null) return q;
            var allowed = f.AllowedDivisionIds;
            return q.Where(l =>
                (l.JournalEntry.DivisionId == null
                    || allowed.Contains(l.JournalEntry.DivisionId.Value))
                && (l.DivisionId == null || allowed.Contains(l.DivisionId.Value)));
        }

        /// <summary>Payment-side equivalent of <see cref="ScopeToDivisions"/>.</summary>
        private static IQueryable<Payment> ScopePaymentsToDivisions(
            IQueryable<Payment> q, ReportFilterDto f)
        {
            if (f.AllowedDivisionIds == null) return q;
            var allowed = f.AllowedDivisionIds;
            return q.Where(p => p.DivisionId == null || allowed.Contains(p.DivisionId.Value));
        }

        // ── Shared lookups ────────────────────────────────────────────────────────

        /// <summary>
        /// The company's bank/cash account ids. Resolution deliberately mirrors
        /// <c>GeneralLedgerService.GetSummaryAsync</c>: an account counts when it
        /// carries <see cref="ControlType.BankCash"/> OR sits in a group whose name
        /// mentions bank/cash. Two different answers to "which accounts are cash"
        /// would make the dashboard and the cash reports disagree.
        /// </summary>
        private async Task<List<Account>> LoadCashBankAccountsAsync(int companyId, string kind)
        {
            var groups = await _context.AccountGroups.AsNoTracking()
                .Where(g => g.CompanyId == companyId)
                .Select(g => new { g.Id, g.Name })
                .ToListAsync();

            var bankish = groups
                .Where(g => (g.Name ?? "").Contains("bank", StringComparison.OrdinalIgnoreCase)
                         || (g.Name ?? "").Contains("cash", StringComparison.OrdinalIgnoreCase))
                .Select(g => g.Id).ToHashSet();

            var accounts = await _context.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId && a.AccountType == AccountType.Asset)
                .ToListAsync();

            var cashBank = accounts
                .Where(a => a.ControlType == ControlType.BankCash || bankish.Contains(a.AccountGroupId))
                .ToList();

            // "Cash" vs "Bank" is a naming convention, not a stored flag — an account
            // called "Cash in hand" is cash, everything else in the group is a bank.
            return kind.ToLowerInvariant() switch
            {
                "cash" => cashBank.Where(IsCashAccount).ToList(),
                "bank" => cashBank.Where(a => !IsCashAccount(a)).ToList(),
                _ => cashBank,
            };
        }

        private static bool IsCashAccount(Account a) =>
            (a.Name ?? "").Contains("cash", StringComparison.OrdinalIgnoreCase)
            || (a.Name ?? "").Contains("petty", StringComparison.OrdinalIgnoreCase);

        private static string CashKindLabel(Account a) => IsCashAccount(a) ? "Cash" : "Bank";

        /// <summary>Display reference for a payment: RCP-0007 / PMT-0042 — the same
        /// format the payments module, statements and the accounting dashboard use.</summary>
        private static string PaymentRef(PaymentDirection direction, int number) =>
            $"{(direction == PaymentDirection.Receipt ? "RCP" : "PMT")}-{number:D4}";

        /// <summary>
        /// Party names for a set of payments, in two queries rather than per row.
        /// A payee is a Client, a Supplier, or free text on the payment itself
        /// ("Other" — a landlord, a courier), so all three resolve here.
        /// </summary>
        private async Task<Dictionary<(string Type, int Id), string>> LoadPartyNamesAsync(
            int companyId, IEnumerable<(string? Type, int? Id)> refs)
        {
            var map = new Dictionary<(string, int), string>();
            var list = refs.Where(r => r.Id.HasValue && r.Type is "Client" or "Supplier")
                .Select(r => (Type: r.Type!, Id: r.Id!.Value)).Distinct().ToList();
            if (list.Count == 0) return map;

            var clientIds = list.Where(r => r.Type == "Client").Select(r => r.Id).ToList();
            var supplierIds = list.Where(r => r.Type == "Supplier").Select(r => r.Id).ToList();

            if (clientIds.Count > 0)
                foreach (var c in await _context.Clients.AsNoTracking()
                             .Where(c => c.CompanyId == companyId && clientIds.Contains(c.Id))
                             .Select(c => new { c.Id, c.Name }).ToListAsync())
                    map[("Client", c.Id)] = c.Name;

            if (supplierIds.Count > 0)
                foreach (var s in await _context.Suppliers.AsNoTracking()
                             .Where(s => s.CompanyId == companyId && supplierIds.Contains(s.Id))
                             .Select(s => new { s.Id, s.Name }).ToListAsync())
                    map[("Supplier", s.Id)] = s.Name;

            return map;
        }

        private static string? ResolvePartyName(Dictionary<(string, int), string> names,
            string? contactType, int? contactId, string? contactName)
        {
            if (contactType is "Client" or "Supplier" && contactId.HasValue
                && names.TryGetValue((contactType, contactId.Value), out var n))
                return n;
            // "Other" payees have no master row — the name lives on the payment.
            return string.IsNullOrWhiteSpace(contactName) ? null : contactName;
        }

        // ── Column metadata ───────────────────────────────────────────────────────

        private static ReportColumnDto Col(string key, string label, string format = "text",
            bool totalled = false) =>
            new() { Key = key, Label = label, Format = format, Totalled = totalled };

        /// <summary>
        /// Validate a caller-supplied sort key against the report's own columns. A
        /// report never interpolates <c>SortBy</c> into a query — an unknown key
        /// falls back to the report's natural order instead.
        /// </summary>
        private static string? SafeSortKey(ReportFilterDto f, IEnumerable<ReportColumnDto> columns)
        {
            if (string.IsNullOrWhiteSpace(f.SortBy)) return null;
            var key = f.SortBy.Trim();
            return columns.Any(c => string.Equals(c.Key, key, StringComparison.OrdinalIgnoreCase))
                ? key : null;
        }

        /// <summary>
        /// Sort already-materialised rows by a validated column key. Used only where
        /// the page has already been narrowed by SQL — never as a substitute for a
        /// server-side ORDER BY over a full table.
        /// </summary>
        private static List<T> ApplySort<T>(List<T> rows, string? key, bool desc,
            Func<T, string, object?> selector)
        {
            if (key == null) return rows;
            var ordered = desc
                ? rows.OrderByDescending(r => selector(r, key), Comparer<object?>.Create(CompareValues))
                : rows.OrderBy(r => selector(r, key), Comparer<object?>.Create(CompareValues));
            return ordered.ToList();
        }

        private static int CompareValues(object? a, object? b)
        {
            if (a == null && b == null) return 0;
            if (a == null) return -1;
            if (b == null) return 1;
            if (a is IComparable ca && a.GetType() == b.GetType()) return ca.CompareTo(b);
            return string.Compare(a.ToString(), b.ToString(), StringComparison.OrdinalIgnoreCase);
        }
    }
}

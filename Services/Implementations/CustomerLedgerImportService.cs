using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers.ExcelImport;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <inheritdoc cref="ICustomerLedgerImportService"/>
    public partial class CustomerLedgerImportService : ICustomerLedgerImportService
    {
        private readonly AppDbContext _db;
        private readonly IClientGroupService _groups;
        private readonly IAccountService _accounts;
        private readonly ISpreadsheetImportService _imports;
        private readonly ILogger<CustomerLedgerImportService> _logger;

        public const int MaxClients = 2000;
        public const int MaxRowsPerClient = 5000;

        /// <summary>Below this, two names are different customers. Above it they
        /// are offered as a pairing for a human to confirm — never assumed.</summary>
        private const double FuzzyThreshold = 0.62;

        /// <summary>PKR is 2dp; anything under half a paisa is float noise from
        /// the spreadsheet, not a real disagreement.</summary>
        private const decimal BalanceTolerance = 0.005m;

        public CustomerLedgerImportService(
            AppDbContext db,
            IClientGroupService groups,
            IAccountService accounts,
            ISpreadsheetImportService imports,
            ILogger<CustomerLedgerImportService> logger)
        {
            _db = db;
            _groups = groups;
            _accounts = accounts;
            _imports = imports;
            _logger = logger;
        }

        // ── Preview ──────────────────────────────────────────────────────────

        public async Task<CustomerLedgerPreviewDto> PreviewAsync(
            byte[] bytes, string extension, string fileName, string fileSha256,
            string mappingJson, int companyId, int? profileId, int? profileVersion)
        {
            var map = CustomerLedgerMapping.Parse(mappingJson);

            var preview = new CustomerLedgerPreviewDto
            {
                FileName = fileName,
                FileSha256 = fileSha256,
                FileSizeBytes = bytes.LongLength,
                ImportProfileId = profileId,
                ProfileVersion = profileVersion,
                PeriodEnd = map.PeriodEnd,
                OpeningDate = map.OpeningDate,
            };

            using var stream = new MemoryStream(bytes, writable: false);
            using var wb = WorkbookReaderFactory.Open(stream, extension);

            var index = ReadIndex(wb, map, preview);
            if (preview.BlockingErrors.Count > 0) return preview;

            var sheets = ReadClientSheets(wb, map, preview);
            Pair(index, sheets, preview);

            BuildDocuments(index, map, preview);
            await ResolveExistingClientsAsync(preview, companyId);
            await CheckNumberCollisionsAsync(preview, companyId);

            Total(preview);

            var already = await _imports.FindBlockingRunAsync(
                companyId, ImportKinds.CustomerLedger, fileSha256);
            if (already != null)
            {
                var who = already.ImportedByUserName;
                preview.BlockingErrors.Add(who == null
                    ? $"This exact file was already imported on {already.ImportedAt:d MMM yyyy}. Nothing was changed."
                    : $"This exact file was already imported on {already.ImportedAt:d MMM yyyy} by {who}. Nothing was changed.");
            }

            return preview;
        }

        // ── Reading the index ────────────────────────────────────────────────

        private sealed class IndexEntry
        {
            public int Row;
            public string Name = "";
            public decimal Opening;
            public decimal StatedClosing;
            public bool HasStatedClosing;
            public ClientSheet? Sheet;
            public string MatchKind = LedgerClientMatch.Unmatched;
        }

        private List<IndexEntry> ReadIndex(
            IImportedWorkbook wb, CustomerLedgerMapping map, CustomerLedgerPreviewDto preview)
        {
            var entries = new List<IndexEntry>();

            var sheet = map.IndexSheet.ResolveOne(wb);
            if (sheet < 0)
            {
                preview.BlockingErrors.Add(
                    "The index sheet this layout expects was not found. Check the mapping, or pick a different layout.");
                return entries;
            }

            var lastRow = wb.GetLastRow(sheet);
            var cols = map.IndexColumns;
            var blanks = 0;

            for (int row = map.IndexFirstRow; row <= lastRow && entries.Count < MaxClients; row++)
            {
                var name = wb.GetString(sheet, row, cols.Name).Trim();
                if (string.IsNullOrWhiteSpace(name))
                {
                    if (++blanks >= 10) break;
                    continue;
                }
                blanks = 0;

                var closing = cols.Closing is > 0 ? wb.GetDecimal(sheet, row, cols.Closing.Value) : null;
                entries.Add(new IndexEntry
                {
                    Row = row,
                    Name = name,
                    Opening = cols.Opening is > 0 ? wb.GetDecimal(sheet, row, cols.Opening.Value) ?? 0m : 0m,
                    StatedClosing = closing ?? 0m,
                    HasStatedClosing = closing.HasValue,
                });
            }

            if (entries.Count == 0)
                preview.BlockingErrors.Add(
                    "No customers were found on the index sheet. Check the mapping's start row and name column.");

            return entries;
        }

        // ── Reading the customer sheets ──────────────────────────────────────

        private sealed class LedgerRow
        {
            public int Row;
            public DateTime? Date;
            public string? Reference;
            public string? Narrative;
            public decimal Debit;
            public decimal Credit;
            public decimal? StatedBalance;
        }

        private sealed class ClientSheet
        {
            public int SheetIndex;
            public string Tab = "";
            public string Name = "";
            public List<LedgerRow> Rows = new();
            public decimal? LastStatedBalance;
        }

        private List<ClientSheet> ReadClientSheets(
            IImportedWorkbook wb, CustomerLedgerMapping map, CustomerLedgerPreviewDto preview)
        {
            var result = new List<ClientSheet>();
            var (nameRow, nameCol) = map.ResolveNameCell();
            var cols = map.Columns;

            // The index sheet must not also be read as a customer sheet — the
            // "everything except" selector is configured by name, and a renamed
            // tab would otherwise silently become a customer.
            var indexSheet = map.IndexSheet.ResolveOne(wb);

            foreach (var s in map.ClientSheets.ResolveMany(wb))
            {
                if (s == indexSheet) continue;

                var sheet = new ClientSheet
                {
                    SheetIndex = s,
                    Tab = wb.GetSheetName(s) ?? "",
                    Name = wb.GetString(s, nameRow, nameCol).Trim(),
                };
                if (string.IsNullOrWhiteSpace(sheet.Name)) sheet.Name = sheet.Tab;

                var lastRow = wb.GetLastRow(s);
                var blanks = 0;

                for (int row = map.FirstDataRow; row <= lastRow && sheet.Rows.Count < MaxRowsPerClient; row++)
                {
                    var debit = wb.GetDecimal(s, row, cols.Debit) ?? 0m;
                    var credit = wb.GetDecimal(s, row, cols.Credit) ?? 0m;
                    var balance = cols.Balance is > 0 ? wb.GetDecimal(s, row, cols.Balance.Value) : null;

                    if (balance.HasValue) sheet.LastStatedBalance = balance;

                    if (debit == 0m && credit == 0m)
                    {
                        // These sheets carry long formatted tails that keep
                        // repeating the closing balance; they are not rows.
                        if (++blanks >= 40) break;
                        continue;
                    }
                    blanks = 0;

                    // The reference wanders between columns. First non-empty wins.
                    string? reference = null, narrative = null;
                    foreach (var c in cols.RefAny)
                    {
                        var text = wb.GetString(s, row, c).Trim();
                        if (string.IsNullOrWhiteSpace(text)) continue;
                        if (map.IsDocumentRef(text)) { reference = text; break; }
                        narrative ??= text;
                    }

                    sheet.Rows.Add(new LedgerRow
                    {
                        Row = row,
                        Date = cols.Date is > 0 ? wb.GetDate(s, row, cols.Date.Value) : null,
                        Reference = reference,
                        Narrative = narrative,
                        Debit = debit,
                        Credit = credit,
                        StatedBalance = balance,
                    });
                }

                result.Add(sheet);
            }

            if (result.Count == 0)
                preview.BlockingErrors.Add("No customer sheets were found in this workbook.");

            return result;
        }

        // ── Pairing sheets to index rows ─────────────────────────────────────

        /// <summary>
        /// Binds each customer sheet to its index row. An exact normalised match
        /// is taken; anything else is offered as <c>fuzzy</c> for a human to
        /// confirm, because a wrong pairing files one customer's invoices under
        /// another's name and nothing downstream would notice.
        /// </summary>
        private static void Pair(
            List<IndexEntry> index, List<ClientSheet> sheets, CustomerLedgerPreviewDto preview)
        {
            var unclaimed = new List<ClientSheet>(sheets);

            foreach (var entry in index)
            {
                var key = Normalise(entry.Name);
                var hit = unclaimed.FirstOrDefault(s => Normalise(s.Name) == key)
                          ?? unclaimed.FirstOrDefault(s => Normalise(s.Tab) == key);
                if (hit == null) continue;

                entry.Sheet = hit;
                entry.MatchKind = LedgerClientMatch.Exact;
                unclaimed.Remove(hit);
            }

            foreach (var entry in index.Where(e => e.Sheet == null))
            {
                var key = Normalise(entry.Name);
                var best = unclaimed
                    .Select(s => new { Sheet = s, Score = Math.Max(Similar(key, Normalise(s.Name)), Similar(key, Normalise(s.Tab))) })
                    .OrderByDescending(x => x.Score)
                    .FirstOrDefault();

                if (best == null || best.Score < FuzzyThreshold) continue;

                entry.Sheet = best.Sheet;
                entry.MatchKind = LedgerClientMatch.Fuzzy;
                unclaimed.Remove(best.Sheet);
            }

            foreach (var orphan in unclaimed)
                preview.Warnings.Add(
                    $"The sheet \"{orphan.Tab}\" does not match any customer on the index and will be skipped.");

            var noSheet = index.Where(e => e.Sheet == null).ToList();
            foreach (var e in noSheet.Take(10))
                preview.Warnings.Add(
                    $"\"{e.Name}\" is on the index but has no sheet — only its opening balance will be imported.");
            if (noSheet.Count > 10)
                preview.Warnings.Add($"...and {noSheet.Count - 10} more customers with no sheet.");
        }

        private static readonly Regex NonAlnum = new(@"[^a-z0-9]+", RegexOptions.Compiled);

        /// <summary>
        /// Case, punctuation, spacing and the corporate-form suffixes these
        /// workbooks use inconsistently ("(PVT) LTD", "& Co") all removed, so
        /// "Imperial Developers &amp; Builders" and
        /// "Imperial Developers And Builders (PVT) LTD" line up.
        /// </summary>
        private static string Normalise(string? name)
        {
            var value = (name ?? "").ToLowerInvariant()
                .Replace("&", " and ")
                .Replace(".", " ");
            value = NonAlnum.Replace(value, " ");

            var drop = new[] { "pvt", "private", "ltd", "limited", "co", "company", "the", "ledgers", "ledger" };
            var words = value.Split(' ', StringSplitOptions.RemoveEmptyEntries)
                .Where(w => !drop.Contains(w))
                .ToList();

            return string.Join("", words);
        }

        /// <summary>Dice coefficient over character bigrams — forgiving of the
        /// transpositions and dropped letters these hand-typed names carry.</summary>
        private static double Similar(string a, string b)
        {
            if (a.Length == 0 || b.Length == 0) return 0d;
            if (a == b) return 1d;
            if (a.Length < 2 || b.Length < 2) return a == b ? 1d : 0d;

            var pairs = new Dictionary<string, int>();
            for (int i = 0; i < a.Length - 1; i++)
            {
                var g = a.Substring(i, 2);
                pairs[g] = pairs.GetValueOrDefault(g) + 1;
            }

            var hits = 0;
            for (int i = 0; i < b.Length - 1; i++)
            {
                var g = b.Substring(i, 2);
                if (pairs.TryGetValue(g, out var n) && n > 0) { pairs[g] = n - 1; hits++; }
            }

            return 2d * hits / (a.Length - 1 + b.Length - 1);
        }

        private static void Total(CustomerLedgerPreviewDto preview)
        {
            preview.TotalOpening = preview.Clients.Sum(c => c.Opening);
            preview.TotalCredit = preview.Clients.Sum(c => c.TotalCredit);
            preview.TotalDebit = preview.Clients.Sum(c => c.TotalDebit);
            preview.TotalComputedClosing = preview.Clients.Sum(c => c.ComputedClosing);
            preview.TotalStatedClosing = preview.Clients.Sum(c => c.StatedClosing);
            preview.NewClientCount = preview.Clients.Count(c => c.ClientId == null);
            preview.ExistingClientCount = preview.Clients.Count(c => c.ClientId != null);
        }
    }
}

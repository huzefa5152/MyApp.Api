using System.Globalization;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>Bank statement import + categorization (Phase 2). See interface.</summary>
    public class BankStatementService : IBankStatementService
    {
        private readonly AppDbContext _context;
        private readonly IPaymentService _payments;

        public BankStatementService(AppDbContext context, IPaymentService payments)
        {
            _context = context;
            _payments = payments;
        }

        public async Task<ImportStatementResultDto> ImportCsvAsync(int companyId, int bankAccountId, string fileName, string csvText)
        {
            var parsed = ParseCsv(csvText);
            if (parsed.Count == 0)
                throw new InvalidOperationException("No data rows found. Expected a header row plus Date, Description and Amount (or Debit/Credit) columns.");

            var import = new BankStatementImport
            {
                CompanyId = companyId,
                BankAccountId = bankAccountId,
                FileName = string.IsNullOrWhiteSpace(fileName) ? "statement.csv" : fileName.Trim(),
                RowCount = parsed.Count,
            };
            _context.BankStatementImports.Add(import);
            await _context.SaveChangesAsync();

            var lines = parsed.Select(p => new BankStatementLine
            {
                ImportId = import.Id,
                CompanyId = companyId,
                BankAccountId = bankAccountId,
                Date = p.date,
                Description = p.description,
                Amount = p.amount,
                Status = BankStatementLineStatus.Uncategorized,
            }).ToList();
            _context.BankStatementLines.AddRange(lines);
            await _context.SaveChangesAsync();

            // Auto-match: link each line to a unique un-cleared payment on this
            // account (same direction, amount, date within a week) and clear it.
            var defaultBankId = await DefaultBankIdAsync(companyId);
            var candidates = await _context.Payments
                .Where(p => p.CompanyId == companyId && !p.IsCancelled && p.ReconciledDate == null)
                .ToListAsync();
            candidates = candidates
                .Where(p => (p.BankAccountId ?? defaultBankId) == bankAccountId)
                .ToList();

            var used = new HashSet<int>();
            int matched = 0;
            foreach (var line in lines.OrderBy(l => l.Date))
            {
                var isReceipt = line.Amount >= 0;
                var target = Math.Abs(line.Amount);
                var hits = candidates.Where(p =>
                    !used.Contains(p.Id)
                    && (p.Direction == PaymentDirection.Receipt) == isReceipt
                    && p.Amount == target
                    && Math.Abs((p.Date - line.Date).TotalDays) <= 7).ToList();
                if (hits.Count == 1)
                {
                    var p = hits[0];
                    used.Add(p.Id);
                    line.PaymentId = p.Id;
                    line.Status = BankStatementLineStatus.Categorized;
                    p.ReconciledDate = line.Date;   // matched to the statement ⇒ cleared
                    matched++;
                }
            }
            await _context.SaveChangesAsync();

            return new ImportStatementResultDto
            {
                ImportId = import.Id,
                Total = lines.Count,
                AutoMatched = matched,
                Uncategorized = lines.Count - matched,
            };
        }

        public async Task<List<BankStatementLineDto>> GetLinesAsync(int bankAccountId, string? status)
        {
            var q = _context.BankStatementLines.AsNoTracking().Where(l => l.BankAccountId == bankAccountId);
            if (!string.IsNullOrWhiteSpace(status) && Enum.TryParse<BankStatementLineStatus>(status, true, out var s))
                q = q.Where(l => l.Status == s);
            return await q.OrderByDescending(l => l.Date).ThenByDescending(l => l.Id)
                .Select(l => new BankStatementLineDto
                {
                    Id = l.Id, Date = l.Date, Description = l.Description, Amount = l.Amount,
                    Status = l.Status.ToString(), PaymentId = l.PaymentId,
                }).ToListAsync();
        }

        public async Task<bool> CategorizeLineAsync(int lineId, CategorizeLineDto dto)
        {
            var line = await _context.BankStatementLines.FirstOrDefaultAsync(l => l.Id == lineId);
            if (line == null) return false;
            if (line.Status == BankStatementLineStatus.Categorized)
                throw new InvalidOperationException("This line is already categorized.");
            if (dto.AccountId == null)
                throw new InvalidOperationException("Choose a category account to book this line against.");

            var isReceipt = line.Amount >= 0;
            var create = new CreatePaymentDto
            {
                Direction = isReceipt ? "Receipt" : "Payment",
                Date = line.Date,
                ContactType = string.IsNullOrWhiteSpace(dto.ContactType) ? "Other" : dto.ContactType,
                ContactId = dto.ContactId,
                BankAccountId = line.BankAccountId,
                Method = "Bank Transfer",
                Description = dto.Description ?? line.Description,
                Allocations = new List<CreatePaymentAllocationDto>
                {
                    new() { AccountId = dto.AccountId, Amount = Math.Abs(line.Amount) },
                },
            };
            var created = await _payments.CreateAsync(line.CompanyId, create);

            // Created from a bank statement ⇒ it has cleared.
            var payment = await _context.Payments.FirstOrDefaultAsync(p => p.Id == created.Id);
            if (payment != null) payment.ReconciledDate = line.Date;

            line.PaymentId = created.Id;
            line.Status = BankStatementLineStatus.Categorized;
            await _context.SaveChangesAsync();
            return true;
        }

        public async Task<bool> IgnoreLineAsync(int lineId)
        {
            var line = await _context.BankStatementLines.FirstOrDefaultAsync(l => l.Id == lineId);
            if (line == null) return false;
            line.Status = BankStatementLineStatus.Ignored;
            line.PaymentId = null;
            await _context.SaveChangesAsync();
            return true;
        }

        public async Task<int?> GetLineCompanyAsync(int lineId) =>
            await _context.BankStatementLines.AsNoTracking()
                .Where(l => l.Id == lineId).Select(l => (int?)l.CompanyId).FirstOrDefaultAsync();

        // ── CSV parsing ─────────────────────────────────────────────────────────

        private async Task<int> DefaultBankIdAsync(int companyId) =>
            await _context.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId && a.ControlType == ControlType.BankCash)
                .OrderBy(a => a.Id).Select(a => a.Id).FirstOrDefaultAsync();

        /// <summary>Parse a bank-statement CSV. Requires a header row; recognises a
        /// Date column, a Description/Narration/Details column, and either a signed
        /// Amount column or Debit + Credit columns (amount = credit − debit).</summary>
        private static List<(DateTime date, string? description, decimal amount)> ParseCsv(string csvText)
        {
            var rows = new List<(DateTime, string?, decimal)>();
            if (string.IsNullOrWhiteSpace(csvText)) return rows;
            var lines = csvText.Replace("\r\n", "\n").Replace("\r", "\n").Split('\n')
                .Where(l => l.Trim().Length > 0).ToList();
            if (lines.Count < 2) return rows;

            var header = SplitCsvLine(lines[0]).Select(h => h.Trim().ToLowerInvariant()).ToList();
            int Idx(params string[] names) => header.FindIndex(h => names.Any(n => h == n || h.Contains(n)));
            int dateIdx = Idx("date");
            int descIdx = Idx("description", "narration", "details", "particulars", "remark");
            int amtIdx = Idx("amount", "value");
            int debitIdx = Idx("debit", "withdrawal", "dr");
            int creditIdx = Idx("credit", "deposit", "cr");

            for (int i = 1; i < lines.Count; i++)
            {
                var cells = SplitCsvLine(lines[i]);
                if (dateIdx < 0 || dateIdx >= cells.Count) continue;
                if (!TryParseDate(cells[dateIdx], out var date)) continue;

                decimal amount;
                if (amtIdx >= 0 && amtIdx < cells.Count && TryParseDecimal(cells[amtIdx], out var a))
                    amount = a;
                else
                {
                    decimal dr = debitIdx >= 0 && debitIdx < cells.Count && TryParseDecimal(cells[debitIdx], out var d) ? d : 0m;
                    decimal cr = creditIdx >= 0 && creditIdx < cells.Count && TryParseDecimal(cells[creditIdx], out var c) ? c : 0m;
                    amount = cr - dr;   // deposit positive
                }
                if (amount == 0m) continue;
                var desc = descIdx >= 0 && descIdx < cells.Count ? cells[descIdx].Trim() : null;
                rows.Add((date, string.IsNullOrWhiteSpace(desc) ? null : desc, amount));
            }
            return rows;
        }

        private static List<string> SplitCsvLine(string line)
        {
            var result = new List<string>();
            var cur = new System.Text.StringBuilder();
            bool inQuotes = false;
            for (int i = 0; i < line.Length; i++)
            {
                char ch = line[i];
                if (ch == '"')
                {
                    if (inQuotes && i + 1 < line.Length && line[i + 1] == '"') { cur.Append('"'); i++; }
                    else inQuotes = !inQuotes;
                }
                else if (ch == ',' && !inQuotes) { result.Add(cur.ToString()); cur.Clear(); }
                else cur.Append(ch);
            }
            result.Add(cur.ToString());
            return result;
        }

        private static bool TryParseDate(string s, out DateTime date)
        {
            s = s.Trim();
            string[] fmts = { "yyyy-MM-dd", "dd/MM/yyyy", "MM/dd/yyyy", "d/M/yyyy", "dd-MM-yyyy", "dd-MMM-yyyy", "yyyy/MM/dd", "M/d/yyyy" };
            if (DateTime.TryParseExact(s, fmts, CultureInfo.InvariantCulture, DateTimeStyles.None, out date)) return true;
            return DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out date);
        }

        private static bool TryParseDecimal(string s, out decimal value)
        {
            s = s.Trim().Replace(",", "").Replace("(", "-").Replace(")", "");
            if (string.IsNullOrEmpty(s)) { value = 0m; return false; }
            return decimal.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out value);
        }
    }
}

using System.Globalization;
using System.Text;
using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Turns a customer list in a spreadsheet into Client rows.
    ///
    /// Design notes worth keeping:
    ///  • Parse and commit are separate calls. Onboarding sheets are messy —
    ///    duplicated rows, a blank name half way down, a province typed as
    ///    "Sindh" instead of its code — and an operator importing 200 customers
    ///    needs to see that BEFORE anything lands in the database.
    ///  • Creation delegates to <see cref="IClientService.CreateAsync"/> rather
    ///    than inserting rows here, so imported clients get the same Common
    ///    Client grouping and the same name-collision rule as hand-entered ones.
    ///  • Duplicates are skipped, never overwritten. Re-uploading last week's
    ///    sheet with 20 new customers appended must add 20 rows, not 220.
    /// </summary>
    public class ClientImportService : IClientImportService
    {
        private readonly AppDbContext _db;
        private readonly IClientService _clients;
        private readonly ILogger<ClientImportService> _logger;

        /// <summary>
        /// Hard cap on rows read from one file. Well above the 100–200 an
        /// onboarding sheet carries, low enough that a runaway file cannot pin
        /// the request thread. Extra rows are reported, not silently dropped.
        /// </summary>
        public const int MaxRows = 2000;

        private const int MaxReportedErrors = 50;

        // Header aliases: operators export from all sorts of systems, so accept
        // the obvious spellings rather than making them rename columns.
        private static readonly Dictionary<string, string[]> ColumnAliases = new(StringComparer.OrdinalIgnoreCase)
        {
            ["Name"] = new[] { "name", "client", "client name", "customer", "customer name", "party", "party name" },
            ["Address"] = new[] { "address", "billing address", "location" },
            ["Phone"] = new[] { "phone", "phone number", "contact", "contact number", "mobile", "tel", "telephone" },
            ["Email"] = new[] { "email", "e-mail", "email address" },
            ["NTN"] = new[] { "ntn", "ntn number", "national tax number" },
            ["STRN"] = new[] { "strn", "strn number", "sales tax registration number" },
            ["CNIC"] = new[] { "cnic", "cnic number", "id card" },
            ["RegistrationType"] = new[] { "registrationtype", "registration type", "reg type", "type" },
            ["Site"] = new[] { "site", "delivery site", "branch" },
            ["FbrProvinceCode"] = new[] { "fbrprovincecode", "province code", "province", "fbr province" },
        };

        public ClientImportService(
            AppDbContext db,
            IClientService clients,
            ILogger<ClientImportService> logger)
        {
            _db = db;
            _clients = clients;
            _logger = logger;
        }

        // ─────────────────────────────────────────────────────────────
        //  Template
        // ─────────────────────────────────────────────────────────────

        public byte[] BuildTemplateCsv()
        {
            var sb = new StringBuilder();
            sb.AppendLine("Name,Address,Phone,Email,NTN,STRN,CNIC,RegistrationType,Site,FbrProvinceCode");
            // Two filled examples beat a page of instructions: one registered
            // customer with an NTN, one unregistered with a CNIC.
            sb.AppendLine("Meko Fabrics,\"Plot 5, SITE Area, Karachi\",021-32001234,accounts@meko.example,1234567-8,3277876175852,,Registered,Main Store,8");
            sb.AppendLine("Rehman Traders,\"Shop 12, Bolton Market, Karachi\",0300-2001234,,,,42101-1234567-1,Unregistered,,8");
            return Encoding.UTF8.GetBytes(sb.ToString());
        }

        // ─────────────────────────────────────────────────────────────
        //  Parse + classify
        // ─────────────────────────────────────────────────────────────

        public async Task<ClientImportPreviewDto> ParseAsync(Stream file, string fileName, int companyId)
        {
            var preview = new ClientImportPreviewDto { FileName = fileName };

            List<string[]> table;
            try
            {
                table = fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)
                        || fileName.EndsWith(".xlsm", StringComparison.OrdinalIgnoreCase)
                    ? ReadWorkbook(file)
                    : ReadDelimited(file);
            }
            catch (Exception ex)
            {
                // Never surface ex.Message — it can carry file-system detail.
                _logger.LogWarning(ex, "Client import: unreadable file {FileName}", fileName);
                preview.FileMessages.Add(
                    "This file could not be read. Save it as CSV (or .xlsx) and try again.");
                return preview;
            }

            if (table.Count == 0)
            {
                preview.FileMessages.Add("The file is empty.");
                return preview;
            }

            var header = table[0];
            var map = MapColumns(header);
            if (!map.ContainsKey("Name"))
            {
                preview.FileMessages.Add(
                    "No \"Name\" column found. Download the sample file, keep its header row, and fill in your customers underneath.");
                return preview;
            }

            var body = table.Skip(1).ToList();
            if (body.Count > MaxRows)
            {
                preview.FileMessages.Add(
                    $"The file has {body.Count:N0} rows; only the first {MaxRows:N0} were read. Split it and import the rest afterwards.");
                body = body.Take(MaxRows).ToList();
            }

            // Everything this company already has, for the duplicate verdict.
            var existing = await _db.Clients.AsNoTracking()
                .Where(c => c.CompanyId == companyId)
                .Select(c => new { c.Name, c.NTN })
                .ToListAsync();
            var existingNames = new HashSet<string>(
                existing.Select(e => Normalise(e.Name)), StringComparer.OrdinalIgnoreCase);
            var existingNtns = new HashSet<string>(
                existing.Where(e => !string.IsNullOrWhiteSpace(e.NTN)).Select(e => Normalise(e.NTN!)),
                StringComparer.OrdinalIgnoreCase);

            // …and what earlier rows of THIS file already claimed, so a sheet
            // that repeats a customer doesn't create it twice.
            var seenNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var seenNtns = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            var rowNumber = 0;
            foreach (var cells in body)
            {
                rowNumber++;
                if (cells.All(string.IsNullOrWhiteSpace)) continue;   // blank filler row

                var row = new ClientImportRowDto
                {
                    RowNumber = rowNumber,
                    Name = Get(cells, map, "Name"),
                    Address = Get(cells, map, "Address"),
                    Phone = Get(cells, map, "Phone"),
                    Email = Get(cells, map, "Email"),
                    NTN = Get(cells, map, "NTN"),
                    STRN = Get(cells, map, "STRN"),
                    CNIC = Get(cells, map, "CNIC"),
                    RegistrationType = Get(cells, map, "RegistrationType"),
                    Site = Get(cells, map, "Site"),
                };

                var province = Get(cells, map, "FbrProvinceCode");
                if (!string.IsNullOrWhiteSpace(province))
                {
                    if (int.TryParse(province, NumberStyles.Integer, CultureInfo.InvariantCulture, out var code))
                        row.FbrProvinceCode = code;
                    else
                        row.Messages.Add($"Province \"{province}\" is not a number — leave it blank or use FBR's province code.");
                }

                if (string.IsNullOrWhiteSpace(row.Name))
                {
                    row.Status = ClientImportStatus.Error;
                    row.Messages.Add("Name is required.");
                }
                else if (row.Name!.Trim().Length > 200)
                {
                    row.Status = ClientImportStatus.Error;
                    row.Messages.Add("Name is too long (200 characters max).");
                }
                else
                {
                    var name = Normalise(row.Name);
                    var ntn = string.IsNullOrWhiteSpace(row.NTN) ? null : Normalise(row.NTN!);

                    if (existingNames.Contains(name))
                    {
                        row.Status = ClientImportStatus.Duplicate;
                        row.Messages.Add("This company already has a client with this name.");
                    }
                    else if (ntn != null && existingNtns.Contains(ntn))
                    {
                        row.Status = ClientImportStatus.Duplicate;
                        row.Messages.Add($"NTN {row.NTN} already belongs to a client of this company.");
                    }
                    else if (!seenNames.Add(name))
                    {
                        row.Status = ClientImportStatus.Duplicate;
                        row.Messages.Add("This name appears earlier in the file.");
                    }
                    else if (ntn != null && !seenNtns.Add(ntn))
                    {
                        row.Status = ClientImportStatus.Duplicate;
                        row.Messages.Add("This NTN appears earlier in the file.");
                    }
                }

                // A malformed province is a warning, not a rejection — the
                // client is still perfectly usable without one.
                if (row.Status == ClientImportStatus.New && row.Messages.Count > 0 && row.FbrProvinceCode == null)
                    row.FbrProvinceCode = null;

                preview.Rows.Add(row);
            }

            preview.TotalRows = preview.Rows.Count;
            preview.NewCount = preview.Rows.Count(r => r.Status == ClientImportStatus.New);
            preview.DuplicateCount = preview.Rows.Count(r => r.Status == ClientImportStatus.Duplicate);
            preview.ErrorCount = preview.Rows.Count(r => r.Status == ClientImportStatus.Error);
            return preview;
        }

        // ─────────────────────────────────────────────────────────────
        //  Commit
        // ─────────────────────────────────────────────────────────────

        public async Task<ClientImportResultDto> CommitAsync(ClientImportCommitDto dto)
        {
            var result = new ClientImportResultDto();
            if (dto.Rows.Count == 0) return result;

            foreach (var row in dto.Rows)
            {
                if (row.Status == ClientImportStatus.Error)
                {
                    result.Failed++;
                    AddError(result, $"Row {row.RowNumber}: skipped — {string.Join(" ", row.Messages)}");
                    continue;
                }
                if (row.Status == ClientImportStatus.Duplicate && !dto.IncludeDuplicates)
                {
                    result.SkippedDuplicates++;
                    continue;
                }
                if (string.IsNullOrWhiteSpace(row.Name))
                {
                    result.Failed++;
                    AddError(result, $"Row {row.RowNumber}: skipped — name is required.");
                    continue;
                }

                try
                {
                    // CompanyId comes from the guarded request, never from the
                    // uploaded sheet — a file must not be able to plant rows in
                    // another tenant.
                    await _clients.CreateAsync(new ClientDto
                    {
                        Name = row.Name!.Trim(),
                        Address = Trim(row.Address),
                        Phone = Trim(row.Phone),
                        Email = Trim(row.Email),
                        NTN = Trim(row.NTN),
                        STRN = Trim(row.STRN),
                        CNIC = Trim(row.CNIC),
                        RegistrationType = Trim(row.RegistrationType),
                        Site = Trim(row.Site),
                        FbrProvinceCode = row.FbrProvinceCode,
                        CompanyId = dto.CompanyId,
                    });
                    result.Created++;
                }
                catch (InvalidOperationException ex)
                {
                    // Business-rule rejection (name already taken). Safe to
                    // echo: the service writes these messages for operators.
                    result.Failed++;
                    AddError(result, $"Row {row.RowNumber} ({row.Name}): {ex.Message}");
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Client import: row {Row} failed for company {CompanyId}",
                        row.RowNumber, dto.CompanyId);
                    result.Failed++;
                    AddError(result, $"Row {row.RowNumber} ({row.Name}): could not be saved.");
                }
            }

            _logger.LogInformation(
                "Client import into company {CompanyId}: {Created} created, {Skipped} duplicates skipped, {Failed} failed",
                dto.CompanyId, result.Created, result.SkippedDuplicates, result.Failed);
            return result;
        }

        // ─────────────────────────────────────────────────────────────
        //  Readers
        // ─────────────────────────────────────────────────────────────

        /// <summary>
        /// CSV / TSV reader. Handles quoted fields with embedded commas,
        /// doubled quotes and newlines — Excel's "Save as CSV" output.
        /// </summary>
        private static List<string[]> ReadDelimited(Stream file)
        {
            using var reader = new StreamReader(file, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
            var text = reader.ReadToEnd();

            // Sniff the separator on the header line: Excel in a Urdu/German
            // locale writes semicolons, and a TSV export writes tabs.
            var firstLine = text.Split('\n').FirstOrDefault() ?? "";
            var separator = firstLine.Count(c => c == ';') > firstLine.Count(c => c == ',') ? ';'
                          : firstLine.Contains('\t') && !firstLine.Contains(',') ? '\t'
                          : ',';

            var rows = new List<string[]>();
            var cells = new List<string>();
            var cell = new StringBuilder();
            var inQuotes = false;

            for (var i = 0; i < text.Length; i++)
            {
                var ch = text[i];
                if (inQuotes)
                {
                    if (ch == '"')
                    {
                        if (i + 1 < text.Length && text[i + 1] == '"') { cell.Append('"'); i++; }
                        else inQuotes = false;
                    }
                    else cell.Append(ch);
                    continue;
                }

                if (ch == '"') { inQuotes = true; }
                else if (ch == separator) { cells.Add(cell.ToString()); cell.Clear(); }
                else if (ch == '\n')
                {
                    cells.Add(cell.ToString().TrimEnd('\r'));
                    cell.Clear();
                    rows.Add(cells.ToArray());
                    cells = new List<string>();
                }
                else cell.Append(ch);
            }
            if (cell.Length > 0 || cells.Count > 0)
            {
                cells.Add(cell.ToString().TrimEnd('\r'));
                rows.Add(cells.ToArray());
            }

            return rows.Where(r => r.Length > 0).ToList();
        }

        /// <summary>First worksheet of an .xlsx, read as text.</summary>
        private static List<string[]> ReadWorkbook(Stream file)
        {
            using var wb = new XLWorkbook(file);
            var ws = wb.Worksheets.First();
            var range = ws.RangeUsed();
            if (range == null) return new List<string[]>();

            var rows = new List<string[]>();
            foreach (var r in range.RowsUsed())
            {
                rows.Add(r.Cells(1, range.ColumnCount())
                          .Select(c => c.GetFormattedString() ?? "")
                          .ToArray());
            }
            return rows;
        }

        // ─────────────────────────────────────────────────────────────
        //  Helpers
        // ─────────────────────────────────────────────────────────────

        /// <summary>Header text → column index, using the alias table.</summary>
        private static Dictionary<string, int> MapColumns(string[] header)
        {
            var map = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            for (var i = 0; i < header.Length; i++)
            {
                var raw = (header[i] ?? "").Trim().Trim('"');
                if (raw.Length == 0) continue;
                foreach (var (field, aliases) in ColumnAliases)
                {
                    if (map.ContainsKey(field)) continue;
                    if (aliases.Any(a => string.Equals(a, raw, StringComparison.OrdinalIgnoreCase)))
                    {
                        map[field] = i;
                        break;
                    }
                }
            }
            return map;
        }

        private static string? Get(string[] cells, Dictionary<string, int> map, string field)
        {
            if (!map.TryGetValue(field, out var idx) || idx >= cells.Length) return null;
            var v = (cells[idx] ?? "").Trim();
            return v.Length == 0 ? null : v;
        }

        private static string? Trim(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

        /// <summary>Collapse case and inner whitespace so "MEKO  FABRICS" matches "Meko Fabrics".</summary>
        private static string Normalise(string s)
            => string.Join(' ', (s ?? "").Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries));

        private static void AddError(ClientImportResultDto result, string message)
        {
            if (result.Errors.Count < MaxReportedErrors) result.Errors.Add(message);
        }
    }
}

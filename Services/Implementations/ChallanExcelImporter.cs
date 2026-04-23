using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers.ExcelImport;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class ChallanExcelImporter : IChallanExcelImporter
    {
        private readonly AppDbContext _context;
        // Filename fallback for challan number: "DC # 1073 MEKO DENIM.xls"
        private static readonly Regex FilenameNumberRegex = new(@"(?:DC|CHALLAN)\s*#?\s*(\d+)",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        public ChallanExcelImporter(AppDbContext context)
        {
            _context = context;
        }

        public async Task<ChallanImportPreviewDto> ExtractPreviewAsync(
            IFormFile file,
            TemplateCellMap cellMap,
            int companyId)
        {
            var preview = new ChallanImportPreviewDto { FileName = file.FileName };

            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (!WorkbookReaderFactory.IsSupported(ext))
            {
                preview.Warnings.Add($"Unsupported file type: {ext}");
                return preview;
            }

            using var ms = new MemoryStream();
            await file.CopyToAsync(ms);
            ms.Position = 0;

            using var wb = WorkbookReaderFactory.Open(ms, ext);
            int sheet = cellMap.SheetIndex;
            if (sheet >= wb.WorksheetCount) sheet = 0;

            // ── Header fields ──────────────────────────────────────────────
            preview.ChallanNumber = ReadChallanNumber(wb, sheet, cellMap, file.FileName, preview);
            preview.ClientNameRaw = ReadHeader(wb, sheet, cellMap, "clientName");
            preview.PoNumber = ReadHeader(wb, sheet, cellMap, "poNumber");
            preview.PoDate = ReadHeaderDate(wb, sheet, cellMap, "poDate");
            preview.DeliveryDate = ReadHeaderDate(wb, sheet, cellMap, "deliveryDate");
            preview.Site = ReadHeader(wb, sheet, cellMap, "clientSite");
            if (string.IsNullOrWhiteSpace(preview.Site))
                preview.Site = ReadHeader(wb, sheet, cellMap, "site");

            // ── Brand sanity check ────────────────────────────────────────
            // Every template pins {{companyBrandName}} (or {{companyName}}) at
            // a known cell. If the file's value for that cell doesn't match
            // the target company's brand/name — OR if the target brand can't
            // be found anywhere in the file's header region — the user has
            // picked the wrong company. Flag it hard so the UI blocks commit.
            preview.CompanyBrandRaw = ReadHeader(wb, sheet, cellMap, "companyBrandName")
                                   ?? ReadHeader(wb, sheet, cellMap, "companyName");
            await CheckCompanyBrandAsync(companyId, preview, wb, sheet);

            // ── Client match ───────────────────────────────────────────────
            if (!string.IsNullOrWhiteSpace(preview.ClientNameRaw))
            {
                var (matchedId, matchedName) = await MatchClientAsync(companyId, preview.ClientNameRaw);
                preview.ClientId = matchedId;
                preview.ClientNameMatched = matchedName;
                if (matchedId == null)
                    preview.Warnings.Add($"Client '{preview.ClientNameRaw}' not found in company — please pick one.");
            }
            else
            {
                preview.Warnings.Add("Client name cell was empty — please pick a client.");
            }

            // ── Items ──────────────────────────────────────────────────────
            if (!cellMap.HasItemsBlock)
            {
                preview.Warnings.Add("Template has no items loop — items could not be extracted.");
            }
            else
            {
                ReadItems(wb, sheet, cellMap, preview);
                if (preview.Items.Count == 0)
                    preview.Warnings.Add("No item rows detected.");
            }

            return preview;
        }

        private static int ReadChallanNumber(IImportedWorkbook wb, int sheet, TemplateCellMap map,
            string fileName, ChallanImportPreviewDto preview)
        {
            if (map.HeaderFields.TryGetValue("challanNumber", out var pos))
            {
                var n = wb.GetInt(sheet, pos.Row, pos.Col);
                if (n.HasValue && n.Value > 0) return n.Value;

                // Try treating it as string with prefix — operator may have stored "DC-1073"
                var s = wb.GetString(sheet, pos.Row, pos.Col);
                var m = FilenameNumberRegex.Match(s ?? "");
                if (!m.Success)
                {
                    var digits = Regex.Match(s ?? "", @"\d+");
                    if (digits.Success && int.TryParse(digits.Value, out var parsed)) return parsed;
                }
                else if (int.TryParse(m.Groups[1].Value, out var parsed2))
                {
                    return parsed2;
                }
            }
            // Fallback: parse from filename ("DC # 1073 MEKO DENIM.xls")
            var fnMatch = FilenameNumberRegex.Match(fileName);
            if (fnMatch.Success && int.TryParse(fnMatch.Groups[1].Value, out var fnNum)) return fnNum;

            preview.Warnings.Add("Challan number could not be read from the template cell or filename — please edit.");
            return 0;
        }

        private static string? ReadHeader(IImportedWorkbook wb, int sheet, TemplateCellMap map, string key)
        {
            if (!map.HeaderFields.TryGetValue(key, out var pos)) return null;
            var s = wb.GetString(sheet, pos.Row, pos.Col);
            return string.IsNullOrWhiteSpace(s) ? null : s;
        }

        private static DateTime? ReadHeaderDate(IImportedWorkbook wb, int sheet, TemplateCellMap map, string key)
        {
            if (!map.HeaderFields.TryGetValue(key, out var pos)) return null;
            return wb.GetDate(sheet, pos.Row, pos.Col);
        }

        private static void ReadItems(IImportedWorkbook wb, int sheet, TemplateCellMap map, ChallanImportPreviewDto preview)
        {
            map.ItemColumns.TryGetValue("description", out var descCol);
            map.ItemColumns.TryGetValue("quantity", out var qtyCol);
            map.ItemColumns.TryGetValue("unit", out var unitCol);
            map.ItemColumns.TryGetValue("uom", out var uomCol);
            map.ItemColumns.TryGetValue("itemTypeName", out var itemTypeCol);

            // Prefer "unit" but fall back to "uom" if the template uses UOM.
            if (unitCol == 0) unitCol = uomCol;

            if (descCol == 0)
            {
                preview.Warnings.Add("Items description column not found in template.");
                return;
            }

            // Upper safety bound: go at most a few hundred rows past the end
            // marker to catch long historical files with many items.
            int bound = Math.Max(map.ItemsEndMarkerRow, map.ItemsStartRow) + 500;
            int maxRow = Math.Min(bound, wb.GetLastRow(sheet));

            int blankStreak = 0;
            for (int r = map.ItemsStartRow; r <= maxRow; r++)
            {
                var desc = wb.GetString(sheet, r, descCol);
                if (string.IsNullOrWhiteSpace(desc))
                {
                    // Allow one blank row inside the block (some templates have
                    // a spacer between header and data), then stop.
                    blankStreak++;
                    if (blankStreak >= 2) break;
                    continue;
                }
                blankStreak = 0;

                // Skip rows that are clearly totals/footer text stamped into
                // the description column (common in hand-maintained files).
                if (IsLikelyFooterRow(desc)) break;

                var qty = qtyCol > 0 ? (wb.GetInt(sheet, r, qtyCol) ?? 0) : 0;
                var unit = unitCol > 0 ? (wb.GetString(sheet, r, unitCol) ?? "") : "";
                var itemTypeName = itemTypeCol > 0 ? wb.GetString(sheet, r, itemTypeCol) : null;

                preview.Items.Add(new ChallanImportItemDto
                {
                    Description = desc,
                    Quantity = qty,
                    Unit = unit,
                    ItemTypeName = itemTypeName,
                });
            }
        }

        private static bool IsLikelyFooterRow(string description)
        {
            var d = description.Trim().ToLowerInvariant();
            return d.StartsWith("total") || d.StartsWith("grand total") ||
                   d.StartsWith("subtotal") || d.StartsWith("amount in words");
        }

        /// <summary>
        /// Decide whether the uploaded file actually belongs to the target
        /// company. Two paths:
        ///
        ///   1. If the template-mapped {{companyBrandName}} cell had a value,
        ///      compare it (loosely) to the target company's brand/name.
        ///      Mismatch → CompanyBrandMismatch + warning.
        ///
        ///   2. If that cell was empty (likely because the file was produced
        ///      from a DIFFERENT template where brand sits at a different
        ///      cell), sweep the file's top-left region and see whether the
        ///      target brand/name appears anywhere. If not → WrongCompany.
        ///
        /// WrongCompany is a hard block on commit — the UI treats it the
        /// same as a duplicate-number row.
        /// </summary>
        private async Task CheckCompanyBrandAsync(int companyId, ChallanImportPreviewDto preview,
            IImportedWorkbook wb, int sheet)
        {
            var company = await _context.Companies
                .Where(c => c.Id == companyId)
                .Select(c => new { c.BrandName, c.Name })
                .FirstOrDefaultAsync();
            if (company == null) return;

            var brand = NormalizeName(company.BrandName);
            var name = NormalizeName(company.Name);
            var displayName = company.BrandName ?? company.Name ?? "";

            var fromFile = NormalizeName(preview.CompanyBrandRaw);

            if (!string.IsNullOrEmpty(fromFile))
            {
                // Path 1: template-mapped cell had a value — direct compare.
                bool matches =
                    (!string.IsNullOrEmpty(brand) && (brand.Contains(fromFile) || fromFile.Contains(brand))) ||
                    (!string.IsNullOrEmpty(name) && (name.Contains(fromFile) || fromFile.Contains(name)));

                if (!matches)
                {
                    preview.CompanyBrandMismatch = true;
                    preview.WrongCompany = true;
                    preview.Warnings.Add(
                        $"This file is for '{preview.CompanyBrandRaw}', not '{displayName}'. " +
                        $"Upload files produced for the selected company only.");
                }
                return;
            }

            // Path 2: brand cell came back empty. The uploaded file likely
            // came from a different template layout. Sweep the top-left
            // region for any text matching the target brand/name.
            var topLeft = NormalizeName(ScanHeaderRegion(wb, sheet));
            bool foundInScan =
                (!string.IsNullOrEmpty(brand) && topLeft.Contains(brand)) ||
                (!string.IsNullOrEmpty(name) && topLeft.Contains(name));

            if (!foundInScan)
            {
                preview.WrongCompany = true;
                preview.Warnings.Add(
                    $"This file doesn't appear to belong to '{displayName}'. " +
                    $"The selected company's name wasn't found in the file's header.");
            }
        }

        /// <summary>
        /// Concatenate the text of the top-left region of a sheet (roughly the
        /// header area of a typical challan template). Used for a fuzzy brand
        /// check when the template-mapped cell is empty.
        /// </summary>
        private static string ScanHeaderRegion(IImportedWorkbook wb, int sheet, int maxRows = 25, int maxCols = 15)
        {
            int lastRow = Math.Min(maxRows, wb.GetLastRow(sheet));
            var parts = new List<string>(lastRow * maxCols);
            for (int r = 1; r <= lastRow; r++)
                for (int c = 1; c <= maxCols; c++)
                {
                    var s = wb.GetString(sheet, r, c);
                    if (!string.IsNullOrEmpty(s)) parts.Add(s);
                }
            return string.Join(" ", parts);
        }

        /// <summary>
        /// Exact (case-insensitive) client-name match against the company's
        /// client list. Returns (null, null) on no match or ambiguous matches —
        /// intentionally conservative so the user explicitly picks one instead
        /// of us picking silently wrong.
        /// </summary>
        private async Task<(int? id, string? name)> MatchClientAsync(int companyId, string rawName)
        {
            var norm = NormalizeName(rawName);
            if (string.IsNullOrWhiteSpace(norm)) return (null, null);

            var candidates = await _context.Clients
                .Where(c => c.CompanyId == companyId)
                .Select(c => new { c.Id, c.Name })
                .ToListAsync();

            var exact = candidates.Where(c => NormalizeName(c.Name) == norm).ToList();
            if (exact.Count == 1) return (exact[0].Id, exact[0].Name);

            // Substring/loose match as a last resort — still only accept when
            // exactly one candidate matches.
            var loose = candidates
                .Where(c => NormalizeName(c.Name).Contains(norm) || norm.Contains(NormalizeName(c.Name)))
                .ToList();
            if (loose.Count == 1) return (loose[0].Id, loose[0].Name);

            return (null, null);
        }

        private static string NormalizeName(string? input)
        {
            if (string.IsNullOrWhiteSpace(input)) return "";
            return Regex.Replace(input.Trim().ToLowerInvariant(), @"\s+", " ");
        }
    }
}

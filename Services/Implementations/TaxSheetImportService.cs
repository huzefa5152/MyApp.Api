using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;
using MyApp.Api.Services.Tax;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Applies a filled-in Tax Sheet workbook to many invoices at once. The
    /// consultant types the real HS code (and optionally a real description and
    /// a filing quantity) against each original bill line; this turns every
    /// invoice's lines into tax-filing rows and saves them through
    /// <see cref="IInvoiceService.SaveTaxFilingAsync"/> — the SAME path the
    /// Adjust screen uses — so every rule (coverage, amounts, permissions,
    /// duplicates, FBR checks, locks) is applied exactly once, in one place.
    ///
    /// Scope: invoices are loaded by id AND the route's company, so an id from
    /// another company simply isn't found. One bad invoice never stops the
    /// others; each is saved in its own transaction. Commit re-reads the file.
    /// </summary>
    public class TaxSheetImportService
    {
        public const int MaxRows = 20000;

        private readonly AppDbContext _db;
        private readonly IInvoiceService _invoices;
        private readonly ITaxMappingEngine _taxEngine;
        private readonly ILogger<TaxSheetImportService> _logger;

        public TaxSheetImportService(AppDbContext db, IInvoiceService invoices,
            ITaxMappingEngine taxEngine, ILogger<TaxSheetImportService> logger)
        {
            _db = db; _invoices = invoices; _taxEngine = taxEngine; _logger = logger;
        }

        private sealed record SheetLine(int InvoiceId, int LineId, string Hs, string Description, decimal? Qty, string Unit, int Row);

        public Task<TaxSheetImportResultDto> PreviewAsync(int companyId, Stream file, bool allowNumericalChanges)
            => RunAsync(companyId, file, false, 0, "", allowNumericalChanges);

        public Task<TaxSheetImportResultDto> CommitAsync(int companyId, Stream file, int actorId, string actorName, bool allowNumericalChanges)
            => RunAsync(companyId, file, true, actorId, actorName, allowNumericalChanges);

        private async Task<TaxSheetImportResultDto> RunAsync(int companyId, Stream file, bool commit,
            int actorId, string actorName, bool allowNumbers)
        {
            var result = new TaxSheetImportResultDto { Committed = commit };
            var sheet = Read(file, result);
            if (sheet == null) return result;

            var byInvoice = sheet.GroupBy(l => l.InvoiceId).ToList();
            result.InvoicesInFile = byInvoice.Count;
            var ids = byInvoice.Select(g => g.Key).ToList();
            var bills = await _db.Invoices.AsNoTracking()
                .Include(i => i.Items).Include(i => i.Company)
                .Where(i => ids.Contains(i.Id) && i.CompanyId == companyId)
                .ToDictionaryAsync(i => i.Id);

            foreach (var group in byInvoice)
            {
                if (!bills.TryGetValue(group.Key, out var bill))
                {
                    result.Issues.Add(new() { InvoiceNumber = "#" + group.Key, Message = "This invoice was not found in the selected company." });
                    continue;
                }
                var number = bill.InvoiceNumber.ToString();
                try
                {
                    var rows = await PlanAsync(companyId, bill, group.ToList(), allowNumbers);
                    if (rows == null) continue; // nothing filled for this invoice
                    result.FilingRows += rows.Count;
                    if (commit)
                    {
                        var editor = await _invoices.GetTaxFilingAsync(bill.Id);
                        if (editor == null) throw new InvalidOperationException("The invoice could not be loaded.");
                        await _invoices.SaveTaxFilingAsync(bill.Id,
                            new SaveTaxFilingDto { Version = editor.Version, Rows = rows }, actorId, actorName, allowNumbers);
                    }
                    result.InvoicesReady++;
                }
                catch (InvalidOperationException ex)
                {
                    result.Issues.Add(new() { InvoiceNumber = number, Message = ex.Message });
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Tax sheet import failed for invoice {InvoiceId}", bill.Id);
                    result.Issues.Add(new() { InvoiceNumber = number, Message = "Could not be saved. Adjust this invoice on its own screen." });
                }
            }
            return result;
        }

        /// <summary>Reads the sheet; null (with an issue) when it is not a tax sheet.</summary>
        private static List<SheetLine>? Read(Stream file, TaxSheetImportResultDto result)
        {
            XLWorkbook wb;
            try { wb = new XLWorkbook(file); }
            catch
            {
                result.Issues.Add(new() { Message = "The file could not be read as an Excel workbook." });
                return null;
            }
            using (wb)
            {
                var ws = wb.Worksheets.FirstOrDefault();
                if (ws == null) { result.Issues.Add(new() { Message = "The workbook is empty." }); return null; }

                int header = 0;
                for (int r = 1; r <= 30 && header == 0; r++)
                    for (int c = 1; c <= 20; c++)
                        if (string.Equals(ws.Cell(r, c).GetString().Trim(), "Inv Number", StringComparison.OrdinalIgnoreCase)) { header = r; break; }
                if (header == 0)
                {
                    result.Issues.Add(new() { Message = "This is not a Tax Sheet export. Download the sheet from the Tax Sheet screen and fill it in." });
                    return null;
                }
                int Col(string startsWith)
                {
                    for (int c = 1; c <= 30; c++)
                        if (ws.Cell(header, c).GetString().Trim().StartsWith(startsWith, StringComparison.OrdinalIgnoreCase)) return c;
                    return 0;
                }
                int inv = Col("Invoice Id"), line = Col("Line Id"), hs = Col("Real Hscode"),
                    desc = Col("Real Item Description"), qty = Col("Filing Qty"), num = Col("Inv Number"),
                    unitCol = Col("FBR Unit");
                if (inv == 0 || line == 0 || hs == 0)
                {
                    result.Issues.Add(new() { Message = "The sheet is missing the Real Hscode, Invoice Id or Line Id column. Download a fresh sheet and fill that." });
                    return null;
                }

                var list = new List<SheetLine>();
                int last = ws.LastRowUsed()?.RowNumber() ?? header;
                if (last - header > MaxRows)
                {
                    result.Issues.Add(new() { Message = $"The sheet has more than {MaxRows} rows. Upload one period or client at a time." });
                    return null;
                }
                for (int r = header + 1; r <= last; r++)
                {
                    if (!int.TryParse(ws.Cell(r, inv).GetString().Trim(), out var invoiceId)
                        || !int.TryParse(ws.Cell(r, line).GetString().Trim(), out var lineId)) continue; // TOTAL / blank row
                    result.LinesRead++;
                    var code = (ws.Cell(r, hs).GetString() ?? "").Replace(" ", "").Trim();
                    var text = desc == 0 ? "" : (ws.Cell(r, desc).GetString() ?? "").Trim();
                    var unit = unitCol == 0 ? "" : (ws.Cell(r, unitCol).GetString() ?? "").Trim();
                    decimal? q = null;
                    var qText = qty == 0 ? "" : ws.Cell(r, qty).GetString().Trim();
                    var invNo = num == 0 ? "#" + invoiceId : ws.Cell(r, num).GetString().Trim();
                    if (qText.Length > 0)
                    {
                        if (!decimal.TryParse(qText, System.Globalization.NumberStyles.Number,
                                System.Globalization.CultureInfo.InvariantCulture, out var parsed) || parsed <= 0)
                        {
                            result.Issues.Add(new() { InvoiceNumber = invNo, Message = $"Row {r}: filing quantity \"{qText}\" is not a positive number." });
                            continue;
                        }
                        q = parsed;
                    }
                    if (code.Length == 0)
                    {
                        if (q != null || text.Length > 0 || unit.Length > 0)
                            result.Issues.Add(new() { InvoiceNumber = invNo, Message = $"Row {r}: a quantity, description or unit was entered without an HS code, so it was ignored." });
                        continue;
                    }
                    if (code.Length > 20 || !code.All(ch => char.IsDigit(ch) || ch == '.'))
                    {
                        result.Issues.Add(new() { InvoiceNumber = invNo, Message = $"Row {r}: \"{code}\" is not a valid HS code (digits and dots only)." });
                        continue;
                    }
                    if (text.Length > 500)
                    {
                        result.Issues.Add(new() { InvoiceNumber = invNo, Message = $"Row {r}: the real item description is longer than 500 characters." });
                        continue;
                    }
                    list.Add(new SheetLine(invoiceId, lineId, code, text, q, unit, r));
                }
                return list;
            }
        }

        /// <summary>
        /// Filing rows for one invoice, or null when the sheet gave it no HS code.
        /// Lines with the same HS code and description become one filing row.
        /// </summary>
        private async Task<List<TaxFilingRowDto>?> PlanAsync(int companyId, Invoice bill, List<SheetLine> sheet, bool allowNumbers)
        {
            if (sheet.Count == 0) return null;
            var lines = bill.Items.OrderBy(i => i.Id).ToList();
            var lineIds = lines.Select(i => i.Id).ToHashSet();
            if (sheet.Any(s => !lineIds.Contains(s.LineId)))
                throw new InvalidOperationException("The sheet names a line that is not on this invoice. Download a fresh sheet.");
            if (sheet.GroupBy(s => s.LineId).Any(g => g.Count() > 1))
                throw new InvalidOperationException("The same bill line appears twice in the sheet.");

            var filed = bill.Company?.TaxInvoiceUseOriginalBillLines == true || bill.TaxFilingRowsJson != null
                ? TaxFilingProjection.HsCodeByLine(bill) : new Dictionary<int, string?>();
            var chosen = new List<(InvoiceItem Line, string Hs, string Desc, decimal Qty, string Unit)>();
            foreach (var line in lines)
            {
                var s = sheet.FirstOrDefault(x => x.LineId == line.Id);
                var hs = s?.Hs;
                if (string.IsNullOrEmpty(hs) && filed.TryGetValue(line.Id, out var existing) && !string.IsNullOrWhiteSpace(existing))
                    hs = existing!.Trim();
                if (string.IsNullOrEmpty(hs))
                    throw new InvalidOperationException($"Line \"{Short(line.Description)}\" has no HS code. Every line of an invoice needs one.");
                var qty = s?.Qty ?? line.Quantity;
                if (qty != line.Quantity && !allowNumbers)
                    throw new InvalidOperationException("Your permission allows HS classification only. A changed filing quantity needs consultant quantity permission.");
                chosen.Add((line, hs, s?.Description ?? "", qty, s?.Unit ?? ""));
            }

            var rows = new List<TaxFilingRowDto>();
            foreach (var g in chosen.GroupBy(c => (c.Hs, Desc: c.Desc.ToUpperInvariant())))
            {
                var members = g.ToList();
                var row = new TaxFilingRowDto
                {
                    SourceLineIds = members.Select(m => m.Line.Id).ToList(),
                    HSCode = g.Key.Hs,
                    Description = members[0].Desc,
                    Quantity = decimal.Round(members.Sum(m => m.Qty), 4),
                    ValueExclTax = members.Sum(m => m.Line.LineTotal),
                };
                var units = members.Select(m => m.Unit).Where(u => u.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                if (units.Count > 1)
                    throw new InvalidOperationException($"HS code {g.Key.Hs} has different FBR units on this invoice ({string.Join(", ", units)}). Use one.");
                await ResolveClassificationAsync(companyId, row, members[0].Line, units.FirstOrDefault() ?? "");
                rows.Add(row);
            }
            return rows;
        }

        // An HS code the company already uses maps to its catalog item; a new one is
        // created by the save, which verifies it with FBR. The FBR unit is a property
        // of the HS code, never of the bill line (the printed documents keep the bill's
        // own unit): the sheet's FBR Unit wins, then FBR's single unit, then the
        // system's default suggestion; otherwise the operator is asked to name one.
        private async Task ResolveClassificationAsync(int companyId, TaxFilingRowDto row, InvoiceItem firstLine, string sheetUnit)
        {
            var code = row.HSCode!;
            var type = await _db.ItemTypes.AsNoTracking()
                .Where(t => t.CompanyId == companyId && !t.IsDeleted && !t.IsHsCodePartial && t.HSCode == code)
                .OrderBy(t => t.Id).FirstOrDefaultAsync();

            FbrUOMDto? chosen = null;
            if (sheetUnit.Length > 0 || type == null)
            {
                var hints = await _taxEngine.GetHsCodeHintsAsync(companyId, code);
                var uoms = hints?.Uoms ?? new();
                if (sheetUnit.Length > 0)
                {
                    chosen = uoms.FirstOrDefault(u => string.Equals(u.Description?.Trim(), sheetUnit, StringComparison.OrdinalIgnoreCase)
                                                   || u.UOM_ID.ToString() == sheetUnit);
                    if (chosen == null)
                        throw new InvalidOperationException(uoms.Count == 0
                            ? $"HS code {code} was not recognised by FBR."
                            : $"\"{sheetUnit}\" is not an FBR unit for HS code {code}. Choose one of: {string.Join(", ", uoms.Select(u => u.Description))}.");
                }
                else if (uoms.Count == 0)
                    throw new InvalidOperationException($"HS code {code} was not recognised by FBR.");
                else if (uoms.Count == 1) chosen = uoms[0];
                else
                {
                    FbrUOMDto? suggested = null;
                    try { suggested = await _taxEngine.SuggestDefaultUomAsync(companyId, code); } catch { /* no default available */ }
                    chosen = suggested == null ? null : uoms.FirstOrDefault(u => u.UOM_ID == suggested.UOM_ID);
                    if (chosen == null)
                        throw new InvalidOperationException($"HS code {code} has several FBR units ({string.Join(", ", uoms.Select(u => u.Description))}). Enter one in the FBR Unit column.");
                }
            }

            if (type != null)
            {
                row.ItemTypeId = type.Id;
                if (chosen != null && chosen.UOM_ID != type.FbrUOMId) row.SelectedFbrUOMId = chosen.UOM_ID;
                return;
            }

            if (string.IsNullOrWhiteSpace(row.Description)) row.Description = (firstLine.Description ?? "").Trim();
            if (row.Description.Length == 0 || row.Description.Length > 500)
                throw new InvalidOperationException($"HS code {code} is new to this company: enter a Real Item Description (up to 500 characters).");
            row.UOM = chosen!.Description;
            row.FbrUOMId = chosen.UOM_ID;
        }

        private static string Short(string? s)
        {
            s = (s ?? "").Trim();
            return s.Length <= 40 ? s : s[..40] + "…";
        }
    }
}

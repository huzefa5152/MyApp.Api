using System.Globalization;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// The importer's tax desk (2026-10-05): the GD register and the monthly
    /// sales-tax worksheet. Both are READ-ONLY and company-wide, so a user
    /// restricted to some divisions is refused rather than shown a partial
    /// return that would read as the whole one.
    ///
    /// Figures come from the documents, by CLAIM month -- see
    /// <see cref="InputTaxWorksheet"/> for why that is not the ledger.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/import-tax")]
    public class ImportTaxController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly IDivisionAccessGuard _divisionAccess;
        private readonly IConfiguration _config;

        public ImportTaxController(AppDbContext db, IDivisionAccessGuard divisionAccess, IConfiguration config)
        {
            _db = db;
            _divisionAccess = divisionAccess;
            _config = config;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        private decimal CapPercent => _config.GetValue<int?>("TaxCompliance:Section8BCapPercent") ?? 90;
        private int ClaimPeriods => _config.GetValue<int?>("TaxCompliance:AgingMonths") ?? 6;

        // ── GD register ─────────────────────────────────────────────────────

        [HttpGet("company/{companyId}/gd-register")]
        [HasPermission("importcosting.taxdesk.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<GdRegisterDto>> GetGdRegister(int companyId,
            [FromQuery] string? from = null, [FromQuery] string? to = null, [FromQuery] bool unclaimedOnly = false)
        {
            var refused = await RefuseDivisionRestrictedAsync(companyId);
            if (refused != null) return refused;
            if (!TryMonth(from, out var f, allowEmpty: true) || !TryMonth(to, out var t, allowEmpty: true))
                return BadRequest(new { message = "Months are written yyyy-MM." });
            return Ok(await BuildRegisterAsync(companyId, f, t, unclaimedOnly));
        }

        [HttpGet("company/{companyId}/gd-register/excel")]
        [HasPermission("importcosting.taxdesk.view")]
        [AuthorizeCompany]
        public async Task<IActionResult> GetGdRegisterExcel(int companyId,
            [FromQuery] string? from = null, [FromQuery] string? to = null, [FromQuery] bool unclaimedOnly = false)
        {
            var refused = await RefuseDivisionRestrictedAsync(companyId);
            if (refused != null) return refused;
            if (!TryMonth(from, out var f, allowEmpty: true) || !TryMonth(to, out var t, allowEmpty: true))
                return BadRequest(new { message = "Months are written yyyy-MM." });
            var reg = await BuildRegisterAsync(companyId, f, t, unclaimedOnly);
            var bytes = ImportTaxExcel.Register(reg);
            return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                $"gd-register-{PakistanClock.Today:yyyy-MM-dd}.xlsx");
        }

        // ── Input tax worksheet ─────────────────────────────────────────────

        [HttpGet("company/{companyId}/input-tax")]
        [HasPermission("importcosting.taxdesk.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<InputTaxWorksheetDto>> GetInputTax(int companyId,
            [FromQuery] string? from = null, [FromQuery] string? to = null)
        {
            var refused = await RefuseDivisionRestrictedAsync(companyId);
            if (refused != null) return refused;
            var (error, dto) = await BuildWorksheetAsync(companyId, from, to);
            return error ?? Ok(dto);
        }

        [HttpGet("company/{companyId}/input-tax/excel")]
        [HasPermission("importcosting.taxdesk.view")]
        [AuthorizeCompany]
        public async Task<IActionResult> GetInputTaxExcel(int companyId,
            [FromQuery] string? from = null, [FromQuery] string? to = null)
        {
            var refused = await RefuseDivisionRestrictedAsync(companyId);
            if (refused != null) return refused;
            var (error, dto) = await BuildWorksheetAsync(companyId, from, to);
            if (error != null) return error;
            return File(ImportTaxExcel.Worksheet(dto!), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                $"input-tax-{dto!.From:yyyy-MM}-to-{dto.To:yyyy-MM}.xlsx");
        }

        // ── Builders ────────────────────────────────────────────────────────

        private async Task<ActionResult?> RefuseDivisionRestrictedAsync(int companyId) =>
            await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId) != null
                ? StatusCode(403, new { message = "The tax desk covers the whole company, so it needs access to every division." })
                : null;

        private static bool TryMonth(string? s, out DateTime? month, bool allowEmpty)
        {
            month = null;
            if (string.IsNullOrWhiteSpace(s)) return allowEmpty;
            if (!DateTime.TryParseExact(s.Trim(), "yyyy-MM", CultureInfo.InvariantCulture, DateTimeStyles.None, out var m))
                return false;
            month = m;
            return true;
        }

        /// <summary>Every GD costing line with its import taxes, claim month
        /// (the line's own, else the GD's claim period) and claim deadline.</summary>
        private async Task<List<GdRegisterLineDto>> CostingLinesAsync(int companyId)
        {
            var periods = await ClaimPeriodsAsync(companyId);
            var raw = await _db.ImportConsignmentLines.AsNoTracking()
                .Where(l => l.ImportConsignment.CompanyId == companyId)
                .Select(l => new
                {
                    l.ImportConsignmentId, l.ImportConsignment.GdNumber, l.ImportConsignment.GdDate, l.ImportConsignment.Mode,
                    l.ClaimMonth, l.DescriptionOnSheet, l.HsCode, l.Quantity, l.Unit, l.AssessedValue, l.CustomsDuty,
                    l.Acd, l.RegulatoryDuty, l.Others, l.SalesTaxRate, l.AstRate, l.IncomeTaxRate, l.AddOnProfit,
                    l.CostExcludingTax, l.ChargesAllocated, l.SellingValueExcludingTax, l.SourceRow, l.Id,
                    ItemName = l.ItemTypeId != null ? _db.ItemTypes.Where(i => i.Id == l.ItemTypeId).Select(i => i.Name).FirstOrDefault() : null,
                })
                .ToListAsync();
            return raw.OrderBy(l => l.GdDate).ThenBy(l => l.GdNumber).ThenBy(l => l.SourceRow).ThenBy(l => l.Id).Select(l =>
            {
                var c = ImportCostingCalculator.Compute(new ImportCostingCalculator.ImportCostingInput(
                    l.AssessedValue, l.CustomsDuty, l.Acd, l.RegulatoryDuty, l.Others,
                    l.SalesTaxRate, l.AstRate, l.IncomeTaxRate, l.AddOnProfit));
                var parts = GdNumberParts.Parse(l.GdNumber);
                var claim = l.ClaimMonth ?? periods.GetValueOrDefault(l.GdNumber.Trim());
                var by = InputTaxWorksheet.ClaimBy(l.GdDate, ClaimPeriods);
                var input = c.SalesTax + c.Ast + l.Others;
                return new GdRegisterLineDto
                {
                    Source = "gd-costing", ConsignmentId = l.ImportConsignmentId, GdNumber = l.GdNumber,
                    Collectorate = parts.Collectorate, CollectorateName = parts.CollectorateName,
                    GdType = parts.Type, GdTypeName = parts.TypeName,
                    GdDate = l.GdDate, ClaimMonth = claim, ClaimBy = by,
                    ClaimStatus = ClaimStatusOf(claim, by, input),
                    Description = l.DescriptionOnSheet, ItemName = l.ItemName, HsCode = l.HsCode,
                    Quantity = l.Quantity, Unit = l.Unit, AssessedValue = l.AssessedValue, CustomsDuty = l.CustomsDuty,
                    Acd = l.Acd, RegulatoryDuty = l.RegulatoryDuty, SalesTaxRate = l.SalesTaxRate, SalesTax = c.SalesTax,
                    AstRate = l.AstRate, ValueAddedTax = c.Ast, OtherTax = l.Others, IncomeTaxRate = l.IncomeTaxRate,
                    IncomeTax = c.IncomeTax, Charges = l.ChargesAllocated, LandedCost = l.CostExcludingTax + l.ChargesAllocated, InputTax = Math.Round(input, 2),
                    SellingValue = l.SellingValueExcludingTax, Mode = l.Mode,
                };
            }).ToList();
        }

        private string ClaimStatusOf(DateTime? claim, DateTime by, decimal input)
        {
            if (input <= 0m) return "n/a";
            if (claim is DateTime cm)
                return InputTaxWorksheet.MonthOf(cm) > by ? "claimed-late" : "claimed";
            return InputTaxWorksheet.MonthOf(PakistanClock.Today) > by ? "lapsed" : "open";
        }

        private async Task<Dictionary<string, DateTime?>> ClaimPeriodsAsync(int companyId) =>
            (await _db.GdClaimPeriods.AsNoTracking().Where(x => x.CompanyId == companyId)
                .Select(x => new { x.GdNumber, x.ClaimMonth }).ToListAsync())
            .GroupBy(x => x.GdNumber.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => (DateTime?)g.Min(x => x.ClaimMonth), StringComparer.OrdinalIgnoreCase);

        private async Task<GdRegisterDto> BuildRegisterAsync(int companyId, DateTime? from, DateTime? to, bool unclaimedOnly)
        {
            var lines = await CostingLinesAsync(companyId);
            var costedGds = lines.Select(l => l.GdNumber.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);

            // A GD that only exists on the stock sheet the company was loaded
            // from: its number, date, claim month and goods are known, its
            // duties and taxes are not, so those columns stay empty rather than
            // being estimated.
            var periods = await ClaimPeriodsAsync(companyId);
            var lots = await _db.OpeningStockLots.AsNoTracking()
                .Where(l => l.OpeningStockBalance.CompanyId == companyId && l.LotRef != null && l.LotRef != "")
                .Select(l => new
                {
                    l.LotRef, l.LotDate, l.ClaimMonth, l.ItemNameOnSheet, l.HsCode, l.Unit,
                    Qty = l.OpeningQuantity ?? l.BalanceQuantity,
                    Value = l.OpeningValueExcludingTax ?? l.BalanceValueExcludingTax,
                    Rate = l.OpeningSalesTaxRate ?? l.BalanceSalesTaxRate,
                    ItemName = l.OpeningStockBalance.ItemType.Name, l.SourceRow,
                })
                .ToListAsync();
            foreach (var l in lots.Where(l => !costedGds.Contains(l.LotRef!.Trim()))
                         .OrderBy(l => l.LotDate).ThenBy(l => l.LotRef).ThenBy(l => l.SourceRow))
            {
                var parts = GdNumberParts.Parse(l.LotRef);
                lines.Add(new GdRegisterLineDto
                {
                    Source = "stock-sheet", GdNumber = l.LotRef!.Trim(),
                    Collectorate = parts.Collectorate, CollectorateName = parts.CollectorateName,
                    GdType = parts.Type, GdTypeName = parts.TypeName,
                    GdDate = l.LotDate, ClaimMonth = l.ClaimMonth ?? periods.GetValueOrDefault(l.LotRef!.Trim()),
                    ClaimBy = l.LotDate is DateTime d ? InputTaxWorksheet.ClaimBy(d, ClaimPeriods) : null,
                    ClaimStatus = "n/a", Description = l.ItemNameOnSheet, ItemName = l.ItemName, HsCode = l.HsCode,
                    Quantity = l.Qty, Unit = l.Unit, SalesTaxRate = l.Rate, SellingValue = l.Value,
                });
            }

            IEnumerable<GdRegisterLineDto> q = lines;
            if (from is DateTime f) q = q.Where(l => l.GdDate >= f);
            if (to is DateTime t) q = q.Where(l => l.GdDate < t.AddMonths(1));
            if (unclaimedOnly) q = q.Where(l => l.ClaimMonth == null);
            var shown = q.OrderBy(l => l.GdDate ?? DateTime.MaxValue).ThenBy(l => l.GdNumber, StringComparer.OrdinalIgnoreCase).ToList();

            var company = await _db.Companies.AsNoTracking().Where(c => c.Id == companyId).Select(c => c.Name).FirstOrDefaultAsync();
            return new GdRegisterDto
            {
                CompanyName = company ?? "", From = from, To = to, UnclaimedOnly = unclaimedOnly, ClaimPeriods = ClaimPeriods,
                Lines = shown,
                GdCount = shown.Select(l => l.GdNumber).Distinct(StringComparer.OrdinalIgnoreCase).Count(),
                TotalAssessedValue = Sum(shown, l => l.AssessedValue),
                TotalDuties = Sum(shown, l => l.CustomsDuty + l.Acd + l.RegulatoryDuty),
                TotalSalesTax = Sum(shown, l => l.SalesTax),
                TotalValueAddedTax = Sum(shown, l => l.ValueAddedTax),
                TotalIncomeTax = Sum(shown, l => l.IncomeTax),
                TotalLandedCost = Sum(shown, l => l.LandedCost),
                TotalInputTax = Sum(shown, l => l.InputTax),
                UnclaimedInputTax = Sum(shown.Where(l => l.ClaimMonth == null), l => l.InputTax),
            };
        }

        private async Task<(ActionResult? Error, InputTaxWorksheetDto? Dto)> BuildWorksheetAsync(
            int companyId, string? from, string? to)
        {
            var today = InputTaxWorksheet.MonthOf(PakistanClock.Today);
            if (!TryMonth(to, out var toM, allowEmpty: true) || !TryMonth(from, out var fromM, allowEmpty: true))
                return (BadRequest(new { message = "Months are written yyyy-MM." }), null);
            var last = toM ?? today;
            var first = fromM ?? last.AddMonths(-5);
            if (first > last) return (BadRequest(new { message = "The first month is after the last." }), null);
            if (last > today) return (BadRequest(new { message = "That month has not started yet." }), null);
            if ((last.Year - first.Year) * 12 + last.Month - first.Month >= 36)
                return (BadRequest(new { message = "Show at most 36 months at a time." }), null);
            var end = last.AddMonths(1);

            // Output tax, month by month: a credit note takes tax back, a debit
            // note adds it; void, demo and FBR-cancelled bills are not supplies.
            var sales = await _db.Invoices.AsNoTracking()
                .Where(i => i.CompanyId == companyId && !i.IsCancelled && !i.IsDemo && i.FbrCancelledAt == null && i.Date < end)
                .GroupBy(i => new { i.Date.Year, i.Date.Month })
                .Select(g => new
                {
                    g.Key.Year, g.Key.Month,
                    Tax = g.Sum(i => (i.NoteKind == 2 ? -1m : 1m) * (i.GSTAmount + i.FurtherTaxAmount)),
                })
                .ToListAsync();
            var bills = await _db.PurchaseBills.AsNoTracking()
                .Where(b => b.CompanyId == companyId && b.Date < end)
                .GroupBy(b => new { b.Date.Year, b.Date.Month })
                .Select(g => new { g.Key.Year, g.Key.Month, Tax = g.Sum(b => b.GSTAmount) })
                .ToListAsync();
            var debitNotes = await _db.PurchaseDebitNotes.AsNoTracking()
                .Where(n => n.CompanyId == companyId && n.Date < end)
                .GroupBy(n => new { n.Date.Year, n.Date.Month })
                .Select(g => new { g.Key.Year, g.Key.Month, Tax = g.Sum(n => n.GSTAmount) })
                .ToListAsync();
            var gdLines = (await CostingLinesAsync(companyId)).Where(l => l.InputTax > 0m).ToList();

            // The carry-forward is walked from the company's first month of any
            // tax activity, so the first month shown opens with the true balance.
            var starts = sales.Select(s => new DateTime(s.Year, s.Month, 1))
                .Concat(bills.Select(b => new DateTime(b.Year, b.Month, 1)))
                .Concat(gdLines.Where(l => l.ClaimMonth != null).Select(l => InputTaxWorksheet.MonthOf(l.ClaimMonth!.Value)))
                .Where(d => d < end).ToList();
            var walkFrom = starts.Count > 0 ? new[] { starts.Min(), first }.Min() : first;

            decimal Of<T>(IEnumerable<T> src, Func<T, int> y, Func<T, int> m, Func<T, decimal> v, DateTime month) =>
                src.Where(s => y(s) == month.Year && m(s) == month.Month).Sum(v);

            var months = new List<InputTaxWorksheet.MonthFigures>();
            for (var m = walkFrom; m <= last; m = m.AddMonths(1))
            {
                var claimed = gdLines.Where(l => l.ClaimMonth is DateTime c && c.Year == m.Year && c.Month == m.Month).ToList();
                months.Add(new InputTaxWorksheet.MonthFigures(m,
                    Of(sales, s => s.Year, s => s.Month, s => s.Tax, m),
                    claimed.Sum(l => l.SalesTax), claimed.Sum(l => l.ValueAddedTax), claimed.Sum(l => l.OtherTax),
                    Of(bills, s => s.Year, s => s.Month, s => s.Tax, m) - Of(debitNotes, s => s.Year, s => s.Month, s => s.Tax, m)));
            }

            var result = InputTaxWorksheet.Build(months,
                gdLines.Select(l => new InputTaxWorksheet.GdTax(l.GdNumber, l.GdDate!.Value, l.ClaimMonth, l.Description,
                    l.HsCode, l.SalesTax, l.ValueAddedTax, l.OtherTax)),
                CapPercent, ClaimPeriods, last);

            var company = await _db.Companies.AsNoTracking().Where(c => c.Id == companyId).Select(c => c.Name).FirstOrDefaultAsync();
            var dto = new InputTaxWorksheetDto
            {
                CompanyName = company ?? "", From = first, To = last, CapPercent = CapPercent, ClaimPeriods = ClaimPeriods,
                Months = result.Months.Where(r => r.Month >= first).Select(r => new InputTaxMonthDto
                {
                    Month = r.Month, OutputTax = r.OutputTax, ImportSalesTax = r.ImportSalesTax,
                    ImportValueAddedTax = r.ImportValueAddedTax, ImportOtherTax = r.ImportOtherTax,
                    PurchaseInputTax = r.PurchaseInputTax, InputThisMonth = r.InputThisMonth,
                    BroughtForward = r.BroughtForward, Available = r.Available, CapLimit = r.CapLimit,
                    Admissible = r.Admissible, CarriedForward = r.CarriedForward, Payable = r.Payable,
                    CapApplied = r.CapApplied,
                }).ToList(),
                TimeLimit = result.TimeLimit.Select(r => new InputTaxTimeLimitDto
                {
                    GdNumber = r.GdNumber, GdDate = r.GdDate, ClaimMonth = r.ClaimMonth, Description = r.Description,
                    HsCode = r.HsCode, InputTax = r.InputTax, ClaimBy = r.ClaimBy,
                    Status = r.Status switch
                    {
                        InputTaxWorksheet.TimeLimitStatus.Lapsed => "lapsed",
                        InputTaxWorksheet.TimeLimitStatus.Open => "open",
                        _ => "claimed-late",
                    },
                }).ToList(),
            };
            dto.LapsedInputTax = Sum(dto.TimeLimit.Where(r => r.Status == "lapsed"), r => r.InputTax);
            dto.OpenInputTax = Sum(dto.TimeLimit.Where(r => r.Status == "open"), r => r.InputTax);
            dto.UnclaimedLineCount = gdLines.Count(l => l.ClaimMonth == null);
            return (null, dto);
        }

        private static decimal Sum<T>(IEnumerable<T> src, Func<T, decimal> f) =>
            Math.Round(src.Sum(f), 2, MidpointRounding.AwayFromZero);
    }
}

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
        private readonly IImportTaxWorksheetService _worksheet;

        public ImportTaxController(AppDbContext db, IDivisionAccessGuard divisionAccess, IConfiguration config,
            IImportTaxWorksheetService worksheet)
        {
            _db = db;
            _divisionAccess = divisionAccess;
            _config = config;
            _worksheet = worksheet;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

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

        private async Task<GdRegisterDto> BuildRegisterAsync(int companyId, DateTime? from, DateTime? to, bool unclaimedOnly)
        {
            var lines = await _worksheet.CostingLinesAsync(companyId);
            var costedGds = lines.Select(l => l.GdNumber.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);

            // A GD that only exists on the stock sheet the company was loaded
            // from: its number, date, claim month and goods are known, its
            // duties and taxes are not, so those columns stay empty rather than
            // being estimated.
            var periods = await _worksheet.ClaimPeriodsAsync(companyId);
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
            var (error, dto) = await _worksheet.BuildAsync(companyId, from, to);
            return error != null ? (BadRequest(new { message = error }), null) : (null, dto);
        }

        private static decimal Sum<T>(IEnumerable<T> src, Func<T, decimal> f) =>
            Math.Round(src.Sum(f), 2, MidpointRounding.AwayFromZero);
    }
}

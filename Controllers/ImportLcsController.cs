using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Middleware;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Letters of credit (2026-10-05): the bank instrument an importer pays a
    /// foreign supplier with, and the GDs that cleared goods shipped against it.
    /// Record-keeping only -- nothing here posts to the ledger. Every by-id route
    /// resolves the company from the STORED row, never the request.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/import-lcs")]
    public class ImportLcsController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly ICompanyAccessGuard _access;

        public ImportLcsController(AppDbContext db, ICompanyAccessGuard access)
        {
            _db = db;
            _access = access;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        public class LcDto
        {
            public int Id { get; set; }
            public string LcNumber { get; set; } = "";
            public string? BankName { get; set; }
            public string? SupplierName { get; set; }
            public string Currency { get; set; } = "USD";
            public decimal ForeignAmount { get; set; }
            public decimal? ExchangeRate { get; set; }
            public DateTime OpenedOn { get; set; }
            public DateTime? ExpiresOn { get; set; }
            public string Status { get; set; } = "open";
            public string? Notes { get; set; }
            // Derived from the GDs linked to it.
            public int GdCount { get; set; }
            public decimal AssessedValue { get; set; }
            public decimal LandedCost { get; set; }
            public decimal Owed { get; set; }
            public decimal Settled { get; set; }
            public decimal Outstanding { get; set; }
            public List<LcGdDto> Gds { get; set; } = new();
        }

        public class LcGdDto
        {
            public int Id { get; set; }
            public string GdNumber { get; set; } = "";
            public DateTime GdDate { get; set; }
            public string? BlNumber { get; set; }
            public decimal AssessedValue { get; set; }
            public decimal LandedCost { get; set; }
            public decimal Owed { get; set; }
            public decimal Settled { get; set; }
        }

        [HttpGet("company/{companyId}")]
        [HasPermission("importcosting.lc.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<LcDto>>> List(int companyId)
        {
            var lcs = await _db.ImportLetterOfCredits.AsNoTracking().Where(l => l.CompanyId == companyId)
                .OrderByDescending(l => l.OpenedOn).ThenByDescending(l => l.Id).ToListAsync();
            var gds = await GdsAsync(companyId, null);
            return Ok(lcs.Select(l => ToDto(l, gds.Where(g => g.LcId == l.Id).Select(g => g.Dto).ToList())).ToList());
        }

        [HttpPost("company/{companyId}")]
        [HasPermission("importcosting.lc.manage")]
        [AuthorizeCompany]
        public async Task<IActionResult> Create(int companyId, [FromBody] LcDto dto)
        {
            var error = Validate(dto);
            if (error != null) return BadRequest(new { message = error });
            var number = dto.LcNumber.Trim();
            if (await _db.ImportLetterOfCredits.AnyAsync(l => l.CompanyId == companyId && l.LcNumber == number))
                return BadRequest(new { message = $"LC {number} is already recorded for this company." });
            var lc = new ImportLetterOfCredit { CompanyId = companyId };
            Apply(lc, dto);
            _db.ImportLetterOfCredits.Add(lc);
            await _db.SaveChangesAsync();
            return Ok(ToDto(lc, new()));
        }

        [HttpPut("{id:int}")]
        [HasPermission("importcosting.lc.manage")]
        public async Task<IActionResult> Update(int id, [FromBody] LcDto dto)
        {
            var lc = await _db.ImportLetterOfCredits.FirstOrDefaultAsync(l => l.Id == id);
            if (lc == null) return NotFound(new { message = "That LC no longer exists." });
            await _access.AssertAccessAsync(CurrentUserId, lc.CompanyId);
            var error = Validate(dto);
            if (error != null) return BadRequest(new { message = error });
            var number = dto.LcNumber.Trim();
            if (await _db.ImportLetterOfCredits.AnyAsync(l => l.CompanyId == lc.CompanyId && l.LcNumber == number && l.Id != id))
                return BadRequest(new { message = $"LC {number} is already recorded for this company." });
            Apply(lc, dto);
            await _db.SaveChangesAsync();
            var gds = await GdsAsync(lc.CompanyId, lc.Id);
            return Ok(ToDto(lc, gds.Select(g => g.Dto).ToList()));
        }

        /// <summary>Deletes the LC record; GDs linked to it keep their goods and
        /// figures and simply lose the link.</summary>
        [HttpDelete("{id:int}")]
        [HasPermission("importcosting.lc.manage")]
        public async Task<IActionResult> Delete(int id)
        {
            var lc = await _db.ImportLetterOfCredits.FirstOrDefaultAsync(l => l.Id == id);
            if (lc == null) return NotFound(new { message = "That LC no longer exists." });
            await _access.AssertAccessAsync(CurrentUserId, lc.CompanyId);
            await using var tx = await _db.Database.BeginTransactionAsync();
            await _db.ImportConsignments.Where(c => c.CompanyId == lc.CompanyId && c.ImportLcId == id)
                .ExecuteUpdateAsync(u => u.SetProperty(c => c.ImportLcId, (int?)null));
            _db.ImportLetterOfCredits.Remove(lc);
            await _db.SaveChangesAsync();
            await tx.CommitAsync();
            return NoContent();
        }

        public class LinkDto
        {
            public int? LcId { get; set; }
            public string? BlNumber { get; set; }
        }

        /// <summary>Links a GD to an LC (or none) and records its bill of lading.
        /// The LC must belong to the GD's own company.</summary>
        [HttpPut("consignment/{consignmentId:int}")]
        [HasPermission("importcosting.lc.manage")]
        public async Task<IActionResult> Link(int consignmentId, [FromBody] LinkDto dto)
        {
            var c = await _db.ImportConsignments.FirstOrDefaultAsync(x => x.Id == consignmentId);
            if (c == null) return NotFound(new { message = "That consignment no longer exists." });
            await _access.AssertAccessAsync(CurrentUserId, c.CompanyId);
            if (dto?.LcId is int lcId
                && !await _db.ImportLetterOfCredits.AnyAsync(l => l.Id == lcId && l.CompanyId == c.CompanyId))
                return BadRequest(new { message = "That LC is not one of this company's." });
            c.ImportLcId = dto?.LcId;
            var bl = (dto?.BlNumber ?? "").Trim();
            c.BlNumber = bl.Length == 0 ? null : bl.Length <= 60 ? bl : bl[..60];
            await _db.SaveChangesAsync();
            return Ok(new { consignmentId, lcId = c.ImportLcId, blNumber = c.BlNumber });
        }

        private static string? Validate(LcDto? dto)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.LcNumber)) return "Enter the LC number.";
            if (dto.LcNumber.Trim().Length > 60) return "The LC number is too long.";
            if (dto.ForeignAmount < 0m) return "The LC amount cannot be negative.";
            if (dto.ExchangeRate is < 0m) return "The exchange rate cannot be negative.";
            if (dto.OpenedOn == default) return "Enter the date the LC was opened.";
            if (dto.ExpiresOn is DateTime e && e.Date < dto.OpenedOn.Date) return "The LC cannot expire before it opens.";
            var s = (dto.Status ?? "open").Trim().ToLowerInvariant();
            if (s != "open" && s != "closed") return "Status is open or closed.";
            return null;
        }

        private static void Apply(ImportLetterOfCredit lc, LcDto dto)
        {
            static string? T(string? v, int max) { var t = (v ?? "").Trim(); return t.Length == 0 ? null : t.Length <= max ? t : t[..max]; }
            lc.LcNumber = dto.LcNumber.Trim();
            lc.BankName = T(dto.BankName, 120);
            lc.SupplierName = T(dto.SupplierName, 200);
            lc.Currency = (T(dto.Currency, 10) ?? "USD").ToUpperInvariant();
            lc.ForeignAmount = Math.Round(dto.ForeignAmount, 2);
            lc.ExchangeRate = dto.ExchangeRate;
            lc.OpenedOn = dto.OpenedOn.Date;
            lc.ExpiresOn = dto.ExpiresOn?.Date;
            lc.Status = (dto.Status ?? "open").Trim().ToLowerInvariant();
            lc.Notes = T(dto.Notes, 500);
        }

        private async Task<List<(int? LcId, LcGdDto Dto)>> GdsAsync(int companyId, int? lcId)
        {
            var q = _db.ImportConsignments.AsNoTracking().Where(c => c.CompanyId == companyId && c.ImportLcId != null);
            if (lcId is int id) q = q.Where(c => c.ImportLcId == id);
            var rows = await q.Select(c => new
            {
                c.Id, c.ImportLcId, c.GdNumber, c.GdDate, c.BlNumber, c.ImportClearingCredited, c.AmountSettled,
                Assessed = c.Lines.Sum(l => (decimal?)l.AssessedValue) ?? 0m,
                Landed = c.Lines.Sum(l => (decimal?)(l.CostExcludingTax + l.ChargesAllocated)) ?? 0m,
            }).OrderBy(c => c.GdDate).ToListAsync();
            return rows.Select(r => (r.ImportLcId, new LcGdDto
            {
                Id = r.Id, GdNumber = r.GdNumber, GdDate = r.GdDate, BlNumber = r.BlNumber,
                AssessedValue = r.Assessed, LandedCost = r.Landed, Owed = r.ImportClearingCredited, Settled = r.AmountSettled,
            })).ToList();
        }

        private static LcDto ToDto(ImportLetterOfCredit l, List<LcGdDto> gds) => new()
        {
            Id = l.Id, LcNumber = l.LcNumber, BankName = l.BankName, SupplierName = l.SupplierName, Currency = l.Currency,
            ForeignAmount = l.ForeignAmount, ExchangeRate = l.ExchangeRate, OpenedOn = l.OpenedOn, ExpiresOn = l.ExpiresOn,
            Status = l.Status, Notes = l.Notes, Gds = gds, GdCount = gds.Count,
            AssessedValue = gds.Sum(g => g.AssessedValue), LandedCost = gds.Sum(g => g.LandedCost),
            Owed = gds.Sum(g => g.Owed), Settled = gds.Sum(g => g.Settled),
            Outstanding = gds.Sum(g => g.Owed - g.Settled),
        };
    }
}

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Models;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Admin-tier endpoints for the Units configuration page. Drives the
    /// per-unit AllowsDecimalQuantity toggle that controls whether bill /
    /// challan quantity inputs accept decimals (12.5 KG) or only whole
    /// numbers (3 Pcs).
    ///
    /// The lookup-style search endpoint (GET /api/lookup/units?query=...)
    /// stays on LookupController — that's what the autocomplete dropdowns
    /// use. This controller is for the explicit admin grid.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class UnitsController : ControllerBase
    {
        private readonly AppDbContext _context;

        public UnitsController(AppDbContext context)
        {
            _context = context;
        }

        /// <summary>
        /// Full units list with the AllowsDecimalQuantity flag. Used by
        /// the admin grid and by every form that needs to know which UOMs
        /// permit fractional quantities. Read-only — no permission gate
        /// because the flag drives basic input behaviour everywhere.
        /// </summary>
        [HttpGet]
        public async Task<ActionResult<List<UnitDto>>> GetAll()
        {
            var units = await _context.Units
                .OrderBy(u => u.Name)
                .Select(u => new UnitDto
                {
                    Id = u.Id,
                    Name = u.Name,
                    AllowsDecimalQuantity = u.AllowsDecimalQuantity
                })
                .ToListAsync();

            return Ok(units);
        }

        /// <summary>
        /// Toggle the AllowsDecimalQuantity flag for one unit. Gated by the
        /// existing config.units.manage permission so the same role that
        /// owns the units lookup list owns this configuration.
        /// </summary>
        [HttpPut("{id}")]
        [HasPermission("config.units.manage")]
        public async Task<ActionResult<UnitDto>> Update(int id, [FromBody] UpdateUnitRequest body)
        {
            var unit = await _context.Units.FindAsync(id);
            if (unit == null) return NotFound(new { error = "Unit not found." });

            unit.AllowsDecimalQuantity = body.AllowsDecimalQuantity;
            await _context.SaveChangesAsync();

            return Ok(new UnitDto
            {
                Id = unit.Id,
                Name = unit.Name,
                AllowsDecimalQuantity = unit.AllowsDecimalQuantity
            });
        }

        public class UpdateUnitRequest
        {
            public bool AllowsDecimalQuantity { get; set; }
        }
    }
}

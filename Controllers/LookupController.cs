using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Models;

namespace MyApp.Api.Controllers
{
    [Authorize]
    [Route("api/[controller]")]
    [ApiController]
    public class LookupController : ControllerBase
    {
        private readonly AppDbContext _context;

        public LookupController(AppDbContext context)
        {
            _context = context;
        }

        // Search item descriptions (now returns FBR defaults so the caller can auto-fill
        // HS Code / Sale Type / UOM when a known item is picked).
        // Results are ordered: favorites first, then by usage count, then alphabetically.
        [HttpGet("items")]
        public async Task<IActionResult> GetItems([FromQuery] string query)
        {
            var items = await _context.ItemDescriptions
                .Where(i => i.Name.Contains(query))
                .OrderByDescending(i => i.IsFavorite)
                .ThenByDescending(i => i.UsageCount)
                .ThenBy(i => i.Name)
                .Take(10)
                .ToListAsync();
            return Ok(items);
        }

        // Top items — favorites + most-used — returned without needing a search term.
        // The SmartItemAutocomplete uses this to pre-populate its dropdown on focus,
        // giving users a short curated list instead of an empty starting state.
        [HttpGet("items/top")]
        public async Task<IActionResult> GetTopItems([FromQuery] int take = 15)
        {
            if (take <= 0) take = 15;
            if (take > 100) take = 100;
            var items = await _context.ItemDescriptions
                // Only surface items that have FBR data configured — a plain-text
                // description without HS code isn't useful as a "favorite".
                .Where(i => i.IsFavorite || i.UsageCount > 0)
                .OrderByDescending(i => i.IsFavorite)
                .ThenByDescending(i => i.UsageCount)
                .ThenByDescending(i => i.LastUsedAt)
                .Take(take)
                .ToListAsync();
            return Ok(items);
        }

        // Toggle favorite flag on an item description (by id).
        // Audit H-5 (2026-05-13): mutates global lookup state — gate
        // behind the dedicated lookup-management permission so
        // read-only roles can't reshuffle every tenant's favorites.
        [HttpPut("items/{id}/favorite")]
        [HasPermission("config.itemdescriptions.manage")]
        public async Task<IActionResult> ToggleFavorite(int id, [FromBody] ToggleFavoriteDto dto)
        {
            var item = await _context.ItemDescriptions.FindAsync(id);
            if (item == null) return NotFound();
            item.IsFavorite = dto.IsFavorite;
            await _context.SaveChangesAsync();
            return Ok(item);
        }

        // Exact-name lookup — used to fetch saved FBR defaults for a description
        [HttpGet("items/by-name")]
        public async Task<IActionResult> GetItemByName([FromQuery] string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return NotFound();
            var item = await _context.ItemDescriptions
                .FirstOrDefaultAsync(i => i.Name == name);
            if (item == null) return NotFound();
            return Ok(item);
        }

        // Add new item description
        // Audit H-5 (2026-05-13): global lookup mutation — gated.
        [HttpPost("items")]
        [HasPermission("config.itemdescriptions.manage")]
        public async Task<IActionResult> AddItem([FromBody] CreateItemDto dto)
        {
            var item = new ItemDescription { Name = dto.Name };

            _context.ItemDescriptions.Add(item);
            try
            {
                await _context.SaveChangesAsync();
                return Ok(item);
            }
            catch (DbUpdateException ex) when (ex.InnerException is SqlException sqlEx && sqlEx.Number == 2601)
            {
                // 2601 = Cannot insert duplicate key row
                return BadRequest("Item already exists.");
            }
        }

        // Save/update FBR defaults for an item description (by name — upserts the row).
        // Called automatically when the user picks FBR fields for an item in the bill form.
        // Audit H-5 (2026-05-13): global lookup mutation — gated.
        [HttpPost("items/fbr-defaults")]
        [HasPermission("config.itemdescriptions.manage")]
        public async Task<IActionResult> SaveFbrDefaults([FromBody] SaveItemFbrDefaultsDto dto)
        {
            if (string.IsNullOrWhiteSpace(dto.Name)) return BadRequest("Name is required.");

            var existing = await _context.ItemDescriptions
                .FirstOrDefaultAsync(i => i.Name == dto.Name);

            if (existing == null)
            {
                existing = new ItemDescription { Name = dto.Name };
                _context.ItemDescriptions.Add(existing);
            }

            // Only overwrite values that are actually supplied; leave the rest alone
            if (!string.IsNullOrWhiteSpace(dto.HSCode)) existing.HSCode = dto.HSCode;
            if (!string.IsNullOrWhiteSpace(dto.SaleType)) existing.SaleType = dto.SaleType;
            if (dto.FbrUOMId.HasValue) existing.FbrUOMId = dto.FbrUOMId;
            if (!string.IsNullOrWhiteSpace(dto.UOM)) existing.UOM = dto.UOM;

            // Saving FBR defaults counts as "using" the item — bump the counter so
            // it rises in the top-used / suggested list.
            existing.UsageCount += 1;
            existing.LastUsedAt = DateTime.UtcNow;

            await _context.SaveChangesAsync();
            return Ok(existing);
        }


        // Search units. Returns the AllowsDecimalQuantity flag so the
        // autocomplete-driven quantity inputs can react the moment the
        // operator picks a UOM (no second round-trip needed).
        [HttpGet("units")]
        public async Task<IActionResult> GetUnits([FromQuery] string query)
        {
            var q = (query ?? "").Trim();
            var units = await _context.Units
                .Where(u => string.IsNullOrEmpty(q) || u.Name.Contains(q))
                .OrderBy(u => u.Name)
                .Take(10)
                .Select(u => new MyApp.Api.DTOs.UnitDto
                {
                    Id = u.Id,
                    Name = u.Name,
                    AllowsDecimalQuantity = u.AllowsDecimalQuantity
                })
                .ToListAsync();
            return Ok(units);
        }

        // Add new unit
        // Audit H-5 (2026-05-13): global Units lookup — gated.
        [HttpPost("units")]
        [HasPermission("config.units.manage")]
        public async Task<IActionResult> AddUnit([FromBody] CreateItemDto dto)
        {
            // Normalize input
            var unitName = dto.Name.Trim();

            var unit = new Unit { Name = unitName };
            _context.Units.Add(unit);

            try
            {
                await _context.SaveChangesAsync();
                return Ok(unit);
            }
            catch (DbUpdateException ex) when (ex.InnerException is SqlException sqlEx && (sqlEx.Number == 2601 || sqlEx.Number == 2627))
            {
                // 2601 = Cannot insert duplicate key row
                // 2627 = Violation of PRIMARY KEY / UNIQUE constraint
                return BadRequest("Unit already exists.");
            }
        }

    }
}

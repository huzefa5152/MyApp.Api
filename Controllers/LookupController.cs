using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
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

        // Search item descriptions
        [HttpGet("items")]
        public async Task<IActionResult> GetItems([FromQuery] string query)
        {
            var items = await _context.ItemDescriptions
                .Where(i => i.Name.Contains(query))
                .OrderBy(i => i.Name)
                .Take(10)
                .ToListAsync();
            return Ok(items);
        }

        // Add new item description
        [HttpPost("items")]
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


        // Search units
        [HttpGet("units")]
        public async Task<IActionResult> GetUnits([FromQuery] string query)
        {
            var units = await _context.Units
                .Where(u => u.Name.Contains(query))
                .OrderBy(u => u.Name)
                .Take(10)
                .ToListAsync();
            return Ok(units);
        }

        // Add new unit
        [HttpPost("units")]
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

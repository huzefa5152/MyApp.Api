using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.Middleware;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class FbrLookupController : ControllerBase
    {
        private readonly IFbrLookupService _service;

        public FbrLookupController(IFbrLookupService service)
        {
            _service = service;
        }

        [HttpGet]
        public async Task<IActionResult> GetAll()
        {
            var items = await _service.GetAllAsync();
            return Ok(items);
        }

        [HttpGet("category/{category}")]
        public async Task<IActionResult> GetByCategory(string category)
        {
            var items = await _service.GetByCategoryAsync(category);
            return Ok(items);
        }

        [HttpPost]
        [HasPermission("fbr.config.update")]
        public async Task<IActionResult> Create([FromBody] FbrLookup lookup)
        {
            var created = await _service.CreateAsync(lookup);
            return Ok(created);
        }

        [HttpPut("{id}")]
        [HasPermission("fbr.config.update")]
        public async Task<IActionResult> Update(int id, [FromBody] FbrLookup lookup)
        {
            var updated = await _service.UpdateAsync(id, lookup);
            if (updated == null) return NotFound();
            return Ok(updated);
        }

        [HttpDelete("{id}")]
        [HasPermission("fbr.config.update")]
        public async Task<IActionResult> Delete(int id)
        {
            var deleted = await _service.DeleteAsync(id);
            if (!deleted) return NotFound();
            return NoContent();
        }
    }
}

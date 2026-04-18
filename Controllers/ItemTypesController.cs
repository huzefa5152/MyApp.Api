using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class ItemTypesController : ControllerBase
    {
        private readonly IItemTypeService _service;

        public ItemTypesController(IItemTypeService service)
        {
            _service = service;
        }

        [HttpGet]
        public async Task<ActionResult<List<ItemTypeDto>>> GetAll()
        {
            var items = await _service.GetAllAsync();
            return Ok(items);
        }

        /// <summary>
        /// Returns all HS codes already used by existing item types. The Item
        /// Types page uses this to hide already-saved codes from the HS Code
        /// catalog search, so users only see codes they haven't mapped yet.
        /// </summary>
        [HttpGet("saved-hscodes")]
        public async Task<ActionResult<List<string>>> GetSavedHsCodes()
        {
            return Ok(await _service.GetSavedHsCodesAsync());
        }

        [HttpGet("{id}")]
        public async Task<ActionResult<ItemTypeDto>> GetById(int id)
        {
            var item = await _service.GetByIdAsync(id);
            if (item == null) return NotFound();
            return Ok(item);
        }

        [HttpPost]
        public async Task<ActionResult<ItemTypeDto>> Create([FromBody] ItemTypeDto dto)
        {
            try
            {
                var created = await _service.CreateAsync(dto);
                return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

        [HttpPut("{id}")]
        public async Task<ActionResult<ItemTypeDto>> Update(int id, [FromBody] ItemTypeDto dto)
        {
            try
            {
                var updated = await _service.UpdateAsync(id, dto);
                if (updated == null) return NotFound();
                return Ok(updated);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete(int id)
        {
            try
            {
                await _service.DeleteAsync(id);
                return NoContent();
            }
            catch (KeyNotFoundException)
            {
                return NotFound();
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }
    }
}

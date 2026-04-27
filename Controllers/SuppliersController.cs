using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Mirror of <see cref="ClientsController"/> for the purchase side.
    /// Same shape: list (all + by-company + count), get-by-id, create,
    /// update, delete. Permission keys are <c>suppliers.manage.*</c>.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class SuppliersController : ControllerBase
    {
        private readonly ISupplierService _service;
        public SuppliersController(ISupplierService service) => _service = service;

        [HttpGet]
        [HasPermission("suppliers.manage.view")]
        public async Task<ActionResult<IEnumerable<SupplierDto>>> GetSuppliers()
            => Ok(await _service.GetAllAsync());

        [HttpGet("count")]
        [HasPermission("suppliers.manage.view")]
        public async Task<ActionResult<int>> GetCount([FromQuery] int? companyId)
        {
            if (companyId.HasValue)
            {
                var rows = await _service.GetByCompanyAsync(companyId.Value);
                return Ok(rows.Count());
            }
            var all = await _service.GetAllAsync();
            return Ok(all.Count());
        }

        [HttpGet("company/{companyId}")]
        [HasPermission("suppliers.manage.view")]
        public async Task<ActionResult<IEnumerable<SupplierDto>>> GetByCompany(int companyId)
            => Ok(await _service.GetByCompanyAsync(companyId));

        [HttpGet("{id}")]
        [HasPermission("suppliers.manage.view")]
        public async Task<ActionResult<SupplierDto>> GetById(int id)
        {
            var s = await _service.GetByIdAsync(id);
            if (s == null) return NotFound();
            return Ok(s);
        }

        [HttpPost]
        [HasPermission("suppliers.manage.create")]
        public async Task<ActionResult<SupplierDto>> Create([FromBody] SupplierDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            try
            {
                var result = await _service.CreateAsync(dto);
                return Ok(result);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

        [HttpPut("{id}")]
        [HasPermission("suppliers.manage.update")]
        public async Task<ActionResult<SupplierDto>> Update(int id, [FromBody] SupplierDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            dto.Id = id;
            try
            {
                var result = await _service.UpdateAsync(dto);
                return Ok(result);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
            catch (KeyNotFoundException ex)
            {
                return NotFound(new { message = ex.Message });
            }
        }

        [HttpDelete("{id}")]
        [HasPermission("suppliers.manage.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            try
            {
                await _service.DeleteAsync(id);
                return NoContent();
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }
    }
}

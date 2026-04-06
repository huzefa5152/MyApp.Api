using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Controllers
{
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class MergeFieldsController : ControllerBase
    {
        private readonly IMergeFieldRepository _repo;

        public MergeFieldsController(IMergeFieldRepository repo)
        {
            _repo = repo;
        }

        [HttpGet("{templateType}")]
        public async Task<ActionResult<List<MergeFieldDto>>> GetByTemplateType(string templateType)
        {
            var fields = await _repo.GetByTemplateTypeAsync(templateType);
            return Ok(fields.Select(ToDto).ToList());
        }

        [HttpGet]
        public async Task<ActionResult<List<MergeFieldDto>>> GetAll()
        {
            var fields = await _repo.GetAllAsync();
            return Ok(fields.Select(ToDto).ToList());
        }

        [HttpPost]
        public async Task<ActionResult<MergeFieldDto>> Create([FromBody] MergeFieldDto dto)
        {
            var entity = new MergeField
            {
                TemplateType = dto.TemplateType,
                FieldExpression = dto.FieldExpression,
                Label = dto.Label,
                Category = dto.Category,
                SortOrder = dto.SortOrder,
            };
            var created = await _repo.CreateAsync(entity);
            return CreatedAtAction(nameof(GetByTemplateType), new { templateType = created.TemplateType }, ToDto(created));
        }

        [HttpPut("{id}")]
        public async Task<ActionResult<MergeFieldDto>> Update(int id, [FromBody] MergeFieldDto dto)
        {
            var entity = await _repo.GetByIdAsync(id);
            if (entity == null) return NotFound();

            entity.TemplateType = dto.TemplateType;
            entity.FieldExpression = dto.FieldExpression;
            entity.Label = dto.Label;
            entity.Category = dto.Category;
            entity.SortOrder = dto.SortOrder;

            var updated = await _repo.UpdateAsync(entity);
            return Ok(ToDto(updated));
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete(int id)
        {
            var entity = await _repo.GetByIdAsync(id);
            if (entity == null) return NotFound();
            await _repo.DeleteAsync(entity);
            return NoContent();
        }

        private static MergeFieldDto ToDto(MergeField mf) => new()
        {
            Id = mf.Id,
            TemplateType = mf.TemplateType,
            FieldExpression = mf.FieldExpression,
            Label = mf.Label,
            Category = mf.Category,
            SortOrder = mf.SortOrder,
        };
    }
}

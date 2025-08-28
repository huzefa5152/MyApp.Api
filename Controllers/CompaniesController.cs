using Microsoft.AspNetCore.Mvc;
using MyApp.Api.Services.Interfaces;
using MyApp.Api.DTOs;

namespace MyApp.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class CompaniesController : ControllerBase
    {
        private readonly ICompanyService _companyService;

        public CompaniesController(ICompanyService companyService)
        {
            _companyService = companyService;
        }

        // GET: api/companies
        [HttpGet]
        public async Task<ActionResult<IEnumerable<CompanyDto>>> GetCompanies()
        {
            var companies = await _companyService.GetAllAsync();
            return Ok(companies);
        }

        // GET: api/companies/{id}
        [HttpGet("{id}")]
        public async Task<ActionResult<CompanyDto>> GetCompany(int id)
        {
            var company = await _companyService.GetByIdAsync(id);
            if (company == null)
                return NotFound();

            return Ok(company);
        }

        // POST: api/companies
        [HttpPost]
        public async Task<ActionResult<CompanyDto>> CreateCompany([FromBody] CreateCompanyDto dto)
        {
            if (!ModelState.IsValid)
                return BadRequest(ModelState);

            try
            {
                var createdCompany = await _companyService.CreateAsync(dto);
                return CreatedAtAction(nameof(GetCompany), new { id = createdCompany.Id }, createdCompany);
            }
            catch (InvalidOperationException ex)
            {
                // Return 400 Bad Request with the duplicate name message
                return BadRequest(new { message = ex.Message });
            }
        }

        // PUT: api/companies/{id}
        [HttpPut("{id}")]
        public async Task<ActionResult<CompanyDto>> UpdateCompany(int id, [FromBody] UpdateCompanyDto dto)
        {
            if (!ModelState.IsValid)
                return BadRequest(ModelState);

            try
            {
                var updatedCompany = await _companyService.UpdateAsync(id, dto);

                if (updatedCompany == null)
                    return NotFound();

                return Ok(updatedCompany);
            }
            catch (InvalidOperationException ex)
            {
                // Return 400 Bad Request with the duplicate name message
                return BadRequest(new { message = ex.Message });
            }
        }

        // DELETE: api/companies/{id}
        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteCompany(int id)
        {
            await _companyService.DeleteAsync(id);
            return NoContent();
        }
    }
}

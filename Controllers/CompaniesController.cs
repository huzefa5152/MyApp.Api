using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;
using MyApp.Api.DTOs;

namespace MyApp.Api.Controllers
{
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class CompaniesController : ControllerBase
    {
        private readonly ICompanyService _companyService;
        private readonly IWebHostEnvironment _env;

        public CompaniesController(ICompanyService companyService, IWebHostEnvironment env)
        {
            _companyService = companyService;
            _env = env;
        }

        // GET: api/companies
        // Reads are open to any authenticated user — the company list is a
        // foundational dependency for challan/invoice/client flows. Write
        // operations below require explicit companies.manage.* permissions.
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
        [HasPermission("companies.manage.create")]
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
        [HasPermission("companies.manage.update")]
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
        [HasPermission("companies.manage.delete")]
        public async Task<IActionResult> DeleteCompany(int id)
        {
            await _companyService.DeleteAsync(id);
            return NoContent();
        }

        // POST: api/companies/{id}/logo
        [HttpPost("{id}/logo")]
        [HasPermission("companies.manage.update")]
        public async Task<ActionResult<CompanyDto>> UploadLogo(int id, IFormFile file)
        {
            if (file == null || file.Length == 0)
                return BadRequest(new { message = "No file uploaded." });

            var company = await _companyService.GetByIdAsync(id);
            if (company == null) return NotFound();

            var uploadsDir = Path.Combine(_env.ContentRootPath, "data", "uploads", "logos");
            Directory.CreateDirectory(uploadsDir);

            var ext = Path.GetExtension(file.FileName);
            var fileName = $"company_{id}{ext}";
            var filePath = Path.Combine(uploadsDir, fileName);

            using (var stream = new FileStream(filePath, FileMode.Create))
            {
                await file.CopyToAsync(stream);
            }

            var logoPath = $"/data/uploads/logos/{fileName}";

            var updateDto = new UpdateCompanyDto
            {
                Name = company.Name,
                BrandName = company.BrandName,
                FullAddress = company.FullAddress,
                Phone = company.Phone,
                NTN = company.NTN,
                STRN = company.STRN,
                LogoPath = logoPath,
                StartingChallanNumber = company.StartingChallanNumber,
                StartingInvoiceNumber = company.StartingInvoiceNumber
            };
            var updated = await _companyService.UpdateAsync(id, updateDto);
            return Ok(updated);
        }
    }
}

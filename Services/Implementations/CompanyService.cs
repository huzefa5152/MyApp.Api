using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class CompanyService : ICompanyService
    {
        private readonly ICompanyRepository _repository;

        public CompanyService(ICompanyRepository repository)
        {
            _repository = repository;
        }

        public async Task<IEnumerable<CompanyDto>> GetAllAsync()
        {
            var companies = await _repository.GetAllAsync();
            return companies.Select(c => new CompanyDto
            {
                Id = c.Id,
                Name = c.Name,
                StartingChallanNumber = c.StartingChallanNumber,
                CurrentChallanNumber = c.CurrentChallanNumber
            });
        }

        public async Task<CompanyDto?> GetByIdAsync(int id)
        {
            var company = await _repository.GetByIdAsync(id);
            if (company == null) return null;

            return new CompanyDto
            {
                Id = company.Id,
                Name = company.Name,
                StartingChallanNumber = company.StartingChallanNumber,
                CurrentChallanNumber = company.CurrentChallanNumber
            };
        }

        public async Task<CompanyDto> CreateAsync(CreateCompanyDto dto)
        {
            // Check if company name already exists
            if (await _repository.ExistsByNameAsync(dto.Name))
                throw new InvalidOperationException($"A company with the name '{dto.Name}' already exists.");

            var company = new Company
            {
                Name = dto.Name,
                StartingChallanNumber = dto.StartingChallanNumber,
                CurrentChallanNumber = dto.StartingChallanNumber // default when created
            };

            var created = await _repository.AddAsync(company);

            return new CompanyDto
            {
                Id = created.Id,
                Name = created.Name,
                StartingChallanNumber = created.StartingChallanNumber,
                CurrentChallanNumber = created.CurrentChallanNumber
            };
        }

        public async Task<CompanyDto?> UpdateAsync(int id, UpdateCompanyDto dto)
        {
            var company = await _repository.GetByIdAsync(id);
            if (company == null) return null;

            // Check uniqueness excluding current company id
            if (await _repository.ExistsByNameAsync(dto.Name, id))
                throw new InvalidOperationException($"A company with the name '{dto.Name}' already exists.");

            company.Name = dto.Name;
            company.StartingChallanNumber = dto.StartingChallanNumber;
            company.CurrentChallanNumber = dto.CurrentChallanNumber;

            var updated = await _repository.UpdateAsync(company);

            return new CompanyDto
            {
                Id = updated.Id,
                Name = updated.Name,
                StartingChallanNumber = updated.StartingChallanNumber,
                CurrentChallanNumber = updated.CurrentChallanNumber
            };
        }

        public async Task DeleteAsync(int id)
        {
            var company = await _repository.GetByIdAsync(id);
            if (company == null) throw new KeyNotFoundException("Company not found");

            await _repository.DeleteAsync(company);
        }
    }
}

using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class ClientService : IClientService
    {
        private readonly IClientRepository _repo;
        private readonly IInvoiceRepository _invoiceRepo;
        private readonly IDeliveryChallanService _challanService;
        private readonly AppDbContext _context;
        public ClientService(IClientRepository repo, IInvoiceRepository invoiceRepo, IDeliveryChallanService challanService, AppDbContext context)
        {
            _repo = repo;
            _invoiceRepo = invoiceRepo;
            _challanService = challanService;
            _context = context;
        }

        private static ClientDto ToDto(Client c, bool hasInvoices = false) => new()
        {
            Id = c.Id,
            Name = c.Name,
            Address = c.Address,
            Phone = c.Phone,
            Email = c.Email,
            NTN = c.NTN,
            STRN = c.STRN,
            Site = c.Site,
            RegistrationType = c.RegistrationType,
            CNIC = c.CNIC,
            FbrProvinceCode = c.FbrProvinceCode,
            CompanyId = c.CompanyId,
            HasInvoices = hasInvoices,
            CreatedAt = c.CreatedAt
        };

        public async Task<IEnumerable<ClientDto>> GetAllAsync()
        {
            var clients = (await _repo.GetAllAsync()).ToList();
            var clientIds = clients.Select(c => c.Id).ToList();
            var hasInvoicesMap = await _invoiceRepo.HasInvoicesForClientsAsync(clientIds);
            return clients.Select(c => ToDto(c, hasInvoicesMap.GetValueOrDefault(c.Id)));
        }

        public async Task<IEnumerable<ClientDto>> GetByCompanyAsync(int companyId)
        {
            var clients = (await _repo.GetByCompanyAsync(companyId)).ToList();
            var clientIds = clients.Select(c => c.Id).ToList();
            var hasInvoicesMap = await _invoiceRepo.HasInvoicesForClientsAsync(clientIds);
            return clients.Select(c => ToDto(c, hasInvoicesMap.GetValueOrDefault(c.Id)));
        }

        public async Task<ClientDto?> GetByIdAsync(int id)
        {
            var c = await _repo.GetByIdAsync(id);
            if (c == null) return null;
            var hasInvoices = await _invoiceRepo.HasInvoicesForClientAsync(c.Id);
            return ToDto(c, hasInvoices);
        }

        public async Task<ClientDto> CreateAsync(ClientDto dto)
        {
            if (await _repo.ExistsWithNameAsync(dto.Name, dto.CompanyId))
                throw new InvalidOperationException("Client with this name already exists for this company.");

            var client = new Client
            {
                Name = dto.Name,
                Address = dto.Address,
                Phone = dto.Phone,
                Email = dto.Email,
                NTN = dto.NTN,
                STRN = dto.STRN,
                Site = dto.Site,
                RegistrationType = dto.RegistrationType,
                CNIC = dto.CNIC,
                FbrProvinceCode = dto.FbrProvinceCode,
                CompanyId = dto.CompanyId,
                CreatedAt = DateTime.UtcNow
            };

            var created = await _repo.CreateAsync(client);
            return ToDto(created);
        }

        public async Task<ClientDto> UpdateAsync(ClientDto dto)
        {
            if (dto.Id == null) throw new ArgumentException("Client ID is required for update.");

            var client = await _repo.GetByIdAsync(dto.Id.Value);
            if (client == null) throw new KeyNotFoundException("Client not found.");

            if (await _repo.ExistsWithNameAsync(dto.Name, client.CompanyId, dto.Id))
                throw new InvalidOperationException("Client with this name already exists for this company.");

            client.Name = dto.Name;
            client.Address = dto.Address;
            client.Phone = dto.Phone;
            client.Email = dto.Email;
            client.NTN = dto.NTN;
            client.STRN = dto.STRN;
            client.Site = dto.Site;
            client.RegistrationType = dto.RegistrationType;
            client.CNIC = dto.CNIC;
            client.FbrProvinceCode = dto.FbrProvinceCode;

            var hasInvoices = await _invoiceRepo.HasInvoicesForClientAsync(client.Id);
            await _repo.UpdateAsync(client);

            // Re-evaluate "Setup Required" challans for this client
            await _challanService.ReEvaluateSetupRequiredAsync(client.CompanyId, client.Id);

            return ToDto(client, hasInvoices);
        }

        public async Task DeleteAsync(int id)
        {
            var client = await _repo.GetByIdAsync(id);
            if (client == null) return;

            // Cascade delete in a single transaction for atomicity
            await using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                // 1. Unlink challans from invoices for this client
                await _context.DeliveryChallans
                    .Where(dc => dc.ClientId == id && dc.InvoiceId != null)
                    .ExecuteUpdateAsync(s => s.SetProperty(dc => dc.InvoiceId, (int?)null));

                // 2. Delete invoice items, then invoices
                var invoiceIds = await _context.Invoices.Where(i => i.ClientId == id).Select(i => i.Id).ToListAsync();
                if (invoiceIds.Count > 0)
                {
                    await _context.InvoiceItems.Where(ii => invoiceIds.Contains(ii.InvoiceId)).ExecuteDeleteAsync();
                    await _context.Invoices.Where(i => i.ClientId == id).ExecuteDeleteAsync();
                }

                // 3. Delete delivery items, then challans
                var challanIds = await _context.DeliveryChallans.Where(dc => dc.ClientId == id).Select(dc => dc.Id).ToListAsync();
                if (challanIds.Count > 0)
                {
                    await _context.DeliveryItems.Where(di => challanIds.Contains(di.DeliveryChallanId)).ExecuteDeleteAsync();
                    await _context.DeliveryChallans.Where(dc => dc.ClientId == id).ExecuteDeleteAsync();
                }

                // 4. Delete the client
                await _repo.DeleteAsync(client);

                await transaction.CommitAsync();
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
        }
    }
}

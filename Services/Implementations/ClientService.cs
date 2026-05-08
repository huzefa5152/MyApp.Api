using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
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
        private readonly IClientGroupService _clientGroupService;
        private readonly AppDbContext _context;
        private readonly ILogger<ClientService> _logger;
        public ClientService(IClientRepository repo, IInvoiceRepository invoiceRepo, IDeliveryChallanService challanService, IClientGroupService clientGroupService, AppDbContext context, ILogger<ClientService> logger)
        {
            _repo = repo;
            _invoiceRepo = invoiceRepo;
            _challanService = challanService;
            _clientGroupService = clientGroupService;
            _context = context;
            _logger = logger;
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
            ClientGroupId = c.ClientGroupId,
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

            // Attach to a Common Client group — find-or-create by NTN
            // (or normalised name fallback). Idempotent and runs after the
            // initial save so the FK has a real client Id to point back to.
            // Failure here MUST NOT break the create — the per-company
            // record is the source of truth and works fine without a
            // group.
            try
            {
                await _clientGroupService.EnsureGroupForClientAsync(created);
                await _context.SaveChangesAsync();
            }
            catch
            {
                // Swallow: grouping is a convenience layer. Operator
                // can edit-save the client to retry the grouping.
            }

            return ToDto(created);
        }

        public async Task<CreateClientBatchResultDto> CreateForCompaniesAsync(CreateClientBatchDto dto)
        {
            var result = new CreateClientBatchResultDto();
            if (dto.CompanyIds == null || dto.CompanyIds.Count == 0)
                throw new InvalidOperationException("At least one company must be selected.");

            // Resolve company names up front so the skip messages don't
            // require a per-row round-trip and so the operator sees friendly
            // labels (not just numeric ids) in the response toast.
            var distinctIds = dto.CompanyIds.Distinct().ToList();
            var companyNames = await _context.Companies
                .Where(c => distinctIds.Contains(c.Id))
                .ToDictionaryAsync(c => c.Id, c => c.Name);

            // Use a single transaction so a partial failure (e.g. transient
            // DB error mid-batch) doesn't leave us with half the records and
            // a half-formed Common Client group. Either every selected
            // company gets the row (or is recorded as skipped) or nothing
            // changes.
            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                foreach (var companyId in distinctIds)
                {
                    if (!companyNames.TryGetValue(companyId, out var companyName))
                    {
                        result.SkippedReasons.Add($"Company id={companyId} not found.");
                        continue;
                    }

                    // Same name-collision rule the per-company CreateAsync
                    // enforces — record as a skip instead of throwing so the
                    // remaining companies still get the row.
                    if (await _repo.ExistsWithNameAsync(dto.Name, companyId))
                    {
                        result.SkippedReasons.Add(
                            $"{companyName}: a client named '{dto.Name}' already exists; skipped.");
                        continue;
                    }

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
                        CompanyId = companyId,
                        CreatedAt = DateTime.UtcNow,
                    };
                    var created = await _repo.CreateAsync(client);

                    // Find-or-create the shared ClientGroup. After the first
                    // iteration this LANDS on the same group every time
                    // because EnsureGroup keys off NTN (or normalised name)
                    // — so picking 2+ companies auto-collapses them into
                    // one Common Client without any extra wiring here.
                    try
                    {
                        var grp = await _clientGroupService.EnsureGroupForClientAsync(created);
                        await _context.SaveChangesAsync();
                        result.ClientGroupId = grp.Id;
                    }
                    catch
                    {
                        // Grouping failure must not block the create —
                        // the per-company row is the source of truth.
                    }

                    result.Created.Add(ToDto(created));
                }

                await tx.CommitAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "ClientService: bulk-create transaction rolled back");
                await tx.RollbackAsync();
                throw;
            }

            return result;
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

            // Re-evaluate Common Client grouping. NTN / Name might have
            // just changed, which moves the client from one group to
            // another (or creates a new group). Same defensive try/catch
            // pattern as Create — grouping must never break a save.
            try
            {
                await _clientGroupService.EnsureGroupForClientAsync(client);
                await _context.SaveChangesAsync();
            }
            catch { /* see CreateAsync */ }

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
            catch (Exception ex)
            {
                _logger.LogError(ex, "ClientService: delete-client transaction rolled back for clientId={ClientId}", id);
                await transaction.RollbackAsync();
                throw;
            }
        }
    }
}

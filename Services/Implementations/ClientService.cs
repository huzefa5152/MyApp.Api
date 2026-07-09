using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
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
        private readonly AttachmentStorage _attachmentStorage;
        private readonly ILogger<ClientService> _logger;
        public ClientService(IClientRepository repo, IInvoiceRepository invoiceRepo, IDeliveryChallanService challanService, IClientGroupService clientGroupService, AppDbContext context, AttachmentStorage attachmentStorage, ILogger<ClientService> logger)
        {
            _repo = repo;
            _invoiceRepo = invoiceRepo;
            _challanService = challanService;
            _clientGroupService = clientGroupService;
            _context = context;
            _attachmentStorage = attachmentStorage;
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

        public async Task<CreateClientBatchResultDto> CopyToCompaniesAsync(int sourceClientId, List<int> targetCompanyIds)
        {
            if (targetCompanyIds == null || targetCompanyIds.Count == 0)
                throw new InvalidOperationException("At least one target company must be selected.");

            var source = await _repo.GetByIdAsync(sourceClientId)
                ?? throw new KeyNotFoundException("Source client not found.");

            // Strip the source's own company from the target set defensively —
            // copying into the same company would either collide on the unique
            // (Name, CompanyId) constraint or no-op via the SkippedReasons
            // branch. Either way it's noise.
            var cleanTargets = targetCompanyIds
                .Where(id => id != source.CompanyId)
                .Distinct()
                .ToList();

            if (cleanTargets.Count == 0)
                throw new InvalidOperationException("No valid target companies to copy into (cannot copy a client into its own company).");

            // Hand off to the existing multi-company create — it already
            // handles the per-company name-collision skip, the
            // EnsureGroupForClientAsync auto-link, and the single-
            // transaction commit/rollback. By feeding it the source's
            // identifying fields (especially NTN), every newly-created
            // row lands on the SAME ClientGroup as the source.
            var batch = new CreateClientBatchDto
            {
                Name = source.Name,
                Address = source.Address,
                Phone = source.Phone,
                Email = source.Email,
                NTN = source.NTN,
                STRN = source.STRN,
                Site = source.Site,
                RegistrationType = source.RegistrationType,
                CNIC = source.CNIC,
                FbrProvinceCode = source.FbrProvinceCode,
                CompanyIds = cleanTargets,
            };
            return await CreateForCompaniesAsync(batch);
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

            // Re-evaluate "Setup Required" challans for this client. Non-fatal:
            // the client update has already committed at this point — if the
            // re-eval fails (transient DB error, row concurrency mid-loop)
            // the controller would otherwise return 500 to the client with
            // the name change actually persisted. Idempotent: any leftover
            // "Setup Required" rows will self-correct on the next page load
            // (ChallanService.GetPagedByCompanyAsync re-runs the same pass).
            try
            {
                await _challanService.ReEvaluateSetupRequiredAsync(client.CompanyId, client.Id);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex,
                    "Client {ClientId} (company {CompanyId}) updated OK but Setup-Required re-evaluation failed; will self-correct on next list reload.",
                    client.Id, client.CompanyId);
            }

            return ToDto(client, hasInvoices);
        }

        public async Task<ClientDeleteImpactDto> GetDeleteImpactAsync(int id)
        {
            return new ClientDeleteImpactDto
            {
                SalesQuotes = await _context.SalesQuotes.CountAsync(q => q.ClientId == id),
                SalesOrders = await _context.SalesOrders.CountAsync(o => o.ClientId == id),
                DeliveryChallans = await _context.DeliveryChallans.CountAsync(dc => dc.ClientId == id),
                Invoices = await _context.Invoices.CountAsync(i => i.ClientId == id),
                FbrSubmittedInvoices = await _context.Invoices.CountAsync(i => i.ClientId == id && i.FbrStatus == "Submitted"),
            };
        }

        public async Task DeleteAsync(int id)
        {
            var client = await _repo.GetByIdAsync(id);
            if (client == null) return;

            // Compliance guard: never wipe FBR-submitted bills (mirrors the
            // single-bill guard in InvoiceService.DeleteAsync). Thrown before the
            // transaction → controller maps to a clear 400, nothing is deleted.
            var submitted = await _context.Invoices.CountAsync(i => i.ClientId == id && i.FbrStatus == "Submitted");
            if (submitted > 0)
                throw new InvalidOperationException(
                    $"This client has {submitted} FBR-submitted bill{(submitted == 1 ? "" : "s")} that cannot be deleted. " +
                    "Handle those in the Invoices tab first, then delete the client.");

            var companyId = client.CompanyId;
            var attachmentPaths = new List<string>();

            // Full cascade in a single transaction for atomicity.
            await using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                // 0. Break the quote↔order cross-links (NoAction FKs) so both sides
                //    can be deleted below.
                await _context.SalesQuotes.Where(q => q.ClientId == id && q.ConvertedToSalesOrderId != null)
                    .ExecuteUpdateAsync(s => s.SetProperty(q => q.ConvertedToSalesOrderId, (int?)null));
                await _context.SalesOrders.Where(o => o.ClientId == id && o.SalesQuoteId != null)
                    .ExecuteUpdateAsync(s => s.SetProperty(o => o.SalesQuoteId, (int?)null));

                // 1. Unlink challans from invoices for this client.
                await _context.DeliveryChallans.Where(dc => dc.ClientId == id && dc.InvoiceId != null)
                    .ExecuteUpdateAsync(s => s.SetProperty(dc => dc.InvoiceId, (int?)null));

                var invoiceIds = await _context.Invoices.Where(i => i.ClientId == id).Select(i => i.Id).ToListAsync();
                var challanIds = await _context.DeliveryChallans.Where(dc => dc.ClientId == id).Select(dc => dc.Id).ToListAsync();
                var orderIds = await _context.SalesOrders.Where(o => o.ClientId == id).Select(o => o.Id).ToListAsync();
                var quoteIds = await _context.SalesQuotes.Where(q => q.ClientId == id).Select(q => q.Id).ToListAsync();

                // 2. Remove attachments tied to any of this client's documents
                //    (no FK, so they'd otherwise orphan + skew folder counts).
                //    Collect on-disk paths to delete AFTER the commit succeeds.
                if (invoiceIds.Count + challanIds.Count + orderIds.Count + quoteIds.Count > 0)
                {
                    var atts = await _context.Attachments
                        .Where(a => a.CompanyId == companyId && a.EntityType != null && a.EntityId != null && (
                            ((a.EntityType == "Invoice" || a.EntityType == "Bill") && invoiceIds.Contains(a.EntityId.Value)) ||
                            (a.EntityType == "DeliveryChallan" && challanIds.Contains(a.EntityId.Value)) ||
                            (a.EntityType == "SalesOrder" && orderIds.Contains(a.EntityId.Value)) ||
                            (a.EntityType == "SalesQuote" && quoteIds.Contains(a.EntityId.Value))))
                        .ToListAsync();
                    if (atts.Count > 0)
                    {
                        attachmentPaths = atts.Select(a => a.StoragePath).Where(p => !string.IsNullOrEmpty(p)).ToList();
                        _context.Attachments.RemoveRange(atts);
                        await _context.SaveChangesAsync();
                    }
                }

                // 3. Invoices: purge their stock movements (else on-hand skews),
                //    then items, then the invoices.
                if (invoiceIds.Count > 0)
                {
                    await _context.StockMovements
                        .Where(m => m.CompanyId == companyId && m.SourceType == StockMovementSourceType.Invoice && m.SourceId != null && invoiceIds.Contains(m.SourceId.Value))
                        .ExecuteDeleteAsync();
                    await _context.InvoiceItems.Where(ii => invoiceIds.Contains(ii.InvoiceId)).ExecuteDeleteAsync();
                    await _context.Invoices.Where(i => i.ClientId == id).ExecuteDeleteAsync();
                }

                // 4. Delivery challans (+ their items). Done before sales orders,
                //    which they reference (Restrict).
                if (challanIds.Count > 0)
                {
                    await _context.DeliveryItems.Where(di => challanIds.Contains(di.DeliveryChallanId)).ExecuteDeleteAsync();
                    await _context.DeliveryChallans.Where(dc => dc.ClientId == id).ExecuteDeleteAsync();
                }

                // 5. Sales orders (+ their items).
                if (orderIds.Count > 0)
                {
                    await _context.SalesOrderItems.Where(soi => orderIds.Contains(soi.SalesOrderId)).ExecuteDeleteAsync();
                    await _context.SalesOrders.Where(o => o.ClientId == id).ExecuteDeleteAsync();
                }

                // 6. Sales quotes (+ their items).
                if (quoteIds.Count > 0)
                {
                    await _context.SalesQuoteItems.Where(sqi => quoteIds.Contains(sqi.SalesQuoteId)).ExecuteDeleteAsync();
                    await _context.SalesQuotes.Where(q => q.ClientId == id).ExecuteDeleteAsync();
                }

                // 7. Finally the client (POFormat.ClientId is SetNull by the DB).
                await _repo.DeleteAsync(client);

                await transaction.CommitAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "ClientService: delete-client transaction rolled back for clientId={ClientId}", id);
                await transaction.RollbackAsync();
                throw;
            }

            // Best-effort file cleanup AFTER the DB commit (rows are already gone).
            foreach (var p in attachmentPaths) _attachmentStorage.TryDelete(p);
        }
    }
}

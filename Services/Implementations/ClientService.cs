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

        public async Task<List<ClientSummaryDto>> GetSummaryByCompanyAsync(int companyId)
        {
            // Base set: every client of the company, so zero-activity clients
            // still render a (zeroed) row.
            var clients = await _context.Clients.AsNoTracking()
                .Where(c => c.CompanyId == companyId)
                .Select(c => new { c.Id, c.Name })
                .ToListAsync();

            // Document counts (one grouped query each; sequential — the context
            // is not thread-safe). Sale-invoice count excludes demo / cancelled
            // and credit+debit notes (DocumentType 9/10), matching the KPI
            // conventions. EF Core translates the nullable `!=` null-aware, so
            // regular invoices (DocumentType null/0) are included.
            var quoteCounts = await _context.SalesQuotes
                .Where(q => q.CompanyId == companyId)
                .GroupBy(q => q.ClientId)
                .Select(g => new { ClientId = g.Key, N = g.Count() })
                .ToDictionaryAsync(x => x.ClientId, x => x.N);

            var orderCounts = await _context.SalesOrders
                .Where(o => o.CompanyId == companyId)
                .GroupBy(o => o.ClientId)
                .Select(g => new { ClientId = g.Key, N = g.Count() })
                .ToDictionaryAsync(x => x.ClientId, x => x.N);

            var invoiceCounts = await _context.Invoices
                .Where(i => i.CompanyId == companyId && !i.IsDemo && !i.IsCancelled
                            && i.DocumentType != 9 && i.DocumentType != 10)
                .GroupBy(i => i.ClientId)
                .Select(g => new { ClientId = g.Key, N = g.Count() })
                .ToDictionaryAsync(x => x.ClientId, x => x.N);

            var creditNoteCounts = await _context.Invoices
                .Where(i => i.CompanyId == companyId && !i.IsDemo && i.DocumentType == 10)
                .GroupBy(i => i.ClientId)
                .Select(g => new { ClientId = g.Key, N = g.Count() })
                .ToDictionaryAsync(x => x.ClientId, x => x.N);

            var challanCounts = await _context.DeliveryChallans
                .Where(dc => dc.CompanyId == companyId && !dc.IsDemo)
                .GroupBy(dc => dc.ClientId)
                .Select(g => new { ClientId = g.Key, N = g.Count() })
                .ToDictionaryAsync(x => x.ClientId, x => x.N);

            // Money: AR = Σ(GrandTotal − AmountPaid) over sale invoices.
            var arByClient = await _context.Invoices
                .Where(i => i.CompanyId == companyId && !i.IsDemo && !i.IsCancelled
                            && i.DocumentType != 9 && i.DocumentType != 10)
                .GroupBy(i => i.ClientId)
                .Select(g => new { ClientId = g.Key, Bal = g.Sum(i => i.GrandTotal - i.AmountPaid) })
                .ToDictionaryAsync(x => x.ClientId, x => x.Bal);

            var whtByClient = await _context.WithholdingTaxReceipts
                .Where(r => r.CompanyId == companyId)
                .GroupBy(r => r.ClientId)
                .Select(g => new { ClientId = g.Key, Sum = g.Sum(r => r.Amount) })
                .ToDictionaryAsync(x => x.ClientId, x => x.Sum);

            // Qty to deliver = Σ(ordered − delivered) across non-cancelled orders.
            var orderedByClient = await _context.SalesOrderItems
                .Where(soi => soi.SalesOrder.CompanyId == companyId && soi.SalesOrder.Status != "Cancelled")
                .GroupBy(soi => soi.SalesOrder.ClientId)
                .Select(g => new { ClientId = g.Key, Q = g.Sum(x => x.Quantity) })
                .ToDictionaryAsync(x => x.ClientId, x => x.Q);

            var deliveredOnOrdersByClient = await _context.DeliveryItems
                .Where(di => di.SalesOrderItemId != null
                             && di.SalesOrderItem!.SalesOrder.CompanyId == companyId
                             && di.SalesOrderItem.SalesOrder.Status != "Cancelled")
                .GroupBy(di => di.SalesOrderItem!.SalesOrder.ClientId)
                .Select(g => new { ClientId = g.Key, Q = g.Sum(x => x.Quantity) })
                .ToDictionaryAsync(x => x.ClientId, x => x.Q);

            // Qty to invoice = Σ delivered quantity on challans not yet billed.
            var toInvoiceByClient = await _context.DeliveryItems
                .Where(di => di.DeliveryChallan.CompanyId == companyId
                             && di.DeliveryChallan.InvoiceId == null
                             && !di.DeliveryChallan.IsDemo)
                .GroupBy(di => di.DeliveryChallan.ClientId)
                .Select(g => new { ClientId = g.Key, Q = g.Sum(x => x.Quantity) })
                .ToDictionaryAsync(x => x.ClientId, x => x.Q);

            var list = new List<ClientSummaryDto>(clients.Count);
            foreach (var c in clients)
            {
                var ar = arByClient.GetValueOrDefault(c.Id);
                var ordered = orderedByClient.GetValueOrDefault(c.Id);
                var delivered = deliveredOnOrdersByClient.GetValueOrDefault(c.Id);
                list.Add(new ClientSummaryDto
                {
                    ClientId = c.Id,
                    ClientName = c.Name,
                    SalesQuotes = quoteCounts.GetValueOrDefault(c.Id),
                    SalesOrders = orderCounts.GetValueOrDefault(c.Id),
                    SalesInvoices = invoiceCounts.GetValueOrDefault(c.Id),
                    CreditNotes = creditNoteCounts.GetValueOrDefault(c.Id),
                    DeliveryNotes = challanCounts.GetValueOrDefault(c.Id),
                    QtyToDeliver = ordered - delivered,
                    QtyToInvoice = toInvoiceByClient.GetValueOrDefault(c.Id),
                    AccountsReceivable = ar,
                    WithholdingTaxReceivable = whtByClient.GetValueOrDefault(c.Id),
                    Status = ar > 0 ? "Unpaid" : (ar < 0 ? "Overpaid" : "Paid"),
                });
            }
            return list;
        }

        public async Task<ClientDrilldownDto> GetDrilldownAsync(int clientId, string clientName)
        {
            // Cap each section so a heavy client (e.g. 600+ quotes) never ships
            // thousands of rows; the popup shows "N of Total". Most-recent first.
            const int CAP = 100;
            var dto = new ClientDrilldownDto { ClientId = clientId, ClientName = clientName };

            dto.Quotes.Total = await _context.SalesQuotes.CountAsync(q => q.ClientId == clientId);
            dto.Quotes.Rows = await _context.SalesQuotes.AsNoTracking()
                .Where(q => q.ClientId == clientId)
                .OrderByDescending(q => q.QuoteNumber).Take(CAP)
                .Select(q => new ClientDocRowDto { Id = q.Id, Number = q.QuoteNumber.ToString(), Date = q.Date, Amount = q.GrandTotal, Status = q.Status })
                .ToListAsync();

            dto.Orders.Total = await _context.SalesOrders.CountAsync(o => o.ClientId == clientId);
            dto.Orders.Rows = await _context.SalesOrders.AsNoTracking()
                .Where(o => o.ClientId == clientId)
                .OrderByDescending(o => o.SalesOrderNumber).Take(CAP)
                .Select(o => new ClientDocRowDto { Id = o.Id, Number = o.SalesOrderNumber.ToString(), Date = o.OrderDate, Status = o.Status })
                .ToListAsync();

            // Sale invoices (exclude demo / cancelled / credit+debit notes).
            var invBase = _context.Invoices.Where(i => i.ClientId == clientId && !i.IsDemo && !i.IsCancelled && i.DocumentType != 9 && i.DocumentType != 10);
            dto.Invoices.Total = await invBase.CountAsync();
            dto.Invoices.Rows = await invBase.AsNoTracking()
                .OrderByDescending(i => i.Date).ThenByDescending(i => i.InvoiceNumber).Take(CAP)
                .Select(i => new ClientDocRowDto
                {
                    Id = i.Id,
                    Number = i.InvoiceNumber.ToString(),
                    Date = i.Date,
                    Amount = i.GrandTotal,
                    Balance = i.GrandTotal - i.AmountPaid,
                    Status = (i.GrandTotal - i.AmountPaid) <= 0 ? "Paid" : (i.AmountPaid > 0 ? "Partial" : "Unpaid"),
                })
                .ToListAsync();

            // Credit notes (DocumentType 10).
            var cnBase = _context.Invoices.Where(i => i.ClientId == clientId && !i.IsDemo && i.DocumentType == 10);
            dto.CreditNotes.Total = await cnBase.CountAsync();
            dto.CreditNotes.Rows = await cnBase.AsNoTracking()
                .OrderByDescending(i => i.Date).ThenByDescending(i => i.InvoiceNumber).Take(CAP)
                .Select(i => new ClientDocRowDto { Id = i.Id, Number = i.InvoiceNumber.ToString(), Date = i.Date, Amount = i.GrandTotal, Status = i.FbrStatus })
                .ToListAsync();

            // Delivery challans (notes). Show "Billed" once linked to a bill.
            var chBase = _context.DeliveryChallans.Where(dc => dc.ClientId == clientId && !dc.IsDemo);
            dto.Challans.Total = await chBase.CountAsync();
            dto.Challans.Rows = await chBase.AsNoTracking()
                .OrderByDescending(dc => dc.ChallanNumber).Take(CAP)
                .Select(dc => new ClientDocRowDto { Id = dc.Id, Number = dc.ChallanNumber.ToString(), Date = dc.DeliveryDate, Status = dc.InvoiceId != null ? "Billed" : dc.Status })
                .ToListAsync();

            dto.WithholdingReceipts.Total = await _context.WithholdingTaxReceipts.CountAsync(r => r.ClientId == clientId);
            dto.WithholdingReceipts.Rows = await _context.WithholdingTaxReceipts.AsNoTracking()
                .Where(r => r.ClientId == clientId)
                .OrderByDescending(r => r.Date).ThenByDescending(r => r.ReceiptNumber).Take(CAP)
                .Select(r => new ClientDocRowDto { Id = r.Id, Number = r.ReceiptNumber.ToString(), Date = r.Date, Amount = r.Amount, Status = r.Description })
                .ToListAsync();

            return dto;
        }

        public async Task<ClientStatementDto> GetStatementAsync(int clientId, string clientName)
        {
            const int CAP = 200;
            var entries = new List<ClientStatementEntryDto>();

            // Debits — sale invoices (exclude demo / cancelled / credit+debit notes).
            var invoices = await _context.Invoices.AsNoTracking()
                .Where(i => i.ClientId == clientId && !i.IsDemo && !i.IsCancelled && i.DocumentType != 9 && i.DocumentType != 10)
                .Select(i => new { i.Id, i.InvoiceNumber, i.Date, i.GrandTotal })
                .ToListAsync();
            foreach (var i in invoices)
                entries.Add(new ClientStatementEntryDto { Date = i.Date, Type = "Sales Invoice", Reference = "INV-" + i.InvoiceNumber, DocId = i.Id, Debit = i.GrandTotal });

            // Credits — receipt allocations against this client's sale invoices.
            // One row per allocation (matching the reference), so Σ credits ==
            // Σ invoice AmountPaid → the running balance ends at the A/R figure.
            var allocs = await (
                from a in _context.PaymentAllocations.AsNoTracking()
                join p in _context.Payments.AsNoTracking() on a.PaymentId equals p.Id
                join inv in _context.Invoices.AsNoTracking() on a.InvoiceId equals inv.Id
                where a.InvoiceId != null
                      && inv.ClientId == clientId && !inv.IsDemo && !inv.IsCancelled && inv.DocumentType != 9 && inv.DocumentType != 10
                      && p.Direction == MyApp.Api.Models.Accounting.PaymentDirection.Receipt && !p.IsCancelled
                select new { p.Number, p.Date, p.BankAccountName, p.Description, a.Amount, a.Id }
            ).ToListAsync();
            foreach (var a in allocs)
                entries.Add(new ClientStatementEntryDto { Date = a.Date, Type = "Receipt", Reference = "RCP-" + a.Number, DocId = a.Id, BankAccount = a.BankAccountName, Description = a.Description, Credit = a.Amount });

            // Running balance oldest → newest; on the same date, debits (invoices)
            // land before credits (receipts), mirroring the reference.
            var ordered = entries.OrderBy(e => e.Date).ThenByDescending(e => e.Debit).ToList();
            decimal bal = 0m;
            foreach (var e in ordered) { bal += e.Debit - e.Credit; e.Balance = bal; }

            var total = ordered.Count;
            ordered.Reverse(); // newest-first for display
            var shown = ordered.Take(CAP).ToList();

            return new ClientStatementDto
            {
                ClientId = clientId,
                ClientName = clientName,
                ClosingBalance = bal,
                Total = total,
                Capped = total > shown.Count,
                Entries = shown,
            };
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

                // 2b. Accounting subledger + GL. A receipt allocated to one of
                //     this client's invoices FK-blocks the invoice delete
                //     (FK_PaymentAllocations_Invoices_InvoiceId — the observed
                //     500). Clear those allocations, then the client's own
                //     receipts, the GL journal entries posted from the
                //     invoices/receipts (soft-ref: they don't block but would
                //     leave phantom ledger postings), and the client's
                //     withholding-tax receipts (Client-Restrict FK).
                var clientPaymentIds = await _context.Payments
                    .Where(p => p.ContactType == "Client" && p.ContactId == id)
                    .Select(p => p.Id).ToListAsync();

                if (invoiceIds.Count > 0)
                    await _context.PaymentAllocations
                        .Where(a => a.InvoiceId != null && invoiceIds.Contains(a.InvoiceId.Value))
                        .ExecuteDeleteAsync();
                if (clientPaymentIds.Count > 0)
                {
                    await _context.PaymentAllocations.Where(a => clientPaymentIds.Contains(a.PaymentId)).ExecuteDeleteAsync();
                    await _context.Payments.Where(p => clientPaymentIds.Contains(p.Id)).ExecuteDeleteAsync();
                }

                if (invoiceIds.Count > 0 || clientPaymentIds.Count > 0)
                {
                    var jeIds = await _context.JournalEntries
                        .Where(je =>
                            (je.SourceDocType == MyApp.Api.Models.Accounting.SourceDocType.Invoice && je.SourceDocId != null && invoiceIds.Contains(je.SourceDocId.Value)) ||
                            (je.SourceDocType == MyApp.Api.Models.Accounting.SourceDocType.Payment && je.SourceDocId != null && clientPaymentIds.Contains(je.SourceDocId.Value)))
                        .Select(je => je.Id).ToListAsync();
                    if (jeIds.Count > 0)
                    {
                        await _context.JournalLines.Where(l => jeIds.Contains(l.JournalEntryId)).ExecuteDeleteAsync();
                        await _context.JournalEntries.Where(je => jeIds.Contains(je.Id)).ExecuteDeleteAsync();
                    }
                }

                await _context.WithholdingTaxReceipts.Where(r => r.ClientId == id).ExecuteDeleteAsync();

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

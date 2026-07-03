using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Sales Quote = the priced pre-sale quotation. Totals are always
    /// recomputed server-side from the line items + GST rate. A quote can be
    /// converted into a (quantity-only) Sales Order via
    /// <see cref="ConvertToSalesOrderAsync"/>.
    /// </summary>
    public class SalesQuoteService : ISalesQuoteService
    {
        private readonly ISalesQuoteRepository _repository;
        private readonly ISalesOrderService _salesOrderService;
        private readonly AppDbContext _context;
        private readonly ILogger<SalesQuoteService> _logger;

        public SalesQuoteService(
            ISalesQuoteRepository repository,
            ISalesOrderService salesOrderService,
            AppDbContext context,
            ILogger<SalesQuoteService> logger)
        {
            _repository = repository;
            _salesOrderService = salesOrderService;
            _context = context;
            _logger = logger;
        }

        private static SalesQuoteDto ToDto(SalesQuote q, int maxNumber, bool hasLinkedOrder)
        {
            var accepted = hasLinkedOrder || q.ConvertedToSalesOrderId != null;
            return new SalesQuoteDto
            {
                Id = q.Id,
                QuoteNumber = q.QuoteNumber,
                CompanyId = q.CompanyId,
                ClientId = q.ClientId,
                ClientName = q.Client?.Name ?? "",
                DivisionId = q.DivisionId,
                DivisionName = q.Division?.Name,
                Date = q.Date,
                ValidUntil = q.ValidUntil,
                CustomerEnquiryRef = q.CustomerEnquiryRef,
                EnquiryDate = q.EnquiryDate,
                Notes = q.Notes,
                Subtotal = q.Subtotal,
                GSTRate = q.GSTRate,
                GSTAmount = q.GSTAmount,
                GrandTotal = q.GrandTotal,
                AmountInWords = q.AmountInWords,
                Status = DeriveStatus(q, accepted),
                ConvertedToSalesOrderId = q.ConvertedToSalesOrderId,
                ConvertedToSalesOrderNumber = q.ConvertedToSalesOrder?.SalesOrderNumber,
                IsEditable = !accepted,
                IsLatest = q.QuoteNumber == maxNumber,
                CreatedAt = q.CreatedAt,
                Items = q.Items.Select(i => new SalesQuoteItemDto
                {
                    Id = i.Id,
                    ItemTypeId = i.ItemTypeId,
                    ItemTypeName = i.ItemType?.Name ?? "",
                    Description = i.Description,
                    Quantity = i.Quantity,
                    Unit = i.Unit,
                    UnitPrice = i.UnitPrice,
                    LineTotal = i.LineTotal
                }).ToList()
            };
        }

        // Status is DERIVED, never operator-set: Accepted once a Sales Order
        // references the quote; Expired once past ValidUntil and not accepted;
        // Active otherwise (including no expiry set).
        private static string DeriveStatus(SalesQuote q, bool accepted)
        {
            if (accepted) return "Accepted";
            if (q.ValidUntil.HasValue && q.ValidUntil.Value.Date < DateTime.UtcNow.Date) return "Expired";
            return "Active";
        }

        // Quote IDs (within the set) referenced by any Sales Order — via the
        // convert-to-order flow or an order created selecting the quote.
        private async Task<HashSet<int>> GetLinkedQuoteIdsAsync(int companyId, List<int> quoteIds)
        {
            if (quoteIds.Count == 0) return new HashSet<int>();
            var ids = await _context.SalesOrders
                .Where(so => so.CompanyId == companyId && so.SalesQuoteId != null && quoteIds.Contains(so.SalesQuoteId.Value))
                .Select(so => so.SalesQuoteId!.Value)
                .Distinct()
                .ToListAsync();
            return ids.ToHashSet();
        }

        /// <summary>Recompute line totals + header totals + amount-in-words.</summary>
        private static void ApplyTotals(SalesQuote quote, decimal gstRate)
        {
            quote.GSTRate = gstRate;
            foreach (var it in quote.Items)
                it.LineTotal = Math.Round(it.Quantity * it.UnitPrice, 2);
            quote.Subtotal = quote.Items.Sum(i => i.LineTotal);
            quote.GSTAmount = Math.Round(quote.Subtotal * gstRate / 100m, 2);
            quote.GrandTotal = quote.Subtotal + quote.GSTAmount;
            quote.AmountInWords = NumberToWordsConverter.Convert(quote.GrandTotal);
        }

        // ── Reads ────────────────────────────────────────────────────────────

        public async Task<List<SalesQuoteDto>> GetByCompanyAsync(int companyId)
        {
            var scopeMax = await _repository.GetMaxNumbersByScopeAsync(companyId);
            var quotes = await _repository.GetByCompanyAsync(companyId);
            var linked = await GetLinkedQuoteIdsAsync(companyId, quotes.Select(q => q.Id).ToList());
            return quotes.Select(q => ToDto(q, scopeMax.GetValueOrDefault(q.DivisionId, 0), linked.Contains(q.Id))).ToList();
        }

        public async Task<PagedResult<SalesQuoteDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, string? status = null,
            int? clientId = null, DateTime? dateFrom = null, DateTime? dateTo = null,
            int? divisionId = null)
        {
            var scopeMax = await _repository.GetMaxNumbersByScopeAsync(companyId);
            var (items, totalCount) = await _repository.GetPagedByCompanyAsync(
                companyId, page, pageSize, search, status, clientId, dateFrom, dateTo, divisionId);
            var linked = await GetLinkedQuoteIdsAsync(companyId, items.Select(q => q.Id).ToList());
            return new PagedResult<SalesQuoteDto>
            {
                Items = items.Select(q => ToDto(q, scopeMax.GetValueOrDefault(q.DivisionId, 0), linked.Contains(q.Id))).ToList(),
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize
            };
        }

        public async Task<SalesQuoteDto?> GetByIdAsync(int id)
        {
            var q = await _repository.GetByIdAsync(id);
            if (q == null) return null;
            var max = await _repository.GetMaxNumberAsync(q.CompanyId, q.DivisionId);
            var hasLinkedOrder = await _context.SalesOrders.AnyAsync(so => so.SalesQuoteId == id);
            return ToDto(q, max, hasLinkedOrder);
        }

        public async Task<int> GetCountByCompanyAsync(int companyId)
            => await _repository.GetCountByCompanyAsync(companyId);

        // ── Create ───────────────────────────────────────────────────────────

        public async Task<SalesQuoteDto> CreateAsync(int companyId, SalesQuoteDto dto)
        {
            Validate(dto);
            var company = await _context.Companies.FindAsync(companyId)
                ?? throw new KeyNotFoundException("Company not found.");
            var client = await _context.Clients.FindAsync(dto.ClientId)
                ?? throw new KeyNotFoundException("Client not found.");
            if (client.CompanyId != companyId)
                throw new InvalidOperationException("Client does not belong to this company.");
            // Load the division (tracked) when the quote is tagged with one — this
            // both validates it belongs to this company AND lets us advance the
            // division's own CurrentSalesQuoteNumber below.
            Division? division = null;
            if (dto.DivisionId.HasValue)
            {
                division = await _context.Divisions
                    .FirstOrDefaultAsync(d => d.Id == dto.DivisionId.Value && d.CompanyId == companyId);
                if (division == null)
                    throw new InvalidOperationException("Division does not belong to this company.");
            }

            await UnitRegistry.EnsureNamesAsync(_context, dto.Items.Select(i => i.Unit));

            var createdId = await NumberAllocationRetry.ExecuteAsync(async _ =>
            {
                // Division-scoped numbering: a division-tagged quote draws from the
                // division's own sequence (seeded by its StartingSalesQuoteNumber);
                // a company-level quote uses the company's. The unique index is
                // (CompanyId, DivisionId, QuoteNumber) so the two never collide.
                var max = await _repository.GetMaxNumberAsync(companyId, dto.DivisionId);
                var seed = division != null
                    ? (division.StartingSalesQuoteNumber > 0 ? division.StartingSalesQuoteNumber : 1)
                    : (company.StartingSalesQuoteNumber > 0 ? company.StartingSalesQuoteNumber : 1);
                var next = max > 0 ? max + 1 : seed;

                var quote = new SalesQuote
                {
                    CompanyId = companyId,
                    QuoteNumber = next,
                    ClientId = dto.ClientId,
                    DivisionId = dto.DivisionId,
                    Date = dto.Date == default ? DateTime.UtcNow.Date : dto.Date,
                    ValidUntil = dto.ValidUntil,
                    CustomerEnquiryRef = string.IsNullOrWhiteSpace(dto.CustomerEnquiryRef) ? null : dto.CustomerEnquiryRef.Trim(),
                    EnquiryDate = dto.EnquiryDate,
                    Notes = string.IsNullOrWhiteSpace(dto.Notes) ? null : dto.Notes.Trim(),
                    Status = "Draft",
                    Items = dto.Items.Select(i => new SalesQuoteItem
                    {
                        ItemTypeId = i.ItemTypeId,
                        Description = i.Description.Trim(),
                        Quantity = i.Quantity,
                        Unit = i.Unit,
                        UnitPrice = i.UnitPrice
                    }).ToList()
                };
                ApplyTotals(quote, dto.GSTRate);
                if (division != null) division.CurrentSalesQuoteNumber = next;
                else company.CurrentSalesQuoteNumber = next;
                _context.SalesQuotes.Add(quote);
                try
                {
                    await _context.SaveChangesAsync();
                }
                catch (DbUpdateException)
                {
                    _context.Entry(quote).State = EntityState.Detached;
                    foreach (var it in quote.Items) _context.Entry(it).State = EntityState.Detached;
                    throw;
                }
                return quote.Id;
            });

            return (await GetByIdAsync(createdId))!;
        }

        // ── Update ───────────────────────────────────────────────────────────

        public async Task<SalesQuoteDto?> UpdateAsync(int id, SalesQuoteDto dto)
        {
            var quote = await _repository.GetByIdAsync(id);
            if (quote == null) return null;
            if (quote.ConvertedToSalesOrderId != null || await _context.SalesOrders.AnyAsync(so => so.SalesQuoteId == id))
                throw new InvalidOperationException("A quote linked to a sales order can no longer be edited.");
            Validate(dto);

            if (dto.ClientId > 0 && dto.ClientId != quote.ClientId)
            {
                var newClient = await _context.Clients.FindAsync(dto.ClientId)
                    ?? throw new InvalidOperationException("Client not found.");
                if (newClient.CompanyId != quote.CompanyId)
                    throw new InvalidOperationException("Client does not belong to this company.");
                quote.ClientId = dto.ClientId;
            }
            if (dto.DivisionId.HasValue && !await _context.Divisions.AnyAsync(d => d.Id == dto.DivisionId.Value && d.CompanyId == quote.CompanyId))
                throw new InvalidOperationException("Division does not belong to this company.");
            quote.DivisionId = dto.DivisionId;

            quote.Date = dto.Date == default ? quote.Date : dto.Date;
            quote.ValidUntil = dto.ValidUntil;
            quote.CustomerEnquiryRef = string.IsNullOrWhiteSpace(dto.CustomerEnquiryRef) ? null : dto.CustomerEnquiryRef.Trim();
            quote.EnquiryDate = dto.EnquiryDate;
            quote.Notes = string.IsNullOrWhiteSpace(dto.Notes) ? null : dto.Notes.Trim();

            await UnitRegistry.EnsureNamesAsync(_context, dto.Items.Select(i => i.Unit));

            // Full replace of items — quotes have no downstream links so a
            // straight rebuild is safe (unlike challans, which sync a bill).
            var keptIds = dto.Items.Where(i => i.Id > 0).Select(i => i.Id).ToHashSet();
            foreach (var rem in quote.Items.Where(i => !keptIds.Contains(i.Id)).ToList())
            {
                quote.Items.Remove(rem);
                _context.SalesQuoteItems.Remove(rem);
            }
            foreach (var itemDto in dto.Items)
            {
                var existing = itemDto.Id > 0 ? quote.Items.FirstOrDefault(i => i.Id == itemDto.Id) : null;
                if (existing != null)
                {
                    existing.ItemTypeId = itemDto.ItemTypeId;
                    existing.Description = itemDto.Description.Trim();
                    existing.Quantity = itemDto.Quantity;
                    existing.Unit = itemDto.Unit;
                    existing.UnitPrice = itemDto.UnitPrice;
                }
                else
                {
                    quote.Items.Add(new SalesQuoteItem
                    {
                        SalesQuoteId = quote.Id,
                        ItemTypeId = itemDto.ItemTypeId,
                        Description = itemDto.Description.Trim(),
                        Quantity = itemDto.Quantity,
                        Unit = itemDto.Unit,
                        UnitPrice = itemDto.UnitPrice
                    });
                }
            }

            ApplyTotals(quote, dto.GSTRate);
            await _repository.UpdateAsync(quote);
            return await GetByIdAsync(id);
        }

        public async Task<bool> SetStatusAsync(int id, string status)
        {
            var allowed = new[] { "Draft", "Sent", "Accepted", "Rejected", "Expired" };
            if (!allowed.Contains(status))
                throw new InvalidOperationException("Invalid status. Allowed: Draft, Sent, Accepted, Rejected, Expired.");
            var quote = await _repository.GetByIdAsync(id);
            if (quote == null) return false;
            if (quote.Status == "Converted")
                throw new InvalidOperationException("A converted quote's status cannot be changed.");
            quote.Status = status;
            await _repository.UpdateAsync(quote);
            return true;
        }

        public async Task<bool> DeleteAsync(int id)
        {
            var quote = await _repository.GetByIdAsync(id);
            if (quote == null) return false;

            // Break the quote <-> order cross-links before deleting. Both FKs are
            // NoAction (see AppDbContext), so any Sales Order pointing at this
            // quote must have its SalesQuoteId cleared in app code first. The
            // order itself SURVIVES — it just loses its quote reference (shows no
            // quote number, and the operator can re-select a quote on the order).
            // The quote's own ConvertedToSalesOrderId pointer goes away with the
            // row. Quotes are pre-sale, non-FBR documents, so deleting one (even a
            // converted, non-latest quote) is allowed and a numbering gap is
            // acceptable here — unlike bills/invoices.
            var linkedOrders = await _context.SalesOrders.Where(so => so.SalesQuoteId == id).ToListAsync();
            foreach (var so in linkedOrders) so.SalesQuoteId = null;
            if (linkedOrders.Count > 0) await _context.SaveChangesAsync();

            await _repository.DeleteAsync(quote);
            return true;
        }

        // ── Convert to Sales Order ───────────────────────────────────────────

        public async Task<SalesOrderDto> ConvertToSalesOrderAsync(int id)
        {
            var quote = await _repository.GetByIdAsync(id);
            if (quote == null) throw new KeyNotFoundException("Quote not found.");
            if (quote.ConvertedToSalesOrderId != null || await _context.SalesOrders.AnyAsync(so => so.SalesQuoteId == id))
                throw new InvalidOperationException("This quote is already linked to a sales order.");

            var orderDto = new SalesOrderDto
            {
                ClientId = quote.ClientId,
                // The order stays in the quote's division — it numbers from
                // that division's sequence and prints with its branding.
                DivisionId = quote.DivisionId,
                OrderDate = DateTime.UtcNow.Date,
                Notes = $"Converted from Quote #{quote.QuoteNumber}",
                SalesQuoteId = quote.Id,
                Items = quote.Items.Select(i => new SalesOrderItemDto
                {
                    ItemTypeId = i.ItemTypeId,
                    Description = i.Description,
                    Quantity = i.Quantity,
                    Unit = i.Unit
                }).ToList()
            };

            // Shares the same scoped DbContext, so the order is persisted before
            // we flip the quote's pointer below.
            var order = await _salesOrderService.CreateAsync(quote.CompanyId, orderDto);

            quote.ConvertedToSalesOrderId = order.Id;
            quote.Status = "Converted";
            await _repository.UpdateAsync(quote);

            return order;
        }

        // ── Print ────────────────────────────────────────────────────────────

        public async Task<PrintQuoteDto?> GetPrintDataAsync(int id)
        {
            var q = await _repository.GetByIdAsync(id);
            if (q == null) return null;
            var company = q.Company;
            var client = q.Client;
            var sNo = 0;
            return new PrintQuoteDto
            {
                CompanyBrandName = company?.BrandName ?? company?.Name ?? "",
                CompanyLogoPath = company?.LogoPath,
                CompanyAddress = company?.FullAddress,
                CompanyPhone = company?.Phone,
                CompanyNTN = company?.NTN,
                CompanySTRN = company?.STRN,
                // Division ("sub-company") branding — null for company-level quotes.
                DivisionName = q.Division?.Name,
                DivisionBrandName = q.Division?.BrandName,
                DivisionLogoPath = q.Division?.LogoPath,
                DivisionAddress = q.Division?.FullAddress,
                DivisionPhone = q.Division?.Phone,
                DivisionNTN = q.Division?.NTN,
                DivisionSTRN = q.Division?.STRN,
                DivisionEmail = q.Division?.Email,
                QuoteNumber = q.QuoteNumber,
                Date = q.Date,
                ValidUntil = q.ValidUntil,
                CustomerEnquiryRef = q.CustomerEnquiryRef,
                EnquiryDate = q.EnquiryDate,
                ClientName = client?.Name ?? "",
                ClientAddress = client?.Address,
                ClientNTN = client?.NTN,
                ClientSTRN = client?.STRN,
                Subtotal = q.Subtotal,
                GSTRate = q.GSTRate,
                GSTAmount = q.GSTAmount,
                GrandTotal = q.GrandTotal,
                AmountInWords = q.AmountInWords,
                Notes = q.Notes,
                Items = q.Items.Select(i => new PrintQuoteItemDto
                {
                    SNo = ++sNo,
                    ItemTypeName = i.ItemType?.Name ?? "",
                    Description = i.Description,
                    Quantity = i.Quantity,
                    Uom = i.Unit,
                    UnitPrice = i.UnitPrice,
                    LineTotal = i.LineTotal
                }).ToList()
            };
        }

        // ── Item price auto-fill ─────────────────────────────────────────────

        public async Task<QuoteItemRateDto> GetItemRateAsync(int companyId, string? description, int? itemTypeId)
        {
            var baseQuery = _context.InvoiceItems
                .Where(ii => ii.Invoice.CompanyId == companyId && !ii.Invoice.IsDemo && ii.UnitPrice > 0);

            // Prefer a catalog (ItemType) match — most reliable. "Last" =
            // most recent by bill date (Id breaks ties) — InvoiceNumber is
            // not chronological across per-division sequences.
            if (itemTypeId.HasValue && itemTypeId.Value > 0)
            {
                var byType = await baseQuery
                    .Where(ii => ii.ItemTypeId == itemTypeId.Value)
                    .OrderByDescending(ii => ii.Invoice.Date).ThenByDescending(ii => ii.Id)
                    .Select(ii => new { ii.UnitPrice, ii.Invoice.InvoiceNumber, ii.Invoice.Date, ClientName = ii.Invoice.Client.Name })
                    .FirstOrDefaultAsync();
                if (byType != null)
                    return new QuoteItemRateDto
                    {
                        LastUnitPrice = byType.UnitPrice,
                        LastInvoiceNumber = byType.InvoiceNumber,
                        LastInvoiceDate = byType.Date,
                        LastClientName = byType.ClientName,
                        MatchedBy = "ItemType"
                    };
            }

            // Fall back to an exact (case-insensitive) description match.
            if (!string.IsNullOrWhiteSpace(description))
            {
                var d = description.Trim().ToLower();
                var byDesc = await baseQuery
                    .Where(ii => ii.Description.ToLower() == d)
                    .OrderByDescending(ii => ii.Invoice.Date).ThenByDescending(ii => ii.Id)
                    .Select(ii => new { ii.UnitPrice, ii.Invoice.InvoiceNumber, ii.Invoice.Date, ClientName = ii.Invoice.Client.Name })
                    .FirstOrDefaultAsync();
                if (byDesc != null)
                    return new QuoteItemRateDto
                    {
                        LastUnitPrice = byDesc.UnitPrice,
                        LastInvoiceNumber = byDesc.InvoiceNumber,
                        LastInvoiceDate = byDesc.Date,
                        LastClientName = byDesc.ClientName,
                        MatchedBy = "Description"
                    };
            }

            return new QuoteItemRateDto { MatchedBy = null };
        }

        private static void Validate(SalesQuoteDto dto)
        {
            if (dto.ClientId <= 0)
                throw new InvalidOperationException("A client is required.");
            if (dto.GSTRate < 0 || dto.GSTRate > 100)
                throw new InvalidOperationException("GST rate must be between 0 and 100.");
            if (dto.Items == null || dto.Items.Count == 0)
                throw new InvalidOperationException("At least one item is required.");
            if (dto.Items.Any(i => string.IsNullOrWhiteSpace(i.Description)))
                throw new InvalidOperationException("Item descriptions cannot be empty.");
            if (dto.Items.Any(i => i.Quantity <= 0))
                throw new InvalidOperationException("Item quantity must be greater than zero.");
            if (dto.Items.Any(i => i.UnitPrice < 0))
                throw new InvalidOperationException("Unit price cannot be negative.");
        }
    }
}

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
    /// Sales Order = the quantity-only confirmed order. Delivered quantities
    /// are computed from the linked delivery-challan lines (never stored), so
    /// fulfilment can't drift. A challan is created from an order via
    /// <see cref="CreateChallanFromOrderAsync"/>, which links each challan line
    /// back to its ordered line. SalesOrderNumber is unique per company.
    /// </summary>
    public class SalesOrderService : ISalesOrderService
    {
        private readonly ISalesOrderRepository _repository;
        private readonly IDeliveryChallanService _challanService;
        private readonly AppDbContext _context;
        private readonly ILogger<SalesOrderService> _logger;

        public SalesOrderService(
            ISalesOrderRepository repository,
            IDeliveryChallanService challanService,
            AppDbContext context,
            ILogger<SalesOrderService> logger)
        {
            _repository = repository;
            _challanService = challanService;
            _context = context;
            _logger = logger;
        }

        // ── Fulfilment mapping ───────────────────────────────────────────────

        /// <summary>
        /// Map a batch of orders to DTOs, computing delivered/remaining per line
        /// in TWO queries total (no N+1): one grouped sum of challan-line
        /// quantities, one grouped count of challans. Cancelled challans never
        /// count as delivered.
        /// </summary>
        private async Task<List<SalesOrderDto>> MapManyAsync(List<SalesOrder> orders)
        {
            if (orders.Count == 0) return new();

            var orderIds = orders.Select(o => o.Id).ToList();
            var soItemIds = orders.SelectMany(o => o.Items.Select(i => i.Id)).ToList();

            // Delivered qty per Sales Order line.
            var deliveredByItem = soItemIds.Count == 0
                ? new Dictionary<int, decimal>()
                : await _context.DeliveryItems
                    .Where(di => di.SalesOrderItemId != null
                              && soItemIds.Contains(di.SalesOrderItemId.Value)
                              && di.DeliveryChallan.Status != "Cancelled")
                    .GroupBy(di => di.SalesOrderItemId!.Value)
                    .Select(g => new { Key = g.Key, Qty = g.Sum(x => x.Quantity) })
                    .ToDictionaryAsync(x => x.Key, x => x.Qty);

            // Challan stats per order (excluding cancelled): total raised + how
            // many are billable now. Only "Pending"/"Imported" challans can go
            // on a bill (InvoiceService rejects "No PO"/"Setup Required"), so the
            // billable count — not the raw unbilled count — gates "Generate Bill".
            var challanStatsList = await _context.DeliveryChallans
                .Where(dc => dc.SalesOrderId != null
                          && orderIds.Contains(dc.SalesOrderId.Value)
                          && dc.Status != "Cancelled")
                .GroupBy(dc => dc.SalesOrderId!.Value)
                .Select(g => new
                {
                    Key = g.Key,
                    Count = g.Count(),
                    Billable = g.Count(x => x.Status == "Pending" || x.Status == "Imported"),
                    Billed = g.Count(x => x.InvoiceId != null)
                })
                .ToListAsync();
            var challanStatsByOrder = challanStatsList.ToDictionary(x => x.Key, x => (x.Count, x.Billable, x.Billed));

            // Latest order number for the company (gates Delete in the UI).
            var companyId = orders[0].CompanyId;
            var maxNumber = await _repository.GetMaxNumberAsync(companyId);

            return orders.Select(o =>
            {
                var stats = challanStatsByOrder.GetValueOrDefault(o.Id);
                return ToDto(o, deliveredByItem, stats.Count, stats.Billable, stats.Billed, maxNumber);
            }).ToList();
        }

        private async Task<SalesOrderDto?> MapOneAsync(SalesOrder? order)
        {
            if (order == null) return null;
            var list = await MapManyAsync(new List<SalesOrder> { order });
            return list.FirstOrDefault();
        }

        private static SalesOrderDto ToDto(
            SalesOrder o,
            IReadOnlyDictionary<int, decimal> deliveredByItem,
            int challanCount,
            int billableChallanCount,
            int billedChallanCount,
            int maxNumber)
        {
            var items = o.Items.Select(i =>
            {
                var delivered = deliveredByItem.GetValueOrDefault(i.Id, 0m);
                var remaining = i.Quantity - delivered;
                if (remaining < 0) remaining = 0;
                return new SalesOrderItemDto
                {
                    Id = i.Id,
                    ItemTypeId = i.ItemTypeId,
                    ItemTypeName = i.ItemType?.Name ?? "",
                    Description = i.Description,
                    Quantity = i.Quantity,
                    Unit = i.Unit,
                    DeliveredQuantity = delivered,
                    RemainingQuantity = remaining,
                    LineStatus = LineStatusFor(i.Quantity, delivered)
                };
            }).ToList();

            return new SalesOrderDto
            {
                Id = o.Id,
                SalesOrderNumber = o.SalesOrderNumber,
                CompanyId = o.CompanyId,
                ClientId = o.ClientId,
                ClientName = o.Client?.Name ?? "",
                OrderDate = o.OrderDate,
                RequiredDate = o.RequiredDate,
                CustomerPoNumber = o.CustomerPoNumber,
                CustomerPoDate = o.CustomerPoDate,
                Site = o.Site,
                Notes = o.Notes,
                Status = o.Status,
                FulfillmentStatus = FulfillmentStatusFor(items),
                InvoiceStatus = InvoiceStatusFor(challanCount, billedChallanCount),
                SalesQuoteId = o.SalesQuoteId,
                SalesQuoteNumber = o.SalesQuote?.QuoteNumber,
                IsImported = o.IsImported,
                // Editable until it's been billed. Delivered lines are still
                // protected line-by-line in UpdateAsync (can't drop below
                // delivered qty / can't remove a delivered line).
                IsEditable = o.Status != "Cancelled" && billedChallanCount == 0,
                IsLatest = o.SalesOrderNumber == maxNumber,
                ChallanCount = challanCount,
                BillableChallanCount = billableChallanCount,
                CreatedAt = o.CreatedAt,
                Items = items
            };
        }

        private static string LineStatusFor(decimal ordered, decimal delivered)
        {
            if (delivered <= 0) return "Pending";
            if (delivered < ordered) return "Partial";
            if (delivered == ordered) return "Complete";
            return "Over";
        }

        private static string FulfillmentStatusFor(List<SalesOrderItemDto> items)
        {
            if (items.Count == 0 || items.All(i => i.DeliveredQuantity == 0)) return "Not Delivered";
            if (items.Any(i => i.DeliveredQuantity > i.Quantity)) return "Over Delivered";
            if (items.All(i => i.DeliveredQuantity >= i.Quantity)) return "Fully Delivered";
            return "Partially Delivered";
        }

        // Billing roll-up over the order's non-cancelled challans.
        private static string InvoiceStatusFor(int challanCount, int billedChallanCount)
        {
            if (challanCount == 0 || billedChallanCount == 0) return "Uninvoiced";
            if (billedChallanCount >= challanCount) return "Invoiced";
            return "Partially Invoiced";
        }

        // ── Reads ────────────────────────────────────────────────────────────

        public async Task<List<SalesOrderDto>> GetByCompanyAsync(int companyId)
            => await MapManyAsync(await _repository.GetByCompanyAsync(companyId));

        public async Task<List<SalesOrderDto>> GetOpenByCompanyAsync(int companyId)
        {
            var mapped = await MapManyAsync(await _repository.GetOpenByCompanyAsync(companyId));
            // Only orders that still have something to deliver are useful in the
            // "create challan" picker.
            return mapped.Where(o => o.FulfillmentStatus != "Fully Delivered"
                                  && o.FulfillmentStatus != "Over Delivered").ToList();
        }

        public async Task<PagedResult<SalesOrderDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, string? status = null,
            int? clientId = null, DateTime? dateFrom = null, DateTime? dateTo = null)
        {
            var (items, totalCount) = await _repository.GetPagedByCompanyAsync(
                companyId, page, pageSize, search, status, clientId, dateFrom, dateTo);
            return new PagedResult<SalesOrderDto>
            {
                Items = await MapManyAsync(items),
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize
            };
        }

        public async Task<SalesOrderDto?> GetByIdAsync(int id)
            => await MapOneAsync(await _repository.GetByIdAsync(id));

        public async Task<int> GetCountByCompanyAsync(int companyId)
            => await _repository.GetCountByCompanyAsync(companyId);

        // ── Create ───────────────────────────────────────────────────────────

        public async Task<SalesOrderDto> CreateAsync(int companyId, SalesOrderDto dto)
        {
            if (dto.ClientId <= 0)
                throw new InvalidOperationException("A client is required.");
            if (dto.Items == null || dto.Items.Count == 0)
                throw new InvalidOperationException("At least one item is required.");
            if (dto.Items.Any(i => string.IsNullOrWhiteSpace(i.Description)))
                throw new InvalidOperationException("Item descriptions cannot be empty.");
            if (dto.Items.Any(i => i.Quantity <= 0))
                throw new InvalidOperationException("Item quantity must be greater than zero.");

            var company = await _context.Companies.FindAsync(companyId)
                ?? throw new KeyNotFoundException("Company not found.");
            var client = await _context.Clients.FindAsync(dto.ClientId)
                ?? throw new KeyNotFoundException("Client not found.");
            if (client.CompanyId != companyId)
                throw new InvalidOperationException("Client does not belong to this company.");

            // Cross-tenant guard: a linked Sales Quote must belong to the SAME
            // company — never trust dto.SalesQuoteId from the body.
            if (dto.SalesQuoteId.HasValue)
            {
                var quoteOk = await _context.SalesQuotes.AnyAsync(
                    q => q.Id == dto.SalesQuoteId.Value && q.CompanyId == companyId);
                if (!quoteOk)
                    throw new InvalidOperationException("The linked sales quote was not found for this company.");
            }

            await UnitRegistry.EnsureNamesAsync(_context, dto.Items.Select(i => i.Unit));

            var createdId = await NumberAllocationRetry.ExecuteAsync(async _ =>
            {
                // Company-scoped numbering. The unique index (CompanyId,
                // SalesOrderNumber) guards the concurrent-create race.
                var max = await _repository.GetMaxNumberAsync(companyId);
                var seed = company.StartingSalesOrderNumber > 0 ? company.StartingSalesOrderNumber : 1;
                var next = max > 0 ? max + 1 : seed;

                var order = new SalesOrder
                {
                    CompanyId = companyId,
                    SalesOrderNumber = next,
                    ClientId = dto.ClientId,
                    OrderDate = dto.OrderDate == default ? DateTime.UtcNow.Date : dto.OrderDate,
                    RequiredDate = dto.RequiredDate,
                    CustomerPoNumber = string.IsNullOrWhiteSpace(dto.CustomerPoNumber) ? null : dto.CustomerPoNumber.Trim(),
                    CustomerPoDate = dto.CustomerPoDate,
                    Site = string.IsNullOrWhiteSpace(dto.Site) ? null : dto.Site.Trim(),
                    Notes = string.IsNullOrWhiteSpace(dto.Notes) ? null : dto.Notes.Trim(),
                    Status = "Open",
                    SalesQuoteId = dto.SalesQuoteId,
                    IsImported = dto.IsImported,
                    Items = dto.Items.Select(i => new SalesOrderItem
                    {
                        ItemTypeId = i.ItemTypeId,
                        Description = i.Description.Trim(),
                        Quantity = i.Quantity,
                        Unit = i.Unit
                    }).ToList()
                };
                company.CurrentSalesOrderNumber = next;
                _context.SalesOrders.Add(order);
                try
                {
                    await _context.SaveChangesAsync();
                }
                catch (DbUpdateException)
                {
                    _context.Entry(order).State = EntityState.Detached;
                    foreach (var it in order.Items) _context.Entry(it).State = EntityState.Detached;
                    throw;
                }
                return order.Id;
            });

            // Remember the line descriptions in the generic item catalog so they
            // become reusable suggestions on future documents (best-effort).
            await RememberDescriptionsAsync(dto.Items.Select(i => i.Description));

            return (await MapOneAsync(await _repository.GetByIdAsync(createdId)))!;
        }

        // ── Update ───────────────────────────────────────────────────────────

        public async Task<SalesOrderDto?> UpdateAsync(int id, SalesOrderDto dto)
        {
            var order = await _repository.GetByIdAsync(id);
            if (order == null) return null;
            if (order.Status == "Cancelled")
                throw new InvalidOperationException("A cancelled order cannot be edited.");
            // Locked once any challan has been billed — the bill already
            // captured these lines, so the order can no longer change.
            if (await _context.DeliveryChallans.AnyAsync(dc => dc.SalesOrderId == id && dc.InvoiceId != null))
                throw new InvalidOperationException("This order has been billed and can no longer be edited.");

            if (dto.Items == null || dto.Items.Count == 0)
                throw new InvalidOperationException("At least one item is required.");
            if (dto.Items.Any(i => string.IsNullOrWhiteSpace(i.Description)))
                throw new InvalidOperationException("Item descriptions cannot be empty.");
            if (dto.Items.Any(i => i.Quantity <= 0))
                throw new InvalidOperationException("Item quantity must be greater than zero.");

            await UnitRegistry.EnsureNamesAsync(_context, dto.Items.Select(i => i.Unit));

            // Delivered quantity per existing line — used to guard edits.
            var soItemIds = order.Items.Select(i => i.Id).ToList();
            var deliveredByItem = soItemIds.Count == 0
                ? new Dictionary<int, decimal>()
                : await _context.DeliveryItems
                    .Where(di => di.SalesOrderItemId != null
                              && soItemIds.Contains(di.SalesOrderItemId.Value)
                              && di.DeliveryChallan.Status != "Cancelled")
                    .GroupBy(di => di.SalesOrderItemId!.Value)
                    .Select(g => new { Key = g.Key, Qty = g.Sum(x => x.Quantity) })
                    .ToDictionaryAsync(x => x.Key, x => x.Qty);

            // Client change only allowed before anything is delivered.
            if (dto.ClientId > 0 && dto.ClientId != order.ClientId)
            {
                if (deliveredByItem.Values.Any(q => q > 0))
                    throw new InvalidOperationException("Cannot change the customer once items have been delivered.");
                var newClient = await _context.Clients.FindAsync(dto.ClientId)
                    ?? throw new InvalidOperationException("Client not found.");
                if (newClient.CompanyId != order.CompanyId)
                    throw new InvalidOperationException("Client does not belong to this company.");
                order.ClientId = dto.ClientId;
            }

            order.OrderDate = dto.OrderDate == default ? order.OrderDate : dto.OrderDate;
            order.RequiredDate = dto.RequiredDate;
            order.CustomerPoNumber = string.IsNullOrWhiteSpace(dto.CustomerPoNumber) ? null : dto.CustomerPoNumber.Trim();
            order.CustomerPoDate = dto.CustomerPoDate;
            order.Site = string.IsNullOrWhiteSpace(dto.Site) ? null : dto.Site.Trim();
            order.Notes = string.IsNullOrWhiteSpace(dto.Notes) ? null : dto.Notes.Trim();
            // Reference link to a Sales Quote (set/cleared from the form).
            // Cross-tenant guard: only accept a quote from this company.
            if (dto.SalesQuoteId.HasValue)
            {
                var quoteOk = await _context.SalesQuotes.AnyAsync(
                    q => q.Id == dto.SalesQuoteId.Value && q.CompanyId == order.CompanyId);
                if (!quoteOk)
                    throw new InvalidOperationException("The linked sales quote was not found for this company.");
            }
            order.SalesQuoteId = dto.SalesQuoteId;

            // ── Items diff with delivery guards ──
            var keptIds = dto.Items.Where(i => i.Id > 0).Select(i => i.Id).ToHashSet();
            var toRemove = order.Items.Where(i => !keptIds.Contains(i.Id)).ToList();
            foreach (var rem in toRemove)
            {
                if (deliveredByItem.GetValueOrDefault(rem.Id, 0m) > 0)
                    throw new InvalidOperationException(
                        $"Cannot remove \"{rem.Description}\" — it already has deliveries against it.");
            }

            foreach (var itemDto in dto.Items)
            {
                var existing = itemDto.Id > 0 ? order.Items.FirstOrDefault(i => i.Id == itemDto.Id) : null;
                if (existing != null)
                {
                    var delivered = deliveredByItem.GetValueOrDefault(existing.Id, 0m);
                    if (itemDto.Quantity < delivered)
                        throw new InvalidOperationException(
                            $"Cannot reduce \"{existing.Description}\" below the {delivered} already delivered.");
                    existing.ItemTypeId = itemDto.ItemTypeId;
                    existing.Description = itemDto.Description.Trim();
                    existing.Quantity = itemDto.Quantity;
                    existing.Unit = itemDto.Unit;
                }
                else
                {
                    order.Items.Add(new SalesOrderItem
                    {
                        SalesOrderId = order.Id,
                        ItemTypeId = itemDto.ItemTypeId,
                        Description = itemDto.Description.Trim(),
                        Quantity = itemDto.Quantity,
                        Unit = itemDto.Unit
                    });
                }
            }
            foreach (var rem in toRemove)
            {
                order.Items.Remove(rem);
                _context.SalesOrderItems.Remove(rem);
            }

            await _repository.UpdateAsync(order);
            // The order's PO number/date is authoritative for the whole chain:
            // push it down to every linked (unbilled) challan.
            await PropagatePoToChallansAsync(order.Id, order.CustomerPoNumber, order.CustomerPoDate);
            await RememberDescriptionsAsync(dto.Items.Select(i => i.Description));
            return await MapOneAsync(await _repository.GetByIdAsync(id));
        }

        // The Sales Order's PO number/date flows to every delivery challan
        // raised against it. New challans inherit it at creation
        // (CreateChallanFromOrderAsync); this keeps existing, not-yet-billed
        // challans in sync when the operator sets or changes the order's PO.
        // Setting a PO on a "No PO" (FBR-ready, PO-less) challan makes it
        // billable → flip to "Pending"; clearing it reverts the other way.
        private async Task PropagatePoToChallansAsync(int salesOrderId, string? poNumber, DateTime? poDate)
        {
            var challans = await _context.DeliveryChallans
                .Where(dc => dc.SalesOrderId == salesOrderId && dc.InvoiceId == null && dc.Status != "Cancelled")
                .ToListAsync();
            if (challans.Count == 0) return;

            var po = string.IsNullOrWhiteSpace(poNumber) ? "" : poNumber.Trim();
            var effectiveDate = string.IsNullOrEmpty(po) ? null : poDate;
            var changed = false;
            foreach (var dc in challans)
            {
                if (dc.PoNumber == po && dc.PoDate == effectiveDate) continue;
                dc.PoNumber = po;
                dc.PoDate = effectiveDate;
                if (!string.IsNullOrEmpty(po) && dc.Status == "No PO") dc.Status = "Pending";
                else if (string.IsNullOrEmpty(po) && dc.Status == "Pending") dc.Status = "No PO";
                changed = true;
            }
            if (changed) await _context.SaveChangesAsync();
        }

        // ── Status / delete ────────────────────────────────────────────────

        public async Task<bool> SetStatusAsync(int id, string status)
        {
            var allowed = new[] { "Open", "Closed", "Cancelled" };
            if (!allowed.Contains(status))
                throw new InvalidOperationException("Invalid status. Allowed: Open, Closed, Cancelled.");
            var order = await _repository.GetByIdAsync(id);
            if (order == null) return false;
            if (status == "Cancelled" && await _repository.HasChallansAsync(id))
                throw new InvalidOperationException("Cannot cancel an order that already has delivery challans.");
            order.Status = status;
            await _repository.UpdateAsync(order);
            return true;
        }

        public async Task<bool> DeleteAsync(int id)
        {
            var order = await _repository.GetByIdAsync(id);
            if (order == null) return false;
            if (await _repository.HasChallansAsync(id))
                throw new InvalidOperationException("Cannot delete an order that has delivery challans. Delete the challans first.");

            var maxNumber = await _repository.GetMaxNumberAsync(order.CompanyId);
            if (order.SalesOrderNumber != maxNumber)
                throw new InvalidOperationException(
                    $"Only the latest order (#{maxNumber}) can be deleted, to keep numbering gap-free. Edit earlier orders instead.");

            // If a quote was converted into this order, release the quote's
            // pointer (NoAction FK) and revert it to "Accepted" so it isn't
            // orphaned in a "Converted" state.
            var sourceQuote = await _context.SalesQuotes
                .FirstOrDefaultAsync(q => q.ConvertedToSalesOrderId == order.Id);
            if (sourceQuote != null)
            {
                sourceQuote.ConvertedToSalesOrderId = null;
                if (sourceQuote.Status == "Converted") sourceQuote.Status = "Accepted";
                await _context.SaveChangesAsync();
            }

            await _repository.DeleteAsync(order);
            return true;
        }

        // ── Create Delivery Challan from this order ──────────────────────────

        public async Task<DeliveryChallanDto> CreateChallanFromOrderAsync(int id, CreateChallanFromOrderDto dto)
        {
            var order = await _repository.GetByIdAsync(id);
            if (order == null) throw new KeyNotFoundException("Sales order not found.");
            if (order.Status == "Cancelled")
                throw new InvalidOperationException("Cannot create a challan for a cancelled order.");

            // Remaining qty per line.
            var soItemIds = order.Items.Select(i => i.Id).ToList();
            var deliveredByItem = await _context.DeliveryItems
                .Where(di => di.SalesOrderItemId != null
                          && soItemIds.Contains(di.SalesOrderItemId.Value)
                          && di.DeliveryChallan.Status != "Cancelled")
                .GroupBy(di => di.SalesOrderItemId!.Value)
                .Select(g => new { Key = g.Key, Qty = g.Sum(x => x.Quantity) })
                .ToDictionaryAsync(x => x.Key, x => x.Qty);

            // Decide what to deliver on THIS challan — keep the whole line so a
            // per-line item-type override picked at delivery time is honoured.
            var requested = (dto.Lines ?? new List<DeliverLineDto>())
                .Where(l => l.Quantity > 0)
                .ToDictionary(l => l.SalesOrderItemId, l => l);

            var challanItems = new List<DeliveryItemDto>();
            foreach (var soItem in order.Items)
            {
                decimal qty;
                DeliverLineDto? reqLine = null;
                if (requested.Count > 0)
                {
                    if (!requested.TryGetValue(soItem.Id, out reqLine) || reqLine.Quantity <= 0) continue; // line not on this challan
                    qty = reqLine.Quantity;
                }
                else
                {
                    var delivered = deliveredByItem.GetValueOrDefault(soItem.Id, 0m);
                    qty = soItem.Quantity - delivered;          // remaining
                    if (qty <= 0) continue;                      // already fulfilled
                }

                // Item type: an override the operator picked at delivery time
                // wins over the (possibly un-classified) sales-order line.
                var itemTypeId = (reqLine != null && reqLine.ItemTypeId.HasValue)
                    ? reqLine.ItemTypeId
                    : soItem.ItemTypeId;

                challanItems.Add(new DeliveryItemDto
                {
                    ItemTypeId = itemTypeId,
                    Description = soItem.Description,
                    Quantity = qty,
                    Unit = soItem.Unit,
                    SalesOrderItemId = soItem.Id
                });
            }

            if (challanItems.Count == 0)
                throw new InvalidOperationException("Nothing left to deliver on this order (or no quantities specified).");

            var challanDto = new DeliveryChallanDto
            {
                ClientId = order.ClientId,
                DeliveryDate = dto.DeliveryDate ?? DateTime.UtcNow.Date,
                Site = string.IsNullOrWhiteSpace(dto.Site) ? order.Site : dto.Site,
                PoNumber = order.CustomerPoNumber ?? "",
                PoDate = order.CustomerPoDate,
                SalesOrderId = order.Id,
                Items = challanItems
            };

            // Reuse the existing challan create flow (numbering, status, item
            // catalog upsert) — it persists the SalesOrder links we set.
            var createdChallan = await _challanService.CreateDeliveryChallanAsync(order.CompanyId, challanDto);

            // Auto-close the order once every line is fully delivered. The order
            // entity is tracked, so this emits a targeted Status update. Never
            // re-opens on a later challan cancellation — operator re-opens manually.
            if (order.Status == "Open")
            {
                var deliveredNow = await _context.DeliveryItems
                    .Where(di => di.SalesOrderItemId != null
                              && soItemIds.Contains(di.SalesOrderItemId.Value)
                              && di.DeliveryChallan.Status != "Cancelled")
                    .GroupBy(di => di.SalesOrderItemId!.Value)
                    .Select(g => new { g.Key, Qty = g.Sum(x => x.Quantity) })
                    .ToDictionaryAsync(x => x.Key, x => x.Qty);
                if (order.Items.All(i => deliveredNow.GetValueOrDefault(i.Id, 0m) >= i.Quantity))
                {
                    order.Status = "Closed";
                    await _context.SaveChangesAsync();
                }
            }

            return createdChallan;
        }

        // ── Bill prefill (FBR-off standalone billing) ────────────────────────

        /// <summary>
        /// Everything the standalone bill form needs to start from this order.
        /// Orders are quantity-only, so per line the unit price is resolved
        /// here: source-quote price (ItemType match first, then exact
        /// description), else the item's last billed rate, else 0.
        /// </summary>
        public async Task<SalesOrderInvoicePrefillDto?> GetInvoicePrefillAsync(int id)
        {
            var order = await _repository.GetByIdAsync(id);
            if (order == null) return null;

            var quoteItems = new List<SalesQuoteItem>();
            decimal? gstRate = null;
            if (order.SalesQuoteId.HasValue)
            {
                // Scoped to the order's company — a cross-company quote link
                // must never leak another tenant's prices.
                var quote = await _context.SalesQuotes
                    .Include(q => q.Items)
                    .AsNoTracking()
                    .FirstOrDefaultAsync(q => q.Id == order.SalesQuoteId.Value
                                           && q.CompanyId == order.CompanyId);
                if (quote != null)
                {
                    quoteItems = quote.Items.ToList();
                    gstRate = quote.GSTRate;
                }
            }

            var lines = new List<SalesOrderInvoicePrefillLineDto>();
            foreach (var item in order.Items)
            {
                var line = new SalesOrderInvoicePrefillLineDto
                {
                    ItemTypeId = item.ItemTypeId,
                    Description = item.Description,
                    Quantity = item.Quantity,
                    Unit = item.Unit,
                };

                var match = (item.ItemTypeId.HasValue
                        ? quoteItems.FirstOrDefault(qi => qi.ItemTypeId == item.ItemTypeId && qi.UnitPrice > 0)
                        : null)
                    ?? quoteItems.FirstOrDefault(qi => qi.UnitPrice > 0 && string.Equals(
                        qi.Description.Trim(), item.Description.Trim(), StringComparison.OrdinalIgnoreCase));
                if (match != null)
                {
                    line.UnitPrice = match.UnitPrice;
                    line.PriceSource = "Quote";
                }
                else
                {
                    var last = await GetLastBilledRateAsync(order.CompanyId, item.Description, item.ItemTypeId);
                    if (last.HasValue)
                    {
                        line.UnitPrice = last.Value;
                        line.PriceSource = "LastBilled";
                    }
                }
                lines.Add(line);
            }

            return new SalesOrderInvoicePrefillDto
            {
                SalesOrderId = order.Id,
                SalesOrderNumber = order.SalesOrderNumber,
                CompanyId = order.CompanyId,
                ClientId = order.ClientId,
                ClientName = order.Client?.Name ?? "",
                CustomerPoNumber = order.CustomerPoNumber,
                CustomerPoDate = order.CustomerPoDate,
                Site = order.Site,
                SalesQuoteId = order.SalesQuoteId,
                GstRate = gstRate,
                Lines = lines
            };
        }

        /// <summary>
        /// Last billed unit price for an item — ItemType match first, then
        /// exact (case-insensitive) description. Mirrors
        /// SalesQuoteService.GetItemRateAsync; excludes demo bills and
        /// credit/debit notes.
        /// </summary>
        private async Task<decimal?> GetLastBilledRateAsync(int companyId, string description, int? itemTypeId)
        {
            var baseQuery = _context.InvoiceItems
                .Where(ii => ii.Invoice.CompanyId == companyId && !ii.Invoice.IsDemo
                          && ii.Invoice.DocumentType != 9 && ii.Invoice.DocumentType != 10
                          && ii.UnitPrice > 0);

            // "Last" = most recent by bill date (Id breaks same-day ties).
            if (itemTypeId.HasValue && itemTypeId.Value > 0)
            {
                var byType = await baseQuery
                    .Where(ii => ii.ItemTypeId == itemTypeId.Value)
                    .OrderByDescending(ii => ii.Invoice.Date).ThenByDescending(ii => ii.Id)
                    .Select(ii => (decimal?)ii.UnitPrice)
                    .FirstOrDefaultAsync();
                if (byType.HasValue) return byType;
            }

            if (!string.IsNullOrWhiteSpace(description))
            {
                var d = description.Trim().ToLower();
                var byDesc = await baseQuery
                    .Where(ii => ii.Description.ToLower() == d)
                    .OrderByDescending(ii => ii.Invoice.Date).ThenByDescending(ii => ii.Id)
                    .Select(ii => (decimal?)ii.UnitPrice)
                    .FirstOrDefaultAsync();
                if (byDesc.HasValue) return byDesc;
            }

            return null;
        }

        // ── Attached challans (View / drill-down) ────────────────────────────

        /// <summary>
        /// Every delivery challan raised against this order — with the lines
        /// that fulfil it. Cancelled challans are included but surfaced with
        /// their status so the operator sees the full history.
        /// </summary>
        public async Task<List<SalesOrderChallanDto>> GetChallansForOrderAsync(int orderId)
        {
            var challans = await _context.DeliveryChallans
                .AsNoTracking()
                .Where(dc => dc.SalesOrderId == orderId)
                .Include(dc => dc.Items)
                .OrderBy(dc => dc.DeliveryDate)
                .ThenBy(dc => dc.ChallanNumber)
                .ToListAsync();

            return challans.Select(dc =>
            {
                // Lines that fulfil THIS order. A challan created from an order
                // links every line; fall back to all lines defensively.
                var linked = dc.Items.Where(i => i.SalesOrderItemId != null).ToList();
                var lines = linked.Count > 0 ? linked : dc.Items.ToList();
                return new SalesOrderChallanDto
                {
                    Id = dc.Id,
                    ChallanNumber = dc.ChallanNumber,
                    DeliveryDate = dc.DeliveryDate,
                    Status = dc.Status,
                    Site = dc.Site,
                    IsImported = dc.IsImported,
                    InvoiceId = dc.InvoiceId,
                    ItemCount = lines.Count,
                    TotalQuantity = lines.Sum(i => i.Quantity),
                    Lines = lines.Select(i => new SalesOrderChallanLineDto
                    {
                        Description = i.Description,
                        Quantity = i.Quantity,
                        Unit = i.Unit
                    }).ToList()
                };
            }).ToList();
        }

        // ── Print ────────────────────────────────────────────────────────────

        public async Task<PrintOrderDto?> GetPrintDataAsync(int id)
        {
            var dto = await GetByIdAsync(id);
            if (dto == null) return null;
            var order = await _repository.GetByIdAsync(id);
            var company = order!.Company;

            var sNo = 1;
            return new PrintOrderDto
            {
                CompanyBrandName = company?.BrandName ?? company?.Name ?? "",
                CompanyLogoPath = company?.LogoPath,
                CompanyAddress = company?.FullAddress,
                CompanyPhone = company?.Phone,
                SalesOrderNumber = dto.SalesOrderNumber,
                OrderDate = dto.OrderDate,
                RequiredDate = dto.RequiredDate,
                CustomerPoNumber = dto.CustomerPoNumber,
                CustomerPoDate = dto.CustomerPoDate,
                Status = dto.FulfillmentStatus,
                ClientName = dto.ClientName,
                ClientAddress = order.Client?.Address,
                Site = dto.Site,
                Items = dto.Items.Select(i => new PrintOrderItemDto
                {
                    SNo = sNo++,
                    ItemTypeName = i.ItemTypeName,
                    Description = i.Description,
                    Quantity = i.Quantity,
                    Uom = i.Unit,
                    DeliveredQuantity = i.DeliveredQuantity,
                    RemainingQuantity = i.RemainingQuantity
                }).ToList()
            };
        }

        private async Task RememberDescriptionsAsync(IEnumerable<string?> descriptions)
        {
            try
            {
                await ItemDescriptionRegistry.EnsureAsync(_context, descriptions);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to upsert sales-order item descriptions into the catalog (non-fatal).");
            }
        }
    }
}

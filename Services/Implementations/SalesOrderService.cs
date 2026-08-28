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
    /// back to its ordered line.
    /// </summary>
    public class SalesOrderService : ISalesOrderService
    {
        private readonly ISalesOrderRepository _repository;
        private readonly IDeliveryChallanService _challanService;
        private readonly IStockService _stock;
        private readonly IInventoryReadService _inventory;
        private readonly AppDbContext _context;
        private readonly ILogger<SalesOrderService> _logger;

        public SalesOrderService(
            ISalesOrderRepository repository,
            IDeliveryChallanService challanService,
            IStockService stock,
            IInventoryReadService inventory,
            AppDbContext context,
            ILogger<SalesOrderService> logger)
        {
            _repository = repository;
            _challanService = challanService;
            _stock = stock;
            _inventory = inventory;
            _context = context;
            _logger = logger;
        }

        // ── V2 inventory rules for order lines ───────────────────────────────

        /// <summary>
        /// On a V2 company every inventory-affecting order line must carry an
        /// item type (Q5) and use that item's single base UOM (Q10) — so
        /// committed quantities never silently undercount or mix units. No-op
        /// on V1 companies. FBR-only items aren't inventory-constrained.
        /// </summary>
        private async Task ValidateV2OrderLinesAsync(Company company, List<SalesOrderItemDto> items)
        {
            if (company.InventoryFlowVersion != (byte)InventoryFlowVersion.V2Standard) return;

            // Item type is OPTIONAL on a sales order — an order captures intent /
            // commitment, not a stock movement, and PO imports often arrive
            // unclassified. A line may be left without an item type and gets
            // classified later at bill / challan time, where the item type IS
            // required (InvoiceService / PurchaseBillService still enforce it).
            // When a line DOES carry an item type it must use that item's base
            // UOM (Q10) so committed quantities never mix units. Non-inventory
            // lines (Freight/Discount → GL account, no stock) are exempt.
            var invLines = items.Where(i => i.ItemTypeId.HasValue && i.ItemTypeId.Value > 0 && !i.NonInventoryItemId.HasValue).ToList();
            var itemTypeIds = invLines.Select(i => i.ItemTypeId!.Value).Distinct().ToList();
            if (itemTypeIds.Count == 0) return;
            var tracked = await _stock.GetStockTrackedItemTypeIdsAsync(company.Id, itemTypeIds);
            var meta = await _context.ItemTypes
                .Where(it => itemTypeIds.Contains(it.Id))
                .Select(it => new { it.Id, it.Name, it.UOM })
                .ToDictionaryAsync(x => x.Id, x => x);

            foreach (var i in invLines)
            {
                var id = i.ItemTypeId!.Value;
                if (!tracked.Contains(id)) continue;               // FBR-only → unconstrained
                var m = meta.GetValueOrDefault(id);
                var baseUom = m?.UOM;
                if (!string.IsNullOrWhiteSpace(baseUom)
                    && !string.IsNullOrWhiteSpace(i.Unit)
                    && !string.Equals(baseUom.Trim(), i.Unit.Trim(), StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException(
                        $"\"{m!.Name}\" is tracked in its base unit \"{baseUom}\"; this line uses \"{i.Unit}\". " +
                        "Use the item's base unit so quantities aren't mixed across units.");
            }
        }

        /// <summary>
        /// Hard-block over-commit guard (Q4). Assumes it runs inside a
        /// transaction holding the per-company stock lock, so the available
        /// figure it reads reflects every committed peer. Throws
        /// <see cref="StockShortageException"/> (→ 409) if any tracked line
        /// exceeds available (= on-hand − already-committed).
        /// </summary>
        private async Task AssertOrderAvailabilityAsync(int companyId, List<SalesOrderItemDto> items)
        {
            var reqs = items
                .Where(i => i.ItemTypeId.HasValue && i.ItemTypeId.Value > 0 && i.Quantity > 0)
                .GroupBy(i => i.ItemTypeId!.Value)
                .Select(g => new { ItemTypeId = g.Key, Qty = g.Sum(x => x.Quantity), Name = g.First().Description })
                .ToList();
            if (reqs.Count == 0) return;

            var tracked = await _stock.GetStockTrackedItemTypeIdsAsync(companyId, reqs.Select(r => r.ItemTypeId));
            var shortages = new List<StockShortageDetail>();
            foreach (var r in reqs)
            {
                if (!tracked.Contains(r.ItemTypeId)) continue;
                var available = await _inventory.GetAvailableAsync(companyId, r.ItemTypeId);
                if (r.Qty > available)
                    shortages.Add(new StockShortageDetail(r.ItemTypeId, r.Name ?? "", r.Qty, available));
            }
            if (shortages.Count > 0)
            {
                var msg = "Insufficient available stock to reserve this order: " + string.Join(", ",
                    shortages.Select(s => $"{s.ItemName} (need {s.Required}, available {s.Available})"));
                throw new StockShortageException(msg, shortages);
            }
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
            // "No PO" challans are billable when the company has FBR OFF (a PO is
            // optional metadata then, and CreateAsync already accepts them), so an
            // FBR-off order whose challans are all "No PO" still surfaces its Bill
            // action. FBR-on orders still require a PO first.
            var companyFbrOff = orders.Count > 0 && !(await _context.Companies.AsNoTracking()
                .Where(c => c.Id == orders[0].CompanyId)
                .Select(c => c.FbrEnabled).FirstOrDefaultAsync());
            var challanStatsList = await _context.DeliveryChallans
                .Where(dc => dc.SalesOrderId != null
                          && orderIds.Contains(dc.SalesOrderId.Value)
                          && dc.Status != "Cancelled")
                .GroupBy(dc => dc.SalesOrderId!.Value)
                .Select(g => new
                {
                    Key = g.Key,
                    Count = g.Count(),
                    Billable = g.Count(x => x.Status == "Pending" || x.Status == "Imported"
                                         || (companyFbrOff && x.Status == "No PO")),
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
                    NonInventoryItemId = i.NonInventoryItemId,
                    NonInventoryItemName = i.NonInventoryItem?.Name,
                    Description = i.Description,
                    Quantity = i.Quantity,
                    Unit = i.Unit,
                    UnitPrice = i.UnitPrice,
                    DeliveredQuantity = delivered,
                    RemainingQuantity = remaining,
                    LineStatus = LineStatusFor(i.Quantity, delivered)
                };
            }).ToList();

            return new SalesOrderDto
            {
                Id = o.Id,
                CopiedFromType = o.CopiedFromType,
                CopiedFromId = o.CopiedFromId,
                SalesOrderNumber = o.SalesOrderNumber,
                CompanyId = o.CompanyId,
                DivisionId = o.DivisionId,
                DivisionName = o.Division?.Name,
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

        public async Task<List<SalesOrderDto>> GetByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null)
            => await MapManyAsync(await _repository.GetByCompanyAsync(companyId, allowedDivisionIds));

        public async Task<List<SalesOrderDto>> GetOpenByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null)
        {
            var mapped = await MapManyAsync(await _repository.GetOpenByCompanyAsync(companyId, allowedDivisionIds));
            // Only orders that still have something to deliver are useful in the
            // "create challan" picker.
            return mapped.Where(o => o.FulfillmentStatus != "Fully Delivered"
                                  && o.FulfillmentStatus != "Over Delivered").ToList();
        }

        // The "purchase bill from sales order" picker. Purchasing to fulfil an
        // order is independent of DELIVERY, and an order auto-closes once fully
        // delivered — yet the operator may still want to raise a purchase bill
        // for it. So return EVERY order except cancelled ones (Open AND Closed),
        // unlike the delivery-scoped challan picker (GetOpenByCompanyAsync).
        public async Task<List<SalesOrderDto>> GetOpenForPurchaseAsync(int companyId, HashSet<int>? allowedDivisionIds = null)
        {
            var mapped = await MapManyAsync(await _repository.GetByCompanyAsync(companyId, allowedDivisionIds));
            return mapped.Where(o => o.Status != "Cancelled").ToList();
        }

        public async Task<PagedResult<SalesOrderDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, string? status = null,
            int? clientId = null, DateTime? dateFrom = null, DateTime? dateTo = null,
            int? divisionId = null, HashSet<int>? allowedDivisionIds = null)
        {
            var (items, totalCount) = await _repository.GetPagedByCompanyAsync(
                companyId, page, pageSize, search, status, clientId, dateFrom, dateTo, divisionId, allowedDivisionIds);
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

        public async Task<int> GetCountByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null)
            => await _repository.GetCountByCompanyAsync(companyId, allowedDivisionIds);

        // Cross-tenant link guard for non-inventory item refs on the lines.
        private async Task ValidateNonInvAsync(int companyId, IEnumerable<int?> ids)
        {
            var wanted = ids.Where(x => x.HasValue).Select(x => x!.Value).Distinct().ToList();
            if (wanted.Count == 0) return;
            var valid = await _context.NonInventoryItems.AsNoTracking()
                .Where(n => n.CompanyId == companyId && wanted.Contains(n.Id))
                .Select(n => n.Id).ToListAsync();
            if (wanted.Any(w => !valid.Contains(w)))
                throw new InvalidOperationException("A selected non-inventory item does not belong to this company.");
        }

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
            await ValidateNonInvAsync(companyId, dto.Items.Select(i => i.NonInventoryItemId));

            // Cross-tenant guard (PR-03): a linked Sales Quote must belong to
            // the SAME company — never trust dto.SalesQuoteId from the body.
            if (dto.SalesQuoteId.HasValue)
            {
                var quoteOk = await _context.SalesQuotes.AnyAsync(
                    q => q.Id == dto.SalesQuoteId.Value && q.CompanyId == companyId);
                if (!quoteOk)
                    throw new InvalidOperationException("The linked sales quote was not found for this company.");
            }

            // V2 line rules (item type required + single base UOM).
            await ValidateV2OrderLinesAsync(company, dto.Items);

            await UnitRegistry.EnsureNamesAsync(_context, dto.Items.Select(i => i.Unit));

            // Per-division numbering: a division-tagged order draws from the
            // division's own sequence; otherwise the company's.
            var division = await MyApp.Api.Helpers.DivisionNumbering.ResolveAsync(_context, companyId, dto.DivisionId);

            // Numbering + insert, shared by the guarded and unguarded paths.
            async Task<int> InsertOrderAsync()
            {
                var maxQuery = _context.SalesOrders.Where(o => o.CompanyId == companyId);
                maxQuery = dto.DivisionId.HasValue
                    ? maxQuery.Where(o => o.DivisionId == dto.DivisionId.Value)
                    : maxQuery.Where(o => o.DivisionId == null);
                var max = await maxQuery.Select(o => (int?)o.SalesOrderNumber).MaxAsync() ?? 0;
                var seed = division != null ? division.StartingSalesOrderNumber : company.StartingSalesOrderNumber;
                var next = MyApp.Api.Helpers.DivisionNumbering.Next(max, seed);

                var order = new SalesOrder
                {
                    CompanyId = companyId,
                    DivisionId = dto.DivisionId,
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
                        ItemTypeId = i.NonInventoryItemId.HasValue ? null : i.ItemTypeId,
                        NonInventoryItemId = i.NonInventoryItemId,
                        Description = i.Description.Trim(),
                        Quantity = i.Quantity,
                        Unit = i.Unit,
                        UnitPrice = i.UnitPrice
                    }).ToList()
                };
                if (division != null) division.CurrentSalesOrderNumber = next;
                else company.CurrentSalesOrderNumber = next;
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
            }

            // Hard-block over-commit (Q4): V2 + tracking + hard-block. The
            // availability check + insert run inside one transaction holding
            // the per-company stock lock, so two concurrent orders on the last
            // units can't both reserve (closes the TOCTOU race).
            var enforce = company.InventoryFlowVersion == (byte)InventoryFlowVersion.V2Standard
                       && company.InventoryTrackingEnabled && company.StockGuardHardBlock;

            int createdId;
            if (enforce)
            {
                await using var tx = await _context.Database.BeginTransactionAsync();
                await MyApp.Api.Helpers.StockLock.AcquireCompanyAsync(_context, companyId);
                await AssertOrderAvailabilityAsync(companyId, dto.Items);
                createdId = await InsertOrderAsync();
                await tx.CommitAsync();
            }
            else
            {
                createdId = await NumberAllocationRetry.ExecuteAsync(async _ => await InsertOrderAsync());
            }

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

            // V2 line rules (item type required + single base UOM). Load the
            // company for its flow version (order.Company may not be included).
            var soCompany = await _context.Companies.FindAsync(order.CompanyId)
                ?? throw new KeyNotFoundException("Company not found.");
            await ValidateV2OrderLinesAsync(soCompany, dto.Items);

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
            // 2026-08-11 fix: propagate the order's PO down to its existing challans
            // so a PO added/edited AFTER challans were created reaches them (mirrors
            // AttachChallanAsync). Without this a challan created from a PO-less order
            // stays PoNumber="" / Status="No PO" forever, which then blocks billing.
            // Only when a PO is present; skip cancelled + already-billed challans.
            if (!string.IsNullOrWhiteSpace(order.CustomerPoNumber))
            {
                var linkedChallans = await _context.DeliveryChallans
                    .Where(dc => dc.SalesOrderId == id && dc.Status != "Cancelled" && dc.InvoiceId == null)
                    .ToListAsync();
                foreach (var ch in linkedChallans)
                {
                    ch.PoNumber = order.CustomerPoNumber;
                    ch.PoDate = order.CustomerPoDate;
                    if (ch.Status == "No PO") ch.Status = "Pending";
                }
            }
            order.Site = string.IsNullOrWhiteSpace(dto.Site) ? null : dto.Site.Trim();
            order.Notes = string.IsNullOrWhiteSpace(dto.Notes) ? null : dto.Notes.Trim();
            // Reference link to a Sales Quote (set/cleared from the form).
            // Cross-tenant guard (PR-03): only accept a quote from this company.
            if (dto.SalesQuoteId.HasValue)
            {
                var quoteOk = await _context.SalesQuotes.AnyAsync(
                    q => q.Id == dto.SalesQuoteId.Value && q.CompanyId == order.CompanyId);
                if (!quoteOk)
                    throw new InvalidOperationException("The linked sales quote was not found for this company.");
            }
            order.SalesQuoteId = dto.SalesQuoteId;

            // ── Items diff with delivery guards ──
            await ValidateNonInvAsync(order.CompanyId, dto.Items.Select(i => i.NonInventoryItemId));

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
                    existing.NonInventoryItemId = itemDto.NonInventoryItemId;
                    existing.ItemTypeId = itemDto.NonInventoryItemId.HasValue ? null : itemDto.ItemTypeId;
                    existing.Description = itemDto.Description.Trim();
                    existing.Quantity = itemDto.Quantity;
                    existing.Unit = itemDto.Unit;
                    existing.UnitPrice = itemDto.UnitPrice;
                }
                else
                {
                    order.Items.Add(new SalesOrderItem
                    {
                        SalesOrderId = order.Id,
                        ItemTypeId = itemDto.NonInventoryItemId.HasValue ? null : itemDto.ItemTypeId,
                        NonInventoryItemId = itemDto.NonInventoryItemId,
                        Description = itemDto.Description.Trim(),
                        Quantity = itemDto.Quantity,
                        Unit = itemDto.Unit,
                        UnitPrice = itemDto.UnitPrice
                    });
                }
            }
            foreach (var rem in toRemove)
            {
                order.Items.Remove(rem);
                _context.SalesOrderItems.Remove(rem);
            }

            await _repository.UpdateAsync(order);
            return await MapOneAsync(await _repository.GetByIdAsync(id));
        }

        // ── Status / delete ────────────────────────────────────────────────

        public async Task<bool> SetStatusAsync(int id, string status)
        {
            var allowed = new[] { "Open", "Closed", "Cancelled" };
            if (!allowed.Contains(status))
                throw new InvalidOperationException("Invalid status. Allowed: Open, Closed, Cancelled.");
            var order = await _repository.GetByIdAsync(id);
            if (order == null) return false;
            if (status == "Cancelled" && await _repository.HasChallansAsync(id, includeCancelled: false))
                throw new InvalidOperationException("Cannot cancel an order that has active delivery challans.");
            order.Status = status;
            await _repository.UpdateAsync(order);
            return true;
        }

        public async Task<bool> DeleteAsync(int id)
        {
            var order = await _repository.GetByIdAsync(id);
            if (order == null) return false;
            if (await _repository.HasChallansAsync(id, includeCancelled: false))
                throw new InvalidOperationException("Cannot delete an order that has active delivery challans. Delete the challans first.");
            // Release any cancelled (voided) challans still pointing at this order so
            // the NoAction FK doesn't block the delete — they keep their history,
            // just unlinked from the removed order.
            var cancelledChallans = await _context.DeliveryChallans
                .Where(dc => dc.SalesOrderId == id && dc.Status == "Cancelled").ToListAsync();
            foreach (var dc in cancelledChallans) dc.SalesOrderId = null;

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

                // Item type: an override the operator picked at delivery time wins
                // over the (possibly un-classified) sales-order line. Item-type and
                // non-inventory are mutually exclusive.
                int? itemTypeId, nonInvId;
                if (reqLine != null && (reqLine.ItemTypeId.HasValue || reqLine.NonInventoryItemId.HasValue))
                {
                    nonInvId = reqLine.NonInventoryItemId;
                    itemTypeId = nonInvId.HasValue ? null : reqLine.ItemTypeId;
                }
                else
                {
                    nonInvId = soItem.NonInventoryItemId;
                    itemTypeId = nonInvId.HasValue ? null : soItem.ItemTypeId;
                }

                challanItems.Add(new DeliveryItemDto
                {
                    ItemTypeId = itemTypeId,
                    NonInventoryItemId = nonInvId,
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
                // A fulfilment challan belongs to the same division as its
                // order — it must number from that division's sequence and
                // print with the division's branding.
                DivisionId = order.DivisionId,
                DeliveryDate = dto.DeliveryDate ?? DateTime.UtcNow.Date,
                Site = string.IsNullOrWhiteSpace(dto.Site) ? order.Site : dto.Site,
                PoNumber = order.CustomerPoNumber ?? "",
                PoDate = order.CustomerPoDate,
                SalesOrderId = order.Id,
                Items = challanItems
            };

            // Reuse the existing challan create flow (numbering, status, item
            // catalog upsert) — it now persists the SalesOrder links we set.
            var createdChallan = await _challanService.CreateDeliveryChallanAsync(order.CompanyId, challanDto);

            // Auto-close the order once every line is fully delivered: delivery
            // is complete so it drops out of the "deliver" flow. The order entity
            // is tracked, so this emits a targeted Status update. Never re-opens
            // on a later challan cancellation — the operator re-opens manually.
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
                    // ItemType is eager-loaded (SalesOrderRepository.WithIncludes) so
                    // the prefill carries the name — the bill form shows the type
                    // already selected instead of forcing the operator to re-pick.
                    ItemTypeName = item.ItemType?.Name,
                    NonInventoryItemId = item.NonInventoryItemId,
                    NonInventoryItemName = item.NonInventoryItem?.Name,
                    Description = item.Description,
                    Quantity = item.Quantity,
                    Unit = item.Unit,
                };

                // Price precedence: the order line's own agreed UnitPrice wins
                // when set; otherwise fall back to the source-quote price, then
                // the item's last billed rate (existing behaviour), else 0.
                if (item.UnitPrice.HasValue && item.UnitPrice.Value > 0)
                {
                    line.UnitPrice = item.UnitPrice.Value;
                    line.PriceSource = "SalesOrder";
                }
                else
                {
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
                }
                lines.Add(line);
            }

            return new SalesOrderInvoicePrefillDto
            {
                SalesOrderId = order.Id,
                SalesOrderNumber = order.SalesOrderNumber,
                CompanyId = order.CompanyId,
                DivisionId = order.DivisionId,
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
            // InvoiceNumber is NOT chronological across scopes — each
            // (company, division) runs its own sequence, so an old
            // company-level bill #3800 would outrank yesterday's division
            // bill #12.
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
        /// Every delivery challan raised against this order — newest activity last
        /// — with the lines that fulfil it. Cancelled challans are included but
        /// surfaced with their status so the operator sees the full history.
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

        // ── Attach an existing (unlinked) challan to this order ──────────────

        public async Task<List<AttachableChallanDto>> GetAttachableChallansAsync(int orderId)
        {
            var order = await _repository.GetByIdAsync(orderId);
            if (order == null) return new();

            // Candidates: unlinked, unbilled, non-cancelled, non-demo challans
            // for THIS order's client (and company) that carry NO PO of their
            // own. The attach flow exists for deliveries raised BEFORE the PO
            // arrived — a challan that already has a PO belongs to that PO, so
            // it's excluded (a Pending+PO challan bills on its own PO).
            var query = _context.DeliveryChallans
                .AsNoTracking()
                .Include(dc => dc.Items).ThenInclude(i => i.ItemType)
                .Where(dc => dc.CompanyId == order.CompanyId
                          && dc.ClientId == order.ClientId
                          && dc.SalesOrderId == null
                          && dc.InvoiceId == null
                          && dc.Status != "Cancelled"
                          && !dc.IsDemo
                          && string.IsNullOrEmpty(dc.PoNumber));

            // Division scope: a challan can only join an order in its OWN
            // division (both null = company-level). Branch on HasValue so the
            // null case compares with IS NULL rather than a NULL-valued equality.
            query = order.DivisionId.HasValue
                ? query.Where(dc => dc.DivisionId == order.DivisionId.Value)
                : query.Where(dc => dc.DivisionId == null);

            var challans = await query
                .OrderBy(dc => dc.DeliveryDate)
                .ThenBy(dc => dc.ChallanNumber)
                .ToListAsync();

            return challans.Select(dc => new AttachableChallanDto
            {
                Id = dc.Id,
                ChallanNumber = dc.ChallanNumber,
                DeliveryDate = dc.DeliveryDate,
                Status = dc.Status,
                PoNumber = dc.PoNumber,
                Site = dc.Site,
                IsImported = dc.IsImported,
                Lines = dc.Items.Select(i => new AttachableChallanLineDto
                {
                    DeliveryItemId = i.Id,
                    ItemTypeId = i.ItemTypeId,
                    ItemTypeName = i.ItemType?.Name ?? "",
                    Description = i.Description,
                    Quantity = i.Quantity,
                    Unit = i.Unit
                }).ToList()
            }).ToList();
        }

        public async Task<SalesOrderDto?> AttachChallanAsync(int orderId, AttachChallanRequestDto dto)
        {
            var order = await _repository.GetByIdAsync(orderId);
            if (order == null) return null;
            if (order.Status == "Cancelled")
                throw new InvalidOperationException("Cannot attach a challan to a cancelled order.");

            var challan = await _context.DeliveryChallans
                .Include(dc => dc.Items)
                .FirstOrDefaultAsync(dc => dc.Id == dto.ChallanId);
            if (challan == null) throw new KeyNotFoundException("Challan not found.");

            // Guards — a challan can only join an order of the SAME company AND
            // the SAME division AND the SAME client, and only when it's free to
            // link and unbilled. The challan keeps its own division (we never
            // move it across divisions here).
            if (challan.CompanyId != order.CompanyId)
                throw new InvalidOperationException("That challan belongs to a different company.");
            if (challan.DivisionId != order.DivisionId)
                throw new InvalidOperationException("That challan belongs to a different division than this order.");
            if (challan.ClientId != order.ClientId)
                throw new InvalidOperationException("That challan is for a different customer than this order.");
            if (challan.SalesOrderId != null)
                throw new InvalidOperationException("That challan is already linked to a sales order.");
            if (challan.InvoiceId != null)
                throw new InvalidOperationException("That challan has already been billed and can't be re-linked.");
            if (challan.Status == "Cancelled")
                throw new InvalidOperationException("A cancelled challan can't be attached.");

            // Validate the line mapping: every mapped delivery item must be on
            // this challan, and every target ordered line must be on this order.
            var soItemIds = order.Items.Select(i => i.Id).ToHashSet();
            var challanItemIds = challan.Items.Select(i => i.Id).ToHashSet();
            var mappingByItem = new Dictionary<int, int?>();
            foreach (var m in dto.LineMappings ?? new List<AttachLineMappingDto>())
            {
                if (!challanItemIds.Contains(m.DeliveryItemId))
                    throw new InvalidOperationException("A line mapping refers to an item that isn't on this challan.");
                if (m.SalesOrderItemId.HasValue && !soItemIds.Contains(m.SalesOrderItemId.Value))
                    throw new InvalidOperationException("A line mapping refers to a line that isn't on this order.");
                mappingByItem[m.DeliveryItemId] = m.SalesOrderItemId;
            }

            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                // Targeted field updates only — do NOT route through the challan
                // edit / stock-reflow path. The challan's stock OUT was already
                // recorded at its creation; linking changes only FKs, PO, status.
                //
                // Resolve each challan line to an order line so the order reflects
                // everything delivered, with no duplicates:
                //   • explicit mapping        → link to that ordered line (roll-up).
                //   • unmapped, matches an
                //     existing line (non-inv id,
                //     else item type,
                //     else exact description)  → link to it (no duplicate).
                //   • unmapped, new item       → ADD it as a NEW order line
                //     (ordered qty = delivered qty), so it shows on the order.
                var preExisting = order.Items.Where(i => i.Id > 0).ToList();
                SalesOrderItem? FindExisting(DeliveryItem dl)
                {
                    // Non-inventory and item-type are mutually exclusive on a line.
                    if (dl.NonInventoryItemId.HasValue)
                    {
                        var byNon = preExisting.FirstOrDefault(i => i.NonInventoryItemId == dl.NonInventoryItemId);
                        if (byNon != null) return byNon;
                    }
                    else if (dl.ItemTypeId.HasValue)
                    {
                        var byType = preExisting.FirstOrDefault(i => i.ItemTypeId == dl.ItemTypeId);
                        if (byType != null) return byType;
                    }
                    var d = (dl.Description ?? "").Trim().ToLower();
                    return preExisting.FirstOrDefault(i => (i.Description ?? "").Trim().ToLower() == d);
                }

                var newLineByKey = new Dictionary<string, SalesOrderItem>();
                var targetByDeliveryItem = new Dictionary<int, SalesOrderItem>();
                foreach (var item in challan.Items)
                {
                    if (mappingByItem.TryGetValue(item.Id, out var soItemId) && soItemId.HasValue)
                    {
                        targetByDeliveryItem[item.Id] = order.Items.First(i => i.Id == soItemId.Value);
                        continue;
                    }
                    var existing = FindExisting(item);
                    if (existing != null)
                    {
                        targetByDeliveryItem[item.Id] = existing;
                        continue;
                    }
                    // Key includes the classification kind so a non-inventory line
                    // and a same-description item-type line don't merge.
                    var key = (item.NonInventoryItemId.HasValue ? "N" + item.NonInventoryItemId : "T" + (item.ItemTypeId?.ToString() ?? ""))
                            + "|" + (item.Description ?? "").Trim().ToLowerInvariant();
                    if (!newLineByKey.TryGetValue(key, out var nl))
                    {
                        nl = new SalesOrderItem
                        {
                            SalesOrderId = order.Id,
                            // Item-type and non-inventory are mutually exclusive
                            // (mirrors CreateChallanFromOrderAsync).
                            NonInventoryItemId = item.NonInventoryItemId,
                            ItemTypeId = item.NonInventoryItemId.HasValue ? null : item.ItemTypeId,
                            Description = (item.Description ?? "").Trim(),
                            Quantity = 0m,
                            Unit = item.Unit
                        };
                        newLineByKey[key] = nl;
                        order.Items.Add(nl);
                        _context.SalesOrderItems.Add(nl);
                    }
                    nl.Quantity += item.Quantity; // ordered = total delivered for the new item
                    targetByDeliveryItem[item.Id] = nl;
                }

                // Persist the new order lines first so they receive ids, then link
                // each challan line to its resolved order line.
                if (newLineByKey.Count > 0)
                    await _context.SaveChangesAsync();
                foreach (var item in challan.Items)
                    item.SalesOrderItemId = targetByDeliveryItem[item.Id].Id;

                challan.SalesOrderId = order.Id;

                // Copy the order's PO onto the challan (the order is authoritative
                // for the chain). When the order has a PO, a "No PO" challan
                // becomes billable → flip to "Pending". When the order has NO PO
                // yet, leave the challan's PO/status untouched — the PO is applied
                // when the order's PO is later set.
                var po = string.IsNullOrWhiteSpace(order.CustomerPoNumber) ? "" : order.CustomerPoNumber.Trim();
                if (!string.IsNullOrEmpty(po))
                {
                    challan.PoNumber = po;
                    challan.PoDate = order.CustomerPoDate;
                    if (challan.Status == "No PO") challan.Status = "Pending";
                }

                await _context.SaveChangesAsync();

                // Auto-close the order once every line is fully delivered
                // (mirrors CreateChallanFromOrderAsync). Never re-opens.
                if (order.Status == "Open")
                {
                    var soItemIdList = order.Items.Select(i => i.Id).ToList();
                    var deliveredNow = await _context.DeliveryItems
                        .Where(di => di.SalesOrderItemId != null
                                  && soItemIdList.Contains(di.SalesOrderItemId.Value)
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

                await tx.CommitAsync();
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }

            return await MapOneAsync(await _repository.GetByIdAsync(orderId));
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
    }
}

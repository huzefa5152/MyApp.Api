using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;
using MyApp.Api.Services.Tax;

namespace MyApp.Api.Services.Implementations
{
    public class ItemTypeService : IItemTypeService
    {
        private readonly IItemTypeRepository _repo;
        private readonly AppDbContext _context;
        private readonly ITaxMappingEngine _taxEngine;
        // 2026-05-12: optional dependency — used by GetAllAsync(companyId)
        // to enrich each DTO with the company's current on-hand qty
        // (opening + Σ in − Σ out) so dropdowns can sort by availability.
        private readonly IStockService _stock;

        public ItemTypeService(
            IItemTypeRepository repo,
            AppDbContext context,
            ITaxMappingEngine taxEngine,
            IStockService stock)
        {
            _repo = repo;
            _context = context;
            _taxEngine = taxEngine;
            _stock = stock;
        }

        private static ItemTypeDto ToDto(ItemType it) => new()
        {
            Id = it.Id,
            Name = it.Name,
            HSCode = it.HSCode,
            UOM = it.UOM,
            FbrUOMId = it.FbrUOMId,
            SaleType = it.SaleType,
            FbrDescription = it.FbrDescription,
            IsFavorite = it.IsFavorite,
            UsageCount = it.UsageCount,
        };

        public async Task<List<ItemTypeDto>> GetAllAsync(int? companyId = null)
        {
            var items = await _repo.GetAllAsync();

            // Legacy sort (favorite / usage / alpha) — used when no
            // companyId is supplied OR when the company doesn't have
            // inventory tracking on.
            List<ItemType> sorted;
            Dictionary<int, int>? onHandByItem = null;

            if (companyId.HasValue && await _stock.IsTrackingEnabledAsync(companyId.Value))
            {
                // Pull on-hand for every catalog row in one bulk query
                // — same numbers the Stock Dashboard shows. Items with
                // no purchase/sale history get 0 from the bulk method
                // (no row in the dictionary).
                var ids = items.Select(i => i.Id).ToList();
                onHandByItem = await _stock.GetOnHandBulkAsync(companyId.Value, ids);

                sorted = items
                    // Bucket 1: items with available stock — sorted by qty desc
                    //            (most-available surfaces first).
                    // Bucket 2: items with zero/negative on-hand — fall back
                    //            to the legacy ordering so the dropdown stays
                    //            useful even for fresh catalog rows.
                    .OrderByDescending(it => onHandByItem!.TryGetValue(it.Id, out var q) && q > 0)
                    .ThenByDescending(it => onHandByItem!.TryGetValue(it.Id, out var q) ? q : 0)
                    .ThenByDescending(it => it.IsFavorite)
                    .ThenByDescending(it => it.UsageCount)
                    .ThenBy(it => it.Name)
                    .ToList();
            }
            else
            {
                sorted = items
                    .OrderByDescending(it => it.IsFavorite)
                    .ThenByDescending(it => it.UsageCount)
                    .ThenBy(it => it.Name)
                    .ToList();
            }

            return sorted.Select(it =>
            {
                var dto = ToDto(it);
                if (onHandByItem != null)
                {
                    dto.AvailableQty = onHandByItem.TryGetValue(it.Id, out var q) ? q : 0;
                }
                return dto;
            }).ToList();
        }

        public async Task<ItemTypeDto?> GetByIdAsync(int id)
        {
            var it = await _repo.GetByIdAsync(id);
            return it == null ? null : ToDto(it);
        }

        public async Task<ItemTypeDto> CreateAsync(ItemTypeDto dto, int? enrichWithCompanyId = null)
        {
            if (await _repo.ExistsByNameAsync(dto.Name))
                throw new InvalidOperationException($"An item with name '{dto.Name}' already exists.");

            if (!string.IsNullOrWhiteSpace(dto.HSCode) && await _repo.ExistsByHsCodeAsync(dto.HSCode))
                throw new InvalidOperationException(
                    $"An item with HS Code '{dto.HSCode}' already exists in your catalog. " +
                    "Each HS Code can only be mapped to one item.");

            await EnrichFromFbrAsync(dto, enrichWithCompanyId);
            await EnsureUnitRowAsync(dto.UOM);

            var created = await _repo.CreateAsync(new ItemType
            {
                Name = dto.Name,
                HSCode = dto.HSCode,
                UOM = dto.UOM,
                FbrUOMId = dto.FbrUOMId,
                SaleType = dto.SaleType,
                FbrDescription = dto.FbrDescription,
                IsFavorite = dto.IsFavorite,
            });
            return ToDto(created);
        }

        /// <summary>
        /// Ensure a Unit row exists for this UOM string so the Units admin
        /// page can configure its AllowsDecimalQuantity flag. Delegates to
        /// the shared UnitRegistry helper — same contract every save path
        /// across the app uses (challan create/edit, bill update, excel
        /// import, item-type save). Idempotent, race-protected.
        /// </summary>
        private Task EnsureUnitRowAsync(string? uom)
            => UnitRegistry.EnsureNamesAsync(_context, new[] { uom });

        public async Task<ItemTypeDto?> UpdateAsync(int id, ItemTypeDto dto, int? enrichWithCompanyId = null)
        {
            var it = await _repo.GetByIdAsync(id);
            if (it == null) return null;

            if (await _repo.ExistsByNameAsync(dto.Name, id))
                throw new InvalidOperationException($"An item with name '{dto.Name}' already exists.");

            if (!string.IsNullOrWhiteSpace(dto.HSCode) && await _repo.ExistsByHsCodeAsync(dto.HSCode, id))
                throw new InvalidOperationException(
                    $"Another item in your catalog already uses HS Code '{dto.HSCode}'. " +
                    "Each HS Code can only be mapped to one item.");

            await EnrichFromFbrAsync(dto, enrichWithCompanyId);
            await EnsureUnitRowAsync(dto.UOM);

            // Capture the OLD values so we can detect what actually changed,
            // and compute a "fields changed" set that drives the propagation
            // below. Without this we'd unnecessarily rewrite every line on
            // every catalog touch.
            var changedFields = new ItemTypeFieldChangeSet
            {
                HsCodeChanged   = !StringEq(it.HSCode,   dto.HSCode),
                UomChanged      = !StringEq(it.UOM,      dto.UOM),
                FbrUomIdChanged = it.FbrUOMId            != dto.FbrUOMId,
                SaleTypeChanged = !StringEq(it.SaleType, dto.SaleType),
            };

            it.Name = dto.Name;
            it.HSCode = dto.HSCode;
            it.UOM = dto.UOM;
            it.FbrUOMId = dto.FbrUOMId;
            it.SaleType = dto.SaleType;
            it.FbrDescription = dto.FbrDescription;
            it.IsFavorite = dto.IsFavorite;
            var updated = await _repo.UpdateAsync(it);

            var summary = await PropagateToLinesAsync(updated, changedFields);

            var resultDto = ToDto(updated);
            resultDto.Propagation = summary;
            return resultDto;
        }

        private static bool StringEq(string? a, string? b)
            => string.Equals(a ?? "", b ?? "", StringComparison.Ordinal);

        private struct ItemTypeFieldChangeSet
        {
            public bool HsCodeChanged;
            public bool UomChanged;
            public bool FbrUomIdChanged;
            public bool SaleTypeChanged;
            public bool Any => HsCodeChanged || UomChanged || FbrUomIdChanged || SaleTypeChanged;
        }

        /// <summary>
        /// When an ItemType's HSCode / UOM / FbrUOMId / SaleType changes,
        /// every InvoiceItem and DeliveryItem that references it should
        /// reflect the new values — without forcing the operator to re-edit
        /// every bill and re-pick the catalog row.
        ///
        /// Boundaries:
        ///  • Invoice lines on FBR-Submitted bills are LEFT ALONE — that
        ///    data is locked at submission time. We surface a count of
        ///    skipped lines in the response so the operator sees them.
        ///  • Cancelled challans are skipped (their data is dead).
        ///  • PurchaseItems aren't synced — purchase-side values reflect
        ///    what the SUPPLIER's invoice said, not our catalog opinion.
        ///
        /// All updates happen as single SQL UPDATE statements via
        /// ExecuteUpdateAsync, so a catalog change touching 5,000 lines
        /// completes in one round-trip.
        /// </summary>
        private async Task<ItemTypePropagationSummaryDto> PropagateToLinesAsync(
            ItemType updated, ItemTypeFieldChangeSet changed)
        {
            if (!changed.Any) return new ItemTypePropagationSummaryDto();

            int submittedSkipped = await _context.InvoiceItems
                .Where(ii => ii.ItemTypeId == updated.Id && ii.Invoice.FbrStatus == "Submitted")
                .CountAsync();

            int invoicesUpdated = await _context.InvoiceItems
                .Where(ii => ii.ItemTypeId == updated.Id && ii.Invoice.FbrStatus != "Submitted")
                .ExecuteUpdateAsync(s => s
                    .SetProperty(ii => ii.HSCode,
                        ii => changed.HsCodeChanged ? updated.HSCode : ii.HSCode)
                    .SetProperty(ii => ii.UOM,
                        ii => changed.UomChanged ? (updated.UOM ?? ii.UOM) : ii.UOM)
                    .SetProperty(ii => ii.FbrUOMId,
                        ii => changed.FbrUomIdChanged ? updated.FbrUOMId : ii.FbrUOMId)
                    .SetProperty(ii => ii.SaleType,
                        ii => changed.SaleTypeChanged ? updated.SaleType : ii.SaleType)
                    .SetProperty(ii => ii.ItemTypeName, ii => updated.Name));

            int challansUpdated = await _context.DeliveryItems
                .Where(di => di.ItemTypeId == updated.Id
                          && di.DeliveryChallan.Status != "Cancelled"
                          && (di.DeliveryChallan.Invoice == null
                              || di.DeliveryChallan.Invoice.FbrStatus != "Submitted"))
                .ExecuteUpdateAsync(s => s
                    .SetProperty(di => di.Unit,
                        di => changed.UomChanged ? (updated.UOM ?? di.Unit) : di.Unit));

            return new ItemTypePropagationSummaryDto
            {
                InvoiceItemsUpdated = invoicesUpdated,
                DeliveryItemsUpdated = challansUpdated,
                SubmittedInvoiceLinesSkipped = submittedSkipped,
            };
        }

        // When the controller passes enrichWithCompanyId and the operator hasn't
        // pre-picked a UOM, ask the tax engine for the FBR-published UOM list
        // for this HS code and store the first match. Catalog stays accurate
        // without forcing the user to scroll the global UOM list — and a stale
        // / missing UOM no longer silently drifts the bill into a 0052 error.
        private async Task EnrichFromFbrAsync(ItemTypeDto dto, int? enrichWithCompanyId)
        {
            if (enrichWithCompanyId == null) return;
            if (string.IsNullOrWhiteSpace(dto.HSCode)) return;
            // Only fill blanks — never overwrite a UOM the user explicitly chose.
            if (dto.FbrUOMId.HasValue && !string.IsNullOrWhiteSpace(dto.UOM)) return;

            try
            {
                var suggested = await _taxEngine.SuggestDefaultUomAsync(
                    enrichWithCompanyId.Value, dto.HSCode!);
                if (suggested == null) return;

                if (!dto.FbrUOMId.HasValue)       dto.FbrUOMId = suggested.UOM_ID;
                if (string.IsNullOrWhiteSpace(dto.UOM)) dto.UOM = suggested.Description;
            }
            catch
            {
                // Non-fatal — FBR token may be missing / network down. The
                // operator can still save and pick UOM manually afterwards.
            }
        }

        /// <summary>
        /// HS codes already in use by any existing item type. Frontend passes this
        /// to HsCodeAutocomplete so the FBR catalog search hides codes already saved.
        /// </summary>
        public async Task<List<string>> GetSavedHsCodesAsync()
            => await _repo.GetSavedHsCodesAsync();

        public async Task DeleteAsync(int id)
        {
            var it = await _repo.GetByIdAsync(id);
            if (it == null) throw new KeyNotFoundException("Item type not found.");

            var inUse = await _context.DeliveryItems.AnyAsync(di => di.ItemTypeId == id);
            if (inUse)
                throw new InvalidOperationException($"Cannot delete \"{it.Name}\" — it is used in existing challans.");

            await _repo.DeleteAsync(it);
        }
    }
}

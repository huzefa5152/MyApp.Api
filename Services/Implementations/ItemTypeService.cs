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
        // 2026-05-13: used by Create/Update to validate that a typed
        // HSCode actually exists in PRAL's master catalog. Pre-fix the
        // field was free-text and operators could save garbage that
        // later failed FBR submission with cryptic codes.
        private readonly IFbrService _fbr;

        public ItemTypeService(
            IItemTypeRepository repo,
            AppDbContext context,
            ITaxMappingEngine taxEngine,
            IStockService stock,
            IFbrService fbr)
        {
            _repo = repo;
            _context = context;
            _taxEngine = taxEngine;
            _stock = stock;
            _fbr = fbr;
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
            Dictionary<int, decimal>? onHandByItem = null;

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
                    dto.AvailableQty = onHandByItem.TryGetValue(it.Id, out var q) ? q : 0m;
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
            // Composite (Name, HSCode) uniqueness (2026-05-16). Operators
            // legitimately want "Hardware Items" with HS X AND "Hardware
            // Items" with HS Y as two separate catalog rows, AND "Hardware
            // Items" with no HS code as a draft row alongside both. The DB
            // unique index on (Name, HSCode) is filtered to IsDeleted=0;
            // we mirror its semantics here so the operator gets a clean
            // 400 instead of a SQL 2627 surface error.
            var normalizedHs = string.IsNullOrWhiteSpace(dto.HSCode) ? null : dto.HSCode!.Trim();
            if (await _repo.ExistsByNameAndHsCodeAsync(dto.Name, normalizedHs))
                throw new InvalidOperationException(
                    normalizedHs == null
                        ? $"An item named \"{dto.Name}\" without an HS code already exists. Either edit the existing row, or add an HS code to differentiate this one."
                        : $"An item named \"{dto.Name}\" with HS code {normalizedHs} already exists.");

            // 2026-05-13: validate the HS code against PRAL's master
            // catalog. Empty HSCode is allowed — the row is "draft" /
            // un-classified and won't move stock or submit to FBR until
            // a real code is added. A non-empty value MUST match the
            // catalog (or pass the format gate on a fresh-tenant fallback).
            await ValidateHsCodeOrThrowAsync(dto.HSCode, enrichWithCompanyId);

            // Near-duplicate (mis-spelled) name guard. Now scoped to
            // matching-HSCode pairs only — "Hardware Items" + HS X and
            // "Hardware Item" + HS Y are intentional separate rows, but
            // "Hardware Items" + HS X and "Hardware Item" + HS X is the
            // typo-splits-the-catalog scenario the original guard caught.
            // dto.IsFavorite still acts as the explicit override knob.
            var nearMatch = await FindNearDuplicateAsync(dto.Name, normalizedHs, exceptId: null);
            if (nearMatch != null && !dto.IsFavorite)
                throw new InvalidOperationException(
                    $"\"{dto.Name}\" looks like a near-duplicate of existing item " +
                    $"\"{nearMatch.Name}\" (HS {nearMatch.HSCode ?? "—"}). " +
                    "Pick the existing row, OR mark this new row as Favorite " +
                    "to confirm you want both.");

            await EnrichFromFbrAsync(dto, enrichWithCompanyId);
            await EnsureUnitRowAsync(dto.UOM);

            var created = await _repo.CreateAsync(new ItemType
            {
                Name = dto.Name,
                HSCode = normalizedHs,
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

        /// <summary>
        /// Find an existing Item Type whose name is "too close" to the
        /// proposed name. Used by Create/Update to prevent operators
        /// from accidentally splitting a catalog row.
        ///
        /// Match rules (cheap; no Levenshtein library needed):
        ///   • Exact match on case-folded trim
        ///   • Singular/plural drift — strip a trailing "s" / "es" from
        ///     either side and re-compare
        ///   • One-character edit distance for names ≥ 4 chars (catches
        ///     typos like "Hardware Items" vs "Hardwre Items")
        ///
        /// Returns null when the proposed name is genuinely new.
        /// </summary>
        private async Task<ItemType?> FindNearDuplicateAsync(string? proposedName, string? proposedHsCode, int? exceptId)
        {
            var trimmed = (proposedName ?? "").Trim();
            if (trimmed.Length == 0) return null;
            var rows = await _repo.GetAllAsync();
            string Norm(string s) => s.Trim().ToLowerInvariant();
            string Singularize(string s)
            {
                var t = Norm(s);
                if (t.EndsWith("es") && t.Length > 3) return t.Substring(0, t.Length - 2);
                if (t.EndsWith("s")  && t.Length > 2) return t.Substring(0, t.Length - 1);
                return t;
            }
            int OneEditDistance(string a, string b)
            {
                if (a == b) return 0;
                if (Math.Abs(a.Length - b.Length) > 1) return 2;
                int i = 0, j = 0, edits = 0;
                while (i < a.Length && j < b.Length)
                {
                    if (a[i] == b[j]) { i++; j++; continue; }
                    edits++;
                    if (edits > 1) return 2;
                    if (a.Length == b.Length) { i++; j++; }
                    else if (a.Length < b.Length) j++;
                    else i++;
                }
                if (i < a.Length || j < b.Length) edits++;
                return edits;
            }
            // HSCode is now part of the catalog identity, so the near-dup
            // guard must compare on it too — "Hardware Items" + HS X is
            // intentionally different from "Hardware Item" + HS Y (the
            // operator is splitting the catalog along the HS axis). Only
            // flag near-matches when both rows would share the same HS
            // (including both being NULL).
            var pNorm = Norm(trimmed);
            var pSing = Singularize(trimmed);
            var pHs = string.IsNullOrWhiteSpace(proposedHsCode) ? null : proposedHsCode.Trim();
            foreach (var row in rows)
            {
                if (exceptId.HasValue && row.Id == exceptId.Value) continue;
                var rHs = string.IsNullOrWhiteSpace(row.HSCode) ? null : row.HSCode!.Trim();
                if (!string.Equals(rHs, pHs, StringComparison.OrdinalIgnoreCase)) continue;
                var rNorm = Norm(row.Name);
                if (rNorm == pNorm) return row;
                if (Singularize(row.Name) == pSing) return row;
                if (pNorm.Length >= 4 && rNorm.Length >= 4 && OneEditDistance(pNorm, rNorm) <= 1) return row;
            }
            return null;
        }

        public async Task<ItemTypeDto?> UpdateAsync(int id, ItemTypeDto dto, int? enrichWithCompanyId = null)
        {
            var it = await _repo.GetByIdAsync(id);
            if (it == null) return null;
            if (it.IsDeleted)
                throw new InvalidOperationException($"\"{it.Name}\" is deleted — restore it first before editing.");

            var normalizedHs = string.IsNullOrWhiteSpace(dto.HSCode) ? null : dto.HSCode!.Trim();
            if (await _repo.ExistsByNameAndHsCodeAsync(dto.Name, normalizedHs, id))
                throw new InvalidOperationException(
                    normalizedHs == null
                        ? $"Another item named \"{dto.Name}\" without an HS code already exists."
                        : $"Another item named \"{dto.Name}\" with HS code {normalizedHs} already exists.");

            // 2026-05-13: only validate the HS code if it actually changed —
            // a re-save with the same code should never get blocked even if
            // the catalog goes briefly empty. Empty HSCode is allowed
            // (un-classified placeholder).
            if (!StringEq(it.HSCode, normalizedHs))
                await ValidateHsCodeOrThrowAsync(normalizedHs, enrichWithCompanyId);

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
            it.HSCode = normalizedHs;
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

        /// <summary>
        /// Throws when <paramref name="hsCode"/> is non-empty but not
        /// present in PRAL's HS-code catalog. Null/empty HSCode is OK —
        /// the row is treated as a draft / un-classified placeholder and
        /// is intentionally excluded from stock tracking + FBR
        /// submission until a real code is added later.
        ///
        /// Falls back to format-only validation when the catalog can't
        /// be loaded (fresh tenant, no FBR token anywhere yet) — that
        /// fallback path is logged by FbrService.IsKnownHsCodeAsync.
        /// </summary>
        private async Task ValidateHsCodeOrThrowAsync(string? hsCode, int? companyIdHint)
        {
            if (string.IsNullOrWhiteSpace(hsCode)) return;
            // Use the supplied companyId when available; otherwise pick
            // ANY existing company so the catalog-load path has SOME
            // token to try. The FbrService donor-refusal guard (audit
            // H-9) does NOT fire on read-only catalog fetches that are
            // attributed to the same tenant the data is for — and the
            // catalog is global, so the choice of company doesn't leak
            // anything.
            var companyId = companyIdHint;
            if (companyId == null)
            {
                companyId = await _context.Companies
                    .OrderBy(c => c.Id)
                    .Select(c => (int?)c.Id)
                    .FirstOrDefaultAsync();
            }
            if (companyId == null) return; // brand-new install with no companies — nothing to validate against

            var ok = await _fbr.IsKnownHsCodeAsync(companyId.Value, hsCode!);
            if (!ok)
            {
                throw new InvalidOperationException(
                    $"HS Code '{hsCode}' is not in PRAL's master catalog. " +
                    "Pick a code from the FBR autocomplete instead of typing it freehand — " +
                    "an unrecognised code will be rejected by FBR with error code [0007] at submission time.");
            }
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
            if (it.IsDeleted) return; // idempotent — already gone from the catalog

            // Delete rule (2026-05-16): block ONLY when there's still
            // pending work that depends on the row. Anything already
            // FBR-submitted is locked-and-historical — the InvoiceItem
            // / PurchaseItem rows carry their own HSCode + UOM + SaleType
            // snapshot fields, so the bill print + tax claim still show
            // correct data after the catalog row goes away.
            //
            //   Block if:
            //     • Any InvoiceItem points at this ItemType AND its Invoice
            //       is not yet FBR-Submitted (operator still owes FBR a
            //       submission for that bill — deleting the catalog row
            //       would orphan the bill's HSCode source for that flow).
            //     • Any DeliveryItem points at this ItemType AND the
            //       challan is still open (Invoice == null) OR its bill
            //       is unsubmitted.
            //   PurchaseItem / StockMovement do not block — purchase
            //   bills are inbound (no FBR submission of our own), and
            //   StockMovements carry the qty data we need regardless.
            var hasPendingInvoiceLine = await _context.InvoiceItems
                .AnyAsync(ii => ii.ItemTypeId == id && ii.Invoice.FbrStatus != "Submitted");
            var hasPendingChallanLine = await _context.DeliveryItems
                .AnyAsync(di => di.ItemTypeId == id
                              && di.DeliveryChallan.Status != "Cancelled"
                              && (di.DeliveryChallan.Invoice == null
                                  || di.DeliveryChallan.Invoice.FbrStatus != "Submitted"));
            if (hasPendingInvoiceLine || hasPendingChallanLine)
                throw new InvalidOperationException(
                    $"Cannot delete \"{it.Name}\" — it's referenced by a bill or challan that hasn't been submitted to FBR yet. " +
                    "Submit or cancel those documents first, then try again.");

            await _repo.DeleteAsync(it);
        }
    }
}

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
    public class DeliveryChallanService : IDeliveryChallanService
    {
        private readonly IDeliveryChallanRepository _repository;
        private readonly AppDbContext _context;
        private readonly ILogger<DeliveryChallanService> _logger;

        public DeliveryChallanService(IDeliveryChallanRepository repository, AppDbContext context, ILogger<DeliveryChallanService> logger)
        {
            _repository = repository;
            _context = context;
            _logger = logger;
        }

        /// <summary>
        /// Defence-in-depth check: reject fractional quantities (e.g. 2.5
        /// Pcs) for any line whose UOM has AllowsDecimalQuantity = false.
        /// The frontend gates this via step="1" on the input, but a hand-
        /// rolled API call could still POST a fraction — this is the
        /// last-line guard. Throws InvalidOperationException so the
        /// controller layer surfaces a 400 with a clear message.
        /// </summary>
        private async Task ValidateDecimalQuantitiesAsync<T>(IEnumerable<T> items,
            Func<T, string?> getUnit, Func<T, decimal> getQty)
        {
            var unitNames = items
                .Select(getUnit)
                .Where(u => !string.IsNullOrWhiteSpace(u))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList()!;
            if (unitNames.Count == 0) return;

            // Build a lookup: lowercase unit name → AllowsDecimalQuantity
            var unitConfig = await _context.Units
                .Where(u => unitNames.Contains(u.Name))
                .Select(u => new { u.Name, u.AllowsDecimalQuantity })
                .ToListAsync();
            var allowsDecimal = unitConfig.ToDictionary(
                u => u.Name, u => u.AllowsDecimalQuantity,
                StringComparer.OrdinalIgnoreCase);

            foreach (var item in items)
            {
                var unit = getUnit(item) ?? "";
                var qty = getQty(item);
                // If the unit isn't in the table, skip — operator-typed
                // ad-hoc unit, no config to enforce. If qty is whole, skip.
                if (qty == Math.Truncate(qty)) continue;
                if (!allowsDecimal.TryGetValue(unit, out var allows) || !allows)
                {
                    throw new InvalidOperationException(
                        $"Quantity '{qty}' for unit '{unit}' must be a whole number. " +
                        $"Enable decimal quantity for this unit on the Units admin page if fractions are allowed.");
                }
            }
        }

        /// <summary>Check if company+client have all required FBR fields filled.</summary>
        private static bool IsFbrReady(Company company, Client client)
        {
            // Company fields
            if (string.IsNullOrWhiteSpace(company.NTN)) return false;
            if (string.IsNullOrWhiteSpace(company.STRN)) return false;
            if (company.FbrProvinceCode == null) return false;
            if (string.IsNullOrWhiteSpace(company.FbrBusinessActivity)) return false;
            if (string.IsNullOrWhiteSpace(company.FbrSector)) return false;
            if (string.IsNullOrWhiteSpace(company.FbrToken)) return false;
            if (string.IsNullOrWhiteSpace(company.FbrEnvironment)) return false;

            // Client fields
            if (string.IsNullOrWhiteSpace(client.NTN)) return false;
            if (string.IsNullOrWhiteSpace(client.STRN)) return false;
            if (string.IsNullOrWhiteSpace(client.RegistrationType)) return false;
            if (client.FbrProvinceCode == null) return false;
            // CNIC required for Unregistered/CNIC registration types
            if ((client.RegistrationType == "Unregistered" || client.RegistrationType == "CNIC")
                && string.IsNullOrWhiteSpace(client.CNIC)) return false;

            return true;
        }

        private static DeliveryChallanDto ToDto(DeliveryChallan dc)
        {
            var dto = new DeliveryChallanDto
            {
                Id = dc.Id,
                ChallanNumber = dc.ChallanNumber,
                CompanyId = dc.CompanyId,
                ClientId = dc.ClientId,
                ClientName = dc.Client?.Name ?? "",
                PoNumber = dc.PoNumber,
                PoDate = dc.PoDate,
                IndentNo = dc.IndentNo,
                DeliveryDate = dc.DeliveryDate,
                Site = dc.Site,
                Status = dc.Status,
                InvoiceId = dc.InvoiceId,
                InvoiceFbrStatus = dc.Invoice?.FbrStatus,
                IsEditable = IsEditable(dc),
                IsImported = dc.IsImported,
                DuplicatedFromId = dc.DuplicatedFromId,
                DuplicatedFromChallanNumber = dc.DuplicatedFrom?.ChallanNumber,
                Items = dc.Items.Select(i => new DeliveryItemDto
                {
                    Id = i.Id,
                    ItemTypeId = i.ItemTypeId,
                    ItemTypeName = i.ItemType?.Name ?? "",
                    Description = i.Description,
                    Quantity = i.Quantity,
                    Unit = i.Unit
                }).ToList()
            };

            // Compute warnings for missing FBR fields
            var company = dc.Company;
            var client = dc.Client;
            if (company != null)
            {
                if (string.IsNullOrWhiteSpace(company.NTN)) dto.Warnings.Add("Company NTN missing");
                if (string.IsNullOrWhiteSpace(company.STRN)) dto.Warnings.Add("Company STRN missing");
                if (company.FbrProvinceCode == null) dto.Warnings.Add("Company FBR Province missing");
                if (string.IsNullOrWhiteSpace(company.FbrBusinessActivity)) dto.Warnings.Add("Company Business Activity missing");
                if (string.IsNullOrWhiteSpace(company.FbrSector)) dto.Warnings.Add("Company Sector missing");
                if (string.IsNullOrWhiteSpace(company.FbrToken)) dto.Warnings.Add("Company FBR Token missing");
                if (string.IsNullOrWhiteSpace(company.FbrEnvironment)) dto.Warnings.Add("Company FBR Environment missing");
            }
            if (client != null)
            {
                if (string.IsNullOrWhiteSpace(client.NTN)) dto.Warnings.Add("Client NTN missing");
                if (string.IsNullOrWhiteSpace(client.STRN)) dto.Warnings.Add("Client STRN missing");
                if (string.IsNullOrWhiteSpace(client.RegistrationType)) dto.Warnings.Add("Client Registration Type missing");
                if (client.FbrProvinceCode == null) dto.Warnings.Add("Client FBR Province missing");
                if ((client.RegistrationType == "Unregistered" || client.RegistrationType == "CNIC")
                    && string.IsNullOrWhiteSpace(client.CNIC)) dto.Warnings.Add("Client CNIC missing");
            }

            return dto;
        }

        /// <summary>
        /// Returns true if the challan is in an editable state.
        /// Editable: Pending, Imported, No PO, Setup Required, OR Invoiced
        /// (as long as linked invoice has NOT been successfully submitted to FBR).
        /// Only blocked for: Cancelled, or Invoiced with FbrStatus == "Submitted".
        ///
        /// "Imported" is the counterpart of "Pending" for historical challans
        /// loaded via the bulk Excel import. Both statuses are billable.
        /// </summary>
        private static bool IsEditable(DeliveryChallan dc)
        {
            if (dc.Status == "Pending" || dc.Status == "Imported" ||
                dc.Status == "No PO" || dc.Status == "Setup Required")
                return true;
            if (dc.Status == "Invoiced")
            {
                // Editable only if linked invoice is NOT FBR-submitted
                return dc.Invoice?.FbrStatus != "Submitted";
            }
            // Cancelled and any other unknown status → not editable
            return false;
        }

        /// <summary>
        /// Native-created challans settle at "Pending" when FBR-ready + PO.
        /// Historical/imported challans settle at "Imported" in the same
        /// situation so reports can tell the two populations apart. Both are
        /// billable.
        ///
        /// Detection: (a) the explicit IsImported flag set by the bulk import
        /// flow OR (b) the challan's number is below the company's current
        /// starting number — which is the definition of "historical" per the
        /// operator. The fallback (b) covers legacy rows that predate the
        /// IsImported column; without it, editing an old challan to add a PO
        /// would incorrectly demote it to "Pending".
        /// </summary>
        private static string ReadyStatusFor(DeliveryChallan dc)
        {
            if (dc.IsImported) return "Imported";
            var company = dc.Company;
            if (company != null
                && company.StartingChallanNumber > 0
                && dc.ChallanNumber > 0
                && dc.ChallanNumber < company.StartingChallanNumber)
                return "Imported";
            return "Pending";
        }

        public async Task<List<DeliveryChallanDto>> GetDeliveryChallansByCompanyAsync(int companyId)
        {
            var challans = await _repository.GetDeliveryChallansByCompanyAsync(companyId);
            return challans.Select(ToDto).ToList();
        }

        public async Task<PagedResult<DeliveryChallanDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, string? status = null,
            int? clientId = null, DateTime? dateFrom = null, DateTime? dateTo = null)
        {
            // Auto-clear "Setup Required" challans where FBR is now ready (runs once per page load)
            await ReEvaluateSetupRequiredAsync(companyId);

            var (items, totalCount) = await _repository.GetPagedByCompanyAsync(
                companyId, page, pageSize, search, status, clientId, dateFrom, dateTo);

            // Gate the Delete button client-side — only the highest-numbered
            // challan for this company is deletable.
            var maxNumber = await _context.DeliveryChallans
                .Where(c => c.CompanyId == companyId)
                .MaxAsync(c => (int?)c.ChallanNumber) ?? 0;

            var dtos = items.Select(ToDto).ToList();
            foreach (var d in dtos)
                d.IsLatest = d.ChallanNumber == maxNumber;

            return new PagedResult<DeliveryChallanDto>
            {
                Items = dtos,
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize
            };
        }

        public async Task<DeliveryChallanDto?> GetByIdAsync(int id)
        {
            var dc = await _repository.GetByIdAsync(id);
            return dc == null ? null : ToDto(dc);
        }

        public async Task<DeliveryChallanDto> CreateDeliveryChallanAsync(int companyId, DeliveryChallanDto dto)
        {
            // Make sure any new unit name typed by the operator gets a
            // Units row so it shows up on the Units admin screen (default
            // integer-only; admin flips the decimal flag if needed).
            // Runs BEFORE the decimal validation so the validation lookup
            // sees the row we just inserted.
            await UnitRegistry.EnsureNamesAsync(_context, dto.Items?.Select(i => i.Unit) ?? Enumerable.Empty<string>());

            // Reject fractional qty for integer-only UOMs before any other
            // work — keeps the early failure path cheap and clear.
            await ValidateDecimalQuantitiesAsync(dto.Items, i => i.Unit, i => i.Quantity);

            var hasPo = !string.IsNullOrWhiteSpace(dto.PoNumber);

            // Determine status based on FBR readiness
            var company = await _context.Companies.FindAsync(companyId);
            var client = await _context.Clients.FindAsync(dto.ClientId);
            var fbrReady = company != null && client != null && IsFbrReady(company, client);

            string status;
            if (!fbrReady)
                status = "Setup Required";
            else if (hasPo)
                status = "Pending";
            else
                status = "No PO";

            var deliveryChallan = new DeliveryChallan
            {
                CompanyId = companyId,
                ClientId = dto.ClientId,
                Site = dto.Site,
                PoNumber = dto.PoNumber?.Trim() ?? "",
                PoDate = hasPo ? dto.PoDate : null,
                IndentNo = string.IsNullOrWhiteSpace(dto.IndentNo) ? null : dto.IndentNo.Trim(),
                DeliveryDate = dto.DeliveryDate,
                Status = status,
                Items = dto.Items.Select(i => new DeliveryItem
                {
                    ItemTypeId = i.ItemTypeId,
                    Description = i.Description,
                    Quantity = i.Quantity,
                    Unit = i.Unit
                }).ToList()
            };

            var created = await _repository.CreateDeliveryChallanAsync(deliveryChallan);

            // Upsert ItemDescription rows for any new item names. This makes
            // PO-imported items immediately visible in the bill form's
            // SmartItemAutocomplete dropdown — operators no longer have to
            // edit the challan and re-pick each item from the catalog before
            // the items show up. Existing ItemDescription rows are left
            // untouched (we don't want to clobber saved FBR defaults).
            await EnsureItemDescriptionsAsync(dto.Items.Select(i => i.Description));

            return ToDto(created);
        }

        private async Task EnsureItemDescriptionsAsync(IEnumerable<string?> descriptions)
        {
            var names = descriptions
                .Select(d => d?.Trim() ?? "")
                .Where(d => !string.IsNullOrWhiteSpace(d))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (names.Count == 0) return;

            var existing = await _context.ItemDescriptions
                .Where(it => names.Contains(it.Name))
                .Select(it => it.Name)
                .ToListAsync();
            var existingSet = new HashSet<string>(existing, StringComparer.OrdinalIgnoreCase);
            var toAdd = names.Where(n => !existingSet.Contains(n))
                             .Select(n => new ItemDescription { Name = n })
                             .ToList();
            if (toAdd.Count == 0) return;
            _context.ItemDescriptions.AddRange(toAdd);
            await _context.SaveChangesAsync();
        }

        public async Task<DeliveryChallanDto?> UpdateItemsAsync(int challanId, List<DeliveryItemDto> items)
        {
            var dc = await _repository.GetByIdAsync(challanId);
            if (dc == null) return null;
            if (!IsEditable(dc))
            {
                if (dc.Status == "Invoiced" && dc.Invoice?.FbrStatus == "Submitted")
                    throw new InvalidOperationException("Cannot edit items on a challan whose bill has been submitted to FBR.");
                if (dc.Status == "Cancelled")
                    throw new InvalidOperationException("Cannot edit items on a cancelled challan.");
                throw new InvalidOperationException("Challan is not in an editable state.");
            }

            await using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                await ApplyItemsDiffAsync(dc, items);
                await _repository.UpdateAsync(dc);

                // Same upsert as on create — newly added item descriptions
                // surface in the bill autocomplete without a manual round-trip.
                await EnsureItemDescriptionsAsync(items.Select(i => i.Description));

                await transaction.CommitAsync();

                var reloaded = await _repository.GetByIdAsync(challanId);
                return reloaded == null ? null : ToDto(reloaded);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "UpdateItemsAsync transaction failed for challan {ChallanId}", challanId);
                await transaction.RollbackAsync();
                throw;
            }
        }

        /// <summary>
        /// Diff-then-sync items update. Computes additions/updates/removals
        /// against <paramref name="dc"/>.Items, mutates existing rows in place,
        /// adds new rows to dc.Items, syncs the linked invoice (when one is
        /// linked and not yet FBR-submitted), then hard-deletes the removed
        /// rows via the repository.
        ///
        /// Callers own the surrounding transaction and the final
        /// <c>UpdateAsync(dc)</c>. Two callers — <see cref="UpdateItemsAsync"/>
        /// (items-only PUT) and <see cref="UpdateChallanAsync"/> (whole-
        /// challan PUT) — share this helper so both paths sync the bill the
        /// same way. Before this consolidation, UpdateChallanAsync did a
        /// blanket RemoveRange + rebuild that orphaned linked InvoiceItems
        /// (FK cascade SET NULL) without ever creating matching items on the
        /// bill — bills got stuck out of sync with their challans.
        /// </summary>
        private async Task ApplyItemsDiffAsync(DeliveryChallan dc, List<DeliveryItemDto> items)
        {
            var updatedIds = items.Where(i => i.Id > 0).Select(i => i.Id).ToHashSet();
            var toRemove = dc.Items.Where(i => !updatedIds.Contains(i.Id)).ToList();
            var removedDeliveryItemIds = toRemove.Select(i => i.Id).ToList();

            var quantityChanges = new Dictionary<int, decimal>(); // deliveryItemId → newQuantity
            var newItems = new List<DeliveryItem>();

            foreach (var itemDto in items)
            {
                var existing = dc.Items.FirstOrDefault(i => i.Id == itemDto.Id && itemDto.Id > 0);
                if (existing != null)
                {
                    if (existing.Quantity != itemDto.Quantity ||
                        existing.Description != itemDto.Description ||
                        existing.Unit != itemDto.Unit)
                    {
                        quantityChanges[existing.Id] = itemDto.Quantity;
                    }
                    existing.ItemTypeId = itemDto.ItemTypeId;
                    existing.Description = itemDto.Description;
                    existing.Quantity = itemDto.Quantity;
                    existing.Unit = itemDto.Unit;
                }
                else
                {
                    var newItem = new DeliveryItem
                    {
                        DeliveryChallanId = dc.Id,
                        ItemTypeId = itemDto.ItemTypeId,
                        Description = itemDto.Description,
                        Quantity = itemDto.Quantity,
                        Unit = itemDto.Unit
                    };
                    dc.Items.Add(newItem);
                    newItems.Add(newItem);
                }
            }

            // ── Sync linked invoice items BEFORE deleting delivery items ──
            // EF's FK cascade (SET NULL on InvoiceItem.DeliveryItemId) would
            // otherwise null the FKs and prevent the sync from matching items.
            if (dc.InvoiceId.HasValue && dc.Invoice != null && dc.Invoice.FbrStatus != "Submitted")
            {
                await SyncInvoiceItemsForChallanEditAsync(dc, removedDeliveryItemIds, quantityChanges, newItems);
            }

            // Now it's safe to delete removed delivery items
            foreach (var item in toRemove)
                await _repository.DeleteItemAsync(item);
        }

        /// <summary>
        /// Syncs invoice items when the linked challan's items change:
        ///  - removes invoice items whose delivery item was deleted
        ///  - updates quantity/description/uom where the delivery item changed
        ///  - adds new invoice items with UnitPrice=0 (user must edit bill to set prices)
        /// Recalculates subtotal, GST, grand total and amount-in-words.
        ///
        /// IMPORTANT: Must run BEFORE EF deletes the removed DeliveryItems, because
        /// the FK cascade sets InvoiceItem.DeliveryItemId = NULL on delete, which
        /// prevents matching removed items afterwards.
        /// For newly-added DeliveryItems, their Id may be 0 at this point if the
        /// caller hasn't saved them yet — in that case we use the reference identity
        /// to populate FK once EF assigns IDs on SaveChangesAsync().
        /// </summary>
        private async Task SyncInvoiceItemsForChallanEditAsync(
            DeliveryChallan dc,
            List<int> removedDeliveryItemIds,
            Dictionary<int, decimal> quantityChanges,
            List<DeliveryItem> newlyAddedDeliveryItems)
        {
            var invoice = await _context.Invoices
                .Include(i => i.Items)
                .FirstOrDefaultAsync(i => i.Id == dc.InvoiceId!.Value);
            if (invoice == null) return;

            // Remove invoice items linked to deleted delivery items
            if (removedDeliveryItemIds.Count > 0)
            {
                var toRemove = invoice.Items
                    .Where(ii => ii.DeliveryItemId.HasValue && removedDeliveryItemIds.Contains(ii.DeliveryItemId.Value))
                    .ToList();
                foreach (var ii in toRemove)
                {
                    _context.InvoiceItems.Remove(ii);
                    invoice.Items.Remove(ii);
                }
            }

            // Update invoice items whose delivery items had quantity/description changed
            foreach (var (deliveryItemId, newQty) in quantityChanges)
            {
                var invItem = invoice.Items.FirstOrDefault(ii => ii.DeliveryItemId == deliveryItemId);
                var deliveryItem = dc.Items.FirstOrDefault(di => di.Id == deliveryItemId);
                if (invItem != null && deliveryItem != null)
                {
                    invItem.Quantity = newQty;
                    invItem.UOM = deliveryItem.Unit;
                    // keep existing description if invoice description was custom; otherwise sync
                    if (string.IsNullOrWhiteSpace(invItem.Description) || invItem.Description == deliveryItem.Description)
                        invItem.Description = deliveryItem.Description;
                    invItem.LineTotal = Math.Round(newQty * invItem.UnitPrice, 2);
                }
            }

            // Add invoice items for newly-added delivery items (with UnitPrice=0 — user must edit).
            // Use navigation property instead of DeliveryItemId so EF auto-populates the FK
            // when IDs are assigned on SaveChangesAsync.
            foreach (var newDi in newlyAddedDeliveryItems)
            {
                invoice.Items.Add(new InvoiceItem
                {
                    InvoiceId = invoice.Id,
                    DeliveryItem = newDi,  // navigation → EF picks up the generated FK
                    ItemTypeName = newDi.ItemType?.Name ?? "",
                    Description = newDi.Description,
                    Quantity = newDi.Quantity,
                    UOM = newDi.Unit,
                    UnitPrice = 0m,
                    LineTotal = 0m
                });
            }

            // Recalculate totals
            invoice.Subtotal = invoice.Items.Sum(ii => ii.LineTotal);
            invoice.GSTAmount = Math.Round(invoice.Subtotal * invoice.GSTRate / 100, 2);
            invoice.GrandTotal = invoice.Subtotal + invoice.GSTAmount;
            invoice.AmountInWords = Helpers.NumberToWordsConverter.Convert(invoice.GrandTotal);

            // If any invoice item now has UnitPrice=0, mark FBR status as needing re-validation
            if (invoice.Items.Any(ii => ii.UnitPrice == 0m) && invoice.FbrStatus != "Submitted")
            {
                invoice.FbrStatus = null; // require re-validate
            }

            await _context.SaveChangesAsync();
        }

        public async Task<bool> CancelAsync(int challanId)
        {
            var dc = await _repository.GetByIdAsync(challanId);
            if (dc == null) return false;
            // Cannot cancel a billed challan (even if invoice is not FBR-submitted, cancelling would leave invoice in bad state)
            if (dc.Status == "Invoiced")
                throw new InvalidOperationException("Cannot cancel a challan that has been billed. Delete the bill first to revert the challan.");
            if (!IsEditable(dc))
                throw new InvalidOperationException("Can only cancel Pending, No PO, or Setup Required challans.");

            dc.Status = "Cancelled";
            await _repository.UpdateAsync(dc);
            return true;
        }

        public async Task<bool> DeleteAsync(int challanId)
        {
            var dc = await _repository.GetByIdAsync(challanId);
            if (dc == null) return false;
            if (dc.Status == "Invoiced")
                throw new InvalidOperationException("Cannot delete a challan that has been billed. Delete the bill first to revert the challan.");
            if (!IsEditable(dc))
                throw new InvalidOperationException("Can only delete Pending, No PO, or Setup Required challans.");

            // 2026-05-08: carve-out for duplicates. They share the parent's
            // ChallanNumber, so deleting a duplicate doesn't create a gap in
            // the numbering sequence — the original keeps the number. The
            // max-number rule below only applies to canonical (non-duplicate)
            // challans.
            var isDuplicate = dc.DuplicatedFromId != null;
            if (!isDuplicate)
            {
                // Only the LAST challan (highest number) can be deleted so the
                // numbering sequence stays gap-free. If someone tries to delete
                // an earlier one, they should edit it instead.
                var maxNumber = await _context.DeliveryChallans
                    .Where(c => c.CompanyId == dc.CompanyId)
                    .MaxAsync(c => (int?)c.ChallanNumber) ?? 0;
                if (dc.ChallanNumber != maxNumber)
                    throw new InvalidOperationException(
                        $"Only the latest challan can be deleted (currently #{maxNumber}). " +
                        $"To change challan #{dc.ChallanNumber}, edit it instead — " +
                        "deleting earlier challans would leave gaps in the numbering.");
            }

            var companyId = dc.CompanyId;
            await _repository.DeleteAsync(dc);

            // If this was the last challan for the company, reset the counter
            // so the operator can re-seed challan numbering. Same rationale as
            // the equivalent invoice-delete reset — keeps the "Starting number"
            // UI field semantically honest once unlocked.
            var anyChallansLeft = await _context.DeliveryChallans.AnyAsync(x => x.CompanyId == companyId);
            if (!anyChallansLeft)
            {
                var company = await _context.Companies.FindAsync(companyId);
                if (company != null && company.CurrentChallanNumber != 0)
                {
                    company.CurrentChallanNumber = 0;
                    _context.Companies.Update(company);
                    await _context.SaveChangesAsync();
                }
            }

            return true;
        }

        public async Task<int?> GetCompanyForItemAsync(int itemId)
        {
            // Lightweight lookup used by the controller for tenant
            // authorization before delete (audit H-2). Returns null when
            // the item doesn't exist.
            var item = await _repository.GetItemByIdAsync(itemId);
            if (item == null) return null;
            var dc = await _repository.GetByIdAsync(item.DeliveryChallanId);
            return dc?.CompanyId;
        }

        public async Task<bool> DeleteItemAsync(int itemId)
        {
            var item = await _repository.GetItemByIdAsync(itemId);
            if (item == null) return false;
            // Reload with Invoice included for proper edit check
            var dc = await _repository.GetByIdAsync(item.DeliveryChallanId);
            if (dc == null) return false;
            if (!IsEditable(dc))
            {
                if (dc.Status == "Invoiced" && dc.Invoice?.FbrStatus == "Submitted")
                    throw new InvalidOperationException("Cannot delete items from a challan whose bill has been submitted to FBR.");
                throw new InvalidOperationException("Challan is not in an editable state.");
            }

            await using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                // IMPORTANT: Sync invoice BEFORE deleting the delivery item — otherwise
                // EF's FK cascade (SET NULL) would null out InvoiceItem.DeliveryItemId and
                // the sync would no longer find the matching invoice items.
                if (dc.InvoiceId.HasValue && dc.Invoice != null && dc.Invoice.FbrStatus != "Submitted")
                {
                    await SyncInvoiceItemsForChallanEditAsync(
                        dc,
                        new List<int> { itemId },
                        new Dictionary<int, decimal>(),
                        new List<DeliveryItem>());
                }

                await _repository.DeleteItemAsync(item);

                await transaction.CommitAsync();
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "DeleteItemAsync transaction failed for challan {ChallanId} item {ItemId}", dc.Id, itemId);
                await transaction.RollbackAsync();
                throw;
            }
        }

        /// <summary>
        /// Consolidated edit flow for a challan. Accepts any of:
        ///   • ClientId          — switch to a different buyer
        ///   • Site              — new delivery site (from client's site list)
        ///   • DeliveryDate      — corrected/rescheduled delivery
        ///   • PoNumber          — set/update/CLEAR (empty string → transitions to "No PO")
        ///   • PoDate            — paired with PO number
        ///   • Items             — full replacement of line items
        ///
        /// Status handling mirrors creation:
        ///   • If challan is already linked to a SUBMITTED bill        → refuse
        ///   • If Cancelled                                            → refuse
        ///   • Otherwise recompute from (FBR readiness + hasPo):
        ///         FBR-ready + hasPo  → Pending
        ///         FBR-ready + no-po  → No PO
        ///         !FBR-ready         → Setup Required
        ///     Invoiced (with non-submitted bill) keeps status = "Invoiced" so
        ///     the bill relationship isn't silently invalidated; the bill
        ///     inherits the edits via existing delivery-item sync logic.
        /// </summary>
        public async Task<DeliveryChallanDto?> UpdateChallanAsync(int challanId, DeliveryChallanDto dto)
        {
            var dc = await _repository.GetByIdAsync(challanId);
            if (dc == null) return null;

            // Editability guard (same rules as IsEditable() but explicit here so
            // the operator gets a useful error instead of a silent no-op).
            if (dc.Status == "Cancelled")
                throw new InvalidOperationException("Cannot edit a cancelled challan.");
            if (dc.Status == "Invoiced" && dc.Invoice?.FbrStatus == "Submitted")
                throw new InvalidOperationException("Cannot edit a challan whose bill has been submitted to FBR.");

            // Auto-register any new unit names so they appear on the Units
            // admin screen, then reject fractional qty for integer-only UOMs.
            if (dto.Items != null && dto.Items.Any())
            {
                await UnitRegistry.EnsureNamesAsync(_context, dto.Items.Select(i => i.Unit));
                await ValidateDecimalQuantitiesAsync(dto.Items, i => i.Unit, i => i.Quantity);
            }

            // Validate the incoming client — must exist and belong to the same company
            if (dto.ClientId > 0 && dto.ClientId != dc.ClientId)
            {
                var newClient = await _context.Clients.FindAsync(dto.ClientId);
                if (newClient == null)
                    throw new InvalidOperationException($"Client {dto.ClientId} not found.");
                if (newClient.CompanyId != dc.CompanyId)
                    throw new InvalidOperationException($"Client {dto.ClientId} does not belong to this company.");
                dc.ClientId = dto.ClientId;
                dc.Client = newClient;
            }

            if (dto.DeliveryDate.HasValue) dc.DeliveryDate = dto.DeliveryDate.Value;

            // Site: null or empty string clears it
            dc.Site = string.IsNullOrWhiteSpace(dto.Site) ? null : dto.Site.Trim();

            // PO: empty/whitespace = operator wants to clear the PO (→ No PO status)
            var poNumber = (dto.PoNumber ?? "").Trim();
            var hasPo = !string.IsNullOrWhiteSpace(poNumber);
            dc.PoNumber = poNumber;
            dc.PoDate = hasPo ? dto.PoDate : null;

            // Indent No is independent of PO — operators may set/clear it
            // even when there's no PO (e.g. internal indents that pre-date
            // a customer PO). Empty string clears it back to null so the
            // print template's {{#if indentNo}} block hides correctly.
            dc.IndentNo = string.IsNullOrWhiteSpace(dto.IndentNo) ? null : dto.IndentNo.Trim();

            await using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                // Items: diff-based update so the linked bill stays in sync.
                // Earlier this block did a blanket RemoveRange + rebuild that
                // silently broke any linked InvoiceItems (FK cascade SET NULL)
                // without ever adding matching rows to the bill — challan and
                // bill drifted apart. ApplyItemsDiffAsync mirrors what
                // UpdateItemsAsync does so both endpoints behave identically.
                if (dto.Items != null && dto.Items.Any())
                {
                    await ApplyItemsDiffAsync(dc, dto.Items);
                }

                // Recompute status — preserve "Invoiced" for challans already billed
                if (dc.Status != "Invoiced")
                {
                    var fbrReady = IsFbrReady(dc.Company, dc.Client);
                    dc.Status = !fbrReady ? "Setup Required"
                              : hasPo     ? ReadyStatusFor(dc)
                                          : "No PO";
                }

                await _repository.UpdateAsync(dc);
                await EnsureItemDescriptionsAsync(dto.Items?.Select(i => i.Description) ?? Enumerable.Empty<string?>());

                await transaction.CommitAsync();

                var reloaded = await _repository.GetByIdAsync(challanId);
                return reloaded == null ? null : ToDto(reloaded);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "UpdateAsync transaction failed for challan {ChallanId}", challanId);
                await transaction.RollbackAsync();
                throw;
            }
        }

        public async Task<DeliveryChallanDto?> UpdatePoAsync(int challanId, string poNumber, DateTime? poDate)
        {
            var dc = await _repository.GetByIdAsync(challanId);
            if (dc == null) return null;
            if (dc.Status != "No PO" && dc.Status != "Setup Required")
                throw new InvalidOperationException("Can only add PO details to 'No PO' or 'Setup Required' challans.");

            dc.PoNumber = poNumber.Trim();
            dc.PoDate = poDate;

            // Only transition to ready state if FBR is ready. Imported challans
            // go to "Imported"; native ones go to "Pending".
            if (dc.Status == "Setup Required")
            {
                var fbrReady = IsFbrReady(dc.Company, dc.Client);
                dc.Status = fbrReady ? ReadyStatusFor(dc) : "Setup Required";
            }
            else
            {
                dc.Status = ReadyStatusFor(dc);
            }

            await _repository.UpdateAsync(dc);
            var reloaded = await _repository.GetByIdAsync(challanId);
            return reloaded == null ? null : ToDto(reloaded);
        }

        public async Task<List<DeliveryChallanDto>> GetPendingChallansByCompanyAsync(int companyId)
        {
            var challans = await _repository.GetPendingChallansByCompanyAsync(companyId);
            return challans.Select(ToDto).ToList();
        }

        public async Task<PrintChallanDto?> GetPrintDataAsync(int challanId)
        {
            var dc = await _repository.GetByIdAsync(challanId);
            if (dc == null) return null;

            return new PrintChallanDto
            {
                CompanyBrandName = dc.Company?.BrandName ?? dc.Company?.Name ?? "",
                CompanyLogoPath = dc.Company?.LogoPath,
                CompanyAddress = dc.Company?.FullAddress,
                CompanyPhone = dc.Company?.Phone,
                ChallanNumber = dc.ChallanNumber,
                DeliveryDate = dc.DeliveryDate,
                ClientName = dc.Client?.Name ?? "",
                ClientAddress = dc.Client?.Address,
                ClientSite = dc.Site,
                PoNumber = dc.PoNumber,
                PoDate = dc.PoDate,
                IndentNo = dc.IndentNo,
                Items = dc.Items.Select(i => new PrintChallanItemDto
                {
                    Quantity = i.Quantity,
                    Description = i.Description,
                    Unit = i.Unit
                }).ToList()
            };
        }

        public async Task<int> GetTotalCountAsync()
        {
            return await _repository.GetTotalCountAsync();
        }

        public async Task<int> GetCountByCompanyAsync(int companyId)
        {
            return await _repository.GetCountByCompanyAsync(companyId);
        }

        public async Task<int> ReEvaluateSetupRequiredAsync(int companyId, int? clientId = null)
        {
            var challans = await _repository.GetSetupRequiredChallansAsync(companyId, clientId);
            var transitioned = 0;

            foreach (var dc in challans)
            {
                if (!IsFbrReady(dc.Company, dc.Client)) continue;

                var hasPo = !string.IsNullOrWhiteSpace(dc.PoNumber);
                // Imported challans go to "Imported" when they become ready;
                // native ones go to "Pending".
                dc.Status = hasPo ? ReadyStatusFor(dc) : "No PO";
                await _repository.UpdateAsync(dc);
                transitioned++;
            }

            return transitioned;
        }

        public async Task<ChallanImportResultDto> ImportHistoricalAsync(int companyId, ChallanImportPreviewDto dto)
        {
            var result = new ChallanImportResultDto
            {
                FileName = dto.FileName,
                ChallanNumber = dto.ChallanNumber,
                Success = false
            };

            // ── Validation ───────────────────────────────────────────────────
            if (dto.ChallanNumber <= 0)
            {
                result.Error = "Challan number is missing or invalid.";
                return result;
            }
            if (dto.ClientId == null || dto.ClientId <= 0)
            {
                result.Error = "Client is required.";
                return result;
            }

            var client = await _context.Clients.FindAsync(dto.ClientId.Value);
            if (client == null || client.CompanyId != companyId)
            {
                result.Error = $"Client {dto.ClientId} does not belong to this company.";
                return result;
            }

            if (await _repository.ChallanNumberExistsAsync(companyId, dto.ChallanNumber))
            {
                result.Error = $"Challan #{dto.ChallanNumber} already exists for this company.";
                return result;
            }

            // Historical imports settle at:
            //   • "Imported"        — FBR-ready and a PO is known (billable, same as Pending)
            //   • "No PO"           — FBR-ready but no PO known (will move to "Imported" when PO added)
            //   • "Setup Required"  — FBR fields incomplete (will move to "Imported"/"No PO" when fixed)
            // "Pending" is intentionally NOT used — it's reserved for natively-
            // created challans so reports can distinguish the two populations.
            var company = await _context.Companies.FindAsync(companyId);
            var fbrReady = company != null && IsFbrReady(company, client);
            var hasPo = !string.IsNullOrWhiteSpace(dto.PoNumber);
            string status = !fbrReady ? "Setup Required" : (hasPo ? "Imported" : "No PO");

            // Auto-register any new unit names that came in via the Excel
            // import so the operator can immediately configure them on the
            // Units admin screen.
            await UnitRegistry.EnsureNamesAsync(_context, dto.Items?.Select(i => i.Unit) ?? Enumerable.Empty<string>());

            var challan = new DeliveryChallan
            {
                CompanyId = companyId,
                ClientId = dto.ClientId.Value,
                ChallanNumber = dto.ChallanNumber,
                Site = string.IsNullOrWhiteSpace(dto.Site) ? null : dto.Site.Trim(),
                PoNumber = (dto.PoNumber ?? "").Trim(),
                PoDate = hasPo ? dto.PoDate : null,
                // IndentNo intentionally left null for bulk Excel imports —
                // legacy import sheets don't have an indent column. Operators
                // can fill it in afterwards via the Edit dialog if needed.
                DeliveryDate = dto.DeliveryDate,
                Status = status,
                IsImported = true,
                Items = dto.Items.Select(i => new DeliveryItem
                {
                    ItemTypeId = i.ItemTypeId,
                    Description = i.Description,
                    Quantity = i.Quantity,
                    Unit = i.Unit ?? ""
                }).ToList()
            };

            try
            {
                var inserted = await _repository.CreateImportedChallanAsync(challan);
                result.Success = true;
                result.InsertedId = inserted.Id;
            }
            catch (Exception ex)
            {
                result.Error = ex.Message;
            }
            return result;
        }

        public async Task<DeliveryChallanDto?> DuplicateAsync(int sourceId)
        {
            var clones = await DuplicateAsync(sourceId, 1);
            return clones.FirstOrDefault();
        }

        /// <summary>
        /// Create N duplicates of a single source challan in one transaction.
        /// Returns the freshly-loaded DTO for each clone in creation order.
        ///
        /// 2026-05-08 UX upgrade: previously the operator had to click
        /// Duplicate N times (and the laggy first-click let them double-fire
        /// the request). The N-at-once flow plus the in-flight guard on the
        /// frontend resolves both issues.
        /// </summary>
        public async Task<List<DeliveryChallanDto>> DuplicateAsync(int sourceId, int count)
        {
            if (count <= 0) count = 1;
            // Hard cap so an accidental "999" entry doesn't lock the DB
            // creating a bulk run that would later need cleanup. 20 is
            // generous for any realistic same-PO-different-batch flow.
            if (count > 20) count = 20;

            var source = await _repository.GetByIdAsync(sourceId);
            if (source == null) return new();

            // Only billable-but-not-yet-billed statuses can be duplicated.
            // Cancelled / Invoiced / Setup Required / No PO are intentionally
            // excluded — duplicating those would create rows in inconsistent
            // states.
            if (source.Status != "Pending" && source.Status != "Imported")
                throw new InvalidOperationException(
                    $"Only Pending or Imported challans can be duplicated (this one is '{source.Status}').");

            // Demo (FBR sandbox) challans live in their own world — they
            // don't belong on the regular Challans page so duplicating one
            // makes no sense.
            if (source.IsDemo)
                throw new InvalidOperationException("Demo (sandbox) challans cannot be duplicated.");

            // 2026-05-08: forbid duplicating a duplicate. The original is the
            // only canonical "Challan #N" — operators can request N copies of
            // it directly via the count parameter. Letting duplicates spawn
            // their own duplicates fragments the lineage and confuses the
            // "Duplicate of #N" subtitle on the cards.
            if (source.DuplicatedFromId != null)
                throw new InvalidOperationException(
                    $"This challan is already a duplicate of #{source.ChallanNumber}. " +
                    "Open the original challan to create more copies.");

            // Audit M-13 (2026-05-13): wrap the N-at-once duplicate loop
            // in one transaction. Pre-fix, a mid-loop failure left some
            // clones persisted and others not, leaving the operator with
            // partial copies and no clean rollback.
            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                var clones = new List<DeliveryChallanDto>(count);
                for (int i = 0; i < count; i++)
                {
                    var clone = await _repository.DuplicateAsync(source);
                    var refreshed = await _repository.GetByIdAsync(clone.Id);
                    if (refreshed != null) clones.Add(ToDto(refreshed));
                }
                await tx.CommitAsync();
                return clones;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "DuplicateAsync transaction rolled back for source challan {SourceId} (requested count {Count})",
                    sourceId, count);
                await tx.RollbackAsync();
                throw;
            }
        }
    }
}

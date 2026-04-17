using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class DeliveryChallanService : IDeliveryChallanService
    {
        private readonly IDeliveryChallanRepository _repository;
        private readonly AppDbContext _context;

        public DeliveryChallanService(IDeliveryChallanRepository repository, AppDbContext context)
        {
            _repository = repository;
            _context = context;
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
                ClientId = dc.ClientId,
                ClientName = dc.Client?.Name ?? "",
                PoNumber = dc.PoNumber,
                PoDate = dc.PoDate,
                DeliveryDate = dc.DeliveryDate,
                Site = dc.Site,
                Status = dc.Status,
                InvoiceId = dc.InvoiceId,
                InvoiceFbrStatus = dc.Invoice?.FbrStatus,
                IsEditable = IsEditable(dc),
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
        /// Editable: Pending, No PO, Setup Required, OR Invoiced (as long as linked invoice
        /// has NOT been successfully submitted to FBR).
        /// Only blocked for: Cancelled, or Invoiced with FbrStatus == "Submitted".
        /// </summary>
        private static bool IsEditable(DeliveryChallan dc)
        {
            if (dc.Status == "Pending" || dc.Status == "No PO" || dc.Status == "Setup Required")
                return true;
            if (dc.Status == "Invoiced")
            {
                // Editable only if linked invoice is NOT FBR-submitted
                return dc.Invoice?.FbrStatus != "Submitted";
            }
            // Cancelled and any other unknown status → not editable
            return false;
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
            return new PagedResult<DeliveryChallanDto>
            {
                Items = items.Select(ToDto).ToList(),
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
            return ToDto(created);
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
                // Compute what's removed, changed, added
                var updatedIds = items.Where(i => i.Id > 0).Select(i => i.Id).ToHashSet();
                var toRemove = dc.Items.Where(i => !updatedIds.Contains(i.Id)).ToList();
                var removedDeliveryItemIds = toRemove.Select(i => i.Id).ToList();

                var quantityChanges = new Dictionary<int, int>(); // deliveryItemId → newQuantity
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
                            DeliveryChallanId = challanId,
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
                // EF's FK cascade (SET NULL on InvoiceItem.DeliveryItemId) would otherwise
                // null the FKs and prevent the sync from matching items.
                if (dc.InvoiceId.HasValue && dc.Invoice != null && dc.Invoice.FbrStatus != "Submitted")
                {
                    await SyncInvoiceItemsForChallanEditAsync(dc, removedDeliveryItemIds, quantityChanges, newItems);
                }

                // Now it's safe to delete removed delivery items
                foreach (var item in toRemove)
                    await _repository.DeleteItemAsync(item);

                await _repository.UpdateAsync(dc);

                await transaction.CommitAsync();

                var reloaded = await _repository.GetByIdAsync(challanId);
                return reloaded == null ? null : ToDto(reloaded);
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
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
            Dictionary<int, int> quantityChanges,
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

            await _repository.DeleteAsync(dc);
            return true;
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
                        new Dictionary<int, int>(),
                        new List<DeliveryItem>());
                }

                await _repository.DeleteItemAsync(item);

                await transaction.CommitAsync();
                return true;
            }
            catch
            {
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

            // Only transition to Pending if FBR is ready
            if (dc.Status == "Setup Required")
            {
                var fbrReady = IsFbrReady(dc.Company, dc.Client);
                dc.Status = fbrReady ? "Pending" : "Setup Required";
            }
            else
            {
                dc.Status = "Pending";
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
                dc.Status = hasPo ? "Pending" : "No PO";
                await _repository.UpdateAsync(dc);
                transitioned++;
            }

            return transitioned;
        }
    }
}

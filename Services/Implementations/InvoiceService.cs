using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class InvoiceService : IInvoiceService
    {
        private readonly IInvoiceRepository _invoiceRepo;
        private readonly IDeliveryChallanRepository _challanRepo;
        private readonly ICompanyRepository _companyRepo;
        private readonly IClientRepository _clientRepo;
        private readonly AppDbContext _context;

        public InvoiceService(
            IInvoiceRepository invoiceRepo,
            IDeliveryChallanRepository challanRepo,
            ICompanyRepository companyRepo,
            IClientRepository clientRepo,
            AppDbContext context)
        {
            _invoiceRepo = invoiceRepo;
            _challanRepo = challanRepo;
            _companyRepo = companyRepo;
            _clientRepo = clientRepo;
            _context = context;
        }

        /// <summary>
        /// Invoice (bill) is editable until it has been successfully submitted to FBR.
        /// </summary>
        private static bool IsInvoiceEditable(Invoice inv) => inv.FbrStatus != "Submitted";

        /// <summary>
        /// Computes which per-item FBR fields are missing so the UI can show a
        /// friendly "FBR Setup Incomplete" status with actionable details.
        /// </summary>
        private static List<string> ComputeFbrMissing(Invoice inv)
        {
            var missing = new List<string>();
            if (inv.Items == null || !inv.Items.Any()) return missing;
            var items = inv.Items.ToList();
            for (int i = 0; i < items.Count; i++)
            {
                var it = items[i];
                var n = i + 1;
                if (string.IsNullOrWhiteSpace(it.HSCode))
                    missing.Add($"Item {n}: HS Code");
                if (string.IsNullOrWhiteSpace(it.SaleType))
                    missing.Add($"Item {n}: Sale Type");
                if (it.FbrUOMId == null && string.IsNullOrWhiteSpace(it.UOM))
                    missing.Add($"Item {n}: UOM");
                if (it.UnitPrice <= 0)
                    missing.Add($"Item {n}: Unit Price");
            }
            return missing;
        }

        private static InvoiceDto ToDto(Invoice inv)
        {
            var missing = ComputeFbrMissing(inv);
            return new InvoiceDto
        {
            Id = inv.Id,
            InvoiceNumber = inv.InvoiceNumber,
            Date = inv.Date,
            CompanyId = inv.CompanyId,
            CompanyName = inv.Company?.Name ?? "",
            ClientId = inv.ClientId,
            ClientName = inv.Client?.Name ?? "",
            Subtotal = inv.Subtotal,
            GSTRate = inv.GSTRate,
            GSTAmount = inv.GSTAmount,
            GrandTotal = inv.GrandTotal,
            AmountInWords = inv.AmountInWords,
            PaymentTerms = inv.PaymentTerms,
            DocumentType = inv.DocumentType,
            PaymentMode = inv.PaymentMode,
            FbrInvoiceNumber = inv.FbrInvoiceNumber,
            FbrIRN = inv.FbrIRN,
            FbrStatus = inv.FbrStatus,
            FbrSubmittedAt = inv.FbrSubmittedAt,
            FbrErrorMessage = inv.FbrErrorMessage,
            CreatedAt = inv.CreatedAt,
            IsEditable = IsInvoiceEditable(inv),
            FbrReady = missing.Count == 0,
            FbrMissing = missing,
            Items = inv.Items.Select(ii => new InvoiceItemDto
            {
                Id = ii.Id,
                DeliveryItemId = ii.DeliveryItemId,
                ItemTypeId = ii.ItemTypeId,
                ItemTypeName = ii.ItemType?.Name ?? ii.ItemTypeName,
                Description = ii.Description,
                Quantity = ii.Quantity,
                UOM = ii.UOM,
                UnitPrice = ii.UnitPrice,
                LineTotal = ii.LineTotal,
                HSCode = ii.HSCode,
                FbrUOMId = ii.FbrUOMId,
                SaleType = ii.SaleType,
                RateId = ii.RateId,
                FixedNotifiedValueOrRetailPrice = ii.FixedNotifiedValueOrRetailPrice
            }).ToList(),
            ChallanNumbers = inv.DeliveryChallans.Select(dc => dc.ChallanNumber).ToList()
            };
        }

        public async Task<List<InvoiceDto>> GetByCompanyAsync(int companyId)
        {
            var invoices = await _invoiceRepo.GetByCompanyAsync(companyId);
            return invoices.Select(ToDto).ToList();
        }

        public async Task<PagedResult<InvoiceDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, int? clientId = null,
            DateTime? dateFrom = null, DateTime? dateTo = null)
        {
            var (items, totalCount) = await _invoiceRepo.GetPagedByCompanyAsync(
                companyId, page, pageSize, search, clientId, dateFrom, dateTo);

            // Gate the Delete button client-side — only the highest-numbered
            // bill for this company is deletable. Earlier bills must be edited.
            var maxNumber = await _context.Invoices
                .Where(i => i.CompanyId == companyId)
                .MaxAsync(i => (int?)i.InvoiceNumber) ?? 0;

            var dtos = items.Select(ToDto).ToList();
            foreach (var d in dtos)
                d.IsLatest = d.InvoiceNumber == maxNumber;

            return new PagedResult<InvoiceDto>
            {
                Items = dtos,
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize
            };
        }

        public async Task<InvoiceDto?> GetByIdAsync(int id)
        {
            var inv = await _invoiceRepo.GetByIdAsync(id);
            return inv == null ? null : ToDto(inv);
        }

        public async Task<InvoiceDto> CreateAsync(CreateInvoiceDto dto)
        {
            var company = await _companyRepo.GetByIdAsync(dto.CompanyId);
            if (company == null) throw new KeyNotFoundException("Company not found.");

            // Load and validate all challans
            var challans = new List<DeliveryChallan>();
            foreach (var challanId in dto.ChallanIds)
            {
                var dc = await _challanRepo.GetByIdAsync(challanId);
                if (dc == null) throw new KeyNotFoundException($"Challan {challanId} not found.");
                // Both "Pending" (natively-created) and "Imported" (back-filled)
                // are billable. Anything else (Invoiced, Cancelled, Setup Required, No PO)
                // blocks bill creation.
                if (dc.Status != "Pending" && dc.Status != "Imported")
                    throw new InvalidOperationException($"Challan {dc.ChallanNumber} is not in a billable status (got '{dc.Status}').");
                if (dc.CompanyId != dto.CompanyId) throw new InvalidOperationException($"Challan {dc.ChallanNumber} does not belong to this company.");
                challans.Add(dc);
            }

            // Build invoice items from delivery items + user-provided unit prices
            var invoiceItems = new List<InvoiceItem>();
            foreach (var itemDto in dto.Items)
            {
                // Find the delivery item across all selected challans
                DeliveryItem? deliveryItem = null;
                foreach (var dc in challans)
                {
                    deliveryItem = dc.Items.FirstOrDefault(i => i.Id == itemDto.DeliveryItemId);
                    if (deliveryItem != null) break;
                }
                if (deliveryItem == null)
                    throw new KeyNotFoundException($"Delivery item {itemDto.DeliveryItemId} not found in selected challans.");

                var description = !string.IsNullOrWhiteSpace(itemDto.Description)
                    ? itemDto.Description
                    : deliveryItem.Description;
                var lineTotal = deliveryItem.Quantity * itemDto.UnitPrice;

                // ── Inherit FBR fields from the ItemType (user's catalog) if not
                //    explicitly supplied on this line. This is the whole point of
                //    the Item Catalog: each FBR item in the catalog carries its
                //    HS Code / UOM / SaleType, and bill lines referencing it pick
                //    those up automatically so the user doesn't re-enter them.
                var itemType = deliveryItem.ItemType;

                // ── Per-company FBR defaults (configurable via Company settings) ──
                //
                // Precedence, first non-empty wins:
                //   1. Explicit field on the incoming DTO  (operator's current edit)
                //   2. ItemType catalog entry              (picked on the delivery item)
                //   3. DeliveryItem.Unit                   (the unit that was written
                //                                          on the challan originally)
                //   4. Company.FbrDefault*                 (editable per-company on
                //                                          the Company Settings page)
                //   5. Built-in seed value                 (backstop for pre-migration
                //                                          companies that haven't set
                //                                          a default yet — "Numbers,
                //                                          pieces, units" / "Goods at
                //                                          Standard Rate (default)",
                //                                          same as FBR reference docs)
                //
                // 3rd-schedule / reduced-rate / zero-rate sales are opt-in per line
                // via the ItemType catalog entry or direct edit, so the default only
                // covers the common-case SN001/SN002/SN026 standard-rate flow.
                var companyDefaultUOM      = !string.IsNullOrWhiteSpace(company.FbrDefaultUOM)
                    ? company.FbrDefaultUOM
                    : "Numbers, pieces, units";
                var companyDefaultSaleType = !string.IsNullOrWhiteSpace(company.FbrDefaultSaleType)
                    ? company.FbrDefaultSaleType
                    : "Goods at Standard Rate (default)";

                var effectiveUOM = !string.IsNullOrWhiteSpace(itemDto.UOM)
                    ? itemDto.UOM!
                    : !string.IsNullOrWhiteSpace(itemType?.UOM)
                        ? itemType!.UOM!
                        : !string.IsNullOrWhiteSpace(deliveryItem.Unit)
                            ? deliveryItem.Unit
                            : companyDefaultUOM;
                var effectiveHSCode = !string.IsNullOrWhiteSpace(itemDto.HSCode)
                    ? itemDto.HSCode
                    : itemType?.HSCode;
                var effectiveFbrUOMId = itemDto.FbrUOMId ?? itemType?.FbrUOMId;
                var effectiveSaleType = !string.IsNullOrWhiteSpace(itemDto.SaleType)
                    ? itemDto.SaleType
                    : !string.IsNullOrWhiteSpace(itemType?.SaleType)
                        ? itemType!.SaleType
                        : companyDefaultSaleType;

                invoiceItems.Add(new InvoiceItem
                {
                    DeliveryItemId = deliveryItem.Id,
                    ItemTypeId = itemType?.Id,        // flow the catalog linkage through
                    ItemTypeName = itemType?.Name ?? "",
                    Description = description,
                    Quantity = deliveryItem.Quantity,
                    UOM = effectiveUOM,
                    UnitPrice = itemDto.UnitPrice,
                    LineTotal = lineTotal,
                    HSCode = effectiveHSCode,
                    FbrUOMId = effectiveFbrUOMId,
                    SaleType = effectiveSaleType,
                    RateId = itemDto.RateId,
                    FixedNotifiedValueOrRetailPrice = itemDto.FixedNotifiedValueOrRetailPrice
                });

                // Bump usage counter on the ItemType so favorites dropdowns show
                // most-used items first.
                if (itemType != null)
                {
                    itemType.UsageCount += 1;
                    itemType.LastUsedAt = DateTime.UtcNow;
                    _context.ItemTypes.Update(itemType);
                }
            }

            // ── Bill-header defaults ──
            //
            //   DocumentType  → 4 (Sale Invoice). Never defaults to 9 (Debit
            //                   Note) or 10 (Credit Note); those require a
            //                   reference IRN and the operator always picks
            //                   them explicitly.
            //   PaymentMode   → if the operator left it blank, look up the
            //                   company's configured default for this buyer's
            //                   registration type (Registered uses
            //                   FbrDefaultPaymentModeRegistered, Unregistered
            //                   uses FbrDefaultPaymentModeUnregistered).
            //                   If neither is set on the company we fall back
            //                   to the sensible seed values: Registered →
            //                   "Credit" (B2B wholesale), Unregistered →
            //                   "Cash" (typical walk-in retail).
            //
            //   GSTRate is NOT defaulted here — a literal 0 is a valid choice
            //   for SN006 exempt goods / SN007 zero-rated. Frontend sets 18
            //   as the sensible starting value in the bill form.
            const int SeededDefaultDocType = 4;  // Sale Invoice
            var effectiveDocType = dto.DocumentType ?? SeededDefaultDocType;

            string? effectivePaymentMode = dto.PaymentMode;
            if (string.IsNullOrWhiteSpace(effectivePaymentMode))
            {
                var buyer = await _context.Clients.FindAsync(dto.ClientId);
                var isRegistered = buyer?.RegistrationType == "Registered";
                effectivePaymentMode = isRegistered
                    ? (!string.IsNullOrWhiteSpace(company.FbrDefaultPaymentModeRegistered)
                        ? company.FbrDefaultPaymentModeRegistered
                        : "Credit")
                    : (!string.IsNullOrWhiteSpace(company.FbrDefaultPaymentModeUnregistered)
                        ? company.FbrDefaultPaymentModeUnregistered
                        : "Cash");
            }

            var subtotal = invoiceItems.Sum(i => i.LineTotal);
            var gstAmount = Math.Round(subtotal * dto.GSTRate / 100, 2);
            var grandTotal = subtotal + gstAmount;

            // Generate next invoice number per company
            if (company.StartingInvoiceNumber == 0)
                throw new InvalidOperationException("Starting invoice number has not been set for this company. Please set it first.");

            // Use MAX(InvoiceNumber) so a deleted trailing number is reused on the next
            // create (no gaps after deleting the last bill). Falls back to StartingInvoiceNumber
            // when the company has no invoices yet.
            int maxExistingInvoice = await _context.Invoices
                .Where(i => i.CompanyId == dto.CompanyId)
                .MaxAsync(i => (int?)i.InvoiceNumber) ?? 0;

            int nextInvoiceNumber = maxExistingInvoice > 0
                ? maxExistingInvoice + 1
                : company.StartingInvoiceNumber;
            company.CurrentInvoiceNumber = nextInvoiceNumber;

            var invoice = new Invoice
            {
                InvoiceNumber = nextInvoiceNumber,
                Date = dto.Date,
                CompanyId = dto.CompanyId,
                ClientId = dto.ClientId,
                Subtotal = subtotal,
                GSTRate = dto.GSTRate,
                GSTAmount = gstAmount,
                GrandTotal = grandTotal,
                AmountInWords = NumberToWordsConverter.Convert(grandTotal),
                PaymentTerms = dto.PaymentTerms,
                DocumentType = effectiveDocType,
                PaymentMode = effectivePaymentMode,
                FbrInvoiceNumber = string.IsNullOrEmpty(company.InvoiceNumberPrefix)
                    ? nextInvoiceNumber.ToString()
                    : $"{company.InvoiceNumberPrefix}{nextInvoiceNumber}",
                Items = invoiceItems
            };

            // Wrap invoice creation + challan transitions + company update in a single transaction
            await using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                var created = await _invoiceRepo.CreateAsync(invoice);

                // Transition challans to Invoiced + apply any PO date updates
                foreach (var dc in challans)
                {
                    if (dto.PoDateUpdates.TryGetValue(dc.Id, out var poDate))
                        dc.PoDate = poDate;
                    dc.Status = "Invoiced";
                    dc.InvoiceId = created.Id;
                    await _challanRepo.UpdateAsync(dc);
                }

                // Update company invoice number
                await _companyRepo.UpdateAsync(company);

                // Auto-save new item descriptions for future use
                var newDescs = dto.Items
                    .Where(i => !string.IsNullOrWhiteSpace(i.Description))
                    .Select(i => i.Description!)
                    .Distinct()
                    .ToList();
                if (newDescs.Any())
                {
                    var existing = await _context.ItemDescriptions
                        .Where(d => newDescs.Contains(d.Name))
                        .Select(d => d.Name)
                        .ToListAsync();
                    foreach (var desc in newDescs.Where(d => !existing.Contains(d)))
                    {
                        _context.ItemDescriptions.Add(new ItemDescription { Name = desc });
                    }
                    await _context.SaveChangesAsync();
                }

                await transaction.CommitAsync();

                // Reload with includes
                var loaded = await _invoiceRepo.GetByIdAsync(created.Id);
                return ToDto(loaded!);
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
        }

        public async Task<InvoiceDto?> UpdateAsync(int id, UpdateInvoiceDto dto)
        {
            var invoice = await _invoiceRepo.GetByIdAsync(id);
            if (invoice == null) return null;

            if (!IsInvoiceEditable(invoice))
                throw new InvalidOperationException("Cannot edit a bill that has been submitted to FBR.");

            if (dto.GSTRate < 0 || dto.GSTRate > 100)
                throw new InvalidOperationException("GST rate must be between 0 and 100.");
            if (dto.Items == null || dto.Items.Count == 0)
                throw new InvalidOperationException("At least one item is required.");

            // A bill's items cannot be added or removed from here — that must happen on the
            // linked delivery challan (which auto-syncs). Reject any attempt to add or drop items.
            var incomingIds = dto.Items.Select(i => i.Id).ToHashSet();
            if (dto.Items.Any(i => i.Id <= 0))
                throw new InvalidOperationException(
                    "Cannot add new items directly to a bill. Add the item to the linked delivery challan instead.");

            var existingIds = invoice.Items.Select(ii => ii.Id).ToHashSet();
            var missingFromPayload = existingIds.Except(incomingIds).ToList();
            if (missingFromPayload.Count > 0)
                throw new InvalidOperationException(
                    "Cannot remove items directly from a bill. Remove the item from the linked delivery challan instead.");

            var extrasInPayload = incomingIds.Except(existingIds).ToList();
            if (extrasInPayload.Count > 0)
                throw new InvalidOperationException(
                    $"Bill item id(s) [{string.Join(", ", extrasInPayload)}] do not belong to this bill.");

            await using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                // Update invoice-level fields
                invoice.GSTRate = dto.GSTRate;
                invoice.PaymentTerms = dto.PaymentTerms;
                invoice.DocumentType = dto.DocumentType;
                invoice.PaymentMode = dto.PaymentMode;

                // Preload any referenced ItemTypes in one round-trip
                var referencedTypeIds = dto.Items
                    .Where(i => i.ItemTypeId.HasValue)
                    .Select(i => i.ItemTypeId!.Value)
                    .Distinct()
                    .ToList();
                var typeMap = referencedTypeIds.Count == 0
                    ? new Dictionary<int, ItemType>()
                    : await _context.ItemTypes
                        .Where(t => referencedTypeIds.Contains(t.Id))
                        .ToDictionaryAsync(t => t.Id);

                // Update existing items. If the line has an ItemTypeId set, re-derive
                // UOM / HS Code / Sale Type / FbrUOMId from that ItemType — the user
                // edits these indirectly by picking a different ItemType on the bill.
                foreach (var itemDto in dto.Items)
                {
                    var existing = invoice.Items.First(ii => ii.Id == itemDto.Id);
                    var lineTotal = Math.Round(itemDto.Quantity * itemDto.UnitPrice, 2);

                    ItemType? pickedType = null;
                    if (itemDto.ItemTypeId.HasValue && typeMap.TryGetValue(itemDto.ItemTypeId.Value, out var t))
                        pickedType = t;

                    existing.Description = itemDto.Description;
                    existing.Quantity = itemDto.Quantity;
                    existing.UnitPrice = itemDto.UnitPrice;
                    existing.LineTotal = lineTotal;
                    existing.RateId = itemDto.RateId;
                    // 3rd-schedule retail price is always edit-driven (never inherited
                    // from the ItemType catalog), so it's applied the same way in both
                    // branches below.
                    existing.FixedNotifiedValueOrRetailPrice = itemDto.FixedNotifiedValueOrRetailPrice;

                    if (pickedType != null)
                    {
                        // Item Type drives FBR fields — overwrite with catalog values
                        existing.ItemTypeId = pickedType.Id;
                        existing.ItemTypeName = pickedType.Name;
                        existing.UOM = pickedType.UOM ?? "";
                        existing.FbrUOMId = pickedType.FbrUOMId;
                        existing.HSCode = pickedType.HSCode;
                        existing.SaleType = pickedType.SaleType;
                    }
                    else
                    {
                        // No ItemType on the line → fall back to DTO-supplied FBR fields
                        existing.ItemTypeId = null;
                        existing.UOM = itemDto.UOM;
                        existing.HSCode = itemDto.HSCode;
                        existing.FbrUOMId = itemDto.FbrUOMId;
                        existing.SaleType = itemDto.SaleType;
                    }
                }

                // Recalculate totals
                invoice.Subtotal = invoice.Items.Sum(ii => ii.LineTotal);
                invoice.GSTAmount = Math.Round(invoice.Subtotal * invoice.GSTRate / 100, 2);
                invoice.GrandTotal = invoice.Subtotal + invoice.GSTAmount;
                invoice.AmountInWords = NumberToWordsConverter.Convert(invoice.GrandTotal);

                // Any edit invalidates a previous validation
                if (invoice.FbrStatus != "Submitted")
                {
                    invoice.FbrStatus = null;
                    invoice.FbrErrorMessage = null;
                }

                // Keep the underlying delivery item in sync with the bill's changes
                // (description, quantity, UOM) so the challan reflects the same edits.
                await SyncDeliveryItemsFromInvoiceEditAsync(invoice);

                await _context.SaveChangesAsync();
                await transaction.CommitAsync();

                var reloaded = await _invoiceRepo.GetByIdAsync(id);
                return reloaded == null ? null : ToDto(reloaded);
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
        }

        /// <summary>
        /// When a bill's items are edited, propagate description/quantity/UOM changes back
        /// to the source delivery items so the challan stays in sync with the bill.
        /// Price/HS code/sale type are bill-specific and are not synced back.
        /// </summary>
        private async Task SyncDeliveryItemsFromInvoiceEditAsync(Invoice invoice)
        {
            var deliveryItemIds = invoice.Items
                .Where(ii => ii.DeliveryItemId.HasValue)
                .Select(ii => ii.DeliveryItemId!.Value)
                .ToList();
            if (deliveryItemIds.Count == 0) return;

            var deliveryItems = await _context.DeliveryItems
                .Where(di => deliveryItemIds.Contains(di.Id))
                .ToListAsync();

            foreach (var di in deliveryItems)
            {
                var invItem = invoice.Items.First(ii => ii.DeliveryItemId == di.Id);
                di.Description = invItem.Description;
                di.Quantity = invItem.Quantity;
                di.Unit = invItem.UOM;
            }
        }

        public async Task<bool> DeleteAsync(int id)
        {
            var invoice = await _invoiceRepo.GetByIdAsync(id);
            if (invoice == null) return false;

            // Cannot delete FBR-submitted invoices
            if (invoice.FbrStatus == "Submitted")
                throw new InvalidOperationException("Cannot delete a bill that has been submitted to FBR.");

            // Only the LAST bill (highest invoice number) can be deleted so
            // numbering stays gap-free. Earlier bills must be edited in place.
            var maxNumber = await _context.Invoices
                .Where(i => i.CompanyId == invoice.CompanyId)
                .MaxAsync(i => (int?)i.InvoiceNumber) ?? 0;
            if (invoice.InvoiceNumber != maxNumber)
                throw new InvalidOperationException(
                    $"Only the latest bill can be deleted (currently #{maxNumber}). " +
                    $"To change bill #{invoice.InvoiceNumber}, edit it instead — " +
                    "deleting earlier bills would leave gaps in the numbering.");

            var companyId = invoice.CompanyId;

            await using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                // Revert linked challans from "Invoiced" → their billable state.
                // - Imported challans revert to "Imported" (or "No PO" if PO was cleared)
                // - Native challans revert to "Pending" (or "No PO")
                // Note: GetByIdAsync tracks these; we use tracked updates to stay consistent
                // and avoid issues with ExecuteDelete + tracked entities in same transaction.
                foreach (var dc in invoice.DeliveryChallans)
                {
                    var hasPo = !string.IsNullOrWhiteSpace(dc.PoNumber);
                    dc.Status = hasPo ? (dc.IsImported ? "Imported" : "Pending") : "No PO";
                    dc.InvoiceId = null;
                    _context.DeliveryChallans.Update(dc);
                }

                // Remove all invoice items via tracked delete (avoids conflict with loaded graph)
                foreach (var item in invoice.Items.ToList())
                {
                    _context.InvoiceItems.Remove(item);
                }

                // Remove the invoice itself
                _context.Invoices.Remove(invoice);

                await _context.SaveChangesAsync();

                // ── If this was the LAST invoice for the company, reset the
                // counter so the operator can re-seed numbering and new bills
                // start from StartingInvoiceNumber again. Without this, the
                // Starting field stays unlocked but the next bill still uses
                // (last + 1) — confusing UX.
                var anyInvoicesLeft = await _context.Invoices.AnyAsync(i => i.CompanyId == companyId);
                if (!anyInvoicesLeft)
                {
                    var company = await _companyRepo.GetByIdAsync(companyId);
                    if (company != null && company.CurrentInvoiceNumber != 0)
                    {
                        company.CurrentInvoiceNumber = 0;
                        _context.Companies.Update(company);
                        await _context.SaveChangesAsync();
                    }
                }

                await transaction.CommitAsync();
                return true;
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
        }

        public async Task<PrintBillDto?> GetPrintBillAsync(int invoiceId)
        {
            var inv = await _invoiceRepo.GetByIdAsync(invoiceId);
            if (inv == null) return null;

            var poNumbers = inv.DeliveryChallans
                .Select(dc => dc.PoNumber)
                .Where(p => !string.IsNullOrEmpty(p))
                .Distinct()
                .ToList();

            return new PrintBillDto
            {
                CompanyBrandName = inv.Company?.BrandName ?? inv.Company?.Name ?? "",
                CompanyLogoPath = inv.Company?.LogoPath,
                CompanyAddress = inv.Company?.FullAddress,
                CompanyPhone = inv.Company?.Phone,
                CompanyNTN = inv.Company?.NTN,
                CompanySTRN = inv.Company?.STRN,
                InvoiceNumber = inv.InvoiceNumber,
                Date = inv.Date,
                ChallanNumbers = inv.DeliveryChallans.Select(dc => dc.ChallanNumber).ToList(),
                ChallanDates = inv.DeliveryChallans.Select(dc => dc.DeliveryDate).ToList(),
                PoNumber = string.Join(", ", poNumbers),
                PoDate = inv.DeliveryChallans.Select(dc => dc.PoDate).FirstOrDefault(),
                ClientName = inv.Client?.Name ?? "",
                ClientAddress = inv.Client?.Address,
                ConcernDepartment = string.Join(", ", inv.DeliveryChallans
                    .Select(dc => dc.Site)
                    .Where(s => !string.IsNullOrEmpty(s))
                    .Distinct()),
                ClientNTN = inv.Client?.NTN,
                ClientSTRN = inv.Client?.STRN,
                Subtotal = inv.Subtotal,
                GSTRate = inv.GSTRate,
                GSTAmount = inv.GSTAmount,
                GrandTotal = inv.GrandTotal,
                AmountInWords = inv.AmountInWords,
                PaymentTerms = inv.PaymentTerms,
                Items = inv.Items.Select((ii, idx) => new PrintBillItemDto
                {
                    SNo = idx + 1,
                    ItemTypeName = ii.ItemTypeName,
                    Description = ii.Description,
                    Quantity = ii.Quantity,
                    UOM = ii.UOM,
                    UnitPrice = ii.UnitPrice,
                    LineTotal = ii.LineTotal
                }).ToList()
            };
        }

        public async Task<PrintTaxInvoiceDto?> GetPrintTaxInvoiceAsync(int invoiceId)
        {
            var inv = await _invoiceRepo.GetByIdAsync(invoiceId);
            if (inv == null) return null;

            var poNumbers = inv.DeliveryChallans
                .Select(dc => dc.PoNumber)
                .Where(p => !string.IsNullOrEmpty(p))
                .Distinct()
                .ToList();

            return new PrintTaxInvoiceDto
            {
                SupplierName = inv.Company?.BrandName ?? inv.Company?.Name ?? "",
                SupplierAddress = inv.Company?.FullAddress,
                SupplierNTN = inv.Company?.NTN,
                SupplierSTRN = inv.Company?.STRN,
                SupplierPhone = inv.Company?.Phone,
                SupplierLogoPath = inv.Company?.LogoPath,
                BuyerName = inv.Client?.Name ?? "",
                BuyerAddress = inv.Client?.Address,
                BuyerPhone = inv.Client?.Phone,
                BuyerNTN = inv.Client?.NTN,
                BuyerSTRN = inv.Client?.STRN,
                InvoiceNumber = inv.InvoiceNumber,
                Date = inv.Date,
                ChallanNumbers = inv.DeliveryChallans.Select(dc => dc.ChallanNumber).ToList(),
                PoNumber = string.Join(", ", poNumbers),
                Subtotal = inv.Subtotal,
                GSTRate = inv.GSTRate,
                GSTAmount = inv.GSTAmount,
                GrandTotal = inv.GrandTotal,
                AmountInWords = inv.AmountInWords,
                FbrIRN = inv.FbrIRN,
                FbrStatus = inv.FbrStatus,
                FbrSubmittedAt = inv.FbrSubmittedAt,
                // Group items by ItemTypeName only if ALL items have an item type; otherwise list individually
                Items = inv.Items.All(ii => !string.IsNullOrWhiteSpace(ii.ItemTypeName))
                    ? inv.Items
                        .GroupBy(ii => ii.ItemTypeName)
                        .Select(g =>
                        {
                            var totalQty = g.Sum(ii => ii.Quantity);
                            var totalValue = g.Sum(ii => ii.LineTotal);
                            var gstAmt = Math.Round(totalValue * inv.GSTRate / 100, 2);
                            return new PrintTaxItemDto
                            {
                                ItemTypeName = g.Key,
                                Quantity = totalQty,
                                UOM = g.First().UOM,
                                Description = g.Key,
                                ValueExclTax = totalValue,
                                GSTRate = inv.GSTRate,
                                GSTAmount = gstAmt,
                                TotalInclTax = totalValue + gstAmt
                            };
                        }).ToList()
                    : inv.Items.Select(ii =>
                        {
                            var gstAmt = Math.Round(ii.LineTotal * inv.GSTRate / 100, 2);
                            return new PrintTaxItemDto
                            {
                                ItemTypeName = ii.ItemTypeName,
                                Quantity = ii.Quantity,
                                UOM = ii.UOM,
                                Description = ii.Description,
                                ValueExclTax = ii.LineTotal,
                                GSTRate = inv.GSTRate,
                                GSTAmount = gstAmt,
                                TotalInclTax = ii.LineTotal + gstAmt
                            };
                        }).ToList()
            };
        }

        public async Task<int> GetTotalCountAsync()
        {
            return await _invoiceRepo.GetTotalCountAsync();
        }

        public async Task<int> GetCountByCompanyAsync(int companyId)
        {
            return await _invoiceRepo.GetCountByCompanyAsync(companyId);
        }
    }
}

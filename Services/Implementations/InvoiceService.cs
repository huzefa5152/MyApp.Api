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
    public class InvoiceService : IInvoiceService
    {
        private readonly IInvoiceRepository _invoiceRepo;
        private readonly IDeliveryChallanRepository _challanRepo;
        private readonly ICompanyRepository _companyRepo;
        private readonly IClientRepository _clientRepo;
        private readonly AppDbContext _context;
        private readonly Microsoft.Extensions.Configuration.IConfiguration _config;
        private readonly IAuditLogService _auditLog;
        // 2026-05-12: injected so every invoice save (create / update /
        // narrow-edit) can sync the StockMovement rows for the bill.
        // The deduction now happens on save, not on FBR submit, so the
        // next bill picking the same Item Type sees reduced on-hand
        // (and the availability pre-flight kicks in) without waiting
        // for the operator to validate / submit.
        private readonly IStockService _stock;
        private readonly ILogger<InvoiceService> _logger;

        public InvoiceService(
            IInvoiceRepository invoiceRepo,
            IDeliveryChallanRepository challanRepo,
            ICompanyRepository companyRepo,
            IClientRepository clientRepo,
            AppDbContext context,
            Microsoft.Extensions.Configuration.IConfiguration config,
            IAuditLogService auditLog,
            IStockService stock,
            ILogger<InvoiceService> logger)
        {
            _invoiceRepo = invoiceRepo;
            _challanRepo = challanRepo;
            _companyRepo = companyRepo;
            _clientRepo = clientRepo;
            _context = context;
            _config = config;
            _logger = logger;
            _auditLog = auditLog;
            _stock = stock;
        }

        /// <summary>
        /// Reject fractional quantities (e.g. 2.5 Pcs) for any line whose
        /// UOM has AllowsDecimalQuantity = false. Same contract as the
        /// matching helper in DeliveryChallanService — the bill-edit form
        /// gates this client-side, this is the server-side guard.
        /// </summary>
        private async Task ValidateUpdateItemDecimalQuantitiesAsync(List<UpdateInvoiceItemDto> items)
        {
            var unitNames = items
                .Select(i => i.UOM)
                .Where(u => !string.IsNullOrWhiteSpace(u))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (unitNames.Count == 0) return;

            var unitConfig = await _context.Units
                .Where(u => unitNames.Contains(u.Name))
                .Select(u => new { u.Name, u.AllowsDecimalQuantity })
                .ToListAsync();
            var allowsDecimal = unitConfig.ToDictionary(
                u => u.Name, u => u.AllowsDecimalQuantity,
                StringComparer.OrdinalIgnoreCase);

            foreach (var item in items)
            {
                if (item.Quantity == Math.Truncate(item.Quantity)) continue;
                var unit = item.UOM ?? "";
                if (!allowsDecimal.TryGetValue(unit, out var allows) || !allows)
                {
                    throw new InvalidOperationException(
                        $"Quantity '{item.Quantity}' for unit '{unit}' must be a whole number. " +
                        $"Enable decimal quantity for this unit on the Units admin page if fractions are allowed.");
                }
            }
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
            IsFbrExcluded = inv.IsFbrExcluded,
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
                FixedNotifiedValueOrRetailPrice = ii.FixedNotifiedValueOrRetailPrice,
                // Dual-book overlay (2026-05-11). Null when no overlay
                // exists for this line — frontend treats the row above
                // as both bill-mode and invoice-mode values. Non-null
                // means Invoice-mode view should render AdjustedXxx as
                // "current" with the row's own fields as "original".
                Adjustment = ii.Adjustment == null ? null : new InvoiceItemAdjustmentDto
                {
                    Id = ii.Adjustment.Id,
                    AdjustedQuantity = ii.Adjustment.AdjustedQuantity,
                    AdjustedUnitPrice = ii.Adjustment.AdjustedUnitPrice,
                    AdjustedLineTotal = ii.Adjustment.AdjustedLineTotal,
                    AdjustedItemTypeId = ii.Adjustment.AdjustedItemTypeId,
                    AdjustedItemTypeName = ii.Adjustment.AdjustedItemTypeName,
                    AdjustedDescription = ii.Adjustment.AdjustedDescription,
                    AdjustedUOM = ii.Adjustment.AdjustedUOM,
                    AdjustedFbrUOMId = ii.Adjustment.AdjustedFbrUOMId,
                    AdjustedHSCode = ii.Adjustment.AdjustedHSCode,
                    AdjustedSaleType = ii.Adjustment.AdjustedSaleType,
                    Reason = ii.Adjustment.Reason,
                    CreatedAt = ii.Adjustment.CreatedAt,
                    UpdatedAt = ii.Adjustment.UpdatedAt,
                },
            }).ToList(),
            ChallanNumbers = inv.DeliveryChallans.Select(dc => dc.ChallanNumber).ToList(),
            // Aggregate Site / IndentNo / PoNumber from linked challans
            // — joined with "; " when distinct values exist (covers
            // multi-challan bills rolling up two different POs / sites).
            // Empty / whitespace-only entries are dropped before the
            // join so a single-challan bill with a blank PO doesn't
            // surface "" in the card.
            PoNumber = string.Join("; ", inv.DeliveryChallans
                .Select(dc => dc.PoNumber)
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Distinct()),
            IndentNo = string.Join("; ", inv.DeliveryChallans
                .Select(dc => dc.IndentNo)
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Distinct()),
            Site = string.Join("; ", inv.DeliveryChallans
                .Select(dc => dc.Site)
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Distinct()),
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
            // EXCLUDE demo bills (FBR Sandbox) from the max — they live in
            // their own 900000+ range and would otherwise prevent any real
            // bill from being marked IsLatest.
            var maxNumber = await _context.Invoices
                .Where(i => i.CompanyId == companyId && !i.IsDemo)
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
            // when the company has no invoices yet. IsDemo bills live in their
            // own 900000+ range and must not influence the regular sequence.
            int maxExistingInvoice = await _context.Invoices
                .Where(i => i.CompanyId == dto.CompanyId && !i.IsDemo)
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

                // 2026-05-12: stock-out on save (create path).
                await _stock.SyncInvoiceStockMovementsAsync(created);
                await transaction.CommitAsync();

                // Reload with includes
                var loaded = await _invoiceRepo.GetByIdAsync(created.Id);
                return ToDto(loaded!);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "InvoiceService: transaction rolled back");
                await transaction.RollbackAsync();
                throw;
            }
        }

        // ── Standalone bill creation (no linked delivery challan) ─────────
        //
        // For FBR-only flows where the operator never issued a challan
        // (service invoices, retail walk-ins, ad-hoc billing). Re-uses the
        // regular bill numbering sequence so these bills appear on the same
        // Bills page and feed Item Rate History identically. The major
        // differences from CreateAsync above:
        //
        //   • No ChallanIds — operator types items directly. InvoiceItems
        //     are persisted with DeliveryItemId = null (the column is
        //     already nullable on the model).
        //   • No DeliveryChallans navigation gets populated, so no challan
        //     transitions, no PO-date updates, no DeliveryItem usage-count
        //     bump.
        //   • UnitRegistry.EnsureNamesAsync registers any new UOM strings
        //     the operator typed (matches what UpdateAsync already does
        //     for the edit path), then fractional-qty validation runs
        //     against the picked UOMs.
        public async Task<InvoiceDto> CreateStandaloneAsync(CreateStandaloneInvoiceDto dto)
        {
            var company = await _companyRepo.GetByIdAsync(dto.CompanyId);
            if (company == null) throw new KeyNotFoundException("Company not found.");

            var client = await _context.Clients.FindAsync(dto.ClientId);
            if (client == null) throw new KeyNotFoundException("Client not found.");
            if (client.CompanyId != dto.CompanyId)
                throw new InvalidOperationException("Client does not belong to this company.");

            if (dto.Items == null || dto.Items.Count == 0)
                throw new InvalidOperationException("At least one item is required.");
            if (dto.Items.Any(i => i.Quantity <= 0))
                throw new InvalidOperationException("Quantity must be greater than zero.");
            if (dto.Items.Any(i => i.UnitPrice <= 0))
                throw new InvalidOperationException("All items must have a positive unit price.");
            if (dto.GSTRate < 0 || dto.GSTRate > 100)
                throw new InvalidOperationException("GST rate must be between 0 and 100.");

            // Cap bill date at end-of-today UTC — same FBR [0043] guard as UpdateAsync.
            var maxDate = DateTime.UtcNow.Date.AddDays(1).AddTicks(-1);
            if (dto.Date > maxDate)
                throw new InvalidOperationException("Bill date cannot be in the future. [FBR 0043]");

            // Register any newly-typed UOM names + reject fractional qty
            // for integer-only UOMs. Mirrors the contract on the regular
            // create path (which inherits UOM from the challan's DeliveryItem
            // and is already validated upstream).
            await UnitRegistry.EnsureNamesAsync(_context, dto.Items.Select(i => i.UOM));
            await ValidateStandaloneItemDecimalQuantitiesAsync(dto.Items);

            // Preload referenced ItemTypes in a single round-trip
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

            // Per-company FBR defaults — same precedence chain as CreateAsync
            // minus step 3 (DeliveryItem.Unit), since there's no challan.
            var companyDefaultUOM = !string.IsNullOrWhiteSpace(company.FbrDefaultUOM)
                ? company.FbrDefaultUOM
                : "Numbers, pieces, units";
            var companyDefaultSaleType = !string.IsNullOrWhiteSpace(company.FbrDefaultSaleType)
                ? company.FbrDefaultSaleType
                : "Goods at Standard Rate (default)";

            var invoiceItems = new List<InvoiceItem>();
            foreach (var itemDto in dto.Items)
            {
                ItemType? itemType = null;
                if (itemDto.ItemTypeId.HasValue)
                    typeMap.TryGetValue(itemDto.ItemTypeId.Value, out itemType);

                // Same precedence as CreateAsync: explicit DTO field → ItemType
                // catalog → company default → seed value.
                var effectiveUOM = !string.IsNullOrWhiteSpace(itemDto.UOM)
                    ? itemDto.UOM!
                    : !string.IsNullOrWhiteSpace(itemType?.UOM)
                        ? itemType!.UOM!
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

                var lineTotal = itemDto.Quantity * itemDto.UnitPrice;

                invoiceItems.Add(new InvoiceItem
                {
                    DeliveryItemId = null,            // standalone — no source line
                    ItemTypeId = itemType?.Id,
                    ItemTypeName = itemType?.Name ?? "",
                    Description = itemDto.Description ?? "",
                    Quantity = itemDto.Quantity,
                    UOM = effectiveUOM,
                    UnitPrice = itemDto.UnitPrice,
                    LineTotal = lineTotal,
                    HSCode = effectiveHSCode,
                    FbrUOMId = effectiveFbrUOMId,
                    SaleType = effectiveSaleType,
                    RateId = itemDto.RateId,
                    FixedNotifiedValueOrRetailPrice = itemDto.FixedNotifiedValueOrRetailPrice,
                    // SRO refs flow through directly — they're scenario-driven
                    // (only SN028-style reduced-rate bills set them) and are
                    // never derived from the catalog.
                    SroScheduleNo = string.IsNullOrWhiteSpace(itemDto.SroScheduleNo) ? null : itemDto.SroScheduleNo,
                    SroItemSerialNo = string.IsNullOrWhiteSpace(itemDto.SroItemSerialNo) ? null : itemDto.SroItemSerialNo,
                });

                if (itemType != null)
                {
                    itemType.UsageCount += 1;
                    itemType.LastUsedAt = DateTime.UtcNow;
                    _context.ItemTypes.Update(itemType);
                }
            }

            // Bill-header defaults — identical to CreateAsync.
            const int SeededDefaultDocType = 4;
            var effectiveDocType = dto.DocumentType ?? SeededDefaultDocType;

            string? effectivePaymentMode = dto.PaymentMode;
            if (string.IsNullOrWhiteSpace(effectivePaymentMode))
            {
                var isRegistered = client.RegistrationType == "Registered";
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

            if (company.StartingInvoiceNumber == 0)
                throw new InvalidOperationException("Starting invoice number has not been set for this company. Please set it first.");

            // Share the regular numbering sequence — standalone bills are
            // real bills, not demos. MAX(InvoiceNumber) excluding IsDemo
            // matches CreateAsync.
            int maxExistingInvoice = await _context.Invoices
                .Where(i => i.CompanyId == dto.CompanyId && !i.IsDemo)
                .MaxAsync(i => (int?)i.InvoiceNumber) ?? 0;

            int nextInvoiceNumber = maxExistingInvoice > 0
                ? maxExistingInvoice + 1
                : company.StartingInvoiceNumber;
            company.CurrentInvoiceNumber = nextInvoiceNumber;

            // Auto-tag PaymentTerms with the scenario code so FbrService can
            // route Validate / Submit calls to the correct scenarioId without
            // the operator having to type "[SNxxx]" themselves. Pattern matches
            // what InvoiceForm already does on the regular create path.
            //   • If dto.ScenarioId is set AND the existing PaymentTerms
            //     doesn't already start with "[SNxxx]", prepend it.
            //   • If neither is set, PaymentTerms passes through untouched.
            string? finalPaymentTerms = dto.PaymentTerms;
            if (!string.IsNullOrWhiteSpace(dto.ScenarioId))
            {
                var existing = (finalPaymentTerms ?? "").TrimStart();
                var hasTag = existing.StartsWith("[") && existing.Contains("]");
                if (!hasTag)
                    finalPaymentTerms = $"[{dto.ScenarioId.Trim()}] {finalPaymentTerms ?? ""}".Trim();
            }

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
                PaymentTerms = finalPaymentTerms,
                DocumentType = effectiveDocType,
                PaymentMode = effectivePaymentMode,
                FbrInvoiceNumber = string.IsNullOrEmpty(company.InvoiceNumberPrefix)
                    ? nextInvoiceNumber.ToString()
                    : $"{company.InvoiceNumberPrefix}{nextInvoiceNumber}",
                Items = invoiceItems
            };

            await using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                var created = await _invoiceRepo.CreateAsync(invoice);
                await _companyRepo.UpdateAsync(company);

                // Auto-save typed item descriptions for future autocomplete —
                // mirrors CreateAsync.
                var newDescs = dto.Items
                    .Where(i => !string.IsNullOrWhiteSpace(i.Description))
                    .Select(i => i.Description!)
                    .Distinct()
                    .ToList();
                if (newDescs.Count > 0)
                {
                    var existing = await _context.ItemDescriptions
                        .Where(d => newDescs.Contains(d.Name))
                        .Select(d => d.Name)
                        .ToListAsync();
                    foreach (var desc in newDescs.Where(d => !existing.Contains(d)))
                        _context.ItemDescriptions.Add(new ItemDescription { Name = desc });
                    await _context.SaveChangesAsync();
                }

                // 2026-05-12: stock-out on save (standalone create path).
                await _stock.SyncInvoiceStockMovementsAsync(created);
                await transaction.CommitAsync();

                var loaded = await _invoiceRepo.GetByIdAsync(created.Id);
                return ToDto(loaded!);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "InvoiceService: transaction rolled back");
                await transaction.RollbackAsync();
                throw;
            }
        }

        /// <summary>
        /// Same fractional-qty contract as ValidateUpdateItemDecimalQuantitiesAsync
        /// but for the standalone-create DTO shape.
        /// </summary>
        private async Task ValidateStandaloneItemDecimalQuantitiesAsync(List<CreateStandaloneInvoiceItemDto> items)
        {
            var unitNames = items
                .Select(i => i.UOM)
                .Where(u => !string.IsNullOrWhiteSpace(u))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (unitNames.Count == 0) return;

            var unitConfig = (await _context.Units
                .Where(u => unitNames.Contains(u.Name))
                .Select(u => new { u.Name, u.AllowsDecimalQuantity })
                .ToListAsync())
                .ToDictionary(u => u.Name, u => u.AllowsDecimalQuantity, StringComparer.OrdinalIgnoreCase);

            foreach (var it in items)
            {
                if (string.IsNullOrWhiteSpace(it.UOM)) continue;
                if (it.Quantity == Math.Truncate(it.Quantity)) continue;
                if (!unitConfig.TryGetValue(it.UOM!, out var allows) || !allows)
                    throw new InvalidOperationException(
                        $"Quantity '{it.Quantity}' for unit '{it.UOM}' must be a whole number. " +
                        $"Enable decimal quantity for this unit on the Units admin page if fractions are allowed.");
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

            // Auto-register any new UOM names typed on the bill (e.g. an
            // operator overrides UOM on a line) so they appear in the
            // Units admin screen, then reject fractional quantities for
            // integer-only UOMs.
            await MyApp.Api.Helpers.UnitRegistry.EnsureNamesAsync(_context, dto.Items.Select(i => i.UOM));
            await ValidateUpdateItemDecimalQuantitiesAsync(dto.Items);

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
                if (dto.Date.HasValue)
                {
                    // FBR rejects future dates with [0043]. Cap at end-of-today
                    // (UTC) so the operator can pick "today" in any time zone
                    // without tripping the gate.
                    var newDate = dto.Date.Value;
                    var maxDate = DateTime.UtcNow.Date.AddDays(1).AddTicks(-1);
                    if (newDate > maxDate)
                        throw new InvalidOperationException("Bill date cannot be in the future. [FBR 0043]");
                    invoice.Date = newDate;
                }
                invoice.GSTRate = dto.GSTRate;
                invoice.PaymentTerms = dto.PaymentTerms;
                invoice.DocumentType = dto.DocumentType;
                invoice.PaymentMode = dto.PaymentMode;

                // Allow buyer reassignment ONLY on standalone bills (no
                // linked delivery challan). For challan-linked bills the
                // buyer is owned by the challan; changing it here would
                // put the bill out of sync with its source challan, so
                // we surface a clear error instead of silently accepting.
                if (dto.ClientId.HasValue && dto.ClientId.Value != invoice.ClientId)
                {
                    if (invoice.DeliveryChallans != null && invoice.DeliveryChallans.Any())
                        throw new InvalidOperationException(
                            "Cannot change the buyer on a challan-linked bill. " +
                            "Edit the buyer on the linked delivery challan, or recreate the bill.");
                    var newClient = await _context.Clients.FindAsync(dto.ClientId.Value);
                    if (newClient == null)
                        throw new InvalidOperationException($"Client {dto.ClientId.Value} not found.");
                    if (newClient.CompanyId != invoice.CompanyId)
                        throw new InvalidOperationException("Client does not belong to this company.");
                    invoice.ClientId = newClient.Id;
                }

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
                    // SRO references — same: edit-driven, not catalog-inherited.
                    // Required for non-18 % rates (FBR rules 0077 / 0078).
                    if (itemDto.SroScheduleNo != null)
                        existing.SroScheduleNo = itemDto.SroScheduleNo;
                    if (itemDto.SroItemSerialNo != null)
                        existing.SroItemSerialNo = itemDto.SroItemSerialNo;

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
                // 2026-05-12: stock-out on save (full-edit path).
                // See UpdateItemTypesAsync for rationale.
                await _stock.SyncInvoiceStockMovementsAsync(invoice);
                await transaction.CommitAsync();

                var reloaded = await _invoiceRepo.GetByIdAsync(id);
                return reloaded == null ? null : ToDto(reloaded);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "InvoiceService: transaction rolled back");
                await transaction.RollbackAsync();
                throw;
            }
        }

        // ── Narrow edit path: Item Type re-classification (+ optional Qty + Price) ─
        //
        // Two permission flows feed this method, distinguished by the
        // allowQuantityEdit flag (set by the controller from the request's
        // permission gate):
        //
        //   • allowQuantityEdit = false  → invoices.manage.update.itemtype
        //       Operator can only change which ItemType each line points
        //       at. Quantity / UnitPrice values in the payload are
        //       ignored. Used by the FBR-classification helper role.
        //
        //   • allowQuantityEdit = true   → invoices.manage.update.itemtype.qty
        //       Item Type + Quantity + UnitPrice. Common during FBR
        //       classification: operator splits one line into multiple
        //       HS-coded lines, redistributing qty and price. The total-
        //       preservation guard below ensures the bill's bottom line
        //       stays equal to what the buyer was actually billed —
        //       within a small tolerance (configurable, default 2 PKR)
        //       to absorb rounding noise from the rebalance.
        //
        // GST rate, dates, payment terms, doc type, SRO refs, etc. are
        // still ignored on both paths.
        public async Task<InvoiceDto?> UpdateItemTypesAsync(int id, UpdateInvoiceItemTypesDto dto, bool allowQuantityEdit = false, string? actorUserName = null)
        {
            var invoice = await _invoiceRepo.GetByIdAsync(id);
            if (invoice == null) return null;

            if (!IsInvoiceEditable(invoice))
                throw new InvalidOperationException("Cannot edit a bill that has been submitted to FBR.");

            if (dto.Items == null || dto.Items.Count == 0)
                throw new InvalidOperationException("At least one item is required.");

            // Restriction F: zero unit price not allowed when the .qty
            // path is active (operator is editing prices, not just
            // classifying). Negative is also blocked. Zero unit price on
            // an FBR-imported bill would imply giveaway items, which is
            // a real-business workaround not a tax-claim adjustment.
            if (allowQuantityEdit)
            {
                var badPriceRows = dto.Items
                    .Where(r => r.UnitPrice.HasValue && r.UnitPrice.Value <= 0m)
                    .Select(r => r.Id).ToList();
                if (badPriceRows.Count > 0)
                    throw new InvalidOperationException(
                        $"Unit price must be greater than zero. Bill item id(s) [{string.Join(", ", badPriceRows)}] " +
                        $"have zero or negative unit price.");

                var badQtyRows = dto.Items
                    .Where(r => r.Quantity.HasValue && r.Quantity.Value <= 0m)
                    .Select(r => r.Id).ToList();
                if (badQtyRows.Count > 0)
                    throw new InvalidOperationException(
                        $"Quantity must be greater than zero. Bill item id(s) [{string.Join(", ", badQtyRows)}] " +
                        $"have zero or negative quantity.");
            }

            // Capture before-state for the audit log. Snapshot the
            // current values BEFORE we mutate them, so the log can show
            // exactly what changed.
            var beforeSnapshot = invoice.Items.ToDictionary(
                ii => ii.Id,
                ii => new
                {
                    ii.ItemTypeId,
                    ItemTypeName = ii.ItemTypeName,
                    ii.Quantity,
                    ii.UnitPrice,
                    ii.LineTotal,
                });
            var beforeSubtotal = invoice.Subtotal;
            var beforeGrandTotal = invoice.GrandTotal;

            // Reject any incoming ItemId that doesn't exist on the bill
            // (mirror the safety check in UpdateAsync — operator cannot add /
            // remove lines through this path either).
            var existingIds = invoice.Items.Select(ii => ii.Id).ToHashSet();
            var unknownIds = dto.Items.Where(i => i.Id <= 0 || !existingIds.Contains(i.Id))
                                       .Select(i => i.Id).ToList();
            if (unknownIds.Count > 0)
                throw new InvalidOperationException(
                    $"Bill item id(s) [{string.Join(", ", unknownIds)}] do not belong to this bill.");

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

            // If the .qty path is active, validate fractional qty against
            // the (possibly newly-derived) UOM. We project the would-be UOM
            // for each row first so the validation lookup uses the final
            // unit name, not the stale one.
            if (allowQuantityEdit)
            {
                var rowsToValidate = dto.Items
                    .Where(r => r.Quantity.HasValue)
                    .Select(r =>
                    {
                        var existing = invoice.Items.FirstOrDefault(ii => ii.Id == r.Id);
                        var unit = (r.ItemTypeId.HasValue && typeMap.TryGetValue(r.ItemTypeId.Value, out var t))
                            ? (t.UOM ?? "")
                            : (existing?.UOM ?? "");
                        return new { Qty = r.Quantity!.Value, Unit = unit };
                    })
                    .ToList();
                if (rowsToValidate.Count > 0)
                {
                    var unitNames = rowsToValidate.Select(r => r.Unit)
                        .Where(u => !string.IsNullOrWhiteSpace(u))
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToList();
                    var unitConfig = unitNames.Count == 0
                        ? new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase)
                        : (await _context.Units
                            .Where(u => unitNames.Contains(u.Name))
                            .Select(u => new { u.Name, u.AllowsDecimalQuantity })
                            .ToListAsync())
                          .ToDictionary(u => u.Name, u => u.AllowsDecimalQuantity, StringComparer.OrdinalIgnoreCase);

                    foreach (var row in rowsToValidate)
                    {
                        if (row.Qty == Math.Truncate(row.Qty)) continue;
                        if (!unitConfig.TryGetValue(row.Unit, out var allows) || !allows)
                            throw new InvalidOperationException(
                                $"Quantity '{row.Qty}' for unit '{row.Unit}' must be a whole number. " +
                                $"Enable decimal quantity for this unit on the Units admin page if fractions are allowed.");
                    }
                }
            }

            // Dual-book write-mode (2026-05-11):
            //   "adjustment" — only honoured on the .qty path. Each row's
            //                  honoured fields are persisted to an
            //                  InvoiceItemAdjustment overlay (upsert).
            //                  InvoiceItem rows stay untouched, so the
            //                  printed bill keeps its real qty/price.
            //   "bill" (default) — existing behaviour: mutate InvoiceItem
            //                  directly. Both the bill print and the FBR
            //                  view reflect the change.
            //
            // The plain .itemtype endpoint always behaves like "bill"
            // because dto.WriteMode is ignored when allowQuantityEdit is
            // false — Item Type re-classification belongs on the bill
            // proper, not in a tax-filing overlay.
            var asAdjustment = allowQuantityEdit
                && string.Equals(dto.WriteMode, "adjustment", StringComparison.OrdinalIgnoreCase);

            await using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                // Pre-load existing overlays for these items so we upsert
                // in one shot (no per-row roundtrip).
                Dictionary<int, InvoiceItemAdjustment> existingOverlays =
                    asAdjustment
                        ? await _context.InvoiceItemAdjustments
                            .Where(a => a.InvoiceId == invoice.Id)
                            .ToDictionaryAsync(a => a.InvoiceItemId)
                        : new Dictionary<int, InvoiceItemAdjustment>();

                foreach (var row in dto.Items)
                {
                    var existing = invoice.Items.First(ii => ii.Id == row.Id);

                    if (asAdjustment)
                    {
                        // ── Adjustment path (2026-05-12 — narrowed scope) ──
                        // Item Type / UOM / HS Code / Sale Type /
                        // Description are LEGITIMATE bill data — they
                        // describe WHAT was sold, not the qty/price
                        // decomposition. The printed bill and the Tax
                        // Invoice need those values to render correctly.
                        // So we write them straight to InvoiceItem
                        // exactly like the Bill-mode path does.
                        //
                        // ONLY Quantity / UnitPrice / LineTotal go to
                        // the overlay — those are the tax-claim
                        // optimization knobs that should leave the bill
                        // print untouched.
                        if (row.ItemTypeId.HasValue && typeMap.TryGetValue(row.ItemTypeId.Value, out var tAdj))
                        {
                            existing.ItemTypeId   = tAdj.Id;
                            existing.ItemTypeName = tAdj.Name;
                            existing.UOM          = tAdj.UOM ?? "";
                            existing.FbrUOMId     = tAdj.FbrUOMId;
                            existing.HSCode       = tAdj.HSCode;
                            existing.SaleType     = tAdj.SaleType;
                        }
                        else if (!row.ItemTypeId.HasValue)
                        {
                            existing.ItemTypeId   = null;
                            existing.ItemTypeName = "";
                            existing.UOM          = "";
                            existing.FbrUOMId     = null;
                            existing.HSCode       = null;
                            existing.SaleType     = null;
                        }

                        // Numerical decomposition → overlay.
                        decimal? newQty   = row.Quantity.HasValue && row.Quantity.Value > 0 ? row.Quantity.Value : (decimal?)null;
                        decimal? newPrice = row.UnitPrice.HasValue && row.UnitPrice.Value >= 0 ? row.UnitPrice.Value : (decimal?)null;
                        decimal? newLineTotal = null;
                        if (newQty.HasValue || newPrice.HasValue)
                        {
                            var qtyEff   = newQty   ?? existing.Quantity;
                            var priceEff = newPrice ?? existing.UnitPrice;
                            newLineTotal = Math.Round(qtyEff * priceEff, 2, MidpointRounding.AwayFromZero);
                        }

                        bool qtyDiverges       = newQty.HasValue       && newQty.Value       != existing.Quantity;
                        bool priceDiverges     = newPrice.HasValue     && newPrice.Value     != existing.UnitPrice;
                        bool lineTotalDiverges = newLineTotal.HasValue && newLineTotal.Value != existing.LineTotal;
                        bool anyNumDivergence  = qtyDiverges || priceDiverges || lineTotalDiverges;

                        existingOverlays.TryGetValue(existing.Id, out var overlay);
                        if (!anyNumDivergence)
                        {
                            // Numerical values match the bill — drop any
                            // existing overlay (operator reverted to bill
                            // qty/price by way of Reset, or the only
                            // change was an Item Type swap which we
                            // already applied to InvoiceItem above).
                            if (overlay != null)
                            {
                                _context.InvoiceItemAdjustments.Remove(overlay);
                            }
                            continue;
                        }

                        if (overlay == null)
                        {
                            overlay = new InvoiceItemAdjustment
                            {
                                InvoiceItemId = existing.Id,
                                InvoiceId     = invoice.Id,
                                Reason        = "tax-claim-optimization",
                                CreatedAt     = DateTime.UtcNow,
                            };
                            _context.InvoiceItemAdjustments.Add(overlay);
                        }
                        else
                        {
                            overlay.UpdatedAt = DateTime.UtcNow;
                        }
                        // Numerical fields only — everything else stays null.
                        overlay.AdjustedQuantity     = qtyDiverges       ? newQty       : null;
                        overlay.AdjustedUnitPrice    = priceDiverges     ? newPrice     : null;
                        overlay.AdjustedLineTotal   = lineTotalDiverges ? newLineTotal : null;
                        // Explicitly null the deprecated text columns so
                        // any stale rows from before this fix get cleared
                        // on next save.
                        overlay.AdjustedItemTypeId   = null;
                        overlay.AdjustedItemTypeName = null;
                        overlay.AdjustedUOM          = null;
                        overlay.AdjustedFbrUOMId     = null;
                        overlay.AdjustedHSCode       = null;
                        overlay.AdjustedSaleType     = null;
                        overlay.AdjustedDescription  = null;
                        continue;
                    }

                    // ── Bill path (legacy) ──
                    if (row.ItemTypeId.HasValue && typeMap.TryGetValue(row.ItemTypeId.Value, out var t2))
                    {
                        existing.ItemTypeId = t2.Id;
                        existing.ItemTypeName = t2.Name;
                        existing.UOM = t2.UOM ?? "";
                        existing.FbrUOMId = t2.FbrUOMId;
                        existing.HSCode = t2.HSCode;
                        existing.SaleType = t2.SaleType;
                    }
                    else if (!row.ItemTypeId.HasValue)
                    {
                        // When the operator clears the Item Type, also blank
                        // the FBR-classification fields the catalog had been
                        // driving (HSCode, UOM, FbrUOMId, SaleType,
                        // ItemTypeName). Otherwise the row keeps stale data
                        // that came from the now-removed catalog row, and
                        // the bill silently stays "FBR-ready" with values
                        // the operator no longer endorses — they'd ship the
                        // wrong HSCode / SaleType to FBR on the next submit.
                        // Mirrors what EditBillForm.updateItemType already
                        // does on the frontend.
                        existing.ItemTypeId = null;
                        existing.ItemTypeName = "";
                        existing.UOM = "";
                        existing.FbrUOMId = null;
                        existing.HSCode = null;
                        existing.SaleType = null;
                    }

                    // Quantity / UnitPrice edits only on the .qty perm path.
                    // We recompute LineTotal from whichever fields the row
                    // touches, so the bill's totals stay self-consistent.
                    // Both fields are independently optional — the operator
                    // might change just qty, just price, or both per row.
                    if (allowQuantityEdit)
                    {
                        if (row.Quantity.HasValue && row.Quantity.Value > 0)
                            existing.Quantity = row.Quantity.Value;
                        if (row.UnitPrice.HasValue && row.UnitPrice.Value >= 0)
                            existing.UnitPrice = row.UnitPrice.Value;
                        if (row.Quantity.HasValue || row.UnitPrice.HasValue)
                            existing.LineTotal = Math.Round(existing.Quantity * existing.UnitPrice, 2, MidpointRounding.AwayFromZero);
                    }
                }

                // Total-preservation guard.
                //   Bill mode: subtotal driven by InvoiceItem.LineTotal.
                //   Adjustment mode: subtotal driven by overlay.AdjustedLineTotal
                //                    (when present) falling back to InvoiceItem.LineTotal.
                //                    Invoice header totals are NOT mutated in
                //                    adjustment mode — the bill total stays
                //                    locked to the underlying InvoiceItem sum.
                if (allowQuantityEdit && dto.Items.Any(r => r.Quantity.HasValue || r.UnitPrice.HasValue))
                {
                    var originalSubtotal = invoice.Subtotal;
                    decimal newSubtotal;
                    if (asAdjustment)
                    {
                        newSubtotal = invoice.Items.Sum(ii =>
                            existingOverlays.TryGetValue(ii.Id, out var ov) && ov.AdjustedLineTotal.HasValue
                                ? ov.AdjustedLineTotal.Value
                                : ii.LineTotal);
                    }
                    else
                    {
                        newSubtotal = invoice.Items.Sum(ii => ii.LineTotal);
                    }
                    var tolerance = _config.GetValue<decimal?>("Invoice:NarrowEditTotalTolerancePkr") ?? 2m;
                    var diff = Math.Abs(newSubtotal - originalSubtotal);
                    if (diff > tolerance)
                    {
                        throw new InvalidOperationException(
                            $"New bill subtotal Rs. {newSubtotal:N2} differs from the original Rs. {originalSubtotal:N2} " +
                            $"by Rs. {diff:N2} — exceeds the Rs. {tolerance:N2} rounding tolerance. " +
                            $"Adjust qty / unit price so the totals match (within Rs. {tolerance:N0}), " +
                            $"or use the full-edit path if you genuinely need to change the bill amount.");
                    }

                    if (!asAdjustment)
                    {
                        invoice.Subtotal = newSubtotal;
                        invoice.GSTAmount = Math.Round(newSubtotal * (invoice.GSTRate / 100m), 2, MidpointRounding.AwayFromZero);
                        invoice.GrandTotal = newSubtotal + invoice.GSTAmount;
                    }
                }

                // Any edit invalidates a previous validation. Don't touch
                // FbrStatus when the bill was already submitted (PreValidate
                // refuses re-edit anyway thanks to IsInvoiceEditable above).
                if (invoice.FbrStatus != "Submitted")
                {
                    invoice.FbrStatus = null;
                    invoice.FbrErrorMessage = null;
                }

                await _context.SaveChangesAsync();
                // 2026-05-12: stock-out on save. Idempotent — re-syncs
                // the StockMovement rows for this invoice's current item
                // state. Adjustment-mode saves don't change
                // InvoiceItem.Quantity, but we still run the sync so any
                // bill that didn't have movements yet (e.g. created
                // before this code shipped) gets them now. No-op when
                // inventory tracking is off for the company.
                await _stock.SyncInvoiceStockMovementsAsync(invoice);
                await transaction.CommitAsync();

                // ── Audit log (after commit so we don't log a rolled-back op) ──
                // Per-row before/after snapshot for the narrow-edit path.
                // Stored as JSON in RequestBody; the AuditLogs page can
                // pretty-print it. Audit failures must never break the
                // save itself — wrap in try/swallow.
                try
                {
                    var changedRows = new List<object>();
                    foreach (var current in invoice.Items)
                    {
                        if (!beforeSnapshot.TryGetValue(current.Id, out var before)) continue;
                        var changed =
                            before.ItemTypeId      != current.ItemTypeId
                         || before.ItemTypeName    != current.ItemTypeName
                         || before.Quantity        != current.Quantity
                         || before.UnitPrice       != current.UnitPrice
                         || before.LineTotal       != current.LineTotal;
                        if (!changed) continue;
                        changedRows.Add(new
                        {
                            invoiceItemId      = current.Id,
                            previousItemTypeId = before.ItemTypeId,
                            previousItemType   = before.ItemTypeName,
                            newItemTypeId      = current.ItemTypeId,
                            newItemType        = current.ItemTypeName,
                            previousQuantity   = before.Quantity,
                            newQuantity        = current.Quantity,
                            previousUnitPrice  = before.UnitPrice,
                            newUnitPrice       = current.UnitPrice,
                            previousLineTotal  = before.LineTotal,
                            newLineTotal       = current.LineTotal,
                        });
                    }
                    if (changedRows.Count > 0)
                    {
                        var payload = System.Text.Json.JsonSerializer.Serialize(new
                        {
                            invoiceId          = invoice.Id,
                            invoiceNumber      = invoice.InvoiceNumber,
                            companyId          = invoice.CompanyId,
                            mode               = allowQuantityEdit ? "itemtype+qty+price" : "itemtype-only",
                            previousSubtotal   = beforeSubtotal,
                            newSubtotal        = invoice.Subtotal,
                            previousGrandTotal = beforeGrandTotal,
                            newGrandTotal      = invoice.GrandTotal,
                            differenceAmount   = Math.Abs(invoice.Subtotal - beforeSubtotal),
                            rows               = changedRows,
                        });

                        await _auditLog.LogAsync(new AuditLog
                        {
                            Level         = "Info",
                            UserName      = actorUserName,
                            HttpMethod    = "PATCH",
                            RequestPath   = $"/invoices/{invoice.Id}/{(allowQuantityEdit ? "itemtypes-and-qty" : "itemtypes")}",
                            StatusCode    = 200,
                            ExceptionType = "Invoice.NarrowEdit",
                            Message       = $"Bill #{invoice.InvoiceNumber}: {changedRows.Count} line(s) edited "
                                          + $"({(allowQuantityEdit ? "itemtype+qty+price" : "itemtype-only")}). "
                                          + $"Subtotal {beforeSubtotal:N2} → {invoice.Subtotal:N2} "
                                          + $"(diff Rs. {Math.Abs(invoice.Subtotal - beforeSubtotal):N2}).",
                            RequestBody   = payload.Length > 4000 ? payload[..4000] : payload,
                        });
                    }
                }
                catch { /* audit must never break the save */ }

                var reloaded = await _invoiceRepo.GetByIdAsync(id);
                return reloaded == null ? null : ToDto(reloaded);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "InvoiceService: transaction rolled back");
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

        public async Task<InvoiceDto?> SetFbrExcludedAsync(int id, bool excluded)
        {
            // Tracked fetch via DbContext so EF picks up the flag change —
            // the repository's GetByIdAsync uses AsNoTracking for performance
            // which would silently drop the update.
            var invoice = await _context.Invoices
                .Include(i => i.Items)
                .Include(i => i.Company)
                .Include(i => i.Client)
                .Include(i => i.DeliveryChallans)
                .FirstOrDefaultAsync(i => i.Id == id);
            if (invoice == null) return null;

            invoice.IsFbrExcluded = excluded;
            await _context.SaveChangesAsync();
            return ToDto(invoice);
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
            // Demo bills (FBR Sandbox) live in their own 900000+ range and
            // are excluded so the latest-real-bill rule isn't blocked by
            // demo numbers. Demo deletes are gated by FbrSandboxService.
            var maxNumber = invoice.IsDemo
                ? await _context.Invoices
                    .Where(i => i.CompanyId == invoice.CompanyId && i.IsDemo)
                    .MaxAsync(i => (int?)i.InvoiceNumber) ?? 0
                : await _context.Invoices
                    .Where(i => i.CompanyId == invoice.CompanyId && !i.IsDemo)
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

                // 2026-05-12: stock movements for this bill need to be
                // purged before the row goes — otherwise the on-hand
                // calculation keeps treating the (now-deleted) bill as
                // a live deduction. SourceId references aren't FKs so
                // EF won't cascade these; we delete explicitly.
                var staleMovements = await _context.StockMovements
                    .Where(m => m.CompanyId  == invoice.CompanyId
                             && m.SourceType == StockMovementSourceType.Invoice
                             && m.SourceId   == invoice.Id)
                    .ToListAsync();
                if (staleMovements.Count > 0)
                    _context.StockMovements.RemoveRange(staleMovements);

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
            catch (Exception ex)
            {
                _logger.LogError(ex, "InvoiceService: transaction rolled back");
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
                // Round to whole rupees for the printed bill so the displayed
                // grand total matches AmountInWords. Stored DB value keeps
                // 2-dp precision; this is purely a print transformation.
                GrandTotal = NumberToWordsConverter.RoundForDisplay(inv.GrandTotal),
                // Recompute words at print time so old bills (whose stored
                // AmountInWords was written under the prior ceil rule) stay in
                // sync with the rounded total without needing a re-save.
                AmountInWords = NumberToWordsConverter.Convert(inv.GrandTotal),
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
                // Round whole-rupees to keep the printed total in sync with
                // the in-words line — same transformation as PrintBillDto.
                GrandTotal = NumberToWordsConverter.RoundForDisplay(inv.GrandTotal),
                // Recompute words at print time so old bills stay in sync.
                AmountInWords = NumberToWordsConverter.Convert(inv.GrandTotal),
                FbrIRN = inv.FbrIRN,
                FbrStatus = inv.FbrStatus,
                FbrSubmittedAt = inv.FbrSubmittedAt,
                // 2026-05-12: apply the InvoiceItemAdjustment overlay
                // before grouping. The Tax Invoice is the document the
                // buyer reconciles against Annexure-A on FBR's side, so
                // it MUST mirror the FBR-submitted decomposition (qty +
                // unit price + line total). Bill print (GetPrintBillAsync)
                // continues to render real bill-row values for the
                // customer-facing receipt. The overlay only touches
                // numerical fields; item type / UOM / HS / sale type
                // already live on InvoiceItem.
                Items = BuildTaxInvoiceItems(inv),
            };
        }

        /// <summary>
        /// Item-list builder for <see cref="GetPrintTaxInvoiceAsync"/>.
        /// Projects each row through any attached overlay, then groups by
        /// ItemTypeName when every line is classified (same fallback rule
        /// as FBR submission and the existing print path).
        /// </summary>
        private static List<PrintTaxItemDto> BuildTaxInvoiceItems(Invoice inv)
        {
            var effective = inv.Items.Select(ApplyOverlayForPrint).ToList();
            if (effective.All(ii => !string.IsNullOrWhiteSpace(ii.ItemTypeName)))
            {
                return effective
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
                    }).ToList();
            }
            return effective.Select(ii =>
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
            }).ToList();
        }

        /// <summary>
        /// Project an InvoiceItem through any attached overlay for
        /// Tax-Invoice rendering. Mirrors FbrService.ApplyAdjustmentOverlay:
        /// numerical fields come from the overlay when set, everything
        /// else (item type / HS / UOM / sale type / description) from
        /// the bill row. Returns a fresh instance — never mutates source.
        /// 2026-05-12: added.
        /// </summary>
        private static InvoiceItem ApplyOverlayForPrint(InvoiceItem ii)
        {
            if (ii.Adjustment == null) return ii;
            var a = ii.Adjustment;
            return new InvoiceItem
            {
                Id              = ii.Id,
                InvoiceId       = ii.InvoiceId,
                DeliveryItemId  = ii.DeliveryItemId,
                ItemTypeId      = ii.ItemTypeId,
                ItemTypeName    = ii.ItemTypeName,
                Description     = ii.Description,
                Quantity        = a.AdjustedQuantity  ?? ii.Quantity,
                UOM             = ii.UOM,
                UnitPrice       = a.AdjustedUnitPrice ?? ii.UnitPrice,
                LineTotal       = a.AdjustedLineTotal ?? ii.LineTotal,
                HSCode          = ii.HSCode,
                FbrUOMId        = ii.FbrUOMId,
                SaleType        = ii.SaleType,
                RateId          = ii.RateId,
                FixedNotifiedValueOrRetailPrice = ii.FixedNotifiedValueOrRetailPrice,
                SroScheduleNo   = ii.SroScheduleNo,
                SroItemSerialNo = ii.SroItemSerialNo,
                ItemType        = ii.ItemType,
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

        public async Task<List<AwaitingPurchaseInvoiceDto>> GetAwaitingPurchaseAsync(int companyId)
        {
            // A bill qualifies for the "Purchase Against Sale Bill" picker if:
            //   • not yet submitted to FBR (still mutable)
            //   • EVERY line on it has an ItemTypeId set (so grouping works)
            //   • at least one line has empty HSCode (= needs procurement)
            //   • that line still has remaining qty (sold − already procured)
            //
            // Bills with mixed-classification lines (some with ItemTypeId,
            // some without) are excluded — operator must classify all
            // lines first so the procurement form can show clean groups.

            // Sum of "already procured" qty per InvoiceItem, computed from
            // the join table.
            var procuredPerItem = _context.PurchaseItemSourceLines
                .Join(_context.PurchaseItems,
                      psl => psl.PurchaseItemId,
                      pi => pi.Id,
                      (psl, pi) => new { psl.InvoiceItemId, pi.Quantity });

            // We need raw item rows to compute the per-bill qualification
            // server-side. EF will translate the LINQ to a single query.
            var rawLines = await (
                from i in _context.Invoices
                join ii in _context.InvoiceItems on i.Id equals ii.InvoiceId
                where i.CompanyId == companyId
                   && i.FbrStatus != "Submitted"
                   && !i.IsDemo
                select new
                {
                    i.Id,
                    i.InvoiceNumber,
                    i.Date,
                    i.ClientId,
                    ClientName = i.Client.Name,
                    InvoiceItemId = ii.Id,
                    ii.HSCode,
                    ii.ItemTypeId,
                    SoldQty = ii.Quantity,
                    PurchasedQty = procuredPerItem
                        .Where(p => p.InvoiceItemId == ii.Id)
                        .Sum(p => (int?)p.Quantity) ?? 0,
                }).ToListAsync();

            var grouped = rawLines.GroupBy(x => new {
                x.Id, x.InvoiceNumber, x.Date, x.ClientId, x.ClientName
            });

            var result = new List<AwaitingPurchaseInvoiceDto>();
            foreach (var bill in grouped)
            {
                var lines = bill.ToList();
                // Every line must have ItemTypeId — bills with stragglers
                // are filtered out per the user's rule ("if no item type
                // is selected on bill, that bill doesn't show").
                if (lines.Any(l => l.ItemTypeId == null)) continue;

                var awaiting = lines
                    .Where(l => string.IsNullOrWhiteSpace(l.HSCode)
                             && (l.SoldQty - l.PurchasedQty) > 0)
                    .ToList();
                if (awaiting.Count == 0) continue;

                result.Add(new AwaitingPurchaseInvoiceDto
                {
                    InvoiceId = bill.Key.Id,
                    InvoiceNumber = bill.Key.InvoiceNumber,
                    Date = bill.Key.Date,
                    ClientId = bill.Key.ClientId,
                    ClientName = bill.Key.ClientName,
                    LinesAwaiting = awaiting.Count,
                    TotalQtyRemaining = awaiting.Sum(l => l.SoldQty - l.PurchasedQty),
                });
            }
            return result.OrderByDescending(x => x.Date)
                         .ThenByDescending(x => x.InvoiceNumber)
                         .ToList();
        }

        public async Task<PurchaseTemplateDto?> GetPurchaseTemplateAsync(int invoiceId)
        {
            var invoice = await _context.Invoices
                .Include(i => i.Client)
                .Include(i => i.Items)
                    .ThenInclude(ii => ii.ItemType)
                .FirstOrDefaultAsync(i => i.Id == invoiceId);
            if (invoice == null) return null;

            var lineIds = invoice.Items.Select(x => x.Id).ToList();

            // Pre-compute already-procured qty per InvoiceItem in one query.
            var procuredMap = await _context.PurchaseItemSourceLines
                .Where(psl => lineIds.Contains(psl.InvoiceItemId))
                .Join(_context.PurchaseItems,
                      psl => psl.PurchaseItemId,
                      pi => pi.Id,
                      (psl, pi) => new { psl.InvoiceItemId, pi.Quantity })
                .GroupBy(x => x.InvoiceItemId)
                .Select(g => new { InvoiceItemId = g.Key, Total = g.Sum(x => x.Quantity) })
                .ToDictionaryAsync(x => x.InvoiceItemId, x => x.Total);

            // Group HSCode-empty lines by ItemTypeId. Lines without
            // ItemTypeId would have disqualified the bill at picker
            // level, so we shouldn't see any here — but defensively skip.
            var groups = invoice.Items
                .Where(ii => string.IsNullOrWhiteSpace(ii.HSCode) && ii.ItemTypeId.HasValue)
                .GroupBy(ii => ii.ItemTypeId!.Value)
                .Select(g => {
                    var sample = g.First();
                    var soldQty = g.Sum(x => x.Quantity);
                    var procuredQty = g.Sum(x => procuredMap.GetValueOrDefault(x.Id));
                    var remaining = soldQty - procuredQty;
                    var firstDesc = g.First().Description;
                    var moreCount = g.Count() - 1;
                    return new PurchaseTemplateLineDto
                    {
                        ItemTypeId = g.Key,
                        ItemTypeName = sample.ItemType?.Name ?? sample.ItemTypeName,
                        InvoiceItemIds = g.Select(x => x.Id).ToList(),
                        LineCount = g.Count(),
                        Description = moreCount > 0
                            ? $"{firstDesc} (+ {moreCount} more)"
                            : firstDesc,
                        SoldQty = soldQty,
                        PurchasedQty = procuredQty,
                        RemainingQty = remaining,
                        SaleUom = g.GroupBy(x => x.UOM)
                            .OrderByDescending(g2 => g2.Count())
                            .Select(g2 => g2.Key)
                            .FirstOrDefault(),
                        AvgSaleUnitPrice = g.Average(x => x.UnitPrice),
                    };
                })
                .Where(line => line.RemainingQty > 0)
                .OrderBy(line => line.ItemTypeName)
                .ToList();

            return new PurchaseTemplateDto
            {
                InvoiceId = invoice.Id,
                InvoiceNumber = invoice.InvoiceNumber,
                Date = invoice.Date,
                ClientId = invoice.ClientId,
                ClientName = invoice.Client?.Name ?? "",
                Items = groups,
            };
        }

        public async Task<ItemRateHistoryResultDto> GetItemRateHistoryAsync(
            int companyId, int page, int pageSize,
            int? itemTypeId, string? search,
            int? clientId, DateTime? dateFrom, DateTime? dateTo)
        {
            // Flat InvoiceItem projection scoped to one company. We project
            // to the row DTO directly so EF translates the whole thing into
            // a single SQL query — no in-memory filtering.
            //
            // Demo bills (IsDemo=true, generated by the FBR Sandbox tab) are
            // EXCLUDED — they're synthetic rates that don't reflect what the
            // user actually charged a real customer, so leaving them in
            // would skew the avg/min/max summary band and mislead quoting.
            var q = _context.InvoiceItems
                .Where(ii => ii.Invoice.CompanyId == companyId && !ii.Invoice.IsDemo);

            if (itemTypeId.HasValue && itemTypeId.Value > 0)
            {
                q = q.Where(ii => ii.ItemTypeId == itemTypeId.Value);
            }
            else if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.ToLower();
                q = q.Where(ii =>
                    ii.Description.ToLower().Contains(term) ||
                    (ii.ItemType != null && ii.ItemType.Name.ToLower().Contains(term)));
            }

            if (clientId.HasValue && clientId.Value > 0)
                q = q.Where(ii => ii.Invoice.ClientId == clientId.Value);
            if (dateFrom.HasValue)
                q = q.Where(ii => ii.Invoice.Date >= dateFrom.Value);
            if (dateTo.HasValue)
                q = q.Where(ii => ii.Invoice.Date <= dateTo.Value);

            var totalCount = await q.CountAsync();

            // Compute summary band over the FULL filtered set (not the page).
            // Avg/Min/Max sit in the result header so the operator sees the
            // rate range without paging through. EF will SUM/MIN/MAX server-side.
            decimal? avg = null, min = null, max = null;
            if (totalCount > 0)
            {
                avg = await q.AverageAsync(ii => ii.UnitPrice);
                min = await q.MinAsync(ii => ii.UnitPrice);
                max = await q.MaxAsync(ii => ii.UnitPrice);
            }

            var rows = await q
                .OrderByDescending(ii => ii.Invoice.Date)
                .ThenByDescending(ii => ii.Invoice.InvoiceNumber)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(ii => new ItemRateHistoryRowDto
                {
                    InvoiceItemId = ii.Id,
                    InvoiceId = ii.InvoiceId,
                    InvoiceNumber = ii.Invoice.InvoiceNumber,
                    Date = ii.Invoice.Date,
                    ClientId = ii.Invoice.ClientId,
                    ClientName = ii.Invoice.Client.Name,
                    ItemTypeId = ii.ItemTypeId,
                    ItemTypeName = ii.ItemType != null ? ii.ItemType.Name : ii.ItemTypeName,
                    Description = ii.Description,
                    Quantity = ii.Quantity,
                    UOM = ii.UOM,
                    UnitPrice = ii.UnitPrice,
                    LineTotal = ii.LineTotal
                })
                .ToListAsync();

            return new ItemRateHistoryResultDto
            {
                Items = rows,
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize,
                AvgUnitPrice = avg,
                MinUnitPrice = min,
                MaxUnitPrice = max
            };
        }

        public async Task<List<LastRateDto>> GetLastRatesForChallanAsync(int companyId, int challanId)
        {
            // Pull the challan's items (including ItemType + description). We
            // scope by companyId AS WELL to defend against cross-tenant probes
            // — a user can only see last-rates for their own challan.
            var challan = await _context.DeliveryChallans
                .Include(dc => dc.Items)
                .FirstOrDefaultAsync(dc => dc.Id == challanId && dc.CompanyId == companyId);
            if (challan == null) return new List<LastRateDto>();

            var result = new List<LastRateDto>();

            // Build a single query base — we'll execute it once per item below.
            // Demo bills are excluded so synthetic FBR sandbox prices don't
            // leak into real quoting.
            var bills = _context.InvoiceItems
                .Where(ii => ii.Invoice.CompanyId == companyId && !ii.Invoice.IsDemo);

            foreach (var di in challan.Items)
            {
                LastRateDto row = new() { DeliveryItemId = di.Id };

                // 1. Match by ItemTypeId — the precise path.
                if (di.ItemTypeId.HasValue)
                {
                    var hit = await bills
                        .Where(ii => ii.ItemTypeId == di.ItemTypeId.Value)
                        .OrderByDescending(ii => ii.Invoice.Date)
                        .ThenByDescending(ii => ii.Invoice.InvoiceNumber)
                        .Select(ii => new
                        {
                            ii.UnitPrice,
                            ii.Invoice.InvoiceNumber,
                            ii.Invoice.Date,
                            ClientName = ii.Invoice.Client.Name
                        })
                        .FirstOrDefaultAsync();
                    if (hit != null)
                    {
                        row.LastUnitPrice = hit.UnitPrice;
                        row.LastInvoiceNumber = hit.InvoiceNumber;
                        row.LastInvoiceDate = hit.Date;
                        row.LastClientName = hit.ClientName;
                        row.MatchedBy = "ItemType";
                    }
                }

                // 2. Fallback: exact (case-insensitive) Description match.
                if (row.LastUnitPrice == null && !string.IsNullOrWhiteSpace(di.Description))
                {
                    var desc = di.Description.ToLower();
                    var hit = await bills
                        .Where(ii => ii.Description.ToLower() == desc)
                        .OrderByDescending(ii => ii.Invoice.Date)
                        .ThenByDescending(ii => ii.Invoice.InvoiceNumber)
                        .Select(ii => new
                        {
                            ii.UnitPrice,
                            ii.Invoice.InvoiceNumber,
                            ii.Invoice.Date,
                            ClientName = ii.Invoice.Client.Name
                        })
                        .FirstOrDefaultAsync();
                    if (hit != null)
                    {
                        row.LastUnitPrice = hit.UnitPrice;
                        row.LastInvoiceNumber = hit.InvoiceNumber;
                        row.LastInvoiceDate = hit.Date;
                        row.LastClientName = hit.ClientName;
                        row.MatchedBy = "Description";
                    }
                }

                result.Add(row);
            }

            return result;
        }
    }
}

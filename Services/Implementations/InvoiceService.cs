using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;
using MyApp.Api.Services.Tax;

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
        // 2026-05-13: used by the standalone + update paths to auto-fill
        // the FBR-recommended UOM when the operator picked an HSCode but
        // left UOM blank. Also lets the server reject "no UOM AND no
        // HSCode" combos with a clear message instead of silently
        // falling back to the company default.
        private readonly ITaxMappingEngine _taxEngine;
        // Phase B: every invoice save/cancel/delete re-syncs the bill's GL
        // journal entry (no-op unless the company enabled GL posting).
        private readonly IPostingService _posting;
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
            ITaxMappingEngine taxEngine,
            IPostingService posting,
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
            _taxEngine = taxEngine;
            _posting = posting;
        }

        /// <summary>
        /// UOM resolution policy applied to invoice / standalone-invoice
        /// lines (2026-05-13).
        ///
        /// Rules:
        ///   • If the operator typed a UOM, use it (after registering it
        ///     in the Units table for the autocomplete to pick up).
        ///   • If a linked ItemType carries a UOM, inherit it.
        ///   • If an HSCode is provided but UOM is blank, ask the tax
        ///     engine for the FBR-recommended UOM and use that (also
        ///     register it in Units).
        ///   • Otherwise — neither operator UOM, ItemType UOM, nor HSCode —
        ///     throw. Pre-fix the silent fallback to a company default
        ///     hid missing-UOM bugs that later failed FBR submission.
        /// </summary>
        private async Task<(string Uom, int? FbrUomId)> ResolveUomAsync(
            int companyId,
            string? operatorUom,
            int? operatorFbrUomId,
            ItemType? linkedItemType,
            string? hsCode,
            string itemDescription)
        {
            if (!string.IsNullOrWhiteSpace(operatorUom))
            {
                await UnitRegistry.EnsureNamesAsync(_context, new[] { operatorUom });
                return (operatorUom!, operatorFbrUomId ?? linkedItemType?.FbrUOMId);
            }
            if (!string.IsNullOrWhiteSpace(linkedItemType?.UOM))
                return (linkedItemType!.UOM!, operatorFbrUomId ?? linkedItemType.FbrUOMId);

            if (!string.IsNullOrWhiteSpace(hsCode))
            {
                try
                {
                    var suggested = await _taxEngine.SuggestDefaultUomAsync(companyId, hsCode!);
                    if (suggested != null && !string.IsNullOrWhiteSpace(suggested.Description))
                    {
                        await UnitRegistry.EnsureNamesAsync(_context, new[] { suggested.Description });
                        return (suggested.Description, suggested.UOM_ID);
                    }
                }
                catch
                {
                    // FBR token missing / network down — fall through to
                    // the required-UOM error below. Operator can still
                    // save by typing a UOM explicitly.
                }
            }

            throw new InvalidOperationException(
                $"UOM is required for item '{itemDescription}'. " +
                "Pick a UOM from the autocomplete, OR pick an HS Code so " +
                "the FBR-recommended UOM can be auto-filled.");
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
        /// A cancelled (voided) bill is locked too — it is kept only as a
        /// numbered record and must never be re-opened for editing.
        /// </summary>
        private static bool IsInvoiceEditable(Invoice inv) => inv.FbrStatus != "Submitted" && !inv.IsCancelled;

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
            DivisionId = inv.DivisionId,
            DivisionName = inv.Division?.Name,
            ClientId = inv.ClientId,
            ClientName = inv.Client?.Name ?? "",
            Subtotal = inv.Subtotal,
            GSTRate = inv.GSTRate,
            GSTAmount = inv.GSTAmount,
            GrandTotal = inv.GrandTotal,
            AmountInWords = inv.AmountInWords,
            PaymentTerms = inv.PaymentTerms,
            DueDate = inv.DueDate,
            AmountPaid = inv.AmountPaid,
            BalanceDue = PaymentStatusCalculator.BalanceDue(inv.GrandTotal, inv.AmountPaid),
            PaymentStatus = PaymentStatusCalculator.Status(inv.GrandTotal, inv.AmountPaid, inv.DueDate).ToString(),
            DaysOverdue = PaymentStatusCalculator.DaysOverdue(inv.GrandTotal, inv.AmountPaid, inv.DueDate),
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
            IsCancelled = inv.IsCancelled,
            CancelledAt = inv.CancelledAt,
            CancelReason = inv.CancelReason,
            OriginalInvoiceId = inv.OriginalInvoiceId,
            OriginalInvoiceNumber = inv.OriginalInvoice?.InvoiceNumber,
            OriginalInvoiceRefIRN = inv.OriginalInvoiceRefIRN,
            NoteReason = inv.NoteReason,
            NoteReasonRemarks = inv.NoteReasonRemarks,
            NoteAffectsStock = inv.NoteAffectsStock,
            FbrReady = missing.Count == 0,
            FbrMissing = missing,
            Items = inv.Items.Select(ii => new InvoiceItemDto
            {
                Id = ii.Id,
                DeliveryItemId = ii.DeliveryItemId,
                ItemTypeId = ii.ItemTypeId,
                ItemTypeName = ii.ItemType?.Name ?? ii.ItemTypeName,
                NonInventoryItemId = ii.NonInventoryItemId,
                NonInventoryItemName = ii.NonInventoryItem?.Name,
                AccountId = ii.AccountId,
                AccountName = ii.Account?.Name,
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
            // Prefer the bill's own stored PO (set at create from the order /
            // challan / manual entry); fall back to the challan-aggregated value
            // for legacy bills saved before the invoice carried its own PO.
            PoNumber = !string.IsNullOrWhiteSpace(inv.PoNumber)
                ? inv.PoNumber
                : string.Join("; ", inv.DeliveryChallans
                    .Select(dc => dc.PoNumber)
                    .Where(s => !string.IsNullOrWhiteSpace(s))
                    .Distinct()),
            PoDate = inv.PoDate ?? inv.DeliveryChallans.Select(dc => dc.PoDate).FirstOrDefault(d => d.HasValue),
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

        public async Task<List<InvoiceDto>> GetByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null)
        {
            var invoices = await _invoiceRepo.GetByCompanyAsync(companyId, allowedDivisionIds);
            var dtos = invoices.Select(ToDto).ToList();
            await AttachReversalInfoAsync(dtos);
            return dtos;
        }

        /// <summary>
        /// Stamp each sale invoice with the numbers of any LIVE notes against
        /// it: the Credit Note (return/reversal — hides the Reverse action,
        /// shows "Reversed by CN #N") and the Debit Note (upward adjustment).
        /// One round-trip for the whole page.
        /// </summary>
        private async Task AttachReversalInfoAsync(List<InvoiceDto> dtos)
        {
            var ids = dtos
                .Where(d => d.DocumentType != 9 && d.DocumentType != 10)
                .Select(d => d.Id)
                .ToList();
            if (ids.Count == 0) return;
            var noteMap = await _context.Invoices
                .Where(n => (n.DocumentType == 9 || n.DocumentType == 10) && !n.IsCancelled
                         && n.OriginalInvoiceId != null && ids.Contains(n.OriginalInvoiceId.Value))
                .Select(n => new { OriginalId = n.OriginalInvoiceId!.Value, n.DocumentType, n.InvoiceNumber })
                .ToListAsync();
            foreach (var d in dtos)
            {
                d.ReversedByCreditNoteNumber = noteMap
                    .Where(n => n.OriginalId == d.Id && n.DocumentType == 10)
                    .Select(n => (int?)n.InvoiceNumber).Max();
                d.AdjustedByDebitNoteNumber = noteMap
                    .Where(n => n.OriginalId == d.Id && n.DocumentType == 9)
                    .Select(n => (int?)n.InvoiceNumber).Max();
            }
        }

        public async Task<PagedResult<InvoiceDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, int? clientId = null,
            DateTime? dateFrom = null, DateTime? dateTo = null,
            int? noteType = null, int? divisionId = null,
            HashSet<int>? allowedDivisionIds = null)
        {
            var (items, totalCount) = await _invoiceRepo.GetPagedByCompanyAsync(
                companyId, page, pageSize, search, clientId, dateFrom, dateTo, noteType, divisionId,
                allowedDivisionIds);

            // Gate the Delete button client-side — only the highest-numbered
            // bill for this company is deletable. Earlier bills must be edited.
            // EXCLUDE demo bills (FBR Sandbox) from the max — they live in
            // their own 900000+ range and would otherwise prevent any real
            // bill from being marked IsLatest. Scoped to the requested group
            // (sale bills / debit notes / credit notes), which each run their
            // own sequence.
            var maxNumber = await _context.Invoices
                .Where(i => i.CompanyId == companyId && !i.IsDemo
                         && (noteType == null
                              ? (i.DocumentType != 9 && i.DocumentType != 10)
                              : i.DocumentType == noteType))
                .MaxAsync(i => (int?)i.InvoiceNumber) ?? 0;

            var dtos = items.Select(ToDto).ToList();
            foreach (var d in dtos)
                d.IsLatest = d.InvoiceNumber == maxNumber;
            await AttachReversalInfoAsync(dtos);

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
            if (inv == null) return null;
            var dto = ToDto(inv);
            await AttachReversalInfoAsync(new List<InvoiceDto> { dto });
            return dto;
        }

        /// <summary>
        /// Hard-block oversell guard for bill creation. MUST be called inside
        /// the create transaction: it takes a per-company app lock so concurrent
        /// bills consuming the last units serialise, then re-checks physical
        /// availability under the lock. No-op unless InventoryTrackingEnabled
        /// &amp;&amp; StockGuardHardBlock. Throws StockShortageException (→ 409).
        /// Availability is policy-aware (V2 tracks non-HS items too).
        /// </summary>
        private async Task AssertBillStockAvailabilityAsync(Company company, int companyId, IEnumerable<InvoiceItem> items)
        {
            if (!(company.InventoryTrackingEnabled && company.StockGuardHardBlock)) return;
            await MyApp.Api.Helpers.StockLock.AcquireCompanyAsync(_context, companyId);

            var requirements = items
                .Where(i => i.ItemTypeId.HasValue)
                .Select(i => new StockRequirement(i.ItemTypeId!.Value, i.ItemTypeName ?? "", i.Quantity))
                .ToList();
            if (requirements.Count == 0) return;

            var shortages = await _stock.CheckAvailabilityAsync(companyId, requirements);
            if (shortages.Count > 0)
            {
                var details = shortages
                    .Select(s => new StockShortageDetail(s.ItemTypeId, s.ItemName, s.RequiredQuantity, s.OnHandQuantity))
                    .ToList();
                var names = string.Join(", ", shortages.Select(s =>
                    $"{s.ItemName} (need {s.RequiredQuantity}, have {s.OnHandQuantity})"));
                throw new StockShortageException("Insufficient stock to issue this bill: " + names, details);
            }
        }

        public async Task<InvoiceDto> CreateAsync(CreateInvoiceDto dto)
        {
            var company = await _companyRepo.GetByIdAsync(dto.CompanyId);
            if (company == null) throw new KeyNotFoundException("Company not found.");

            // Cross-tenant link guard: the buyer must belong to the same company
            // as the bill. Without this, a forged dto.ClientId from CompanyB
            // could be saved on a CompanyA invoice (CLAUDE.md "data integrity"
            // — cross-tenant entity links). The standalone-bill path and the
            // update path already do this; the challan-based create did not.
            var buyer = await _context.Clients.FindAsync(dto.ClientId);
            if (buyer == null) throw new KeyNotFoundException("Client not found.");
            if (buyer.CompanyId != dto.CompanyId)
                throw new InvalidOperationException("Client does not belong to this company.");

            // FBR [0043] rejects future-dated bills. Same PKT date-only guard as
            // the standalone + update paths — the from-challan bill form lets the
            // operator override the bill date, so it needs the check too.
            if (PakistanClock.IsFutureInvoiceDate(dto.Date))
                throw new InvalidOperationException("Bill date cannot be in the future. [FBR 0043]");

            // Load and validate all challans
            var challans = new List<DeliveryChallan>();
            foreach (var challanId in dto.ChallanIds)
            {
                var dc = await _challanRepo.GetByIdAsync(challanId);
                if (dc == null) throw new KeyNotFoundException($"Challan {challanId} not found.");
                // Both "Pending" (natively-created) and "Imported" (back-filled)
                // are billable. "No PO" is billable only when the company runs
                // with FBR OFF — those tenants routinely sell without a
                // customer PO, so the needs-a-PO gate (an FBR / PO-driven
                // workflow rule) would dead-end their SO → challan → bill
                // flow. Everything else (Invoiced, Cancelled, Setup Required)
                // always blocks bill creation.
                var billable = dc.Status == "Pending" || dc.Status == "Imported"
                            || (dc.Status == "No PO" && !company.FbrEnabled);
                if (!billable)
                    throw new InvalidOperationException($"Challan {dc.ChallanNumber} is not in a billable status (got '{dc.Status}').");
                if (dc.CompanyId != dto.CompanyId) throw new InvalidOperationException($"Challan {dc.ChallanNumber} does not belong to this company.");
                challans.Add(dc);
            }

            // SO-mandatory billing (opt-in per company): every bill must trace
            // to a Sales Order — so each billed challan must be linked to one,
            // and a challan-less bill isn't allowed on this path.
            if (company.RequireSalesOrderForBilling)
            {
                if (challans.Count == 0)
                    throw new InvalidOperationException("This company requires every bill to be created from a Sales Order.");
                var orphan = challans.FirstOrDefault(c => c.SalesOrderId == null);
                if (orphan != null)
                    throw new InvalidOperationException($"Challan {orphan.ChallanNumber} isn't linked to a Sales Order — this company requires every bill to come from one.");
            }

            // Explicitly-picked catalog types on the incoming lines — the
            // operator can (re)classify at bill time, Bills tab included.
            // Preloaded in a single round-trip, same as the standalone path.
            var pickedTypeIds = dto.Items
                .Where(i => i.ItemTypeId.HasValue)
                .Select(i => i.ItemTypeId!.Value)
                .Distinct()
                .ToList();
            var pickedTypeMap = pickedTypeIds.Count == 0
                ? new Dictionary<int, ItemType>()
                : await _context.ItemTypes
                    .Where(t => pickedTypeIds.Contains(t.Id))
                    .ToDictionaryAsync(t => t.Id);

            // Build invoice items from delivery items + user-provided unit prices
            var validAccountIds = await ValidCompanyAccountIdsAsync(dto.CompanyId, dto.Items.Select(i => i.AccountId));
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
                //    A type picked ON THE BILL FORM wins over the challan line's
                //    inherited type — the operator's bill-time classification
                //    must persist onto the invoice line.
                ItemType? pickedType = null;
                if (itemDto.ItemTypeId.HasValue)
                    pickedTypeMap.TryGetValue(itemDto.ItemTypeId.Value, out pickedType);
                var itemType = pickedType ?? deliveryItem.ItemType;

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

                // Non-inventory: picked on the bill form OR inherited from the
                // challan line. A non-inv line clears the item type + FBR fields.
                var nonInvId = itemDto.NonInventoryItemId ?? deliveryItem.NonInventoryItemId;
                var isNonInv = nonInvId.HasValue;
                if (isNonInv) itemType = null;

                // Each bill line must be classified — an inventory Item Type OR a
                // Non-Inventory item (Freight/Discount). No unclassified lines.
                if (!isNonInv && itemType == null)
                    throw new InvalidOperationException(
                        $"Line \"{description}\": pick an Item Type or a Non-Inventory item — every bill line must be classified.");

                invoiceItems.Add(new InvoiceItem
                {
                    DeliveryItemId = deliveryItem.Id,
                    // Carry the SO-line lineage through from the delivery item so
                    // the derived read model can net this bill against the order
                    // and release its reservation (2026-07 inventory redesign).
                    SalesOrderItemId = deliveryItem.SalesOrderItemId,
                    ItemTypeId = itemType?.Id,        // flow the catalog linkage through
                    ItemTypeName = itemType?.Name ?? "",
                    NonInventoryItemId = nonInvId,
                    AccountId = Coerce(itemDto.AccountId, validAccountIds),
                    Description = description,
                    Quantity = deliveryItem.Quantity,
                    UOM = effectiveUOM,
                    UnitPrice = itemDto.UnitPrice,
                    LineTotal = lineTotal,
                    HSCode = isNonInv ? null : effectiveHSCode,
                    FbrUOMId = isNonInv ? null : effectiveFbrUOMId,
                    SaleType = isNonInv ? null : effectiveSaleType,
                    RateId = isNonInv ? null : itemDto.RateId,
                    FixedNotifiedValueOrRetailPrice = isNonInv ? null : itemDto.FixedNotifiedValueOrRetailPrice
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

            // Header-level SO lineage: when every source challan fulfils the
            // same Sales Order, stamp it on the bill (fast "bills against order X"
            // filter + reservation release). Mixed/none → left null.
            var challanSoIds = challans.Where(c => c.SalesOrderId.HasValue)
                                       .Select(c => c.SalesOrderId!.Value).Distinct().ToList();
            int? headerSalesOrderId = challanSoIds.Count == 1 ? challanSoIds[0] : (int?)null;

            // Bill PO: what the operator typed on the form wins; else prefill from
            // the linked Sales Order's customer PO; else the source challans' own
            // PO (first non-blank). (Challans are loaded with .Include(SalesOrder).)
            var headerSo = headerSalesOrderId.HasValue
                ? challans.FirstOrDefault(c => c.SalesOrderId == headerSalesOrderId)?.SalesOrder
                : null;
            var billPoNumber = !string.IsNullOrWhiteSpace(dto.PoNumber) ? dto.PoNumber.Trim()
                : !string.IsNullOrWhiteSpace(headerSo?.CustomerPoNumber) ? headerSo!.CustomerPoNumber!.Trim()
                : challans.Select(c => c.PoNumber).FirstOrDefault(p => !string.IsNullOrWhiteSpace(p));
            var billPoDate = dto.PoDate
                ?? headerSo?.CustomerPoDate
                ?? challans.Select(c => c.PoDate).FirstOrDefault(d => d.HasValue);

            string? effectivePaymentMode = dto.PaymentMode;
            if (string.IsNullOrWhiteSpace(effectivePaymentMode))
            {
                // buyer was loaded + tenant-checked at the top of CreateAsync.
                var isRegistered = buyer.RegistrationType == "Registered";
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

            // Audit C-14 (2026-05-13) + 2026-07 fix: the stock availability
            // guard now runs INSIDE the create transaction under a per-company
            // app lock (see AssertBillStockAvailabilityAsync, called below),
            // so two concurrent bills consuming the last N units serialise —
            // exactly one commits, the other gets a 409. The old pre-transaction
            // check here was a TOCTOU race (both could pass). Only enforces when
            // InventoryTrackingEnabled && StockGuardHardBlock.

            // Generate next invoice number per company
            if (company.StartingInvoiceNumber == 0)
                throw new InvalidOperationException("Starting invoice number has not been set for this company. Please set it first.");

            // Audit C-8 (2026-05-13): wrap the create in a retry loop so two
            // concurrent saves can't both land the same InvoiceNumber. The
            // new UNIQUE (CompanyId, InvoiceNumber) index now blocks the
            // second writer with a SQL 2601/2627; the retry recomputes
            // MAX(InvoiceNumber)+1 from a fresh read and tries again.
            const int maxAttempts = NumberAllocationRetry.DefaultMaxAttempts;
            DbUpdateException? lastConflict = null;
            for (var attempt = 1; attempt <= maxAttempts; attempt++)
            {
                // Per-division numbering: a division-tagged bill draws from the
                // division's own sequence; otherwise the company's. Resolved
                // PER ATTEMPT — the collision catch detaches modified entities,
                // so a division resolved outside the loop would lose its
                // CurrentInvoiceNumber write after a retry.
                var division = await MyApp.Api.Helpers.DivisionNumbering.ResolveAsync(_context, dto.CompanyId, dto.DivisionId);
                // Use MAX(InvoiceNumber) so a deleted trailing number is reused on the next
                // create (no gaps after deleting the last bill), scoped per division.
                // IsDemo bills live in their own 900000+ range — excluded.
                var maxQuery = _context.Invoices.Where(i => i.CompanyId == dto.CompanyId && !i.IsDemo);
                maxQuery = dto.DivisionId.HasValue
                    ? maxQuery.Where(i => i.DivisionId == dto.DivisionId.Value)
                    : maxQuery.Where(i => i.DivisionId == null);
                int maxExistingInvoice = await maxQuery.MaxAsync(i => (int?)i.InvoiceNumber) ?? 0;

                var seedStarting = division != null ? division.StartingInvoiceNumber : company.StartingInvoiceNumber;
                int nextInvoiceNumber = maxExistingInvoice > 0 ? maxExistingInvoice + 1 : (seedStarting > 0 ? seedStarting : 1);
                if (division != null) division.CurrentInvoiceNumber = nextInvoiceNumber;
                else company.CurrentInvoiceNumber = nextInvoiceNumber;

                var invoice = new Invoice
                {
                    InvoiceNumber = nextInvoiceNumber,
                    Date = dto.Date,
                    CompanyId = dto.CompanyId,
                    DivisionId = dto.DivisionId,
                    ClientId = dto.ClientId,
                    Subtotal = subtotal,
                    GSTRate = dto.GSTRate,
                    GSTAmount = gstAmount,
                    GrandTotal = grandTotal,
                    AmountInWords = NumberToWordsConverter.Convert(grandTotal),
                    PaymentTerms = dto.PaymentTerms,
                    DocumentType = effectiveDocType,
                    PaymentMode = effectivePaymentMode,
                    SalesOrderId = headerSalesOrderId,
                    PoNumber = billPoNumber,
                    PoDate = billPoDate,
                    FbrInvoiceNumber = string.IsNullOrEmpty(company.InvoiceNumberPrefix)
                        ? nextInvoiceNumber.ToString()
                        : $"{company.InvoiceNumberPrefix}{nextInvoiceNumber}",
                    Items = invoiceItems
                };

                // Wrap invoice creation + challan transitions + company update in a single transaction
                await using var transaction = await _context.Database.BeginTransactionAsync();
                try
                {
                    // Oversell guard under the per-company stock lock (inside tx,
                    // so it serialises concurrent bills — closes the TOCTOU race).
                    await AssertBillStockAvailabilityAsync(company, dto.CompanyId, invoiceItems);

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
                    // GL posting (Dr AR / Cr Sales + Output tax) — same tx.
                    await _posting.PostInvoiceAsync(created);
                    await transaction.CommitAsync();

                    // Reload with includes
                    var loaded = await _invoiceRepo.GetByIdAsync(created.Id);
                    return ToDto(loaded!);
                }
                catch (DbUpdateException dupEx) when (NumberAllocationRetry.IsUniqueViolation(dupEx))
                {
                    // Another concurrent create won the race for this
                    // number. Roll back, detach tracked entities so the
                    // next iteration starts clean, and retry.
                    lastConflict = dupEx;
                    _logger.LogWarning(
                        "Invoice number {Number} for company {CompanyId} collided with a concurrent create; retrying (attempt {Attempt}).",
                        nextInvoiceNumber, dto.CompanyId, attempt);
                    await transaction.RollbackAsync();
                    foreach (var entry in _context.ChangeTracker.Entries().ToList())
                    {
                        if (entry.State != EntityState.Unchanged)
                            entry.State = EntityState.Detached;
                    }
                    if (attempt < maxAttempts)
                        await Task.Delay(10 * attempt);
                    continue;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "InvoiceService: transaction rolled back");
                    await transaction.RollbackAsync();
                    throw;
                }
            }
            throw new InvalidOperationException(
                "Could not allocate a unique invoice number after " + maxAttempts +
                " attempts. Please retry the request.", lastConflict);
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

            // SO-mandatory billing (opt-in per company): a standalone bill has no
            // challan and so can't trace to a Sales Order — disallow it outright.
            if (company.RequireSalesOrderForBilling)
                throw new InvalidOperationException("This company requires every bill to be created from a Sales Order, so standalone bills are disabled.");

            var client = await _context.Clients.FindAsync(dto.ClientId);
            if (client == null) throw new KeyNotFoundException("Client not found.");
            if (client.CompanyId != dto.CompanyId)
                throw new InvalidOperationException("Client does not belong to this company.");

            // Optional Sales Order lineage for a standalone bill: validate it
            // belongs to this company (never trust the DTO), then prefill the
            // customer PO from it unless the operator typed one on the form.
            SalesOrder? standaloneSo = null;
            if (dto.SalesOrderId is int soId)
            {
                standaloneSo = await _context.SalesOrders.FirstOrDefaultAsync(o => o.Id == soId);
                if (standaloneSo == null) throw new KeyNotFoundException("Sales Order not found.");
                if (standaloneSo.CompanyId != dto.CompanyId)
                    throw new InvalidOperationException("Sales Order does not belong to this company.");
            }
            var billPoNumber = !string.IsNullOrWhiteSpace(dto.PoNumber) ? dto.PoNumber.Trim()
                : !string.IsNullOrWhiteSpace(standaloneSo?.CustomerPoNumber) ? standaloneSo!.CustomerPoNumber!.Trim()
                : null;
            var billPoDate = dto.PoDate ?? standaloneSo?.CustomerPoDate;

            if (dto.Items == null || dto.Items.Count == 0)
                throw new InvalidOperationException("At least one item is required.");
            if (dto.Items.Any(i => i.Quantity <= 0))
                throw new InvalidOperationException("Quantity must be greater than zero.");
            if (dto.Items.Any(i => i.UnitPrice <= 0))
                throw new InvalidOperationException("All items must have a positive unit price.");
            if (dto.GSTRate < 0 || dto.GSTRate > 100)
                throw new InvalidOperationException("GST rate must be between 0 and 100.");

            // FBR [0043] rejects future-dated bills. Evaluate "future" against
            // today's date in Pakistan (PKT, UTC+5), comparing date-only — a
            // server still on the previous UTC day must not block a PKT operator
            // billing "today". Same guard as UpdateAsync / CreateAsync.
            if (PakistanClock.IsFutureInvoiceDate(dto.Date))
                throw new InvalidOperationException("Bill date cannot be in the future. [FBR 0043]");

            // Register any newly-typed UOM names + reject fractional qty
            // for integer-only UOMs. Mirrors the contract on the regular
            // create path (which inherits UOM from the challan's DeliveryItem
            // and is already validated upstream).
            await UnitRegistry.EnsureNamesAsync(_context, dto.Items.Select(i => i.UOM));
            await ValidateStandaloneItemDecimalQuantitiesAsync(dto.Items);
            await ValidateNonInvLinesAsync(company, dto.Items.Select(i => i.NonInventoryItemId));
            // Each bill line must be classified — an Item Type OR a Non-Inventory item.
            if (dto.Items.Any(i => !i.ItemTypeId.HasValue && !i.NonInventoryItemId.HasValue))
                throw new InvalidOperationException(
                    "Every bill line must have an Item Type or a Non-Inventory item selected.");

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

            var validAccountIds = await ValidCompanyAccountIdsAsync(dto.CompanyId, dto.Items.Select(i => i.AccountId));
            var invoiceItems = new List<InvoiceItem>();
            foreach (var itemDto in dto.Items)
            {
                // Non-inventory line (Freight/Discount): GL-account shortcut, no
                // item type, no HS/UOM resolution, no FBR fields, no stock.
                if (itemDto.NonInventoryItemId.HasValue)
                {
                    invoiceItems.Add(new InvoiceItem
                    {
                        DeliveryItemId = null,
                        ItemTypeId = null,
                        NonInventoryItemId = itemDto.NonInventoryItemId,
                        AccountId = Coerce(itemDto.AccountId, validAccountIds),
                        ItemTypeName = "",
                        Description = itemDto.Description ?? "",
                        Quantity = itemDto.Quantity,
                        UOM = itemDto.UOM ?? "",
                        UnitPrice = itemDto.UnitPrice,
                        LineTotal = itemDto.Quantity * itemDto.UnitPrice,
                    });
                    continue;
                }

                ItemType? itemType = null;
                if (itemDto.ItemTypeId.HasValue)
                    typeMap.TryGetValue(itemDto.ItemTypeId.Value, out itemType);

                var effectiveHSCode = !string.IsNullOrWhiteSpace(itemDto.HSCode)
                    ? itemDto.HSCode
                    : itemType?.HSCode;

                // 2026-05-13: ResolveUomAsync enforces:
                //   - typed UOM wins (and is registered in Units),
                //   - else inherit from ItemType,
                //   - else fetch FBR-recommended UOM for the HSCode,
                //   - else throw "UOM required" (no silent fallback).
                var (effectiveUOM, effectiveFbrUOMId) = await ResolveUomAsync(
                    dto.CompanyId,
                    itemDto.UOM,
                    itemDto.FbrUOMId,
                    itemType,
                    effectiveHSCode,
                    itemDto.Description ?? "(unnamed)");

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
                    AccountId = Coerce(itemDto.AccountId, validAccountIds),
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

            // Audit C-14 (2026-05-13) + 2026-07: availability guard moved inside
            // the create transaction under the per-company stock lock — see the
            // AssertBillStockAvailabilityAsync call below. Only blocks under
            // InventoryTrackingEnabled && StockGuardHardBlock.

            if (company.StartingInvoiceNumber == 0)
                throw new InvalidOperationException("Starting invoice number has not been set for this company. Please set it first.");

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

            // Audit C-8 (2026-05-13): same retry-on-conflict shape as the
            // regular CreateAsync above. The UNIQUE (CompanyId,
            // InvoiceNumber) index now catches concurrent collisions; we
            // recompute MAX(InvoiceNumber)+1 and retry up to 3 times.
            const int maxAttempts = NumberAllocationRetry.DefaultMaxAttempts;
            DbUpdateException? lastConflict = null;
            for (var attempt = 1; attempt <= maxAttempts; attempt++)
            {
                // Per-division numbering (mirrors CreateAsync) — resolved per
                // attempt so a retry doesn't write counters on a detached
                // division entity.
                var division = await MyApp.Api.Helpers.DivisionNumbering.ResolveAsync(_context, dto.CompanyId, dto.DivisionId);
                // Share the regular numbering sequence — standalone bills are
                // real bills, not demos — scoped per division.
                var maxQuery = _context.Invoices.Where(i => i.CompanyId == dto.CompanyId && !i.IsDemo);
                maxQuery = dto.DivisionId.HasValue
                    ? maxQuery.Where(i => i.DivisionId == dto.DivisionId.Value)
                    : maxQuery.Where(i => i.DivisionId == null);
                int maxExistingInvoice = await maxQuery.MaxAsync(i => (int?)i.InvoiceNumber) ?? 0;

                var seedStarting = division != null ? division.StartingInvoiceNumber : company.StartingInvoiceNumber;
                int nextInvoiceNumber = maxExistingInvoice > 0 ? maxExistingInvoice + 1 : (seedStarting > 0 ? seedStarting : 1);
                if (division != null) division.CurrentInvoiceNumber = nextInvoiceNumber;
                else company.CurrentInvoiceNumber = nextInvoiceNumber;

                var invoice = new Invoice
                {
                    InvoiceNumber = nextInvoiceNumber,
                    Date = dto.Date,
                    CompanyId = dto.CompanyId,
                    DivisionId = dto.DivisionId,
                    ClientId = dto.ClientId,
                    Subtotal = subtotal,
                    GSTRate = dto.GSTRate,
                    GSTAmount = gstAmount,
                    GrandTotal = grandTotal,
                    AmountInWords = NumberToWordsConverter.Convert(grandTotal),
                    PaymentTerms = finalPaymentTerms,
                    DocumentType = effectiveDocType,
                    PaymentMode = effectivePaymentMode,
                    SalesOrderId = standaloneSo?.Id,
                    PoNumber = billPoNumber,
                    PoDate = billPoDate,
                    FbrInvoiceNumber = string.IsNullOrEmpty(company.InvoiceNumberPrefix)
                        ? nextInvoiceNumber.ToString()
                        : $"{company.InvoiceNumberPrefix}{nextInvoiceNumber}",
                    Items = invoiceItems
                };

                await using var transaction = await _context.Database.BeginTransactionAsync();
                try
                {
                    // Oversell guard under the per-company stock lock (inside tx).
                    await AssertBillStockAvailabilityAsync(company, dto.CompanyId, invoiceItems);

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
                    // GL posting (Dr AR / Cr Sales + Output tax) — same tx.
                    await _posting.PostInvoiceAsync(created);
                    await transaction.CommitAsync();

                    var loaded = await _invoiceRepo.GetByIdAsync(created.Id);
                    return ToDto(loaded!);
                }
                catch (DbUpdateException dupEx) when (NumberAllocationRetry.IsUniqueViolation(dupEx))
                {
                    lastConflict = dupEx;
                    _logger.LogWarning(
                        "Standalone invoice number {Number} for company {CompanyId} collided with a concurrent create; retrying (attempt {Attempt}).",
                        nextInvoiceNumber, dto.CompanyId, attempt);
                    await transaction.RollbackAsync();
                    foreach (var entry in _context.ChangeTracker.Entries().ToList())
                    {
                        if (entry.State != EntityState.Unchanged)
                            entry.State = EntityState.Detached;
                    }
                    if (attempt < maxAttempts)
                        await Task.Delay(10 * attempt);
                    continue;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "InvoiceService: transaction rolled back");
                    await transaction.RollbackAsync();
                    throw;
                }
            }
            throw new InvalidOperationException(
                "Could not allocate a unique invoice number after " + maxAttempts +
                " attempts. Please retry the request.", lastConflict);
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

        // Validate non-inventory line refs: (1) FBR guard — non-inv lines have no
        // HS code so FBR line-based submission can't carry them; block them on
        // FBR-enabled companies for phase 1 (migrated/FBR-off companies are fine).
        // (2) cross-tenant link guard — the item must belong to this company.
        private async Task ValidateNonInvLinesAsync(Company company, IEnumerable<int?> ids)
        {
            var wanted = ids.Where(x => x.HasValue).Select(x => x!.Value).Distinct().ToList();
            if (wanted.Count == 0) return;
            if (company.FbrEnabled)
                throw new InvalidOperationException(
                    "Non-inventory items (Freight, Discount, …) aren't supported on FBR-enabled companies yet — an FBR line needs an HS code. Use a regular item type, or add non-inventory lines on an FBR-off company.");
            var valid = await _context.NonInventoryItems.AsNoTracking()
                .Where(n => n.CompanyId == company.Id && wanted.Contains(n.Id))
                .Select(n => n.Id).ToListAsync();
            if (wanted.Any(w => !valid.Contains(w)))
                throw new InvalidOperationException("A selected non-inventory item does not belong to this company.");
        }

        private async Task ValidateNonInvLinesAsync(int companyId, IEnumerable<int?> ids)
        {
            if (!ids.Any(x => x.HasValue)) return;
            var company = await _context.Companies.AsNoTracking().FirstAsync(c => c.Id == companyId);
            await ValidateNonInvLinesAsync(company, ids);
        }

        public async Task<InvoiceDto?> UpdateAsync(int id, UpdateInvoiceDto dto)
        {
            var invoice = await _invoiceRepo.GetByIdAsync(id);
            if (invoice == null) return null;

            if (!IsInvoiceEditable(invoice))
                throw new InvalidOperationException(invoice.IsCancelled
                    ? "Cannot edit a cancelled bill."
                    : "Cannot edit a bill that has been submitted to FBR.");

            // Debit/Credit Notes are immutable after creation: their lines were
            // derived from (and value-capped at) the original invoice, and a
            // free edit here could raise them past the FBR 0067 cap. To change
            // a note, void it and generate a new one from the Returns screen.
            if (invoice.DocumentType == 9 || invoice.DocumentType == 10)
                throw new InvalidOperationException(
                    "A Debit/Credit Note cannot be edited. Void it and create a new return from the Return Invoices screen.");

            // ...and the reverse flip: a sale bill can never be converted INTO
            // a note via edit — notes live in a separate numbering sequence
            // and stock direction, so a flip would corrupt both. (The Reverse
            // action is the only way to create a note.)
            if (dto.DocumentType == 9 || dto.DocumentType == 10)
                throw new InvalidOperationException(
                    "A bill cannot be converted into a Debit/Credit Note. Use the Reverse action on a submitted invoice instead.");

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
                    // FBR rejects future dates with [0043]. Evaluate "future"
                    // against today's date in Pakistan (PKT, UTC+5), date-only,
                    // so the operator can pick "today" without tripping the gate
                    // even while the server is still on the previous UTC day.
                    if (PakistanClock.IsFutureInvoiceDate(dto.Date.Value))
                        throw new InvalidOperationException("Bill date cannot be in the future. [FBR 0043]");
                    invoice.Date = dto.Date.Value;
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
                var validAccountIds = await ValidCompanyAccountIdsAsync(invoice.CompanyId, dto.Items.Select(i => i.AccountId));
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
                    // Per-line GL account override (design §3.3) — edit-driven, applies
                    // to both the item-type and free-text branches below.
                    existing.AccountId = Coerce(itemDto.AccountId, validAccountIds);
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
                        // No ItemType on the line → resolve UOM via the
                        // same policy used on the standalone create path
                        // (2026-05-13). Throws when neither UOM nor
                        // HSCode is provided, auto-fills from FBR's
                        // recommendation when HSCode is given but UOM
                        // is blank.
                        var (resolvedUom, resolvedFbrUomId) = await ResolveUomAsync(
                            invoice.CompanyId,
                            itemDto.UOM,
                            itemDto.FbrUOMId,
                            null,
                            itemDto.HSCode,
                            itemDto.Description ?? "(unnamed)");
                        existing.ItemTypeId = null;
                        existing.UOM = resolvedUom;
                        existing.HSCode = itemDto.HSCode;
                        existing.FbrUOMId = resolvedFbrUomId;
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
                // GL re-post: totals changed → replace the bill's journal entry.
                await _posting.PostInvoiceAsync(invoice);
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
                throw new InvalidOperationException(invoice.IsCancelled
                    ? "Cannot edit a cancelled bill."
                    : "Cannot edit a bill that has been submitted to FBR.");

            // Notes are immutable (see UpdateAsync) — the narrow edit paths
            // could equally push a note past its original-invoice cap.
            if (invoice.DocumentType == 9 || invoice.DocumentType == 10)
                throw new InvalidOperationException(
                    "A Debit/Credit Note cannot be edited. Void it and create a new return from the Return Invoices screen.");

            // Invoices-tab edit is an FBR-classification flow. When the company's
            // FBR integration is OFF there's nothing to classify — all edits must
            // go through the Bills tab. Block it server-side (the Invoices-tab
            // Edit button is also hidden for FBR-off companies). 2026-07-14.
            var fbrOn = await _context.Companies.AsNoTracking()
                .Where(c => c.Id == invoice.CompanyId).Select(c => c.FbrEnabled).FirstOrDefaultAsync();
            if (!fbrOn)
                throw new InvalidOperationException(
                    "This company's FBR integration is off — edit the bill on the Bills tab. The Invoices tab is view-only here.");

            if (dto.Items == null || dto.Items.Count == 0)
                throw new InvalidOperationException("At least one item is required.");

            // Cross-tenant + FBR guard for any non-inventory refs on the rows.
            await ValidateNonInvLinesAsync(invoice.CompanyId, dto.Items.Select(r => r.NonInventoryItemId));

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

                var validAccountIds = await ValidCompanyAccountIdsAsync(invoice.CompanyId, dto.Items.Select(i => i.AccountId));
                foreach (var row in dto.Items)
                {
                    var existing = invoice.Items.First(ii => ii.Id == row.Id);
                    // Per-line GL account (design §3.3) is bill data — like the
                    // item type it's written straight to the InvoiceItem in both
                    // Bill and Adjustment write-modes.
                    existing.AccountId = Coerce(row.AccountId, validAccountIds);

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
                    if (row.NonInventoryItemId.HasValue)
                    {
                        // Non-inventory line (Freight/Discount): GL-account
                        // shortcut, no item type / HS / FBR classification.
                        existing.NonInventoryItemId = row.NonInventoryItemId;
                        existing.ItemTypeId = null;
                        existing.ItemTypeName = "";
                        existing.FbrUOMId = null;
                        existing.HSCode = null;
                        existing.SaleType = null;
                    }
                    else if (row.ItemTypeId.HasValue && typeMap.TryGetValue(row.ItemTypeId.Value, out var t2))
                    {
                        existing.NonInventoryItemId = null;   // item type + non-inv are exclusive
                        existing.ItemTypeId = t2.Id;
                        existing.ItemTypeName = t2.Name;
                        existing.UOM = t2.UOM ?? "";
                        existing.FbrUOMId = t2.FbrUOMId;
                        existing.HSCode = t2.HSCode;
                        existing.SaleType = t2.SaleType;
                    }
                    else if (!row.ItemTypeId.HasValue)
                    {
                        existing.NonInventoryItemId = null;
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
                // GL re-post: qty edits change totals → replace the entry.
                await _posting.PostInvoiceAsync(invoice);
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

            // 2026-07-02: the flag now carries STOCK semantics (an excluded
            // bill holds no inventory movements), so flipping it on a bill
            // that already reached FBR would desync stock from a real filed
            // supply. Submitted bills are skipped by bulk actions anyway.
            if (invoice.FbrStatus == "Submitted" && invoice.IsFbrExcluded != excluded)
                throw new InvalidOperationException(
                    "Cannot change FBR exclusion on a bill that has been submitted to FBR.");

            var wasExcluded = invoice.IsFbrExcluded;

            await using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                invoice.IsFbrExcluded = excluded;
                await _context.SaveChangesAsync();

                // Excluded → purge the bill's stock movements (goods return
                // to on-hand). Re-included → re-insert OUT movements for
                // every classified (HS-coded) item line with quantity. The
                // sync reads IsFbrExcluded off the entity, so one call
                // handles both directions idempotently.
                await _stock.SyncInvoiceStockMovementsAsync(invoice);
                await transaction.CommitAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "InvoiceService: FBR-exclusion toggle rolled back");
                await transaction.RollbackAsync();
                throw;
            }

            // Audit — the toggle now moves inventory, which is a financial
            // state change. Never let audit failure surface.
            if (wasExcluded != excluded)
            {
                try
                {
                    await _auditLog.LogAsync(new AuditLog
                    {
                        Level         = "Info",
                        HttpMethod    = "PUT",
                        RequestPath   = $"/invoices/{invoice.Id}/fbr-excluded",
                        StatusCode    = 200,
                        ExceptionType = "Invoice.FbrExcluded",
                        Message       = excluded
                            ? $"Bill #{invoice.InvoiceNumber} EXCLUDED from FBR — its stock movements were reversed (on-hand restored)."
                            : $"Bill #{invoice.InvoiceNumber} re-INCLUDED in FBR — stock re-deducted for classified item lines.",
                    });
                }
                catch { /* audit must never break the operation */ }
            }

            return ToDto(invoice);
        }

        public async Task<InvoiceDto?> SetDueDateAsync(int id, DateTime? dueDate)
        {
            // Tracked fetch (see SetFbrExcludedAsync) so the change persists.
            var invoice = await _context.Invoices
                .Include(i => i.Items)
                .Include(i => i.Company)
                .Include(i => i.Client)
                .Include(i => i.DeliveryChallans)
                .FirstOrDefaultAsync(i => i.Id == id);
            if (invoice == null) return null;

            // Store date-only (the picker sends midnight); status is derived.
            invoice.DueDate = dueDate?.Date;
            await _context.SaveChangesAsync();
            return ToDto(invoice);
        }

        public async Task<bool> DeleteAsync(int id)
        {
            var invoice = await _invoiceRepo.GetByIdAsync(id);
            if (invoice == null) return false;

            // Cannot delete FBR-submitted invoices — they're filed at FBR (with
            // an IRN) and FBR has no delete; the correct reversal is a Credit
            // Note. (For FBR-off companies this never triggers.)
            if (invoice.FbrStatus == "Submitted")
                throw new InvalidOperationException("Cannot delete a bill that has been submitted to FBR — reverse it with a Credit Note instead.");

            // 2026-07-14: the "only the latest bill can be deleted" rule was
            // removed at the user's request — ANY bill/invoice can now be
            // deleted, reverting its full GL + inventory impact (below) and
            // freeing its challans. This intentionally allows a gap in the
            // numbering sequence where the deleted document was.

            var companyId = invoice.CompanyId;

            // Period-close guard: a locked bill can't be deleted.
            await _posting.AssertPeriodOpenAsync(companyId, invoice.Date);

            await using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                // The ledger entry dies with its document.
                await _posting.RemoveForSourceAsync(companyId,
                    Models.Accounting.SourceDocType.Invoice, invoice.Id);

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

        public async Task<InvoiceDto?> CancelAsync(int id, string? reason, string? actorUserName = null)
        {
            // Tracked load (NOT the AsNoTracking repo path) so the flag
            // changes + challan reverts are picked up by SaveChanges.
            var invoice = await _context.Invoices
                .Include(i => i.DeliveryChallans)
                .FirstOrDefaultAsync(i => i.Id == id);
            if (invoice == null) return null;

            // A bill that reached FBR cannot be voided — it must be reversed
            // with a Credit Note that references the original IRN. Voiding it
            // locally would desync us from what FBR already recorded.
            if (invoice.FbrStatus == "Submitted")
                throw new InvalidOperationException(
                    "Cannot cancel a bill that has been submitted to FBR. " +
                    "Issue a Credit Note against it instead.");

            if (invoice.IsCancelled)
                throw new InvalidOperationException("This bill is already cancelled.");

            var revertedChallans = new List<int>();

            await using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                // Release the linked challans back to a billable state so each
                // DC re-appears in the pending list and can be re-billed.
                // Same transition table as DeleteAsync — imported challans
                // revert to "Imported", native ones to "Pending", and any
                // PO-less challan to "No PO".
                foreach (var dc in invoice.DeliveryChallans)
                {
                    var hasPo = !string.IsNullOrWhiteSpace(dc.PoNumber);
                    dc.Status = hasPo ? (dc.IsImported ? "Imported" : "Pending") : "No PO";
                    dc.InvoiceId = null;
                    _context.DeliveryChallans.Update(dc);
                    revertedChallans.Add(dc.ChallanNumber);
                }

                // A voided bill must stop deducting stock — purge its movements
                // so on-hand reflects reality and the re-bill can re-deduct
                // cleanly. SourceId isn't an FK, so EF won't cascade these.
                var staleMovements = await _context.StockMovements
                    .Where(m => m.CompanyId  == invoice.CompanyId
                             && m.SourceType == StockMovementSourceType.Invoice
                             && m.SourceId   == invoice.Id)
                    .ToListAsync();
                if (staleMovements.Count > 0)
                    _context.StockMovements.RemoveRange(staleMovements);

                // Keep the row + its InvoiceNumber (gap-free sequence) — just
                // flag it cancelled. IsInvoiceEditable() and the FBR submit
                // guard both key off IsCancelled from here on.
                invoice.IsCancelled = true;
                invoice.CancelledAt = DateTime.UtcNow;
                invoice.CancelReason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();

                await _context.SaveChangesAsync();
                // GL: a cancelled bill's journal entry is removed (the engine
                // treats IsCancelled as "no posting").
                await _posting.PostInvoiceAsync(invoice);
                await transaction.CommitAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "InvoiceService: cancel transaction rolled back");
                await transaction.RollbackAsync();
                throw;
            }

            // Audit the void — a financial state change. Mirrors the
            // narrow-edit audit shape; never let an audit failure surface.
            try
            {
                await _auditLog.LogAsync(new AuditLog
                {
                    Level         = "Info",
                    UserName      = actorUserName,
                    HttpMethod    = "POST",
                    RequestPath   = $"/invoices/{invoice.Id}/cancel",
                    StatusCode    = 200,
                    ExceptionType = "Invoice.Cancelled",
                    Message       = $"Bill #{invoice.InvoiceNumber} cancelled. "
                                  + (revertedChallans.Count > 0
                                        ? $"Reverted challan(s) #{string.Join(", #", revertedChallans)} to billable. "
                                        : "")
                                  + (string.IsNullOrWhiteSpace(reason) ? "" : $"Reason: {reason.Trim()}"),
                });
            }
            catch { /* audit must never break the operation */ }

            var reloaded = await _invoiceRepo.GetByIdAsync(id);
            return reloaded == null ? null : ToDto(reloaded);
        }

        // Quick full reversal (the "Reverse" button). Delegates to the general
        // note builder with no line selection = every line, full quantity.
        // A reversal is a CREDIT NOTE (docType 10) — the industry- and
        // law-standard return/reduction document (Rule 21(2) STR 2006; SAP
        // credit memo, Odoo credit note, Tally sales return). FBR currently
        // gates credit-note POSTING per taxpayer (0071 / Commissioner
        // approval), so the note may sit unsubmitted until enablement — the
        // document itself is correct either way.
        public Task<InvoiceDto?> CreateReversalNoteAsync(
            int originalInvoiceId, string? reason, string? remarks,
            int? documentTypeOverride = null, string? actorUserName = null)
            => CreateNoteAsync(new CreateNoteDto
            {
                OriginalInvoiceId = originalInvoiceId,
                DocumentType      = documentTypeOverride == 9 ? 9 : 10,
                Reason            = string.IsNullOrWhiteSpace(reason) ? "Return of goods" : reason,
                Remarks           = remarks,
                Lines             = new(),   // empty = full reversal
            }, actorUserName);

        public async Task<InvoiceDto?> CreateNoteAsync(CreateNoteDto dto, string? actorUserName = null)
        {
            // Snapshot the original (read-only) with its items. AsNoTracking so
            // the retry loop below can safely detach on a numbering collision
            // without disturbing the source rows.
            var original = await _context.Invoices
                .AsNoTracking()
                .Include(i => i.Items)
                .FirstOrDefaultAsync(i => i.Id == dto.OriginalInvoiceId);
            if (original == null) return null;

            // A note may only reference a real, FBR-accepted SALE invoice.
            if (original.DocumentType == 9 || original.DocumentType == 10)
                throw new InvalidOperationException("A Credit/Debit Note cannot itself be reversed. Reference the original invoice instead.");
            if (original.IsCancelled)
                throw new InvalidOperationException("This bill is cancelled — there is nothing to reverse at FBR.");
            if (original.IsDemo)
                throw new InvalidOperationException("Sandbox (demo) bills cannot be reversed — they exist only for FBR scenario testing.");
            if (original.FbrStatus != "Submitted" || string.IsNullOrWhiteSpace(original.FbrIRN))
                throw new InvalidOperationException("Only an invoice that has been submitted to FBR can have a note issued against it. A non-submitted bill should be voided instead.");

            // 10 = CREDIT NOTE (return / reversal / reduction — the default);
            // 9 = DEBIT NOTE (upward adjustment: undercharge, rate change,
            // extra goods). Both are first-class documents with their own
            // numbering sequences and their own tabs.
            var docType = dto.DocumentType == 9 ? 9 : 10;
            var label = docType == 10 ? "Credit Note" : "Debit Note";

            // FBR 0064: only one live note of a given type per original invoice.
            var alreadyExists = await _context.Invoices.AnyAsync(i =>
                i.OriginalInvoiceId == original.Id &&
                i.DocumentType == docType &&
                !i.IsCancelled);
            if (alreadyExists)
                throw new InvalidOperationException($"A {label} already exists against bill #{original.InvoiceNumber}. FBR allows only one per invoice. Cancel the existing note first if it hasn't been submitted.");

            // Project each original line to its FBR-EFFECTIVE values (dual-book
            // overlay applied) — that's what was filed to FBR and what moved
            // stock, so a note must reverse exactly those. Base ItemTypeId kept
            // (the catalog item + HS code the original OUT was recorded against).
            var overlays = await _context.InvoiceItemAdjustments
                .AsNoTracking()
                .Where(a => a.InvoiceId == original.Id)
                .ToDictionaryAsync(a => a.InvoiceItemId, a => a);

            InvoiceItem BuildLine(InvoiceItem src, decimal qty, decimal unitPrice, decimal lineTotal)
            {
                overlays.TryGetValue(src.Id, out var ov);
                return new InvoiceItem
                {
                    ItemTypeId   = src.ItemTypeId,
                    ItemTypeName = src.ItemTypeName,
                    NonInventoryItemId = src.NonInventoryItemId,
                    // Mirror the source line's GL account so the reversal note
                    // debits the exact accounts the original sale credited.
                    AccountId    = src.AccountId,
                    Description  = ov?.AdjustedDescription ?? src.Description,
                    Quantity     = qty,
                    UOM          = src.UOM,
                    UnitPrice    = unitPrice,
                    LineTotal    = lineTotal,
                    HSCode       = ov?.AdjustedHSCode   ?? src.HSCode,
                    FbrUOMId     = src.FbrUOMId,
                    SaleType     = ov?.AdjustedSaleType ?? src.SaleType,
                    RateId       = src.RateId,
                    FixedNotifiedValueOrRetailPrice = src.FixedNotifiedValueOrRetailPrice,
                    SroScheduleNo   = src.SroScheduleNo,
                    SroItemSerialNo = src.SroItemSerialNo,
                    DeliveryItemId  = null,   // a note isn't tied to challan lines
                };
            }

            decimal EffQty(InvoiceItem src)   => overlays.TryGetValue(src.Id, out var ov) && ov.AdjustedQuantity  != null ? ov.AdjustedQuantity.Value  : src.Quantity;
            decimal EffPrice(InvoiceItem src) => overlays.TryGetValue(src.Id, out var ov) && ov.AdjustedUnitPrice != null ? ov.AdjustedUnitPrice.Value : src.UnitPrice;
            decimal EffTotal(InvoiceItem src) => overlays.TryGetValue(src.Id, out var ov) && ov.AdjustedLineTotal != null ? ov.AdjustedLineTotal.Value : src.LineTotal;

            var noteItems = new List<InvoiceItem>();
            var partial = dto.Lines != null && dto.Lines.Count > 0;
            if (!partial)
            {
                // Full reversal — every line at its full effective quantity.
                foreach (var src in original.Items)
                    noteItems.Add(BuildLine(src, EffQty(src), EffPrice(src), EffTotal(src)));
            }
            else
            {
                // Partial — only the selected lines, quantity capped at the
                // original's effective quantity; line total recomputed.
                var byId = original.Items.ToDictionary(i => i.Id);
                foreach (var sel in dto.Lines)
                {
                    if (!byId.TryGetValue(sel.InvoiceItemId, out var src)) continue;
                    var maxQty = EffQty(src);
                    var qty = sel.Quantity;
                    if (qty <= 0) continue;
                    if (qty > maxQty)
                        throw new InvalidOperationException($"Return quantity {qty:0.####} for \"{src.Description}\" exceeds the invoiced quantity {maxQty:0.####}.");
                    // Credit notes always refund at the ORIGINAL rate (FBR
                    // 0068 rejects a mismatched rate). Debit notes may carry
                    // a per-unit DELTA value (undercharge / rate-change
                    // adjustments) — never above the original rate, so the
                    // note stays within the FBR 0067 cap.
                    var unitPrice = EffPrice(src);
                    if (docType == 9 && sel.UnitPrice.HasValue)
                    {
                        if (sel.UnitPrice.Value <= 0)
                            throw new InvalidOperationException($"Adjustment rate for \"{src.Description}\" must be greater than zero.");
                        if (sel.UnitPrice.Value > unitPrice)
                            throw new InvalidOperationException($"Adjustment rate {sel.UnitPrice.Value:0.##} for \"{src.Description}\" cannot exceed the invoiced rate {unitPrice:0.##}. [FBR 0067]");
                        unitPrice = sel.UnitPrice.Value;
                    }
                    noteItems.Add(BuildLine(src, qty, unitPrice, Math.Round(qty * unitPrice, 2)));
                }
            }
            if (noteItems.Count == 0)
                throw new InvalidOperationException("Select at least one line (with a quantity greater than zero) for the note.");

            // Header totals. For a FULL reversal, mirror the original's stored
            // totals exactly — re-summing effective line totals can drift by a
            // few paise from the original's stored Subtotal (the original's own
            // lines may not sum to its rounded header), which would falsely trip
            // FBR 0036. For a PARTIAL note, recompute from the selected lines.
            var gstRate = original.GSTRate;
            decimal subtotal, gstAmount, grandTotal;
            if (!partial)
            {
                subtotal   = original.Subtotal;
                gstAmount  = original.GSTAmount;
                grandTotal = original.GrandTotal;
            }
            else
            {
                subtotal   = noteItems.Sum(i => i.LineTotal);
                gstAmount  = Math.Round(subtotal * gstRate / 100m, 2);
                grandTotal = subtotal + gstAmount;
            }

            // A reference note's value cannot exceed the original invoice
            // (Debit Note → FBR 0067, Credit Note → FBR 0036). Allow a 1-rupee
            // tolerance so per-line rounding noise never blocks a valid note.
            if (subtotal - original.Subtotal > 1.00m)
            {
                var code = docType == 10 ? "0036" : "0067";
                throw new InvalidOperationException($"{label} value ({subtotal:0.##}) cannot exceed the original invoice value ({original.Subtotal:0.##}). [FBR {code}]");
            }

            var company = await _context.Companies.FirstOrDefaultAsync(c => c.Id == original.CompanyId);
            if (company == null) throw new InvalidOperationException("Company not found for the original invoice.");

            // Note date: caller-supplied or today, never before the original
            // (FBR 0035). 180-day ceiling (0034) is enforced at FBR pre-validate.
            var baseDate = (dto.Date ?? DateTime.UtcNow).Date;
            var noteDate = baseDate < original.Date.Date ? original.Date.Date : baseDate;
            var reason  = dto.Reason;
            var remarks = dto.Remarks;

            // Stock semantics (industry pattern: separate the physical return
            // from the financial adjustment — SAP returns-vs-credit-memo,
            // Zoho restock-vs-credit-only). Derived from the reason unless
            // the operator overrides: goods physically move only for
            // "Return of goods" / "Cancellation of supply" on a CREDIT note;
            // every value-only reason (discount, rate change, tax change) and
            // debit-note adjustments default to NO stock movement.
            var goodsReasons = new[] { "Return of goods", "Cancellation of supply" };
            var affectsStock = dto.AffectsStock
                ?? (docType == 10 && goodsReasons.Contains((reason ?? "").Trim(), StringComparer.OrdinalIgnoreCase));

            const int maxAttempts = NumberAllocationRetry.DefaultMaxAttempts;
            for (var attempt = 1; attempt <= maxAttempts; attempt++)
            {
                // A note belongs to the SAME division as the invoice it
                // adjusts — and draws its number from that division's own note
                // sequence (Credit Note #1, Debit Note #1 per division),
                // mirroring the per-division invoice numbering. Company-level
                // originals keep using the company counters. ResolveAsync also
                // guards the cross-tenant case (division must belong to the
                // company). Resolved PER ATTEMPT: the collision catch below
                // detaches every modified entity, so a division resolved
                // outside the loop would be detached on retry and its
                // Current*NoteNumber write silently dropped.
                var division = await MyApp.Api.Helpers.DivisionNumbering.ResolveAsync(
                    _context, original.CompanyId, original.DivisionId);

                // Each note TYPE runs its own per-(company, division) sequence
                // (Credit Note #1…, Debit Note #1…) — reversing bill #3821
                // must NOT consume sale-invoice number #3822. Uniqueness is
                // enforced by the (CompanyId, DivisionId, NoteKind,
                // InvoiceNumber) index, so Credit Note #1, Debit Note #1 and
                // sale bill #1 never collide within or across divisions.
                var maxNoteQuery = _context.Invoices
                    .Where(i => i.CompanyId == original.CompanyId && !i.IsDemo
                             && i.DocumentType == docType);
                maxNoteQuery = original.DivisionId.HasValue
                    ? maxNoteQuery.Where(i => i.DivisionId == original.DivisionId.Value)
                    : maxNoteQuery.Where(i => i.DivisionId == null);
                int maxExistingNote = await maxNoteQuery.MaxAsync(i => (int?)i.InvoiceNumber) ?? 0;

                var startingNumber = division != null
                    ? (docType == 10
                        ? (division.StartingCreditNoteNumber > 0 ? division.StartingCreditNoteNumber : 1)
                        : (division.StartingDebitNoteNumber > 0 ? division.StartingDebitNoteNumber : 1))
                    : (docType == 10
                        ? (company.StartingCreditNoteNumber > 0 ? company.StartingCreditNoteNumber : 1)
                        : (company.StartingDebitNoteNumber > 0 ? company.StartingDebitNoteNumber : 1));
                int nextInvoiceNumber = maxExistingNote > 0 ? maxExistingNote + 1 : startingNumber;

                if (division != null)
                {
                    if (docType == 10) division.CurrentCreditNoteNumber = nextInvoiceNumber;
                    else division.CurrentDebitNoteNumber = nextInvoiceNumber;
                }
                else if (docType == 10) company.CurrentCreditNoteNumber = nextInvoiceNumber;
                else company.CurrentDebitNoteNumber = nextInvoiceNumber;

                // Fresh line entities each attempt (a rolled-back attempt detaches them).
                var attemptItems = noteItems
                    .Select(i => BuildLine(
                        new InvoiceItem { Id = 0, ItemTypeId = i.ItemTypeId, ItemTypeName = i.ItemTypeName,
                            NonInventoryItemId = i.NonInventoryItemId, AccountId = i.AccountId,
                            Description = i.Description, Quantity = i.Quantity, UOM = i.UOM, UnitPrice = i.UnitPrice,
                            LineTotal = i.LineTotal, HSCode = i.HSCode, FbrUOMId = i.FbrUOMId, SaleType = i.SaleType,
                            RateId = i.RateId, FixedNotifiedValueOrRetailPrice = i.FixedNotifiedValueOrRetailPrice,
                            SroScheduleNo = i.SroScheduleNo, SroItemSerialNo = i.SroItemSerialNo },
                        i.Quantity, i.UnitPrice, i.LineTotal))
                    .ToList();

                var note = new Invoice
                {
                    InvoiceNumber = nextInvoiceNumber,
                    Date          = noteDate,
                    CompanyId     = original.CompanyId,
                    // A note lives in its original invoice's division — it
                    // prints with that division's branding and its number
                    // came from that division's sequence above.
                    DivisionId    = original.DivisionId,
                    ClientId      = original.ClientId,
                    Subtotal      = subtotal,
                    GSTRate       = gstRate,
                    GSTAmount     = gstAmount,
                    GrandTotal    = grandTotal,
                    AmountInWords = NumberToWordsConverter.Convert(grandTotal),
                    PaymentTerms  = original.PaymentTerms,   // carries [SNxxx] scenario tag
                    DocumentType  = docType,
                    PaymentMode   = original.PaymentMode,
                    OriginalInvoiceId     = original.Id,
                    OriginalInvoiceRefIRN = original.FbrIRN,
                    NoteReason            = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim(),
                    NoteReasonRemarks     = string.IsNullOrWhiteSpace(remarks) ? null : remarks.Trim(),
                    NoteAffectsStock      = affectsStock,
                    // "CN-"/"DN-" marks the per-type note sequence so the
                    // display number can never be read as a sale-invoice number.
                    FbrInvoiceNumber = string.IsNullOrEmpty(company.InvoiceNumberPrefix)
                        ? $"{(docType == 10 ? "CN" : "DN")}-{nextInvoiceNumber}"
                        : $"{company.InvoiceNumberPrefix}{(docType == 10 ? "CN" : "DN")}-{nextInvoiceNumber}",
                    Items = attemptItems,
                };

                await using var transaction = await _context.Database.BeginTransactionAsync();
                try
                {
                    var created = await _invoiceRepo.CreateAsync(note);
                    await _companyRepo.UpdateAsync(company);

                    // Stock reflow: only when NoteAffectsStock (goods actually
                    // move) — Credit Note → IN (return), Debit Note → OUT
                    // (extra goods). Value-only notes leave inventory alone.
                    await _stock.SyncInvoiceStockMovementsAsync(created);
                    // GL: Credit Note reverses the sale (Dr Sales+Tax / Cr AR);
                    // Debit Note posts in the sale direction.
                    await _posting.PostInvoiceAsync(created);
                    await transaction.CommitAsync();

                    try
                    {
                        await _auditLog.LogAsync(new AuditLog
                        {
                            Level         = "Info",
                            UserName      = actorUserName,
                            HttpMethod    = "POST",
                            RequestPath   = $"/invoices/{original.Id}/reverse",
                            StatusCode    = 200,
                            ExceptionType = "Invoice.ReversalNote",
                            Message       = $"{label} #{nextInvoiceNumber} ({(partial ? "partial" : "full")}) created against bill #{original.InvoiceNumber} (IRN {original.FbrIRN}). "
                                          + (string.IsNullOrWhiteSpace(reason) ? "" : $"Reason: {reason!.Trim()}. ")
                                          + "Awaiting FBR validate/submit.",
                        });
                    }
                    catch { /* audit must never break the operation */ }

                    var loaded = await _invoiceRepo.GetByIdAsync(created.Id);
                    return loaded == null ? null : ToDto(loaded);
                }
                catch (DbUpdateException dupEx) when (NumberAllocationRetry.IsUniqueViolation(dupEx))
                {
                    _logger.LogWarning(
                        "Note number {Number} for company {CompanyId} collided; retrying (attempt {Attempt}).",
                        nextInvoiceNumber, original.CompanyId, attempt);
                    await transaction.RollbackAsync();
                    foreach (var entry in _context.ChangeTracker.Entries().ToList())
                        if (entry.State != EntityState.Unchanged)
                            entry.State = EntityState.Detached;
                    if (attempt < maxAttempts)
                        await Task.Delay(10 * attempt);
                    continue;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "InvoiceService: note transaction rolled back");
                    await transaction.RollbackAsync();
                    throw;
                }
            }
            throw new InvalidOperationException(
                "Could not allocate a unique invoice number after " + maxAttempts + " attempts.");
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
                DivisionId = inv.DivisionId,
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
                PoNumber = !string.IsNullOrWhiteSpace(inv.PoNumber) ? inv.PoNumber : string.Join(", ", poNumbers),
                PoDate = inv.PoDate ?? inv.DeliveryChallans.Select(dc => dc.PoDate).FirstOrDefault(),
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
                DivisionId = inv.DivisionId,
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
                PoNumber = !string.IsNullOrWhiteSpace(inv.PoNumber) ? inv.PoNumber : string.Join(", ", poNumbers),
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
                // Pre-render the verify-URL QR as a base64 PNG. Inlined into
                // the template via {{{fbrQrPngDataUrl}}} so the printed PDF
                // doesn't depend on external image fetches (previous template
                // pulled https://quickchart.io which broke under strict CSP /
                // air-gapped networks and leaked the IRN to a third party).
                FbrQrPngDataUrl = FbrQrCodeGenerator.BuildVerifyQrDataUrl(inv.FbrIRN),
                // Credit/Debit note context — null on ordinary sales invoices,
                // so existing TaxInvoice templates see no change. Note rows
                // (NoteKind 1 = Debit, 2 = Credit) print through their own
                // CreditNote/DebitNote template types which bind these fields.
                NoteKindLabel = inv.NoteKind == 1 ? "Debit Note"
                              : inv.NoteKind == 2 ? "Credit Note" : null,
                OriginalInvoiceNumber = inv.OriginalInvoice?.InvoiceNumber,
                OriginalInvoiceDate = inv.OriginalInvoice?.Date,
                OriginalInvoiceRefIRN = inv.OriginalInvoiceRefIRN,
                NoteReason = inv.NoteKind != 0 ? inv.NoteReason : null,
                NoteReasonRemarks = inv.NoteKind != 0 ? inv.NoteReasonRemarks : null,
                // 2026-05-29: Tax Invoice print reads the
                // InvoiceItemAdjustment overlay for Quantity / UnitPrice /
                // LineTotal — same fallback shape FbrService uses when it
                // builds the PRAL submit payload (Adjusted* ?? real). The
                // Tax Invoice is the FBR-aligned document (carries the IRN
                // + QR) so it MUST show the same decomposition that was
                // filed: if the operator filed "54 units × Rs. 298.15"
                // for tax-claim optimization, the printed Tax Invoice
                // shows 54 units, not the printed-bill's 5.
                //
                // The customer-facing Bill print (GetPrintBillAsync above)
                // still uses real bill values — that's the delivery
                // document the buyer signs for goods received, so it
                // matches what physically shipped.
                //
                // Reverses the 2026-05-13 decision (which kept Tax
                // Invoice on real values). The earlier reasoning — "both
                // printed documents in agreement with each other" — was
                // wrong: the two documents have different audiences (the
                // Tax Invoice is for FBR + buyer's Annexure-A, the Bill
                // is for the warehouse + delivery), and they SHOULD
                // diverge when the operator runs the §8B optimization.
                //
                // Description / UOM / ItemTypeName / HSCode continue to
                // come from InvoiceItem — same narrowing the FbrService
                // applies (overlay only ever carries numerical fields).
                Items = inv.Items.All(ii => !string.IsNullOrWhiteSpace(ii.ItemTypeName))
                    ? inv.Items
                        .GroupBy(ii => ii.ItemTypeName)
                        .Select(g =>
                        {
                            var totalQty = g.Sum(ii =>
                                ii.Adjustment?.AdjustedQuantity ?? ii.Quantity);
                            var totalValue = g.Sum(ii =>
                                ii.Adjustment?.AdjustedLineTotal ?? ii.LineTotal);
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
                                TotalInclTax = totalValue + gstAmt,
                                // All rows in a group share an ItemTypeName,
                                // which drives the HSCode at write-time, so
                                // they should all carry the same code. Pick
                                // the first non-empty value defensively in
                                // case a legacy row was saved blank.
                                HSCode = g.Select(x => x.HSCode)
                                          .FirstOrDefault(x => !string.IsNullOrWhiteSpace(x))
                            };
                        }).ToList()
                    : inv.Items.Select(ii =>
                        {
                            var lineTotal = ii.Adjustment?.AdjustedLineTotal ?? ii.LineTotal;
                            var qty       = ii.Adjustment?.AdjustedQuantity  ?? ii.Quantity;
                            var gstAmt = Math.Round(lineTotal * inv.GSTRate / 100, 2);
                            return new PrintTaxItemDto
                            {
                                ItemTypeName = ii.ItemTypeName,
                                Quantity = qty,
                                UOM = ii.UOM,
                                Description = ii.Description,
                                ValueExclTax = lineTotal,
                                GSTRate = inv.GSTRate,
                                GSTAmount = gstAmt,
                                TotalInclTax = lineTotal + gstAmt,
                                HSCode = ii.HSCode
                            };
                        }).ToList()
            };
        }

        /// <summary>
        /// Legacy helper retained for any external caller — Tax Invoice
        /// rendering as of 2026-05-13 no longer applies the overlay
        /// (operator policy: printed docs always reflect real bill qty;
        /// only the FBR digital payload sent to PRAL uses the
        /// optimization overlay). Kept private so nothing else picks
        /// it up.
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

        public async Task<int> GetCountByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null)
        {
            return await _invoiceRepo.GetCountByCompanyAsync(companyId, allowedDivisionIds);
        }

        // Sales-invoice count per client for a company — powers the clickable
        // "N sales invoices" chip on the Clients page. Excludes demo invoices to
        // match the page total; includes cancelled (they still show in the list).
        public async Task<Dictionary<int, int>> GetInvoiceCountsByClientAsync(int companyId, HashSet<int>? allowedDivisionIds = null)
        {
            var q = _context.Invoices.Where(i => i.CompanyId == companyId && !i.IsDemo);
            // Division-RBAC scope (null = unrestricted); company-level rows
            // (DivisionId == null) stay visible — policy D1.
            if (allowedDivisionIds != null)
                q = q.Where(i => i.DivisionId == null || allowedDivisionIds.Contains(i.DivisionId.Value));
            return await q
                .GroupBy(i => i.ClientId)
                .Select(g => new { ClientId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.ClientId, x => x.Count);
        }

        public async Task<List<AwaitingPurchaseInvoiceDto>> GetAwaitingPurchaseAsync(int companyId, HashSet<int>? allowedDivisionIds = null)
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

            // Division-RBAC scope (null = unrestricted); company-level bills
            // (DivisionId == null) stay visible — policy D1.
            var billQuery = _context.Invoices.AsQueryable();
            if (allowedDivisionIds != null)
                billQuery = billQuery.Where(i => i.DivisionId == null || allowedDivisionIds.Contains(i.DivisionId.Value));

            // We need raw item rows to compute the per-bill qualification
            // server-side. EF will translate the LINQ to a single query.
            var rawLines = await (
                from i in billQuery
                join ii in _context.InvoiceItems on i.Id equals ii.InvoiceId
                where i.CompanyId == companyId
                   && i.FbrStatus != "Submitted"
                   && !i.IsDemo
                   && !i.IsCancelled
                   // Notes are reversals — nothing to procure against them.
                   && i.DocumentType != 9 && i.DocumentType != 10
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
            int? clientId, DateTime? dateFrom, DateTime? dateTo,
            HashSet<int>? allowedDivisionIds = null)
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
                // Debit/Credit Note lines are RETURNS — excluding them keeps
                // rate suggestions based on actual sales only.
                .Where(ii => ii.Invoice.CompanyId == companyId && !ii.Invoice.IsDemo && !ii.Invoice.IsCancelled
                          && ii.Invoice.DocumentType != 9 && ii.Invoice.DocumentType != 10);
            // Division-RBAC scope (null = unrestricted); lines on company-level
            // bills (DivisionId == null) stay visible — policy D1.
            if (allowedDivisionIds != null)
                q = q.Where(ii => ii.Invoice.DivisionId == null || allowedDivisionIds.Contains(ii.Invoice.DivisionId.Value));

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
                // Debit/Credit Note lines are RETURNS — excluding them keeps
                // rate suggestions based on actual sales only.
                .Where(ii => ii.Invoice.CompanyId == companyId && !ii.Invoice.IsDemo && !ii.Invoice.IsCancelled
                          && ii.Invoice.DocumentType != 9 && ii.Invoice.DocumentType != 10);

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

        /// <summary>
        /// Returns the subset of <paramref name="candidates"/> that are ACTIVE
        /// accounts of <paramref name="companyId"/>'s Chart of Accounts. Per-line
        /// AccountId overrides (design §3.3) are validated against this so a
        /// forged / foreign / inactive id is never persisted — the cross-tenant
        /// account-link guard. Callers coerce a non-member id to null (the
        /// posting engine then derives the account per §4).
        /// </summary>
        private async Task<HashSet<int>> ValidCompanyAccountIdsAsync(int companyId, IEnumerable<int?> candidates)
        {
            var ids = candidates.Where(x => x is > 0).Select(x => x!.Value).Distinct().ToList();
            if (ids.Count == 0) return new HashSet<int>();
            return (await _context.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId && a.IsActive && ids.Contains(a.Id))
                .Select(a => a.Id).ToListAsync()).ToHashSet();
        }

        private static int? Coerce(int? candidate, HashSet<int> validIds)
            => candidate is int id && validIds.Contains(id) ? id : null;
    }
}

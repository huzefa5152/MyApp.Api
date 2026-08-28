using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Copy Document — one generic mechanism behind the Copy action on every
    /// document list, rather than six per-document implementations.
    ///
    /// The rule that shapes the whole class: this service ONLY maps fields. Each
    /// destination is created by that document's own service, so numbering
    /// (<see cref="NumberAllocationRetry"/> + <see cref="DivisionNumbering"/>),
    /// totals, tax, stock, GL posting and validation are the same code paths a
    /// hand-typed document goes through. There is no second numbering mechanism
    /// and no duplicated business logic here.
    ///
    /// Where a conversion already existed (quote→order, order→challan,
    /// order→bill) the copy delegates to it instead of re-deriving the mapping —
    /// so the Copy action and the original button can never drift apart.
    ///
    /// Three field classes, applied consistently:
    ///   • Safe to copy — party, division, commercial terms, tax settings, lines.
    ///   • Regenerated — id, document number, dates, status/workflow, payment and
    ///     posting state, FBR identity (IRN, submission status, error).
    ///   • Destination-specific — mapped per pair below, never blind-copied.
    /// </summary>
    public class DocumentCopyService : IDocumentCopyService
    {
        private readonly AppDbContext _context;
        private readonly ISalesQuoteService _quotes;
        private readonly ISalesOrderService _orders;
        private readonly IDeliveryChallanService _challans;
        private readonly IInvoiceService _invoices;
        private readonly IPurchaseBillService _purchaseBills;
        private readonly IGoodsReceiptService _goodsReceipts;
        private readonly AttachmentStorage _attachmentStorage;
        private readonly ILogger<DocumentCopyService> _logger;

        private readonly Dictionary<(string Source, string Destination), Func<CopyContext, Task<CopyOutcome>>> _mappers;

        public DocumentCopyService(
            AppDbContext context,
            ISalesQuoteService quotes,
            ISalesOrderService orders,
            IDeliveryChallanService challans,
            IInvoiceService invoices,
            IPurchaseBillService purchaseBills,
            IGoodsReceiptService goodsReceipts,
            AttachmentStorage attachmentStorage,
            ILogger<DocumentCopyService> logger)
        {
            _context = context;
            _quotes = quotes;
            _orders = orders;
            _challans = challans;
            _invoices = invoices;
            _purchaseBills = purchaseBills;
            _goodsReceipts = goodsReceipts;
            _attachmentStorage = attachmentStorage;
            _logger = logger;

            _mappers = new Dictionary<(string, string), Func<CopyContext, Task<CopyOutcome>>>
            {
                [(DocumentCopyTypes.SalesQuote, DocumentCopyTypes.SalesQuote)]           = CopyQuoteToQuoteAsync,
                [(DocumentCopyTypes.SalesQuote, DocumentCopyTypes.SalesOrder)]           = CopyQuoteToOrderAsync,
                [(DocumentCopyTypes.SalesOrder, DocumentCopyTypes.SalesOrder)]           = CopyOrderToOrderAsync,
                [(DocumentCopyTypes.SalesOrder, DocumentCopyTypes.DeliveryChallan)]      = CopyOrderToChallanAsync,
                [(DocumentCopyTypes.SalesOrder, DocumentCopyTypes.Invoice)]              = CopyOrderToBillAsync,
                [(DocumentCopyTypes.DeliveryChallan, DocumentCopyTypes.DeliveryChallan)] = CopyChallanToChallanAsync,
                [(DocumentCopyTypes.Invoice, DocumentCopyTypes.Invoice)]                 = CopyBillToBillAsync,
                [(DocumentCopyTypes.PurchaseBill, DocumentCopyTypes.PurchaseBill)]       = CopyPurchaseBillToPurchaseBillAsync,
                [(DocumentCopyTypes.PurchaseBill, DocumentCopyTypes.GoodsReceipt)]       = CopyPurchaseBillToGoodsReceiptAsync,
                [(DocumentCopyTypes.GoodsReceipt, DocumentCopyTypes.GoodsReceipt)]       = CopyGoodsReceiptToGoodsReceiptAsync,
                [(DocumentCopyTypes.GoodsReceipt, DocumentCopyTypes.PurchaseBill)]       = CopyGoodsReceiptToPurchaseBillAsync,
            };
        }

        /// <summary>Per-request state threaded through a mapper.</summary>
        private sealed class CopyContext
        {
            public CopyDocumentRequestDto Request { get; init; } = null!;
            public DocumentCopySourceRef Source { get; init; } = null!;
            public DateTime Date { get; init; }
            public List<string> Warnings { get; } = new();
            public bool Details => Request.CopyDocumentDetails;
        }

        private sealed record CopyOutcome(int Id, int Number, int LineItems);

        // ── Source resolution ────────────────────────────────────────────────

        public async Task<DocumentCopySourceRef?> GetSourceRefAsync(string sourceType, int sourceId)
        {
            var type = DocumentCopyTypes.Canonical(sourceType);
            if (type == null) return null;

            return type switch
            {
                DocumentCopyTypes.SalesQuote => await _context.SalesQuotes.AsNoTracking()
                    .Where(x => x.Id == sourceId)
                    .Select(x => new DocumentCopySourceRef(type, x.Id, x.CompanyId, x.DivisionId, x.QuoteNumber))
                    .FirstOrDefaultAsync(),
                DocumentCopyTypes.SalesOrder => await _context.SalesOrders.AsNoTracking()
                    .Where(x => x.Id == sourceId)
                    .Select(x => new DocumentCopySourceRef(type, x.Id, x.CompanyId, x.DivisionId, x.SalesOrderNumber))
                    .FirstOrDefaultAsync(),
                DocumentCopyTypes.DeliveryChallan => await _context.DeliveryChallans.AsNoTracking()
                    .Where(x => x.Id == sourceId)
                    .Select(x => new DocumentCopySourceRef(type, x.Id, x.CompanyId, x.DivisionId, x.ChallanNumber))
                    .FirstOrDefaultAsync(),
                DocumentCopyTypes.Invoice => await _context.Invoices.AsNoTracking()
                    .Where(x => x.Id == sourceId)
                    .Select(x => new DocumentCopySourceRef(type, x.Id, x.CompanyId, x.DivisionId, x.InvoiceNumber))
                    .FirstOrDefaultAsync(),
                DocumentCopyTypes.PurchaseBill => await _context.PurchaseBills.AsNoTracking()
                    .Where(x => x.Id == sourceId)
                    .Select(x => new DocumentCopySourceRef(type, x.Id, x.CompanyId, x.DivisionId, x.PurchaseBillNumber))
                    .FirstOrDefaultAsync(),
                DocumentCopyTypes.GoodsReceipt => await _context.GoodsReceipts.AsNoTracking()
                    .Where(x => x.Id == sourceId)
                    .Select(x => new DocumentCopySourceRef(type, x.Id, x.CompanyId, x.DivisionId, x.GoodsReceiptNumber))
                    .FirstOrDefaultAsync(),
                _ => null,
            };
        }

        public async Task<int> GetAttachmentCountAsync(int companyId, string sourceType, int sourceId)
        {
            var type = AttachmentEntityTypes.Canonical(sourceType);
            if (type == null) return 0;
            return await _context.Attachments.AsNoTracking()
                .CountAsync(a => a.CompanyId == companyId && a.EntityType == type && a.EntityId == sourceId);
        }

        // ── Entry point ──────────────────────────────────────────────────────

        public async Task<CopyDocumentResultDto> CopyAsync(CopyDocumentRequestDto request, int userId)
        {
            var sourceType = DocumentCopyTypes.Canonical(request.SourceType)
                ?? throw new InvalidOperationException("Unknown source document type.");
            var destinationType = DocumentCopyTypes.Canonical(request.DestinationType)
                ?? throw new InvalidOperationException("Unknown destination document type.");

            if (!DocumentCopyTypes.IsSupported(sourceType, destinationType))
                throw new InvalidOperationException(
                    $"A {DocumentCopyTypes.Label(sourceType)} cannot be copied into a {DocumentCopyTypes.Label(destinationType)}.");

            // Every document in this system requires at least one line, so an
            // empty copy would simply fail that validation further down. Say so
            // here instead of surfacing a confusing "At least one item" error.
            if (!request.CopyLineItems)
                throw new InvalidOperationException(
                    $"A {DocumentCopyTypes.Label(destinationType)} must have at least one line, so line items are always copied.");

            var source = await GetSourceRefAsync(sourceType, request.SourceId)
                ?? throw new KeyNotFoundException($"{DocumentCopyTypes.Label(sourceType)} not found.");

            var ctx = new CopyContext
            {
                Request = request,
                Source = source,
                Date = (request.Date ?? PakistanClock.Today).Date,
            };

            var outcome = await _mappers[(sourceType, destinationType)](ctx);

            await StampLineageAsync(destinationType, outcome.Id, sourceType, source.Id);

            var attachmentsCopied = 0;
            if (request.CopyAttachments)
                attachmentsCopied = await CopyAttachmentsAsync(ctx, destinationType, outcome.Id);

            _logger.LogInformation(
                "Copied {SourceType} {SourceId} into {DestinationType} {NewId} (number {Number}) for user {UserId}",
                sourceType, source.Id, destinationType, outcome.Id, outcome.Number, userId);

            return new CopyDocumentResultDto
            {
                DocumentType = destinationType,
                DocumentTypeLabel = DocumentCopyTypes.Label(destinationType),
                Id = outcome.Id,
                Number = outcome.Number,
                SourceType = sourceType,
                SourceId = source.Id,
                SourceNumber = source.Number,
                LineItemsCopied = outcome.LineItems,
                AttachmentsCopied = attachmentsCopied,
                Warnings = ctx.Warnings,
            };
        }

        // ── Sales: quote ─────────────────────────────────────────────────────

        private async Task<CopyOutcome> CopyQuoteToQuoteAsync(CopyContext ctx)
        {
            var quote = await LoadQuoteAsync(ctx.Source.Id);

            var dto = new SalesQuoteDto
            {
                ClientId = quote.ClientId,
                DivisionId = quote.DivisionId,
                Date = ctx.Date,
                // A validity window is relative, not absolute: a quote valid for
                // 30 days is copied as valid for 30 days from the new date, not
                // as one that expired last month.
                ValidUntil = ShiftRelative(quote.ValidUntil, quote.Date, ctx.Date),
                GSTRate = quote.GSTRate,
                CustomerEnquiryRef = ctx.Details ? quote.CustomerEnquiryRef : null,
                EnquiryDate = ctx.Details ? quote.EnquiryDate : null,
                Notes = ctx.Details ? quote.Notes : null,
                Items = quote.Items.Select(i => new SalesQuoteItemDto
                {
                    ItemTypeId = i.ItemTypeId,
                    NonInventoryItemId = i.NonInventoryItemId,
                    Description = i.Description,
                    Quantity = i.Quantity,
                    Unit = i.Unit,
                    UnitPrice = i.UnitPrice,
                    // Duplicate the file — two quotes sharing one image would lose
                    // it the moment either is edited or deleted.
                    ImagePath = QuoteLineImages.TryCopy(i.ImagePath, quote.CompanyId),
                }).ToList(),
            };

            var missingImages = quote.Items.Count(i => !string.IsNullOrWhiteSpace(i.ImagePath))
                              - dto.Items.Count(i => !string.IsNullOrWhiteSpace(i.ImagePath));
            if (missingImages > 0)
                ctx.Warnings.Add($"{missingImages} line photo(s) could not be copied and were left blank.");

            var created = await _quotes.CreateAsync(quote.CompanyId, dto);
            return new CopyOutcome(created.Id, created.QuoteNumber, created.Items.Count);
        }

        private async Task<CopyOutcome> CopyQuoteToOrderAsync(CopyContext ctx)
        {
            // Delegates to the existing Convert action so Copy→Sales Order and the
            // Convert button stay one behaviour: the order carries SalesQuoteId,
            // and the quote is marked Converted / Accepted. That also means a
            // quote converts once — the second attempt is refused by that flow.
            if (!ctx.Details)
                ctx.Warnings.Add("Converting a quote into an order always carries the quote's client, division and lines.");

            var created = await _quotes.ConvertToSalesOrderAsync(ctx.Source.Id);
            return new CopyOutcome(created.Id, created.SalesOrderNumber, created.Items.Count);
        }

        // ── Sales: order ─────────────────────────────────────────────────────

        private async Task<CopyOutcome> CopyOrderToOrderAsync(CopyContext ctx)
        {
            var order = await LoadOrderAsync(ctx.Source.Id);

            var dto = new SalesOrderDto
            {
                ClientId = order.ClientId,
                DivisionId = order.DivisionId,
                OrderDate = ctx.Date,
                RequiredDate = ShiftRelative(order.RequiredDate, order.OrderDate, ctx.Date),
                CustomerPoNumber = ctx.Details ? order.CustomerPoNumber : null,
                CustomerPoDate = ctx.Details ? order.CustomerPoDate : null,
                Site = ctx.Details ? order.Site : null,
                Notes = ctx.Details ? order.Notes : null,
                // SalesQuoteId is NOT carried: that link is the source order's own
                // provenance, and a quote maps to exactly one order.
                Items = order.Items.Select(i => new SalesOrderItemDto
                {
                    ItemTypeId = i.ItemTypeId,
                    NonInventoryItemId = i.NonInventoryItemId,
                    Description = i.Description,
                    Quantity = i.Quantity,
                    Unit = i.Unit,
                    UnitPrice = i.UnitPrice,
                }).ToList(),
            };

            var created = await _orders.CreateAsync(order.CompanyId, dto);
            return new CopyOutcome(created.Id, created.SalesOrderNumber, created.Items.Count);
        }

        private async Task<CopyOutcome> CopyOrderToChallanAsync(CopyContext ctx)
        {
            var order = await LoadOrderAsync(ctx.Source.Id);
            var fullDto = await _orders.GetByIdAsync(order.Id)
                ?? throw new KeyNotFoundException("Sales Order not found.");

            // Quantities default to what is still outstanding — the same rule the
            // Create Challan dialog uses. Copying the ordered quantity instead
            // would silently over-deliver an order that is partly delivered.
            var lines = fullDto.Items
                .Where(i => i.RemainingQuantity > 0)
                .Select(i => new DeliverLineDto
                {
                    SalesOrderItemId = i.Id,
                    Quantity = i.RemainingQuantity,
                    ItemTypeId = i.ItemTypeId,
                    NonInventoryItemId = i.NonInventoryItemId,
                })
                .ToList();

            if (lines.Count == 0)
                throw new InvalidOperationException(
                    "Every line on this Sales Order is already fully delivered, so there is nothing to put on a new challan.");

            if (lines.Count < fullDto.Items.Count)
                ctx.Warnings.Add(
                    $"{fullDto.Items.Count - lines.Count} fully-delivered line(s) were left off the challan.");

            var created = await _orders.CreateChallanFromOrderAsync(order.Id, new CreateChallanFromOrderDto
            {
                DeliveryDate = ctx.Date,
                Site = ctx.Details ? order.Site : null,
                Lines = lines,
            });

            return new CopyOutcome(created.Id, created.ChallanNumber, created.Items?.Count ?? lines.Count);
        }

        private async Task<CopyOutcome> CopyOrderToBillAsync(CopyContext ctx)
        {
            // Reuses the order→bill prefill that the Create Bill screen already
            // runs, so prices resolve through the same quote → last-billed chain.
            var prefill = await _orders.GetInvoicePrefillAsync(ctx.Source.Id)
                ?? throw new KeyNotFoundException("Sales Order not found.");

            if (prefill.Lines.Count == 0)
                throw new InvalidOperationException("This Sales Order has no lines to bill.");

            var dto = new CreateStandaloneInvoiceDto
            {
                Date = ctx.Date,
                CompanyId = prefill.CompanyId,
                DivisionId = prefill.DivisionId,
                ClientId = prefill.ClientId,
                GSTRate = prefill.GstRate ?? 0,
                SalesOrderId = prefill.SalesOrderId,
                PoNumber = ctx.Details ? prefill.CustomerPoNumber : null,
                PoDate = ctx.Details ? prefill.CustomerPoDate : null,
                Items = prefill.Lines.Select(l => new CreateStandaloneInvoiceItemDto
                {
                    Description = l.Description,
                    Quantity = l.Quantity,
                    UOM = l.Unit,
                    UnitPrice = l.UnitPrice,
                    ItemTypeId = l.ItemTypeId,
                    NonInventoryItemId = l.NonInventoryItemId,
                }).ToList(),
            };

            var unpriced = dto.Items.Count(i => i.UnitPrice <= 0);
            if (unpriced > 0)
                ctx.Warnings.Add($"{unpriced} line(s) had no known price and were billed at 0 — set the prices before submitting.");

            var created = await _invoices.CreateStandaloneAsync(dto);
            return new CopyOutcome(created.Id, created.InvoiceNumber, dto.Items.Count);
        }

        // ── Sales: challan ───────────────────────────────────────────────────

        private async Task<CopyOutcome> CopyChallanToChallanAsync(CopyContext ctx)
        {
            var challan = await _context.DeliveryChallans.AsNoTracking()
                .Include(c => c.Items)
                .FirstOrDefaultAsync(c => c.Id == ctx.Source.Id)
                ?? throw new KeyNotFoundException("Delivery Challan not found.");

            if (challan.IsDemo)
                throw new InvalidOperationException("Sandbox demo challans cannot be copied.");

            var dto = new DeliveryChallanDto
            {
                ClientId = challan.ClientId,
                DivisionId = challan.DivisionId,
                DeliveryDate = ctx.Date,
                PoNumber = ctx.Details ? challan.PoNumber : "",
                PoDate = ctx.Details ? challan.PoDate : null,
                IndentNo = ctx.Details ? challan.IndentNo : null,
                Site = ctx.Details ? challan.Site : null,
                Items = challan.Items.Select(i => new DeliveryItemDto
                {
                    ItemTypeId = i.ItemTypeId,
                    NonInventoryItemId = i.NonInventoryItemId,
                    Description = i.Description,
                    Quantity = i.Quantity,
                    Unit = i.Unit,
                    // SalesOrderItemId is deliberately dropped: fulfilment is the
                    // sum of delivered quantities, so a copy that kept the link
                    // would report the order as delivered twice. Use the order's
                    // own Create Challan action to deliver more of an order.
                }).ToList(),
            };

            if (challan.SalesOrderId.HasValue)
                ctx.Warnings.Add(
                    "The copy is a standalone challan — it is not linked to the source challan's Sales Order, so it does not count towards that order's delivered quantity.");

            var created = await _challans.CreateDeliveryChallanAsync(challan.CompanyId, dto);
            return new CopyOutcome(created.Id, created.ChallanNumber, created.Items?.Count ?? dto.Items.Count);
        }

        // ── Sales: bill ──────────────────────────────────────────────────────

        private async Task<CopyOutcome> CopyBillToBillAsync(CopyContext ctx)
        {
            var bill = await _context.Invoices.AsNoTracking()
                .Include(i => i.Items)
                .FirstOrDefaultAsync(i => i.Id == ctx.Source.Id)
                ?? throw new KeyNotFoundException("Bill not found.");

            // A Credit / Debit Note only means something against the invoice it
            // adjusts; copying one would produce a note pointing at nothing.
            if (bill.DocumentType == 9 || bill.DocumentType == 10)
                throw new InvalidOperationException(
                    "Credit and Debit Notes can't be copied — raise one from the invoice it adjusts.");
            if (bill.IsDemo)
                throw new InvalidOperationException("Sandbox demo bills cannot be copied.");

            var dto = new CreateStandaloneInvoiceDto
            {
                Date = ctx.Date,
                CompanyId = bill.CompanyId,
                DivisionId = bill.DivisionId,
                ClientId = bill.ClientId,
                GSTRate = bill.GSTRate,
                PaymentTerms = ctx.Details ? bill.PaymentTerms : null,
                DocumentType = bill.DocumentType,
                PaymentMode = ctx.Details ? bill.PaymentMode : null,
                PoNumber = ctx.Details ? bill.PoNumber : null,
                PoDate = ctx.Details ? bill.PoDate : null,
                WithholdingTaxRate = ctx.Details ? bill.WithholdingTaxRate : null,
                WithholdingTaxAmount = ctx.Details ? bill.WithholdingTaxAmount : 0,
                PrintGroupBillByItemType = bill.PrintGroupBillByItemType,
                // SalesOrderId is not carried: the source bill already consumed
                // that order's outstanding quantity.
                Items = bill.Items.Select(i => new CreateStandaloneInvoiceItemDto
                {
                    Description = i.Description,
                    Quantity = i.Quantity,
                    UOM = i.UOM,
                    UnitPrice = i.UnitPrice,
                    ItemTypeId = i.ItemTypeId,
                    NonInventoryItemId = i.NonInventoryItemId,
                    AccountId = i.AccountId,
                    HSCode = i.HSCode,
                    FbrUOMId = i.FbrUOMId,
                    SaleType = i.SaleType,
                    RateId = i.RateId,
                    FixedNotifiedValueOrRetailPrice = i.FixedNotifiedValueOrRetailPrice,
                    SroScheduleNo = i.SroScheduleNo,
                    SroItemSerialNo = i.SroItemSerialNo,
                }).ToList(),
            };

            if (await _context.DeliveryChallans.AnyAsync(c => c.InvoiceId == bill.Id))
                ctx.Warnings.Add(
                    "The copy is a standalone bill — the source bill's delivery challans stay with the original.");
            if (ctx.Details && bill.WithholdingTaxAmount > 0 && bill.WithholdingTaxRate == null)
                ctx.Warnings.Add("The fixed withholding-tax amount was carried over unchanged — check it against the new total.");

            var created = await _invoices.CreateStandaloneAsync(dto);
            return new CopyOutcome(created.Id, created.InvoiceNumber, dto.Items.Count);
        }

        // ── Purchase ─────────────────────────────────────────────────────────

        private async Task<CopyOutcome> CopyPurchaseBillToPurchaseBillAsync(CopyContext ctx)
        {
            var bill = await LoadPurchaseBillAsync(ctx.Source.Id);

            var dto = new CreatePurchaseBillDto
            {
                Date = ctx.Date,
                CompanyId = bill.CompanyId,
                DivisionId = bill.DivisionId,
                SupplierId = bill.SupplierId,
                GSTRate = bill.GSTRate,
                PaymentTerms = ctx.Details ? bill.PaymentTerms : null,
                DocumentType = bill.DocumentType,
                PaymentMode = ctx.Details ? bill.PaymentMode : null,
                WithholdingTaxRate = ctx.Details ? bill.WithholdingTaxRate : null,
                WithholdingTaxAmount = ctx.Details ? bill.WithholdingTaxAmount : 0,
                // SupplierBillNumber and SupplierIRN identify the supplier's own
                // document. Two of our bills claiming one supplier invoice would
                // corrupt the Annexure-A reconciliation, so they are regenerated
                // (left blank) rather than copied.
                Items = bill.Items.Select(i => new CreatePurchaseItemDto
                {
                    ItemTypeId = i.ItemTypeId,
                    NonInventoryItemId = i.NonInventoryItemId,
                    AccountId = i.AccountId,
                    Description = i.Description,
                    Quantity = i.Quantity,
                    UOM = i.UOM,
                    UnitPrice = i.UnitPrice,
                    HSCode = i.HSCode,
                    FbrUOMId = i.FbrUOMId,
                    SaleType = i.SaleType,
                    RateId = i.RateId,
                    FixedNotifiedValueOrRetailPrice = i.FixedNotifiedValueOrRetailPrice,
                }).ToList(),
            };

            if (!string.IsNullOrWhiteSpace(bill.SupplierIRN) || !string.IsNullOrWhiteSpace(bill.SupplierBillNumber))
                ctx.Warnings.Add("The supplier's bill number and IRN were left blank — enter the ones from the new supplier invoice.");

            var created = await _purchaseBills.CreateAsync(dto);
            return new CopyOutcome(created.Id, created.PurchaseBillNumber, dto.Items.Count);
        }

        private async Task<CopyOutcome> CopyPurchaseBillToGoodsReceiptAsync(CopyContext ctx)
        {
            var bill = await LoadPurchaseBillAsync(ctx.Source.Id);

            var items = new List<CreateGoodsReceiptItemDto>();
            var rounded = 0;
            var dropped = 0;
            foreach (var i in bill.Items)
            {
                // A goods receipt counts whole units — its quantity column is an
                // integer, unlike every other line model.
                var qty = (int)Math.Round(i.Quantity, MidpointRounding.AwayFromZero);
                if (qty != i.Quantity) rounded++;
                if (qty <= 0) { dropped++; continue; }
                items.Add(new CreateGoodsReceiptItemDto
                {
                    ItemTypeId = i.ItemTypeId,
                    NonInventoryItemId = i.NonInventoryItemId,
                    Description = i.Description,
                    Quantity = qty,
                    Unit = i.UOM,
                });
            }

            if (items.Count == 0)
                throw new InvalidOperationException(
                    "None of this purchase bill's quantities round to a whole unit, so there is nothing to receive.");
            if (rounded > 0)
                ctx.Warnings.Add($"{rounded} fractional quantity(ies) were rounded — a goods receipt records whole units.");
            if (dropped > 0)
                ctx.Warnings.Add($"{dropped} line(s) rounded to zero and were left off the receipt.");

            var created = await _goodsReceipts.CreateAsync(new CreateGoodsReceiptDto
            {
                ReceiptDate = ctx.Date,
                CompanyId = bill.CompanyId,
                DivisionId = bill.DivisionId,
                SupplierId = bill.SupplierId,
                // The natural link: this receipt records the arrival of the goods
                // on that bill.
                PurchaseBillId = bill.Id,
                Items = items,
            });

            return new CopyOutcome(created.Id, created.GoodsReceiptNumber, items.Count);
        }

        private async Task<CopyOutcome> CopyGoodsReceiptToGoodsReceiptAsync(CopyContext ctx)
        {
            var receipt = await LoadGoodsReceiptAsync(ctx.Source.Id);

            var created = await _goodsReceipts.CreateAsync(new CreateGoodsReceiptDto
            {
                ReceiptDate = ctx.Date,
                CompanyId = receipt.CompanyId,
                DivisionId = receipt.DivisionId,
                SupplierId = receipt.SupplierId,
                // Several receipts against one purchase bill is a supported shape
                // (a bill delivered in instalments), so the link is a detail.
                PurchaseBillId = ctx.Details ? receipt.PurchaseBillId : null,
                SupplierChallanNumber = ctx.Details ? receipt.SupplierChallanNumber : null,
                Site = ctx.Details ? receipt.Site : null,
                Items = receipt.Items.Select(i => new CreateGoodsReceiptItemDto
                {
                    ItemTypeId = i.ItemTypeId,
                    NonInventoryItemId = i.NonInventoryItemId,
                    Description = i.Description,
                    Quantity = i.Quantity,
                    Unit = i.Unit,
                }).ToList(),
            });

            return new CopyOutcome(created.Id, created.GoodsReceiptNumber, receipt.Items.Count);
        }

        private async Task<CopyOutcome> CopyGoodsReceiptToPurchaseBillAsync(CopyContext ctx)
        {
            var receipt = await LoadGoodsReceiptAsync(ctx.Source.Id);

            // A receipt is an operations document: it records what arrived, never
            // what it costs. The bill is created at zero value so the operator can
            // price it against the supplier's invoice.
            var dto = new CreatePurchaseBillDto
            {
                Date = ctx.Date,
                CompanyId = receipt.CompanyId,
                DivisionId = receipt.DivisionId,
                SupplierId = receipt.SupplierId,
                GSTRate = 0,
                Items = receipt.Items.Select(i => new CreatePurchaseItemDto
                {
                    ItemTypeId = i.ItemTypeId,
                    NonInventoryItemId = i.NonInventoryItemId,
                    Description = i.Description,
                    Quantity = i.Quantity,
                    UOM = i.Unit,
                    UnitPrice = 0,
                }).ToList(),
            };

            ctx.Warnings.Add("A goods receipt carries no prices, so every line was billed at 0 with GST 0 — enter the supplier's amounts before paying or filing it.");
            ctx.Warnings.Add("Link the receipt to this bill from the receipt itself if you need the two connected.");

            var created = await _purchaseBills.CreateAsync(dto);
            return new CopyOutcome(created.Id, created.PurchaseBillNumber, dto.Items.Count);
        }

        // ── Shared helpers ───────────────────────────────────────────────────

        /// <summary>
        /// Keeps a relative date relative: a delivery wanted 14 days after the
        /// order stays 14 days after the copy's date. Past dates are not carried
        /// forward as-is, which would make the copy instantly overdue.
        /// </summary>
        private static DateTime? ShiftRelative(DateTime? value, DateTime originalAnchor, DateTime newAnchor)
        {
            if (!value.HasValue) return null;
            var offset = value.Value.Date - originalAnchor.Date;
            return offset < TimeSpan.Zero ? null : newAnchor.Date + offset;
        }

        /// <summary>
        /// Records where the new document came from. Written after the create so
        /// the destination service keeps full ownership of its own insert, and as
        /// plain columns rather than an FK — the source may be a different entity.
        /// </summary>
        private async Task StampLineageAsync(string destinationType, int newId, string sourceType, int sourceId)
        {
            switch (destinationType)
            {
                case DocumentCopyTypes.SalesQuote:
                    var q = await _context.SalesQuotes.FirstOrDefaultAsync(x => x.Id == newId);
                    if (q != null) { q.CopiedFromType = sourceType; q.CopiedFromId = sourceId; }
                    break;
                case DocumentCopyTypes.SalesOrder:
                    var o = await _context.SalesOrders.FirstOrDefaultAsync(x => x.Id == newId);
                    if (o != null) { o.CopiedFromType = sourceType; o.CopiedFromId = sourceId; }
                    break;
                case DocumentCopyTypes.DeliveryChallan:
                    var c = await _context.DeliveryChallans.FirstOrDefaultAsync(x => x.Id == newId);
                    if (c != null) { c.CopiedFromType = sourceType; c.CopiedFromId = sourceId; }
                    break;
                case DocumentCopyTypes.Invoice:
                    var i = await _context.Invoices.FirstOrDefaultAsync(x => x.Id == newId);
                    if (i != null) { i.CopiedFromType = sourceType; i.CopiedFromId = sourceId; }
                    break;
                case DocumentCopyTypes.PurchaseBill:
                    var p = await _context.PurchaseBills.FirstOrDefaultAsync(x => x.Id == newId);
                    if (p != null) { p.CopiedFromType = sourceType; p.CopiedFromId = sourceId; }
                    break;
                case DocumentCopyTypes.GoodsReceipt:
                    var g = await _context.GoodsReceipts.FirstOrDefaultAsync(x => x.Id == newId);
                    if (g != null) { g.CopiedFromType = sourceType; g.CopiedFromId = sourceId; }
                    break;
            }
            await _context.SaveChangesAsync();
        }

        /// <summary>
        /// Duplicates the source's attachments onto the new document, bytes and
        /// all — two rows pointing at one file would lose it as soon as either
        /// side is deleted. A file missing from disk is skipped, not fatal.
        /// </summary>
        private async Task<int> CopyAttachmentsAsync(CopyContext ctx, string destinationType, int newId)
        {
            var sourceEntityType = AttachmentEntityTypes.Canonical(ctx.Source.Type);
            var destEntityType = AttachmentEntityTypes.Canonical(destinationType);
            if (sourceEntityType == null || destEntityType == null) return 0;

            var sources = await _context.Attachments.AsNoTracking()
                .Where(a => a.CompanyId == ctx.Source.CompanyId
                         && a.EntityType == sourceEntityType
                         && a.EntityId == ctx.Source.Id)
                .ToListAsync();
            if (sources.Count == 0) return 0;

            var copied = 0;
            var skipped = 0;
            foreach (var src in sources)
            {
                var stored = _attachmentStorage.TryCopyStored(src.StoragePath);
                if (stored == null) { skipped++; continue; }

                _context.Attachments.Add(new Attachment
                {
                    CompanyId = src.CompanyId,
                    DivisionId = src.DivisionId,
                    FolderId = src.FolderId,
                    EntityType = destEntityType,
                    EntityId = newId,
                    FileName = src.FileName,
                    StoredFileName = stored.StoredFileName,
                    StoragePath = stored.StoragePath,
                    ContentType = src.ContentType,
                    FileExtension = src.FileExtension,
                    FileSizeBytes = src.FileSizeBytes,
                    ContentSha256 = stored.Sha256,
                    UploadedByUserId = src.UploadedByUserId,
                });
                copied++;
            }

            if (copied > 0) await _context.SaveChangesAsync();
            if (skipped > 0) ctx.Warnings.Add($"{skipped} attachment(s) were missing from storage and could not be copied.");
            return copied;
        }

        private async Task<SalesQuote> LoadQuoteAsync(int id) =>
            await _context.SalesQuotes.AsNoTracking().Include(q => q.Items)
                .FirstOrDefaultAsync(q => q.Id == id)
            ?? throw new KeyNotFoundException("Sales Quote not found.");

        private async Task<SalesOrder> LoadOrderAsync(int id) =>
            await _context.SalesOrders.AsNoTracking().Include(o => o.Items)
                .FirstOrDefaultAsync(o => o.Id == id)
            ?? throw new KeyNotFoundException("Sales Order not found.");

        private async Task<PurchaseBill> LoadPurchaseBillAsync(int id) =>
            await _context.PurchaseBills.AsNoTracking().Include(b => b.Items)
                .FirstOrDefaultAsync(b => b.Id == id)
            ?? throw new KeyNotFoundException("Purchase Bill not found.");

        private async Task<GoodsReceipt> LoadGoodsReceiptAsync(int id) =>
            await _context.GoodsReceipts.AsNoTracking().Include(r => r.Items)
                .FirstOrDefaultAsync(r => r.Id == id)
            ?? throw new KeyNotFoundException("Goods Receipt not found.");
    }
}

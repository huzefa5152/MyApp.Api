namespace MyApp.Api.DTOs
{
    public class InvoiceDto
    {
        public int Id { get; set; }
        public int InvoiceNumber { get; set; }
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }
        public string CompanyName { get; set; } = "";
        public int ClientId { get; set; }
        public string ClientName { get; set; } = "";
        public decimal Subtotal { get; set; }
        public decimal GSTRate { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal GrandTotal { get; set; }
        public string AmountInWords { get; set; } = "";
        public string? PaymentTerms { get; set; }
        public int? DocumentType { get; set; }
        public string? PaymentMode { get; set; }
        public string? FbrInvoiceNumber { get; set; }
        public string? FbrIRN { get; set; }
        public string? FbrStatus { get; set; }
        public DateTime? FbrSubmittedAt { get; set; }
        public string? FbrErrorMessage { get; set; }
        public DateTime CreatedAt { get; set; }
        public bool IsEditable { get; set; }
        /// <summary>
        /// True when this is the LATEST (highest-numbered) bill for its
        /// company — only the latest bill can be deleted. Earlier bills
        /// must be edited instead to keep the numbering sequence gap-free.
        /// </summary>
        public bool IsLatest { get; set; }
        /// <summary>
        /// When true, the bulk Validate All / Submit All buttons skip this
        /// bill. Per-bill Validate / Submit remain available — the toggle
        /// is strictly about bulk opt-out.
        /// </summary>
        public bool IsFbrExcluded { get; set; }
        /// <summary>
        /// True when this bill has been voided/cancelled. The bill keeps its
        /// number (no gap) but is excluded from KPIs and can no longer be
        /// edited or sent to FBR. The UI shows a "Cancelled" badge and hides
        /// the edit / FBR / void actions.
        /// </summary>
        public bool IsCancelled { get; set; }
        public DateTime? CancelledAt { get; set; }
        public string? CancelReason { get; set; }

        // ── Credit / Debit Note linkage (2026-07-01) ─────────────────────
        /// <summary>Local id of the original invoice this note reverses/adjusts (null for ordinary sale invoices).</summary>
        public int? OriginalInvoiceId { get; set; }
        /// <summary>Human-facing bill number of the original invoice (for the "against #123" line). Null for ordinary invoices.</summary>
        public int? OriginalInvoiceNumber { get; set; }
        /// <summary>The original invoice's FBR IRN this note references (sent to FBR as invoiceRefNo).</summary>
        public string? OriginalInvoiceRefIRN { get; set; }
        /// <summary>FBR reason for the note.</summary>
        public string? NoteReason { get; set; }
        /// <summary>Remarks (required by FBR when reason is "Others").</summary>
        public string? NoteReasonRemarks { get; set; }
        /// <summary>Notes only: whether this note moves inventory (Credit Note → IN, Debit Note → OUT). Null on sale invoices.</summary>
        public bool? NoteAffectsStock { get; set; }
        /// <summary>
        /// If this invoice has a LIVE (non-cancelled) CREDIT NOTE (return /
        /// reversal) against it, that note's number in the credit-note
        /// sequence — the UI hides the Reverse action and shows "Reversed by
        /// CN #N". Null when none exists.
        /// </summary>
        public int? ReversedByCreditNoteNumber { get; set; }
        /// <summary>
        /// If this invoice has a LIVE DEBIT NOTE (upward adjustment) against
        /// it, that note's number in the debit-note sequence. Null when none.
        /// </summary>
        public int? AdjustedByDebitNoteNumber { get; set; }
        /// <summary>
        /// True when every item has HSCode + SaleType + UOM (either FbrUOMId or a non-empty UOM string),
        /// meaning the bill has enough data to be validated/submitted to FBR.
        /// </summary>
        public bool FbrReady { get; set; }
        /// <summary>
        /// Human-readable list of what's missing for FBR submission. Empty when FbrReady == true.
        /// </summary>
        public List<string> FbrMissing { get; set; } = new();
        public List<InvoiceItemDto> Items { get; set; } = new();
        public List<int> ChallanNumbers { get; set; } = new();

        // Aggregated from the linked DeliveryChallans — bills don't
        // store these directly because a single bill can roll up
        // multiple challans, but the bill list / view UI wants to
        // show "PO 553, Indent A-12, Site Unit-2" at a glance.
        // Strings are joined with "; " when multiple distinct values
        // exist across the linked challans (rare in practice — most
        // bills cover one challan).
        public string? PoNumber { get; set; }
        public string? IndentNo { get; set; }
        public string? Site { get; set; }
    }

    public class InvoiceItemDto
    {
        public int Id { get; set; }
        public int? DeliveryItemId { get; set; }
        /// <summary>FK to ItemType (FBR catalog entry) driving HS/UOM/Sale Type on this line.</summary>
        public int? ItemTypeId { get; set; }
        public string ItemTypeName { get; set; } = "";
        public string Description { get; set; } = "";
        // Decimal — see DeliveryItemDto.Quantity for the formatting contract.
        public decimal Quantity { get; set; }
        public string UOM { get; set; } = "";
        public decimal UnitPrice { get; set; }
        public decimal LineTotal { get; set; }
        public string? HSCode { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public int? RateId { get; set; }
        /// <summary>
        /// 3rd Schedule retail price (MRP × qty). Required when SaleType is
        /// "3rd Schedule Goods" to satisfy FBR error 0090.
        /// </summary>
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }
        /// <summary>
        /// Optional dual-book overlay (2026-05-11). When present, the
        /// frontend's Invoice-mode view should render the AdjustedXxx
        /// values as "current" while keeping the row above as the
        /// bill-mode source-of-truth. Bill print always uses the row
        /// directly; ignore this field there.
        /// </summary>
        public InvoiceItemAdjustmentDto? Adjustment { get; set; }
    }

    /// <summary>
    /// Wire-shape mirror of <c>Models.InvoiceItemAdjustment</c>. All
    /// adjusted fields are optional — NULL means "use the InvoiceItem
    /// value." Surfaced on every <see cref="InvoiceItemDto"/> when an
    /// overlay exists for that line.
    /// 2026-05-11: added.
    /// </summary>
    public class InvoiceItemAdjustmentDto
    {
        public int Id { get; set; }
        public decimal? AdjustedQuantity { get; set; }
        public decimal? AdjustedUnitPrice { get; set; }
        public decimal? AdjustedLineTotal { get; set; }
        public int? AdjustedItemTypeId { get; set; }
        public string? AdjustedItemTypeName { get; set; }
        public string? AdjustedDescription { get; set; }
        public string? AdjustedUOM { get; set; }
        public int? AdjustedFbrUOMId { get; set; }
        public string? AdjustedHSCode { get; set; }
        public string? AdjustedSaleType { get; set; }
        public string Reason { get; set; } = "";
        public DateTime CreatedAt { get; set; }
        public DateTime? UpdatedAt { get; set; }
    }

    public class CreateInvoiceDto
    {
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }
        public int ClientId { get; set; }
        public decimal GSTRate { get; set; }
        public string? PaymentTerms { get; set; }
        /// <summary>FBR document type: 4 = Sale Invoice (default), 9 = Debit Note, 10 = Credit Note.</summary>
        public int? DocumentType { get; set; }
        /// <summary>Optional payment mode (Cash / Credit / Bank Transfer / Cheque / Online).</summary>
        public string? PaymentMode { get; set; }
        public List<int> ChallanIds { get; set; } = new();
        public List<CreateInvoiceItemDto> Items { get; set; } = new();
        public Dictionary<int, DateTime> PoDateUpdates { get; set; } = new();
    }

    public class CreateInvoiceItemDto
    {
        public int DeliveryItemId { get; set; }
        public decimal UnitPrice { get; set; }
        public string? Description { get; set; }
        /// <summary>Optional override of the delivery item's UOM (e.g. the FBR-matched UOM).</summary>
        public string? UOM { get; set; }
        public string? HSCode { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public int? RateId { get; set; }
        /// <summary>3rd Schedule retail price (MRP × qty) — required for "3rd Schedule Goods" sale type.</summary>
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }
    }

    /// <summary>
    /// DTO for the "Create Bill Without Challan" flow. Mirrors
    /// <see cref="CreateInvoiceDto"/> but drops the ChallanIds requirement
    /// and lets the operator type each line directly. Used for FBR-only
    /// flows where no delivery challan was issued (service invoices,
    /// retail sales, ad-hoc billing).
    ///
    /// Bill numbering shares the regular sequence (not IsDemo) so it
    /// flows through the same Bills page, FBR Validate / Submit, and
    /// Item Rate History as challan-linked bills.
    /// </summary>
    public class CreateStandaloneInvoiceDto
    {
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }
        public int ClientId { get; set; }
        public decimal GSTRate { get; set; }
        public string? PaymentTerms { get; set; }
        /// <summary>FBR document type: 4 = Sale Invoice (default), 9 = Debit Note, 10 = Credit Note.</summary>
        public int? DocumentType { get; set; }
        /// <summary>Optional payment mode (Cash / Credit / Bank Transfer / Cheque / Online).</summary>
        public string? PaymentMode { get; set; }
        /// <summary>
        /// FBR scenario code (SN001 / SN002 / SN008 / SN026 / SN027 / SN028 / etc).
        /// When set, the server prepends "[SNxxx] " to PaymentTerms so that
        /// FbrService routes the bill to the correct scenarioId at submit time.
        /// Optional — bills without a scenario tag rely on auto-detection from
        /// items.
        /// </summary>
        public string? ScenarioId { get; set; }
        public List<CreateStandaloneInvoiceItemDto> Items { get; set; } = new();
    }

    public class CreateStandaloneInvoiceItemDto
    {
        /// <summary>Free-text item description (typed by operator or picked from autocomplete).</summary>
        public string Description { get; set; } = "";
        /// <summary>Quantity. Server-side decimal-quantity validation applies based on the picked UOM.</summary>
        public decimal Quantity { get; set; }
        /// <summary>Unit of measure (e.g. "Pcs", "KG"). Either typed or inherited from the picked ItemType.</summary>
        public string? UOM { get; set; }
        public decimal UnitPrice { get; set; }
        /// <summary>Optional ItemType (FBR catalog) link — when set, server re-derives HS / UOM / SaleType / FbrUOMId from the catalog.</summary>
        public int? ItemTypeId { get; set; }
        public string? HSCode { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public int? RateId { get; set; }
        /// <summary>3rd Schedule retail price (MRP × qty) — required for SN008 / SN027.</summary>
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }
        /// <summary>SRO Schedule reference — required for non-18 % rates (SN028, FBR rule 0077).</summary>
        public string? SroScheduleNo { get; set; }
        /// <summary>Serial number within the referenced SRO/Schedule — required when SroScheduleNo is set (FBR rule 0078).</summary>
        public string? SroItemSerialNo { get; set; }
    }

    /// <summary>
    /// Request to reverse an FBR-submitted invoice by auto-generating the
    /// correct adjustment note (Credit Note for a return/reversal — the usual
    /// case — or Debit Note for an upward correction). The generated note is
    /// created UNSUBMITTED so the operator can Validate it, then Submit it to
    /// FBR exactly like an ordinary invoice.
    /// </summary>
    public class CreateReversalNoteDto
    {
        /// <summary>
        /// FBR reason for the note (e.g. "Goods Returned", "Order Cancellation",
        /// "Post-Sale Discount", "Others"). Required by FBR (0027).
        /// </summary>
        public string? Reason { get; set; }

        /// <summary>Free-text remarks — required by FBR when <see cref="Reason"/> is "Others" (0028).</summary>
        public string? Remarks { get; set; }

        /// <summary>
        /// Optional override of the auto-detected note type: 10 = Credit Note
        /// (reversal / return), 9 = Debit Note (upward correction). When null,
        /// a full reversal defaults to a Credit Note.
        /// </summary>
        public int? DocumentType { get; set; }
    }

    /// <summary>
    /// Manual Credit / Debit Note creation referencing an existing FBR-submitted
    /// invoice. Supports PARTIAL notes: when <see cref="Lines"/> is non-empty,
    /// only the listed lines (at the given return quantities) are included;
    /// when empty, the whole invoice is reversed. The note is created
    /// UNSUBMITTED so it can be validated then submitted to FBR.
    /// </summary>
    public class CreateNoteDto
    {
        /// <summary>The FBR-submitted invoice this note references.</summary>
        public int OriginalInvoiceId { get; set; }
        /// <summary>
        /// 10 = CREDIT NOTE — the return / reversal / reduction document
        /// (goods returned, cancellation, post-sale discount). 9 = DEBIT NOTE
        /// — the upward adjustment (undercharge, rate change, extra goods).
        /// Each type runs its own numbering sequence.
        /// </summary>
        public int DocumentType { get; set; } = 10;
        /// <summary>
        /// FBR reason — one of IRIS's enumerated values: "Cancellation of
        /// supply", "Return of goods", "Change in nature of supply", "Change
        /// in value of supply", "Change in amount of tax", "Others",
        /// "Adjustment given to Steel Melters". Required (0027).
        /// </summary>
        public string? Reason { get; set; }
        /// <summary>Remarks — required when <see cref="Reason"/> is "Others" (0028).</summary>
        public string? Remarks { get; set; }
        /// <summary>
        /// Whether the note moves inventory (Credit Note → stock IN, Debit
        /// Note → stock OUT). Null = derive from the reason: goods-moving
        /// reasons ("Return of goods", "Cancellation of supply") default
        /// true for credit notes; value-only reasons default false.
        /// </summary>
        public bool? AffectsStock { get; set; }
        /// <summary>
        /// Optional note date. Defaults to today, clamped to be ≥ the original
        /// invoice date. FBR also enforces a 180-day ceiling (0034) at submit.
        /// </summary>
        public DateTime? Date { get; set; }
        /// <summary>
        /// Line selection for a PARTIAL note. Empty = full reversal of every
        /// line. Each entry names an original InvoiceItem and the quantity to
        /// return/adjust (capped at the original line's quantity).
        /// </summary>
        public List<NoteLineDto> Lines { get; set; } = new();
    }

    public class NoteLineDto
    {
        /// <summary>Id of the line on the ORIGINAL invoice being returned/adjusted.</summary>
        public int InvoiceItemId { get; set; }
        /// <summary>Quantity to return/adjust on this line (must be &gt; 0 and ≤ the original line quantity).</summary>
        public decimal Quantity { get; set; }
        /// <summary>
        /// DEBIT NOTES ONLY: optional per-unit value for the adjustment — an
        /// undercharge note carries the price DELTA per unit rather than the
        /// original price. Ignored on credit notes (refunds are always at the
        /// original invoice rate, per FBR 0068).
        /// </summary>
        public decimal? UnitPrice { get; set; }
    }

    /// <summary>
    /// DTO for editing an existing invoice (bill) before FBR submission.
    /// Users can update prices, descriptions, GST rate, FBR fields, and even
    /// quantity if an item's source challan item was also updated.
    /// </summary>
    public class UpdateInvoiceDto
    {
        /// <summary>
        /// Optional new bill date. When null, the existing date is preserved.
        /// FBR rejects future dates with [0043], so the service caps this at
        /// today (UTC) before persisting.
        /// </summary>
        public DateTime? Date { get; set; }
        public decimal GSTRate { get; set; }
        public string? PaymentTerms { get; set; }
        public int? DocumentType { get; set; }
        public string? PaymentMode { get; set; }
        /// <summary>
        /// Optional new buyer. Only honoured on STANDALONE bills (those with
        /// no linked DeliveryChallan) — challan-linked bills inherit the buyer
        /// from the challan and changing it would put the bill out of sync
        /// with the source challan, so the service rejects the change.
        /// When null, the existing client is preserved.
        /// </summary>
        public int? ClientId { get; set; }
        public List<UpdateInvoiceItemDto> Items { get; set; } = new();
    }

    public class UpdateInvoiceItemDto
    {
        public int Id { get; set; }  // 0 for new items, >0 for existing
        public int? DeliveryItemId { get; set; }
        /// <summary>
        /// When set, the server re-derives HS Code / UOM / Sale Type / FbrUOMId
        /// from this ItemType — overriding whatever was on the line before.
        /// The UOM/HSCode/SaleType fields in this DTO are ignored when ItemTypeId is set.
        /// </summary>
        public int? ItemTypeId { get; set; }
        public string Description { get; set; } = "";
        // Decimal — see InvoiceItemDto.Quantity for the formatting contract.
        public decimal Quantity { get; set; }
        public string UOM { get; set; } = "";
        public decimal UnitPrice { get; set; }
        public string? HSCode { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public int? RateId { get; set; }
        /// <summary>3rd Schedule retail price (MRP × qty) — required for "3rd Schedule Goods" sale type.</summary>
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }
        /// <summary>SRO Schedule reference — required when rate ≠ 18 % per FBR rule 0077.</summary>
        public string? SroScheduleNo { get; set; }
        /// <summary>Serial number within the referenced SRO/Schedule — FBR rule 0078.</summary>
        public string? SroItemSerialNo { get; set; }
    }

    /// <summary>
    /// Narrow edit DTO for the `invoices.manage.update.itemtype` and
    /// `invoices.manage.update.itemtype.qty` flows.
    ///
    /// Default flow (.itemtype): the operator can change which ItemType
    /// each existing line points at; the service re-derives HS Code /
    /// UOM / Sale Type / FbrUOMId from the catalog. Quantity is ignored
    /// even if sent.
    ///
    /// Superset flow (.itemtype.qty): same as above, plus the Quantity
    /// field is honoured. Server-side validation still rejects fractional
    /// qty for integer-only UOMs.
    ///
    /// No other field on the bill can be changed via either path.
    /// </summary>
    public class UpdateInvoiceItemTypesDto
    {
        public List<UpdateInvoiceItemTypeRow> Items { get; set; } = new();

        /// <summary>
        /// Dual-book mode flag (2026-05-11):
        ///   • "bill" (default) — every honoured field on each row is
        ///     written directly to the underlying InvoiceItem. The
        ///     bill print and the FBR view both see the new values.
        ///     This is how Bill mode saves work.
        ///   • "adjustment" — InvoiceItem stays UNTOUCHED. Any field
        ///     that diverges from InvoiceItem is recorded on an
        ///     InvoiceItemAdjustment overlay (upserted). If a row's
        ///     values match InvoiceItem, any existing overlay for it
        ///     is deleted (operator reverted). This is how Invoice
        ///     mode saves work — the printed bill stays at real
        ///     qty/price while the FBR claim sees the optimized
        ///     decomposition.
        /// Honoured only on the <c>.qty</c> endpoint. The plain
        /// <c>.itemtype</c> endpoint always behaves like "bill".
        /// </summary>
        public string? WriteMode { get; set; }
    }

    public class UpdateInvoiceItemTypeRow
    {
        public int Id { get; set; }                  // existing InvoiceItem.Id
        public int? ItemTypeId { get; set; }         // null clears the link
        /// <summary>
        /// Optional quantity update. Honoured ONLY when the controller
        /// is the .qty endpoint (gated by invoices.manage.update.itemtype.qty);
        /// silently ignored on the plain .itemtype endpoint to keep that
        /// flow strictly to type re-classification.
        /// </summary>
        public decimal? Quantity { get; set; }
        /// <summary>
        /// Optional unit-price update. Honoured ONLY on the .qty path
        /// (same gate as Quantity). The service then enforces a total-
        /// preservation rule: Σ (qty × unitPrice) across the new lines
        /// must equal the bill's original Subtotal within a small
        /// tolerance (configurable, default 2 PKR). This lets the
        /// operator re-distribute quantities and prices across lines
        /// (a common move during FBR classification — splitting one
        /// purchase into multiple HS-coded lines) without changing the
        /// total amount the buyer was actually billed.
        /// </summary>
        public decimal? UnitPrice { get; set; }
    }

    /// <summary>
    /// One row in the Item Rate History view — a flattened InvoiceItem
    /// projection that lets the operator answer "what rate did I bill for
    /// this item last time, and to whom". The grid groups rows by item but
    /// each row is a single bill-line snapshot.
    /// </summary>
    public class ItemRateHistoryRowDto
    {
        public int InvoiceItemId { get; set; }
        public int InvoiceId { get; set; }
        public int InvoiceNumber { get; set; }
        public DateTime Date { get; set; }
        public int ClientId { get; set; }
        public string ClientName { get; set; } = "";
        public int? ItemTypeId { get; set; }
        public string ItemTypeName { get; set; } = "";
        public string Description { get; set; } = "";
        // Decimal — Item Rate History row mirrors InvoiceItem precision.
        public decimal Quantity { get; set; }
        public string UOM { get; set; } = "";
        public decimal UnitPrice { get; set; }
        public decimal LineTotal { get; set; }
    }

    /// <summary>
    /// Aggregate response for the Item Rate History page — paged rows plus
    /// a summary band (count / avg / min / max rate) computed across the
    /// FULL filtered set (not just the current page) so the operator sees
    /// the rate band at a glance.
    /// </summary>
    public class ItemRateHistoryResultDto
    {
        public List<ItemRateHistoryRowDto> Items { get; set; } = new();
        public int TotalCount { get; set; }
        public int Page { get; set; }
        public int PageSize { get; set; }
        public decimal? AvgUnitPrice { get; set; }
        public decimal? MinUnitPrice { get; set; }
        public decimal? MaxUnitPrice { get; set; }
    }

    /// <summary>
    /// Most-recent unit price for a single delivery-item, used to pre-fill
    /// the InvoiceForm when the operator clicks "Generate Bill" on a
    /// challan card. Matching strategy: prefer the item's catalog ItemTypeId,
    /// fall back to exact case-insensitive Description match.
    /// </summary>
    public class LastRateDto
    {
        public int DeliveryItemId { get; set; }
        public decimal? LastUnitPrice { get; set; }
        public int? LastInvoiceNumber { get; set; }
        public DateTime? LastInvoiceDate { get; set; }
        public string? LastClientName { get; set; }
        /// <summary>
        /// Source of the match: "ItemType" (matched by catalog id) or
        /// "Description" (fallback). Surfaced to the UI so the operator
        /// can judge how trustworthy the suggested rate is.
        /// </summary>
        public string? MatchedBy { get; set; }
    }
}

using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IInvoiceService
    {
        Task<List<InvoiceDto>> GetByCompanyAsync(int companyId);
        /// <summary>
        /// Paged list. <paramref name="noteType"/> selects the document group:
        /// null (default) = sale bills only; 9 = Debit Notes; 10 = Credit
        /// Notes. The three groups run separate numbering sequences and are
        /// never mixed in one list.
        /// </summary>
        Task<PagedResult<InvoiceDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, int? clientId = null,
            DateTime? dateFrom = null, DateTime? dateTo = null,
            int? noteType = null, int? divisionId = null);
        Task<InvoiceDto?> GetByIdAsync(int id);
        Task<InvoiceDto> CreateAsync(CreateInvoiceDto dto);
        /// <summary>
        /// Create a bill WITHOUT a linked delivery challan — for FBR-only
        /// flows (service invoices, retail sales, ad-hoc billing) where a
        /// challan wasn't issued. Bill numbering shares the regular
        /// sequence; the bill flows through the same Bills page, FBR
        /// Validate / Submit, and Item Rate History as challan-linked
        /// bills.
        /// </summary>
        Task<InvoiceDto> CreateStandaloneAsync(CreateStandaloneInvoiceDto dto);
        Task<InvoiceDto?> UpdateAsync(int id, UpdateInvoiceDto dto);
        /// <summary>
        /// Narrow update path: re-derives FBR fields (HS / UOM / SaleType)
        /// from a new ItemType per line. Refuses to change price, description,
        /// header fields, etc.
        ///
        /// Permission flows (controller picks the flag based on which
        /// endpoint the request hit):
        ///   • allowQuantityEdit=false → invoices.manage.update.itemtype
        ///       (Item Type only — qty in payload is ignored)
        ///   • allowQuantityEdit=true  → invoices.manage.update.itemtype.qty
        ///       (Item Type + Quantity, with decimal validation)
        /// </summary>
        Task<InvoiceDto?> UpdateItemTypesAsync(int id, UpdateInvoiceItemTypesDto dto, bool allowQuantityEdit = false, string? actorUserName = null);
        Task<bool> DeleteAsync(int id);
        /// <summary>
        /// Void (cancel) a bill that has NOT been submitted to FBR. The bill
        /// keeps its InvoiceNumber (so the sequence stays gap-free), is
        /// flagged cancelled (excluded from KPIs, locked from edits/FBR), and
        /// its linked delivery challans are released back to a billable state
        /// so they can be re-billed. Throws if the bill is already submitted
        /// to FBR (use a Credit Note instead) or already cancelled. Returns
        /// the updated bill, or null if not found.
        /// </summary>
        Task<InvoiceDto?> CancelAsync(int id, string? reason, string? actorUserName = null);
        /// <summary>
        /// Reverse an FBR-SUBMITTED invoice by auto-generating the correct
        /// adjustment note as a new, UNSUBMITTED invoice row:
        ///   • Credit Note (DocumentType 10) for a return/reversal — the usual
        ///     case, reduces output tax — or Debit Note (9) when
        ///     <paramref name="documentTypeOverride"/> forces an upward
        ///     correction.
        /// The note copies the original's buyer, GST rate, and line items,
        /// references the original's IRN (OriginalInvoiceRefIRN), and lands in
        /// the Bills list so the operator can Validate then Submit it to FBR
        /// exactly like an ordinary invoice.
        ///
        /// Throws InvalidOperationException if the original isn't FBR-submitted,
        /// has no IRN, or already has a live (non-cancelled) note against it
        /// (FBR 0064 — one credit note per invoice). Returns null if not found.
        /// </summary>
        Task<InvoiceDto?> CreateReversalNoteAsync(int originalInvoiceId, string? reason, string? remarks, int? documentTypeOverride = null, string? actorUserName = null);
        /// <summary>
        /// General Credit/Debit Note creation referencing an FBR-submitted
        /// invoice. Supports PARTIAL notes (a subset of lines / reduced
        /// quantities) via <see cref="CreateNoteDto.Lines"/>; an empty line list
        /// means a full reversal. Same guards and FBR flow as
        /// <see cref="CreateReversalNoteAsync"/> (which delegates here).
        /// </summary>
        Task<InvoiceDto?> CreateNoteAsync(CreateNoteDto dto, string? actorUserName = null);
        /// <summary>
        /// Flip the IsFbrExcluded flag. Excluded bills are skipped by the
        /// bulk Validate All / Submit All endpoints; per-bill validate and
        /// submit still work. Returns the updated bill or null if not found.
        /// </summary>
        Task<InvoiceDto?> SetFbrExcludedAsync(int id, bool excluded);
        /// <summary>Set (or clear, when null) the invoice's payment due date —
        /// drives the Overdue/Coming-due status (design §11.5). Returns the
        /// updated invoice or null if not found.</summary>
        Task<InvoiceDto?> SetDueDateAsync(int id, DateTime? dueDate);
        Task<PrintBillDto?> GetPrintBillAsync(int invoiceId);
        Task<PrintTaxInvoiceDto?> GetPrintTaxInvoiceAsync(int invoiceId);
        Task<int> GetTotalCountAsync();
        Task<int> GetCountByCompanyAsync(int companyId);
        Task<Dictionary<int, int>> GetInvoiceCountsByClientAsync(int companyId);
        /// <summary>
        /// Flat InvoiceItem search across a company's billing history. Powers
        /// the Item Rate History page — given an item (by catalog id or free
        /// text), return every bill line where it appeared, with bill number,
        /// date, client, qty, unit price, and total. The result also carries
        /// avg/min/max unit price across the full filtered set so the
        /// operator can see the rate band before quoting.
        /// </summary>
        Task<ItemRateHistoryResultDto> GetItemRateHistoryAsync(
            int companyId, int page, int pageSize,
            int? itemTypeId, string? search,
            int? clientId, DateTime? dateFrom, DateTime? dateTo);

        /// <summary>
        /// For each item in the given challan, look up the most-recent
        /// non-demo bill line that billed the same product and return its
        /// unit price + bill number + date. Powers the "auto-fill rates"
        /// behaviour on the Generate-Bill shortcut. Match precedence:
        ///   1. Same ItemTypeId (precise)
        ///   2. Same Description, case-insensitive (fallback)
        /// Items without a match are returned with null values so the UI
        /// can leave them blank for the operator to enter manually.
        /// </summary>
        Task<List<LastRateDto>> GetLastRatesForChallanAsync(int companyId, int challanId);

        /// <summary>
        /// Sale bills with at least one HSCode-empty line that still has
        /// remaining qty to procure. Drives the "pick a sale bill" step of
        /// the Purchase Against Sale Bill flow.
        /// </summary>
        Task<List<AwaitingPurchaseInvoiceDto>> GetAwaitingPurchaseAsync(int companyId);

        /// <summary>
        /// Per-line procurement template for one sale bill — the lines
        /// missing HSCode plus their sold/procured/remaining qty.
        /// </summary>
        Task<PurchaseTemplateDto?> GetPurchaseTemplateAsync(int invoiceId);
    }
}

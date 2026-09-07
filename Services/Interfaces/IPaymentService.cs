using MyApp.Api.DTOs;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>Receipts (money in) + Payments (money out) — the AR/AP payment
    /// subledger that produces invoice/bill balance-due and payment status
    /// (design §11.5, Phase A: no GL dependency).</summary>
    public interface IPaymentService
    {
        Task<PagedResult<PaymentDto>> GetPagedByCompanyAsync(
            int companyId, PaymentDirection direction, int page, int pageSize,
            string? search = null, int? contactId = null,
            DateTime? dateFrom = null, DateTime? dateTo = null);

        Task<PaymentDto?> GetByIdAsync(int id);

        /// <summary>Payments/receipts that settled a given invoice / bill — for
        /// the document-detail allocations panel.</summary>
        Task<List<PaymentDto>> GetByInvoiceAsync(int companyId, int invoiceId);
        Task<List<PaymentDto>> GetByPurchaseBillAsync(int companyId, int purchaseBillId);

        /// <summary>Create a receipt/payment with its allocation lines, allocate
        /// its number, and recompute the touched invoices'/bills' AmountPaid —
        /// all in one transaction. Throws InvalidOperationException on validation
        /// failures (bad allocation, cross-tenant link, over-allocation).</summary>
        Task<PaymentDto> CreateAsync(int companyId, CreatePaymentDto dto);

        /// <summary>Full edit of a receipt/payment: replace header fields +
        /// allocation lines, keeping its Number/Direction. Re-validates (cross-
        /// tenant, over-allocation excluding this payment) and reflows the
        /// AmountPaid of every document it used to touch AND now touches.
        /// Returns null if not found.</summary>
        Task<PaymentDto?> UpdateAsync(int id, CreatePaymentDto dto);

        /// <summary>Delete a payment (its allocations cascade) and recompute the
        /// previously-settled invoices'/bills' AmountPaid. Returns false if not found.</summary>
        Task<bool> DeleteAsync(int id);

        /// <summary>Apply part of a receipt's unallocated balance (the customer's
        /// advance) to one or more invoices. Only a non-cancelled Receipt may be
        /// allocated. Reuses the create/update-path guards (cross-tenant, over-
        /// allocation) and re-posts the GL so the advance leg shrinks by exactly
        /// what A/R gains. Returns null if the payment is not found.</summary>
        Task<PaymentDto?> AllocateAsync(int paymentId, List<CreatePaymentAllocationDto> lines);

        /// <summary>What FIFO auto-allocation WOULD do with a given amount for
        /// a given customer, without writing anything: oldest invoice first,
        /// each filled to its balance, the rest left as an advance. Feeds the
        /// receipt form so the proposal can be edited before it is saved.</summary>
        Task<AllocationPlanDto> PlanClientAllocationAsync(int companyId, int clientId, decimal available);

        /// <summary>Spread a receipt's still-unallocated cash across its
        /// customer outstanding invoices, oldest first, and apply it. Delegates
        /// to AllocateAsync, so every guard and the GL posting are the shared
        /// ones. Returns null if the receipt is not found.</summary>
        Task<PaymentDto?> AutoAllocateAsync(int paymentId);

        /// <summary>Apply every advance a customer is sitting on to their
        /// outstanding invoices, oldest receipt first. Each receipt is applied
        /// in its own transaction; one that cannot be is reported and skipped.</summary>
        Task<AdvanceSweepResultDto> ApplyClientAdvancesAsync(int companyId, int clientId);
        /// <summary>Advance a cheque's lifecycle (Pending → Deposited → Cleared /
        /// Bounced) without a full document edit — the PDC register action.</summary>
        Task<PaymentDto?> SetChequeStatusAsync(int id, string status);

        Task<PrintPaymentVoucherDto?> GetPrintDataAsync(int id);
    }
}

using MyApp.Api.DTOs;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>Receipts (money in) + Payments (money out) — the AR/AP payment
    /// subledger that produces invoice/bill balance-due and payment status
    /// (GL-free port).</summary>
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

        /// <summary>Advance a cheque's lifecycle (Pending → Deposited → Cleared /
        /// Bounced) without a full document edit — the PDC register action.</summary>
        Task<PaymentDto?> SetChequeStatusAsync(int id, string status);

        Task<PrintPaymentVoucherDto?> GetPrintDataAsync(int id);
    }
}

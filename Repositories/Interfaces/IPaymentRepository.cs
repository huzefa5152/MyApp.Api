using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IPaymentRepository
    {
        Task<(List<Payment> Items, int TotalCount)> GetPagedByCompanyAsync(
            int companyId, PaymentDirection direction, int page, int pageSize,
            string? search = null, int? contactId = null,
            DateTime? dateFrom = null, DateTime? dateTo = null);

        /// <summary>Single payment with its allocation lines (and the linked
        /// invoice/bill for numbering) — tracked, for edits/deletes.</summary>
        Task<Payment?> GetByIdAsync(int id);

        /// <summary>All non-cancelled payments (company-scoped) whose allocations
        /// settle one invoice/bill, for the document-detail "Payments/Receipts"
        /// panel. Company-scoped so a cross-tenant id can't enumerate payments.</summary>
        Task<List<Payment>> GetByInvoiceAsync(int companyId, int invoiceId);
        Task<List<Payment>> GetByPurchaseBillAsync(int companyId, int purchaseBillId);

        /// <summary>Highest Number within a (company, direction) sequence.</summary>
        Task<int> GetMaxNumberAsync(int companyId, PaymentDirection direction);

        Task DeleteAsync(Payment payment);
    }
}

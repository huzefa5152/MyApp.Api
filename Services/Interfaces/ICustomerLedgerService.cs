using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// The single implementation of a customer's money trail. Everything is
    /// DERIVED from live documents (invoices, credit/debit notes, receipts and
    /// their settle-remainder adjustments) — nothing is persisted, so the
    /// ledger can never drift from the documents it reports.
    ///
    /// Replaces the trail that used to live in
    /// <c>ClientService.GetStatementAsync</c>, which now delegates here. That
    /// version had four defects this one does not inherit:
    ///   1. credit and debit notes were excluded entirely;
    ///   2. it credited only <c>PaymentAllocation.Amount</c> while
    ///      <c>Invoice.AmountPaid</c> counts <c>Amount + AdjustmentAmount</c>, so
    ///      any settle-remainder write-off left the closing balance disagreeing
    ///      with A/R;
    ///   3. a hard 200-row cap with no paging;
    ///   4. no date range and therefore no opening balance.
    ///
    /// Cash and settlement are deliberately NOT conflated: an allocation settles
    /// <c>Amount + AdjustmentAmount</c> against the INVOICE, but only
    /// <c>Amount</c> is spent from the RECEIPT. Receipts therefore appear at
    /// their full <c>Payment.Amount</c> so unallocated cash — a customer advance
    /// — shows in the trail, which is exactly what the old statement missed.
    ///
    /// Every query filters on BOTH <c>CompanyId</c> and the client; a
    /// caller-supplied client id is always resolved inside the company first.
    /// </summary>
    public interface ICustomerLedgerService
    {
        /// <summary>
        /// Chronological trail for one customer, newest-first, with a running
        /// balance in the workbook convention (see <see cref="CustomerLedgerEntryDto"/>).
        /// </summary>
        /// <param name="from">Inclusive window start. Everything strictly before
        /// it collapses into <c>OpeningBalance</c>. Null = all of history.</param>
        /// <param name="to">Inclusive window end (date-granular). Null = up to now.</param>
        /// <param name="type">Optional DISPLAY filter on
        /// <see cref="CustomerLedgerEntryDto.Type"/>; it never changes a row's
        /// balance or the closing figure.</param>
        /// <exception cref="InvalidOperationException">The client does not exist
        /// in this company.</exception>
        Task<CustomerLedgerDto> GetForClientAsync(
            int companyId, int clientId, DateTime? from, DateTime? to,
            string? type, int page, int pageSize);

        /// <summary>
        /// Per-customer aggregates for one company, rolled up by
        /// <c>ClientGroupId ?? -ClientId</c>. Ordered by closing balance
        /// descending (biggest debtor first).
        /// </summary>
        Task<List<CustomerLedgerRowDto>> GetAllCustomersAsync(
            int companyId, DateTime? from, DateTime? to);
    }
}

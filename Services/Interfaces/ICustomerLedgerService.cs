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
    /// Cash reaches a customer's trail from TWO sources, and a payment uses
    /// exactly one of them (the de-duplication rule, spelled out at the query
    /// site): the receipt whose CONTACT is this customer contributes its full
    /// amount, while a receipt naming a different contact contributes only the
    /// allocations that settle THIS customer's invoices. The second source
    /// matters because <c>PaymentService</c> only checks that an allocation's
    /// invoice shares the COMPANY, never the contact.
    ///
    /// KNOWN LIMITATION (accepted 2026-08-30, inherited — not a regression):
    /// invoices are charged at full <c>GrandTotal</c>, but
    /// <c>Invoice.BalanceDue</c> settles against
    /// <c>Collectible = GrandTotal − WithholdingTaxAmount</c>. Where withholding
    /// tax applies, this ledger overstates A/R by the withheld slice and the
    /// closing balance will not equal <c>BalanceDue</c>.
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
        /// <param name="pageSize">Nullable so an omitted value falls back to the
        /// service default of 50 rather than clamping to 1 — see
        /// <see cref="MyApp.Api.Helpers.PaginationHelper.Clamp"/>, whose default
        /// only applies when the caller passes nothing at all.</param>
        /// <exception cref="InvalidOperationException">The client does not exist
        /// in this company.</exception>
        Task<CustomerLedgerDto> GetForClientAsync(
            int companyId, int clientId, DateTime? from, DateTime? to,
            string? type, int page, int? pageSize);

        /// <summary>
        /// Per-customer aggregates for one company, rolled up by
        /// <c>ClientGroupId ?? -ClientId</c>. Ordered by closing balance
        /// descending (biggest debtor first).
        /// </summary>
        Task<List<CustomerLedgerRowDto>> GetAllCustomersAsync(
            int companyId, DateTime? from, DateTime? to);
    }
}

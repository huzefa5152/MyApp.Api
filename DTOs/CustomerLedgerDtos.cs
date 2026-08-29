using System;
using System.Collections.Generic;

namespace MyApp.Api.DTOs
{
    /// <summary>
    /// One row of a customer's money-in / money-out trail.
    ///
    /// COLUMN CONVENTION (user decision, 2026-08-30) — this product follows the
    /// operator's own workbook, which is the MIRROR of the textbook A/R
    /// presentation:
    ///   • Invoice / Debit Note                → <see cref="Credit"/>
    ///   • Receipt / Credit Note / Adjustment  → <see cref="Debit"/>
    ///   • Balance = Opening + Σ Credit − Σ Debit
    /// A POSITIVE balance means the customer owes us; NEGATIVE means they hold
    /// an advance. Verified against the client's workbook: opening 355,525 →
    /// invoice Credit 862,261 → 1,217,786 → payment Debit 343,536 → 874,250.
    ///
    /// This is PRESENTATION ONLY. The general ledger is untouched: an invoice
    /// still posts Dr Accounts Receivable / Cr Income + Cr Output Tax and a
    /// credit note still reverses it (see <c>PostingService</c>), so the trial
    /// balance, aged receivables and the customer portal are unaffected.
    /// </summary>
    public class CustomerLedgerEntryDto
    {
        public DateTime Date { get; set; }

        /// <summary>"Invoice" | "Debit Note" | "Credit Note" | "Receipt" | "Adjustment".</summary>
        public string Type { get; set; } = "";

        /// <summary>Human reference, e.g. "INV-6185" / "CN-12" / "RCP-696".</summary>
        public string Reference { get; set; } = "";

        /// <summary>Underlying document id — the invoice id for a document row,
        /// the PAYMENT id for a receipt or an adjustment (never the allocation
        /// id, so the UI can always deep-link to something the operator can open).</summary>
        public int? DocId { get; set; }

        public string? Description { get; set; }

        /// <summary>Receipts only: "Cash" | "Bank Transfer" | "Cheque" | …</summary>
        public string? Method { get; set; }

        /// <summary>Receipts only: bank/cash account the money landed in.</summary>
        public string? BankAccount { get; set; }

        /// <summary>Reduces what the customer owes — receipts, credit notes,
        /// settle-remainder adjustments. See the type-level convention note.</summary>
        public decimal Debit { get; set; }

        /// <summary>Increases what the customer owes — invoices and debit notes.
        /// See the type-level convention note.</summary>
        public decimal Credit { get; set; }

        /// <summary>Running balance as of this entry, in date order. Always
        /// computed over EVERY entry in the date window — a <c>type</c> filter
        /// hides rows, it never re-bases the balance.</summary>
        public decimal Balance { get; set; }
    }

    /// <summary>A customer's complete derived ledger for a date window.</summary>
    public class CustomerLedgerDto
    {
        public int ClientId { get; set; }
        public string ClientName { get; set; } = "";

        /// <summary>Net position carried in from strictly before <c>from</c>.
        /// 0 when no <c>from</c> was supplied (the window is all of history).</summary>
        public decimal OpeningBalance { get; set; }

        /// <summary>Net position at the end of the window. Positive = the
        /// customer owes; negative = they are in advance.</summary>
        public decimal ClosingBalance { get; set; }

        /// <summary>The owed part of <see cref="ClosingBalance"/> (0 when in advance).</summary>
        public decimal Outstanding { get; set; }

        /// <summary>The advance part of <see cref="ClosingBalance"/>, as a positive
        /// number (0 when the customer owes).</summary>
        public decimal Advance { get; set; }

        /// <summary>Σ of the Credit column in the window (invoices + debit notes).</summary>
        public decimal TotalCredit { get; set; }

        /// <summary>Σ of the Debit column in the window (receipts + credit notes + adjustments).</summary>
        public decimal TotalDebit { get; set; }

        /// <summary>Entries matching the window AND the optional type filter,
        /// before paging.</summary>
        public int Total { get; set; }

        public int Page { get; set; }
        public int PageSize { get; set; }

        /// <summary>Newest-first page of the trail. Each row still carries its
        /// true chronological running balance.</summary>
        public List<CustomerLedgerEntryDto> Entries { get; set; } = new();
    }

    /// <summary>
    /// Per-customer aggregate for the "all customers" ledger summary. Rows are
    /// rolled up by <c>Client.ClientGroupId ?? -ClientId</c>, the same identity
    /// the dashboard uses (<c>DashboardService.ComputeSalesAsync</c>), so the
    /// same legal entity never appears twice.
    /// </summary>
    public class CustomerLedgerRowDto
    {
        /// <summary>Lowest client id in the group — the row's stable handle.</summary>
        public int ClientId { get; set; }
        public string ClientName { get; set; } = "";

        /// <summary>Net position carried in from before the window.</summary>
        public decimal Opening { get; set; }

        /// <summary>Σ Credit column in the window — invoices + debit notes.</summary>
        public decimal Invoiced { get; set; }

        /// <summary>Σ Debit column in the window — receipt cash + credit notes +
        /// settle-remainder adjustments. Named for the dominant case; it is the
        /// exact counterpart of <see cref="Invoiced"/>, so
        /// <c>Closing == Opening + Invoiced − Received</c> always holds.</summary>
        public decimal Received { get; set; }

        public decimal Outstanding { get; set; }
        public decimal Advance { get; set; }
        public decimal Closing { get; set; }
    }
}

using System;
using System.Collections.Generic;

namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Company-wide Client Ledger report — the Reports-module counterpart of
    /// the per-customer Customer Ledger screen. One section per customer, each
    /// reproducing the layout of the workbook the operator already keeps:
    ///
    /// <code>
    /// A1  ALPHA TRADERS                              &lt;- company name
    /// A2  Ledger
    /// A3  Ad Communication                           &lt;- customer name
    /// row 4   E = Opening   F = Σ Debit   G = Σ Credit
    /// row 5   S.No | Date | Inv / Ref | Particulars | Opening | Debit | Credit | Balance
    /// row 6   opening row (seeds the running balance)
    /// row 7+  transactions, H = running balance
    /// </code>
    ///
    /// The source sheets are inconsistent (8 or 10 columns; column C is "Inv"
    /// on some and "Month" on others). This report emits ONE shape: column C is
    /// always the document reference (<see cref="ClientLedgerReportEntryDto.Reference"/>).
    ///
    /// EVERY figure here comes from <c>ICustomerLedgerService</c> — the single
    /// implementation of a customer's money trail. Nothing about the ledger is
    /// re-derived: this report only selects a window, picks which customers to
    /// show, and lays the service's own entries out in workbook order.
    ///
    /// COLUMN CONVENTION (user decision, 2026-08-30) — identical to
    /// <see cref="CustomerLedgerEntryDto"/>, which is the operator's workbook
    /// convention and the MIRROR of the textbook A/R presentation:
    ///   • Invoice / Debit Note                → <c>Credit</c>
    ///   • Receipt / Credit Note / Adjustment  → <c>Debit</c>
    ///   • Balance = Opening + Σ Credit − Σ Debit
    /// A POSITIVE balance means the customer owes us; NEGATIVE means they hold
    /// an advance.
    /// </summary>
    public class ClientLedgerReportDto
    {
        public int CompanyId { get; set; }
        public string CompanyName { get; set; } = "";

        /// <summary>Effective year, or null when a custom range was supplied.</summary>
        public int? Year { get; set; }

        /// <summary>Effective month (1–12), or null for a full year / custom range.</summary>
        public int? Month { get; set; }

        /// <summary>Window start (inclusive). Everything strictly before it is
        /// collapsed into each customer's <see cref="ClientLedgerReportClientDto.Opening"/>.</summary>
        public DateTime DateFrom { get; set; }

        /// <summary>Window end (inclusive, date-granular).</summary>
        public DateTime DateTo { get; set; }

        public string PeriodLabel { get; set; } = "";

        /// <summary>Echo of the optional customer filter, resolved inside the
        /// company. Null = every customer.</summary>
        public int? ClientId { get; set; }

        /// <summary>Name of the filtered customer, when one was requested.</summary>
        public string? ClientName { get; set; }

        /// <summary>One section per customer, biggest closing balance first
        /// (the order <c>ICustomerLedgerService.GetAllCustomersAsync</c> returns).</summary>
        public List<ClientLedgerReportClientDto> Clients { get; set; } = new();

        public int ClientCount { get; set; }
        public int EntryCount { get; set; }

        public decimal GrandOpening { get; set; }
        public decimal GrandDebit { get; set; }
        public decimal GrandCredit { get; set; }
        public decimal GrandClosing { get; set; }
    }

    /// <summary>
    /// One customer's page of the report — the equivalent of a single sheet in
    /// the reference workbook. Rows are rolled up by
    /// <c>Client.ClientGroupId ?? -ClientId</c> (the identity
    /// <c>DashboardService</c> and <c>CustomerLedgerService</c> both use), so a
    /// legal entity carried under more than one customer record appears once.
    /// </summary>
    public class ClientLedgerReportClientDto
    {
        /// <summary>Lowest customer id in the group — the section's stable handle.</summary>
        public int ClientId { get; set; }
        public string ClientName { get; set; } = "";

        /// <summary>Net position carried in from strictly before <c>DateFrom</c>.</summary>
        public decimal Opening { get; set; }

        /// <summary>Σ of the Debit column in the window — receipts, credit
        /// notes and settle-remainder adjustments.</summary>
        public decimal TotalDebit { get; set; }

        /// <summary>Σ of the Credit column in the window — invoices and debit notes.</summary>
        public decimal TotalCredit { get; set; }

        /// <summary>Opening + Σ Credit − Σ Debit. Positive = the customer owes.</summary>
        public decimal Closing { get; set; }

        /// <summary>The owed part of <see cref="Closing"/> (0 when in advance).</summary>
        public decimal Outstanding { get; set; }

        /// <summary>The advance part of <see cref="Closing"/> as a positive
        /// number (0 when the customer owes).</summary>
        public decimal Advance { get; set; }

        /// <summary>The trail, OLDEST-first — workbook reading order, so the
        /// running balance climbs down the page from the opening row.</summary>
        public List<ClientLedgerReportEntryDto> Entries { get; set; } = new();
    }

    /// <summary>One transaction line — workbook columns A..H, minus the
    /// Opening column which only ever carries the seed row's value.</summary>
    public class ClientLedgerReportEntryDto
    {
        /// <summary>Workbook column A. 1-based within the customer's section.</summary>
        public int Sr { get; set; }

        /// <summary>Workbook column B.</summary>
        public DateTime Date { get; set; }

        /// <summary>Workbook column C, normalised. The source sheets label this
        /// "Inv" or "Month" inconsistently; here it is always the document
        /// reference, e.g. "INV-6185" / "CN-12" / "RCP-696".</summary>
        public string Reference { get; set; } = "";

        /// <summary>Workbook column D — type, plus receipt method / bank
        /// account / description when the entry carries them.</summary>
        public string Particulars { get; set; } = "";

        /// <summary>Workbook column F. Receipts, credit notes, adjustments.</summary>
        public decimal Debit { get; set; }

        /// <summary>Workbook column G. Invoices and debit notes.</summary>
        public decimal Credit { get; set; }

        /// <summary>Workbook column H — running balance as of this row.</summary>
        public decimal Balance { get; set; }

        /// <summary>"Invoice" | "Debit Note" | "Credit Note" | "Receipt" |
        /// "Adjustment" — kept so the UI can badge/filter rows.</summary>
        public string Type { get; set; } = "";

        /// <summary>Underlying document id (invoice id, or the PAYMENT id for a
        /// receipt/adjustment) so the UI can deep-link.</summary>
        public int? DocId { get; set; }
    }
}

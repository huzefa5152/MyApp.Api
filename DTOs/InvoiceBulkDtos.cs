namespace MyApp.Api.DTOs
{
    /// <summary>
    /// What the CALLER asks for in a bulk invoice operation: a date window, a
    /// document type, a template choice, and — for an internal caller — the
    /// same list filters the Invoices screen already has.
    ///
    /// It carries NO company, client or invoice identity that grants anything.
    /// <c>ClientId</c> and <c>DivisionId</c> are narrowing FILTERS applied
    /// inside an authorization scope the endpoint builds for itself; the public
    /// portal ignores both. See <c>InvoiceBulkScope</c> for the other half of
    /// the pair — the rule the whole feature rests on is
    ///
    ///     request filters + server-side scope = the final invoice set
    ///
    /// and a filter can only ever make that set smaller.
    /// </summary>
    public class InvoiceBulkRequestDto
    {
        /// <summary>
        /// One of the nine presets <see cref="Helpers.ReportPeriod"/> already
        /// resolves ("thismonth", "lastmonth", "custom", …). Resolved
        /// SERVER-side against the Pakistan business calendar, for the reason
        /// ReportPeriod documents: the browser's clock is not the business's.
        /// Null/unknown degrades to all periods, which the batch cap then
        /// bounds anyway.
        /// </summary>
        public string? Preset { get; set; }

        /// <summary>Only consulted when <see cref="Preset"/> is "custom".</summary>
        public DateTime? DateFrom { get; set; }
        public DateTime? DateTo { get; set; }

        /// <summary>
        /// "TaxInvoice" or "Bill" — which document to produce. These are two
        /// different templates fed by two different print DTOs and are NOT
        /// interchangeable (CLAUDE.md §5c), so the choice picks both together.
        /// </summary>
        public string DocumentType { get; set; } = "TaxInvoice";

        /// <summary>
        /// Null = use each invoice's own company default (the only safe mode
        /// once more than one company is in play — a template row carries its
        /// company's letterhead, logo and stamp). A value pins one template,
        /// and the service refuses it unless it belongs to the scope's company.
        /// </summary>
        public int? TemplateId { get; set; }

        // ── Internal-caller filters. The portal passes none of these. ────────
        public int? ClientId { get; set; }
        public int? DivisionId { get; set; }
        public string? Search { get; set; }
    }

    /// <summary>
    /// Everything the browser needs to render a batch, and nothing it could use
    /// to reach further.
    ///
    /// The template HTML is sent ONCE per distinct template rather than once per
    /// invoice. Measured on this installation: a template is 8.3–14.6 KB and a
    /// Tax Invoice print DTO is ~2–6 KB, so a 200-invoice batch is ~1 MB this
    /// way against ~4 MB with the template repeated — on a public endpoint
    /// behind a 120-request-per-minute limit, that difference is the feature
    /// working or not.
    /// </summary>
    public class InvoiceBulkBatchDto
    {
        /// <summary>Distinct templates referenced by <see cref="Invoices"/>.</summary>
        public List<InvoiceBulkTemplateDto> Templates { get; set; } = new();

        /// <summary>The documents to render, oldest first.</summary>
        public List<InvoiceBulkInvoiceDto> Invoices { get; set; } = new();

        /// <summary>
        /// Invoices inside the window that will NOT be rendered, each with a
        /// reason the operator can act on. Surfaced rather than silently
        /// dropped: "48 matched, 47 rendered" with no explanation is how a
        /// missing template becomes a missing document nobody notices.
        /// </summary>
        public List<InvoiceBulkSkippedDto> Skipped { get; set; } = new();

        /// <summary>How many invoices the window and filters actually matched.</summary>
        public int MatchedCount { get; set; }

        /// <summary>
        /// True when <see cref="MatchedCount"/> exceeded <see cref="Limit"/> and
        /// the batch was cut. The UI must say so — rendering 200 of 1,204 and
        /// calling it "all invoices" is the worst outcome this feature has.
        /// </summary>
        public bool Truncated { get; set; }

        public int Limit { get; set; }

        /// <summary>The resolved window, for the file name and the on-screen label.</summary>
        public DateTime? WindowFrom { get; set; }
        public DateTime? WindowTo { get; set; }
        public string WindowLabel { get; set; } = "";

        /// <summary>
        /// Base name for a ZIP or a consolidated PDF, without extension —
        /// built server-side so both surfaces name their downloads identically.
        /// </summary>
        public string FileNameBase { get; set; } = "";
    }

    public class InvoiceBulkTemplateDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";
        public string HtmlContent { get; set; } = "";

        /// <summary>
        /// Slug → URL for the stamp THIS template references, and nothing else.
        /// Mirrors the single-invoice portal payload: a stamped template must
        /// stay stamped or the customer's copy differs from the office's, but
        /// the company's whole stamp library is never exposed.
        /// </summary>
        public Dictionary<string, string> StampMap { get; set; } = new();
    }

    public class InvoiceBulkInvoiceDto
    {
        /// <summary>The internal sequence number — unique per company.</summary>
        public int InvoiceNumber { get; set; }

        /// <summary>
        /// The company's own reference (<c>InvoiceNumberPrefix</c> + number,
        /// e.g. "PTC-52"). Invoice numbers are unique per COMPANY only, so this
        /// is what keeps two companies' files apart inside one ZIP.
        /// </summary>
        public string? Reference { get; set; }

        public DateTime Date { get; set; }
        public string ClientName { get; set; } = "";
        public int TemplateId { get; set; }

        /// <summary>Per-file name, no extension, already sanitised and de-duplicated.</summary>
        public string FileNameBase { get; set; } = "";

        /// <summary>
        /// The merge data — a <c>PrintTaxInvoiceDto</c> or <c>PrintBillDto</c>,
        /// produced by the SAME InvoiceService methods the single-invoice paths
        /// call. There is no second builder and no bulk-specific shape.
        /// </summary>
        public object PrintData { get; set; } = null!;
    }

    public class InvoiceBulkSkippedDto
    {
        public int InvoiceNumber { get; set; }
        public string? Reference { get; set; }
        public string Reason { get; set; } = "";
    }

    /// <summary>
    /// What the PUBLIC Customer Portal may ask for: a date window, and nothing
    /// else.
    ///
    /// A separate, smaller type from <see cref="InvoiceBulkRequestDto"/> on
    /// purpose. The portal's whole security model is that no public action
    /// accepts a company, client, template or invoice id — so rather than
    /// binding those and validating them away, the fields do not exist on the
    /// wire at all. A customer POSTing <c>clientId</c> or <c>templateId</c> is
    /// not rejected; the value is simply never read, because there is nowhere
    /// for it to land. That is the difference between a check somebody can
    /// forget to write and a shape that cannot express the attack.
    /// </summary>
    public class PortalBulkRequestDto
    {
        public string? Preset { get; set; }
        public DateTime? DateFrom { get; set; }
        public DateTime? DateTo { get; set; }
    }
}

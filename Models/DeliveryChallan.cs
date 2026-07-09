namespace MyApp.Api.Models
{
    public class DeliveryChallan
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        /// <summary>Optional division ("sub-company"); when set the challan numbers
        /// from the division's own sequence. Null = company-level.</summary>
        public int? DivisionId { get; set; }
        public int ChallanNumber { get; set; }

        // Replace old ClientName with ClientId foreign key
        public int ClientId { get; set; }
        public string PoNumber { get; set; } = "";
        public DateTime? PoDate { get; set; }

        // Optional buyer-side indent reference. Some companies don't use
        // indents at all — left null when unused so the print template's
        // {{#if indentNo}} block stays collapsed.
        public string? IndentNo { get; set; }

        public DateTime? DeliveryDate { get; set; }
        public string? Site { get; set; }
        public string Status { get; set; } = "Pending";
        public int? InvoiceId { get; set; }

        // Optional link to the Sales Order this challan fulfils. Null for
        // standalone challans, imported/legacy challans, and any challan
        // created before the Sales Order module — so this is purely additive
        // and never disturbs the existing challan flow. When set, the
        // challan's delivered quantities roll up against the order's ordered
        // quantities for fulfilment tracking.
        public int? SalesOrderId { get; set; }

        // Flag for challans created via the historical Excel import flow.
        // Informational only — MUST NOT gate billing or any core flow; imported
        // challans participate in Bill/Invoice creation just like native ones.
        public bool IsImported { get; set; }

        /// <summary>
        /// True when this challan was created via the FBR Sandbox tab to
        /// support a scenario test bill. Same isolation contract as
        /// <see cref="Invoice.IsDemo"/> — separate number range (900000+),
        /// no main counter bump, filtered out of the regular Challans page.
        /// </summary>
        public bool IsDemo { get; set; }

        // Self-FK to the original challan when this row was created via
        // the "Duplicate" action. Same ChallanNumber as the parent, but a
        // separate billable unit with its own PO/items/InvoiceId. Null
        // for natively-created and imported challans.
        public int? DuplicatedFromId { get; set; }

        // Navigation
        public Company Company { get; set; } = null!;
        public Division? Division { get; set; }
        public Client Client { get; set; } = null!;
        public Invoice? Invoice { get; set; }
        public SalesOrder? SalesOrder { get; set; }
        public DeliveryChallan? DuplicatedFrom { get; set; }
        public ICollection<DeliveryItem> Items { get; set; } = new List<DeliveryItem>();
    }
}

namespace MyApp.Api.Models
{
    public class PrintTemplate
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string TemplateType { get; set; } = ""; // See Helpers/PrintTemplateTypes.All (Challan, Bill, TaxInvoice, SalesQuote, SalesOrder, PurchaseBill, GoodsReceipt, DebitNote, CreditNote, Receipt)

        // Operator-facing name distinguishing multiple templates of the same type
        // within one company (e.g. "Default", "Modern Letterhead").
        public string Name { get; set; } = "Default";

        // Exactly one template per (CompanyId, TemplateType) is the default.
        // Enforced by a filtered unique index in AppDbContext. The print/export
        // paths resolve to this default unless the caller picks a specific template.
        public bool IsDefault { get; set; } = true;

        public string HtmlContent { get; set; } = "";
        public string? TemplateJson { get; set; }
        public string? EditorMode { get; set; }
        public string? ExcelTemplatePath { get; set; }
        // Operator-chosen sheet name on the Excel template. The reverse mapper
        // auto-picks the first sheet with placeholders, but when import files
        // are multi-sheet (e.g. ship with a leading "Settings" tab), the
        // operator can pin this to the data sheet's name so the importer
        // resolves to the right index every time. Null = auto-detect.
        public string? ExcelSheetName { get; set; }

        // The company stamp rendered into this template's {{stamp}} slot.
        // NULL = no signature, which is the state every template created before
        // stamps existed starts in — assignment is always opt-in, never
        // backfilled. Cleared (not cascaded) when the stamp is deleted, so a
        // removed stamp degrades the document to "no signature" rather than
        // leaving a broken image on every print.
        public int? StampId { get; set; }
        public CompanyStamp? Stamp { get; set; }

        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        public Company Company { get; set; } = null!;
    }
}

namespace MyApp.Api.Models
{
    // A verified extraction example tied to a specific POFormat. Used by the
    // regression harness: before any rule-set change is accepted, it's
    // replayed against every golden sample and must produce output that
    // matches ExpectedJson. If even one sample regresses, the update is
    // refused and the old rule-set stays live.
    //
    // ExpectedJson is a compact canonical shape (just PoNumber, PoDate, items
    // with Description+Quantity+Unit) — NOT the full ParsedPODto. This
    // keeps regression checks robust to trivial ordering/formatting drift in
    // warnings/RawText while still catching any real extraction change.
    public class POGoldenSample
    {
        public int Id { get; set; }

        public int POFormatId { get; set; }
        public POFormat? POFormat { get; set; }

        // Human label, e.g. "Soorty PO 21620 (solenoid coil)".
        public string Name { get; set; } = "";

        // Optional PDF bytes — stored so operators can re-render the original
        // alongside the parse output during review. Nullable; tests only need
        // the extracted text.
        public byte[]? PdfBlob { get; set; }

        public string? OriginalFileName { get; set; }

        // PdfPig-extracted text — this is what the fingerprint + rule engine
        // will see at replay time. Persisted verbatim so a future change to
        // the PDF text extractor doesn't silently break the golden set.
        public string RawText { get; set; } = "";

        // JSON-serialized ExpectedResultDto: { poNumber, poDate, items: [{description, quantity, unit}] }
        public string ExpectedJson { get; set; } = "{}";

        public string? Notes { get; set; }

        // "verified" — can be replayed for regression. "pending" — uploaded but
        // not yet confirmed by an operator, so it doesn't gate promotions.
        public string Status { get; set; } = "verified";

        public string? CreatedBy { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}

using QRCoder;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Server-side QR rendering for the FBR Digital Invoicing block on the
    /// Tax Invoice print template. Replaced an earlier &lt;img src="quickchart.io/..."&gt;
    /// dependency that:
    ///   • broke under strict CSP / corporate egress filters
    ///   • leaked the IRN to a third-party URL on every print
    ///   • introduced an async network round-trip in the html2canvas → jsPDF
    ///     pipeline (race conditions where the QR didn't render in PDF)
    /// We now produce a self-contained "data:image/png;base64,..." URI that
    /// the template inlines via {{{fbrQrPngDataUrl}}} (triple braces).
    /// </summary>
    public static class FbrQrCodeGenerator
    {
        /// <summary>
        /// QR payload links to PRAL's public IRN verification page. Operators
        /// scanning the printed invoice get the same source-of-truth view FBR
        /// shows on iris.fbr.gov.pk. Centralised here so a future PRAL URL
        /// change is a one-line edit.
        /// </summary>
        private const string VerifyUrlTemplate =
            "https://iris.fbr.gov.pk/public/di/verify?irn={0}";

        /// <summary>
        /// Returns a base64 PNG data URI for the supplied IRN, or null when
        /// the IRN is blank. PNG is rendered at 6 px/module which produces a
        /// crisp ~160 px QR for typical IRN payloads — small enough to keep
        /// the print DTO under a few KB, big enough that mobile cameras scan
        /// reliably from a paper print.
        /// </summary>
        public static string? BuildVerifyQrDataUrl(string? irn)
        {
            if (string.IsNullOrWhiteSpace(irn)) return null;
            var payload = string.Format(VerifyUrlTemplate, irn);
            using var generator = new QRCodeGenerator();
            // Medium ECC (~15%) — balances payload density vs. resilience to
            // ink smudge on thermal printers. Same level the PRAL portal uses.
            using var qrData = generator.CreateQrCode(payload, QRCodeGenerator.ECCLevel.M);
            var pngQr = new PngByteQRCode(qrData);
            var pngBytes = pngQr.GetGraphic(pixelsPerModule: 6);
            return "data:image/png;base64," + Convert.ToBase64String(pngBytes);
        }
    }
}

using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Data
{
    // Seeds the three baseline PO formats (Lotte Kolson, Soorty, Meko Denim/
    // Fabrics) from the sample PDFs in scripts/. Idempotent per-name —
    // any baseline format that doesn't already exist is inserted. Existing
    // operator-curated formats (different names) are left untouched, and
    // deleting a baseline format from the DB causes it to be re-seeded on
    // the next startup. If the operator has EDITED a baseline format, we
    // preserve their changes (we only insert when the row is missing).
    //
    // All three use the "simple-headers-v1" engine — five label/header
    // strings that tell the parser where to find PO number, PO date and
    // the description / quantity / unit columns. The sample texts below
    // are the ACTUAL PdfPig runtime extractions so the fingerprint hash
    // matches incoming PDFs with the same layout.
    public static class POFormatSeeder
    {
        public static async Task SeedAsync(AppDbContext db, IPOFormatFingerprintService fingerprint)
        {
            foreach (var (name, sample, simple, notes) in SeedData())
            {
                var exists = await db.POFormats.AnyAsync(f => f.Name == name && f.CompanyId == null);
                if (exists) continue;

                var fp = fingerprint.Compute(sample);
                var ruleSet = BuildSimpleRuleSet(simple);

                var format = new POFormat
                {
                    Name = name,
                    CompanyId = null,
                    ClientId = null,
                    SignatureHash = fp.Hash,
                    KeywordSignature = fp.Signature,
                    RuleSetJson = ruleSet,
                    CurrentVersion = 1,
                    IsActive = true,
                    Notes = notes,
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow,
                };
                db.POFormats.Add(format);
                await db.SaveChangesAsync();

                db.POFormatVersions.Add(new POFormatVersion
                {
                    POFormatId = format.Id,
                    Version = 1,
                    RuleSetJson = ruleSet,
                    ChangeNote = "Initial seed (simple-headers-v1)",
                    CreatedBy = "system",
                    CreatedAt = DateTime.UtcNow,
                });
                await db.SaveChangesAsync();
            }
        }

        private static string BuildSimpleRuleSet(SimpleFields f)
        {
            return System.Text.Json.JsonSerializer.Serialize(new
            {
                version = 1,
                engine = "simple-headers-v1",
                poNumberLabel = f.PoNumberLabel,
                poDateLabel = f.PoDateLabel,
                descriptionHeader = f.DescriptionHeader,
                quantityHeader = f.QuantityHeader,
                unitHeader = f.UnitHeader,
            });
        }

        private record SimpleFields(
            string PoNumberLabel,
            string PoDateLabel,
            string DescriptionHeader,
            string QuantityHeader,
            string UnitHeader);

        private static IEnumerable<(string Name, string Sample, SimpleFields Fields, string Notes)> SeedData()
        {
            yield return (
                "Lotte Kolson PO",
                LotteSample,
                new SimpleFields("P.O. #", "P.O. Date", "Item Name", "Quantity", "Unit"),
                "LOTTE Kolson (Pvt.) Limited — Non-Inventory POs. Layout: SNo, ItemId, Item Name, Delivery Date, Quantity, Unit, Unit Price, Total. Qty-then-Unit column order."
            );

            yield return (
                "Soorty Enterprises PO",
                SoortySample,
                new SimpleFields("P.O. Number", "P.O. Date", "Item", "Quantity", "Unit"),
                "SOORTY ENTERPRISES (PVT) LTD — General Purchases. Layout: SrNo, Item, Narration, Department, Parent, Tol, Quantity, Unit, Rate, Disc Rate, Amount. Qty-then-Unit column order."
            );

            yield return (
                "Meko Denim/Fabrics PO",
                MekoSample,
                new SimpleFields("P. O. No", "Date", "Item Name", "Qty", "Unit"),
                "MEKO DENIM MILLS / MEKO FABRICS — Weaving / Spinning units. Layout: Code, Item Name, Unit, Qty, Rate, Excl-Tax, ST Rate, S/Tax, ET Rate, ET Amt, Total. Unit-then-Qty column order (engine auto-detects from header position)."
            );
        }

        // ── Lotte Kolson sample (verbatim PdfPig extraction of PO #0000505) ──
        private const string LotteSample = @"LOTTE Kolson (Pvt.) Limited
L-14,Block 21,F.B.Industrial Area Karachi.
Phone # (021) (92-21) 111 577 577 Fax # (021) (92-21) 36374811
G.S.T. No: 02-03-2100-001-82 N.T.N. No: 0710818-4
Purchase Order for Non-Inventory Items  SCM - 03 - 15
Supplier Name:  Hakimi Traders  P.O. #  POGI-001-2626-0000505
Address:  First Floor Office # F23 Falak Coperate City Seria Road  P.O. Date  17/04/2026
Karachi
Pur. Req. #  001-222-2626-0000452
Location :
Unit - 2
S.No.  Item Id.  Item Name  Required  Quantity  Unit  Unit  Total
Delivery Date  Price  Price
1  020590  Oil Paint (Ash White) (3.64 Ltr)  10-APR-26  2.00  NOS  Rs.  5,000.0000  10,000.00
In words:  Eleven thousand eight hundred Rupess ONLY  Sub-Total  10,000.00
Sales Tax @  1,800.00
Excise Duty  .00
For QC Depart (0035/02)
Remarks:  Freight / Cartage Chg.
Total Amount  11,800.00
Discount Amount  .00
Payable Amount  11,800.00
Special Instructions :
Noman Aslam
Prepared By  U/S 23 of Sales Tax Act 1990, every
17-APR-26 05:56:02 PM  registered person must issue Sales T
Terms :
1) Payment will be subject to deduction of withholding taxes as per Income Tax Ordinance 2001 (except when tax exemption Letter is a
2) Payment will be made in 30 Days  after receipt of supplier's invoice/bill and receipt of goods throught crossed banking instruments.
3) Supplier must mention our Purchase Order No. on their Invoice/Bill, or attach a copy of our purchase Order.
4) Supplier must mention their GST No., NTN No., and business Bank Account No. as notified to collection of Sales Tax on Invoice.
5) Lotte Kolson (Pvt.) Purchase Specification Form (QAD/RAW/SP) is the integral part of this document.
6) Documents Required a) Certificate of Analysis b) Shelf Life Certifcate c) Halal Certificate / Declaration ( where applicable).
Printed By :  Noman Aslam  Page No :1 of 1
Print Date : 17-APR-2026 17:56:39  It's a Product of LOTTE Kolson (Pvt.) Limited
";

        // ── Soorty Enterprises sample (verbatim PdfPig extraction of PO #21620) ──
        private const string SoortySample = @"SOORTY ENTERPRISES (PRIVATE) LIMITED
Factory  SEL 05 OU
Plot No 53-54 Sector 15 Korangi Industrial Area, KARACHI, PakistanKarachi,
PURCHASE ORDER - GENERAL PURCHASES
Sales Tax #  02-16-6114-001-55  Control No:  ERP-002-PO/GD
NTN # :  13-02-0676470-3 CIRCLE A-2, ZONE COMPANIES V KARACHI
P.O. Number  21620
Contact Person:  MUHAMMAD.DANIYAL
Quotation No.
Bank:  Yes
Supplier  HAKIMI TRADERS - NTN # 4228937-8
RFQ Number
Sales Tax #  32-77-8761-758-52
P.O. Date  03-FEB-26
Address #  Shop No., F-23, Floor M2, Falak Corporate City, Talpur Road, Opposite City Post Office,
Karachi,PK  Reference # 1
Attn:  SAKINA,  Fax: -0335-5285350, 0331-3368883
SCM P.O. No.
Reference # 3
SUPPLIER COPY
TSor.l#.%  Item  Narration  Department  Parent Tol% Quantity  Unit  Unit Rate Disc. Rate  Amount
1 0 (076-006530-01)  SOLENOID COIL 220VAC  COIL FOR SOLENOID  GWP DRY PROCESS  12143,  0  10.00  Piece  400.000  400.000  4,000.00
( G-ELECTRICAL ITEMS 6.0VA  VALVE, AC220V,6.0.V,  (GENERAL)
)  VOLT RANGE AC 187V-
253V, 100%ED,IP65
Total:  Total Items Value  4,000.00
Amount in Words: Four Thousand Seven Hundred Twenty Only /-  Discount
0.00
Sales Tax Amount  18.00%  720.00
Other Information
SED Amount  0%  0.00
Payment Terms  15 Days Credit
PO Charges 1  0.00
Flag Status  NEW
Charges 2
PO Status
APPROVED
Charges 3  0.00
Total Amount In  PKR  4,720.00
SPECIAL COMMENTS
MUHAMMAD.DANIYAL
Prepared By  Verified By  Authorised Signatory  Managing Director
TERMS & CONDITIONS.
1. Please mention our Purchase order number on all your delivery challans and invoices.
2. Delivery of goods must be made strictly in accordance with the Purchase Order. If the goods are delivered in damaged condition or/and not in accordance with the specifications
mentioned in this Purchase Order shall be rejected and returned by us.
3. Payment will be made on the basis of approved order quantity or actual quantity received whichever is lower and subject to quantity approval. Our record will be considered final
and decisive at this point.
4. Payment will be subject to deduction of Income Tax at source at prevailing rate if applicable.
5. Payment will be made within specified period on submission of invoice along with acknowledgement of goods.
HEAD OFFICE: ( 26 - A, S.M.C.H.S, SHAHRA-E-FAISAL, PAKISTAN : )  Page 1 of 1
04-FEB-26 11:29 AM";

        // ── Meko Denim Mills sample (verbatim PdfPig extraction of PO #262475) ──
        private const string MekoSample = @"MEKO DENIM MILLS (PVT) LTD.
A-MAIN STORE. KOTRI
Purchase Order
INDENT
P. O. No  262475  Account Code  10100113  ST No  42301-4020795-9
Date  16-APR-26
Supplier Title  ROSHAN TRADERS
Dlv Date
Contact
CONSUMEABLE
VALID  Address  F-44 FALAK CITY TOWER KARACHI
WEAVING MDM
Telephone No  +92-333-1665253
Code  Item Name  Unit  Qty  Rate  Excl-Tax AmoST RateS/Tax AmoET Rate ET Amt Total Amount
43010027 GAS CYLINDER R-410  PC  2  52500.00  105,000 18.00  18,900  0  123,900
Total  105,000
Sales Tax Amount  18,900
ET Amount  0
Grand Total  123,900
Rupees One Hundred Twenty-Three Thousand Nine Hundred Only
Remarks
Payment Terms
For Meko Denim (Private) Limited
Director / Purchase Officer
Head Office : Plot No. F - 131, Hub River Road , S.I.T.E Karachi.
Email: info@mekodenim.com.pk
Printed On
16-APR-26 04:11 PM";
    }
}

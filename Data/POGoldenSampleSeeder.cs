using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Models;

namespace MyApp.Api.Data
{
    // Seeds the golden-sample regression set from the onboarding PDFs.
    // Each sample pairs a PDF's raw text with the verified expected output
    // that we manually confirmed on 2026-04-18.
    //
    // These samples are what the promotion gate replays before committing
    // any rule-set change — if a future rule edit would silently break
    // extraction of any of these PDFs, the update is refused.
    //
    // Idempotent: samples are keyed by (FormatName, Name) and skipped if
    // already present.
    public static class POGoldenSampleSeeder
    {
        private static readonly JsonSerializerOptions JsonOpts = new()
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        };

        public static async Task SeedAsync(AppDbContext db)
        {
            foreach (var entry in SeedData())
            {
                var format = await db.POFormats.AsNoTracking()
                    .FirstOrDefaultAsync(f => f.Name == entry.FormatName && f.CompanyId == null);
                if (format == null) continue; // format seeder hasn't run yet / was deleted

                var exists = await db.POGoldenSamples.AnyAsync(s => s.POFormatId == format.Id && s.Name == entry.Name);
                if (exists) continue;

                db.POGoldenSamples.Add(new POGoldenSample
                {
                    POFormatId = format.Id,
                    Name = entry.Name,
                    OriginalFileName = entry.OriginalFileName,
                    RawText = entry.RawText,
                    ExpectedJson = JsonSerializer.Serialize(entry.Expected, JsonOpts),
                    Notes = entry.Notes,
                    Status = "verified",
                    CreatedBy = "system",
                    CreatedAt = DateTime.UtcNow,
                });
            }

            await db.SaveChangesAsync();
        }

        private record SeedEntry(
            string FormatName,
            string Name,
            string OriginalFileName,
            string RawText,
            ExpectedResultDto Expected,
            string? Notes = null);

        private static IEnumerable<SeedEntry> SeedData()
        {
            yield return new SeedEntry(
                FormatName: "Soorty Enterprises PO v1",
                Name: "Soorty PO 21620 — SOLENOID COIL 220VAC",
                OriginalFileName: "HAKIMI TRADERS - NTN # 4228937-8 PO # 21620 U-05.pdf",
                RawText: SoortyPO21620Text,
                Expected: new ExpectedResultDto
                {
                    PoNumber = "21620",
                    PoDate = new DateTime(2026, 2, 3),
                    Items = new List<ExpectedItemDto>
                    {
                        new() { Description = "SOLENOID COIL 220VAC COIL FOR SOLENOID G-ELECTRICAL ITEMS 6.0VA  VALVE, AC220V,6.0.V,  (GENERAL VOLT RANGE AC 187V- 253V, 100%ED,IP65", Quantity = 10, Unit = "Pcs" },
                    },
                },
                Notes: "Single-item PO. Continuation lines carry the electrical spec details."
            );

            yield return new SeedEntry(
                FormatName: "Lotte Kolson PO v1",
                Name: "Lotte Kolson PO 505 — Oil Paint",
                OriginalFileName: "Hakimi Traders P.O 505.pdf",
                RawText: LottePO505Text,
                Expected: new ExpectedResultDto
                {
                    // Document-class prefix "POGI-" is stripped by the rule; we
                    // store only the numeric tail so bills/challans match the
                    // number the operator types off the PDF.
                    PoNumber = "001-2626-0000505",
                    PoDate = new DateTime(2026, 4, 17),
                    Items = new List<ExpectedItemDto>
                    {
                        new() { Description = "Oil Paint (Ash White) (3.64 Ltr)", Quantity = 2, Unit = "Nos" },
                    },
                },
                Notes: "Alphanumeric PO number with document-class prefix ('POGI-') stripped; dd/MM/yyyy date format."
            );

            yield return new SeedEntry(
                FormatName: "Meko Denim/Fabrics PO v1",
                Name: "Meko Denim PO 262447 — Pneumatic Pipe",
                OriginalFileName: "PO-262447-261999.pdf",
                RawText: MekoDenimPO262447Text,
                Expected: new ExpectedResultDto
                {
                    PoNumber = "262447",
                    PoDate = new DateTime(2026, 4, 13),
                    Items = new List<ExpectedItemDto>
                    {
                        new() { Description = "PENUMATIC PIPE 10MM", Quantity = 1, Unit = "Coil" },
                    },
                },
                Notes: "Single-line item. Unit = COIL."
            );

            yield return new SeedEntry(
                FormatName: "Meko Denim/Fabrics PO v1",
                Name: "Meko Denim PO 262475 — Gas Cylinder R-410",
                OriginalFileName: "PO-262475-262046.pdf",
                RawText: MekoDenimPO262475Text,
                Expected: new ExpectedResultDto
                {
                    PoNumber = "262475",
                    PoDate = new DateTime(2026, 4, 16),
                    Items = new List<ExpectedItemDto>
                    {
                        new() { Description = "GAS CYLINDER R-410", Quantity = 2, Unit = "Pcs" },
                    },
                },
                Notes: "Second Meko Denim sample — different supplier (ROSHAN TRADERS)."
            );

            yield return new SeedEntry(
                FormatName: "Meko Fabrics PO v1",
                Name: "Meko Fabrics PO S 260475 — 6 pneumatic valves",
                OriginalFileName: "ACFrOgDr...PO-262475.pdf",
                RawText: MekoFabricsPOS260475Text,
                Expected: new ExpectedResultDto
                {
                    PoNumber = "S 260475",
                    PoDate = new DateTime(2026, 1, 31),
                    Items = new List<ExpectedItemDto>
                    {
                        new() { Description = "SOLONIDE VALVE 358-015-02IL P-MAX 10 BAR CAMOZZI", Quantity = 8, Unit = "Pcs" },
                        new() { Description = "AIR CYLINDER P.MAX 10 BAR 24N2A 25A050 CAMOZZI", Quantity = 4, Unit = "Pcs" },
                        new() { Description = "PNEUMATIC CYLINDER DSNU-16-150- P-A", Quantity = 6, Unit = "Pcs" },
                        new() { Description = "MINI BALL VALVE 1/4\" (C-51 CARD)", Quantity = 10, Unit = "Pcs" },
                        new() { Description = "SOLENOID VALVE CAMOZZI 638M- 101-A63 24VDC 1/8\" 10BAR", Quantity = 8, Unit = "Pcs" },
                        new() { Description = "SOLONIDE VALVE 438-015-22 10BAR", Quantity = 4, Unit = "Pcs" },
                    },
                },
                Notes: "Multi-item PO with continuation lines. The 'S 260475' PO number has an alpha prefix."
            );
        }

        // ----- raw texts (full PdfPig dumps, verbatim) -----

        private const string SoortyPO21620Text = @"SOORTY ENTERPRISES (PRIVATE) LIMITED
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
04-FEB-26 11:29 AM
===PAGE-BREAK===";

        private const string LottePO505Text = @"LOTTE Kolson (Pvt.) Limited
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
===PAGE-BREAK===";

        private const string MekoDenimPO262447Text = @"MEKO DENIM MILLS (PVT) LTD.
A-MAIN STORE. KOTRI
Purchase Order
INDENT
P. O. No  262447  Account Code  10100004  ST No  32-77-8761-758-52
Date  13-APR-26
Supplier Title  HAKIMI TRADERS (PNEUMATIC)
Dlv Date
Contact
REPLACEMENT
VALID  Address  OFFICE NO.111, 1ST FLOOR INDUSTRIAL
TOWER PLAZA, SARAI ROAD-KARACHI
WEAVING MDM
Telephone No
Code  Item Name  Unit  Qty  Rate  Excl-Tax AmoST RateS/Tax AmoET Rate ET Amt Total Amount
33100102 PENUMATIC PIPE 10MM  COIL  1  15000.00  15,000 18.00  2,700  0  17,700
Total  15,000
Sales Tax Amount  2,700
ET Amount  0
Grand Total  17,700
Rupees Seventeen Thousand Seven Hundred Only
Remarks
Payment Terms
For Meko Denim (Private) Limited
Director / Purchase Officer
Head Office : Plot No. F - 131, Hub River Road , S.I.T.E Karachi.
Email: info@mekodenim.com.pk
Printed On
13-APR-26 11:44 AM
===PAGE-BREAK===";

        private const string MekoDenimPO262475Text = @"MEKO DENIM MILLS (PVT) LTD.
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
16-APR-26 04:11 PM
===PAGE-BREAK===";

        private const string MekoFabricsPOS260475Text = @"MEKO FABRICS (PVT) LTD
NTN # 8655568
Purchase Order
INDENT
P. O. No  S 260475  Account Code  0500100175 ST No
Date  31-JAN-26
Supplier Title  HAKIMI TRADERS
Dlv Date
Contact
CARDING UNIT-3A
VALID  Address  Office # 111, 1st Floor Industrial Tower Plaza Sarai
Road Karachi
SPINNING UNIT-KOTRI
Telephone No
Local
Code  Item Name  Unit  Qty  Rate  Excl-Tax AmoST RateS/Tax AmoET Rate ET Amt Total Amount
35020014 SOLONIDE VALVE 358-015-02IL P-MAX PC  8  9500.00  76,000 18.00  13,680  0  89,680
10 BAR CAMOZZI
35020013 AIR CYLINDER P.MAX 10 BAR 24N2A  PC  4  6500.00  26,000 18.00  4,680  0  30,680
25A050 CAMOZZI
35020012 PNEUMATIC CYLINDER DSNU-16-150- PC  6  6000.00  36,000 18.00  6,480  0  42,480
P-A
35020011 MINI BALL VALVE 1/4"" (C-51 CARD)  PC  10  600.00  6,000 18.00  1,080  0  7,080
35020009 SOLENOID VALVE CAMOZZI 638M-  PC  8  9500.00  76,000 18.00  13,680  0  89,680
101-A63 24VDC 1/8"" 10BAR
35020008 SOLONIDE VALVE 438-015-22 10BAR  PC  4  13000.00  52,000 18.00  9,360  0  61,360
Total  272,000
Sales Tax Amount  48,960
ET Amount  0
Grand Total  320,960
Rupees Three Hundred Twenty Thousand Nine Hundred Sixty Only
Remarks
Payment Terms
For Meko Fabrics (Private) Limited
Director / Purchase Officer
NOTE : This is system generated P.O and does not required signature
Printed On
31-JAN-26 02:51 PM  Head Office : WH 25,3/A Korangi Creek Industrial Park,Karachi.
===PAGE-BREAK===";
    }
}

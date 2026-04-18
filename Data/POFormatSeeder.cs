using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Data
{
    // Seeds rule-sets for the PO formats we've onboarded off sample PDFs.
    //
    // Important: the sample text here must match EXACTLY what PdfPig will
    // produce at runtime, because the fingerprint hash depends on keywords
    // extracted from it. If the seeded hash diverges from what's computed at
    // import time, the router falls back to LLM even though we do have rules
    // for this format. So: we use full dumps of the real PDFs (via the
    // scripts/PdfDumper tool), not hand-reconstructed excerpts.
    //
    // Self-healing: if a seeded format already exists but its stored hash
    // differs from what we compute now (e.g. we refined the sample text),
    // we overwrite SignatureHash + KeywordSignature + RuleSetJson in place
    // and append a new version row. This keeps the ID stable so any
    // downstream references don't break.
    public static class POFormatSeeder
    {
        public static async Task SeedAsync(AppDbContext db, IPOFormatFingerprintService fingerprint)
        {
            foreach (var (name, sampleText, ruleSetJson, notes) in SeedData())
            {
                var fp = fingerprint.Compute(sampleText);

                var existing = await db.POFormats
                    .FirstOrDefaultAsync(f => f.Name == name && f.CompanyId == null);

                if (existing == null)
                {
                    var format = new POFormat
                    {
                        Name = name,
                        CompanyId = null,
                        SignatureHash = fp.Hash,
                        KeywordSignature = fp.Signature,
                        RuleSetJson = ruleSetJson,
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
                        RuleSetJson = ruleSetJson,
                        ChangeNote = "Initial version (seeded)",
                        CreatedBy = "system",
                        CreatedAt = DateTime.UtcNow,
                    });
                    await db.SaveChangesAsync();
                    continue;
                }

                // Refresh if the baseline changed. We deliberately don't check
                // whether a human edited the rule-set in between — we're still
                // in the initial phase with no UI edit path wired up, so the
                // seeder is the only author. When the correction UI ships, we
                // can switch to a "baseline vs operator override" split.
                if (existing.SignatureHash == fp.Hash && existing.RuleSetJson == ruleSetJson)
                    continue;

                existing.SignatureHash = fp.Hash;
                existing.KeywordSignature = fp.Signature;
                existing.RuleSetJson = ruleSetJson;
                existing.Notes = notes;
                existing.CurrentVersion += 1;
                existing.UpdatedAt = DateTime.UtcNow;

                db.POFormatVersions.Add(new POFormatVersion
                {
                    POFormatId = existing.Id,
                    Version = existing.CurrentVersion,
                    RuleSetJson = ruleSetJson,
                    ChangeNote = "Re-seeded (baseline updated)",
                    CreatedBy = "system",
                    CreatedAt = DateTime.UtcNow,
                });
                await db.SaveChangesAsync();
            }
        }

        private static IEnumerable<(string Name, string SampleText, string RuleSetJson, string Notes)> SeedData()
        {
            yield return (
                "Soorty Enterprises PO v1",
                SoortySample,
                SoortyRules,
                "Soorty Enterprises (Pvt) Ltd purchase orders. Multi-column table with Item + Narration columns; values may span 3-4 continuation lines."
            );

            yield return (
                "Lotte Kolson PO v1",
                LotteSample,
                LotteRules,
                "Lotte Kolson (Pvt) Ltd Non-Inventory purchase orders. PO numbers are alphanumeric (POGI-...)."
            );

            yield return (
                "Meko Denim/Fabrics PO v1",
                MekoDenimSample,
                MekoRules,
                "Meko Denim Mills / Meko Fabrics purchase orders. Item name and code share column 0; unit in column 1, qty in column 2."
            );

            yield return (
                "Meko Fabrics PO v1",
                MekoFabricsSample,
                MekoRules,
                "Meko Fabrics (Pvt) Ltd variant - header carries 'NTN #' line. Shares item-extraction rules with Meko Denim."
            );
        }

        // --- SOORTY (full dump of "HAKIMI TRADERS - NTN # 4228937-8 PO # 21620 U-05.pdf") ---
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
04-FEB-26 11:29 AM
===PAGE-BREAK===";

        private const string SoortyRules = @"{
  ""version"": 1,
  ""engine"": ""anchored-v1"",
  ""fields"": {
    ""poNumber"": { ""regex"": ""P\\.\\s*O\\.\\s*Number\\s+([A-Za-z0-9/\\-]+)"", ""group"": 1, ""flags"": ""im"" },
    ""poDate"":   { ""regex"": ""P\\.\\s*O\\.\\s*Date\\s+(\\d{1,2}-[A-Za-z]{3}-\\d{2,4})"", ""group"": 1, ""flags"": ""im"", ""dateFormats"": [""dd-MMM-yy"",""dd-MMM-yyyy""] },
    ""supplier"": { ""regex"": ""(?m)^Supplier\\s{2,}(.+?)(?:\\s+-\\s+NTN|\\s{2,}|$)"", ""group"": 1, ""flags"": ""im"" }
  },
  ""items"": {
    ""strategy"": ""column-split"",
    ""split"": { ""regex"": ""\\s{2,}"" },
    ""rowFilter"": { ""regex"": ""^\\d+\\s+\\d+\\s+\\([0-9\\-]+\\)"", ""flags"": ""im"" },
    ""descColumns"": [1, 2],
    ""qtyColumn"": 6,
    ""unitColumn"": 7,
    ""stopRegex"": { ""regex"": ""^(Total:|Amount in Words|Other Information|SPECIAL COMMENTS|Payment Terms|Flag Status|PO Status|TERMS & CONDITIONS)"", ""flags"": ""im"" },
    ""continuationJoin"": true
  }
}";

        // --- LOTTE Kolson (full dump of "Hakimi Traders P.O 505.pdf") ---
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
===PAGE-BREAK===";

        private const string LotteRules = @"{
  ""version"": 1,
  ""engine"": ""anchored-v1"",
  ""fields"": {
    ""poNumber"": { ""regex"": ""P\\.\\s*O\\.\\s*#\\s+([A-Za-z0-9/\\-]+)"", ""group"": 1, ""flags"": ""im"" },
    ""poDate"":   { ""regex"": ""P\\.\\s*O\\.\\s*Date\\s+(\\d{1,2}[/\\-]\\d{1,2}[/\\-]\\d{2,4})"", ""group"": 1, ""flags"": ""im"", ""dateFormats"": [""dd/MM/yyyy"",""d/M/yyyy"",""dd-MM-yyyy""] },
    ""supplier"": { ""regex"": ""Supplier\\s*Name:?\\s+(.+?)(?:\\s{2,}|\\s+P\\.\\s*O\\.|$)"", ""group"": 1, ""flags"": ""im"" }
  },
  ""items"": {
    ""strategy"": ""column-split"",
    ""split"": { ""regex"": ""\\s{2,}"" },
    ""rowFilter"": { ""regex"": ""^\\d+\\s+\\d{5,}\\s+"", ""flags"": ""im"" },
    ""descColumn"": 2,
    ""qtyColumn"": 4,
    ""unitColumn"": 5,
    ""stopRegex"": { ""regex"": ""^(In\\s+words|Sub-Total|Sales Tax|Excise Duty|Total Amount|Discount Amount|Payable Amount|Special Instructions|Remarks|Terms)"", ""flags"": ""im"" },
    ""continuationJoin"": true
  }
}";

        // --- MEKO DENIM MILLS (full dump of "PO-262447-261999.pdf") ---
        private const string MekoDenimSample = @"MEKO DENIM MILLS (PVT) LTD.
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

        // --- MEKO FABRICS (full dump of "ACFrOgDr...PO-262475...pdf") ---
        // Contains "1/4""" quote char inside description — escaped as "" in C# verbatim string.
        private const string MekoFabricsSample = @"MEKO FABRICS (PVT) LTD
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

        private const string MekoRules = @"{
  ""version"": 1,
  ""engine"": ""anchored-v1"",
  ""fields"": {
    ""poNumber"": { ""regex"": ""P\\.\\s*O\\.\\s*No\\s+([A-Za-z]?\\s*[A-Za-z0-9\\-/]+)"", ""group"": 1, ""flags"": ""im"" },
    ""poDate"":   { ""regex"": ""(?m)^Date\\s+(\\d{1,2}-[A-Za-z]{3}-\\d{2,4})"", ""group"": 1, ""flags"": ""im"", ""dateFormats"": [""dd-MMM-yy"",""dd-MMM-yyyy""] },
    ""supplier"": { ""regex"": ""Supplier\\s*Title\\s+(.+?)(?:\\s{2,}|\\n|$)"", ""group"": 1, ""flags"": ""im"" }
  },
  ""items"": {
    ""strategy"": ""row-regex"",
    ""row"": {
      ""regex"": ""^\\d{6,}\\s+(?<desc>.+?)\\s+(?<unit>PC|PCS|COIL|NOS|KG|BAG|SET|PIECE|METER|MTR|LTR|ROLL|UNIT|EACH|DOZEN|BOX|BOTTLE|PAIR|TON|SHEET|BUNDLE|LITER|LITRE|PACKET|PKT|FT|INCH|CM|MM|GRAM|CARTON|DRUM|CAN)\\s+(?<qty>\\d+)\\s+[\\d,\\.]+"",
      ""flags"": ""im""
    },
    ""descGroup"": ""desc"",
    ""qtyGroup"": ""qty"",
    ""unitGroup"": ""unit"",
    ""stopRegex"": { ""regex"": ""^(Total|Sales Tax Amount|ET Amount|Grand Total|Rupees|Remarks|Payment Terms|For\\s+Meko|Director|Head Office|NOTE|Printed On|Email:)"", ""flags"": ""im"" },
    ""continuationJoin"": true
  }
}";
    }
}

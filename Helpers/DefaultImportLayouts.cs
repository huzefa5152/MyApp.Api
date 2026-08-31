using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// The layouts that ship with the product — one per import kind, seeded
    /// installation-wide so an operator never has to describe a workbook from a
    /// blank form on their first import.
    ///
    /// They describe the layout Pakistani wholesale accountants actually hand
    /// over: a customs-lot stock sheet, and a customer ledger built as an index
    /// sheet plus one sheet per customer. They are a STARTING POINT — a company
    /// whose accountant uses a different template edits the mapping and saves
    /// its own, which then wins over the built-in for that company.
    ///
    /// Two rules keep them safe to re-seed on every startup:
    ///
    ///   • CREATE ONLY. An existing built-in is never rewritten, so an operator
    ///     who corrected a column keeps their correction across restarts.
    ///   • NO DATES in the mapping. A period belongs to an import, not to a
    ///     layout — baking 2025-2026 into the shipped default would make it
    ///     wrong the following year. The ledger importer takes the period from
    ///     the request instead.
    /// </summary>
    public static class DefaultImportLayouts
    {
        public const string StockName = "Standard stock sheet (built-in)";
        public const string LedgerName = "Standard customer ledger (built-in)";

        /// <summary>
        /// Signature of each template as published.
        ///
        /// The fingerprint reads heading vocabulary only — data rows are
        /// skipped, and on a workbook with a sheet per customer a token has to
        /// appear on more than one of them — so these stay the same when the
        /// products, customers, amounts and period all change. That is what
        /// makes next period's file recognise its own layout with no re-mapping.
        ///
        /// A workbook that does NOT match still gets the layout offered: the
        /// hash only decides whether it is selected without asking.
        ///
        /// TO REGENERATE after changing <see cref="ExcelImport.WorkbookFingerprint"/>:
        /// upload each template through Spreadsheet Import and copy the
        /// signature the identify step reports. The suite's
        /// "recognises its own layout after every value changes" case is what
        /// catches a drift here.
        /// </summary>
        private const string StockSignature = "55fb6f8f6098d0aa5b31056229d685fa20aaecfd223b8848385879d97f295352";
        private const string StockTokens =
            "alpha|balance|catory|claimed|code|consumed|cost|date|digit|excl|excluding|exl|good|items|month|number|opening|price|qty|rate|sold|stock|sub|tax|trader|unit|vat";

        private const string LedgerSignature = "5c6c11edc28753e5378470c5917ed30ef5cc24e4f637e410b0fb3d1dd6b1977b";
        private const string LedgerTokens =
            "accounts|acount|alpha|balance|chart|closing|credit|date|debit|ledger|name|opening|particulars|period|receivable|traders";

        /// <summary>
        /// Customs-lot stock sheet: a title band, headings on row 3, one row per
        /// lot from row 4. HS codes carry a ":-" tail, and the sub-category
        /// column is the accountant's own grouping with no home in the system.
        /// </summary>
        private const string StockMapping = """
        {
          "sheetSelect": { "mode": "byHeaderText", "mustContain": ["GD Number"] },
          "headerRow": 3,
          "firstDataRow": 4,
          "columns": {
            "lotRef": 2, "lotDate": 3,
            "hsCodeShort": 4, "hsCodeFull": 5,
            "itemName": 6, "unit": 9,
            "balanceQty": 18, "balanceValue": 19
          },
          "hsCodeStripSuffix": ":-",
          "ignoreColumns": [7]
        }
        """;

        /// <summary>
        /// Index sheet naming every customer, then one sheet each. The document
        /// reference wanders between columns 3 and 4 from sheet to sheet, which
        /// is why refAny is a list. Balance is mapped for COMPARISON only — that
        /// column is hand-maintained and routinely disagrees with its own rows.
        /// </summary>
        private const string LedgerMapping = """
        {
          "indexSheet": { "mode": "byName", "name": "Chart Of Acount" },
          "indexFirstRow": 7,
          "indexColumns": { "name": 2, "opening": 3, "debit": 4, "credit": 5, "closing": 6 },
          "clientSheets": { "mode": "allExcept", "except": ["Chart Of Acount"] },
          "clientNameCell": "A3",
          "firstDataRow": 7,
          "columns": { "date": 2, "refAny": [3, 4], "debit": 6, "credit": 7, "balance": 8 },
          "creditIsInvoice": true,
          "refPattern": "^[A-Za-z]{1,4}-\\d+$",
          "undatedRule": "carryPreviousRow",
          "openingBand": 900000,
          "unreferencedBand": 950000
        }
        """;

        /// <summary>
        /// Inserts any built-in layout that is missing. Idempotent, and never
        /// touches one that already exists. Returns how many were created.
        /// </summary>
        public static async Task<int> SeedAsync(AppDbContext db, CancellationToken ct = default)
        {
            var wanted = new[]
            {
                (Kind: ImportKinds.OpeningStock, Layout: ImportLayouts.LotRows,
                 Name: StockName, Mapping: StockMapping,
                 Hash: StockSignature, Tokens: StockTokens,
                 Notes: "Ships with the product. Customs-lot stock sheet: headings on row 3, one row per lot below. Edit and save your own copy if your accountant's template differs."),

                (Kind: ImportKinds.CustomerLedger, Layout: ImportLayouts.IndexPlusPerClientSheets,
                 Name: LedgerName, Mapping: LedgerMapping,
                 Hash: LedgerSignature, Tokens: LedgerTokens,
                 Notes: "Ships with the product. Index sheet plus one sheet per customer. The period is set per import, not stored here."),
            };

            var created = 0;

            foreach (var w in wanted)
            {
                var exists = await db.ImportProfiles
                    .AnyAsync(p => p.CompanyId == null && p.Kind == w.Kind && p.IsDefault, ct);
                if (exists) continue;

                var profile = new ImportProfile
                {
                    Kind = w.Kind,
                    Layout = w.Layout,
                    Name = w.Name,
                    CompanyId = null,           // installation-wide
                    IsDefault = true,
                    SignatureHash = w.Hash,
                    TokenSignature = w.Tokens,
                    MappingJson = w.Mapping,
                    CurrentVersion = 1,
                    IsActive = true,
                    Notes = w.Notes,
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow,
                };

                db.ImportProfiles.Add(profile);
                await db.SaveChangesAsync(ct);

                db.ImportProfileVersions.Add(new ImportProfileVersion
                {
                    ImportProfileId = profile.Id,
                    Version = 1,
                    Layout = w.Layout,
                    MappingJson = w.Mapping,
                    ChangeNote = "Shipped with the product",
                    CreatedBy = "system",
                });
                await db.SaveChangesAsync(ct);

                created++;
            }

            return created;
        }
    }
}

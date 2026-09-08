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
    ///   • AN OPERATOR'S EDIT IS NEVER OVERWRITTEN. A built-in whose current
    ///     version was written by the seeder ("system") is upgraded in place
    ///     when the shipped mapping moves on; one an operator has edited keeps
    ///     their mapping for ever.
    ///   • NO DATES in the mapping. A period belongs to an import, not to a
    ///     layout — baking 2025-2026 into the shipped default would make it
    ///     wrong the following year. The ledger importer takes the period from
    ///     the request instead.
    /// </summary>
    public static class DefaultImportLayouts
    {
        public const string StockName = "Standard opening stock sheet (built-in)";
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
        private const string StockSignature = "3e42f32fcbc8858cf8cbdeb437cdf5e769abc10acc4e2ca0e9acb29094885b14";

        /// <summary>
        /// Heading vocabulary of the published template, exactly as it
        /// fingerprints — so the file we hand a new client is an EXACT match for
        /// the layout that reads it. Regenerate both this and
        /// <see cref="StockSignature"/> from
        /// <c>myapp-frontend/public/templates/opening-stock-template.xlsx</c>
        /// whenever that template's headings change.
        ///
        /// Kept TIGHT on purpose. Similarity is Jaccard, so padding this with
        /// every wording variant a real accountant might use LOWERS the score
        /// for all of them — union grows faster than intersection. Pooling the
        /// two client sheets' vocabularies into it scored them 0.76 and 0.67;
        /// the template's own 25 tokens score the same two files 0.92 and 0.68.
        /// Wording differences belong in <c>headerAliases</c>, which is where
        /// they actually change how a column is read.
        /// </summary>
        private const string StockTokens =
            "bal|balance|category|claim|code|consumed|cost|date|description|digit|excl|exl|good|month|number|opening|price|qty|rate|sold|stock|sub|tax|unit|vat";

        private const string LedgerSignature = "5c6c11edc28753e5378470c5917ed30ef5cc24e4f637e410b0fb3d1dd6b1977b";
        private const string LedgerTokens =
            "accounts|acount|alpha|balance|chart|closing|credit|date|debit|ledger|name|opening|particulars|period|receivable|traders";

        /// <summary>
        /// THE standard opening-stock sheet. A title band, headings on row 3,
        /// one row per customs lot from row 4, and three blocks of the same four
        /// figures — Opening, Consumed, Balance — from column 10.
        ///
        /// The column NUMBERS are the published template (see
        /// <c>SPREADSHEET_IMPORT_GUIDE.md</c>): the identity columns run GD
        /// number, GD date, 4-digit code, 8-digit code, description,
        /// sub-category, price, unit. <c>headerAliases</c> then corrects them
        /// against the sheet's own headings, which is what lets this ONE layout
        /// read the variant that puts the product name and sub-category BEFORE
        /// the two HS codes and titles them "Items" / "GDs No". Both real
        /// client workbooks import with no mapping at all.
        ///
        /// Aliases are given for the identity columns only, on purpose. From
        /// column 10 the headings repeat — "Qty", "Rate" and "S.Tax" appear once
        /// per block — so an alias there would match three columns and be
        /// declined anyway; those stay pinned by number, and the row-2 band
        /// labels (Opening / Consumed / Balance) are what a human reads to check
        /// them. "Bal Qty" and "Consumed Exl" are aliased because they ARE
        /// unique where a sheet spells them out.
        ///
        /// Only the BALANCE block drives the import. Opening and Consumed are
        /// read to be kept per lot as history (Models.OpeningStockLot) and never
        /// feed the stock position. The S.Tax amount is mapped for comparison
        /// only — it is always derived from value x rate.
        /// </summary>
        private const string StockMapping = """
        {
          "sheetSelect": { "mode": "byHeaderText", "mustContain": ["8 Digit Hs Code"] },
          "headerRow": 3,
          "firstDataRow": 4,
          "columns": {
            "lotRef": 2, "lotDate": 3,
            "hsCodeShort": 4, "hsCodeFull": 5,
            "itemName": 6, "unitPrice": 8, "unit": 9,
            "openingQty": 10, "openingValue": 11, "openingTaxRate": 12,
            "consumedQty": 14, "consumedValue": 15, "consumedTaxRate": 16,
            "balanceQty": 18, "balanceValue": 19,
            "balanceTaxRate": 20, "balanceTax": 21
          },
          "headerAliases": {
            "lotRef": ["GD Number", "GDs No", "GD No", "GDs Number", "GD #"],
            "lotDate": ["GD Date"],
            "hsCodeShort": ["4 Digit Hs Code", "4 Digit HS Code"],
            "hsCodeFull": ["8 Digit Hs Code", "8 Digit HS Code"],
            "itemName": ["Description", "Items", "Item", "Item Name", "Particulars"],
            "unitPrice": ["Price", "Unit Price"],
            "unit": ["Unit", "UOM"],
            "balanceQty": ["Bal Qty", "Balance Qty"],
            "balanceValue": ["Bal Exl", "Bal Excl", "Balance Exl"],
            "consumedValue": ["Consumed Exl", "Consumed Excl"]
          },
          "hsCodeStripSuffix": ":-",
          "ignoreColumns": [1, 7, 13, 17]
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
        /// Inserts any built-in layout that is missing, and upgrades one that is
        /// still exactly as shipped when the shipped mapping has moved on.
        /// Idempotent. An operator-edited built-in (version above 1) is never
        /// touched.
        /// </summary>
        /// <summary>Created and upgraded counts, so startup can say which happened.</summary>
        public readonly record struct SeedOutcome(int Created, int Upgraded)
        {
            public int Total => Created + Upgraded;
        }

        public static async Task<SeedOutcome> SeedAsync(AppDbContext db, CancellationToken ct = default)
        {
            var wanted = new[]
            {
                (Kind: ImportKinds.OpeningStock, Layout: ImportLayouts.LotRows,
                 Name: StockName, Mapping: StockMapping,
                 Hash: StockSignature, Tokens: StockTokens,
                 Notes: "Ships with the product. Customs-lot stock sheet: headings on row 3, one row per lot below, Opening/Consumed/Balance blocks from column 10. Finds the item name, HS code, GD number, price and unit by their headings, so either column order imports unchanged. Edit and save your own copy if your accountant's template differs."),

                (Kind: ImportKinds.CustomerLedger, Layout: ImportLayouts.IndexPlusPerClientSheets,
                 Name: LedgerName, Mapping: LedgerMapping,
                 Hash: LedgerSignature, Tokens: LedgerTokens,
                 Notes: "Ships with the product. Index sheet plus one sheet per customer. The period is set per import, not stored here."),
            };

            var created = 0;
            var upgraded = 0;

            foreach (var w in wanted)
            {
                var existing = await db.ImportProfiles
                    .FirstOrDefaultAsync(p => p.CompanyId == null && p.Kind == w.Kind && p.IsDefault, ct);

                if (existing != null)
                {
                    // A built-in that already exists is normally left alone. But
                    // create-only seeding froze the FIRST version an installation
                    // ever saw: shipping an improved mapping — the stock layout
                    // gaining its tax-rate columns, say — would then reach new
                    // installations and never the ones that needed it.
                    //
                    // So: upgrade it, but only while it is still ours. "Ours"
                    // was originally "version 1", which broke the moment the
                    // seeder itself shipped a second version — the third one
                    // could then never reach an installation that had taken the
                    // second. Authorship is the durable test: the seeder writes
                    // "system", every operator edit writes the operator's name,
                    // so a built-in nobody has touched still has a system-
                    // authored current version however many times we have
                    // improved it. An edited built-in keeps the operator's
                    // mapping.
                    var currentAuthor = await db.ImportProfileVersions.AsNoTracking()
                        .Where(v => v.ImportProfileId == existing.Id && v.Version == existing.CurrentVersion)
                        .Select(v => v.CreatedBy)
                        .FirstOrDefaultAsync(ct);

                    // No history row at all means a hand-inserted or very old
                    // built-in; version 1 is the only safe thing to assume ours.
                    var untouched = currentAuthor == null
                        ? existing.CurrentVersion == 1
                        : string.Equals(currentAuthor, "system", StringComparison.Ordinal);
                    // Every field the seeder owns, not just the mapping. Testing
                    // the mapping alone silently skipped a release that changed
                    // only the published signature, so the shipped template
                    // stopped recognising itself.
                    var changed = !string.Equals(existing.MappingJson, w.Mapping, StringComparison.Ordinal)
                                  || !string.Equals(existing.Name, w.Name, StringComparison.Ordinal)
                                  || !string.Equals(existing.SignatureHash, w.Hash, StringComparison.OrdinalIgnoreCase)
                                  || !string.Equals(existing.TokenSignature, w.Tokens, StringComparison.Ordinal)
                                  || !string.Equals(existing.Notes, w.Notes, StringComparison.Ordinal);

                    if (untouched && changed)
                    {
                        existing.MappingJson = w.Mapping;
                        existing.Layout = w.Layout;
                        existing.Name = w.Name;
                        existing.SignatureHash = w.Hash;
                        existing.TokenSignature = w.Tokens;
                        existing.Notes = w.Notes;
                        existing.CurrentVersion += 1;
                        existing.UpdatedAt = DateTime.UtcNow;

                        db.ImportProfileVersions.Add(new ImportProfileVersion
                        {
                            ImportProfileId = existing.Id,
                            Version = existing.CurrentVersion,
                            Layout = w.Layout,
                            MappingJson = w.Mapping,
                            ChangeNote = "Updated to the version shipped with this release",
                            CreatedBy = "system",
                        });
                        await db.SaveChangesAsync(ct);
                        upgraded++;
                    }
                    continue;
                }

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

            return new SeedOutcome(created, upgraded);
        }
    }
}

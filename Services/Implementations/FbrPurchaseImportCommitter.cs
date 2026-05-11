using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    // ── FBR Purchase Import Committer ───────────────────────────────────
    //
    // The actual write path. Given a preview-decided list of invoices,
    // commits each one inside its own transaction and rolls up the
    // result counts. Pure orchestration — uses the existing
    // SupplierGroup / Stock services for the side effects, doesn't
    // duplicate their logic.
    //
    // Per-invoice transaction strategy:
    //   • SaveChangesAsync at the end of each invoice's tx so the
    //     sequence (Supplier → ItemType → PurchaseBill → PurchaseItems →
    //     StockMovement) sees IDs as it goes.
    //   • A failure inside the invoice tx rolls the WHOLE invoice back —
    //     bills with partial line creation are never persisted.
    //   • Caller-level (FbrPurchaseImportService.CommitAsync) walks the
    //     list and aggregates, so one bad row in invoice 27 doesn't
    //     poison invoices 1-26 or 28-N.
    //
    // No locks; we rely on the database's row-level locking via the
    // transaction. Parallel invocation by two operators submitting the
    // same file would dedup on the second pass via the matcher (rows
    // tagged already-exists are skipped).

    public interface IFbrPurchaseImportCommitter
    {
        /// <summary>
        /// Commits one invoice's worth of will-import /
        /// product-will-be-created lines. Returns the per-invoice
        /// outcome to roll up at the caller. Suppliers and ItemTypes
        /// created during this call are reported via the out counters
        /// so the caller can surface them on the result page.
        /// </summary>
        Task<FbrImportCommitInvoiceResult> CommitOneInvoiceAsync(
            int companyId,
            int? userId,
            FbrImportPreviewInvoiceDto invoice,
            FbrImportCommitCounts runningCounts);
    }

    public class FbrPurchaseImportCommitter : IFbrPurchaseImportCommitter
    {
        private readonly AppDbContext _context;
        private readonly ISupplierGroupService _supplierGroups;
        private readonly IStockService _stock;
        private readonly ILogger<FbrPurchaseImportCommitter> _logger;

        public FbrPurchaseImportCommitter(
            AppDbContext context,
            ISupplierGroupService supplierGroups,
            IStockService stock,
            ILogger<FbrPurchaseImportCommitter> logger)
        {
            _context = context;
            _supplierGroups = supplierGroups;
            _stock = stock;
            _logger = logger;
        }

        public async Task<FbrImportCommitInvoiceResult> CommitOneInvoiceAsync(
            int companyId,
            int? userId,
            FbrImportPreviewInvoiceDto invoice,
            FbrImportCommitCounts runningCounts)
        {
            var result = new FbrImportCommitInvoiceResult
            {
                FbrInvoiceRefNo = invoice.FbrInvoiceRefNo,
                SupplierNtn = invoice.SupplierNtn,
                SupplierName = invoice.SupplierName,
                InvoiceNo = invoice.InvoiceNo,
                LineCount = invoice.Lines.Count,
            };

            // Filter to the lines we'd actually persist. Caller has
            // already done coarse aggregate-decision filtering, but
            // mixed-decision invoices need finer-grained line filter
            // here too (e.g. an invoice with 3 will-import lines and 1
            // failed-validation line — we commit 3, drop 1).
            var importableLines = invoice.Lines
                .Where(l => l.Decision == ImportDecision.WillImport
                         || l.Decision == ImportDecision.ProductWillCreate)
                .ToList();

            if (importableLines.Count == 0)
            {
                result.Outcome = "skipped";
                return result;
            }

            // Per-invoice transaction. A failure anywhere below rolls
            // back this invoice; previously-committed invoices are
            // unaffected because we use one tx per invoice.
            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                // 1. Supplier — find by NTN within company; create if
                //    missing, then attach to its SupplierGroup so the
                //    cross-tenant Common Suppliers feature picks it up.
                var supplier = await ResolveOrCreateSupplierAsync(companyId, invoice, runningCounts);

                // 2. ItemTypes — for each importable line, find by HS
                //    code first then by description; create if missing.
                //    The created ItemTypes feed the inventory ledger
                //    (StockMovement.ItemTypeId) so we MUST persist them
                //    before the bill so we can write the FK.
                var lineToItemType = await ResolveOrCreateItemTypesAsync(importableLines, runningCounts);

                // 3. PurchaseBill — allocate next number per company.
                //    Same pattern as PurchaseBillService.CreateAsync;
                //    we don't reuse that service because it builds from
                //    a different DTO shape and would re-trigger a
                //    parallel transaction.
                var company = await _context.Companies.FirstAsync(c => c.Id == companyId);
                var maxNumber = await _context.PurchaseBills
                    .Where(p => p.CompanyId == companyId)
                    .Select(p => (int?)p.PurchaseBillNumber)
                    .MaxAsync() ?? 0;
                var nextNumber = Math.Max(maxNumber + 1, company.StartingPurchaseBillNumber);
                company.CurrentPurchaseBillNumber = nextNumber;

                var subtotal = importableLines.Sum(l => l.ValueExclTax);
                var gstAmount = importableLines.Sum(l => l.GstAmount ?? 0m);
                var grandTotal = subtotal + gstAmount
                                 + importableLines.Sum(l => l.ExtraTax ?? 0m)
                                 + importableLines.Sum(l => l.StWithheldAtSource ?? 0m);

                // GST rate displayed at the bill level: weighted by line
                // value where each line had a rate; falls back to first
                // non-null rate or 0.
                var ratedLines = importableLines.Where(l => l.GstRate.HasValue && l.ValueExclTax > 0).ToList();
                var headerGstRate = 0m;
                if (ratedLines.Sum(l => l.ValueExclTax) > 0)
                {
                    headerGstRate = ratedLines.Sum(l => l.GstRate!.Value * l.ValueExclTax)
                                  / ratedLines.Sum(l => l.ValueExclTax);
                }

                var bill = new PurchaseBill
                {
                    CompanyId = companyId,
                    SupplierId = supplier.Id,
                    PurchaseBillNumber = nextNumber,
                    Date = invoice.InvoiceDate ?? DateTime.UtcNow.Date,
                    SupplierBillNumber = invoice.InvoiceNo,
                    SupplierIRN = invoice.FbrInvoiceRefNo,
                    Subtotal = Round2(subtotal),
                    GSTRate = Round2(headerGstRate),
                    GSTAmount = Round2(gstAmount),
                    GrandTotal = Round2(grandTotal),
                    AmountInWords = "",     // not relevant for FBR-imported rows
                    PaymentTerms = null,
                    DocumentType = 4,        // Sale Invoice = the FBR doc type for these
                    PaymentMode = null,
                    ReconciliationStatus = "Matched",  // came FROM Annexure-A → matched by definition
                    Source = "fbr-import",
                    CreatedAt = DateTime.UtcNow,
                };
                _context.PurchaseBills.Add(bill);
                await _context.SaveChangesAsync();   // need bill.Id for items

                // 4. PurchaseItems
                int sNo = 1;
                foreach (var line in importableLines)
                {
                    var itemTypeId = lineToItemType.GetValueOrDefault(line.SourceRowNumber);
                    var item = new PurchaseItem
                    {
                        PurchaseBillId = bill.Id,
                        ItemTypeId = itemTypeId,
                        ItemTypeName = line.MatchedItemTypeName ?? line.Description ?? "",
                        Description = string.IsNullOrWhiteSpace(line.Description) ? $"HS {line.HsCode}" : line.Description,
                        Quantity = line.Quantity,
                        UOM = line.Uom ?? "",
                        // Unit price = value-excluding-tax / quantity. Round
                        // to 2 places to fit decimal(18,2). Quantity is
                        // already validated > 0 by the filter.
                        UnitPrice = line.Quantity > 0 ? Round2(line.ValueExclTax / line.Quantity) : 0m,
                        LineTotal = Round2(line.ValueExclTax),
                        HSCode = line.HsCode,
                        SaleType = line.SaleType,
                        FixedNotifiedValueOrRetailPrice = line.FixedNotifiedValueOrRetailPrice,
                        SroScheduleNo = line.SroScheduleNo,
                        SroItemSerialNo = line.SroItemSerialNo,
                        ExtraTax = line.ExtraTax,
                        StWithheldAtSource = line.StWithheldAtSource,
                    };
                    _context.PurchaseItems.Add(item);
                    sNo++;
                }
                await _context.SaveChangesAsync();
                runningCounts.LinesImported += importableLines.Count;

                // 5. StockMovement (Direction=In) per line. Mirrors what
                //    PurchaseBillService.CreateAsync does — sourceType =
                //    PurchaseBill so deletes can reverse via compensating
                //    OUT entries.
                foreach (var line in importableLines)
                {
                    var itemTypeId = lineToItemType.GetValueOrDefault(line.SourceRowNumber);
                    if (!itemTypeId.HasValue || line.Quantity <= 0) continue;
                    await _stock.RecordMovementAsync(
                        companyId: companyId,
                        itemTypeId: itemTypeId.Value,
                        direction: StockMovementDirection.In,
                        // 2026-05-12: decimal quantity flows through.
                        quantity: line.Quantity,
                        sourceType: StockMovementSourceType.PurchaseBill,
                        sourceId: bill.Id,
                        movementDate: bill.Date,
                        notes: $"FBR Import: {invoice.SupplierName} #{invoice.InvoiceNo}");
                    runningCounts.StockMovementsRecorded++;
                }

                await tx.CommitAsync();
                result.Outcome = "imported";
                result.CreatedPurchaseBillId = bill.Id;
                result.LineCount = importableLines.Count;
                return result;
            }
            catch (DbUpdateException ex) when (IsDuplicateKeyViolation(ex))
            {
                // Audit C-3 (2026-05-08): re-uploading the same FBR file
                // would previously create duplicate PurchaseBill rows
                // because there was no unique constraint on
                // (CompanyId, SupplierId, SupplierBillNumber). The unique
                // constraint isn't deployed yet (needs a duplicate-cleanup
                // pass on live tenants first), but if it's added later this
                // catch turns the violation into a clean "skipped" outcome
                // so the operator sees "12 imported, 5 already existed"
                // instead of a 500 in the middle of the loop.
                await tx.RollbackAsync();
                _logger.LogInformation(
                    "FBR import: invoice {InvoiceNo} (FBR ref {Ref}) already imported — skipping duplicate",
                    invoice.InvoiceNo, invoice.FbrInvoiceRefNo);
                result.Outcome = "already-imported";
                result.ErrorMessage = "Already imported in a previous upload (skipped).";
                return result;
            }
            catch (Exception ex)
            {
                await tx.RollbackAsync();
                _logger.LogError(ex,
                    "FBR import commit failed for company {CompanyId} invoice {InvoiceNo} (FBR ref {Ref})",
                    companyId, invoice.InvoiceNo, invoice.FbrInvoiceRefNo);
                result.Outcome = "failed";
                result.ErrorMessage = ex.Message.Length > 1000 ? ex.Message[..1000] : ex.Message;
                return result;
            }
        }

        /// <summary>
        /// SQL Server unique-constraint violation detection.
        ///   2601 — duplicate index key (any unique index)
        ///   2627 — primary-key / unique-constraint violation
        /// Both surface as DbUpdateException wrapping a SqlException;
        /// the inner exception's Number tells us which.
        /// </summary>
        private static bool IsDuplicateKeyViolation(DbUpdateException ex)
        {
            return ex.InnerException is SqlException sqlEx
                && (sqlEx.Number == 2601 || sqlEx.Number == 2627);
        }

        // ── Helpers ─────────────────────────────────────────────────────

        private async Task<Supplier> ResolveOrCreateSupplierAsync(
            int companyId, FbrImportPreviewInvoiceDto invoice, FbrImportCommitCounts counts)
        {
            // Hot path: NTN match in this company already happened in the
            // matcher and was passed through as MatchedSupplierId.
            if (invoice.MatchedSupplierId.HasValue)
            {
                var existing = await _context.Suppliers.FirstAsync(s => s.Id == invoice.MatchedSupplierId.Value);
                return existing;
            }

            // Slow path: create. We could re-check by NTN here against a
            // race condition where two operators commit the same FBR
            // file simultaneously, but that's vanishingly rare and the
            // unique-NTN-per-company constraint (if any) would catch it.
            var supplier = new Supplier
            {
                CompanyId = companyId,
                Name = string.IsNullOrWhiteSpace(invoice.SupplierName) ? $"Supplier NTN {invoice.SupplierNtn}" : invoice.SupplierName,
                NTN = invoice.SupplierNtn,
                RegistrationType = "Registered",  // Annexure-A only carries registered sellers
            };
            _context.Suppliers.Add(supplier);
            await _context.SaveChangesAsync();
            await _supplierGroups.EnsureGroupForSupplierAsync(supplier);
            await _context.SaveChangesAsync();

            counts.SuppliersCreated++;
            return supplier;
        }

        // Build a map { sourceRowNumber → ItemTypeId }. Side-effect:
        // creates new ItemTypes for product-will-be-created lines.
        private async Task<Dictionary<int, int?>> ResolveOrCreateItemTypesAsync(
            List<FbrImportPreviewLineDto> lines, FbrImportCommitCounts counts)
        {
            var map = new Dictionary<int, int?>();

            // Group by HS code so we don't create duplicate ItemTypes
            // when the same invoice has two lines for HS=8301.1000.
            var byHs = lines
                .Where(l => !string.IsNullOrWhiteSpace(l.HsCode))
                .GroupBy(l => l.HsCode);

            foreach (var grp in byHs)
            {
                var hs = grp.Key.Trim();
                var first = grp.First();

                // Re-check existence inside the tx — the preview's
                // matcher ran against a snapshot; another commit in
                // flight may have created the same row already.
                int? itemTypeId = await _context.ItemTypes
                    .Where(it => it.HSCode == hs)
                    .Select(it => (int?)it.Id)
                    .FirstOrDefaultAsync();

                if (!itemTypeId.HasValue)
                {
                    // Description fallback — rare given the FBR rows mostly
                    // have descriptions, but keeps the matcher's secondary
                    // index honoured here too.
                    if (!string.IsNullOrWhiteSpace(first.Description))
                    {
                        itemTypeId = await _context.ItemTypes
                            .Where(it => it.Name == first.Description)
                            .Select(it => (int?)it.Id)
                            .FirstOrDefaultAsync();
                    }
                }

                if (!itemTypeId.HasValue)
                {
                    // Auto-create. 4-digit HS codes get IsHsCodePartial=true
                    // so the operator's sales pickers can hide them until
                    // the full PCT is set. Description blank → use "HS XXXX".
                    var fallbackName = string.IsNullOrWhiteSpace(first.Description)
                        ? $"HS {hs}"
                        : first.Description;
                    var isPartial = !hs.Contains('.');
                    var itemType = new ItemType
                    {
                        Name = fallbackName,
                        HSCode = hs,
                        UOM = first.Uom,
                        SaleType = first.SaleType,
                        FbrDescription = first.Description,
                        IsFavorite = false,         // not curated; keep out of "favorites" until operator promotes
                        IsHsCodePartial = isPartial,
                        CreatedAt = DateTime.UtcNow,
                    };
                    _context.ItemTypes.Add(itemType);
                    await _context.SaveChangesAsync();
                    itemTypeId = itemType.Id;
                    counts.ItemTypesCreated++;
                }

                foreach (var line in grp)
                {
                    map[line.SourceRowNumber] = itemTypeId;
                }
            }

            // Lines without HS code shouldn't appear here (filter blocks),
            // but defensively map them to null so the caller can still
            // emit the PurchaseItem with ItemTypeId=null.
            foreach (var line in lines)
            {
                if (!map.ContainsKey(line.SourceRowNumber)) map[line.SourceRowNumber] = null;
            }

            return map;
        }

        private static decimal Round2(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);
    }
}

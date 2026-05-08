using MyApp.Api.DTOs;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    // ── FBR Purchase Import Service ─────────────────────────────────────
    //
    // Orchestrates the parse → filter → match → group pipeline for the
    // Phase 1 preview. Each stage is a pure, testable component (parser
    // / filter / matcher) — this class just glues them together and
    // shapes the response DTO the frontend renders.
    //
    // Reads only — never writes to the database.

    public class FbrPurchaseImportService : IFbrPurchaseImportService
    {
        private readonly IFbrPurchaseLedgerParser _parser;
        private readonly IFbrPurchaseImportFilter _filter;
        private readonly IFbrPurchaseImportMatcher _matcher;
        private readonly IFbrPurchaseImportCommitter _committer;
        private readonly ILogger<FbrPurchaseImportService> _logger;

        public FbrPurchaseImportService(
            IFbrPurchaseLedgerParser parser,
            IFbrPurchaseImportFilter filter,
            IFbrPurchaseImportMatcher matcher,
            IFbrPurchaseImportCommitter committer,
            ILogger<FbrPurchaseImportService> logger)
        {
            _parser = parser;
            _filter = filter;
            _matcher = matcher;
            _committer = committer;
            _logger = logger;
        }

        public async Task<FbrImportCommitResponse> CommitAsync(
            Stream fileStream, string originalFileName, int companyId, int? userId)
        {
            // The commit path re-runs Preview's pipeline (parse → filter
            // → match → group). This is intentionally stateless: the
            // operator gets the same decisions they saw in Preview, and
            // a malicious frontend can't inject "treat this skipped row
            // as importable" by editing the response in-flight.
            var preview = await PreviewAsync(fileStream, originalFileName, companyId);

            var response = new FbrImportCommitResponse
            {
                FileName = originalFileName,
                CompanyId = companyId,
                CommittedAt = DateTime.UtcNow,
                CommittedByUserId = userId,
                Counts = new FbrImportCommitCounts
                {
                    PreviewDecisionCounts = preview.Summary.DecisionCounts,
                },
                Warnings = preview.Warnings,
            };

            // Walk every preview invoice. The committer decides per-
            // invoice whether to write (mixed-decision invoices commit
            // their importable lines and surface the rest as part of
            // the running counts via the preview report).
            foreach (var inv in preview.Invoices)
            {
                var hasImportable = inv.Lines.Any(l =>
                    l.Decision == ImportDecision.WillImport ||
                    l.Decision == ImportDecision.ProductWillCreate);

                if (!hasImportable)
                {
                    response.Counts.InvoicesSkipped++;
                    response.Invoices.Add(new FbrImportCommitInvoiceResult
                    {
                        FbrInvoiceRefNo = inv.FbrInvoiceRefNo,
                        SupplierNtn = inv.SupplierNtn,
                        SupplierName = inv.SupplierName,
                        InvoiceNo = inv.InvoiceNo,
                        Outcome = "skipped",
                        LineCount = inv.Lines.Count,
                    });
                    continue;
                }

                var oneResult = await _committer.CommitOneInvoiceAsync(
                    companyId, userId, inv, response.Counts);
                response.Invoices.Add(oneResult);

                switch (oneResult.Outcome)
                {
                    case "imported": response.Counts.InvoicesImported++; break;
                    case "skipped":  response.Counts.InvoicesSkipped++;  break;
                    case "failed":
                        response.Counts.InvoicesFailed++;
                        _logger.LogWarning("FBR import: invoice {InvoiceNo} failed: {Error}",
                            inv.InvoiceNo, oneResult.ErrorMessage);
                        break;
                }
            }

            return response;
        }

        public async Task<FbrImportPreviewResponse> PreviewAsync(
            Stream fileStream, string originalFileName, int companyId)
        {
            var response = new FbrImportPreviewResponse();
            response.Summary.FileName = originalFileName;
            response.Summary.CompanyId = companyId;

            // Stage 1 — parse. Workbook-level warnings (sheet missing,
            // header missing, etc.) bubble up to response.Warnings; per-
            // row parse warnings travel ON the row and the filter
            // promotes them to failed-validation.
            var parsed = _parser.Parse(fileStream, originalFileName);
            response.Warnings.AddRange(parsed.WorkbookWarnings);
            response.Summary.TotalRows = parsed.Rows.Count;
            if (parsed.Rows.Count == 0) return response;

            // Stage 2 — pre-fetch lookups in one round-trip apiece.
            // Loading all suppliers + item types up front keeps the
            // matcher loop allocation-free for 500+ row files.
            var supplierLookup = await _matcher.LoadSuppliersAsync(companyId);
            var itemTypeLookup = await _matcher.LoadItemTypesAsync(companyId);

            // Stage 3 — pre-decide each line based on filter rules. A
            // row that passes the filter (DecideOrCandidate returns null)
            // is a "candidate" line — it goes to the matcher to decide
            // already-exists vs will-import.
            var rowDecisions = new List<(FbrPurchaseLedgerRow row, string? earlyDecision)>();
            foreach (var r in parsed.Rows)
            {
                rowDecisions.Add((r, _filter.DecideOrCandidate(r)));
            }

            // Stage 4 — group rows by base invoice number. Rows that
            // failed early in the filter still get grouped under the
            // strip-suffix base so the operator sees the WHOLE invoice
            // even if some lines were dropped — context matters when
            // diagnosing why a row was skipped.
            var groups = rowDecisions
                .GroupBy(rd => InvoiceGroupKey(rd.row))
                .ToList();

            response.Summary.TotalInvoices = groups.Count;

            foreach (var group in groups)
            {
                var first = group.First().row;
                var baseInvoiceNo = _matcher.StripLineSuffix(first.InvoiceNo ?? "");
                var supplierNtn = (first.SellerNtn ?? "").Trim();

                // Aggregate line totals for the dedup check. Use the
                // ValueExclTax + SalesTax + ExtraTax + StWithheld sum
                // when TotalValueOfSales is missing (some rows skip it).
                decimal totalValueExclTax = 0m;
                decimal totalSalesTax = 0m;
                decimal totalGross = 0m;
                foreach (var (row, _) in group)
                {
                    totalValueExclTax += row.ValueExclTax ?? 0m;
                    totalSalesTax     += row.SalesTax    ?? 0m;
                    totalGross        += row.TotalValueOfSales ?? 0m;
                }
                if (totalGross == 0m) totalGross = totalValueExclTax + totalSalesTax;

                int? matchedSupplierId = null;
                if (!string.IsNullOrWhiteSpace(supplierNtn) &&
                    supplierLookup.SupplierIdByNtn.TryGetValue(supplierNtn, out var sId))
                {
                    matchedSupplierId = sId;
                }
                else if (!string.IsNullOrWhiteSpace(first.SellerName) &&
                         supplierLookup.SupplierIdByName.TryGetValue(first.SellerName.Trim(), out var sIdByName))
                {
                    matchedSupplierId = sIdByName;
                }

                int? matchedPurchaseBillId = null;
                if (!string.IsNullOrWhiteSpace(supplierNtn) &&
                    !string.IsNullOrWhiteSpace(baseInvoiceNo) &&
                    first.InvoiceDate.HasValue &&
                    totalGross > 0m)
                {
                    matchedPurchaseBillId = await _matcher.FindMatchingPurchaseBillIdAsync(
                        companyId, supplierNtn, baseInvoiceNo,
                        first.InvoiceDate.Value, totalGross);
                }

                var invoiceDto = new FbrImportPreviewInvoiceDto
                {
                    FbrInvoiceRefNo = first.FbrInvoiceRefNo ?? "",
                    SupplierNtn = supplierNtn,
                    SupplierName = first.SellerName ?? "",
                    InvoiceNo = baseInvoiceNo,
                    InvoiceDate = first.InvoiceDate,
                    TotalValueExclTax = totalValueExclTax,
                    TotalGstAmount = totalSalesTax,
                    TotalGrossValue = totalGross,
                    MatchedSupplierId = matchedSupplierId,
                    MatchedPurchaseBillId = matchedPurchaseBillId,
                };

                // Per-line decision. If the filter already decided
                // (skip / failed-validation), we use that. Otherwise we
                // either inherit "already-exists" from the bill-level
                // dedup, or emit will-import / product-will-be-created
                // depending on whether ItemType matched.
                foreach (var (row, earlyDecision) in group)
                {
                    var line = BuildLine(row, itemTypeLookup);

                    if (earlyDecision != null)
                    {
                        line.Decision = earlyDecision;
                    }
                    else if (matchedPurchaseBillId.HasValue)
                    {
                        line.Decision = ImportDecision.AlreadyExists;
                    }
                    else
                    {
                        line.Decision = line.MatchedItemTypeId.HasValue
                            ? ImportDecision.WillImport
                            : ImportDecision.ProductWillCreate;
                    }
                    invoiceDto.Lines.Add(line);
                }

                invoiceDto.Decision = AggregateDecision(invoiceDto.Lines);
                response.Invoices.Add(invoiceDto);

                CountDecision(response.Summary.DecisionCounts, invoiceDto.Lines);
            }

            // Sort invoices: import-worthy first so the operator sees
            // the "things you should review" at the top.
            response.Invoices = response.Invoices
                .OrderBy(i => DecisionPriority(i.Decision))
                .ThenByDescending(i => i.InvoiceDate)
                .ToList();

            return response;
        }

        private static FbrImportPreviewLineDto BuildLine(FbrPurchaseLedgerRow row, ItemTypeLookup catalog)
        {
            var line = new FbrImportPreviewLineDto
            {
                SourceRowNumber = row.SourceRowNumber,
                HsCode = row.HsCode ?? "",
                Description = row.ProductDescription ?? "",
                Quantity = row.Quantity ?? 0m,
                Uom = row.Uom ?? "",
                ValueExclTax = row.ValueExclTax ?? 0m,
                GstRate = row.Rate,
                GstAmount = row.SalesTax,
                ExtraTax = row.ExtraTax,
                StWithheldAtSource = row.StWithheldAtSource,
                FixedNotifiedValueOrRetailPrice = row.FixedNotifiedValueOrRetailPrice,
                SaleType = row.SaleType,
                SroScheduleNo = row.SroScheduleNo,
                SroItemSerialNo = row.ItemSerialNo,
            };

            // HS Code → ItemType (primary)
            if (!string.IsNullOrWhiteSpace(row.HsCode) &&
                catalog.ItemTypeIdByHsCode.TryGetValue(row.HsCode.Trim(), out var byHsId))
            {
                line.MatchedItemTypeId = byHsId;
                line.MatchedItemTypeName = catalog.NameById.GetValueOrDefault(byHsId);
                line.MatchedBy = "hs-code";
            }
            // Description → ItemType (fallback)
            else if (!string.IsNullOrWhiteSpace(row.ProductDescription) &&
                     catalog.ItemTypeIdByName.TryGetValue(row.ProductDescription.Trim(), out var byNameId))
            {
                line.MatchedItemTypeId = byNameId;
                line.MatchedItemTypeName = catalog.NameById.GetValueOrDefault(byNameId);
                line.MatchedBy = "description";
            }
            else
            {
                line.MatchedBy = "none";
            }

            return line;
        }

        // Group key — the invoice number with line suffix stripped, plus
        // the seller NTN as a tiebreaker for the rare case where two
        // suppliers happen to use the same invoice number on the same
        // export.
        private string InvoiceGroupKey(FbrPurchaseLedgerRow r)
        {
            var baseNo = _matcher.StripLineSuffix(r.InvoiceNo ?? "");
            return $"{(r.SellerNtn ?? "").Trim()}|{baseNo}";
        }

        // Bill-level decision is the "winning" line decision in priority
        // order: an invoice with even ONE will-import line surfaces as
        // will-import; otherwise it's "already-exists" if any line is
        // that, etc.
        private static string AggregateDecision(IList<FbrImportPreviewLineDto> lines)
        {
            if (lines.Count == 0) return ImportDecision.FailedValidation;
            var ranked = new[]
            {
                ImportDecision.WillImport,
                ImportDecision.ProductWillCreate,
                ImportDecision.AlreadyExists,
                ImportDecision.FailedValidation,
                ImportDecision.SkipNoHsCode,
                ImportDecision.SkipZeroQty,
                ImportDecision.SkipNoDescription,
                ImportDecision.SkipUnregisteredSeller,
                ImportDecision.SkipAlreadyClaimed,
                ImportDecision.SkipCancelled,
                ImportDecision.SkipWrongType,
            };
            foreach (var d in ranked)
            {
                if (lines.Any(l => l.Decision == d)) return d;
            }
            return lines[0].Decision;
        }

        private static int DecisionPriority(string decision) => decision switch
        {
            ImportDecision.WillImport => 0,
            ImportDecision.ProductWillCreate => 1,
            ImportDecision.AlreadyExists => 2,
            ImportDecision.FailedValidation => 3,
            ImportDecision.SkipNoHsCode => 4,
            ImportDecision.SkipAlreadyClaimed => 5,
            _ => 6,
        };

        private static void CountDecision(FbrImportDecisionCounts c, IList<FbrImportPreviewLineDto> lines)
        {
            foreach (var l in lines)
            {
                switch (l.Decision)
                {
                    case ImportDecision.WillImport:         c.WillImport++; break;
                    case ImportDecision.ProductWillCreate:  c.ProductWillCreate++; break;
                    case ImportDecision.AlreadyExists:      c.AlreadyExists++; break;
                    case ImportDecision.SkipAlreadyClaimed:    c.SkipAlreadyClaimed++; break;
                    case ImportDecision.SkipUnregisteredSeller: c.SkipUnregisteredSeller++; break;
                    case ImportDecision.SkipCancelled:         c.SkipCancelled++; break;
                    case ImportDecision.SkipWrongType:      c.SkipWrongType++; break;
                    case ImportDecision.SkipNoHsCode:       c.SkipNoHsCode++; break;
                    case ImportDecision.SkipZeroQty:        c.SkipZeroQty++; break;
                    case ImportDecision.SkipNoDescription:  c.SkipNoDescription++; break;
                    case ImportDecision.FailedValidation:   c.FailedValidation++; break;
                }
            }
        }
    }
}

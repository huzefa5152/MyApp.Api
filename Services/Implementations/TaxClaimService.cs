using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    // ── Tax Claim Service (Phase B — Pakistan compliance shape) ────────
    //
    // Computes the per-HS-Code "input tax bank" + per-sale match the
    // Invoices-tab edit panel renders.
    //
    // Pakistan Sales Tax rules applied:
    //   • Section 8A — purchases must be within 6 months of the bill
    //     date. Older purchases are excluded from the bank.
    //   • Section 8B — input claim ≤ 90% of output tax for the period;
    //     excess defers to next period as carry-forward.
    //   • IRIS reconciliation — only PurchaseBills whose
    //     ReconciliationStatus is in the configured allow-list count
    //     toward claimable. Default = ["Matched", "Pending"]. ManualOnly
    //     bills (no IRN) are NEVER claimable but surface in a separate
    //     "pending review" tally.
    //   • Per-sale matching — claim is bounded by THIS bill's qty at
    //     weighted-average unit cost, NOT the entire bank balance.
    //
    // Effective HS Code resolution: ItemType.HSCode (canonical) takes
    // precedence over PurchaseItem.HSCode / InvoiceItem.HSCode (legacy
    // / manually-typed). Same logic as Phase A's bug-fix.
    //
    // The service is informational — never blocks a save. The frontend
    // surfaces shortfalls / no-purchase / aging warnings; the operator
    // may still save the bill and reconcile later.

    public class TaxClaimService : ITaxClaimService
    {
        private readonly AppDbContext _context;
        private readonly IConfiguration _config;

        public TaxClaimService(AppDbContext context, IConfiguration config)
        {
            _context = context;
            _config = config;
        }

        // Phase A entry-point — kept for back-compat. Phase B's richer
        // entry-point is GetClaimSummaryAsync (below).
        public async Task<TaxClaimSummaryResponse> GetHsStockSummaryAsync(
            int companyId, IList<string> hsCodes)
        {
            // Build a pseudo-request with no current-bill rows — gives
            // bank/pending data without the per-sale match.
            var request = new TaxClaimSummaryRequest
            {
                CompanyId = companyId,
                BillDate = DateTime.UtcNow,
                BillGstRate = 0m,
                BillRows = (hsCodes ?? new List<string>())
                    .Where(c => !string.IsNullOrWhiteSpace(c))
                    .Select(c => new TaxClaimBillRow { HsCode = c.Trim(), Qty = 0m, Value = 0m })
                    .ToList(),
                PeriodCode = "this-month",
            };
            return await GetClaimSummaryAsync(request);
        }

        public async Task<TaxClaimSummaryResponse> GetClaimSummaryAsync(TaxClaimSummaryRequest request)
        {
            var cfg = ReadConfig();
            var period = ResolvePeriod(request.PeriodCode, request.BillDate);
            var billDate = request.BillDate == default ? DateTime.UtcNow.Date : request.BillDate.Date;
            var agingCutoff = billDate.AddMonths(-cfg.AgingMonths);
            // Soon-to-expire window — purchases between (cutoff + 5mo)
            // and (cutoff + 6mo) age out within ~30 days.
            var soonCutoff = billDate.AddMonths(-(cfg.AgingMonths - 1));

            var hsCodes = (request.BillRows ?? new List<TaxClaimBillRow>())
                .Where(r => !string.IsNullOrWhiteSpace(r.HsCode))
                .Select(r => r.HsCode.Trim())
                .Distinct(StringComparer.Ordinal)
                .ToList();

            var response = new TaxClaimSummaryResponse
            {
                CompanyId = request.CompanyId,
                ComputedAt = DateTime.UtcNow,
                Period = period,
                Config = cfg,
            };

            if (hsCodes.Count == 0) return response;

            var billByHs = (request.BillRows ?? new List<TaxClaimBillRow>())
                .Where(r => !string.IsNullOrWhiteSpace(r.HsCode))
                .GroupBy(r => r.HsCode.Trim())
                .ToDictionary(
                    g => g.Key,
                    g => new TaxClaimBillRow
                    {
                        HsCode = g.Key,
                        ItemTypeName = g.Select(r => r.ItemTypeName)
                                        .FirstOrDefault(n => !string.IsNullOrWhiteSpace(n)) ?? "",
                        Qty = g.Sum(r => r.Qty),
                        Value = g.Sum(r => r.Value),
                    });

            // ── Purchases (current period, IRIS-allowed, §8A-aged) ─────
            // 2026-05-11: now also pulling PurchaseBillId / BillNumber /
            // SupplierBillNumber / ReconciliationStatus so the
            // optimization step can build a per-purchase-bill reference
            // list AND derive the realistic unit-price band (min/max
            // across actual purchase bills). Without these the
            // suggestion has no audit anchor and can recommend a unit
            // price wildly outside what the operator has ever paid.
            var rawPurchases = await (
                from pi in _context.PurchaseItems.AsNoTracking()
                join pb in _context.PurchaseBills.AsNoTracking() on pi.PurchaseBillId equals pb.Id
                join it in _context.ItemTypes.AsNoTracking() on pi.ItemTypeId equals it.Id into itJoin
                from it in itJoin.DefaultIfEmpty()
                where pb.CompanyId == request.CompanyId
                   && pb.Date >= agingCutoff
                   && cfg.ClaimableReconciliationStatuses.Contains(pb.ReconciliationStatus)
                   && ((it != null && it.HSCode != null && hsCodes.Contains(it.HSCode))
                        || (pi.HSCode != null && hsCodes.Contains(pi.HSCode)))
                select new
                {
                    pi.PurchaseBillId,
                    PurchaseBillNumber = pb.PurchaseBillNumber,
                    pb.SupplierBillNumber,
                    pb.ReconciliationStatus,
                    pi.Quantity,
                    pi.LineTotal,
                    BillRate = pb.GSTRate,
                    BillDate = pb.Date,
                    ItemTypeHs = it != null ? it.HSCode : null,
                    RowHs = pi.HSCode,
                }
            ).ToListAsync();

            var purchaseAgg = rawPurchases
                .Select(x => new
                {
                    Hs = !string.IsNullOrWhiteSpace(x.ItemTypeHs) ? x.ItemTypeHs! : x.RowHs!,
                    x.Quantity, x.LineTotal, x.BillRate, x.BillDate,
                })
                .Where(x => !string.IsNullOrWhiteSpace(x.Hs))
                .GroupBy(x => x.Hs)
                .ToDictionary(g => g.Key, g => new
                {
                    Qty = g.Sum(x => x.Quantity),
                    Value = g.Sum(x => x.LineTotal),
                    Tax = g.Sum(x => x.LineTotal * (x.BillRate / 100m)),
                    OldestDate = g.Min(x => x.BillDate),
                });

            // Per-purchase-bill rollup, by HS code. Each entry is one
            // physical purchase bill the operator actually has on file.
            // Used to:
            //   • derive Min/Max unit cost (the audit-defensible band)
            //   • emit a top-N reference list (PB #10001 — 1889 qty @
            //     Rs. 312/unit) the operator can show during an audit
            // We keep ALL bills here (not just top-N) so the band is
            // accurate; ReferencePurchaseBills picks the recent ones.
            var purchaseBillAgg = rawPurchases
                .Select(x => new
                {
                    Hs = !string.IsNullOrWhiteSpace(x.ItemTypeHs) ? x.ItemTypeHs! : x.RowHs!,
                    x.PurchaseBillId,
                    x.PurchaseBillNumber,
                    x.SupplierBillNumber,
                    x.ReconciliationStatus,
                    x.Quantity, x.LineTotal, x.BillRate, x.BillDate,
                })
                .Where(x => !string.IsNullOrWhiteSpace(x.Hs))
                .GroupBy(x => new { x.Hs, x.PurchaseBillId })
                .Select(g => new
                {
                    g.Key.Hs,
                    g.Key.PurchaseBillId,
                    PurchaseBillNumber = g.First().PurchaseBillNumber,
                    SupplierBillNumber = g.First().SupplierBillNumber,
                    ReconciliationStatus = g.First().ReconciliationStatus,
                    BillDate = g.Max(x => x.BillDate),
                    BillRate = g.First().BillRate,
                    Qty = g.Sum(x => x.Quantity),
                    Value = g.Sum(x => x.LineTotal),
                })
                .Where(b => b.Qty > 0m)
                .GroupBy(b => b.Hs)
                .ToDictionary(g => g.Key, g => g.OrderByDescending(b => b.BillDate).ToList());

            // ── Pending purchases (have IRN, not yet claimable) ────────
            // Bills WITH an IRN whose ReconciliationStatus isn't in the
            // claimable allow-list AND isn't Disputed. Become claimable
            // once IRIS confirms. Disputed bills get their own bucket
            // below — operator needs to act, not just wait.
            var rawPending = await (
                from pi in _context.PurchaseItems.AsNoTracking()
                join pb in _context.PurchaseBills.AsNoTracking() on pi.PurchaseBillId equals pb.Id
                join it in _context.ItemTypes.AsNoTracking() on pi.ItemTypeId equals it.Id into itJoin
                from it in itJoin.DefaultIfEmpty()
                where pb.CompanyId == request.CompanyId
                   && pb.Date >= agingCutoff
                   && pb.ReconciliationStatus != "ManualOnly"
                   && pb.ReconciliationStatus != "Disputed"
                   && !cfg.ClaimableReconciliationStatuses.Contains(pb.ReconciliationStatus)
                   && ((it != null && it.HSCode != null && hsCodes.Contains(it.HSCode))
                        || (pi.HSCode != null && hsCodes.Contains(pi.HSCode)))
                select new
                {
                    pi.PurchaseBillId,
                    pi.Quantity,
                    pi.LineTotal,
                    BillRate = pb.GSTRate,
                    ItemTypeHs = it != null ? it.HSCode : null,
                    RowHs = pi.HSCode,
                }
            ).ToListAsync();

            var pendingAgg = rawPending
                .Select(x => new
                {
                    Hs = !string.IsNullOrWhiteSpace(x.ItemTypeHs) ? x.ItemTypeHs! : x.RowHs!,
                    x.PurchaseBillId, x.Quantity, x.LineTotal, x.BillRate,
                })
                .Where(x => !string.IsNullOrWhiteSpace(x.Hs))
                .GroupBy(x => x.Hs)
                .ToDictionary(g => g.Key, g => new
                {
                    Qty = g.Sum(x => x.Quantity),
                    Value = g.Sum(x => x.LineTotal),
                    Tax = g.Sum(x => x.LineTotal * (x.BillRate / 100m)),
                    BillCount = g.Select(x => x.PurchaseBillId).Distinct().Count(),
                });

            // ── ManualOnly purchases (no IRN — never claimable) ─────────
            // Bills entered manually without a SupplierIRN. Stock
            // Dashboard counts them as inventory but they CAN'T back an
            // input-tax claim under FBR rules. Surface separately so
            // the operator sees the gap and can backfill the IRN.
            // No aging filter here — the operator should see ALL their
            // ManualOnly inventory regardless of bill age, because the
            // "missing IRN" is a fixable data issue not a tax-rule issue.
            var rawManualOnly = await (
                from pi in _context.PurchaseItems.AsNoTracking()
                join pb in _context.PurchaseBills.AsNoTracking() on pi.PurchaseBillId equals pb.Id
                join it in _context.ItemTypes.AsNoTracking() on pi.ItemTypeId equals it.Id into itJoin
                from it in itJoin.DefaultIfEmpty()
                where pb.CompanyId == request.CompanyId
                   && pb.ReconciliationStatus == "ManualOnly"
                   && ((it != null && it.HSCode != null && hsCodes.Contains(it.HSCode))
                        || (pi.HSCode != null && hsCodes.Contains(pi.HSCode)))
                select new
                {
                    pi.PurchaseBillId,
                    pi.Quantity,
                    pi.LineTotal,
                    BillRate = pb.GSTRate,
                    ItemTypeHs = it != null ? it.HSCode : null,
                    RowHs = pi.HSCode,
                }
            ).ToListAsync();

            var manualOnlyAgg = rawManualOnly
                .Select(x => new
                {
                    Hs = !string.IsNullOrWhiteSpace(x.ItemTypeHs) ? x.ItemTypeHs! : x.RowHs!,
                    x.PurchaseBillId, x.Quantity, x.LineTotal, x.BillRate,
                })
                .Where(x => !string.IsNullOrWhiteSpace(x.Hs))
                .GroupBy(x => x.Hs)
                .ToDictionary(g => g.Key, g => new
                {
                    Qty = g.Sum(x => x.Quantity),
                    Value = g.Sum(x => x.LineTotal),
                    Tax = g.Sum(x => x.LineTotal * (x.BillRate / 100m)),
                    BillCount = g.Select(x => x.PurchaseBillId).Distinct().Count(),
                });

            // ── Disputed purchases (IRIS rejected the match) ────────────
            // Status = "Disputed" — IRIS actively rejected the supplier
            // match. Worse than Pending: requires the operator to fix
            // the underlying issue (re-issue the bill, contact supplier).
            // Surfaced separately with red treatment in the UI so it's
            // not silently bucketed with "pending — will resolve".
            var rawDisputed = await (
                from pi in _context.PurchaseItems.AsNoTracking()
                join pb in _context.PurchaseBills.AsNoTracking() on pi.PurchaseBillId equals pb.Id
                join it in _context.ItemTypes.AsNoTracking() on pi.ItemTypeId equals it.Id into itJoin
                from it in itJoin.DefaultIfEmpty()
                where pb.CompanyId == request.CompanyId
                   && pb.Date >= agingCutoff
                   && pb.ReconciliationStatus == "Disputed"
                   && ((it != null && it.HSCode != null && hsCodes.Contains(it.HSCode))
                        || (pi.HSCode != null && hsCodes.Contains(pi.HSCode)))
                select new
                {
                    pi.PurchaseBillId,
                    pi.Quantity,
                    pi.LineTotal,
                    BillRate = pb.GSTRate,
                    ItemTypeHs = it != null ? it.HSCode : null,
                    RowHs = pi.HSCode,
                }
            ).ToListAsync();

            var disputedAgg = rawDisputed
                .Select(x => new
                {
                    Hs = !string.IsNullOrWhiteSpace(x.ItemTypeHs) ? x.ItemTypeHs! : x.RowHs!,
                    x.PurchaseBillId, x.Quantity, x.LineTotal, x.BillRate,
                })
                .Where(x => !string.IsNullOrWhiteSpace(x.Hs))
                .GroupBy(x => x.Hs)
                .ToDictionary(g => g.Key, g => new
                {
                    Qty = g.Sum(x => x.Quantity),
                    Value = g.Sum(x => x.LineTotal),
                    Tax = g.Sum(x => x.LineTotal * (x.BillRate / 100m)),
                    BillCount = g.Select(x => x.PurchaseBillId).Distinct().Count(),
                });

            // ── Sales (current period, in window) ──────────────────────
            // Within window of (period.From .. period.To) — these are
            // sales that have already consumed input tax this period.
            // We don't filter by the aging window here because sales
            // don't age — they're always "this period's" output.
            // 2026-05-12: dual-book overlay (narrowed scope).
            // The overlay carries ONLY numerical fields — qty + line
            // total — because Item Type / HS Code / UOM / Sale Type
            // are legitimate bill data and live on InvoiceItem
            // directly. So bank depletion uses adjusted qty/value but
            // ItemType-driven HS routing always comes from InvoiceItem.
            var rawSales = await (
                from ii in _context.InvoiceItems.AsNoTracking()
                join inv in _context.Invoices.AsNoTracking() on ii.InvoiceId equals inv.Id
                join adj in _context.InvoiceItemAdjustments.AsNoTracking() on ii.Id equals adj.InvoiceItemId into adjJoin
                from adj in adjJoin.DefaultIfEmpty()
                let effQuantity   = adj != null && adj.AdjustedQuantity  != null ? adj.AdjustedQuantity.Value  : ii.Quantity
                let effLineTotal  = adj != null && adj.AdjustedLineTotal != null ? adj.AdjustedLineTotal.Value : ii.LineTotal
                join it in _context.ItemTypes.AsNoTracking() on ii.ItemTypeId equals it.Id into itJoin
                from it in itJoin.DefaultIfEmpty()
                where inv.CompanyId == request.CompanyId
                   && !inv.IsDemo
                   && (period.From == null || inv.Date >= period.From)
                   && (period.To   == null || inv.Date <  period.To)
                   && ((it != null && it.HSCode != null && hsCodes.Contains(it.HSCode))
                        || (ii.HSCode != null && hsCodes.Contains(ii.HSCode)))
                select new
                {
                    Quantity   = effQuantity,
                    LineTotal  = effLineTotal,
                    InvRate    = inv.GSTRate,
                    ItemTypeHs = it != null ? it.HSCode : null,
                    RowHs      = ii.HSCode,
                }
            ).ToListAsync();

            var salesAgg = rawSales
                .Select(x => new
                {
                    Hs = !string.IsNullOrWhiteSpace(x.ItemTypeHs) ? x.ItemTypeHs! : x.RowHs!,
                    x.Quantity, x.LineTotal, x.InvRate,
                })
                .Where(x => !string.IsNullOrWhiteSpace(x.Hs))
                .GroupBy(x => x.Hs)
                .ToDictionary(g => g.Key, g => new
                {
                    Qty = g.Sum(x => x.Quantity),
                    Value = g.Sum(x => x.LineTotal),
                    Tax = g.Sum(x => x.LineTotal * (x.InvRate / 100m)),
                });

            // ── Carry-forward proxy ─────────────────────────────────────
            // Crude: lifetime claimable purchase tax minus lifetime sale
            // tax (across ALL HS codes). When sales > purchases lifetime
            // it's 0 (we owe more than we ever bought). Honest answer
            // requires per-claim tracking which we don't have yet.
            decimal lifetimePurchaseTax = await (
                from pi in _context.PurchaseItems.AsNoTracking()
                join pb in _context.PurchaseBills.AsNoTracking() on pi.PurchaseBillId equals pb.Id
                where pb.CompanyId == request.CompanyId
                   && cfg.ClaimableReconciliationStatuses.Contains(pb.ReconciliationStatus)
                select pi.LineTotal * (pb.GSTRate / 100m)
            ).SumAsync();
            decimal lifetimeSaleTax = await (
                from ii in _context.InvoiceItems.AsNoTracking()
                join inv in _context.Invoices.AsNoTracking() on ii.InvoiceId equals inv.Id
                // 2026-05-11: dual-book overlay applied here too, so
                // the carry-forward proxy reflects the FBR-side line
                // totals on adjusted bills.
                join adj in _context.InvoiceItemAdjustments.AsNoTracking() on ii.Id equals adj.InvoiceItemId into adjJoin
                from adj in adjJoin.DefaultIfEmpty()
                let effLineTotal = adj != null && adj.AdjustedLineTotal != null ? adj.AdjustedLineTotal.Value : ii.LineTotal
                where inv.CompanyId == request.CompanyId && !inv.IsDemo
                select effLineTotal * (inv.GSTRate / 100m)
            ).SumAsync();
            decimal currentPeriodSaleTax = salesAgg.Values.Sum(s => s.Tax);
            // Approximate: net unclaimed = lifetime input − lifetime
            // output, then subtract this period's already-counted
            // output to avoid double-counting in the headline.
            var carryForwardFromPrior = Math.Max(0m,
                lifetimePurchaseTax - (lifetimeSaleTax - currentPeriodSaleTax));

            // ── Build per-HS rows + totals ──────────────────────────────
            decimal totalBillOutputTax = 0m;
            decimal totalMatchedInputTax = 0m;
            var rows = new List<HsClaimRow>();
            var warnings = new List<string>();

            foreach (var hs in hsCodes)
            {
                billByHs.TryGetValue(hs, out var bill);
                purchaseAgg.TryGetValue(hs, out var pur);
                pendingAgg.TryGetValue(hs, out var pen);
                manualOnlyAgg.TryGetValue(hs, out var man);
                disputedAgg.TryGetValue(hs, out var dis);
                salesAgg.TryGetValue(hs, out var sal);

                bill ??= new TaxClaimBillRow { HsCode = hs };

                var purchasedQty   = pur?.Qty   ?? 0m;
                var purchasedValue = pur?.Value ?? 0m;
                var purchasedTax   = pur?.Tax   ?? 0m;
                var soldQty   = sal?.Qty   ?? 0m;
                var soldValue = sal?.Value ?? 0m;
                var soldTax   = sal?.Tax   ?? 0m;
                var availableQty   = Math.Max(0m, purchasedQty   - soldQty);
                var availableValue = Math.Max(0m, purchasedValue - soldValue);
                var availableTax   = Math.Max(0m, purchasedTax   - soldTax);
                var avgUnitCost = purchasedQty > 0m ? purchasedValue / purchasedQty : 0m;
                var avgUnitTax  = purchasedQty > 0m ? purchasedTax  / purchasedQty : 0m;

                // Per-bill unit-cost band — drawn from actual purchase
                // bills, not synthesized. Drives the audit-defensible
                // unit-price clamp downstream.
                purchaseBillAgg.TryGetValue(hs, out var billsForHs);
                var minUnitCost = 0m;
                var maxUnitCost = 0m;
                var purchaseBillCount = 0;
                if (billsForHs != null && billsForHs.Count > 0)
                {
                    var unitPrices = billsForHs
                        .Where(b => b.Qty > 0m)
                        .Select(b => b.Value / b.Qty)
                        .Where(p => p > 0m)
                        .ToList();
                    if (unitPrices.Count > 0)
                    {
                        minUnitCost = unitPrices.Min();
                        maxUnitCost = unitPrices.Max();
                    }
                    purchaseBillCount = billsForHs.Count;
                }

                var bank = new HsBankSnapshot
                {
                    PurchasedQty = R4(purchasedQty),
                    PurchasedValue = R2(purchasedValue),
                    PurchasedTax = R2(purchasedTax),
                    SoldQty = R4(soldQty),
                    SoldValue = R2(soldValue),
                    SoldTax = R2(soldTax),
                    AvailableQty = R4(availableQty),
                    AvailableValue = R2(availableValue),
                    AvailableTax = R2(availableTax),
                    AvgUnitCost = R4(avgUnitCost),
                    AvgUnitTax = R4(avgUnitTax),
                    MinUnitCost = R4(minUnitCost),
                    MaxUnitCost = R4(maxUnitCost),
                    PurchaseBillCount = purchaseBillCount,
                    OldestPurchaseDate = pur?.OldestDate,
                    ExpiringWithin30Days = pur != null && pur.OldestDate < soonCutoff,
                };

                var pending = new HsPendingSnapshot
                {
                    BillCount = pen?.BillCount ?? 0,
                    Qty   = R4(pen?.Qty   ?? 0m),
                    Value = R2(pen?.Value ?? 0m),
                    Tax   = R2(pen?.Tax   ?? 0m),
                };

                var manualOnly = new HsManualOnlySnapshot
                {
                    BillCount = man?.BillCount ?? 0,
                    Qty   = R4(man?.Qty   ?? 0m),
                    Value = R2(man?.Value ?? 0m),
                    Tax   = R2(man?.Tax   ?? 0m),
                };

                var disputed = new HsDisputedSnapshot
                {
                    BillCount = dis?.BillCount ?? 0,
                    Qty   = R4(dis?.Qty   ?? 0m),
                    Value = R2(dis?.Value ?? 0m),
                    Tax   = R2(dis?.Tax   ?? 0m),
                };

                // Per-sale match — this is THE Phase B core change.
                // Clamp at zero on BOTH sides so a negative qty (operator
                // typo or downstream bug) can't produce a negative
                // matchedQty/matchedInputTax/outputTax that would inflate
                // the headline numbers when summed across rows.
                var billQtyClamped   = Math.Max(0m, bill.Qty);
                var billValueClamped = Math.Max(0m, bill.Value);
                var matchedQty = Math.Max(0m, Math.Min(billQtyClamped, availableQty));
                var matchedInputTax = matchedQty * avgUnitTax;
                var unmatchedQty = Math.Max(0m, billQtyClamped - availableQty);
                var outputTax = Math.Max(0m, billValueClamped * (request.BillGstRate / 100m));

                var match = new HsBillMatch
                {
                    MatchedQty = R4(matchedQty),
                    MatchedInputTax = R2(matchedInputTax),
                    UnmatchedQty = R4(unmatchedQty),
                    OutputTax = R2(outputTax),
                };

                totalBillOutputTax += outputTax;
                totalMatchedInputTax += matchedInputTax;

                // Status decision. Priority when claimable bank is empty:
                //   disputed-only > pending-only > manual-only > no-purchase
                // Disputed gets the worst severity because IRIS actively
                // rejected it — operator must act, not just wait.
                string status;
                if (purchasedQty <= 0m)
                {
                    if      ((dis?.Qty ?? 0m) > 0m)               status = "disputed-only";
                    else if ((pen?.Qty ?? 0m) > 0m)               status = "pending-only";
                    else if ((man?.Qty ?? 0m) > 0m)               status = "manual-only";
                    else                                          status = "no-purchase";
                }
                else if (billQtyClamped <= 0m)                    status = "good";
                else if (unmatchedQty > 0m)                       status = "shortfall";
                else if (availableQty > billQtyClamped)           status = "headroom";
                else                                              status = "good";

                // ── Optimization suggestion (2026-05-09) ─────────────
                // For each HS row, compute the qty × unit_price split at
                // the §8B "break-even" — the unit price where matched
                // input exactly equals the §8B 90% cap. Below that price
                // the cap binds and the operator is effectively paying
                // the floor 10% net rate; above that price the matched
                // input becomes the bottleneck and the per-row claim
                // stays at qty × avgUnitTax regardless of how much
                // output tax piles up.
                //
                // The suggestion holds bill.Value (the subtotal) constant
                // and shows how many units at what price would unlock
                // the maximum legitimate input claim against THIS HS bank.
                // Constraints:
                //   • If suggested qty > availableQty, snap to availableQty
                //     and recompute unit_price = value / availableQty.
                //   • Per-row matched input is capped at availableTax
                //     (can't claim more than the bank holds).
                //   • Skip the suggestion when there's nothing meaningful
                //     to show (no bank, zero gst, current row already at
                //     or near break-even).
                HsClaimOptimization? optimization = null;
                var gst = request.BillGstRate / 100m;
                if (gst > 0m && avgUnitTax > 0m && availableQty > 0m && billValueClamped > 0m)
                {
                    // ── Step 1: math optimum (cap-binding break-even) ─
                    // unitPriceBE = avgUnitTax / (cap%/100 × gst). 90%
                    // is the standard Pakistan §8B value; the bill-wide
                    // Totals path reads the configured cap, but per-row
                    // we hard-code so the math stays local. Below this
                    // price the §8B cap binds (claim = 90% of output);
                    // above it the matched input bottlenecks.
                    var capFraction = 0.9m;
                    var mathOptUnitPrice = avgUnitTax / (capFraction * gst);

                    // ── Step 2: realistic band from real purchase bills ─
                    // Lower bound = lowest unit price ever paid for this HS.
                    //   An auditor accepts "sold at cost / clearance" but
                    //   NOT "sold at 1/10th of cost" — that's a fabrication
                    //   pattern.
                    // Upper bound = weighted-avg cost × 1.5 (typical retail
                    //   markup ceiling). Used for an audit-risk note when
                    //   the math optimum sits ABOVE the band (rare — only
                    //   when input tax is much larger than typical).
                    // If we have no bill-level granularity (single bulk
                    // bill), fall back to avgUnitCost ± a tight band so we
                    // don't suggest absurd prices.
                    decimal realisticLow, realisticHigh;
                    if (minUnitCost > 0m && maxUnitCost > 0m)
                    {
                        realisticLow  = minUnitCost;
                        realisticHigh = avgUnitCost * 1.5m;
                    }
                    else
                    {
                        realisticLow  = avgUnitCost * 0.9m;  // 10% below cost = absolute floor
                        realisticHigh = avgUnitCost * 1.5m;
                    }

                    // ── Step 3: target unit price (math opt clamped to band) ─
                    // This is just the IDEAL — the divisor enumeration in
                    // Step 4 picks an integer qty whose corresponding
                    // unit_price approximates this target while preserving
                    // the bill subtotal exactly. The final audit-risk note
                    // is computed AFTER step 4 against the actually-picked
                    // unit price (which may differ from this target).
                    var anchoredUnitPrice = mathOptUnitPrice;
                    if (anchoredUnitPrice < realisticLow) anchoredUnitPrice = realisticLow;
                    if (anchoredUnitPrice > realisticHigh) anchoredUnitPrice = realisticHigh;

                    // ── Step 4: clean integer factorization at anchored price ─
                    // Goal: pick an integer qty where qty × unit_price (with
                    // unit_price as a 2-decimal money value) recomposes to
                    // EXACTLY the original bill subtotal. We do this by
                    // enumerating ALL divisors of billCents (= subtotal × 100)
                    // in [1, availableQtyLong] and picking the one closest
                    // to qtyIdeal. Every divisor d gives unit_price =
                    // billCents/d/100 with no rounding loss — so the
                    // subtotal is preserved to the paisa.
                    //
                    // 2026-05-11: switched from a narrow ±300 bidirectional
                    // scan around startQty to full divisor enumeration. The
                    // old search occasionally missed a divisor (e.g. when
                    // the nearest one sat at delta > 300) and fell through
                    // to the rounded fallback, producing Rs. 0.35-ish
                    // drift. Enumerating divisors is O(√N) — ~30k iter
                    // for a Rs. 10m bill — and ALWAYS finds at least one
                    // hit (worst case qty=1, unit_price=full subtotal).
                    var qtyIdeal = anchoredUnitPrice > 0m ? billValueClamped / anchoredUnitPrice : 0m;
                    var billCents = (long)Math.Round(billValueClamped * 100m);
                    var availableQtyLong = (long)Math.Floor(availableQty);
                    var realisticLowCents = (long)Math.Round(realisticLow * 100m);
                    var realisticHighCents = (long)Math.Round(realisticHigh * 100m);

                    // Enumerate ALL divisors of billCents in [1, availableQtyLong].
                    // Each divisor d yields a unit_price = billCents/d/100 with
                    // ZERO rounding loss. Then pick the best one in three tiers:
                    //
                    //   Tier 1 (preferred): unit_price ∈ [realisticLow, realisticHigh]
                    //                       → among these, the LARGEST qty wins
                    //                       (largest qty = lowest unit_price in band
                    //                        = most input tax claim while staying
                    //                        audit-defensible).
                    //   Tier 2 (fallback):  unit_price ABOVE realisticHigh.
                    //                       Rare; picks smallest qty in band.
                    //   Tier 3 (last resort): unit_price BELOW realisticLow.
                    //                       Picks the qty closest to qtyIdeal.
                    //                       The audit-risk note flags this.
                    //
                    // 2026-05-11: full divisor enumeration replaces the old
                    // ±300 bidirectional scan, eliminating the Rs. 0.35-ish
                    // drift the operator saw when no divisor sat within the
                    // search window. O(√billCents) ≈ 30k iter — fast.
                    long cleanQty = 0;
                    long bestTier1Qty = 0;   // largest qty with unit_price in band
                    long bestTier2Qty = long.MaxValue; // smallest qty above band (closest from above)
                    long bestTier3Qty = 0;
                    decimal bestTier3Dist = decimal.MaxValue;
                    if (billCents > 0 && availableQtyLong >= 1)
                    {
                        for (long d = 1; d * d <= billCents; d++)
                        {
                            if (billCents % d != 0) continue;
                            long d1 = d;
                            long d2 = billCents / d;
                            foreach (var cand in new[] { d1, d2 })
                            {
                                if (cand < 1 || cand > availableQtyLong) continue;
                                long unitCents = billCents / cand;  // unit_price × 100
                                if (unitCents >= realisticLowCents && unitCents <= realisticHighCents)
                                {
                                    // Tier 1 — in band. Bigger qty = lower unit price
                                    // in band = more claim. Prefer the largest.
                                    if (cand > bestTier1Qty) bestTier1Qty = cand;
                                }
                                else if (unitCents > realisticHighCents)
                                {
                                    // Tier 2 — unit price above ceiling.
                                    // Pick the smallest qty (= price closest to
                                    // ceiling) so we stay reasonable.
                                    if (cand < bestTier2Qty) bestTier2Qty = cand;
                                }
                                else
                                {
                                    // Tier 3 — unit price below floor. Closest
                                    // to qtyIdeal wins; the auditNote already
                                    // warned about this case.
                                    var dist = Math.Abs((decimal)cand - qtyIdeal);
                                    if (dist < bestTier3Dist)
                                    {
                                        bestTier3Dist = dist;
                                        bestTier3Qty = cand;
                                    }
                                }
                            }
                        }

                        if (bestTier1Qty > 0)       cleanQty = bestTier1Qty;
                        else if (bestTier2Qty != long.MaxValue) cleanQty = bestTier2Qty;
                        else                        cleanQty = bestTier3Qty;
                    }

                    decimal suggestedQty;
                    decimal suggestedUnitPrice;
                    // Bank-exhausted = the ideal qty exceeds what's left in
                    // the bank. We still pick the largest clean divisor
                    // ≤ availableQty so the subtotal stays exact; this
                    // path just signals to the UI that we couldn't reach
                    // the math optimum because of the bank ceiling.
                    bool bankExhausted = qtyIdeal > availableQty;
                    if (cleanQty > 0)
                    {
                        suggestedQty = cleanQty;
                        suggestedUnitPrice = (decimal)(billCents / cleanQty) / 100m;
                    }
                    else
                    {
                        // Only possible if availableQty < 1 (bank effectively
                        // empty) or billCents == 0 (guarded earlier). Last-
                        // resort: snap qty to availableQty floor with rounded
                        // unit_price. Drift up to Rs. 1 — caller's narrow-
                        // edit tolerance absorbs it.
                        suggestedQty = Math.Max(1L, availableQtyLong);
                        suggestedUnitPrice = suggestedQty > 0m
                            ? Math.Round(billValueClamped / suggestedQty, 2, MidpointRounding.AwayFromZero)
                            : 0m;
                        bankExhausted = true;
                    }

                    var recomposed = suggestedQty * suggestedUnitPrice;
                    var exactSubtotal = Math.Abs(recomposed - billValueClamped) < 0.005m;

                    var suggestedMatched = Math.Min(suggestedQty * avgUnitTax, availableTax);
                    var additional = suggestedMatched - matchedInputTax;

                    // ── Audit-risk grading (computed against the FINAL pick) ─
                    // Now that the divisor enumeration has selected a
                    // concrete suggestedUnitPrice, grade audit risk based
                    // on where it actually lands relative to the realistic
                    // band — not against the unconstrained math optimum.
                    //
                    //   low      — suggestedUnitPrice ∈ [realisticLow, realisticHigh]
                    //   moderate — suggestedUnitPrice < realisticLow by ≤ 25%
                    //   high     — suggestedUnitPrice < realisticLow by > 25%
                    //
                    // Tier 2 (above ceiling) is graded "low" with a note —
                    // an FBR auditor rarely flags a high-priced sale, that
                    // direction inflates output tax for the seller's loss.
                    string auditRisk;
                    string auditNote;
                    var withinBand = suggestedUnitPrice >= realisticLow && suggestedUnitPrice <= realisticHigh;
                    if (withinBand)
                    {
                        auditRisk = "low";
                        auditNote = $"Suggested unit price Rs. {R2(suggestedUnitPrice):0.##} " +
                            $"sits inside the actual purchase range " +
                            $"Rs. {R2(realisticLow):0.##} – Rs. {R2(realisticHigh):0.##} " +
                            $"({purchaseBillCount} purchase bill{(purchaseBillCount == 1 ? "" : "s")} " +
                            $"on file). Audit-defensible.";
                    }
                    else if (suggestedUnitPrice < realisticLow)
                    {
                        var pctBelow = realisticLow > 0m
                            ? (realisticLow - suggestedUnitPrice) / realisticLow
                            : 0m;
                        if (pctBelow <= 0.25m)
                        {
                            auditRisk = "moderate";
                            auditNote = $"Suggested unit price (Rs. {R2(suggestedUnitPrice):0.##}/unit) is below your " +
                                $"lowest actual purchase price (Rs. {R2(realisticLow):0.##}) — " +
                                $"defensible as a clearance/discount sale, but keep a note of why " +
                                $"you priced this low.";
                        }
                        else
                        {
                            auditRisk = "high";
                            auditNote = $"Suggested unit price (Rs. {R2(suggestedUnitPrice):0.##}/unit) is FAR below " +
                                $"any actual purchase price you have on file " +
                                $"(min Rs. {R2(realisticLow):0.##}). No clean integer factorization " +
                                $"of Rs. {R2(billValueClamped):0.##} lands inside the realistic band — " +
                                $"consider invoicing at the natural price or splitting the line.";
                        }
                    }
                    else
                    {
                        auditRisk = "low";
                        auditNote = $"Suggested unit price (Rs. {R2(suggestedUnitPrice):0.##}/unit) sits above " +
                            $"your typical retail markup ceiling (Rs. {R2(realisticHigh):0.##}). " +
                            $"Audit risk on the buyer side is low — high price means more output tax for you, " +
                            $"not less.";
                    }

                    // Only surface when the improvement is meaningful AND
                    // the audit risk isn't catastrophic. We DO still show
                    // moderate/high risk — operators need to see the
                    // ceiling that's possible — but the warning sits
                    // prominently in the card.
                    var hasMeaningfulGain = additional >= 50m && additional >= outputTax * 0.01m;
                    if (hasMeaningfulGain)
                    {
                        // ── Step 5: reference purchase bills (top 5 most recent) ─
                        var referenceBills = (billsForHs ?? new())
                            .Take(5)
                            .Select(b => new PurchaseBillReference
                            {
                                PurchaseBillId = b.PurchaseBillId,
                                BillNumber = !string.IsNullOrWhiteSpace(b.SupplierBillNumber)
                                    ? $"PB #{b.PurchaseBillNumber} ({b.SupplierBillNumber})"
                                    : $"PB #{b.PurchaseBillNumber}",
                                Date = b.BillDate,
                                Qty = R4(b.Qty),
                                Value = R2(b.Value),
                                UnitPrice = b.Qty > 0m ? R2(b.Value / b.Qty) : 0m,
                                UnitTax = b.Qty > 0m ? R2((b.Value * (b.BillRate / 100m)) / b.Qty) : 0m,
                                ReconciliationStatus = b.ReconciliationStatus ?? "",
                            })
                            .ToList();

                        string rationale;
                        if (bankExhausted)
                        {
                            rationale = $"Bank caps the suggestion at {R4(availableQty):0.####} qty " +
                                $"(all that's left under HS {hs}). At {R4(suggestedQty):0.####} × Rs. {R2(suggestedUnitPrice):0.##} " +
                                $"the §8B cap binds first — claim rises from Rs. {R2(matchedInputTax):0.##} to Rs. {R2(suggestedMatched):0.##}.";
                        }
                        else
                        {
                            rationale = $"Splitting Rs. {R2(billValueClamped):0.##} into {R4(suggestedQty):0.####} units of Rs. {R2(suggestedUnitPrice):0.##} " +
                                $"each preserves the original subtotal exactly — claim rises from Rs. {R2(matchedInputTax):0.##} " +
                                $"to Rs. {R2(suggestedMatched):0.##} (Rs. {R2(additional):0.##} extra input tax claimable).";
                        }

                        optimization = new HsClaimOptimization
                        {
                            HasSuggestion = true,
                            SuggestedQty = R4(suggestedQty),
                            SuggestedUnitPrice = R2(suggestedUnitPrice),
                            CurrentMatchedInputTax = R2(matchedInputTax),
                            SuggestedMatchedInputTax = R2(suggestedMatched),
                            AdditionalClaimableInputTax = R2(additional),
                            BankExhaustedAtSuggestion = bankExhausted,
                            ExactSubtotalPreserved = exactSubtotal,
                            RecomposedSubtotal = R2(recomposed),
                            Rationale = rationale,
                            MathOptimalUnitPrice = R2(mathOptUnitPrice),
                            RealisticBandLow = R2(realisticLow),
                            RealisticBandHigh = R2(realisticHigh),
                            AvgPurchaseUnitCost = R2(avgUnitCost),
                            WithinRealisticBand = withinBand,
                            AuditRiskLevel = auditRisk,
                            AuditRiskNote = auditNote,
                            ReferencePurchaseBills = referenceBills,
                        };
                    }
                }

                rows.Add(new HsClaimRow
                {
                    HsCode = hs,
                    ItemTypeName = bill.ItemTypeName,
                    Bill = new TaxClaimBillRow
                    {
                        HsCode = hs,
                        ItemTypeName = bill.ItemTypeName,
                        Qty = R4(billQtyClamped),
                        Value = R2(billValueClamped),
                    },
                    Bank = bank,
                    Pending = pending,
                    ManualOnly = manualOnly,
                    Disputed = disputed,
                    Match = match,
                    Status = status,
                    Optimization = optimization,
                });

                // Aging warning per HS
                if (bank.ExpiringWithin30Days)
                {
                    warnings.Add(
                        $"{hs} — oldest purchase from {bank.OldestPurchaseDate:dd-MMM-yyyy} ages out within 30 days. " +
                        $"Use it this period or carry-forward expires."
                    );
                }
                if (pending.BillCount > 0)
                {
                    warnings.Add(
                        $"{hs} — {pending.BillCount} bill{(pending.BillCount != 1 ? "s" : "")} " +
                        $"(Rs. {pending.Tax:N0} input tax) not yet IRIS-reconciled. Claimable once supplier files."
                    );
                }
                if (manualOnly.BillCount > 0)
                {
                    warnings.Add(
                        $"{hs} — {manualOnly.BillCount} bill{(manualOnly.BillCount != 1 ? "s" : "")} " +
                        $"({fmt(manualOnly.Qty)} qty, would unlock Rs. {manualOnly.Tax:N0} input tax) " +
                        $"entered without an IRN. Inventory IS tracked but FBR won't accept the claim " +
                        $"until you backfill the SupplierIRN. Edit the Purchase Bill to add it."
                    );
                }
                if (disputed.BillCount > 0)
                {
                    warnings.Add(
                        $"{hs} — {disputed.BillCount} bill{(disputed.BillCount != 1 ? "s" : "")} " +
                        $"({fmt(disputed.Qty)} qty, Rs. {disputed.Tax:N0} input tax) marked Disputed " +
                        $"by IRIS. Re-issue the bill or contact the supplier; not claimable while " +
                        $"in this state."
                    );
                }
                if (status == "no-purchase" && billQtyClamped > 0m)
                {
                    warnings.Add(
                        $"{hs} — no eligible purchases on record. Output tax has no input backing; " +
                        $"the operator may proceed but should record a supplier purchase before filing."
                    );
                }
                static string fmt(decimal v) => v.ToString("N4", CultureInfo.InvariantCulture).TrimEnd('0').TrimEnd('.');
            }

            // ── Section 8B 90% cap ──────────────────────────────────────
            var section8BCap = totalBillOutputTax * (cfg.Section8BCapPercent / 100m);
            var claimableThisBill = Math.Min(totalMatchedInputTax, section8BCap);
            var section8BCarryForward = Math.Max(0m, totalMatchedInputTax - section8BCap);
            var section8BCapApplied = totalMatchedInputTax > section8BCap && section8BCap > 0m;

            if (section8BCapApplied)
            {
                warnings.Add(
                    $"Section 8B cap engaged — Rs. {section8BCarryForward:N0} of matched input " +
                    $"deferred to next period (capped at {cfg.Section8BCapPercent}% of output tax)."
                );
            }

            // §8A is measured from the bill date (so the panel shows "what
            // the §8A picture looked like FOR that bill's return month").
            // If the bill is ≥30 days old AND the operator is editing it
            // today, surface a heads-up — late-filing it now would have
            // a stricter §8A window than what we're showing.
            if (billDate <= DateTime.Now.Date.AddDays(-30))
            {
                warnings.Add(
                    $"Bill date is {(DateTime.Now.Date - billDate).Days} days old — §8A aging " +
                    $"shown is measured FROM the bill date. If you're filing this late, the §8A " +
                    $"window FBR will apply at filing time may be stricter."
                );
            }

            response.Rows = rows;
            response.Totals = new TaxClaimTotals
            {
                BillOutputTax = R2(totalBillOutputTax),
                MatchedInputTax = R2(totalMatchedInputTax),
                Section8BCap = R2(section8BCap),
                ClaimableThisBill = R2(claimableThisBill),
                Section8BCarryForward = R2(section8BCarryForward),
                Section8BCapApplied = section8BCapApplied,
                CarryForwardFromPrior = R2(carryForwardFromPrior),
                NetNewTax = R2(Math.Max(0m, totalBillOutputTax - claimableThisBill)),
            };
            response.Warnings = warnings;
            return response;
        }

        // ── Helpers ─────────────────────────────────────────────────────

        private ComplianceConfig ReadConfig()
        {
            var cap = _config.GetValue<int?>("TaxCompliance:Section8BCapPercent") ?? 90;
            var aging = _config.GetValue<int?>("TaxCompliance:AgingMonths") ?? 6;
            var statuses = _config.GetSection("TaxCompliance:ClaimableReconciliationStatuses")
                .Get<List<string>>() ?? new List<string> { "Matched", "Pending" };
            return new ComplianceConfig
            {
                Section8BCapPercent = cap,
                AgingMonths = aging,
                ClaimableReconciliationStatuses = statuses,
            };
        }

        private static TaxClaimPeriod ResolvePeriod(string? code, DateTime billDate)
        {
            var c = (code ?? "").Trim().ToLowerInvariant();
            var anchor = billDate == default ? DateTime.Now.Date : billDate.Date;

            DateTime from, to; string label;
            switch (c)
            {
                case "last-month":
                    var firstThis = new DateTime(anchor.Year, anchor.Month, 1);
                    from = firstThis.AddMonths(-1);
                    to = firstThis;
                    label = "Last Month";
                    break;
                case "this-quarter":
                    var qStartMonth = ((anchor.Month - 1) / 3) * 3 + 1;
                    from = new DateTime(anchor.Year, qStartMonth, 1);
                    to = from.AddMonths(3);
                    label = "This Quarter";
                    break;
                case "year-to-date":
                    from = new DateTime(anchor.Year, 1, 1);
                    to = from.AddYears(1);
                    label = "Year to Date";
                    break;
                case "all-time":
                    return new TaxClaimPeriod { Code = "all-time", Label = "All Time", From = null, To = null };
                case "this-month":
                default:
                    from = new DateTime(anchor.Year, anchor.Month, 1);
                    to = from.AddMonths(1);
                    label = "This Month";
                    break;
            }

            return new TaxClaimPeriod
            {
                Code = string.IsNullOrEmpty(c) ? "this-month" : c,
                Label = label,
                From = from,
                To = to,
            };
        }

        private static decimal R2(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);
        private static decimal R4(decimal v) => Math.Round(v, 4, MidpointRounding.AwayFromZero);
    }
}

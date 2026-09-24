# Dashboard KPIs for an importer

**Date:** 2026-09-17
**Branch:** `feat/importer-ledger-receipts` (importer production line)
**Status:** design approved, not yet implemented
**Depends on:** `2026-09-17-cogs-relief-declared-basis-design.md` — two cards need COGS to exist

## The problem

The hero band shows four cards. For this line's customers, two of them say
nothing and the two biggest numbers in the business are missing.

`Total Purchases` reads **0** because an importer does not buy on purchase
bills — stock arrives through opening stock and GD costing. `Net (Sales −
Purchases)` therefore restates Total Sales exactly: **Rs 11,427,745** on
company 4, presented next to a trending-up arrow as though it were profit. Real
gross profit is about **−6,195**. The card is wrong by the entire sales figure.

Meanwhile `Inventory on hand` (22,297,874.00) and `Accounts receivable`
(11,427,745.40, not one rupee collected) appear nowhere on the dashboard.

`Total Sales` is also tax-INCLUSIVE, which is what started the investigation
that produced this spec: the operator compared it against an ex-tax stock sheet
and nothing on screen explained the difference.

## Who this is for

The four real companies on this line:

| Co | Name | Invoices | Sales excl | Purchase bills | Opening stock | GDs |
|---|---|---|---|---|---|---|
| 4 | Alpha Traders | 37 | 9,684,530.00 | 0 | 22,297,874.00 | 1 |
| 5 | AY TRADERS | 25 | 13,213,791.40 | 0 | 72,736,594.04 | 2 |
| 6 | PAK TRADE CO | 15 | 5,510,879.68 | 0 | 67,572,405.25 | 6 |
| 8 | R & R Engineering | 0 | 0.00 | 0 | 0.00 | 0 |

Companies 9/10/11 are demo data and are not a design input. Every trading
customer is a pure importer; company 8 is configured but has not started.

## Decisions taken

| Question | Decision |
|---|---|
| Layout | **One layout.** A card renders when it has something to say |
| Payables | **Everything owed**, with the breakdown visible |
| Receivables | Shown, with an overdue split |
| Basis | Declared, consistent with the COGS spec |

### Why one layout, not two

An earlier draft proposed detecting importer versus bill-buyer and switching
layouts. That was reasoning from demo data: the only companies with purchase
bills are demo. Two layouts would be maintained and tested for a case no
customer has.

Instead the dashboard extends the hiding it already does. It hides cards by
permission today (`showSales`, `showPurchases`); this adds "and by whether the
concept has any data for this company". A company with no purchase bill ever
gets no Purchases and no Net. That is one code path, it is right for the three
importers now, and it is right for R & R Engineering whichever way it develops —
without anyone predicting which that is.

## The cards

Shown in this order, each subject to its existing permission flag AND to having
data:

1. **Total Sales** — headline stays tax-inclusive (Rs 11,427,745), with
   **excluding tax (Rs 9,684,530) as a secondary line on the card**. This one
   change answers the question that caused the original investigation.
2. **Cost of Goods Sold** — declared basis. Needs the COGS work.
3. **Gross Profit** — Sales excl − COGS, with margin %. Needs the COGS work.
   Will read ≈0 for these companies; that is the honest declared-basis picture
   and is documented in the COGS spec.
4. **Stock on Hand** — value at declared basis. The importer's largest number,
   currently invisible.
5. **Receivables** — outstanding, split current versus overdue. `Invoice`
   already carries `DueDate`, `AmountPaid` and a derived balance through
   `PaymentStatusCalculator`, so no new data is needed.
6. **Payables** — everything owed, totalled, with the split shown:
   `AccountsPayable` (2) + `OutputTax` (7) + `FurtherTaxPayable` (19) +
   `WithholdingPayable` (10) + `ImportClearing` (20). On company 4 this reads
   1,743,215.40, all of it FBR output tax. A trade-creditors-only figure would
   read 0.00 and teach the operator nothing.

`Total Purchases` and `Net (Sales − Purchases)` keep their current behaviour and
simply do not render when the company has no purchase bills.

`GST Net (Output − Input)` stays as-is: it is the period's FBR position, which
is a different question from the cumulative Output Tax balance inside Payables.

### Empty state

A company with no activity at all — company 8 today — gets a single "no
activity yet" panel rather than six zero-value cards.

## Period handling

Dashboard periods are arbitrary (All Time, month, year, custom); COGS entries
are monthly. The dashboard therefore **computes COGS and gross profit for the
exact selected range from the same `StockValuation` walk the ledger posting
uses**, rather than summing monthly journal entries.

Both derive from one walk, so a whole-month selection agrees with the ledger by
construction, and a partial range is still exact rather than silently including
a whole month's cost.

## Frontend notes

`Components/dashboard/KpiCard.jsx` takes `label`, `value`, `prevValue`,
`accent`, `format`, `trend`, `higherIsBetter`, `title`, `icon`. It has **no
secondary-value prop** — one is needed for the ex-tax line on Total Sales and
the overdue/breakdown lines on Receivables and Payables. Add an optional
`subValue` (string or node) rendered under the main figure; existing call sites
are unaffected.

`higherIsBetter={false}` on Payables, as with the existing GST card.

Responsive per CLAUDE.md §3: verify at **375 / 768 / 1280**. The hero grid is
already `auto-fit` with no media queries, so going from four cards to six needs
checking rather than rewriting — particularly that the phone layout stays one
column with no horizontal scroll, and that `subValue` does not overflow.

## Testing

- Backend: extend the dashboard KPI tests for the new figures, and add a
  tenant-isolation case for any new endpoint per CLAUDE.md.
- A company with no purchase bills renders neither Purchases nor Net.
- A company with no activity renders the empty state.
- Payables totals every listed control type, not just trade creditors.
- Gross profit for a whole-month selection equals the ledger's COGS entry for
  that month.
- Responsive check at 375 / 768 / 1280 before calling it done.

## Non-goals

- Actual-landed-cost margin on the dashboard. The ledger is declared basis;
  mixing bases in one hero band would mislead.
- Per-invoice margin.
- Any change to the Sales-by-Client or Purchases-by-Supplier sections.

## Open, tracked elsewhere

The nine backfilled GDs on companies 4/5/6 carry **20,889,096.91 of input sales
tax** and **8,889,480.91 of advance income tax on imports** that never reached
the ledger, because every consignment ran in `backfill` mode and that mode posts
nothing by design. Both are recoverable assets, so a "what FBR owes us" card
would read zero today and be wrong.

The maintainer has asked to investigate before anything is posted — if those
amounts were already claimed in the previous system, posting them would
double-count. **Until that is settled, this dashboard shows no recoverable-tax
card.**

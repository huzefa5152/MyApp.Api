# Invoice Sales Detail — period presets, filters and a professional grid

Date: 2026-09-25 · Branch: `feat/importer-ledger-receipts` · Status: approved design

## Goal

Rebuild the Reports ▸ Invoice Sales Detail screen so it looks and behaves like
the other reports: a compact page in the app's blue/teal theme, the shared
period presets (This Month, This Year, Custom range, …), three filters, and a
grid an accountant would call professional. **The Excel workbook does not
change**: same sheet, columns, headers, number formats, totals row, widths,
freeze and autofilter. Only what is on screen changes, plus which bills the
period and filters select.

## Decisions (maintainer, 2026-09-25)

- Grid: one row per item line (as the Excel), grouped by bill — a bill's
  date, number, challan, buyer, NTN, address and FBR fields print once, on its
  first line, and its lines share a band.
- Filters beside the period: Search, FBR status, Customer.
- Header actions: Excel, Print, PDF (the Accounting Reports row).
- Excel keeps its current format exactly.

## Server

`GET /api/reports/company/{id}/invoice-sales-detail` and `.../excel` take one
query shape (`InvoiceSalesDetailQueryDto`):

| Param | Meaning |
|---|---|
| `period` | `thisMonth` `lastMonth` `today` `thisWeek` `thisQuarter` `thisYear` `lastYear` `custom` — resolved by `Helpers/ReportPeriod` on Pakistan time, exactly as Accounting Reports |
| `from`, `to` | the custom range (both required, `from <= to`) |
| `year`, `month` | legacy: honoured only when `period` is absent (old links keep working) |
| `search` | bill-level: a bill is listed when its number, challan, buyer, NTN, FBR number, or any line's HS code / description contains the text (case-insensitive, max 100 chars) |
| `fbrStatus` | `submitted` (FBR status Submitted and not cancelled at FBR) or `notSubmitted` (everything else) — the same split as the existing counts |
| `clientId` | one buyer; a buyer of another company simply matches nothing |

- No `period` and no `year`/`month` → This Month.
- `allPeriods`, or any value `ReportPeriod.ParsePreset` does not know, is
  refused: this report returns every line in one response, so it needs a
  bounded period. Messages are operator wording, 400.
- Figures are computed exactly as today (per-line GST apportioning, advance and
  further tax on the first line, cancelled bills listed AND counted).
- The response adds `from`, `to`, `generatedAt`, `cancelledCount` and
  `buyers` (`clientId`, `name`, `ntn`) — every buyer with a bill in the
  PERIOD, before the other filters, so the picker never shrinks to the one
  customer chosen. It carries nothing the rows do not already show.
- `periodLabel` becomes `ReportPeriod.DescribeRange` ("1 Aug 2026 – 31 Aug
  2026"), as on every other report. Nothing in the Excel reads it.
- Excel: the builder is untouched; it receives the same filtered report. File
  name: a window that is exactly one calendar month keeps today's
  `Invoice-Sales-Detail-2026-08.xlsx`; any other range is
  `Invoice-Sales-Detail-2026-01-01_to_2026-12-31.xlsx`.

## Screen

Top to bottom:

1. Title row (icon + "Invoice Sales Detail") with the company picker on the
   right when there is more than one company.
2. `ReportFilterBar` (the Accounting Reports bar): Period select (presets
   without "All Periods"), custom From/To, Search, a Filters toggle holding
   Customer and FBR status, Apply. Applied filters show as removable chips.
   Filters live in the URL, like Accounting Reports.
3. The shared report header (gradient band, "Reports" crumb, title, company ·
   period · generated, the applied filters, one muted line: "Every bill dated in
   the period, filed with FBR or not. Cancelled bills stay listed and count in
   the totals. Buyer address and NTN are the buyer's current details.") with
   Excel (export permission only), Print and PDF.
4. The shared total tiles, compact: Bills (with "N cancelled" under it when
   any), Submitted, Not submitted, Excl, G. S. T, 236-G / 236-H and Further tax
   (only when non-zero), Total incl taxes.
5. The grid (desktop, >= 768px):
   - Two header rows: Bill (Date, Inv No, DC No) · Buyer (Party, NTN, Address)
     · Item (HS Code, Description, Unit, Qty, Rate) · Sales tax (Excl, Tax
     Rate, G. S. T, Incl) · Other taxes (236-G / 236-H, Further) · Total · FBR
     (Status, FBR Invoice No) · Bill status. All 21 columns stay.
   - The grid scrolls inside its own box: the header stays in view, the Bill
     columns stay frozen on the left, the totals row stays pinned at the foot.
   - Bill-level cells only on a bill's first line; bills alternate bands; a
     firmer rule between bills; hover highlight.
   - FBR status and bill status as chips; a cancelled bill is greyed with a
     "Cancelled" chip (still in the totals, as now).
   - Party, address and description clamp to two lines with the full text in
     a tooltip; numbers are tabular and right-aligned.
   - Totals row: "Total · N bills, M lines" and the money columns for every
     bill the filters select (all pages).
   - Pages by BILL (default 50, the shared page-size choices), so a bill is
     never split across pages.
6. Phone (< 768px): one card per bill with its lines, the three key amounts
   and its chips.

Print / PDF: the shared builder, landscape, 16 columns (Address, Unit, Incl,
FBR Invoice No and Bill status stay in the Excel). They print the bills on the
current page, as Accounting Reports print their current page; when there is
more than one page the provenance line says which bills.

## Shared components (no change for existing screens)

- `ReportFilterBar`: optional `periodOptions`, `clientOptions` (used instead
  of fetching the client list — no customer PII leaves the report),
  `statusOptions` + `statusLabel`, `searchPlaceholder`. "Clear filters" keeps
  a custom range's dates (it dropped them, leaving a custom period that could
  not run).
- `ReportShell`: its header and tiles move into exported `ReportHeader` and
  `TotalsStrip` (ReportShell renders them exactly as before); `buildReportHtml`
  is exported and honours an optional `sourceLabel`; `TotalsStrip` takes an
  optional `compact` and per-tile `notes`.

## Tests and proof

- `scripts/test_invoice_sales_detail.py` (live): presets vs custom vs legacy,
  default period, refusals, each filter, the buyers list, totals = rows,
  Excel rows = screen rows, file names, another company 403, export needs the
  export permission. Cleans up after itself.
- `scripts/test_invoice_sales_detail.mjs` (offline): params, grouping,
  paging by bill, print envelope, file name, status tones.
- Excel proof: the 11 local company-months captured before the change are
  re-exported after it and compared cell by cell (values, formats, fills,
  fonts, widths, freeze, autofilter).
- Browser: 1280 / 768 / 375, sticky header / frozen columns / pinned totals,
  filters, paging, one Accounting report unchanged.

## Out of scope

The Excel layout; whether cancelled bills count in the totals; the Accounting
Sales Detail report.

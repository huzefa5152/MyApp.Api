# Bill entry redesign — design

Date: 2026-09-24 · Branch: `feat/importer-ledger-receipts` · Approach A (shared
pieces first, then each screen) chosen by the maintainer, who delegated the
remaining decisions while away. Transient: delete once the maintainer has
reviewed the result (the README changelog is the durable record).

## Goal

One consistent, self-explanatory bill-entry experience for an importer's
data-entry operator, on every screen that shows a bill:

| Screen | File |
|---|---|
| New Bill (No Challan) | `Components/StandaloneInvoiceForm.jsx` |
| New Bill (from challan) | `Components/InvoiceForm.jsx` |
| Edit Bill / View Bill, Bills and Invoices tabs | `Components/EditBillForm.jsx` |

## Non-negotiables

- **Nothing about what is saved changes.** Request payloads, DTOs, server code
  and every calculation stay exactly as they are. This is layout, wording and
  guidance only.
- **FBR is untouched**: validate, submit, the FBR buttons and badges on the
  Invoices tab, and the payload builder.
- Permission gates and edit tiers (full edit, item type only, item type + qty,
  view, migrated) behave exactly as now.

## The operator's journey

The same numbered steps, in the same order, on every screen:

1. **FBR scenario** — opens on SN001; goods imported at 25% move a new bill to
   SN024 by themselves, with a note saying why (shipped in `8606c66`).
2. **Buyer** — with the registration status spelled out, because it decides
   the scenarios offered and whether further tax applies.
3. **Bill details** — number, date, document type, payment mode and terms, PO.
4. **Items** — search by item name or HS code; every line shows stock on hand,
   cost and the rate the goods came in at; one line explains amount-first
   entry ("type the line total — quantity and rate come from stock").
5. **Taxes & total** — GST (from the scenario), further tax (from the buyer),
   advance income tax, withholding, and the totals, each with a plain-language
   note of where it comes from.
6. **Attachments** — optional.

The challan form inserts **Challans to bill** after the buyer. The footer on
every editable screen shows what is left before saving, as a clickable list,
next to the save button — or "Ready to save".

## Shared pieces (`Components/bill/`)

- **`BillStep`** — the numbered card: number or tick, title, a one-line
  summary, status (`done`, `todo`, `warn`, `view`), a one-line instruction,
  optional collapse, and an anchor id the checklist can scroll to.
- **`BillChecklist`** — the footer status. Takes `[{ key, label, target }]`;
  shows "Ready to save" when empty, otherwise "N things to finish" and each
  item as a link that scrolls to its step or line. The rate-conflict hint
  (`TaxRateBlockHint`) becomes one of its items.
- **`BillTotals`** — the totals panel: rows of label, amount and note, the
  same on create, edit and view.
- **`billTheme.js`** — one palette and card style for bill screens.

Each piece is presentational: props in, markup out, no API calls, so each
screen keeps its own state and logic untouched.

## Screen mapping

- **No Challan** — steps 1–6. The withholding / advance / further tax inputs
  move from Bill details into step 5, beside the totals they change.
- **From challan** — scenario, buyer, challans, bill details, items, taxes &
  total, attachments.
- **Edit / View** — the same cards. View shows every card read-only and
  expanded, with no checklist; Edit keeps its tier banners and the
  total-preservation guard inside the Items card.

## Verification

In the local admin session, as an operator, on PAK TRADE CO (a copy of a real
importer): a 25% item (SN024 by itself), an 18% item, a conflict settled by a
reason, one bill created on each path, then the same bill in Edit and View on
both tabs, and a narrow (phone) width. The API suites that create bills
(`test_basic_flows.py`, `test_imported_tax_rate.py`,
`test_bill_pricing_advance_tax.py`) must stay green — they prove nothing that is
saved has moved.

## Out of scope

Server changes; FBR screens; charging 3rd Schedule GST on MRP × Qty on the
bill itself (reported separately — it changes what a bill charges).

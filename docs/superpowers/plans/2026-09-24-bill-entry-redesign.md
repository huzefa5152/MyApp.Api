# Bill Entry Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give New Bill (No Challan), New Bill (from challan), Edit Bill and View Bill one consistent, self-explanatory layout, without changing anything that is saved or filed.

**Architecture:** A pure, dependency-free module (`utils/billEntry.js`) decides the checklist and the totals rows and is tested under plain node. Four presentational pieces in `Components/bill/` render them. Each screen keeps its own state and handlers and only swaps its layout JSX for the shared pieces.

**Tech Stack:** React 19 + Vite, inline style objects (house style), react-icons/md; node scripts in `scripts/` for offline tests.

## Global Constraints

- Nothing that is saved changes: request payloads, DTOs, server code and calculations stay identical.
- FBR validate / submit / the Invoices-tab FBR buttons and badges and `FbrService` are not touched.
- Edit tiers (full, item type only, item type + qty, view, migrated) behave exactly as now.
- Mobile-first: grids use `repeat(auto-fit, minmax(min(220px, 100%), 1fr))`, tap targets >= 44 px, no `nowrap`+ellipsis on user strings.
- One commit per task, explicit paths, author huzefa5152, no AI attribution; never commit `.gitignore` (another session's change).

## File map

| File | Responsibility |
|---|---|
| `myapp-frontend/src/utils/billEntry.js` (new) | pure: anchors, rate-block wording, checklist items, totals rows |
| `scripts/test_bill_entry.mjs` (new) | node test of `billEntry.js` |
| `myapp-frontend/src/Components/bill/billTheme.js` (new) | one palette for bill screens |
| `myapp-frontend/src/Components/bill/BillStep.jsx` (new) | numbered step card |
| `myapp-frontend/src/Components/bill/BillChecklist.jsx` (new) | footer "what's left" |
| `myapp-frontend/src/Components/bill/BillTotals.jsx` (new) | totals panel with notes |
| `myapp-frontend/src/Components/TaxRateBlockHint.jsx` | delete — its wording moves to `rateBlockText`, its place to the checklist |
| `StandaloneInvoiceForm.jsx`, `InvoiceForm.jsx`, `EditBillForm.jsx` | layout only |

---

### Task 1: Shared pieces

**Files:** create the six new files above.

**Interfaces — Produces:**
- `BILL_ANCHORS` `{ scenario, buyer, challans, details, items, taxes, attachments, rate }` (strings) and `lineAnchor(key) -> "bill-line-<key>"`
- `rateBlockText({ suggestion, splitNeeded }) -> string`
- `billChecklist({ needsScenario, hasScenario, hasBuyer, billNumberOk, rateBlock, lines, extra }) -> [{ key, label, target }]` where `lines` is `[{ key, n, problem }]`
- `billTotalsRows({ subtotal, gstRate, gstAmount, scenarioCode, furtherTaxRate, furtherTaxAmount, buyerRegistered, grandTotal, withholdingAmount, withholdingRate, balanceDue, advanceTaxAmount, advanceTaxSection, advanceTaxRate, totalWithAdvance }) -> [{ key, label, amount, note, strong }]`
- `<BillStep id n title summary status help open onToggle toggleLabel>` — `status` in `done | todo | warn | optional | view`
- `<BillChecklist items readyText />`, `<BillTotals rows />`

- [ ] Step 1: write `scripts/test_bill_entry.mjs` asserting: an empty state gives `[]`; order is scenario, buyer, number, rate, lines; line labels read `Line 2: enter Qty`; targets use the anchors; totals rows reproduce today's rows exactly (subtotal, GST, further tax only when > 0, grand total, withholding + balance due only when > 0, advance + total only when > 0) with the same amounts.
- [ ] Step 2: run `node scripts/test_bill_entry.mjs` — fails (module missing).
- [ ] Step 3: write `utils/billEntry.js` and the four components.
- [ ] Step 4: run the test — passes; `npm run build` — succeeds.
- [ ] Step 5: commit.

### Task 2: New Bill (No Challan)

**Files:** modify `Components/StandaloneInvoiceForm.jsx`.

- [ ] Step 1: header gets a one-line subtitle ("Goods leave stock when you save. Steps turn green as they are complete.").
- [ ] Step 2: Steps 1–3 render through `BillStep` (ids `BILL_ANCHORS.scenario/buyer/details`), keeping each summary's JSX and each open state.
- [ ] Step 3: the items table, its hint and the rate notice become step 4 (`BILL_ANCHORS.items`); each `<tr>` gets `id={lineAnchor(r.localId)}`.
- [ ] Step 4: the WHT / advance / further tax inputs move out of Bill details into step 5 "Taxes & total" with `BillTotals` (`billTotalsRows` fed the variables the old totals box used).
- [ ] Step 5: attachments become step 6 (`status="optional"`).
- [ ] Step 6: footer: `BillChecklist` replaces the three footer messages; button disabled rule unchanged.
- [ ] Step 7: build, deploy to `wwwroot`, walk it in the pane (25% item, 18% item, conflict + reason, phone width); commit.

### Task 3: New Bill (from challan)

**Files:** modify `Components/InvoiceForm.jsx` — same pattern: steps scenario, buyer, challans, bill details, items (lines from challans), taxes & total, attachments; footer checklist. Build, walk, commit.

### Task 4: Edit and View

**Files:** modify `Components/EditBillForm.jsx` — scenario, buyer & details, items (tier banners and the totals guard inside), taxes & total with `BillTotals`, attachments; View: every step `status="view"`, no toggles, no checklist; Edit footer: checklist + existing button rules. Build, walk both tabs (Bills: View + Edit; Invoices: View), commit.

### Task 5: Close out

- [ ] README changelog entry; CLAUDE.md note on the shared pieces; delete this plan and the spec once the maintainer has reviewed (not before).
- [ ] Leave the local server running the result; report.

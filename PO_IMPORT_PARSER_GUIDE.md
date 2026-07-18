# PO Import, Generic Parser & Parser Feedback — Guide

A single reference for how a customer Purchase-Order PDF becomes a Sales Order /
Sales Quote / Delivery Challan, how the generic parser reads it, how the Parser
Feedback loop catches mistakes, and — **most importantly** — the regression
tests you MUST run before touching any of it.

> **Golden rule.** Any change to the parser (`Services/Implementations/RuleBasedPOParser.cs`)
> or the import flow (`Controllers/POImportController.cs`, `Components/POImportForm.jsx`)
> must keep BOTH regression suites green:
> 1. the offline corpus harness (`scripts/po_parser_harness`), and
> 2. the production read-only check on real uploaded PDFs (`scripts/po_parser_prod_regression.py`).
> Add new cases to the corpus for whatever you change.

---

## 1. The flow, end to end

```
Operator on a document screen (Sales Order / Sales Quote / Delivery Challan)
        │  clicks "Import PO", uploads the customer's PO PDF
        ▼
POST /api/poimport/parse-pdf?companyId=N        (POImportController)
        │  1. PdfPig extracts raw text
        │  2. POFormatRegistry.FindMatchAsync fingerprints the text and matches
        │     the PO format saved for that client, IN THIS COMPANY
        │  3. RuleBasedPOParser.Parse runs the matched format's rule-set
        │  4. the matched client (per-company) is resolved for pre-selection
        │  5. the PDF is archived (PoImportArchives) with the parse outcome
        ▼
Review screen (POImportForm.jsx, step 2)
        │  pre-filled client + line items (description, quantity, unit);
        │  operator reviews/edits, optionally answers "Parser Feedback"
        ▼
Create → Sales Order / Sales Quote / Delivery Challan  (+ best-effort feedback)
```

The **same** `POImportForm` drives all three targets via a `target` prop
(`salesorder` | `salesquote` | `challan`). Only Description + Quantity are
required on a line; Unit defaults to `Pcs`; PO number/date are optional.

- **Sales Order** — customer PO number/date carry onto the order.
- **Sales Quote** — adds a **Unit Price** column (a quote is priced); PO
  number/date map to the customer-enquiry reference.
- **Delivery Challan** — created directly, no sales order needed.

If no PO format is saved for the client's layout, the parse returns **422** and
the form drops into manual-entry mode.

---

## 2. PO formats (per company)

Each **company owns its own PO formats** (`POFormat.CompanyId`). One format per
`(CompanyId, ClientId)`. Author them at **Configuration → PO Formats**:

- Company dropdown lists only the companies the operator can access.
- Client picker is a searchable dropdown of that company's clients.
- Upload a sample PDF, then fill the header strings. **Only the Description and
  Quantity column headers are required** — Unit and the PO Number/Date labels
  are optional (the parser reads each item's fields by column position).

The stored rule-set is `simple-headers-v1`:

```json
{ "engine": "simple-headers-v1",
  "poNumberLabel": "...", "poDateLabel": "...",
  "descriptionHeader": "Description", "quantityHeader": "Qty", "unitHeader": "UOM" }
```

The matcher prefers a company-scoped format, then a global (`CompanyId == null`)
one, so legacy global formats keep working.

---

## 3. The generic parser (`RuleBasedPOParser`)

`simple-headers-v1` extraction is **generic and layout-agnostic**. It reads each
field by the **column index** of its header, so it never confuses the quantity
with a price/amount column.

**Header detection** (`FindHeaderRow`): the first line containing both the
Description and Quantity headers. If the configured strings aren't found it falls
back to **synonyms** (`Description/Item/Particulars/Product/Material/Goods/…`,
`Qty/Quantity/Qnty/Ordered Qty/Nos/Units/…`). Exact cell matches beat
whole-word containment (so `Item` picks the `Item` column, not `Item Code`).
The Unit column is optional — auto-detected (`UOM/Unit/…`, never `Unit Price`).

**Row reading** (PdfPig emits 2+ spaces at column boundaries → split on `\s{2,}`):
- A line is a data row when its quantity column holds a positive number.
- **Spill**: if the quantity column holds description text (a description with an
  internal 2-space gap pushed it right), the real number is found to the right
  and the spilled cells merge back into the description. If that column holds a
  **unit** instead, the quantity cell was blank → the row is skipped.
- **Quantity** = first numeric token (commas/decimals ok; a trailing `%` is a
  concentration, never a quantity). Currency in price columns is ignored.
- **Unit** = the unit column when present, else `Pcs`.

**Multi-line descriptions**: a short text line that isn't a data row is appended
to the previous item. Lines that are really data rows (serial leader, or two+
bare-number cells = a blank-quantity row's price/amount) are skipped, not glued
on.

**Footers/chrome are excluded**: `Sub Total / Grand Total / Net / Gross / Basic /
CGST / SGST / IGST / GST n% / Discount / Amount in Words / Terms / Notes / Rupees
…` (currency-word aware: `Subtotal Rs. 70,825`), repeated page headers,
`Continued …`, timestamps, and the general rule "a text line ending in a bare
amount is a total". A product whose name merely starts with such a word
(`Total Station Theodolite`, `Net Book A5`, `Total 10W40 Engine Oil`) is kept.

**Engine + fallback**: the column reader is primary. The legacy adjacency scanner
(`ExtractSimpleItems`, tuned for the original Lotte/Meko/Soorty formats) runs only
as a fallback when the column reader finds nothing AND a unit header was
configured. The power-user `anchored-v1` engine is unchanged and untouched by
these rules.

### Known limitations (by design → Review stage + Feedback)

Some quantities are simply not knowable from the text; the parser gets the item
but leaves the odd quantity for the operator (and the feedback loop):
- a **blank quantity cell** (a bare number in it is indistinguishable from a rate),
- a quantity **buried in the description** (`Visitor Chair Leather x15`, blank Units),
- a **multiplier** (`10 x 12` → 120) or a **locale decimal** (`10.000` = 10 000 vs 10).

---

## 4. Parser Feedback system

Records whether an import parsed correctly and retains the original PDF so the
parser can be improved. **Self-contained** and **cross-branch-portable** — see §6.

- Entity `ParserFeedback` (table `ParserFeedbacks`), enum
  `ParserFeedbackStatus { Correct, Incorrect }`. Table is created idempotently in
  raw SQL (`Data/ParserFeedbackSchema.cs`), NOT an EF migration.
- On the Review screen, when a format matched, a Yes/No question appears above
  Create. It's optional and never blocks creation; the answer + PDF + parser
  version are POSTed **after** the document is created (best-effort).
- API (`ImportFeedbackController`, `api/import-feedback`):
  - `POST /` — record a verdict (+ retain PDF). `importfeedback.manage.create`
  - `GET /incorrect` — paged/filter/sort/date-range list. `importfeedback.list.view`
  - `GET /{id}/download` / `POST /download` — single / ZIP of PDFs. `importfeedback.download.view`
  - `GET /statistics` — accuracy overall + per parser version. `importfeedback.list.view`
- PDFs retained under `Data/uploads/parser_feedback/{YYYY}/{MM}/{guid}.pdf`.

Developer loop: `GET /incorrect` → download the flagged PDFs → reproduce with the
offline harness → fix → both suites green.

---

## 5. Regression testing — REQUIRED before any parser/import change

### 5a. Offline corpus harness — `scripts/po_parser_harness`

Runs the REAL parser (source-linked, no DB) against JSON corpora and asserts the
extracted `(description, quantity)` per case.

```bash
cd scripts/po_parser_harness
dotnet run -c Release            # all corpora; exit non-zero on any failure
dotnet run -c Release -- -v      # print every failure
```

Corpora in `scripts/po_parser_harness/corpus/`:
- `diverse_corpus.json` (197) — realistic layouts across industries, header
  synonyms, no-unit tables, alpha codes, currency, multi-page.
- `adversarial_corpus.json` (65) — layouts purpose-built to break the algorithm;
  8 irreducible cases are flagged `allowedFailures`.
- `real_samples.json` (3) — real sample PDFs' actual PdfPig text.

**When you change the parser: add cases for the new behaviour, keep it green.**

### 5b. Production read-only check — `scripts/po_parser_prod_regression.py`

Real uploaded PDFs, read-only against production. It lists the archived imports
that production recorded as `ok`, downloads each PDF, re-parses it against a
**local** backend running the current parser, and flags any that now match no
format or extract fewer items than production recorded.

```bash
# One-time: run a LOCAL backend on a DB that has the same PO formats as prod
# (the prod-replica db46684), so format matching behaves like production.
set PROD_USER=...&&  set PROD_PASS=...           # production read-only account
python scripts/po_parser_prod_regression.py \
    --prod https://hakimitraders.runasp.net --local http://localhost:5134 --outcome ok
# exit 0 = no regressions
```

**Safety:** prod is strictly read-only — one `POST /auth/login`, then only
`GET`s. All re-parsing happens on the local backend. (See the production-readonly
rule in `CLAUDE.md` / team memory.)

---

## 6. Cross-branch (master ⇄ customize-solution-for-other)

The feedback feature is built to cherry-pick with minimal conflict:
- **New, identical files** (entity, enum, DTOs, repository, service, controller,
  schema bootstrap, DI extension, frontend component + API) — apply cleanly.
- The `ParserFeedbacks` table is raw SQL, so there is **no EF migration
  snapshot** to conflict.
- Identical class/method/DTO/enum names, `api/import-feedback` routes, and DB
  column names across branches.
- Small additive edits to shared files (`AppDbContext` DbSet, `Program.cs` two
  lines, `PermissionCatalog` three keys, `permissionSections.js` one line).
**Tested** — cherry-picking the feature commit onto `master` auto-merges 21 of
24 touched files clean (every new file, the whole feedback backend, AND
`RuleBasedPOParser.cs`). Three files conflict, each a single hunk:
- `CLAUDE.md` and `README.md` — trivial, purely additive (a test-table row and a
  changelog entry); keep both sides.
- `POImportForm.jsx` — the real reconcile: master's Review screen lacks the
  `target`-aware structure, so re-apply the feedback integration by hand (the
  import, the `parserFeedback` state, the `<ParserFeedback>` render, and the
  submit-after-create call). A few lines.

**Before merging the parser to master:** the six production formats
(Lotte/Meko/Soorty/…) use the same `simple-headers-v1` engine and have no golden
samples, so run §5b against real Hakimi/Roshan PODFs — column-primary is now the
default extraction path.

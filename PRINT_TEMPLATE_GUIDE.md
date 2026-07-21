# Print Template Guide — building pixel-faithful templates from a supplied PDF

> ⚠ **Master-branch note (Division-FREE).** This branch has **no Division/scope**
> concept — every print template is **company-level** (`PrintTemplate` is keyed on
> `(CompanyId, TemplateType)` with a `Name` + one `IsDefault` per type; there is no
> `DivisionId`). Ignore ALL division / sub-company / scope references below (they are
> from the Division-enabled customer build): there is no division picker, no
> `divisionId` on any endpoint/DTO, and no `division*` merge tokens. Working-company
> examples here mention Al-Qahera (2178); on master the real tenants are **Hakimi
> Traders (1)** and **Roshan Traders (2)** and the dev DB is `db46684`. Supported
> template types on master: `Challan, Bill, TaxInvoice, SalesQuote, SalesOrder,
> PurchaseBill, GoodsReceipt, DebitNote, CreditNote, Receipt` (see
> `Helpers/PrintTemplateTypes.cs`). Everything else — the PDF→field-mapping workflow,
> the helper list, the borderless Manager styling, the verify-via-DOM discipline — is
> branch-agnostic and applies verbatim.

**READ THIS FIRST for ANY print-template task** (building, editing, or matching a
document design), especially when the user uploads a reference PDF and wants "the
same" print output. This guide + the scripts in `scripts/print_templates/` encode
the full, verified workflow. Follow it end-to-end; don't re-derive it.

The goal: the user gives a PDF (usually exported from Manager.io / TechvoLogix); we
produce a `PrintTemplate` whose printed output is **pixel-faithful** to that PDF —
same header/logo placement, columns, totals, footer, fonts, spacing — driven by OUR
merge fields for the dynamic parts.

---

## 0. The non-negotiable rules

1. **The uploaded PDF is ground truth** for layout — NOT any Liquid/theme source. The
   rendered PDF and the theme source often differ; match the PDF.
2. **Author against the REAL print-DTO field names** (see §3). Never guess merge-field
   names — a wrong token renders blank and silently breaks the doc.
3. **Auto-identify every dynamic value** in the PDF (party name, doc no, date, line
   items, totals, tax, references…) and bind it to the correct merge field.
4. **Missing-field rule (ask the user):** if a PDF value has no matching merge field,
   STOP and ask — do not invent. Decide per the tree in §6:
   - value **exists in the print DTO** but isn't exposed as a merge field → offer to
     **add a merge field** (this is a CODE change — DTO/service/seeder — get approval);
   - value **is not in the DTO at all** → ask the user to **hardcode** it in the
     template (standard boilerplate), OR add it to the DTO+source (code change);
   - value is fixed brand boilerplate (seller block, terms) → hardcode it (that's what
     Manager does too).
5. **Verify before claiming done** (§7). Offline render must have **0 unresolved
   `{{tokens}}`**; then confirm in the browser. The in-app screenshot tool is BROKEN on
   this box — verify with `javascript_tool` DOM assertions, not screenshots.
6. **Back up** a template's current HTML before overwriting it (§8).
7. **Data-only work:** templates are rows in the DB, not code. Adding a *new merge
   field* IS code (needs commit/approval); writing template HTML is not.

---

## 1. Environment / prerequisites

- Backend running on **:5134**, Development env, branch DB `DeliveryChallanDb`
  (branch `feat/sales-quote-order`). Start (only with user OK — never auto-restart):
  `ASPNETCORE_ENVIRONMENT=Development dotnet run --no-launch-profile --urls "http://localhost:5134"`
  (run in background; the `dotnet run` launcher may report a spurious non-zero exit
  while the child app keeps serving — confirm health via an API call, not the exit code).
- Auth: `POST /api/auth/login` `{ "username":"admin", "password":"admin123" }` → `token`.
- Working company for the Al-Qahera migration is **2178** ("Al-Qahera Trading Co."),
  divisions: Al-Qahera 1098, CASH 1099, Kapasi 1100, MAK 1101, **Traditional 1102**.
- `pdfplumber` (Python) + Node 20 (for the Handlebars render check) must be available.
- Windows/MSYS gotcha: pass **Windows-style paths** (`C:/…`, `D:/…`) to Python/curl
  file args — `/c/…` MSYS paths fail (`curl` exit 26, Python FileNotFound).

---

## 2. How the print system works

- **Entity** `Models/PrintTemplate.cs`: `CompanyId`, `DivisionId` (null = company-level,
  else scoped to a division), `TemplateType` (string, see below), `Name`, `IsDefault`
  (one default per `CompanyId+DivisionId+TemplateType`), `HtmlContent` (**Handlebars**),
  `EditorMode` ("code"), `TemplateJson` (GrapesJS — leave null for code templates).
- **Template types** (`Helpers/PrintTemplateTypes.cs`): `Challan, Bill, TaxInvoice,
  SalesQuote, SalesOrder, DebitNote, CreditNote, PurchaseBill, GoodsReceipt, Receipt,
  Payment, Transfer, JournalEntry, WithholdingTaxReceipt`.
- **Rendering** = client-side Handlebars, `myapp-frontend/src/utils/templateEngine.js`
  `mergeTemplate(html, data)`. It injects `<base href="{origin}/">` so a path-absolute
  logo (`/data/uploads/logos/…`) resolves in the print popup.
- **Registered helpers ONLY** (using any other helper throws):
  `fmtDate` (dd-Mmm-yy), `fmtDMY` (dd/mm/yyyy — Manager's numeric date), `fmt` (0-dp
  thousands), `fmtDec` (2-dp), `fmtQty` (thousands sep, keeps decimals only when
  present: 1,000 / 500 / 2.5 — use for item quantities), `nl2br`, `richText`
  (allows `<b>/<i>/<u>`+`<br>`, XSS-safe — use `{{{richText x}}}`), `join`, `joinDates`,
  `emptyRows`, `billEmptyRows`, `taxEmptyRows`, `math` (only `+`/`-`), `gt`, `eq`, `or`,
  `uniqueTypes`, `inc`. Plus built-in `{{#each}}`, `{{#if}}`, `{{else}}`.
  Note `{{#if x}}` treats `0` and `""` as falsy — handy to hide a zero tax row or a
  blank debit/credit cell.
- **Endpoints** (`Controllers/PrintTemplatesController.cs`, perm `printtemplates.manage.*`):
  `GET  /api/printtemplates/company/{companyId}` (list),
  `GET  /api/printtemplates/{id}`,
  `POST /api/printtemplates/company/{companyId}` (create; body `CreatePrintTemplateDto`
  = `templateType, divisionId?, name, htmlContent, templateJson, editorMode, isDefault`),
  `PUT  /api/printtemplates/{id}` (`UpdatePrintTemplateDto` = `name, htmlContent,
  templateJson, editorMode`).
- **Merge-field catalog** for the editor sidebar is DB-driven per type (migrations +
  `Data/*MergeFieldSeeder.cs`). The 5 accounting types (Receipt/Payment/Transfer/
  JournalEntry/WithholdingTaxReceipt) have NO DB catalog — their fields come only from
  the print DTO / page data object, so §3 (read the DTO) is authoritative there.

### Brand / scope model for Al-Qahera (2178)
Two print identities, mapped to scope:
- **Traditional Trading Co.** → division **1102** templates. Centred logo, hardcoded
  Traditional seller block, footer "For Traditional Trading Co." + "A system-generated
  document does not require a signature or stamp." (customer-facing sales docs).
- **Al-Qahera Trading Co.** → **company-level** templates (`divisionId=null`). Manager's
  DEFAULT theme look: title top-left, logo **top-right**, Al-Qahera seller block on the
  right (accounting/purchase docs).
Both brands print the SAME logo image (the teal/gold "Traditional Trading" script).
It's uploaded to BOTH the company (`/data/uploads/logos/company_2178.png`) and the
Traditional division (`/data/uploads/logos/division_1102.png`); reference the matching
one by static path (deterministic, resolves via the injected `<base>`).
Decide a new PDF's scope by its seller block: "Traditional Trading Co." → div 1102;
"Al-Qahera Trading Co" → company-level.

---

## 3. Discover the real merge fields (do this BEFORE authoring)

Three sources, in order of authority:

1. **The print DTO** — `DTOs/PrintDtos.cs` (docs) and `DTOs/AccountingPrintDtos.cs`
   (journal/receipt/payment/transfer/WHT). Each `Print*Dto` + `Print*ItemDto` lists the
   EXACT fields (camelCased in JSON). This is the source of truth for what data exists.
2. **Live** — hit the print endpoint for a real record and inspect the JSON keys, e.g.
   `GET /api/invoices/{id}/print/tax-invoice`, `…/print/bill`,
   `/api/salesorders/{id}/print`, `/api/deliverychallans/{id}/print`,
   `/api/purchasebills/{id}/print`, `/api/journalentries/{id}/print`,
   `/api/withholdingtaxreceipts/{id}/print`, notes via the invoice print endpoints.
   This confirms both the field names and whether they're populated.
3. **The existing default template** for that type — `GET /api/printtemplates/{id}`,
   extract its `{{tokens}}`; it's a known-good example of the field vocabulary.

**Known field facts (verified) & data-model gaps — respect these:**
- Challan item: `description, unit, quantity` (no price). Header has `clientAddress, clientSite, poNumber, poDate`.
- Bill item: `sNo, quantity, uom, description, unitPrice, lineTotal`. Party = `client*`; issuer = `company*`/division tokens.
- **TaxInvoice / Credit-Debit Note items: `description, hsCode, quantity, uom, valueExclTax, gstRate, gstAmount, totalInclTax` — NO per-unit price.** Show line "Amount" (`valueExclTax`) + tax in the totals block; you cannot render a Manager "Unit price" column here without a code change.
- PurchaseBill item: `sNo, description, quantity, uom, unitPrice, lineTotal, hsCode` (HAS unit price → matches Manager fully). Party = `supplier*`; issuer = `company*`.
- **SalesOrder item: `sNo, itemTypeName, description, quantity, uom, deliveredQuantity, remainingQuantity` — NO price/total fields at all.** A priced Manager sales order is NOT reproducible; print quantity columns and tell the user a schema change is needed for prices.
- JournalEntry: `entryNo, reference, date, narration, totalDebit, totalCredit`, `lines[{accountCode, accountName, description, debit, credit}]`.
- WithholdingTaxReceipt: `receiptNumber, date, customerName, customerAddress, customerNTN, customerSTRN, description, amount, amountInWords` (scalars — single row, not a list).
- GoodsReceipt item: `sNo, itemTypeName, description, quantity, unit` (quantity-only).
- Common: `amountInWords`, `subtotal, gstRate, gstAmount, grandTotal`, `division*` tokens
  (`divisionBrandName, divisionLogoPath, divisionAddress, divisionNTN, divisionSTRN, divisionEmail`).

---

## 4. Manager styling conventions (match these for a faithful look)

Manager's exported PDFs are **borderless** — a thin horizontal rule under the header
row and lines bracketing the Total row; **no cell grid, no vertical borders**. The
description column is **width-constrained so long text WRAPS** onto multiple lines.
Reproduce with this CSS (see `build_v2.py` in the durable notes / the snippet below):

```css
table.qitems{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:16px;}
table.qitems th{border:none;border-top:1px solid #333;border-bottom:1px solid #333;
  padding:8px 6px;font-weight:bold;text-align:left;}
table.qitems td{border:none;padding:8px 6px;vertical-align:top;
  overflow-wrap:break-word;word-break:break-word;}          /* wrapping description */
.qrule{border-top:1px solid #333;}                            /* full-width rule after items */
table.qtot{width:52%;margin-left:auto;border-collapse:collapse;}   /* right-aligned totals */
table.qtot td{border:none;padding:7px 8px;text-align:right;}
table.qtot .subt td{border-bottom:1px solid #333;}
table.qtot .grand td{border-top:1px solid #333;border-bottom:1px solid #333;font-weight:bold;}
```
- Use `<colgroup>` fixed widths (e.g. description ~44%, numeric cols small) so
  `table-layout:fixed` actually wraps the description.
- Totals: labels right-aligned near the amounts (not spanning full width); money as
  `PKR {{fmtDec x}}` (2-dp) or `{{fmtDec x}}` per the PDF. Match the PDF's exact labels
  ("Sub-total", "S.Tax {{gstRate}}%", "Value Excl. S.Tax", "Total", …).
- Meta labels: match the PDF verbatim — Manager uses "Issue date", "Reference",
  "Invoice date", "Due date", "Invoice number", "Delivery date".
- Logo: Traditional → centred (`display:block;margin:0 auto;max-height~90px`) OR
  top-right per the PDF; Al-Qahera default → top-right in a 2-col header row
  (title left, logo right). Use the static logo path for the scope.
- Doc title text: match the PDF ("Quote", "Delivery Note", "SALES TAX INVOICE",
  "Journal Entry", "Purchase Invoice", "Credit Note", "Withholding tax receipt", …).
- Footers: Traditional sales docs → "For Traditional Trading Co." + system-generated
  line. Tax invoice → "Total amount in words: {{amountInWords}}" + "Signature ______".
- Full HTML doc: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>…</style>
  </head><body><div class="doc">…</div></body></html>` (a `.doc{padding:26px 30px}`
  wrapper). A4 portrait ≈ 596×843 pt.

---

## 5. Step-by-step workflow

1. **Extract the PDF:** `python scripts/print_templates/extract_pdf.py "<file.pdf>" --words`
   → note page size, logo box (centred vs right), the layout text, and column
   x-positions. Confirm it's borderless (rects≈0).
2. **Identify** the document type (→ our `TemplateType`) and brand (seller block →
   scope). Find the target template id via
   `python scripts/print_templates/push_template.py list 2178`.
3. **Discover merge fields** for that type (§3): read the `Print*Dto`, hit the live
   print endpoint, extract the current default's tokens.
4. **Map every PDF element** to a field or static text. For each dynamic value, pick the
   merge field. For anything with no field → apply the §6 tree (ASK the user).
5. **Author** the Handlebars HTML matching the PDF (§4 conventions). Only registered
   helpers. Static/brand identity hardcoded; dynamic values via merge fields.
6. **Offline render check** with representative sample JSON:
   `node scripts/print_templates/render_check.mjs <tpl.html> <sample.json>`
   → must report **0 unresolved `{{tokens}}`**. Cover every branch (empty optionals,
   long descriptions to prove wrapping, multi-line address).
7. **Browser verify** (screenshots broken → DOM asserts): render with the live logo to
   `wwwroot` (`render_check.mjs … --www check1`), open
   `http://localhost:5134/_prev_check1.html`, and use `mcp__Claude_Browser__javascript_tool`
   to assert logo loaded (`img.naturalWidth>0`) + centring, seller text, column headers,
   `getComputedStyle(td).borderTopWidth === "0px"` (borderless), wrapping, totals labels
   + values. **Delete the `_prev_*.html` afterwards.**
8. **Back up then push** (§8).
9. **Report** what changed (per type/scope), flag any data-model gaps, and **update the
   memory entry** for this project.

---

## 6. Missing-field decision tree (ASK — never invent)

For every dynamic value in the PDF that has no obvious merge field:

- **Is it in the print DTO** (`Print*Dto`) already but just not surfaced?
  → Tell the user: "X is available in the DTO; I can add a `{{x}}` merge field
    (small code change: expose it + seed the catalog)." Get approval before the code
    change; then commit it.
- **Is it NOT in the DTO** (we don't compute/store it — e.g. sales-order unit price)?
  → Ask the user to choose:
    (a) **Hardcode** a fixed value/boilerplate in the template (fine for standard terms
        like "Payment Within 30 Days", "GST will be charged at Actual"), or
    (b) **Add it to the DTO + source + (optionally) the merge-field catalog** so it's
        dynamic — a code change needing approval + commit.
- **Is it fixed brand identity** (seller name/address/NTN, "For <Co.>", system-generated
  note)? → Hardcode it (Manager hardcodes these in the theme too).

Present the specific value, where it appears in the PDF, and the options — then wait.

---

## 7. Verification checklist (all must pass before "done")

- [ ] `render_check.mjs` → 0 unresolved `{{tokens}}`, no Handlebars error, for realistic data.
- [ ] Browser DOM asserts: correct title, seller, logo loads + right placement, exact
      column headers, borderless (`borderTopWidth==="0px"` on item `td`), description
      wraps, totals labels + values match the PDF, footer present.
- [ ] Numbers reconcile to a real record where possible (e.g. Purchase Invoice
      Sub-total/Total to the rupee).
- [ ] Any deviation from the PDF (missing unit-price column, no SO prices, dropped
      cursive, etc.) is explicitly reported to the user.
- [ ] Temp `wwwroot/_prev_*.html` files deleted.

---

## 8. Push (idempotent) + backup

```bash
# back up the current body first
python scripts/print_templates/push_template.py backup <id> backup_<id>.html
# update in place (matches an existing scope) — preferred, keeps IsDefault + scope
python scripts/print_templates/push_template.py update <id> <new.html> "<Name>"
# or create a new scoped template
python scripts/print_templates/push_template.py create 2178 <Type> <divId|-> "<Name>" <new.html>
# logo (only sets LogoPath — safe; never PUT the full company DTO)
python scripts/print_templates/push_template.py logo company 2178 <img.png>
python scripts/print_templates/push_template.py logo division 1102 <img.png>
```
Placement: Traditional-brand PDF → the div-1102 template; Al-Qahera-brand PDF → the
company-level (`divisionId=null`) template. Never modify the company record via the full
`UpdateCompanyDto` (it carries FBR/inventory/tenant flags) — only the logo endpoint.

---

## 9. If the source PDF must be pulled from Manager.io

Manager Desktop local API: `http://127.0.0.1:55667/api2`, header `X-API-KEY`
(token file `C:\Users\hussahuz\Downloads\alqahera-perpetual\manager-token.txt`).
Custom themes: `GET /api2/custom-theme-form/{key}` (no list — get the key from a
document's `CustomThemeId`). Business logo/details: not API-listable; read via the
Desktop web UI (Settings → Business Details, the `<img data:image/png>`). But prefer the
user's **exported PDF** as the layout source — it's the true render.

---

## 10. Reusable assets

- `scripts/print_templates/extract_pdf.py` — PDF layout/word/coord extractor.
- `scripts/print_templates/render_check.mjs` — offline Handlebars render + token check
  (+ `--www` browser preview writer).
- `scripts/print_templates/push_template.py` — list / backup / update / create / logo.
- Al-Qahera build history + generated HTML + backups live outside the repo in
  `C:\Users\hussahuz\Downloads\alqahera-perpetual\themes\` (`build_templates.py`,
  `build_v2.py`, `RESUME_HERE.md`) — machine-local reference, not committed.

**When a new PDF arrives:** extract → identify type+brand → read the DTO → map fields
(ask on any gap per §6) → author (§4) → render_check → browser-assert → backup+push →
report. Keep it pixel-faithful; be honest about what our data can't render.

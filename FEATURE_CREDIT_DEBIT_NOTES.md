# Credit / Debit Notes & Sales Returns — FBR Digital Invoicing

**Status:** v1 IMPLEMENTED on branch — awaiting user verification + sandbox confirmation (NOT committed)
**Author:** Session 2026-07-01
**Branch:** `feat/fbr-credit-debit-notes`
**Source spec:** FBR DI API Technical Documentation **v1.12** (24-Jul-2025)

---

## 0. What was built (2026-07-01) — pending verification

A **"Reverse"** action on any FBR-submitted invoice that **auto-generates a
Credit Note** (Debit Note when overridden) as a **new, unsubmitted bill**. The
note lands in the Bills list and flows through the existing **Validate → Submit
to FBR** buttons exactly like an ordinary invoice.

Backend:
- `Models/Invoice.cs` — added `OriginalInvoiceId`, `OriginalInvoiceRefIRN`,
  `NoteReason`, `NoteReasonRemarks` + self-ref nav `OriginalInvoice`. **Fixes the
  FbrIRN overload**: `FbrIRN` = this doc's own IRN; `OriginalInvoiceRefIRN` = the
  referenced original's IRN.
- Migration `20260701140827_AddCreditDebitNoteLinkage` (additive, all nullable).
- `InvoiceService.CreateReversalNoteAsync` — copies buyer + lines, sets docType
  10, links original, allocates a note number (retry-on-conflict), reflows stock,
  audits. Guards: original must be FBR-Submitted with IRN; blocks a 2nd live note
  (FBR 0064); rejects reversing a note.
- `FbrService` — reads `OriginalInvoiceRefIRN` for `invoiceRefNo`; adds 180-day
  (0034) + not-before-original (0035) checks.
- `StockService.SyncInvoiceStockMovementsAsync` — direction by docType:
  **Credit Note → IN** (goods return), **Sale Invoice → OUT**, **Debit Note →
  no movement** (value/tax correction only). Stock is keyed on `ItemTypeId`
  (which carries the HS code), so the return lands on the exact same inventory
  item that was sold. The note copies the original's **FBR-effective** line
  values (dual-book overlay applied), so a credit note reverses precisely the
  quantity that left inventory — even on tax-claim-optimized invoices where the
  deducted qty (e.g. 116) differs from the printed row (1). Existing cancel/
  delete purges (filter by SourceId) still clean up a note's movements.
- `POST /api/invoices/{id}/reverse`, permission `invoices.note.create`.

Frontend (built + copied to `wwwroot`):
- "Reverse" button (desktop table + mobile card) on submitted bills → reason
  dialog → generates the note → refresh.
- Credit/Debit Note badge + "↩ #original" in the Bill # column.

Verified so far: `dotnet build` 0 errors; frontend build OK. **NOT yet run
against a live/sandbox FBR invoice** — see §9.

### 0c. Round 3 (2026-07-02) — separate note sequence + Return Invoices tab (UNCOMMITTED)

- **Own numbering:** notes now number from a per-company **Debit Note sequence**
  (`Company.StartingDebitNoteNumber`/`CurrentDebitNoteNumber`, default start 1)
  — reversing bill #3821 creates **Debit Note #1**, not bill #3822. Uniqueness
  scoped by a new persisted computed column `Invoices.IsReturnNote` + unique
  index (CompanyId, IsReturnNote, InvoiceNumber). Migration
  `SeparateDebitNoteNumbering` renumbers pre-existing notes to 1..N per company
  and stamps `FbrInvoiceNumber = DN-{n}`. A filtered unique index on
  `OriginalInvoiceId` (live rows) closes the 0064 race (one live note/original).
- **Return Invoices tab:** nav Sales → Return Invoices (`/return-invoices`,
  InvoicePage mode="returns", gated `invoices.list.view`); paged endpoint takes
  `type=notes`. Bills/Invoices lists now EXCLUDE notes entirely. "New Return /
  Reverse" button links to the create screen.
- **Notes are immutable:** UpdateAsync + narrow edits reject DocumentType 9/10
  (void + recreate instead); sale bills can no longer be flipped to 9/10 via
  edit (was a stock/sequence corruption vector). Demo originals can't be reversed.
- **Mix-fixes from the research audit:** dashboard sales KPIs, item-rate-history,
  last-rates, and awaiting-purchase all exclude notes (a reversal no longer
  double-counts as a sale).
- Verified locally: migration renumbered DN #1–3, reverse allocated DN #4 while
  sale max stayed 3821, scoped delete works, lists fully split; 30/30 basic
  flows + 52/52 stock reflow.

### 0d. Round 4 (2026-07-02) — Credit Note + Debit Note as first-class tabs (UNCOMMITTED)

Design grounded in the deep-research ERP patterns (SAP returns-vs-credit-memo,
Odoo Reverse dialog, Zoho restock-vs-credit-only, Tally CN=sales return):

- **Two tabs**: Sales → **Credit Notes** (`/credit-notes`, returns/reversals,
  DocumentType 10) and **Debit Notes** (`/debit-notes`, upward adjustments,
  DocumentType 9). Each lists ONLY its type; sale-invoice lists exclude both.
- **Per-type numbering**: `NoteKind` persisted computed column (0/1/2) +
  unique (CompanyId, NoteKind, InvoiceNumber); Company gains
  Starting/CurrentCreditNoteNumber alongside the debit fields; display
  numbers CN-n / DN-n. Migration `SplitCreditDebitNoteSeries`.
  ⚠️ Root-caused: the C-8 startup backfill in Program.cs recreated the legacy
  unscoped UNIQUE (CompanyId, InvoiceNumber) at every boot — retired it (the
  NoteKind index now owns the C-8 guarantee).
- **Manual + partial creation restored for BOTH types** at
  `/credit-debit-notes?type=credit|debit&invoiceId=N` (Reverse button opens
  it prefilled). Reasons = FBR's OFFICIAL enumerated list (IRIS bulk-import
  template): Cancellation of supply · Return of goods · Change in nature of
  supply · Change in value of supply · Change in amount of tax · Others ·
  Adjustment given to Steel Melters.
- **Industry stock semantics** ("separate the physical return from the
  financial credit"): notes carry `NoteAffectsStock` — derived from reason
  (goods reasons on a credit note → true), operator-overridable toggle.
  Credit Note + affects-stock → IN; Debit Note + affects-stock → OUT (extra
  goods); value-only note → inventory untouched.
- **Debit notes carry delta pricing**: per-line unit-price override
  (undercharge per unit), capped at the invoiced rate (FBR 0067).
- One live note **per type** per original (CN + DN may coexist); DTO exposes
  ReversedByCreditNoteNumber + AdjustedByDebitNoteNumber.
- Verified live 19/19 (CN #1 partial return stock +4; DN #1 value-only stock
  unchanged, subtotal = qty×delta; list separation; per-type guard; badges)
  + 30/30 + 52/52 + 67/67 suites.

### 0b. Round 2 additions (2026-07-01)

- **Fix:** the Reverse button no longer shows on an invoice that already has a
  live Credit Note. `InvoiceDto.ReversedByInvoiceNumber` is populated
  (`InvoiceService.AttachReversalInfoAsync`) and the table/card hide the button
  and show a "↩ REVERSED · CN #N" tag. **Requires a backend restart to take
  effect** (the field is new).
- **Manual Credit/Debit Note screen** — new nav item **Sales → Credit / Debit
  Notes** (`/credit-debit-notes`, gated by `invoices.note.create`). Pick note
  type, search a submitted invoice, and select lines with **partial return
  quantities**; live totals; reason + remarks (remarks required for "Others").
- **Partial notes** — `InvoiceService.CreateNoteAsync(CreateNoteDto)` accepts a
  line list (`invoiceItemId` + qty, capped at the invoiced qty); empty = full
  reversal. `CreateReversalNoteAsync` now delegates to it. Header totals
  recomputed from selected lines; credit-note value capped at original (0036).
  Endpoint `POST /api/invoices/notes`.
- Stock IN reflows for the **selected partial** quantities only.
- ⚠️ Still enforces **one live credit note per invoice** (0064) — so multiple
  separate partial returns over time are blocked until the sandbox confirms
  whether FBR allows them.

This document explains how invoice returns / cancellations work under FBR's
Digital Invoicing system, what the API actually allows, how competitors
handle it, and a concrete plan to integrate it into MyApp's invoice workflow.

---

## 1. The one-line answer

> **A posted FBR invoice can never be cancelled, voided, or deleted.**
> To reverse it you post a **Credit Note** (return / downward adjustment) or a
> **Debit Note** (upward adjustment) that references the original invoice's
> **IRN**. FBR nets the two documents in the monthly Sales Tax Return.

There is **no** cancel / void / delete endpoint anywhere in the DI API. The only
write methods are `postinvoicedata` and `validateinvoicedata`. Once PRAL issues
an IRN (e.g. `7000007DI1747119701593`) the invoice is permanent.

The legal basis is **Section 9 of the Sales Tax Act 1990**: on cancellation of
supply, return of goods, change in nature of supply, or change in value, the
registered person issues a debit or credit note.

---

## 2. Credit Note vs Debit Note

| | Credit Note | Debit Note |
|---|---|---|
| **Trigger** | Goods returned, order cancelled, overcharge, post-sale discount, defective goods, short quantity | Undercharge, extra quantity shipped, price increase, freight/handling added |
| **Effect on seller output tax** | ↓ decreases | ↑ increases |
| **Who issues (in our case)** | **We (seller) issue it** — reduces our output tax | We issue it — increases our output tax |
| **MyApp DocumentType** | `10` | `9` |
| **`invoiceType` string sent to FBR** | `"Credit Note"` | `"Debit Note"` |

- **Full cancellation of an invoice = a Credit Note for the entire value.**
- **Partial return = a Credit Note for the returned lines/quantities only.**
- MyApp is a **wholesaler-seller** (Hakimi, Roshan), so the dominant real-world
  case is the **Credit Note** (sales return). Debit notes are the rarer
  upward-revision case.

> ⚠️ **Spec nuance:** The v1.12 field table lists only `"Sale Invoice"` and
> `"Debit Note"` as `invoiceType` values, and `doctypecode` (§5.2) only samples
> docTypeId 4 & 9. But the error-code section validates credit notes extensively
> (0036, 0064, 0068, 0071) and every commercial integrator (Tier3,
> digitalinvoices.pk) posts credit notes through the same endpoint. Treat
> `"Credit Note"` as accepted, **but confirm in sandbox before shipping.**

---

## 3. How FBR links a note to the original invoice

Same `postinvoicedata` payload as a normal invoice, with three differences:

1. `invoiceType` = `"Credit Note"` or `"Debit Note"`
2. `invoiceRefNo` = the **original invoice's IRN** (22 digits if seller has NTN,
   28 digits if CNIC) — **required** for any note
3. A **reason** (and **reason remarks** if reason = `"Others"`) — these appear in
   error codes 0027/0028 but are **not yet in the v1.12 field table**; the exact
   JSON field names must be confirmed in sandbox.

The line items are the returned/adjusted lines with their HS codes, rates, UOMs,
and tax amounts — same shape as a sale invoice.

---

## 4. Hard rules FBR enforces (extracted from the error-code tables)

These are the real contract. Validate them **client-side and server-side before
posting**, because PRAL rejects otherwise. (Codes are FBR Sales Error Codes, §7.)

| Code | Rule | MyApp status |
|---|---|---|
| 0026 | `invoiceRefNo` mandatory for any note | ✅ already validated (FbrService.cs:498-503) |
| 0057 | Referenced original invoice **must exist** in FBR | ❌ not checked |
| 0034 | Note allowed **only within 180 days** of original invoice date | ❌ not checked |
| 0029 / 0035 | Note date **≥ original invoice date** | ❌ not checked |
| 0036 | Credit note **value of sale ≤ original** invoice value | ❌ not checked |
| 0037 | Credit note ST-withheld ≤ original | ❌ not checked |
| 0067 | Debit note sales tax **cannot exceed** original invoice's sales tax | ❌ not checked |
| 0068 | Credit note sales tax must be **< original** per rate | ❌ not checked |
| **0064** | **"Credit note is already added to an invoice"** — appears to allow **only ONE credit note per original invoice** | ❌ not handled — **shapes the whole UX** |
| 0071 | Credit notes allowed only for specific/eligible users | ❌ (FBR-side gate) |
| 0027 / 0028 | Reason required; remarks required when reason = "Others" | ❌ no reason field yet |

### 4.1 The 0064 constraint is the big one

If FBR truly allows only **one credit note per original invoice**, then a user
who returns 3 boxes today and 2 more next week against the same invoice **cannot
file two separate credit notes**. Options:

- **(A) One-shot return** — the return screen lets the user pick all returned
  lines/quantities in a single credit note; once posted, no further note against
  that invoice. Simplest, matches FBR, recommended for v1.
- **(B) Local aggregation** — accumulate returns locally and only post to FBR
  once (e.g. at period close). More complex, risks drift from FBR.

**Must be verified in sandbox first** — the constraint may be per-period or may
allow multiple partial notes. The wording (0064) suggests one-shot.

---

## 5. Industry practice (what we're matching)

Every FBR-integrated ERP (Tier3, DIFBR, digitalinvoices.pk, Switcher) converges
on the same pattern — this validates the design below:

1. **Never delete a posted invoice.** Keep it; mark it Returned/Adjusted locally.
2. **A Return / Credit-Note document created *from* an existing invoice** (exactly
   like MyApp's "Bill from Challan" flow) — inherits buyer, lines, HS codes,
   rates; user selects which lines/quantities come back.
3. **Post to FBR** as a credit note with `invoiceRefNo` = original IRN + reason,
   within 180 days.
4. **Store the note's own returned IRN + QR**, print it with the FBR logo/QR.
5. **Reverse stock** (returned goods re-enter inventory).
6. **Declare in the STR** for the period the note was issued.
7. **Pre-submission mistakes** (invoice created but *not yet* posted to FBR) →
   just void/edit locally, no FBR note. MyApp already does this via the
   `c5af201` bill void flow.

---

## 6. What MyApp already has (the good news)

The codebase was clearly built anticipating this feature:

| Piece | Location | State |
|---|---|---|
| `DocumentType` on Invoice (4/9/10) | `Models/Invoice.cs`; `DocTypeMap` FbrService.cs:77-82 | ✅ correct FBR strings |
| Note pre-validation (ref IRN required, 22/28 digits, cites 0026) | FbrService.cs:498-503 | ✅ partial |
| `invoiceRefNo` populated in payload for doctype 9/10 | FbrService.cs:~831 | ✅ |
| Void/cancel flow for **non-submitted** bills (stock purge, challan release, audit, guard "issue Credit Note instead") | `InvoiceService.CancelAsync` (~1743-1833); `bills.manage.void` | ✅ this is the pre-FBR path |
| Stock OUT sync + reversal (idempotent) | `StockService.SyncInvoiceStockMovementsAsync`; purge in CancelAsync | ✅ reusable for note reversal |
| FBR submit/validate/preview pipeline | `FbrController`, `FbrService.PostInvoiceAsync` | ✅ reusable as-is for notes |
| Frontend doctype dropdown + "Credit/Debit Notes get their own screens" tooltip | `InvoiceForm.jsx`, `StandaloneInvoiceForm.jsx`, `EditBillForm.jsx` | 🟡 placeholder |
| Permission scaffold (`invoices.fbr.submit/validate/preview`) | `Helpers/PermissionCatalog.cs` | ✅ reusable |

---

## 7. What's missing (the work)

### 7.1 Data model — the critical fix

**`FbrIRN` is overloaded.** Today it means "the IRN this invoice received." But
note pre-validation also reads it as "the original invoice's reference IRN," and
`PersistStatus` overwrites `FbrIRN` with the note's *own* new IRN on submit —
**clobbering the reference.** A note needs BOTH.

Add to `Invoice` (additive, per the no-disruption rule):

```csharp
public string? OriginalInvoiceRefIRN { get; set; }  // original invoice's IRN (the reference)
public int?    OriginalInvoiceId     { get; set; }  // local FK → the invoice being adjusted
public string? NoteReason            { get; set; }  // FBR reason (0027)
public string? NoteReasonRemarks     { get; set; }  // required if reason == "Others" (0028)
```

- `FbrIRN` stays as "this document's own IRN" (the note gets its own IRN on submit).
- Payload build reads `invoiceRefNo` from **`OriginalInvoiceRefIRN`**, not `FbrIRN`.
- `OriginalInvoiceId` powers stock reversal, the 0064 "one note per invoice"
  guard, value-cap checks (0036/0067), and the print "against invoice #…" line.

*(Alternative: a separate `CreditDebitNote` entity. Reusing `Invoice` is faster
and reuses the entire FBR pipeline, print, list, and permission stack — recommended.)*

### 7.2 Server-side note validation (add to FbrService pre-validate)

- Load original invoice by `OriginalInvoiceId`; assert it's FBR-Submitted and has an IRN (0057).
- 180-day window: `noteDate <= originalDate.AddDays(180)` (0034).
- `noteDate >= originalDate` (0035).
- Credit note total ≤ original total (0036); sales tax within bounds (0068).
- Debit note sales tax ≤ original sales tax (0067).
- 0064 guard: reject a second credit note against the same `OriginalInvoiceId`
  (pending sandbox confirmation).
- Reason present; remarks present when reason == "Others" (0027/0028).

### 7.3 Service methods

```csharp
Task<InvoiceDto> CreateCreditNoteAsync(int originalInvoiceId, ReturnLinesDto lines, string reason, string? remarks, ...);
Task<InvoiceDto> CreateDebitNoteAsync (int originalInvoiceId, AdjustLinesDto lines, string reason, string? remarks, ...);
```

Both: `_access.AssertAccessAsync(CurrentUserId, original.CompanyId)`, copy
buyer + lines from original, set `DocumentType`, `OriginalInvoiceId`,
`OriginalInvoiceRefIRN`, `NoteReason`; allocate note number via
`NumberAllocationRetry`; run inside a transaction.

### 7.4 Stock reflow

- **Credit Note (return):** record stock **IN** for returned quantities (goods
  come back). New `StockMovementSourceType.CreditNote` so it's traceable and
  reversible, mirroring the invoice OUT sync.
- **Debit Note (extra qty):** record additional **OUT** if it represents extra
  goods shipped.

### 7.5 Controller + permissions

- `POST /api/invoices/{id}/credit-note`, `POST /api/invoices/{id}/debit-note`.
- New keys: `invoices.creditnote.create`, `invoices.debitnote.create`
  (buttons hidden without them, per mobile-first / least-privilege rules).
- Submit/validate reuse existing `invoices.fbr.*` keys.

### 7.6 Frontend

- **"Return / Credit Note" button** on a submitted invoice's row/detail (only
  when `fbrStatus === "Submitted"`, replacing the disabled Void).
- `CreditNoteForm.jsx`: shows original lines with editable return-quantity
  (default 0, max = original qty), reason dropdown + remarks-when-Others,
  live total vs original cap, 180-day-window warning.
- Reuse `FbrPreviewDialog` / submit flow unchanged.
- Print credit note with FBR logo + QR (same as tax invoice), showing
  "Credit Note against Invoice #… (IRN …)".

---

## 8. End-to-end flow (target)

```
Invoice #123 posted to FBR → IRN A, stock OUT recorded
        │
        ├─ NOT yet submitted?  → Void locally (existing CancelAsync). Done. No FBR note.
        │
        └─ Already submitted?  → "Return / Credit Note"
                 │
                 ├─ pick returned lines/qty, reason, (remarks)
                 ├─ validate 180-day window, value ≤ original, one-note-per-invoice
                 ├─ POST postinvoicedata { invoiceType:"Credit Note", invoiceRefNo:A, items:[…] }
                 ├─ FBR issues IRN B → store on the note (FbrIRN = B, ref = A)
                 ├─ stock IN for returned qty
                 └─ print note (logo + QR), declare in STR
```

---

## 9. Open questions — RESOLVED against live FBR (2026-07-01)

> **RESOLVED (Q1 & Q5): "Credit Note" is NOT accepted for a wholesaler.**
> The live `doctypecode` reference API returns only:
> `[{"docTypeId":9,"docDescription":"Debit Note"},{"docTypeId":4,"docDescription":"Sale Invoice"}]`.
> Posting `invoiceType:"Credit Note"` returns **[0003] Provided invoice type is
> not valid**. Credit Notes are gated to "specific users" (error 0071); Hakimi
> isn't one. **A seller reverses/returns via a DEBIT NOTE (docType 9)**, which
> per FBR **0067** is capped at the original invoice — i.e. the return/reduction
> instrument. The feature now generates Debit Notes; "Credit Note" is removed
> from the UI. Stock reflows **IN** on a debit-note reversal (goods returning).
>
> Also resolved along the way: [0401] was the local prod-replica's
> prod-key-encrypted `FbrToken` being undecryptable locally — re-entering the
> token (plaintext, local DB) fixed auth. The strict 22/28-char IRN check was
> removed (real IRNs vary, e.g. 27 chars).
>
> **Still to confirm at submit:** whether FBR accepts multiple partial debit
> notes vs one (0064).

### 9b. Live validation results (2026-07-01, sandbox, Hakimi)

Progressed through every gate our code controls:
- `invoiceType:"Debit Note"` — **accepted** (past [0003]).
- `reason` field (JSON key `reason`, sibling of `invoiceRefNo`) — **accepted**;
  sending it clears **[0027]**. `reasonRemarks` added likewise for "Others".
- Response parser now tolerates FBR's non-strict JSON (trailing comma +
  `sourceInvoiceNo` field) — `AllowTrailingCommas`; real errors now surface.

**Blocked at [0510] "Exception occurred"** on debit-note VALIDATE in sandbox:
- Independent of the reason value (tested "Return of Goods", "Cancellation of
  Supply", "Change in Value of Supply", free text — all identical [0510]).
- A regular Sale Invoice submits fine in the same sandbox (IRN issued).
- ⇒ Strong evidence the **FBR sandbox doesn't support debit-note validation**
  (throws a generic exception for the note flow). Not a code defect — our payload
  mirrors a valid sale invoice plus invoiceType/invoiceRefNo/reason.
- Ruled out `scenarioId`: omitting it for a note → **[0201] scenario id is
  required**; sending SN001 → [0510]. So sandbox *demands* a scenario for the
  note but then can't process it → the note-validation path is broken/incomplete
  in sandbox. Notes keep the sale scenario (code reverted to always send it).
- **Next:** confirm with PRAL whether sandbox supports note validation; the true
  proof is a single controlled PRODUCTION validate/submit (real document — needs
  tax sign-off).

1. ~~Is `"Credit Note"` accepted by `postinvoicedata`?~~ **No — use Debit Note (9).**
2. **Exact JSON field names** for reason / reason-remarks.
3. **0064 semantics** — truly one credit note per invoice, or per period, or
   multiple partials allowed? Drives one-shot vs incremental UX.
4. Does a Debit Note also require the buyer to have posted anything, or is it
   fully seller-driven?
5. Confirm the correct `docTypeId` for Credit Note in `doctypecode` (spec sampled
   only 4 & 9).

---

## 10. Recommended build order

1. **Sandbox spike** — post a hand-built Credit Note against a sandbox invoice;
   answer §9 Q1–Q3. *(No code commit; use `scripts/`.)*
2. **Model + migration** — add the four fields (§7.1), additive.
3. **Server validation + service methods** (§7.2, §7.3), + tenant guards.
4. **Stock reflow** (§7.4) + a `test_stock_itemtype_reflow.py` case for returns.
5. **Controller + permissions** (§7.5).
6. **Frontend Return/Credit-Note screen** (§7.6), responsive, permission-gated.
7. **Print template** + `test_basic_flows.py` credit-note case.
8. Verify with the pre-push scripts, then merge to `master`.

---

## Sources

- FBR DI API Technical Documentation **v1.12** (provided PDF) — §4 payloads,
  §5.2 doctypecode, §7 sales error codes (0026-0071).
- [DIFBR — Sales Returns & Credit Notes guide](https://difbr.pk/blog/sales-returns-credit-note-processing-pakistan)
- [DigitalInvoices.pk — Credit Note vs Debit Note](https://app.digitalinvoices.pk/blog/fbr-credit-debit-note-when-how-issue)
- [Tier3 — FBR Digital Invoicing](https://tier3.pk/digital-invoicing-system-fbr/)
- Sales Tax Act 1990, Section 9 (debit/credit notes).

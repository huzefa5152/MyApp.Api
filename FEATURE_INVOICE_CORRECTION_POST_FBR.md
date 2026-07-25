# Feature: Post-Submission Invoice Correction

**Status:** Design approved (phased). Not started.
**Date:** 2026-07-25
**Branch target:** `feat/sales-quote-order-flow` (or a fresh `feat/invoice-correction`)
**Prototype:** interactive wizard mock — https://claude.ai/code/artifact/9a44163e-06d9-472d-8a12-bca3fddc11e4
**Permission:** reuses `invoices.note.create` (no new key).

---

## 1. Problem

A sale invoice that has been **submitted to FBR** cannot be edited or cancelled — FBR (PRAL/IRIS) exposes no edit or cancel endpoint. Today the app blocks edits on submitted bills and offers only a **Reverse** action (Credit/Debit Note). Operators hit real correction cases that path doesn't cover, and fall back to manual SQL against production.

### Motivating incident (Hakimi Traders, CompanyId 1) — 2026-07-25
- Bill **#3851** (Id 387) filed at FBR: line *Jointing Sheet 4'x4'x1mm Without Wire Klinger* billed **qty 1** @ 5,153. A second line (*60x80x4mm*, qty 1 @ 3,300) was correct.
- Reality: PO `001-2626-0000998` and Delivery Challan **#4323** (Id 333) were both for **6.5** on the 4'x4' line. The invoice under-reported by **5.5 pcs**.
- Operator raised a fresh sale invoice **#3854** (Id 390) for the 5.5 delta (₨28,341.50 + 18% GST = ₨33,442.97) — the correct instinct — but the new invoice had **no delivery-challan / PO link**, so it printed no DC number.
- Fixed manually: cloned challan #4323 at qty 5.5, linked to #3854 (`DuplicatedFromId = 333`), via a transactional SQL insert.

This feature productizes that fix and generalizes it to every post-submission correction case.

## 2. FBR constraints (encoded in the current code — do not violate)

From [`InvoiceService.CreateNoteAsync`](Services/Implementations/InvoiceService.cs) (line ~2268):

| Rule | Where | Meaning |
|---|---|---|
| Note only against a Submitted invoice with an IRN | line ~2286 | corrections need a filed original |
| One live note per type per invoice (FBR 0064) | line ~2297 | can't stack credit notes |
| Credit Note refunds at **original rate** (FBR 0068) | line ~2361 | no rate change on credits |
| Debit Note qty ≤ original line qty | line ~2359 | can't add quantity via a note |
| Note value ≤ original invoice value (Credit 0036 / Debit 0067) | line ~2404 | **upward corrections beyond the original need a new invoice, not a note** |
| Note date ≥ original date (FBR 0035), ≤ 180 days (0034) | line ~2415 | |
| FBR POST never retried | `Program.cs` Retry.ShouldHandle | avoid duplicate IRN |

**Consequence:** an under-billed **quantity** (or any upward correction exceeding the original invoice value) is *not expressible as a Debit Note*. The lawful instrument is a **new supplementary sale invoice** for the delta, which references the original for audit and carries the same PO/challan.

## 3. Correction taxonomy → instrument routing

| Situation | Net direction | Instrument | Status in codebase |
|---|---|---|---|
| Overcharge / discount / goods returned | value ↓ | **Credit Note** (partial/full) | built (`CreateNoteAsync`, DocumentType 10) |
| Right qty, undercharged rate, within original value | value ↑ (small) | **Debit Note** (per-unit delta) | built (`CreateNoteAsync`, DocumentType 9) |
| **Under-billed qty / additional supply beyond original value** | value ↑ (large) | **Unclassified delta bill** + cloned challan → tax consultant | **NEW — Phase 1** |
| Wrong buyer / wrong items — redo | full | Full Credit Note + fresh unclassified bill | Phase 2 |

**Credit/Debit notes vs the delta bill.** A note *reverses an already-filed line*, so it mirrors the FBR-effective (overlay) values and goes straight to Validate → Submit — no re-classification. A **delta bill** is *new goods never filed*, so it is created **unclassified** (bill-mode item type) and the tax consultant classifies + tax-optimises it for FBR through the normal pipeline (see §4).

**Routing is derived from the entered delta, never chosen by the operator:**
```
netDelta  = Σ(correctedQty·correctedRate) − Σ(origQty·origRate)
qtyUp     = any line correctedQty > origQty
if netDelta < 0                         → Credit Note
elif !qtyUp && netDelta within origValue → Debit Note
elif qtyUp (or netDelta exceeds origVal) → Supplementary Invoice
elif corrected == 0 everywhere           → Full reversal + new bill
```

## 4. Phase 1 — Delta bill + challan carry-over (the gap)

Removes the SQL workaround. The "billed too little / more goods delivered" case does **not** produce a finished FBR document. It creates a **plain, unclassified bill** for the delta quantity — carrying the original line's **bill-mode (non-HS) item type** — that re-enters the normal **bill → tax-consultant → FBR** pipeline, and links the cloned challan. FBR classification and submission stay the tax consultant's job, unchanged.

### 4.0 Why unclassified (verified on prod 2026-07-25)
On submitted **#3851** the base `InvoiceItem` still holds the bill-mode type — `ItemTypeId 34 "Rubber"`, no HS, 1 @ 5,153 — while the consultant's FBR filing lives on the **overlay**: `AdjustedItemTypeId 101 "Grinding/Cutting"`, `AdjustedHSCode 6804.1000`, `AdjustedQuantity 6.6 @ 640.38` (`Reason: tax-claim-optimization`). The FBR view is a *re-decomposition*, not a copy of the sale, so a correction must **not** auto-carry FBR fields. The delta bill starts unclassified (Rubber) and the consultant re-optimises it for FBR exactly as they did the original. Manually-created **#3854** already sits in precisely this state: `Rubber, qty 5.5, no HS, no overlay`.

### 4.1 Backend
`Task<InvoiceDto?> CreateSupplementaryInvoiceAsync(int originalInvoiceId, List<NoteLineDto> deltaLines, bool carryChallan, string? reason, DateTime? date, string? actorUserName)`
1. Load original (AsNoTracking, Items + DeliveryChallans). Guard: Submitted with an IRN, not Demo, not itself a note, tenant-accessible.
2. Create a **normal unclassified bill** (`NoteKind = 0`, `FbrStatus = null`, own number from the sale sequence). Each line: `ItemTypeId` = the original **base** `InvoiceItem.ItemTypeId` (the non-HS "Rubber" type), `ItemTypeName`/`Description` copied, `Quantity` = the **quantity delta** (`correctedQty − origQty`), `UnitPrice` = the original base price. Leave `HSCode`/`SaleType`/`RateId` empty and create **no** `InvoiceItemAdjustment` overlay — the consultant adds all of that downstream. (A pure rate increase at the same qty is not a delta bill — it routes to a Debit Note.)
3. If `carryChallan`: for each original linked `DeliveryChallan`, clone it via [`DeliveryChallanRepository.DuplicateAsync`](Repositories/Implementations/DeliveryChallanRepository.cs) semantics — same `ChallanNumber`, `PoNumber`, `DuplicatedFromId = root`, `Status = "Invoiced"`, `SalesOrderId = null`, `DeliveryItems` copied at the **delta** quantity — and link to the new bill.
4. Persist bill + cloned challan(s) in **one `SaveChanges`** (SQL Server 2025 constraint — see [InvoiceService.cs:783](Services/Implementations/InvoiceService.cs)); EF orders INSERT(bill)→UPDATE(challan FK) itself.
5. **Stock:** none forced at creation. An unclassified (no-HS) line records no movement under the company's inventory rules until it is classified; the existing `StockService` pipeline then handles it exactly as for any bill — which also avoids the phantom-reversal the reflow tests guard against.
6. Optional nullable `Invoice.SupplementsInvoiceId` (+ EF config, additive migration) mirroring `OriginalInvoiceId`, for the audit back-link and a "Supplemented by #N" badge. Numbering unaffected.

New endpoint: `POST /invoices/{id}/supplement`, `[HasPermission("invoices.note.create")]`, `AssertAccessAsync(CurrentUserId, original.CompanyId)`.

### 4.2 Frontend
- On a submitted bill, add **Correct** (keep **Reverse** for now, or fold it in — see Phase 2). Gated by `has("invoices.note.create")`.
- The wizard collects only: which lines + corrected quantity (shown against the base **bill-mode** item types, e.g. "Rubber"), and a challan carry-over confirmation. It **ends at "Create delta bill"** — then routes the operator to the new bill in the Bills list with a banner: *"Bill #N created for the 5.5-pc balance — hand to the tax consultant to classify (HS item type) and adjust for FBR."*
- **Downstream is the existing invoice-mode flow** (overlay classify + qty/price via `UpdateItemTypesAsync` / `InvoiceItemAdjustment`, then Validate + Submit). No new FBR code in this phase.

### 4.3 Data integrity checklist
- New bill is **unclassified by design**; FBR-readiness is reached only through the consultant's overlay, same as any bill.
- Cloned challan reuses `ChallanNumber` — **non-unique** composite index, safe ([AppDbContext.cs:358](Data/AppDbContext.cs)). No `CurrentChallanNumber` bump.
- `SalesOrderId`/`SalesOrderItemId` null on clone → no double fulfilment rollup.
- Original invoice + its challan left **untouched** (frozen as filed).
- Delta qty must be > 0; block a zero/negative delta with a clear message.
- Delta-bill-on-a-delta-bill allowed (each is an independent sale) but surfaced in the badge chain.

## 5. Phase 2 — Unified auto-routing "Correct" wizard

Wraps Phase 1 + the existing note engine into the single guided flow shown in the prototype:
- One **Correct** entry replaces Reverse.
- Steps: Diagnose → Corrected figures (live routing) → Reason & tax → Delivery link → Review & file.
- Credit/Debit branches call the existing `CreateNoteAsync`; the Supplementary branch calls `CreateSupplementaryInvoiceAsync`; the "redo" case composes a full Credit Note + a fresh invoice.
- Mixed corrections (some lines ↓, some ↑ beyond original) may emit **both** a note and a supplement in one confirmed action — the wizard explains this before creating.

## 6. Testing (pre-push, per CLAUDE.md)
- `dotnet build MyApp.Api.csproj` → 0 errors.
- `scripts/test_basic_flows.py` — add: supplementary-invoice math + challan link + PO carry-over.
- `scripts/test_tenant_isolation.py` — add the `/supplement` endpoint.
- `scripts/test_stock_itemtype_reflow.py` — add: delta stock OUT on supplement, reversal on delete.
- `python scripts/verify_audit_2026_05_13_security.py` → 67/67.
- README `## Changelog` dated entry.
- Manual: reproduce the #3851 → #3854 flow on the branch DB (never the prod replica), verify DC #4323 prints and FBR validate passes.

## 7. Open questions
1. Keep **Reverse** alongside **Correct** during Phase 1, or replace immediately? (Prototype assumes eventual replacement.)
2. Should a supplementary invoice reference the original's IRN in any FBR field, or stay a fully independent sale (recommended — it is a separate supply)? Confirm with PRAL behaviour.
3. `SupplementsInvoiceId` back-link — include in Phase 1 (recommended, cheap, additive) or defer?

## 8. Out of scope
- Editing/cancelling the filed FBR document (impossible by FBR design).
- Changing the buyer on a challan-linked bill (already blocked; use redo path).
- Any change to the FBR submission/Polly retry behaviour.

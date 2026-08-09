# Feature Spec — Customer Document Handover Status

**Status:** ✅ Implemented 2026-08-09 (master merged into the branch first). All pre-push gates green (build 0 errors; stock-reflow 140/140; basic-flows 37/37; tenant-isolation incl. handover guard; new `test_doc_handover.py` 19/19; audit 67/67). No FBR / stock / calc regressions.
**Date:** 2026-08-04 (design) · 2026-08-09 (implementation)
**Branch:** `feat/customer-doc-handover` (off `master`). Merge back to `master` when complete.
**Owner:** Huzefa

> **Implementation note — bulk UX.** v1 ships bulk as **"Mark all pending (filtered) delivered"** — one button that acts on every Pending row matching the current filters (across pages), reusing the existing Validate-All / Submit-All bulk pattern this spec references. This was chosen over per-row checkboxes (§8): the codebase's existing bulk actions are set-based, not checkbox-based, and it avoids adding fragile multi-page selection state to the card + table views. Same outcome, lower risk. Revisit checkboxes if operators want partial multi-select.

---

## 1. Problem

The Bill and Tax Invoice modules already support FBR submission. Today the system knows an invoice is **FBR Submitted**, but it does **not** know whether the printed customer copies (two Tax Invoice copies + one Bill) have actually been **physically handed to the customer**.

Consequences: staff track handover in their heads; another operator can't see which FBR-approved invoices are still sitting in the office undelivered.

**Print history is not a proxy for handover** — users reprint, preview PDFs, print internal copies, lose and reprint, or print today and deliver tomorrow. Print is an *operational* event; handover is a *business* event. We must track handover as its own state, never derived from prints.

This feature answers exactly one question per invoice: **"Have the required physical documents been handed over to the customer?"**

---

## 2. Decisions (locked during design)

| Question | Decision |
|---|---|
| **Scope** — which rows get a handover status? | **FBR-submitted invoices only.** The Tax Invoice you hand over only exists once submitted, so the status is meaningful only then. Non-submitted rows show "—". |
| **Launch backfill** — existing submitted invoices? | **Assume delivered.** One-time backfill marks every already-submitted invoice as Delivered so the Pending filter starts empty; only new submissions enter the Pending flow. Backfilled rows have `HandoverByUserId = null` so "migrated" is distinguishable from a real operator handover (no fabricated operator name). |
| **v1 feature set** | **All of:** bulk "Mark Delivered", revert (un-deliver), include Credit/Debit Notes, and an optional handover remark field. |
| **Naming** | Column **"Documents"**; badge states **Pending** 🟡 / **Delivered** 🟢 (and **—** for non-submitted). Chosen over "Customer Delivery" to avoid confusion with the *Delivery Challan* (goods delivery). |

**This status is completely independent of FBR status, payment status, and print history.** It is only *gated to appear* on FBR-submitted rows; it never changes based on FBR/payment/print events after that.

---

## 3. Data model

Three **additive, nullable** columns on `Invoice` (Models/Invoice.cs). Nothing existing changes.

| Column | Type | Meaning |
|---|---|---|
| `HandoverAt` | `DateTime?` | When documents were handed over. Null = not yet handed over. |
| `HandoverByUserId` | `int?` (FK → `Users.Id`, `OnDelete: SetNull`) | Operator who marked it. Null = system backfill (migrated). |
| `HandoverRemark` | `string?` (maxlen 300) | Optional free-text ("received by Ali at gate", "TCS #123"). |

Navigation: `HandoverBy` → `User` (nullable) so the DTO can show the operator name.

**No status enum / status string is stored** — the status is *derived* (see §4), mirroring how this codebase already derives payment status from `AmountPaid` and pairs `FbrStatus`/`FbrSubmittedAt`. Revert simply nulls the three fields; **who/when of a revert is captured by the existing `AuditLogService`**, so no extra columns are needed.

**Optional index** (perf, non-critical): `(CompanyId, HandoverAt)` to back the Pending/Delivered filter. Add only if the list query shows up hot.

---

## 4. Derived status logic

Computed at read time (in the DTO mapper / a small helper), never stored:

```
if (FbrStatus != "Submitted")   → "—"        (NotApplicable — column blank)
else if (HandoverAt == null)    → "Pending"  🟡
else                            → "Delivered" 🟢
```

Cancelled and demo invoices are treated as NotApplicable ("—") regardless — they are never handed over.

---

## 5. API (all endpoints tenant-guarded + permission-gated)

Add to `InvoicesController` (business logic in `InvoiceService`). Every endpoint that takes an invoice id must `await _access.AssertAccessAsync(CurrentUserId, invoice.CompanyId)` against the **stored** invoice's CompanyId (never a body field).

| Endpoint | Body | Behaviour | Permission |
|---|---|---|---|
| `POST /api/invoices/{id}/handover` | `{ remark? }` | Set `HandoverAt = now`, `HandoverByUserId = current user`, `HandoverRemark`. **Reject** (400) if the invoice is not `FbrStatus == "Submitted"`, or is cancelled/demo, or already delivered. | `invoices.docs.deliver` |
| `POST /api/invoices/{id}/handover/revert` | — | Clear `HandoverAt` / `HandoverByUserId` / `HandoverRemark` back to null. Reject if not currently delivered. | `invoices.docs.revert` |
| `POST /api/invoices/handover/bulk` | `{ ids: int[], remark? }` | Mark all eligible ids delivered in one call. Per-id tenant assert; silently skip ineligible ids (not submitted / already delivered / cross-tenant) and return a per-id result summary. | `invoices.docs.deliver` |

All writes log via `AuditLogService.LogAsync` (captures operator + timestamp, and covers the revert audit trail). Return generic error messages (never `ex.Message`).

**List endpoint** (`GET` bills/invoices list → `InvoiceService.GetPagedByCompanyAsync` / `InvoiceRepository`): add a `handoverFilter` param (`all` | `pending` | `delivered`), applied **server-side** exactly like the existing `fbrFilter` so pagination stays correct:
- `pending`   → `FbrStatus == "Submitted" && HandoverAt == null`
- `delivered` → `HandoverAt != null`
- `all`       → no extra predicate

`InvoiceDto` (DTOs/InvoiceDto.cs) gains: `handoverStatus` (derived string), `handoverAt`, `handoverByName`, `handoverRemark`.

---

## 6. Permissions

New keys in `Helpers/PermissionCatalog.cs`, module **"Invoices"**, page **"Documents"**:

```csharp
new("invoices.docs.deliver", "Invoices", "Documents", "Mark Delivered",
    "Mark an FBR-submitted invoice's customer documents as handed over (single or bulk)"),
new("invoices.docs.revert",  "Invoices", "Documents", "Revert Delivery",
    "Revert a delivered invoice back to Pending (mis-click / wrong-invoice recovery)"),
```

- **No new *view* permission** — the "Documents" column renders for anyone with `invoices.list.view`; only the write actions are gated. (Add a `invoices.docs.view` later only if some role must not see delivery state at all.)
- Map the "Documents" page into the correct navbar bucket in `myapp-frontend/src/config/permissionSections.js` and keep `scripts/verify_permission_sections.py` green (so it doesn't land in the role-editor OTHER bucket).

---

## 7. Backfill (one-time, idempotent)

Follow the repo idiom: an AuditLog-marked block (like the existing `*_BACKFILL_V1` blocks in `Program.cs`). Marker `ExceptionType = 'HANDOVER_BACKFILL_V1'`.

```sql
UPDATE Invoices
   SET HandoverAt = FbrSubmittedAt      -- approximate; better than a synthetic launch date
 WHERE FbrStatus = 'Submitted'
   AND HandoverAt IS NULL;
-- HandoverByUserId left NULL → UI shows "Delivered (migrated)"
```

Gate on the marker so it runs exactly once. Note the SQL-Server split-batch rule: the `ALTER TABLE ADD COLUMN` (from the migration) and any statement referencing the new column must be in separate batches / `EXEC('...')` (see `Program.cs` SecurityStamp backfill pattern) — but here the column is added by the EF migration first, so the backfill block (running after `Migrate()`) can reference it directly.

Migration: additive columns + FK + optional index. Applied per the branch process — on `master`/prod via CI migration; on the local `db46684` replica by hand if `AutoMigrate` is off there (see `project_ef_designtime_factory_db` / `project_audit_fix_branch` memory for the sqlcmd `-I` recipe).

---

## 8. UI

**Home:** the **Invoices tab** (`pages/InvoicePage.jsx`, the FBR-facing view) **and the Credit/Debit Notes view** (notes are included). **Not** the pre-FBR Bills tab — there almost every row is non-submitted ("—"), so the column adds noise there. (Revisit if operators ask for it on Bills.)

**Per row:**
- New **"Documents"** column showing the badge: `Pending` 🟡 / `Delivered` 🟢 / `—`. Follow the existing FBR-status badge component/pattern (`Components/StatusBadge.jsx`). Show the two statuses **separately** from the FBR status badge — they answer different questions.
- On a **Pending** row: **Mark as Delivered** action → confirmation dialog with an optional remark input. Renders only with `invoices.docs.deliver`.
- On a **Delivered** row: show delivered date + operator on hover/expand; **Revert** action, rendered only with `invoices.docs.revert`.

**Bulk:** row checkboxes + a "Mark N Delivered" action bar, reusing the existing bulk-action pattern (cf. the FBR Validate-All / Submit-All bulk UI and `BulkFbrResultsDialog.jsx`). Confirm dialog + optional shared remark; show a per-invoice result summary.

**Filter:** chips **All / Pending / Delivered** (default **All**), wired to the server-side `handoverFilter`. Mirror the existing `fbrFilter` chip UI.

**Standards (mandatory — CLAUDE.md §2, §3):**
- Permission-gate every action button — do **not** render a button the user can't activate.
- Responsive at **375 / 768 / 1280**: the new column folds into the mobile card view (use the existing responsive card branch on these lists); no horizontal page scroll on phone. Verify before calling done.

---

## 9. Explicitly UNCHANGED (safety boundary)

No change to: FBR submission logic, invoice/tax calculations, payment logic, printing logic, existing statuses (FBR / cancelled / demo), numbering, or stock. This feature only **adds** three nullable columns + the handover read/write paths. It does not touch any existing write path.

---

## 10. Verification

**Functional scenarios:**
1. Create invoice → FBR Submit → Documents column shows **Pending**.
2. Print the documents any number of times → still **Pending** (print is decoupled).
3. Mark as Delivered → **Delivered**, with delivered date + operator recorded.
4. Filter **Pending** → the delivered invoice disappears; filter **Delivered** → it appears.
5. Revert a delivered invoice → back to **Pending**; AuditLog records who reverted.
6. Bulk-select several submitted-pending invoices → Mark Delivered → all flip to Delivered.
7. Credit/Debit Note (submitted) → same handover column + actions work.
8. Non-submitted / cancelled / demo rows → column shows **—**; the deliver endpoint 400s if called on them.
9. Existing invoices, payments, reports, dashboards, and FBR integrations behave exactly as before.

**Test plan (pre-push gate — CLAUDE.md):**
- `dotnet build` = 0 errors.
- Add a **tenant-isolation** case to `scripts/test_tenant_isolation.py` for the 3 new endpoints (a user without access to the invoice's company gets 403; body-forged companyId is ignored).
- Add a **flow** case (new script or extend `test_basic_flows.py`): submit → mark → filter pending/delivered → revert → bulk → backfill assertion.
- Run the **stock reflow** gate (`scripts/test_stock_itemtype_reflow.py`, must stay 140/140) — this feature doesn't touch stock, but the hard pre-push rule still applies to any push reaching master.
- Verify permission-section mapping: `scripts/verify_permission_sections.py`.
- Verify UI at 375 / 768 / 1280 (browser).

---

## 11. Deferred / v2 (out of scope for v1)

- Handover on the **Bills tab** (only if operators request it).
- A **dashboard KPI tile** ("N invoices pending handover").
- Per-customer handover roll-up / a dedicated "pending handovers" worklist screen.
- Recording **multiple partial handovers** (v1 is a single delivered/not-delivered flip).

---

## 12. Implementation checklist (ordered, for the future session)

1. **Model + migration:** add `HandoverAt`, `HandoverByUserId` (FK `SetNull`), `HandoverRemark` to `Invoice` + `AppDbContext` config (+ optional `(CompanyId, HandoverAt)` index). Generate the EF migration; apply to `db46684` by hand if needed.
2. **Backfill block** in `Program.cs` (marker `HANDOVER_BACKFILL_V1`).
3. **DTO:** extend `InvoiceDto` with the derived status + audit fields; update the mapper.
4. **Service:** `MarkHandoverAsync`, `RevertHandoverAsync`, `BulkMarkHandoverAsync` in `InvoiceService`; `handoverFilter` in `GetPagedByCompanyAsync` (server-side, in `InvoiceRepository`).
5. **Controller:** 3 endpoints in `InvoicesController` with `[HasPermission]` + tenant asserts; wire `handoverFilter` into the list action.
6. **Permissions:** add the 2 keys to `PermissionCatalog.cs`; map "Documents" page in `permissionSections.js`.
7. **Frontend:** Documents column + badge; Mark-Delivered dialog; Revert action; bulk bar; filter chips — on `InvoicePage.jsx` + the Notes view. Permission-gate all buttons. Responsive.
8. **Tests:** tenant-isolation + flow cases; run the full pre-push gate.
9. **Changelog:** append a dated entry to `README.md` `## Changelog`.
10. Merge to `master` on full-confidence (full gate green).

# System Audit — 2026-07-27

Full-system bug & business-flow audit of MyApp.Api (feat/sales-quote-order-flow). Read-only. Six parallel subsystem audits (tenant/RBAC, FBR+invoice/bill/challan, stock, accounting, sales chain, data-integrity/SQL/errors) + the existing test/verifier baseline + spot code-verification of every Critical and top High.

## Fix status

**Batch 1 — security gates & cross-tenant holes (FIXED + verified green: reflow 140/140, basic 37/37, tenant-iso pass, static 67/67):**
`C1` dashboard KPI tenant assert · `C2` common-client delete scoping + FBR-submitted-invoice guard · `C3` `/data` business-doc serving blocked (excel-templates / po_imports / parser_feedback; logos+avatars stay public) · `H6` FBR-token GETs tenant-asserted · `H7` PO-import + parser-feedback downloads tenant-scoped · `H8` common-client **update** scoped to accessible companies (clients) · `M5` create-path FBR-token gate · `M12` FBR v2 reference endpoints permission-gated.

**Batch 2 — data-corruption fixes (FIXED + verified: reflow 140/140, basic 37/37, tenant-iso pass):**
`H1` credit/debit note reverses stock against the **effective** type (`AdjustedItemTypeId ?? physical`) — no more restocking the wrong item (note-reversal path can't be exercised offline: note creation requires an FBR-submitted invoice + IRN, so this is a code-inspection fix mirroring the proven suites 8–13 overlay logic) · `H2` bounced cheques excluded from `AmountPaid`, and `SetChequeStatusAsync` reflows the settled documents on a bounce/un-bounce · `M3` FBR purchase-import records IN only for HS-tracked item types · `M4` stock re-sync backfill filter now includes type-only reclassifications.

**Batch 3 — concurrency + error-leaks (FIXED + verified: reflow 140/140, basic 37/37):**
`H3` bill-create re-asserts each challan's billable status INSIDE the per-company app-locked section (fresh DB read) — a double-click can no longer bill one challan twice · `H4` `SalesOrderService.CreateAsync` blocks linking an already-converted quote (the no-concurrency double-order vector) · `H10` FBR-submit + bulk-challan-import log the real exception and return a generic message (no raw `ex.Message` to the client).

**Deferred (needs a dedicated, FBR-sandbox-tested fix):** `H5` concurrent/timed-out FBR submit → duplicate IRN. Serialising submit per-invoice + timeout reconciliation touches the delicate PRAL POST path and can't be verified offline; rushing it risks worse FBR outcomes. Left documented above.

**Batch 4 — last cross-tenant High (FIXED):** `H8-suppliers` common-supplier update + delete scoped to the caller's accessible companies (mirrors the client fix). **All cross-tenant CRITICAL/HIGH holes are now closed.**

**Remaining** (H4 unique-index migration, H9 SQL-2025 purchase paths, and the MEDIUM/LOW set — M1/M2/M6/M7/M8/M9/M10/M11/M13/M14/M15/M16 + L1–L14) — lower-priority correctness/hardening; for subsequent verified batches.

---

This is a findings report with fixes applied incrementally per the batch status above.

## Baseline (regression guardrails — all green)

| Check | Result |
|---|---|
| `verify_audit_2026_05_13_security.py` (static) | 67/67 |
| `test_basic_flows.py` | 37/37 |
| `test_tenant_isolation.py` | all pass |
| `test_stock_itemtype_reflow.py` (suites 1–13) | 140/140 |

The bugs below are **outside** what those suites cover — every one names a coverage gap.

**Verify tag:** `[V]` = I read the cited code and confirmed it. `[A]` = agent-identified with file:line; read the cited path before fixing.

---

## CRITICAL

### C1 [V] — Dashboard KPIs leak every tenant's financials to any user
`Controllers/DashboardController.cs:37-47` + `Services/Implementations/DashboardService.cs` (no `_access` anywhere)
`GET /api/dashboard/kpis?companyId=X` carries only `[HasPermission("dashboard.view")]` — **no `[AuthorizeCompany]`**, and `DashboardService.GetKpisAsync` never calls `ICompanyAccessGuard` (the code comment says "we trust the upstream guard"; there is none). Per-KPI flags are checked against the caller's *global* permissions, not per-tenant.
**Exploit:** a user scoped to company Alpha calls `?companyId=<Beta>` → receives Beta's Total Sales/Purchases, top clients+amounts, recent invoices, top suppliers, trends, stock value, FBR counts. `dashboard.view` is the most broadly granted key.
**Fix:** add `[AuthorizeCompany]` to the action (companyId is a query param) or `await _access.AssertAccessAsync(CurrentUserId, companyId)` at the top of the service. Add to `test_tenant_isolation.py`.

### C2 [V] — Cross-tenant cascade DELETE via Common-Client group destroys another tenant's filed invoices
`Controllers/ClientsController.cs:107-124 (DeleteCommon)` → `ClientGroupService.cs:373-422` → `ClientService.DeleteAsync:306-337`
`DELETE /api/clients/common/{groupId}` is gated only by `clients.manage.delete` (no tenant assert). The service loops over **every member client across all companies** in the group and calls `ClientService.DeleteAsync`, which **unconditionally** `ExecuteDeleteAsync`es that client's `Invoices` (`:325`, incl. FBR-submitted), `InvoiceItems` (`:324`), `DeliveryChallans` (`:333`), `DeliveryItems` (`:332`) — no "has invoices" guard.
**Exploit:** a Hakimi operator deletes a Common-Client group that also has a Roshan member (Common Clients exist to link the same buyer across tenants) → **permanently destroys Roshan's invoices + challans** for that customer, including filed tax records.
**Fix:** in the common path, only touch members of companies the caller can access (`GetAccessibleCompanyIdsAsync`); and block/soft-guard `DeleteAsync` when the client has non-cancelled invoices (surface "reassign/cancel first"). Never hard-`ExecuteDelete` FBR-submitted invoices.

### C3 [V] — Tenant Excel print-templates served with ZERO authentication at predictable URLs
`Program.cs:1891-1904` + `Controllers/PrintTemplatesController.cs:291,432`
The `/data` static provider serves everything under `data/`; the interceptor (`:1893`) blocks **only** `/data/attachments`. Excel templates are written to `data/uploads/excel-templates/` with guessable names — `template_{id}{ext}` and `company_{companyId}_{templateType}{ext}`.
**Exploit (no token):** `GET /data/uploads/excel-templates/company_1_Invoice.xlsx`, iterate `company_2_*`, `template_1..N` → anonymous cross-tenant read of every company's letterhead/layout templates (which embed per-line GL/account mappings). Upload IS gated; the *serving* is wide open. (PO-import archives + parser-feedback PDFs also sit under `/data` — GUID-named so not brute-forceable, but any leaked URL exposes them.)
**Fix:** extend the `:1893` interceptor to 404 `/data/uploads/*` (or move business uploads outside the served root) and serve templates only through an authenticated, company-asserted endpoint — mirror the `/api/attachments/{id}/download` pattern.

---

## HIGH

### H1 [V] — Credit/Debit note reverses stock against the WRONG item on dual-book bills *(found independently by 2 agents)*
`Services/Implementations/InvoiceService.cs:2320 (BuildLine)` vs `StockService.cs:320-321,382`
`BuildLine` sets the note line's `ItemTypeId = src.ItemTypeId` (physical/base) and copies `AdjustedHSCode`/`AdjustedSaleType` but **not** `AdjustedItemTypeId`. The stale comment at `:2308` claims the base type is "what the original OUT was recorded against" — but the 2026-07-27 fix made the original OUT key off the **effective** type (`AdjustedItemTypeId ?? ItemTypeId`). The note carries no overlay, so its reversal keys off the base type → a different bucket than the sale's OUT.
**Repro:** non-HS family line reclassified to HS via overlay → sale OUT on HS. Full Credit Note (default one-click Reverse) → IN on the non-HS base (untracked ⇒ **no movement at all**) → sold HS item stays permanently depleted. (HS→HS variant corrupts *two* items.)
**Fix:** note stock lines must use `overlay.AdjustedItemTypeId ?? src.ItemTypeId` (mirror HSCode/SaleType). Add a note-reversal case to `test_stock_itemtype_reflow.py`.

### H2 [V] — Bounced / post-dated cheque still counts as fully Paid
`Services/Implementations/PaymentService.cs:373-408` + `Models/Accounting/Payment.cs`
`RecomputeInvoiceAsync/RecomputePurchaseBillAsync` sum allocations filtered only by `!Payment.IsCancelled` — **no `ChequeStatus` filter**. `SetChequeStatusAsync` sets the status and saves but **never recomputes**. `IsCancelled` is **never set true anywhere** (no void endpoint) — the `!IsCancelled` filter is dead code; the only reversal is a destructive `DeleteAsync`.
**Exploit:** cheque receipt → invoice instantly Paid, balance 0. Cheque bounces → `PATCH .../cheque-status {Bounced}` → invoice **still Paid**, and (because `Status` returns Paid whenever `amountPaid ≥ grandTotal`) never re-enters Overdue. AR/cash overstated by every uncleared/bounced cheque — the dominant instrument for a PK wholesaler.
**Fix:** exclude `Bounced` (and optionally un-Cleared PDCs) from the `AmountPaid` sum; call the recompute helpers from `SetChequeStatusAsync`; add a non-destructive void that sets `IsCancelled` + reflows.

### H3 [V] — Double-clicking "Create Bill" bills one challan twice
`Services/Implementations/InvoiceService.cs:484` (billable check) vs `:717` (number app-lock)
The `dc.Status != "Pending" && != "Imported"` check runs at `:484`, **before** `AcquireInvoiceNumberLockAsync` (`:717`) and outside the serialized section, and is never re-checked inside. No `RowVersion` anywhere. Two overlapping creates both read the challan as Pending, both pass, both create an invoice (distinct numbers), both set `dc.Status="Invoiced"` (last-writer-wins).
**Result:** two bills for one delivery, **two stock OUT movements**, two consumed invoice numbers, one orphaned bill — either/both submittable to FBR.
**Fix:** re-load + re-assert challan billable status *inside* the app-locked transaction (or add a `RowVersion` to `DeliveryChallan` and a concurrency check).

### H4 [V] — A single Sales Quote can spawn TWO Sales Orders
`Services/Implementations/SalesOrderService.cs:239-246 (CreateAsync)` + `SalesQuoteService.cs:326-357` + `AppDbContext.cs` (no unique index on `SalesOrder.SalesQuoteId`)
`ConvertToSalesOrderAsync` has an app-level "already converted" check, but `SalesOrderService.CreateAsync` accepts `dto.SalesQuoteId` and validates **only** company ownership — no already-linked guard — and there is **no unique index** on `SalesOrder.SalesQuoteId`.
**Exploit (no concurrency needed):** `POST /api/salesorders/company/{id}` with an already-converted quote's `salesQuoteId` → a second order linked to the same quote → duplicated delivery+billing chains. (Also reproducible by double-clicking Convert — no in-flight guard on the button.)
**Fix:** add the already-linked guard to `CreateAsync`; add a filtered unique index on `SalesOrder.SalesQuoteId WHERE SalesQuoteId IS NOT NULL`.

### H5 [V] — Concurrent / timed-out FBR submit issues DUPLICATE IRNs
`Services/Implementations/FbrService.cs:739-746,1078,1279-1302`
The duplicate-submit guard (`if (isSubmit && !IsNullOrWhiteSpace(invoice.FbrIRN))`) is check-then-act with no serialization/token. Two overlapping `POST /fbr/{id}/submit` both see null IRN → two PRAL filings. The 30/min fixed-window limiter doesn't stop two near-simultaneous requests; the `X-Idempotency-Key` is a documented no-op. **Separately**, a submit that **times out but succeeded server-side** persists status "Failed" with null IRN (`:1279-1285`) → freely resubmittable → duplicate IRN; the local invoice never records the "uncertain" state that `FbrCommunicationLog` does. This is the CLAUDE.md §10 worst case. (Polly correctly never retries the POST — verified.)
**Fix:** serialize submit per invoice (app-lock like numbering) + re-check IRN inside; on submit timeout, mark the invoice "uncertain" and block resubmit until reconciled against the monitor.

### H6 [V] — FBR reference GETs are ungated → cross-tenant PRAL-token bleed
`Controllers/ItemTypesController.cs:46 (uoms-for-hs), :65 (fbr-hints)` (and `:76,:112,:118` GET reads)
These GETs have **no `[HasPermission]` and no `[AuthorizeCompany]`** (permission attributes start at `:130` for create/update/delete). `uoms-for-hs`/`fbr-hints` call PRAL using the **target company's** stored `FbrToken`.
**Exploit:** any authenticated user, `GET /api/itemtypes/uoms-for-hs?companyId=<victim>&hsCode=…` → server hits PRAL with the victim tenant's bearer token → unauthorized use of their credential + burns their daily FBR quota (a compliance DoS). Exactly the CLAUDE.md §10 "never bleed one tenant's token" anti-pattern.
**Fix:** add `[HasPermission("fbr.reference.read")]` + `[AuthorizeCompany]` to these GETs (mirror the v1 reference endpoints).

### H7 [V] — Cross-tenant document downloads: archived customer POs + retained feedback PDFs
`Controllers/POImportController.cs:380-441` + `Controllers/ImportFeedbackController.cs:79-130` → `ParserFeedbackService.cs:137,146`
`GET /poimport/archives` (no companyId ⇒ all tenants), `GET /poimport/archives/{id}/file`, `GET /import-feedback/incorrect` (all tenants), `{id}/download`, `POST /download` (bulk ZIP) are gated only by a permission key — **no `AssertAccessAsync`, no CompanyId scoping**. `POImportController` injects no access guard at all.
**Exploit:** a perm-holder enumerates ids and downloads other tenants' original customer-PO PDFs.
**Fix:** scope list queries to accessible companies; `AssertAccessAsync(CurrentUserId, row.CompanyId)` before serving any file.

### H8 [V] — Cross-tenant master-data overwrite via Common-Client/Supplier update
`Controllers/ClientsController.cs:76-95` + `SuppliersController.cs:61-99` → `ClientGroupService.cs:299-371`
`PUT /api/clients/common/{groupId}` (+ supplier mirror), gated only by `clients.manage.update`, writes `Name/Address/Phone/Email/NTN/STRN/CNIC/Site/RegistrationType/FbrProvinceCode` onto **every sibling row in every company**.
**Exploit:** a Hakimi operator edits a shared Common Client → silently rewrites Roshan's client **NTN/STRN** (the tax identifiers printed on FBR invoices) → victim's future filings carry forged tax IDs.
**Fix:** restrict the fan-out to the caller's accessible companies.

### H9 [A] — Purchase-bill & FBR-import creates chain FK-dependent rows across two `SaveChanges` (SQL Server 2025 hazard — NOT fixed)
`Services/Implementations/PurchaseBillService.cs:385,409-426` + `FbrPurchaseImportCommitter.cs:169,197-200`
Same class as the confirmed prod bug fixed for invoices (de79182, one-`SaveChanges`). PurchaseBill `CreateAsync` (procure-against-sale path) inserts `PurchaseItemSourceLine` rows in save #2 that FK-reference `PurchaseItem`s from save #1; the FBR-import committer chains supplier→bill→item→itemtype across saves. On SQL Server 2025 (prod), the save-N FK insert may not see the save-(N-1) row → `FK 547` → whole create rolls back. Team's own note flags "PurchaseBill/GoodsReceipt latent."
**Fix:** collapse each into a single `SaveChanges` using navigation properties (mirror the invoice/challan fix at `InvoiceService.cs:798-808`).

### H10 [V] — Raw `ex.Message` returned to the client on FBR submit + bulk import
`Services/Implementations/FbrService.cs:1288` (`"Unexpected error: {ex.Message}"` → returned as the submit result) + `DeliveryChallanService.cs:1042` (`result.Error = ex.Message`, no logging)
A non-HTTP exception during submit (SqlException, DataProtection Unprotect failure) returns 200 with raw SQL/EF/stack text on the most token-sensitive surface. The bulk-challan-import catch leaks raw DB text with no log. Contradicts CLAUDE.md §7. (~60 controller 4xx `catch (InvalidOperationException) → ex.Message` sites are lower risk — mostly curated strings — but EF/LINQ also throw `InvalidOperationException`, so framework text can surface.)
**Fix:** log + return a generic operator message; never surface `ex.Message` on 5xx-class failures.

---

## MEDIUM

- **M1 [V] Edit a paid bill's total below `AmountPaid` → hidden overpayment.** `InvoiceService.UpdateAsync` recomputes `GrandTotal` with no check against stored `AmountPaid`; `IsInvoiceEditable` ignores payment status. `BalanceDue` clamps negative to 0 → shows "Paid, balance 0" hiding the overpayment + leaving an over-allocation the payment guard forbids. (`InvoiceService.cs:168,1422-1426`; `PurchaseBillService.cs:559`.) Fix: block/reconcile edits that drop `GrandTotal` below `AmountPaid`.
- **M2 [V] Over-allocation guard not concurrency-safe.** `PaymentService.cs:133-150` reads stored `AmountPaid` then inserts, no row/app-lock. Double-clicked "Save receipt" → two receipts, both pass, invoice doubly over-paid. Fix: serialize per document (app-lock) or re-check under lock.
- **M3 [A] FBR purchase-import records Stock IN without the HS-code tracked gate.** `FbrPurchaseImportCommitter.cs:207-222` gates only on `itemTypeId.HasValue && qty>0`, unlike `PurchaseBillService` + the OUT side. A no-HS catalog item gets a phantom IN; a later edit's gated reconcile emits a compensating OUT → silent on-hand drift. Fix: apply `GetStockTrackedItemTypeIdsAsync`.
- **M4 [A] One-time stock re-sync backfill misses type-only reclassifications.** `Program.cs:1564-1568` selects `AdjustedQuantity != null`, excluding type-only (non-HS→HS at same qty — the headline dual-book flow); marker-gated so it can't re-run. Fix: filter `AdjustedItemTypeId != null || AdjustedQuantity != null`.
- **M5 [V] FBR token WRITE on company create bypasses the `companies.manage.fbrtoken` gate.** `CompanyService.CreateAsync:140` sets `FbrToken = dto.FbrToken` under only `companies.manage.create` (the update path strips it correctly). Violates CLAUDE.md §9. Fix: ignore `dto.FbrToken` on create unless the caller holds `companies.manage.fbrtoken`.
- **M6 [A] Report Excel exports bypass `CsvSafe` (formula injection).** `ReportService.cs:279,297,299,490,491,495` write operator free-text (client/product/party/HS/NTN) raw via `ws.Cell(...).Value`; `CsvSafe` is private + never called here. A client named `=HYPERLINK(...)`/`=WEBSERVICE(...)` lands live in tax-consultant-facing exports. Violates §8. (Template exports ARE compliant.) Fix: route these cells through the CSV-safe neutraliser.
- **M7 [A] Excel-template upload: extension+size only, no magic-byte sniff; allows macro-enabled `.xlsm`.** `PrintTemplatesController.cs:268-271,424` skips the §8 validator. Combined with C3, a planted `.xlsm` is handed to anonymous victims at a predictable URL.
- **M8 [V] Challan-driven bill edit leaves a stale "Validated" FBR badge.** `DeliveryChallanService.cs:585-594` recomputes totals but only nulls `FbrStatus` when a line hits price 0; a qty change keeps `FbrStatus="Validated"` on a bill whose amount changed (other edit paths null it on any edit). Misleading, not corrupting.
- **M9 [A] Unbounded whole-DB list, cross-tenant, filtered in memory.** `ClientService.GetAllAsync` (+ Suppliers, ItemTypes) `SELECT *` across all tenants, `.ToList()`, then filter by accessible companies in memory (`ClientsController.cs:135`). Other tenants' rows transit app memory; cost grows with global row count on hot picker paths. Fix: push the company filter into SQL.
- **M10 [A] `paymentstatus.view` scrub missing on write-path responses.** Read paths are scrubbed, but invoice `Update`/`UpdateItemTypes`/`Cancel`/`SetFbrExcluded` and purchase-bill `Update` return the DTO with live `AmountPaid/BalanceDue/PaymentStatus/DaysOverdue` to a caller lacking `paymentstatus.view`. (`InvoicesController.cs:292…522`, `PurchaseBillsController.cs:142`.) Fix: `ScrubPaymentIfDenied` on those responses too.
- **M11 [A] Order-linked challan via the Challan form silently drops added lines / ignores desc+unit edits.** `ChallanForm` forwards only `{salesOrderItemId, quantity}`; `CreateChallanFromOrderAsync` rebuilds from `order.Items`. Added lines (no `salesOrderItemId`) vanish; if the operator clears autofilled lines the empty array delivers the **full remaining qty of every line**. (`ChallanPage.jsx:182`, `SalesOrderService.cs:513-543`.) Fix: honor added/edited lines or lock the editor for order-sourced challans.
- **M12 [V] FBR v2 reference endpoints missing `fbr.reference.read`.** `FbrController.cs:190-222` (`saletyperates`/`sroschedule`/`sroitems`/`hsuom`) omit the permission gate the v1 endpoints carry (they do have `[AuthorizeCompany]`, so not cross-tenant — a member can still burn the company's own quota).
- **M13 [A] Common-Client/Supplier group GET returns cross-tenant PII.** `clients/common/{groupId}` + `/groups` return every member's Name/NTN/STRN/CNIC/Address/Phone/Email + the sharing companies, gated only by `.manage.view` (`ClientsController.cs:53-69`). Somewhat by-design for Common Clients but not scoped to the caller's tenants.
- **M14 [A] PO-format reads not tenant-scoped.** `GET /api/poformats` (all tenants) + `/{id}` (no check) expose other tenants' client names + PO template header strings (`POFormatsController.cs:75-107`).
- **M15 [A] Global audit log not tenant-scoped.** `AuditLogsController.cs:24-45` returns logs across all companies to any `auditlogs.view` holder (inconsistent with the tenant-scoped FbrMonitor).
- **M16 [V] GSTAmount rounding mode inconsistent (banker's vs AwayFromZero) → phantom 1-paisa balances.** Narrow edit `InvoiceService.cs:1832` rounds `AwayFromZero`; create/full-update `:651,:1424` + notes/purchase use banker's. A subtotal-preserving narrow edit flips a Paid bill to "Partially Paid, balance 0.01". `LineTotal` was already unified; `GSTAmount` was not. Also a subtle GST-rounding mismatch vs the print/FBR side. Fix: unify on `AwayFromZero`.

---

## LOW

- **L1 [A] Pagination "normal" cap is 200, not the documented 100** (`PaginationHelper.cs:19,22` — `DefaultMax=AuditMax=200`); the normal/audit split doesn't exist. Not a DoS — no unclamped `pageSize→Take` path exists. Align with §6 or update the doc.
- **L2 [A] Add-line-to-billed-challan drops `ItemTypeId`/`HSCode`** (`DeliveryChallanService.cs:569-581`) → delivered tracked goods record no OUT until a later manual bill edit (self-corrects; stub is price 0).
- **L3 [A] `parsePlainList` drops item lines starting with a reserved keyword** (`POImportForm.cs:56,72`): `PO Junction Box`, `Date Coder Ribbon`, `Customer-supplied Gasket` are silently discarded with no drop count. (The `LineItemsEditor` inline paste is robust.)
- **L4 [A] Un-classifying a tracked item then editing an old doc deletes its posted movement** (`StockService.cs:369-378`) → phantom restock of really-moved goods after an unusual admin action.
- **L5 [A] `paymentstatus`/`DueDate` — `DueDate` never scrubbed on any path** (low; single field).
- **L6 [A] Allocation not checked against the payment's contact (intra-company)** (`PaymentService.cs:100-128`) — a receipt from Client A can settle Client B's invoice in the same company.
- **L7 [A] Supplementary invoice has no quantity cap** (`InvoiceService.cs:2582-2589`) against (delivered − billed) or repeated supplements.
- **L8 [A] Concurrent double-reverse surfaces a misleading "could not allocate invoice number" error** (the filtered unique index correctly prevents two notes — `AppDbContext.cs:343`; only the message is wrong).
- **L9 [A] PO-propagation status flips asymmetric** (`SalesOrderService.cs:421-441`): setting a PO doesn't re-check FBR readiness; clearing a PO doesn't revert an `Imported` challan.
- **L10 [A] Closed-order delivery + over-delivery uncapped server-side** (`SalesOrderService.cs:493,517`) — blocked in the UI, reachable via direct API (defense-in-depth).
- **L11 [A] `QueryString` persisted to AuditLogs un-redacted** (`GlobalExceptionMiddleware.cs:94,227`) — no live leak today; latent if a future endpoint puts a secret in the query string.
- **L12 [A] `.svg` in the `[AllowAnonymous]` wwwroot allowlist** served inline (`ProductImagesController.cs:52,76`) — latent stored-XSS only if that folder ever becomes upload-writable.
- **L13 [A] Read-after-write in one transaction in `PaymentService` recompute** (`:198-205`) — SQL-2025 family, lower confidence (a SELECT-sees-prior-INSERT is likelier to work than an FK check); worth prod verification.
- **L14 [A] `SalesOrderService.CreateChallanFromOrderAsync`/`DeleteAsync` not transaction-wrapped** (`:459,489`) — benign self-healing inconsistency vs §4.

---

## Cross-cutting themes

1. **Common-Client/Supplier groups are a systemic tenant-isolation hole** (C2, H8, M13) — every group path fans out across companies with no accessible-set scoping. Fix the fan-out once, centrally.
2. **No optimistic concurrency anywhere** (no `RowVersion`) — every check-then-act outside the number app-lock is racy (H3, H5, M2). Consider a `RowVersion` on `DeliveryChallan`/`Invoice`/`Payment` + re-check-under-lock.
3. **SQL Server 2025 two-`SaveChanges` FK hazard** was fixed only for invoices; purchase-bill + FBR-import creates carry the same shape (H9).
4. **Dual-book overlay effective-type** was fixed for the sale OUT but not the note reversal (H1) or the type-only backfill (M4).
5. **Business uploads under the public `/data` root** (C3, M7) — only `/data/attachments` is protected.

## Suggested fix order

1. **C1, C3, H6, H7** — pure auth/tenant-gate additions; small, high-severity, low-regression-risk.
2. **H1, H2** — data-corruption on stock returns + AR; add reflow/void tests.
3. **C2, H8, M13** — the Common-Client fan-out (one central scoping fix).
4. **H3, H5, M2** — concurrency (re-check under lock / RowVersion).
5. **H9** — SQL-2025 purchase-bill/import one-SaveChanges (before the next prod deploy of those paths).
6. MEDIUM/LOW as capacity allows.

Every fix must keep the four baseline suites green; per CLAUDE.md, the stock reflow suite (140/140) is the hard pre-push gate.

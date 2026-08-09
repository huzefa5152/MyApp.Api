# MyApp.Api — Enterprise Read-Only Audit & Phased Roadmap

**Date:** 2026-08-02
**Type:** Read-only architecture / performance / security / maintainability audit
**Scope:** Full stack — .NET 9 API (Controllers, Services, Repositories, EF Core, Data), React 19 SPA, config/DI/middleware, CI/CD, dependencies
**Nature:** ANALYSIS ONLY. No code, schema, contract, routing, auth, UI, or behavior was changed. Every item below is a *proposal to be verified before action*, not an applied change.

> How to read this document: findings carry **Severity** (Critical/High/Medium/Low), **Estimated Gain** (Very High/High/Medium/Low), **Regression Risk** (None/Very Low/Low/Medium/High), and **Effort** (<30m / 1h / half-day / 1d / multi-day). The roadmap at the end sequences them so each task ships independently with its own verification gate.

---

## 0. Implementation Status — HANDOFF (updated 2026-08-09)

**Branch:** `fix/audit-2026-08-02` (off `master`). Pushed to `origin` for pickup elsewhere.
`master` merged in on **2026-08-09** (merge `7bf61f9`, master @ `b7ab153` — customer-doc-handover + FBR fixes). Two merge conflicts resolved **keep-both**, non-destructive: (1) `InvoiceService.CreateAsync` — master's FBR future-date guard **and** the branch's batched challan-load both kept; (2) `AppDbContextModelSnapshot` — branch's `(CompanyId,Date)` index **and** master's `(CompanyId,HandoverAt)` index both kept. `dotnet build` = **0 errors** post-merge.

**⚠ Verification note for whoever picks this up:** this branch does **not** auto-deploy (only `master` and `customize-solution-for-other` trigger CI→prod). Nothing here is verified beyond `dotnet build`. **Before merging any of this to `master`, run the full pre-push gate** — `scripts/test_stock_itemtype_reflow.py` (140/140), `test_basic_flows.py` (37/37), `test_tenant_isolation.py` — see the resume recipe at the end of this section.

**Legend:** ✅ done+committed · 🟡 partial · ⏸ deferred (see why) · ⬜ not started · 📝 documented-only (not fixed).

### 0.1 Per-finding status

| ID | Finding (short) | Status | Commit / note |
|---|---|---|---|
| **C-1** | Startup live-DDL chain fragility | ⬜ | multi-day; Phase 6, do last, after C-2 exists |
| **C-2** | No CI test gate before prod | ⬜ | **highest-value remaining item** — everything else should ride on it |
| H-1 | Per-row stock writes (purchase) | ✅ | `849a79c` — `IStockService.RecordMovementsAsync`; **⏸ import sub-path** (`FbrPurchaseImportCommitter`) left per-row (not covered by reflow gate) |
| H-2 | Unbounded tracked cartesian invoice read | ✅ | `a7fbb95` |
| H-3 | Challan list writes on every read | ✅ | `2524bf8` (batched transitions) |
| H-4 | Missing date-range indexes | ✅ | `d529cfa` — migration `20260802200706`, applied to db46684 by hand |
| H-5 | No frontend code-splitting | ✅ | `22e526d` — 3.7MB → ~0.5MB initial |
| H-6 | God files + no unit tests | ⬜ | multi-day; Phase 7; **do C-2 first** |
| H-7 | `InvalidOperationException`→400 leak | ⬜ | Phase 5 |
| H-8 | PdfPig `1.7.0-custom-5` build | ⬜ | Phase 6; re-baseline PO corpus after |
| H-9 | Item-type create blocks ~90s on FBR brownout | 📝 | `c475066` documented only — **fix not started** |
| M-1 | N+1 last-rate per challan line | ⏸ | EF-translation/row-diff risk on `GetLastRatesForChallanAsync`; can't prove zero-logic-change with current gates |
| M-2 | N+1 challan fetch on invoice create | ✅ | `70386f1` — `GetByIdsAsync`, validation loop byte-identical |
| M-3 | N+1 item-type on bill update | ✅ | `15debd2` |
| M-4 | Cartesian includes on hot paths | ✅ | `a7fbb95` (AsSplitQuery) |
| M-5 | SalesOrder read paths tracked | ✅ | `a7fbb95` (AsNoTracking) |
| M-6 | TaxClaim C#→SQL aggregation | ⏸ | rounding/null-diff risk on tax figures; deferred under "no business-logic change" |
| M-7 | Context value not memoized | ✅ | `ff9a94d` (Auth/Company) |
| M-8 | Missing response security headers | 🟡 | `ff9a94d` shipped nosniff / X-Frame-Options / Referrer-Policy; **CSP still deferred** |
| M-9 | ~98 `catch/ex.Message` in controllers | ⬜ | Phase 5 |
| M-10 | Direct `AppDbContext` in controllers | ⬜ | Phase 5 |
| M-11 | NPOI + ClosedXML both shipped | ⬜ | document-only decision pending (ClosedXML `SaveAs` totals bug already tracked) |
| M-12 | Purge job single unbatched UPDATE+DELETE | ✅ | `3546554` — TOP(5000) loops |
| M-13 | Backfills run under `AutoMigrate=false` | ⬜ | Phase 6 (ties to C-1) |
| M-14 | `EnableBuffering()` on every request | ⬜ | 1h |
| M-15 | Deploy: verify `ftps` + `app_offline.htm` removal | ⬜ | <30m; **NOT in the Phase 0 commit** |
| M-16 | `POGoldenSample.PdfBlob` in DB row | ⬜ | low volume today |
| M-17 | Confirm `CsvSafe` on server Excel exports | ⬜ | half-day; verify ReportService/SalesReport/TaxSheet paths |
| L-1 | Dead frontend deps (xlsx, html2pdf) | ✅ | `ff9a94d` (xlsx) + `fa93726` (html2pdf → explicit jspdf+html2canvas) |
| L-2 | Three UI systems (MUI/Bootstrap/react-bootstrap) | ⬜ | assess/spike |
| L-3 | Likely-unused backend NuGet | ⬜ | <30m |
| L-4 | Floating `JwtBearer 9.0.*` | ✅ | `ff9a94d` — pinned 9.0.8 |
| L-5 | Dead Gemini config | ⬜ | <30m |
| L-6 | Unbounded caches (no SizeLimit) | ⬜ | Phase 1; <30m |
| L-7 | Dashboard prev-period aggregate queried twice | ✅ | `ff9a94d` |
| L-8 | `SalesOrder.GetPrintDataAsync` double load | ✅ | `ff9a94d` |
| L-9 | Unpaged reference reads | ⬜ | pre-SaaS |
| L-10 | ItemType full-catalog scan on create | ⬜ | half-day |
| L-11 | AttachmentService per-row FS stat on reads | ⬜ | half-day |
| L-12 | Committed demo JWT key + dev hostname | ⬜ | <30m |
| L-13 | Missing `HasMaxLength` on indexed strings | ⬜ | half-day |
| L-14 | ~32 endpoints without `[HasPermission]` — enumerate | ⬜ | 1h |

### 0.2 Tally

Fully done **16** (H-1..H-5, M-2/3/4/5/7/12, L-1/4/7/8) + **1 partial** (M-8, CSP left).
Deferred **3** (M-1, M-6, H-1 import sub-path — all "can't prove zero-logic-change with current gates").
Documented-only **1** (H-9).
**Not started 21** — incl. **both Criticals** (C-1, C-2), H-6/H-7/H-8, the H-9 fix, the Phase-5 error-hygiene mediums (M-9/M-10), Phase-6 startup/supply-chain (C-1/M-13/H-8), and the low-priority tail.

### 0.3 Roadmap phase status

- **Phase 0** (quick wins) — ✅ done, except **M-15** (deploy hygiene) and the **CSP** part of M-8.
- **Phase 1** (reliability) — 🟡 only M-12 shipped; **C-2 (CI gate) + L-6 open** — the gap that blocks safe refactors.
- **Phase 2** (read perf) — ✅ mostly (H-2, M-4/5, H-1, H-3, M-2/3); **M-1, M-6 deferred**.
- **Phase 3** (indexes) — ✅ done (H-4).
- **Phase 4** (frontend) — 🟡 H-5 done; L-2 (UI consolidation) not started.
- **Phase 5** (error hygiene) — ⬜ H-7, M-9, M-10.
- **Phase 6** (supply chain + startup) — ⬜ H-8, C-1, M-13. Highest care; last.
- **Phase 7** (structural refactor) — ⬜ H-6. Needs C-2 first.

**Suggested next step for the picking-up session:** land **C-2** (CI build+test gate) — it's low-regression, additive, and every remaining refactor (H-6, Phase 5, C-1) is meant to ride on it.

### 0.4 Resume recipe (how to verify on this branch)

- **DB:** `appsettings.Development.json` (gitignored) already points at **db46684** (prod-replica, `AutoMigrate=false`). Login `admin`/`admin123`.
- **Run:** `ASPNETCORE_ENVIRONMENT=Development dotnet run --no-launch-profile --no-build --urls "http://localhost:5134"` (wait-for-ready: `curl --retry-connrefused`).
- **Gates:** `python scripts/test_stock_itemtype_reflow.py` (140/140), `test_basic_flows.py` (37/37), `test_tenant_isolation.py`.
- **Gotchas:** (1) `POST /api/itemtypes` calls **live FBR** (`ItemTypeService.EnrichFromFbrAsync`) — blocks ~90s when `gw.fbr.gov.pk` is unreachable (H-9); transient, just re-run the reflow gate. (2) **Stop the backend before `dotnet build`** — it locks the exe (kill the PID on 5134 first).
- **Index migration on db46684:** apply only the new migration's own IF-NOT-EXISTS-guarded statements + one `__EFMigrationsHistory` row. **Do NOT** run the full `dotnet ef migrations script --idempotent` — it re-emits already-dropped indexes (e.g. `IX_Invoices_CompanyId_InvoiceNumber`) and hits history-vs-actual drift. `sqlcmd` needs `-I` (QUOTED_IDENTIFIER ON) or `CREATE INDEX` errors.

---

## 1. Executive Summary

MyApp.Api is a mature, **security-hardened** production ERP that has clearly absorbed several prior audit rounds (upload validation, tenant isolation, token revocation, rate limiting, FBR retry safety are all in place and genuinely well-built). The dominant debt is **not security** — it is **performance hot-paths (EF N+1 / unbounded / cartesian queries), maintainability (a few very large "god" files and no automated .NET test suite), and operational fragility (a 1,939-line `Program.cs` that runs live DDL on every boot, and a CI pipeline that ships straight to two live tenants with no test gate).**

| Dimension | Score | One-line justification |
|---|---|---|
| **Overall Health** | **7.5 / 10** | Solid, hardened, feature-rich; held back by perf debt + no unit tests + startup fragility. |
| **Maintainability** | **6.0 / 10** | God classes (`InvoiceService.cs` 3,350 LOC; `EditBillForm.jsx` 3,455 LOC), 1,939-line `Program.cs`, business logic + direct DB access in controllers, zero xUnit/NUnit tests. |
| **Performance** | **6.5 / 10** | Good pagination + decimal precision; hurt by N+1 (stock/rates/challan), unbounded tracked reads, cartesian `Include`s, no date-range indexes, no frontend code-splitting. |
| **Security** | **8.5 / 10** | Genuinely strong: uploads (magic-byte sniff), auth (lockout + timing-safe + stamp revocation), tenant guard, parameterized SQL, clean secrets. Minor gaps: response headers, CsvSafe on server exports. |
| **Scalability** | **6.0 / 10** | Per-instance in-memory caches (revocation inconsistent if scaled horizontally), per-boot DDL, N+1 that scales with data history, synchronous log sink. Fine at 2-tenant scale; needs work before SaaS multi-tenant fan-out. |
| **Operational Risk** | **Medium** | Push-to-`master` → prod with no CI test gate, startup raw-SQL chain where one failure = full outage. |

**Top 5 things to do first (all low-regression):**
1. Add a CI test/build gate before the FTP deploy step (reliability).
2. Add the missing date-range composite indexes (`Invoice`, `DeliveryChallan`, `PurchaseBill`, `Payment`).
3. Batch the stock-movement writes in the purchase/import path (remove per-row `SaveChanges`).
4. Add `AsNoTracking()` / `AsSplitQuery()` to the read/list repositories.
5. Introduce frontend route-level `React.lazy` code-splitting (grapesjs alone is ~1 MB in the main bundle today).

---

## 2. Scope & Method

- **Backend inventory:** 39 controllers (~282 endpoints), ~40 services, 15 repositories, 45 EF entities, 143 migrations, 26 helpers, 4 middleware, 1 hosted service.
- **Frontend inventory:** ~197 source files, React 19 + Vite 7, MUI + Bootstrap + react-bootstrap, grapesjs template editor.
- **Method:** static read-only inspection via file reads + pattern search. Two subsystems (Services/EF, Config/DI/Deps) were audited by dedicated read-only sub-agents; the remaining four (API structure, DB schema, frontend, security) were audited directly with targeted searches and file reads. No runtime profiling or live DB query-plan capture was performed (see *Future Improvements* — a live `SET STATISTICS IO` pass would sharpen the index recommendations).
- **What was NOT done:** no builds, no migrations, no writes to any application file, no commits, no production calls.

---

## 3. Critical Issues

### C-1 — Startup runs a ~25-block live-DDL + backfill chain on every boot; any single failure is a full outage
- **Files:** `Program.cs:464–1753` (unique-index drop/recreate `524–573`; `SecurityStamp` add/update/alter `591–611`; Units UOM reseed `703–776`; 8+ permission-migration blocks `800, 824, 864, 889, 926, …`; orphaned-company backfill `CROSS JOIN Companies × UserRoles` `1686–1700`).
- **Why critical:** the whole block sits inside the outer `try { … app.Run(); }` (`38 / 1927`). If any `ExecuteSqlRaw` throws (lock timeout on `ALTER`/`CREATE INDEX`, deadlock, transient error against the remote MonsterASP DB), it is caught, logged `Fatal`, and `app.Run()` is never reached → process exits → **site down**. Several blocks run *unconditionally every restart*, so restart-time fragility scales with block count and DB latency.
- **Estimated impact:** availability. Also slow, serial cold-start (each block is a separate remote round-trip).
- **Regression risk to fix:** **Medium** — retiring already-applied backfills into real migrations is safe *only after* confirming (via the AuditLog markers) they have run in prod; mis-retiring one a tenant hasn't hit re-opens the original bug.
- **Effort:** multi-day (triage each block: retire vs. keep-behind-one-version-gate).
- **Recommendation:** inventory each block, confirm applied state per environment, fold survivors into ordered EF migrations, and gate the residual idempotent seeders behind a single schema-version marker so a healthy boot does near-zero DB work.

### C-2 — No automated test/verification gate in CI before push-to-production
- **Files:** `.github/workflows/deploy.yml` (`checkout → dotnet publish → FTP to prod`); **no `.csproj` test project exists anywhere in the repo.**
- **Why critical:** `master` deploys straight to two live tenants (Hakimi, Roshan). The only safety net is the *manual* pre-push script suite documented in `CLAUDE.md` (stock reflow 140/140, tenant isolation, basic flows) — enforced by a human, not the pipeline. A green *compile* with broken inventory/tenant/tax logic ships unimpeded. There is **zero** xUnit/NUnit coverage; all "tests" are external Python scripts requiring a live DB.
- **Estimated impact:** reliability / correctness of financial + tax data.
- **Regression risk to fix:** **Low** — adding a CI job is additive.
- **Effort:** half-day to 1 day.
- **Recommendation:** add a CI `build + test` job that gates `deploy-full`. Minimum viable: `dotnet build` (0 errors) + a smoke check; target state: a small xUnit project covering invoice/bill math + tenant-guard assertions + the stock-reflow invariants, plus wiring the Python gates against an ephemeral SQL container.

---

## 4. High Priority

### H-1 — Per-row stock write in the purchase / import path (N round-trips per line)
- **Files:** `Services/Implementations/StockService.cs:67–107` (`RecordMovementAsync`) called in loops by `PurchaseBillService.cs:436–452, 643–658, 675–687` and `FbrPurchaseImportCommitter.cs:215–230`. Each call does its own `IsTrackingEnabledAsync` (`SELECT … FROM Companies`, `StockService.cs:78→20-26`) **and** its own `SaveChangesAsync` (`:95`).
- **Impact:** an N-line purchase bill ≈ **2N** round-trips (20 lines ≈ 40) vs ~2. The invoice OUT path (`SyncInvoiceStockMovementsAsync`) already batches correctly — only purchase/import is per-row.
- **Gain:** High. **Regression risk:** Low. **Effort:** half-day.
- **Fix direction:** hoist the tracking check (callers already precompute tracked item-type sets), add all movements, single `SaveChanges`.

### H-2 — Unbounded, tracked, cartesian read: `InvoiceRepository.GetByCompanyAsync`
- **Files:** `Repositories/Implementations/InvoiceRepository.cs:17–33`, backing `InvoiceService.cs:356`.
- **Why:** loads **all** invoices for a company, no `Where`/paging, tracked, 5 `Include`s including two collections (`Items` + `DeliveryChallans`) → row multiplication per invoice, no `AsSplitQuery()`, no `AsNoTracking()`.
- **Impact:** on a real tenant (thousands of bills) this materializes a huge tracked graph in one blown-up query. **Gain:** High. **Regression risk:** Low. **Effort:** small (S).
- **Fix direction:** `AsNoTracking().AsSplitQuery()`, or route callers to the existing paged path.

### H-3 — Challans list page issues a write + N `SaveChanges` on every read
- **Files:** `DeliveryChallanService.cs:216` (`GetPagedByCompanyAsync`) calls `ReEvaluateSetupRequiredAsync(companyId)` (`:943–961`), which loads all "Setup Required" challans and calls `UpdateAsync` → `SaveChangesAsync` **once per challan** (`:956`).
- **Impact:** every Challans list load performs writes + N saves + lock churn on a hot read path, even when nothing transitions.
- **Gain:** High. **Regression risk:** Low–Medium (behavioral — the re-eval currently self-heals on read). **Effort:** half-day.
- **Fix direction:** only touch rows that actually transition; batch to one `SaveChanges`/`ExecuteUpdate`; or move re-eval off the read path (event-driven / scheduled).

### H-4 — Missing date-range composite indexes on transactional tables
- **Files / evidence:** `Data/AppDbContext.cs` — `Invoice` has `HasIndex(ClientId)` (`309`) and `HasIndex(CompanyId)` (`312`) but **no `(CompanyId, InvoiceDate)`**; same gap on `DeliveryChallan` (only `(CompanyId, ChallanNumber)`), `PurchaseBill` (only `CompanyId` + unique number), `Payment` (unique on `Direction, Number`, no date index). Dashboard/reports (`DashboardService`, `ReportService`, `TaxClaimService`) all filter `CompanyId + date range`.
- **Impact:** period-scoped dashboards and reports do index-scan-then-filter or full scans that worsen with history.
- **Gain:** High (read latency on the most-hit screens). **Regression risk:** Low (additive non-unique indexes) — but **schema change**, so must go through a migration + the prod manual-apply flow. **Effort:** half-day incl. verification.
- **Fix direction:** add `(CompanyId, InvoiceDate)`, `(CompanyId, ChallanDate)`, `(CompanyId, BillDate)`, `(CompanyId, PaymentDate)`. Confirm exact column names and validate with `SET STATISTICS IO` before/after.

### H-5 — No frontend route-level code-splitting; grapesjs + all pages in the main bundle
- **Files:** `myapp-frontend/src/App.jsx:5–39` statically imports **all ~35 page components**, including `TemplateEditorPage` → `Components/templateEditor/VisualEditor.jsx:2` (`import grapesjs`). `vite.config.ts` has **no `manualChunks`**; `React.lazy`/`Suspense` are used nowhere for routes (only `utils/exportUtils.js` lazy-loads exceljs/jspdf/html2canvas — that part is good).
- **Impact:** first paint downloads grapesjs (~1 MB), every form (incl. the 3,455-line `EditBillForm.jsx`), and every page up front. Large initial JS on a phone.
- **Gain:** High (initial load). **Regression risk:** Low (lazy + `Suspense` fallback per route). **Effort:** half-day to 1 day.
- **Fix direction:** convert route elements to `React.lazy`, wrap `<Outlet>` in `<Suspense>`, and split the grapesjs editor + export utilities into their own chunks.

### H-6 — Maintainability: "god" files and no unit safety net
- **Backend:** `Services/Implementations/InvoiceService.cs` **3,350 LOC**, `FbrService.cs` 1,854, `DeliveryChallanService.cs` 1,129, `Data/AppDbContext.cs` 1,258 (one `OnModelCreating`), `Program.cs` 1,939.
- **Frontend:** `Components/EditBillForm.jsx` **3,455 LOC**, `InvoiceForm.jsx` 1,813, `pages/InvoicePage.jsx` 1,580, `StandaloneInvoiceForm.jsx` 1,460.
- **Impact:** high cognitive load, merge-conflict magnets, and refactors are risky *because there are no unit tests to catch regressions* (ties to C-2).
- **Gain:** High (long-term velocity + defect rate). **Regression risk:** Medium if refactored blindly → **do C-2 first**. **Effort:** multi-day, incremental.
- **Fix direction:** carve cohesive concerns out of `InvoiceService` (numbering, stock sync, FBR overlay, print DTO assembly) behind the existing interface; split `EditBillForm` into line-items editor + FBR panel + totals. One extract per PR, each covered by a new test.

### H-7 — `InvalidOperationException` → HTTP 400 with raw `ex.Message`, and 500-class bugs logged only as `Warning`
- **Files:** `Middleware/GlobalExceptionMiddleware.cs:154–159, 268–270` (maps `InvalidOperationException` → 400, returns `ex.Message` verbatim `:270`); logged at `Warning` (`:223`), so real server bugs bypass the 5xx audit path.
- **Why:** `InvalidOperationException` is thrown pervasively by EF/LINQ ("Sequence contains no elements", "A second operation was started on this context", translation failures) and almost always signals a *server* defect, not bad input. The code comments (`263–264`) claim to guard against leakage but don't.
- **Impact:** information disclosure of internal state + masked/under-logged server errors.
- **Gain:** High (observability + reduced leak surface). **Regression risk:** Medium — some controllers may deliberately throw `InvalidOperationException` for validation; narrowing requires auditing throw-sites. **Effort:** half-day to 1 day.
- **Fix direction:** introduce a dedicated `ValidationException` (or use `BadHttpRequestException`) for the intentional-400 cases; let everything else fall through to opaque 500 + `Error` log.

### H-8 — `UglyToad.PdfPig` pinned to a non-public `1.7.0-custom-5` build
- **Files:** `MyApp.Api.csproj:55`.
- **Why:** that version suffix is not a nuget.org release. A clean CI `dotnet restore` (`Dockerfile:7`, `deploy.yml`) fails if the custom feed is unreachable, and a hand-patched PDF parser handling untrusted customer POs has no upstream security patching.
- **Impact:** brittle/reproducibility risk + supply-chain + unpatched parser.
- **Gain:** Medium–High (build reliability + supply chain). **Regression risk:** Medium — moving to a stock PdfPig may shift PO-text extraction; the PO-parser corpus gate must be re-run. **Effort:** half-day to 1 day.
- **Fix direction:** document/host the custom build in a private feed *or* migrate to a released version and re-baseline the PO corpus.

### H-9 — Creating an item type makes a synchronous, retried, blocking live FBR call
- **Files:** `Services/Implementations/ItemTypeService.cs:164` (`EnrichFromFbrAsync`, called by `CreateAsync`; also on update at `:277`).
- **Why:** `POST /api/itemtypes` calls FBR to enrich UOM/description inline. When `gw.fbr.gov.pk` is slow or unreachable, the FBR `HttpClient` (Polly: 3 retries × ~30 s attempt) blocks the request for up to ~90 s before returning. Measured **94,478 ms** for a single create during an FBR brownout (2026-08-02 verification run).
- **Impact:** an operator onboarding items during an FBR outage sees a hung request / apparent freeze; the request thread is tied up for the duration.
- **Gain:** High (UX + thread availability under FBR brownout). **Regression risk:** Low–Medium — must preserve the enrichment result when FBR *is* reachable. **Effort:** half-day.
- **Fix direction:** shorten the FBR timeout for enrichment, fast-fail to the local UOM (`TaxMappingEngine`) fallback when FBR is unreachable, or defer enrichment to a background step so create returns immediately. Discovered during Phase 2 verification.

---

## 5. Medium Priority

| # | Finding | Files | Gain | Regr. | Effort |
|---|---|---|---|---|---|
| M-1 | N+1: last-rate lookup runs up to 2 queries **per challan line** | `InvoiceService.cs:3268–3348` | High | Low | half-day |
| M-2 | N+1: challan fetch loop on invoice create (`foreach ChallanIds → GetByIdAsync`) | `InvoiceService.cs:477–488` | Med | Low | S |
| M-3 | N+1: `PurchaseBill.UpdateAsync` fetches each item-type individually (Create already preloads a map) | `PurchaseBillService.cs:535–539` | Med | Low | S |
| M-4 | Cartesian `Include`s on hot **list/detail** paths (two collection branches, tracked, no `AsSplitQuery`) | `InvoiceRepository.cs:44–58,136–155`; `PurchaseBillService.cs:91–116,134–143`; `DeliveryChallanRepository.cs:17–83` | High | Low | S each |
| M-5 | `SalesOrderRepository` read paths are **tracked** (sibling `SalesQuoteRepository` correctly uses `AsNoTracking`) | `SalesOrderRepository.cs:17–22`; also `GoodsReceiptService.cs:60–85` | Med | Low | S |
| M-6 | `TaxClaimService` fires 7 sequential queries; pending/manual/disputed buckets pull raw rows for what should be SQL aggregates; `rawManualOnly` has **no date/aging filter** (scans all matching history) | `TaxClaimService.cs:116–139,198–219,245–263,287–306,335–359,381–399` | High | Low | half-day |
| M-7 | Context provider `value` is a fresh object every render (not memoized) → all consumers re-render | `AuthContext.jsx:107–119` (plain object); `CompanyContext.jsx:59` (inline literal). *(PermissionsContext is correctly `useMemo`'d — `:71`.)* | Med | Very Low | S |
| M-8 | Missing response security headers: `X-Content-Type-Options: nosniff`, `Content-Security-Policy`, `X-Frame-Options` (only `UseHsts` + `UseHttpsRedirection` present) | `Program.cs:1814,1867` | Med | Low | 1h |
| M-9 | ~98 `catch (Exception)` / `ex.Message` sites across 19 controllers — info-leak surface + business logic that belongs in services / would be covered by the global middleware | `Controllers/*` (e.g. `InvoicesController` 13, `SalesOrdersController` 11, `SuppliersController` 10) | Med | Low–Med | 1d |
| M-10 | Direct `AppDbContext`/`ToListAsync` queries **inside controllers** (layering bypass — no service/repo, no consistent tenant scoping) | `LookupController.cs:37,57,159`; `PermissionsController.cs:43,57`; `POImportController.cs:336,436`; `PrintTemplatesController.cs:77,305,456` | Med | Low | half-day |
| M-11 | Two full Excel engines shipped (NPOI + ClosedXML); ClosedXML 0.104.2 carries the known `SaveAs` totals-row corruption bug | `MyApp.Api.csproj:31–32`; `Helpers/ExcelImport/*` | Low | High if consolidating | 0 (document) / multi-day (consolidate) |
| M-12 | Purge job's "in chunks" comment is false — it's a single unbatched `UPDATE`+`DELETE`; first run on a large backlog locks the table | `FbrCommunicationLogPurgeService.cs:82–95` | Med | Low | 1h |
| M-13 | Raw backfills run even when `Database:AutoMigrate=false` (prod), but `Migrate()` is skipped — if a manual migration lags, the column-dependent blocks throw at boot (ties to C-1) | `Program.cs:494–504+` | Med | Low–Med | half-day |
| M-14 | `EnableBuffering()` on **every** request buffers 25 MB import uploads to a spill file the exception path rarely re-reads | `Program.cs:1821` | Low | Low | 1h |
| M-15 | FTP deploy: verify `protocol: ftps` (else creds + DLLs cross the wire cleartext) and that `app_offline.htm` is actually removed post-deploy | `.github/workflows/deploy.yml:100–140` | Med | Low | <30m |
| M-16 | `POGoldenSample.PdfBlob` (`byte[]`) stored in the DB row (attachments themselves correctly live on disk) — row bloat / scan risk, low volume today | `Models/POGoldenSample.cs:26` | Low | Med (schema) | half-day |
| M-17 | Verify server-side Excel exports route operator strings through `CsvSafe` — it is defined in `ExcelTemplateEngine.cs` but not obviously referenced by `ReportService`/`SalesReport`/`TaxSheet` export paths | `Helpers/ExcelTemplateEngine.cs` + report services | Med | Low | half-day |

---

## 6. Low Priority

| # | Finding | Files | Effort |
|---|---|---|---|
| L-1 | Dead frontend deps: `xlsx` and `html2pdf.js` are in `package.json` but never imported (exceljs + jspdf + html2canvas are the real ones) | `myapp-frontend/package.json` | <30m |
| L-2 | Three coexisting UI systems: MUI (`@mui/material` + emotion) **and** Bootstrap **and** react-bootstrap | `package.json` | (assess) |
| L-3 | Likely-unused backend NuGet: `Microsoft.AspNetCore.OpenApi` (Swashbuckle is what's used); `…CodeGeneration.Design` (scaffolding-only) | `MyApp.Api.csproj:40,51` | <30m |
| L-4 | Floating version `JwtBearer 9.0.*` while every sibling is pinned — non-reproducible restore of a security package | `MyApp.Api.csproj:39` | <30m |
| L-5 | Dead `Gemini` config (no source reads it; parser is rule-based now) | `appsettings.Development.example.json:18–21` | <30m |
| L-6 | `AddMemoryCache()` has no `SizeLimit`; `ExcelTemplateReverseMapper` cache has no eviction (both bounded in practice today) | `Program.cs:418`; `ExcelTemplateReverseMapper.cs:46` | <30m |
| L-7 | Dashboard previous-period aggregate queried twice (first tuple discarded) | `DashboardService.cs:212/238, 224/239` | S |
| L-8 | `SalesOrder.GetPrintDataAsync` loads the order twice | `SalesOrderService.cs:983–985` | S |
| L-9 | Unpaged `GetAllAsync` reference endpoints (Clients/Companies/ItemTypes/FbrLookup) — fine now, risky for large "Common" cross-company sets | `ClientsController.cs:136,151` etc. | half-day |
| L-10 | `ItemTypeService` loads the whole global catalog into memory on every create/update near-dup scan | `ItemTypeService.cs:58,208` | half-day |
| L-11 | `AttachmentService.ReconcileAsync` does a per-row filesystem stat on list/count reads (badge counts) | `AttachmentService.cs:206–218` | half-day |
| L-12 | `appsettings.Demo.json:19` commits a (labeled demo-only) JWT key; `appsettings.json:3` discloses internal dev hostname (Trusted_Connection, no password) | committed config | <30m |
| L-13 | Unbounded `nvarchar(max)` / auto `nvarchar(450)` on some indexed string columns lacking `HasMaxLength` | `Data/AppDbContext.cs` | half-day |
| L-14 | ~32 of 282 endpoints have no `[HasPermission]` — most are legitimate (auth, anonymous product-images, lookups) but the set should be enumerated and confirmed | `Controllers/*` | 1h |

---

## 7. API Endpoint Review

282 endpoints across 38 controllers. A per-endpoint table of all 282 is low-signal; instead, here is the **guard-coverage matrix** (covers every controller) plus representative deep-dives and the systemic patterns.

### 7.1 Guard-coverage matrix (endpoints / `[HasPermission]` / tenant-guard call-sites)

| Controller | Endpoints | HasPermission | TenantGuard sites | Notes |
|---|---:|---:|---:|---|
| AuthController | 7 | 0 | 0 | Correct: login/anon + `[Authorize]` on me/profile/password/avatar/logout. |
| InvoicesController | 22 | 21 | 18 | Well-guarded; heaviest surface. |
| PrintTemplatesController | 22 | 20 | 9 | Direct DB reads inside (M-10). |
| SalesOrdersController | 15 | 14 | 12 | Good. |
| ClientsController | 14 | 14 | 12 | Good; `GetAll` unpaged (L-9). |
| DeliveryChallansController | 14 | 14 | 11 | Good; list triggers write (H-3). |
| PaymentsController | 15 | 14 | 5 | Verify guard on the 9 non-tenant-scoped ones. |
| SuppliersController | 14 | 14 | 12 | Good. |
| SalesQuotesController | 11 | 11 | 8 | Good. |
| PurchaseBillsController | 8 | 11* | 6 | *class + action attrs; cartesian includes (M-4). |
| FbrController | 17 | 15 | 1 | FBR ops; confirm remaining company scoping. |
| StockController | 6 | 6 | 3 | OK. |
| ItemTypesController | 8 | 3 | 3 | Several read/lookup actions — confirm least-privilege. |
| LookupController | 8 | 4 | 0 | Reference data + **direct DB** (M-10). |
| ProductImagesController | 2 | 0 | 0 | `[AllowAnonymous]` images (intended). |
| DashboardController | 1 | 1 | 1 | OK. |
| *(remaining 22 controllers)* | … | mostly 1:1 | varies | Non-company-scoped (Roles/Users/Permissions/Units/MergeFields/Audit) guard by permission, not tenant — correct. |

**Aggregate:** 250 `[HasPermission]` attributes vs 282 endpoints; 133 tenant-guard call-sites across 22 controllers. **Zero sync-over-async in any controller.** `[AllowAnonymous]` appears only on the public landing route and product-images (both intended).

### 7.2 Representative endpoint deep-dives

- **`POST /api/invoices` (create)** — heaviest write path. Complexity high; correct advisory-lock number allocation (`sp_getapplock`, parameterized), cross-tenant link guard present. Bottlenecks: challan fetch loop (M-2), downstream stock sync is batched (good). Regression risk on any change: **High** — this is the FBR dual-book core; gated by the stock-reflow suite.
- **`GET /api/deliverychallans` (paged list)** — H-3: performs writes + N `SaveChanges` via `ReEvaluateSetupRequiredAsync` before returning. Highest-value read-path fix.
- **`GET /api/invoices` (paged list)** — cartesian `Include`s, tracked (M-4). Add `AsNoTracking().AsSplitQuery()`.
- **`GET /api/taxclaim/summary`** — 7 sequential queries, unbounded raw pulls (M-6). Push aggregates to SQL.
- **`GET /api/reports/*` & `GET /api/dashboard`** — period-scoped; blocked on the missing date indexes (H-4).
- **`POST /api/*/import` (PO / FBR purchase / challan Excel)** — correctly rate-limited (`import` policy) + size-capped + magic-byte validated. Parser N+1 on dedup (`FbrPurchaseImportService.cs:188`) is cold-path, low priority.

### 7.3 Systemic API patterns
1. **Error handling in controllers** (M-9): broad `catch (Exception) → BadRequest(ex.Message)` repeated ~98×. Prefer letting `GlobalExceptionMiddleware` own the mapping and returning opaque messages.
2. **Layering bypass** (M-10): a handful of controllers query `AppDbContext` directly. Push into services/repos for consistent tenant scoping + testability.
3. **Unpaged reference reads** (L-9): safe today, add paging before the multi-tenant SaaS fan-out.

---

## 8. Database Review

**Strengths (leave as-is):**
- **Decimal precision is consistent and correct:** money `HasPrecision(18,2)`, quantities `(18,4)`, GST rate `(5,2)` across Invoice/PurchaseBill/SalesQuote/SalesOrder/Stock/Payment. No reliance on the default for money columns.
- **Broad FK + unique coverage:** FK columns are indexed (`ClientId`, `SupplierId`, `InvoiceId`, `ItemTypeId`, `PurchaseBillId`, `GoodsReceiptId`, group keys, `SourceType/SourceId` on stock). Document-number uniqueness enforced per tenant: `Invoice (CompanyId, NoteKind, InvoiceNumber)` unique, `PurchaseBill`/`GoodsReceipt`/`SalesQuote`/`SalesOrder`/`Payment` unique composites; `DeliveryChallan (CompanyId, ChallanNumber)` intentionally **non-unique** (Duplicate-Challan feature) — correct per design.
- **Cascade posture is deliberate:** mostly `Restrict`/`NoAction` (explicitly to avoid SQL Server "multiple cascade paths"), `Cascade` only for child line-items under their parent doc, `SetNull` for optional group references. Sound.

**Index gaps (the headline DB work — H-4):**
| Table | Have | Missing (for the actual query shape) |
|---|---|---|
| Invoice | `ClientId`, `CompanyId`, unique `(CompanyId,NoteKind,InvoiceNumber)` | **`(CompanyId, InvoiceDate)`** — dashboards/reports/period lists |
| DeliveryChallan | `ClientId`, `CompanyId`, `InvoiceId`, `(CompanyId,ChallanNumber)` | **`(CompanyId, ChallanDate)`** |
| PurchaseBill | `CompanyId`, `SupplierId`, unique number, `SupplierIRN` | **`(CompanyId, BillDate)`** |
| Payment | unique `(CompanyId,Direction,Number)`, alloc FKs | **`(CompanyId, PaymentDate)`** (aging/ledger) |

**Other DB notes:** `byte[] PdfBlob` in `POGoldenSample` (M-16, low volume); some indexed string columns default to `nvarchar(450)` and some free-text to `nvarchar(max)` for want of `HasMaxLength` (L-13). All schema changes are **Medium regression risk by nature** and must flow through a migration + the documented prod manual-apply process (the design-time factory targets a different DB — see `CLAUDE.md` / memory).

---

## 9. Security Review

**Overall: strong (8.5/10).** This codebase has clearly been through prior security audits and it shows.

**Already well-handled (do not re-flag):**
- **Uploads:** `ImageUploadValidator` + `AttachmentFileValidator` do extension allowlist **+ size cap + per-extension magic-byte signature match**; SVG/exe/html/js excluded; `AttachmentStorage` stores GUID-named files under `data/attachments` (outside `wwwroot`), sanitizes folder names incl. Windows reserved device names, and downloads flow **only** through the authenticated, access-checked endpoint.
- **Auth:** timing-safe login (dummy bcrypt verify on unknown-user and locked paths), account lockout (5 fails → 2h, persisted on the row), password policy (≥8, letter+digit), generic error messages, `SecurityStamp` rotation on logout **and** password change (server-side token revocation), rate-limited login + password-change. JWT: HMAC-SHA256, key ≥32 enforced at boot, `ClockSkew` tightened to 30s, `SecurityStamp` compared per request (cached 60s). No `Role` mass-assignment (JWT role comes from the DB row).
- **SQL injection:** no string-concatenated SQL. Raw calls are parameterized: `sp_getapplock` uses `{0}` with an int-derived resource (`InvoiceService.cs:454`); purge job uses `ExecuteSqlInterpolatedAsync` (args → SqlParameters). Startup DDL is all literals.
- **Secrets:** committed `appsettings.json` has an **empty** `Jwt:Key` (boot refuses <32 chars), local `Trusted_Connection` strings (no passwords), `Cors` empty (same-origin); `.env.production` is just `VITE_API_URL=/api`. `.gitignore` correctly excludes Production/Development/Local. Sensitive logging: none found in controllers (`SensitiveDataRedactor` covers the FBR/exception paths).
- **CORS:** origins from config; never `AllowAnyOrigin`.
- **Transport:** `UseHsts` + `UseHttpsRedirection` + `UseForwardedHeaders`.

**Gaps:**
- **M-8** missing `nosniff` / CSP / `X-Frame-Options` response headers.
- **M-17** confirm `CsvSafe` is applied on all *server-side* Excel/CSV export paths (client path and the engine define it; the report services' usage is unconfirmed). xlsx is lower-risk than CSV here (Excel doesn't auto-evaluate string cells on open), so treat as defense-in-depth.
- **L-12** committed demo JWT key + internal hostname disclosure.
- Info-leak via **H-7** (`InvalidOperationException` message) and **M-9** (`ex.Message` in controllers).
- **L-14** enumerate the ~32 permission-less endpoints and confirm each is intended.

No SQLi, no broken-access-control smell in the sampled paths, no hardcoded live secrets, no PII in query strings by the app (the *stored* raw QueryString in audit logs is the pre-existing L-11-Low from `AUDIT_2026_07_27`).

---

## 10. Memory Review

- **Largest allocation risk:** the unbounded tracked reads (H-2, and the non-paged repo variants in M-4/M-5) — a full-company invoice/challan graph materialized with change-tracking. `AsNoTracking` both cuts the snapshot copy and the tracking overhead.
- **Uploads:** `AttachmentStorage.SaveAsync` buffers the whole file into a `MemoryStream` then a `byte[]` (`:46–48`) — bounded by the 25 MB validator cap + `[RequestSizeLimit]`, so acceptable, but it is a full in-memory copy per upload; streaming to disk would be leaner (Low).
- **Request buffering:** `EnableBuffering()` on every request (M-14) spills large bodies to temp files unnecessarily.
- **Caches:** `IMemoryCache` and the reverse-mapper cache are unbounded by configuration but bounded in practice (user-id keys with TTL; template-path keys). Fine now; see L-6.
- **Disposables/streams:** upload validators use `using` on read streams correctly; SHA-256 hashers are `using`-scoped. No leaked `HttpClient` (uses `IHttpClientFactory`). No obvious undisposed EF contexts (all Scoped/DI-managed).
- **Strings:** the large `Program.cs` seed blocks build big SQL literals once at boot — not a per-request concern.

No evidence of a true leak; the memory story is dominated by "load less, track less" (H-2, M-4).

---

## 11. Frontend Review

**Dependency verdicts:**
| Package | Role | Verdict |
|---|---|---|
| `@mui/material` + emotion | UI system #1 | Keep or consolidate (L-2) — heavy; static in main bundle. |
| `bootstrap` + `react-bootstrap` | UI systems #2/#3 | Overlap with MUI — assess consolidation. |
| `grapesjs` + `grapesjs-preset-webpage` | Template visual editor | **Lazy-load** (H-5) — ~1 MB, one screen. |
| `exceljs` | Excel export | Keep — correctly **lazy** (`exportUtils.js`). |
| `xlsx` | (spreadsheet) | **Remove** — not imported anywhere (L-1). |
| `html2pdf.js` | (PDF) | **Remove** — unused; jspdf+html2canvas are imported directly (L-1). |
| `handlebars` | print-template render | Keep — client-side merge; `{{ }}` auto-escapes (watch `{{{ }}}`). |
| `swiper`, `aos`, `react-countup` | landing-page polish | Confirm only the public landing uses them; keep out of the app chunk. |

**Findings:**
- **H-5** no route code-splitting (biggest frontend win).
- **M-7** `AuthContext` + `CompanyContext` values not memoized → consumer re-render storms; `PermissionsContext` is the correct pattern to copy.
- **httpClient** (`api/httpClient.js`) is well-built: Bearer from `localStorage`, error-body normalization, 401 → capture-return-path + redirect, 403/5xx/network toasts. Note: token in `localStorage` is the usual SPA XSS-exfil trade-off — acceptable given the upload/CSP hardening, but CSP (M-8) would harden it further. No token refresh (8h expiry + re-login) — acceptable.
- **Data fetching** is per-page in effects; no shared client cache (React Query/SWR) — fine at this size, a *Future* item for the SaaS scale.

---

## 12. Dependency Review (consolidated)

- **Remove/verify-unused:** `xlsx`, `html2pdf.js` (frontend, L-1); `Microsoft.AspNetCore.OpenApi`, `…CodeGeneration.Design` (backend, L-3); dead `Gemini` config (L-5).
- **Pin:** `JwtBearer 9.0.*` → `9.0.8` (L-4).
- **Supply chain:** `PdfPig 1.7.0-custom-5` (H-8) — the one real risk.
- **Redundancy:** NPOI + ClosedXML (M-11) — both used via the `ExcelImport` abstraction (NPOI likely for legacy `.xls`); document the split or consolidate (High regression risk if consolidating). ClosedXML 0.104.2 has the known `SaveAs` totals bug already tracked.
- **DI lifetimes:** **clean** — no captive dependencies. All singletons (`AttachmentStorage`, `POParserService`, `RuleBasedPOParser`, `ExcelTemplateReverseMapper`, `SensitiveDataRedactor`, `FbrTokenProtector`, `POFormatFingerprintService`) inject only framework singletons and hold thread-safe/immutable state; the `BackgroundService` resolves `AppDbContext` via `CreateScope()`; auth filters use `TypeFilterAttribute` so scoped deps resolve per-request.

---

## 13. Refactoring Opportunities

For each: *current → why → benefit → risk → files → testing → effort.*

1. **Extract from `InvoiceService` (3,350 LOC).**
   - *Current:* numbering, stock sync, FBR dual-book overlay, print-DTO assembly, CRUD all in one class.
   - *Why/Benefit:* readability, testability, lower merge friction.
   - *Risk:* **Medium** (FBR core). *Files:* `InvoiceService.cs` (+ new collaborators behind `IInvoiceService`). *Testing:* stock-reflow 140/140 + basic-flows + a new unit test per extracted unit. *Effort:* multi-day, one extract per PR.
2. **Split `EditBillForm.jsx` (3,455 LOC)** into line-items editor + FBR panel + totals/summary. *Risk:* Medium (bill-edit is high-traffic). *Testing:* manual 375/768/1280 + the narrow/full/challan edit flows. *Effort:* multi-day.
3. **Collapse the `Program.cs` startup chain** into ordered migrations + one gated seeder (C-1/M-13). *Risk:* Medium. *Effort:* multi-day.
4. **Introduce a query-options convention** (`AsNoTracking`/`AsSplitQuery` on all read/list repo methods) — mechanical, high payoff (H-2, M-4, M-5). *Risk:* Low. *Effort:* 1 day across repos.
5. **Move controller `catch/ex.Message` + direct-DB code into services** (M-9, M-10). *Risk:* Low–Med. *Effort:* 1 day.
6. **Frontend route-splitting + context memoization** (H-5, M-7). *Risk:* Low. *Effort:* 1 day.

---

## 14. Quick Wins (near-zero regression, do first)

| Win | Finding | Effort |
|---|---|---|
| Pin `JwtBearer` to `9.0.8` | L-4 | <30m |
| Remove `xlsx` + `html2pdf.js` from `package.json` | L-1 | <30m |
| Add `nosniff` / `X-Frame-Options` / basic CSP headers | M-8 | 1h |
| Memoize `AuthContext` + `CompanyContext` values | M-7 | <30m |
| Reuse the discarded previous-period aggregate in Dashboard | L-7 | <30m |
| De-duplicate the double load in `SalesOrder.GetPrintDataAsync` | L-8 | <30m |
| Set `protocol: ftps` + explicit `app_offline.htm` removal in deploy | M-15 | <30m |
| Fix the purge-job comment or add real `TOP(n)` batching | M-12 | 1h |
| Add `AsNoTracking().AsSplitQuery()` to `InvoiceRepository.GetByCompanyAsync` | H-2 | 1h |

---

## 15. Future Improvements (SaaS-scale)

- **Distributed cache** (Redis) for permission/stamp/company-access sets — the current per-instance `IMemoryCache` makes revocation inconsistent across horizontally-scaled instances (a logout on instance A leaves instance B authenticating the old token for up to 60s).
- **Read replicas / CQRS-lite** for dashboards & reports once tenants grow.
- **Async/queue** the FBR communication-log purge and any heavy imports (Hangfire/Channel) instead of inline + a single hosted timer.
- **Client-side data cache** (React Query/SWR) to kill refetch waterfalls and enable optimistic UI.
- **Live query-plan pass** (`SET STATISTICS IO/TIME`) on the top 10 endpoints to convert the index recommendations here from static-inferred to measured.
- **Structured test pyramid**: unit (math/tax/stock invariants) → integration (tenant isolation, EF queries against a container DB) → the existing Python end-to-end scripts in CI.
- **Split `AppDbContext` configuration** (1,258 LOC) into per-entity `IEntityTypeConfiguration<T>` classes.

---

## 16. Priority Matrix

| ID | Finding (short) | Severity | Gain | Regr. Risk | Effort |
|---|---|---|---|---|---|
| C-1 | Startup live-DDL chain fragility | Critical | Very High | Medium | multi-day |
| C-2 | No CI test gate before prod | Critical | Very High | Low | half–1d |
| H-1 | Per-row stock writes (purchase/import) | High | High | Low | half-day |
| H-2 | Unbounded tracked cartesian invoice read | High | High | Low | 1h |
| H-3 | Challan list writes on every read | High | High | Low–Med | half-day |
| H-4 | Missing date-range indexes | High | High | Low (schema) | half-day |
| H-5 | No frontend code-splitting | High | High | Low | half–1d |
| H-6 | God files + no unit tests | High | High | Med | multi-day |
| H-7 | InvalidOperationException→400 leak | High | Med | Med | half–1d |
| H-8 | PdfPig custom build | High | Med | Med | half–1d |
| M-1..M-17 | (see §5) | Medium | Med–High | Low–Med | S–multi |
| L-1..L-14 | (see §6) | Low | Low–Med | None–Low | <30m–half |

---

## 17. Phased Implementation Roadmap (one task at a time, each independently shippable)

> Global gate for **every** backend task (from `CLAUDE.md`): `dotnet build` = 0 errors, `python scripts/test_stock_itemtype_reflow.py` = **all checks passed (140/140)**, `test_tenant_isolation.py` + `test_basic_flows.py` = all PASS, and the audit verifier stays green. Ask before commit and before push (separately). Do not push if the stock-reflow gate is red or cannot be run.

### Phase 0 — Quick wins (½ day total, near-zero risk)
L-4 (pin JwtBearer) → L-1 (drop dead frontend deps) → M-7 (memoize contexts) → L-7, L-8 (aggregate dedup) → M-8 (security headers) → M-15 (deploy hygiene). *Ship as one small backend PR + one small frontend PR.*

### Phase 1 — Reliability foundation (before any perf refactor)
1. **C-2** — add the CI build+test gate. *(Everything after this rides on it.)*
2. **M-12** — batch the purge job.
3. **L-6** — bound the caches.

### Phase 2 — High-value read-path performance (low regression)
4. **H-2** + **M-4/M-5** — `AsNoTracking()/AsSplitQuery()` sweep across read/list repos.
5. **H-1** — batch stock writes in purchase/import.
6. **H-3** — take the write off the challan list read.
7. **M-1/M-2/M-3/M-6** — kill the N+1 loops (rates, challan-create, bill-update, tax-claim).

### Phase 3 — Schema (indexes) — isolated migration, prod manual-apply
8. **H-4** — add the four date-range composites. Validate with query-plan before/after. *(Its own PR; nothing else in it.)*

### Phase 4 — Frontend performance
9. **H-5** — route-level `React.lazy` + `Suspense`; split grapesjs + export utils into chunks.
10. **L-2** — assess MUI/Bootstrap consolidation (spike first).

### Phase 5 — Observability & error hygiene
11. **H-7** — narrow `InvalidOperationException` mapping; restore 5xx logging.
12. **M-9/M-10** — move controller `catch/ex.Message` + direct-DB into services.

### Phase 6 — Supply chain & startup
13. **H-8** — resolve PdfPig custom build (re-baseline PO corpus).
14. **C-1** + **M-13** — retire startup backfills into migrations behind a version gate. *(Highest care; last, after tests exist.)*

### Phase 7 — Structural refactors (continuous, test-backed)
15. **H-6** — incremental extraction from `InvoiceService` / `EditBillForm` / `AppDbContext`, one unit per PR.

---

## 18. Verification Checklists

Apply the relevant checklist to **each** task before marking it done.

**Manual / functional**
- [ ] Exercise the exact flow the change touches (create/edit/list/print), not just compile.
- [ ] Demo (`IsDemo`) rows still excluded from KPIs/numbering where applicable.

**API**
- [ ] Same HTTP status codes + response JSON shape as before (contract unchanged).
- [ ] `[HasPermission]` + tenant guard unchanged/retained on touched endpoints; a cross-tenant id still 403s.
- [ ] Pagination clamps unchanged.

**UI (per `CLAUDE.md` §3)**
- [ ] Verified at 375 / 768 / 1280 px; no horizontal scroll on phone.
- [ ] Icon buttons render (svg width > 0); modals don't clip.

**Regression**
- [ ] `test_stock_itemtype_reflow.py` = 140/140.
- [ ] `test_tenant_isolation.py` + `test_basic_flows.py` = PASS.
- [ ] PO-parser corpus + prod read-only check green **if** parser/import touched.

**Database**
- [ ] Migration reviewed; applied to the correct branch DB (not the prod replica by accident — see memory).
- [ ] New index present (`sys.indexes`); no unintended table rewrite; unique constraints intact.
- [ ] `SET STATISTICS IO` shows fewer logical reads on the target query; no plan regression elsewhere.

**Performance**
- [ ] Query count / round-trips reduced (verify via EF logging on the touched path).
- [ ] Frontend: target chunk no longer in the initial bundle (Vite build output / network panel).

**Security**
- [ ] No new `ex.Message`/internal detail in any client response.
- [ ] Upload validators + auth/tenant guards unchanged on touched paths.

---

*End of audit. No application files were modified in producing this report; it is the sole deliverable and is safe to delete or relocate.*

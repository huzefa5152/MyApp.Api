# Division-Level RBAC — Full Application Audit

**Date:** 2026-07-04
**Branch audited:** `feat/sales-quote-order` (HEAD `aeb17cb`)
**Goal:** extend the existing Company-level access model so users can be
restricted to specific **Divisions** within a company — view/edit/create/delete
and every derived surface (lists, prints, exports, dashboards, attachments,
imports) must respect the restriction.

Every claim in this document was verified against the actual source with an
adversarial second pass; several findings from the first sweep were corrected
or downgraded during verification. File:line references are as of HEAD above.

---

## 1. Executive summary

- **Division-level authorization does not exist anywhere.** Divisions are a
  data/branding/numbering concept (`Models/Division.cs`). Any user with company
  access sees and can mutate every division's data in that company.
- **The good news:** the codebase is unusually well prepared. All six document
  types already carry `DivisionId` with per-division numbering and unique
  indexes; conversions inherit division correctly; most create paths already
  validate that `dto.DivisionId` belongs to the company (via
  `Helpers/DivisionNumbering.ResolveAsync` or explicit checks); and the
  company-level machinery (`CompanyAccessGuard`, `AuthorizeCompanyAttribute`,
  `UserCompaniesController`, `PermissionService`, seeder/backfill patterns,
  `test_tenant_isolation.py`) gives a proven template to mirror.
- **The core work** is: a `UserDivisions` grant table + restriction flag, an
  `IDivisionAccessGuard`, enforcement at ~40 endpoint sites, an assignment UI,
  and frontend context/dropdown filtering. Aggregation surfaces (dashboard,
  stock, GL reports, rate history) need a second phase because
  `StockMovement` has no `DivisionId` at all.
- **Six pre-existing security/integrity bugs** were found along the way that
  should be fixed regardless of this feature (§6) — the worst is a cross-tenant
  stock-quantity leak in `ItemTypesController.GetAll`.

---

## 2. Current state (verified)

### Authorization stack
| Layer | Mechanism | File |
|---|---|---|
| Identity | JWT: `Name`, `Role`, `fullName`, `Sub`, `Jti`, `stamp` — **no company/division claims** | `Controllers/AuthController.cs:319-334` |
| Feature permission | `[HasPermission("module.page.action")]` → `PermissionService` (global catalog, global roles, 60s cache, seed-admin bypass) | `Middleware/HasPermissionAttribute.cs`, `Services/Implementations/PermissionService.cs` |
| Tenant scope | `[AuthorizeCompany]` (route→query `companyId`, fail-closed 400 if missing, 403 via `ICompanyAccessGuard`) + manual `AssertAccessAsync` for id-based routes | `Middleware/AuthorizeCompanyAttribute.cs:51-91`, `Services/Implementations/CompanyAccessGuard.cs` |
| Grants | `UserCompany` rows, fail-closed, backfilled once (`RBAC_USERCOMPANIES_BACKFILL_V1`) | `Models/UserCompany.cs`, `Program.cs:1595-1632` |
| Frontend | `/permissions/me` → flat `Set<string>` in `PermissionsContext`; company picker via `GET /companies` (server-filtered by guard) | `myapp-frontend/src/contexts/PermissionsContext.jsx`, `Controllers/CompaniesController.cs:55` |

**Key structural fact:** roles and permissions are *global*; org scoping lives
in grant tables (`UserCompany`), orthogonal to RBAC keys. Division RBAC should
follow the same split — do **not** mint per-division permission keys.

### Division data model
- Entities **with** `DivisionId` (nullable): `Invoice`, `SalesQuote`,
  `SalesOrder`, `DeliveryChallan`, `PurchaseBill`, `GoodsReceipt`,
  `PrintTemplate`, and accounting: `Payment`, `Account`, `JournalEntry`,
  `JournalLine`, `AccountTransfer` (reporting dimension).
- Entities **without** `DivisionId`: `StockMovement`, `OpeningStockBalance`,
  `PaymentAllocation`, `Attachment`, `Folder`, `AuditLog`,
  `FbrCommunicationLog`, `Client`, `Supplier`, `ItemType`.
- Unique numbering indexes are already `(CompanyId, DivisionId, Number)` for
  all six documents (`Data/AppDbContext.cs`), and per-division counters live on
  `Division` itself. `DivisionMergeFieldSeeder` + division-scoped
  `PrintTemplate` resolution (division template → company default) already work.
- **No EF global query filters exist** — all scoping is per-query.

### Division inheritance on conversions (all verified)
| Flow | Behavior | Evidence |
|---|---|---|
| Quote → Order | inherits `quote.DivisionId` | `SalesQuoteService.cs:350` |
| Order → Challan | inherits `order.DivisionId` | `SalesOrderService.cs:502` |
| Duplicate Challan | inherits `source.DivisionId` | `DeliveryChallanRepository.cs:272` |
| Invoice → Credit/Debit Note | inherits `original.DivisionId` | `InvoiceService.cs:2325` |
| **Challan → Invoice** | **does NOT inherit** — comes from `dto.DivisionId` independently | `InvoiceService.cs:656` |

The challan→invoice divergence is a deliberate dto-driven design but becomes a
consistency question under division RBAC (see decision D4, §10).

---

## 3. Recommended target architecture

### 3.1 Grant model — "restricted-user" semantics (recommended)

Mirror `UserCompany`, but with an explicit restriction flag so **no backfill is
needed and existing tenants are untouched**:

```csharp
// Models/UserDivision.cs — composite PK (UserId, DivisionId)
public class UserDivision
{
    public int UserId { get; set; }
    public int DivisionId { get; set; }        // FK → Division (which carries CompanyId)
    public DateTime AssignedAt { get; set; } = DateTime.UtcNow;
    public int? AssignedByUserId { get; set; }
}

// Add to UserCompany (additive migration):
public bool RestrictToDivisions { get; set; }  // default false = full company access
```

Semantics:
- `RestrictToDivisions == false` (default) → user sees **all** divisions +
  company-level (NULL-division) records. Today's behavior, zero migration risk.
- `RestrictToDivisions == true` → user sees only divisions with a
  `UserDivision` row. Flag set + zero rows = sees nothing division-tagged
  (fail-closed *within* the restriction).
- Avoids the "zero rows means everything" footgun of a pure mirror table, and
  avoids the heavy alternative (backfilling every user × every division, then
  having to grant new divisions to everyone forever).

### 3.2 `IDivisionAccessGuard`

Exact mirror of `ICompanyAccessGuard` (60s sliding cache + generation counter +
seed-admin bypass + `InvalidateUser`/`InvalidateAll`):

```csharp
public interface IDivisionAccessGuard
{
    /// null = unrestricted (sees all divisions of that company)
    Task<HashSet<int>?> GetAccessibleDivisionIdsAsync(int userId, int companyId);
    Task<bool> HasAccessAsync(int userId, int companyId, int? divisionId);
    Task AssertAccessAsync(int userId, int companyId, int? divisionId);   // throws → 403
}
```

- `divisionId == null` (company-level record) resolves per policy D1 (§10);
  recommended: allowed for everyone with company access.
- Cross-company sanity stays where it is: `DivisionNumbering.ResolveAsync`
  already rejects foreign divisions on create; the guard adds the *user* layer.

### 3.3 Enforcement pattern (three touch points per module)

1. **List endpoints** — controller resolves the accessible set once and passes
   it down; service adds `Where(d => d.DivisionId == null || allowed.Contains(d.DivisionId.Value))`
   when the set is non-null. The existing optional `divisionId` filter param
   stays a *filter*, but must be asserted against the set first.
2. **Id-based endpoints (get/update/delete/print/void/FBR ops)** — after the
   existing load-and-assert-company step, add
   `await _divGuard.AssertAccessAsync(userId, entity.CompanyId, entity.DivisionId);`
3. **Create/convert** — assert against `dto.DivisionId` before create; for
   conversions assert against the *source document's* division (the child
   inherits it).

An `[AuthorizeDivision]` attribute is **not** recommended as the primary
mechanism: unlike `companyId`, the division is usually discovered from the
loaded entity, not the route. Manual asserts (pattern 2) match how the codebase
already handles id-based company checks. A small helper on
`LoggedControllerBase` can reduce boilerplate.

### 3.4 Assignment API + UI

Mirror `UserCompaniesController` exactly (verified shape:
`GET /api/usercompanies`, `GET user/{id}`, replace-all `PUT user/{id}`,
seed-admin hidden, `InvalidateUser` after write —
`Controllers/UserCompaniesController.cs:56-214`):

- `GET /api/userdivisions/company/{companyId}` — grid of users × divisions
  (+ per-user `RestrictToDivisions` toggle)
- `PUT /api/userdivisions/user/{userId}/company/{companyId}` — replace-all,
  idempotent, preserves `AssignedAt` on unchanged rows, invalidates guard cache
- New permission keys: `divisionaccess.manage.view`, `divisionaccess.manage.assign`
  (module *Division Access*), auto-granted to Administrator via the existing
  one-time-migration pattern (`Program.cs:1668-1685` precedent).
- Frontend: extend **TenantAccessPage** with a per-company division drawer
  (restrict toggle + checkboxes), rather than a new page — it's where operators
  already manage access.

### 3.5 Frontend contract

- Extend `/permissions/me` (or the login bootstrap) with
  `divisionRestrictions: { [companyId]: number[] }` — omit key = unrestricted.
  (`Controllers/PermissionsController.cs:87` currently returns
  `{ userId, isSeedAdmin, permissions }`.)
- `PermissionsContext`: add `getAccessibleDivisions(companyId)` /
  `canAccessDivision(companyId, divisionId)`.
- `DivisionSelect.jsx` (used by all six list pages + forms +
  `TemplateEditorPage`): accept the accessible set and filter options; today it
  renders **all** divisions from `GET /divisions?companyId=` — that endpoint
  must also server-filter for restricted users (dropdown filtering alone is
  cosmetic, not security).
- Forms: default the division to the page filter (already done) but validate
  membership in the accessible set before submit.

### 3.6 What deliberately stays company-scoped

- **Master data** (Clients, Suppliers, ItemTypes, Units, Folders) — shared
  across divisions; scoping them would break cross-division workflows.
- **Accounting/GL** — the CoA and GL are company-wide by design;
  `DivisionId` on `JournalEntry`/`JournalLine`/`Account` is a reporting
  dimension. Users who shouldn't see company-wide financials simply shouldn't
  hold `accounting.*` permissions. (Optional later: division-filtered reports.)
- **FBR configuration/monitor, audit logs** — admin-grade permissions already
  gate them; adding a `DivisionId` tag is a Low-priority enhancement (§5.6).

---

## 4. Verified findings — where division enforcement is missing

Severity here = impact **once division RBAC is the requirement**. "Pre-existing
bug" findings that stand on their own are in §6.

### 5.1 Document endpoints (HIGH — the core of the feature)

All six controllers share the same three gaps. Verified representative lines:

| Controller | Unvalidated `divisionId` list filter | Id-routes lack division assert | Create/convert lacks user-division assert |
|---|---|---|---|
| `SalesQuotesController` | `:69→74` | GetById/Update/Delete/Print/status | Create, convert-to-order |
| `SalesOrdersController` | `:75→80` | same | Create, raise-challan |
| `InvoicesController` | `:81→92` | same + Void/FBR validate/submit/preview/exclude + note-create | Create `:184`, CreateStandalone |
| `DeliveryChallansController` | `:75→80` | same + Duplicate + UpdateItems/UpdatePo | Create `:106` |
| `PurchaseBillsController` | `:63→67` | same | Create `:83` |
| `GoodsReceiptsController` | `:45→49` | same | Create `:65` |

Notes from verification:
- **Cross-company `divisionId` injection on list endpoints is harmless** — all
  six repositories use `CompanyId == companyId AND DivisionId == divisionId`
  conjunctions, so a foreign division id returns empty. The real exposure is
  **intra-company cross-division** reads/writes, plus omitting the filter
  entirely (no `divisionId` = all divisions), which is the default today.
- FBR operations on a division's invoice (validate/submit/exclude/reverse) are
  id-based and must go through the same entity-division assert — an FBR
  submission is an outward-facing legal act for that division's documents.

**Fix:** patterns §3.3(1–3) on every action of the six controllers.

### 5.2 Print / export surfaces (HIGH)

- `PrintTemplatesController` id-based routes — `GetById :121`,
  `Update :152`, `SetDefault :164`, `Delete :176`, excel-template ops
  `:195/:272/:311` — assert company only; a restricted user can read/modify
  another division's template (its `HtmlContent` embeds that division's NTN,
  address, branding). `Create :129` already validates division→company
  (`:139-143`) but not user→division.
- Print-data flows on the document controllers (challan/bill/tax-invoice print,
  XLS/PDF) are id-based → covered by §5.1 pattern 2, but list them explicitly
  in the test plan: printing is the easiest place to leak a division's identity
  fields.
- Excel exports `ExportChallanExcel :489`, `ExportBillExcel :497`,
  `ExportTaxInvoiceExcel :505` also have a pre-existing permission gap (§6.5).

### 5.3 Attachments & folders (MEDIUM-HIGH)

Verified behavior (`Controllers/AttachmentsController.cs`,
`Services/Implementations/AttachmentService.cs`):
- Upload validates the linked entity exists **and** belongs to the supplied
  company (`AttachmentService.cs:74-85`) — good.
- `GetByEntity :77` and `Download :99-111` check company only. An attachment on
  a division-A quote is listable/downloadable by any company member.
- `Attachment` has no `DivisionId`; resolving division on every read means a
  per-entityType join.

**Fix:** denormalize `Attachment.DivisionId` (nullable, additive): set from the
linked entity at upload; one-time backfill via `EntityType/EntityId` joins
(follow the `ATTACHMENT_STORAGE_FLATTEN_V1` marker pattern); assert division on
`GetByEntity`/`Download`/`Delete`. Folder browsing (folder-only documents) stays
company-level.

### 5.4 Aggregation surfaces (HIGH for restricted users, but Phase-2)

Verified: no division parameter anywhere in these chains.
- **Dashboard** — `DashboardController.GetKpis :38`;
  `ComputeHeroAsync :200`, `ComputeSalesAsync :291`, `ComputePurchasesAsync
  :404`, `ComputeFbrAsync :515`, `ComputeInventoryAsync :570` all aggregate the
  whole company. A restricted user with `dashboard.kpi.sales.view` reads other
  divisions' revenue.
- **Stock** — `StockMovement` and `OpeningStockBalance` have **no
  `DivisionId`** (models verified); `GetOnHandAsync :109`,
  `GetOnHandBulkAsync :169`, `StockController` onhand/movements/opening
  endpoints (`:50/:115/:212`) are company-wide. Division-scoping stock requires
  the schema change + backfill from source documents (§9 Phase 4).
- **Item rate history** — `GetItemRateHistoryAsync :2792`,
  `GetLastRatesForChallanAsync :2878` read invoice lines across all divisions
  (decision D3, §10).
- **GL reports** (trial balance, aging, summary) — company-wide by design; see
  §3.6.

**Interim policy (recommended):** until Phase 4, restricted users get
sales/purchases/FBR KPIs computed with the division filter applied to
`Invoice`/`PurchaseBill` queries (both carry `DivisionId`), and the
**inventory KPI section + stock pages are hidden/403'd for restricted users**
(cannot be scoped honestly yet). Do not ship division RBAC with a dashboard
that quietly shows restricted users company-wide numbers.

### 5.5 Imports (MEDIUM)

All verified to create documents with `DivisionId = NULL` and no way to target
a division:
- **PO import** — `ParsedPODto` has no division field; resulting Sales Order is
  company-level.
- **FBR purchase import** — `FbrPurchaseImportCommitter.cs:148-167` creates
  bills with no `DivisionId`.
- **Challan Excel import** — `ChallanImportPreviewDto` has no division;
  `ImportHistoricalAsync` (`DeliveryChallanService.cs:1027-1048`) never sets it.
- **Legacy ETL** — maps divisions correctly for invoices/quotes/orders/challans
  (`LegacyImportService.cs:496/543/607/655`) but **skips purchase bills**
  (`:766-788`) even though `divisionMap` is in scope (also §6.6).

**Fix:** optional `divisionId` on each import request → validate
division→company → assert user→division → stamp created rows. Restricted users
must supply one of their divisions (imports are bulk create).

### 5.6 Logs & monitors (LOW)

`AuditLog` (`CompanyId` only, `:21`) and `FbrCommunicationLog` (`:21`) are
company-wide. Viewers hold admin-grade keys (`auditlogs.view`,
`fbrmonitor.view`), so exposure is limited. Optionally add a nullable
`DivisionId` tag (populated where the source document is known) and filter for
restricted users. Not a blocker.

### 5.7 Frontend (HIGH, but entirely dependent on backend contract)

Inventory from the frontend sweep (all under `myapp-frontend/src/`):
- `contexts/PermissionsContext.jsx` — flat permission set; needs
  division-restriction state + helpers (§3.5).
- `contexts/CompanyContext.jsx` — no division state; add selected/accessible
  divisions with per-company localStorage, reset on company switch.
- `Components/DivisionSelect.jsx` — renders **all** divisions; must filter (and
  the backing endpoint must server-filter).
- Six list pages (`SalesQuotePage`, `SalesOrderPage`, `ChallanPage`,
  `InvoicePage`, `PurchaseBillsPage`, `GoodsReceiptsPage`) + their forms —
  division filter defaults to "all"; for restricted users default to their
  set; validate on submit.
- `pages/TenantAccessPage.jsx` — extend with the division drawer (§3.4).
- `pages/TemplateEditorPage.jsx` — division scope picker must filter.
- Document tables show `divisionName` — fine once the rows themselves are
  server-filtered.
- Button-level permission gating is otherwise in good shape (verified sweep
  found no 403-on-click buttons).

---

## 6. Pre-existing findings — fix regardless of this feature

| # | Severity | Finding | Location | Fix |
|---|---|---|---|---|
| P-1 | **HIGH** | `GET /api/itemtypes?companyId=X` returns per-company **AvailableQty (stock on hand)** without `AssertAccessAsync` on the `companyId` branch — cross-tenant stock leak for any authenticated user. (The no-param branch correctly uses the accessible set, `:99-102`.) | `Controllers/ItemTypesController.cs:93-96` | Assert company access when `companyId` supplied |
| P-2 | MEDIUM | `DeliveryChallanService.CreateDeliveryChallanAsync` assigns `DivisionId = dto.DivisionId` with **no division→company validation** (the only document create path that skips it). A company-A user can tag a challan with company-B's division → prints with the foreign division's NTN/address/branding via `Include(Division)`. | `Services/Implementations/DeliveryChallanService.cs:294` | Route through `DivisionNumbering.ResolveAsync`-style check like the other five |
| P-3 | MEDIUM | `AccountService` create/update assign `dto.DivisionId` unvalidated (contrast: `PaymentService :138/:285`, `AccountTransferService :219`, `JournalEntryService :277` all validate). | `Services/Implementations/AccountService.cs:240,260,300` | Add the standard `Divisions.AnyAsync(... CompanyId == companyId)` check |
| P-4 | LOW | `Payment.cs:48` comment claims `DivisionId` "defaults from the settled document" — it never does; `CreateAsync` only reads `dto.DivisionId` (`PaymentService.cs:182`). | `Models/Accounting/Payment.cs:48` | Either implement the default (recommended: when all allocations settle documents of one division) or fix the comment |
| P-5 | MEDIUM | Excel-export endpoints have `[AuthorizeCompany]` but **no `[HasPermission]`** — bypasses `challans.print.view` / `bills.print.view` / `invoices.print.view`. | `Controllers/PrintTemplatesController.cs:489,497,505` | Add the respective print permissions |
| P-6 | ~~LOW~~ **WITHDRAWN** (2026-07-04, implementation session) | ~~Legacy ETL assigns divisions to invoices/quotes/orders/challans but not purchase bills~~ — **not a bug**: the legacy `PurchaseMaster` read (`PurchaseHeaderRow`, `LegacyImportService.cs:1010,1031`) carries no company/division dimension, and `SeedStartingNumbersAsync` (`:683-684`) documents "purchase bill at company level (purchases carry no division)" as the deliberate design. | `Services/Implementations/LegacyImportService.cs:1010` | No change |
| P-7 | LOW-MED | Ungated read endpoints (no `[HasPermission]`): `ItemTypesController` `GetAll :76`, `GetById :118`, `saved-hscodes :112`; `LookupController` items/top/by-name/units; `FbrLookupController` GetAll/by-category; `UnitsController.GetAll :39`. Some are commented as intentional shared lookups, but `itemtypes.manage.view` exists in the catalog and is not enforced on the main read. | various | Decide intentional vs. oversight per endpoint; at minimum gate ItemTypes reads with `itemtypes.manage.view` |
| P-8 | INFO | `AttachmentService.GetByEntityAsync` doesn't re-validate the linked entity's ownership on read (upload does). Defense-in-depth only — no exploit without a pre-existing bad row. | `Repositories/Implementations/AttachmentRepository.cs:38` | Optional re-validation; superseded by §5.3 denormalization |

---

## 7. Permission-structure audit

### What's good
- Single static catalog (`Helpers/PermissionCatalog.cs`) with seeder upsert +
  stale-key pruning; admins can't invent keys. Keep this.
- Deliberate granularity where separation-of-duties matters (validate vs.
  submit, void vs. delete, duplicate vs. create, fbrtoken vs. update,
  receipts vs. payments). Keep.
- Proven one-time migration pattern for splitting/renaming keys
  (`Program.cs:805-1137`).

### Issues found
1. **Inconsistent key depth** — `auditlogs.view`, `fbrmonitor.view`,
   `itemratehistory.view` (2 segments) vs. `dashboard.kpi.sales.view` (4) vs.
   `invoices.manage.update.itemtype.qty` (5). Not worth renaming (migration
   churn); instead **document the convention** at the top of the catalog:
   `module.page.action` canonical, extra dotted suffixes allowed for action
   variants, and hold new keys to it.
2. **Module display strings inconsistent** — `"FBR Import"`, `"Tenant Access"`,
   `"Item Rate History"` (spaced) vs. `"PrintTemplates"`, `"SalesQuotes"`
   (packed). Cosmetic; affects RolesPage grouping. Normalize display names only
   (keys untouched).
3. **Missing keys:**
   - `divisionaccess.manage.view` / `divisionaccess.manage.assign` (this
     feature — mirrors `tenantaccess.manage.*`).
   - `printtemplates.manage.create` does not exist — `Create` is gated by
     `manage.update` (`PrintTemplatesController.cs:129-130`). Acceptable, but
     document it in the catalog comment or add the key.
   - No key gates ItemTypes/Lookup reads (see P-7).
4. **Scoping stance (important):** permission keys must stay
   **data-independent**. Do *not* create `divisions.access.<id>`-style keys —
   division grants belong in `UserDivision` rows, exactly as company grants
   live in `UserCompany`, and the RolesPage/permission tree stays static.
5. `divisions.manage.*` (existing) governs division *administration* and stays
   company-admin territory; it is unrelated to division *membership* and should
   not be overloaded for it.

---

## 8. Security risk register (division RBAC rollout)

| Risk | Vector | Mitigation |
|---|---|---|
| Cross-division read via API | list endpoints without division filter; id endpoints without entity assert; direct URL access bypassing hidden UI | §3.3 enforcement at controller+service; tests per module |
| Cross-division write/delete | update/delete/void/FBR ops on foreign division's document ids | pattern 2 asserts on the **loaded entity's** division (never dto) |
| Restriction bypass via NULL | user tags document `DivisionId = null` to make it company-visible | policy D2: restricted users must tag one of their divisions on create |
| Aggregate leakage | dashboard/stock/rate-history reveal other divisions' totals | interim gating + Phase 4 scoping (§5.4) |
| Attachment side-channel | download attachment of unseen division document | §5.3 denormalize + assert |
| Print/branding leakage | print data / templates / excel export of foreign division | §5.2 |
| Cache staleness | revoked division access lives ≤60s in guard cache | same accepted trade-off as company guard; `InvalidateUser` on every grant write |
| Import bulk bypass | restricted user imports into unrestricted/company scope | §5.5 division param + assert |
| Foreign-division tagging | challan/account create with another company's division (P-2/P-3) | fix in Phase 0 |
| Seeder regression | new keys/backfills must be idempotent | follow marker pattern (`..._BACKFILL_V1`) + `RbacSeeder` auto-grant precedent |

---

## 9. Prioritized implementation plan

### Phase 0 — pre-existing fixes (HIGH, ship immediately, no schema)
P-1 ItemTypes tenant assert; P-2 challan division validation; P-3 AccountService
validation; P-5 export permissions; P-4 comment/default; P-6 legacy PB
divisionMap. Add regression cases to `test_tenant_isolation.py` (P-1) and
`test_basic_flows.py` (P-2).

### Phase 1 — core infrastructure (HIGH)
1. Migration: `UserDivisions` table + `UserCompany.RestrictToDivisions`
   (additive; conditional/lineage-safe per branch-DB rules).
2. `IDivisionAccessGuard` + implementation (mirror `CompanyAccessGuard`).
3. Catalog: `divisionaccess.manage.view/.assign` + Administrator auto-grant
   migration.
4. `UserDivisionsController` (mirror `UserCompaniesController`, replace-all
   PUT, guard invalidation, seed-admin hidden).
5. `/permissions/me` extension with `divisionRestrictions`.
6. `DivisionsController.GetByCompany` server-filters for restricted users
   (keep unfiltered for `divisionaccess.manage.*` holders so the admin UI works).

### Phase 2 — document + surface enforcement (HIGH)
7. Six document controllers/services: list scoping, id asserts (incl.
   duplicate/void/FBR ops/note-create/prints), create/convert asserts.
8. `PrintTemplatesController` id-route division asserts.
9. Attachments: `DivisionId` column + upload stamping + backfill marker
   (`ATTACHMENT_DIVISION_BACKFILL_V1`) + read/download asserts.
10. New `scripts/test_division_isolation.py` (mirror tenant-isolation harness:
    2 divisions, restricted + unrestricted users, expect 403/filtered lists per
    module; include the direct-URL/IDOR cases).

### Phase 3 — frontend (HIGH-MEDIUM)
11. `PermissionsContext` + `CompanyContext` division state.
12. `DivisionSelect` filtering; form-submit validation; restricted default
    filters on the six pages.
13. TenantAccessPage division drawer; TemplateEditorPage scope filter.
14. Hide inventory KPI/stock pages for restricted users (interim, §5.4).
15. Responsive check at 375/768/1280 per house rules; rebuild + deploy bundle
    with the same commit.

### Phase 4 — aggregates (MEDIUM)
16. `StockMovement.DivisionId` + `OpeningStockBalance.DivisionId` (nullable) +
    backfill from source documents (marker `STOCKMOVEMENT_DIVISION_BACKFILL_V1`);
    `StockService`/`StockController` division params; re-enable stock for
    restricted users. Extend `test_stock_itemtype_reflow.py`.
17. Dashboard `divisionId?` param; `Compute*` scoping; division picker on the
    dashboard for unrestricted users (nice-to-have).
18. Rate-history scoping per D3.

### Phase 5 — polish (LOW)
19. Import target-division params (PO, FBR purchase, challan Excel).
20. `PaymentAllocation.DivisionId` denormalization if per-division AR/AP aging
    is wanted; GL reports division filter.
21. `AuditLog`/`FbrCommunicationLog` division tags.
22. Catalog convention comment + module display-name normalization.

Pre-push discipline per CLAUDE.md applies to every phase (build 0 errors,
67/67 audit verifier, basic flows, tenant isolation, stock reflow — plus the
new division-isolation script from Phase 2 onward).

---

## 10. Open policy decisions (need product sign-off)

| # | Question | Recommendation |
|---|---|---|
| D1 | Do restricted users see **company-level (NULL-division) records**? | **Yes** — treat as shared. Excluding them breaks every legacy document (all pre-division rows are NULL) and master-data workflows. |
| D2 | Can restricted users **create** company-level (NULL-division) records? | **No** — must tag one of their divisions; otherwise D1 + create = trivial restriction bypass. |
| D3 | Rate history / last-rates across divisions for restricted users? | Scope to accessible divisions for consistency (accept the loss of cross-division price hints). |
| D4 | Should challan→invoice **inherit** the challan's division instead of trusting `dto.DivisionId`? | Inherit when all source challans share one division; require explicit (validated) choice when mixed. Closes a drift vector. |
| D5 | Restricted users and the accounting module? | Keep GL company-wide; rely on `accounting.*` permission assignment. Revisit per-division reports in Phase 5. |
| D6 | Dashboard for restricted users pre-Phase-4? | Division-scoped sales/purchases/FBR KPIs; inventory section hidden. |

---

*Produced with a four-track parallel code sweep (controllers, data layer,
frontend, cross-cutting infra) followed by an 11-claim adversarial verification
pass; all inline references re-checked against source at HEAD `aeb17cb`.*

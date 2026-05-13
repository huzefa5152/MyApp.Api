# MyApp.Api — Security & Bug Audit
**Date:** 2026-05-13
**Scope:** Full backend (.NET 9 / EF Core 8 / SQL Server) + React frontend
**Audit method:** Six parallel structured agents covering auth/JWT, RBAC/tenant
isolation, input/injection, FBR integration, business-logic concurrency, and
API surface/uploads. Findings classified 🔴 Critical / 🟡 High / 🟢 Medium / ⚪ Low.

> **How to use this doc:** Pick a phase, start a Claude Code session pointed at
> this file, and say *"start on Phase A from AUDIT_2026_05_13_SECURITY.md"*.
> Each finding has a file:line reference and stays small enough to fit one PR.
> Recommended fix order at the bottom — phases are batched by blast radius +
> risk-of-regression.

---

## 🔴 CRITICAL (block public/external deployment)

### C1 — `FbrToken` stored in plaintext

- **File:** `Models/Company.cs:24`
- **Risk:** DB dump (or a read-only SQL grant) reveals every tenant's PRAL
  bearer token. Attacker can impersonate tax submissions under the victim's
  NTN.
- **Fix:** Encrypt at rest. Options:
  - Data Protection API (`IDataProtector` from `Microsoft.AspNetCore.DataProtection`)
    with key persisted to disk or Azure Key Vault.
  - Column-level encryption in SQL Server (Always Encrypted) — heavier but
    transparent to EF.
  - Wrap `Company.FbrToken` getter/setter in a service that encrypts on write
    + decrypts on read. Keep the encryption key out of `appsettings.json`.

---

### C2 — `FbrMonitorController` allows cross-tenant log access

- **File:** `Controllers/FbrMonitorController.cs:36-68`
- **Issue:** `?companyId=` is purely a filter. No `_access.AssertAccessAsync`.
- **Impact:** Any user with `fbrmonitor.view` can pass any competitor's
  `companyId` and read submitted invoice payloads, buyer NTN/CNIC last-4,
  amounts, supplier names.
- **Fix:** When `companyId` is set, call
  `await _access.AssertAccessAsync(CurrentUserId, companyId.Value)`. When
  null, scope the query to `GetAccessibleCompanyIdsAsync(CurrentUserId)`.

---

### C3 — `FbrPurchaseImportController` bypasses tenant guard

- **File:** `Controllers/FbrPurchaseImportController.cs:37-111`
- **Issue:** `companyId` arrives via `[FromForm]`, neither endpoint
  (`Preview` / `Commit`) calls `_access.AssertAccessAsync`.
- **Impact:** Caller with `fbrimport.purchase.preview/commit` can plant
  Suppliers, PurchaseBills, ItemTypes, and StockMovements into any tenant.
- **Fix:** Add `_access.AssertAccessAsync(CurrentUserId, companyId)` at the
  top of both actions, before the form is processed.

---

### C4 — `CompaniesController.DeleteCompany` no tenant guard

- **File:** `Controllers/CompaniesController.cs:110-116`
- **Issue:** Has `[HasPermission("companies.manage.delete")]` but no
  `_access.AssertAccessAsync`. Cascade in `CompanyService.cs:234-253` drops
  the entire tenant's invoices, challans, clients, items, templates.
- **Impact:** Any user with that permission for tenant A can DELETE tenant B's
  company. Total destruction.
- **Fix:** Add `await _access.AssertAccessAsync(CurrentUserId, id);` before
  the delete.

---

### C5 — `ClientsController` read endpoints publicly readable

- **Files:**
  - `Controllers/ClientsController.cs:52` — `GET /groups` (no perm, dumps every
    ClientGroup across tenants)
  - `:60` — `GET /common/{groupId}` (no perm)
  - `:123` — `GET /` (no perm)
  - `:134` — `GET /count` (no perm)
  - `:153` — `GET /{id}` (no perm)
- **Impact:** Any authenticated user enumerates clients across all tenants.
- **Fix:** Add `[HasPermission("clients.manage.view")]` (or appropriate
  read-perm key from `Helpers/PermissionCatalog.cs`) to each.

---

### C6 — No token revocation / stolen-token persistence

- **Files:** `Controllers/AuthController.cs:217-242`, `Program.cs:94-103`,
  `myapp-frontend/src/contexts/AuthContext.jsx:79-84`
- **Issue:** JWT has 8-hour lifespan. No JTI blocklist, no `SecurityStamp`
  column. Logout / password change just clears `localStorage`. Stolen token
  remains valid until natural expiry.
- **Fix:**
  1. Add `SecurityStamp` (or `TokenVersion`) column to `User`. Bump on logout
     / password change / role change.
  2. Embed the stamp in the JWT.
  3. Middleware compares JWT stamp to DB stamp on each request — mismatch =
     401.
  4. Server-side `POST /auth/logout` that bumps the stamp.

---

### C7 — Token in `localStorage` → XSS = 8h account takeover

- **Files:** `myapp-frontend/src/contexts/AuthContext.jsx:10,80`,
  `myapp-frontend/src/api/httpClient.js:29-36`
- **Issue:** Token in `localStorage`. Any XSS payload reads it. No CSP
  middleware.
- **Fix (defence-in-depth):**
  1. Move token to `HttpOnly; Secure; SameSite=Strict` cookie. Backend reads
     from cookie instead of `Authorization` header (or both for transition).
  2. Add CSRF token (double-submit cookie pattern) for state-changing routes.
  3. Add CSP middleware: `default-src 'self'; script-src 'self'; ...`
- **Note:** This is invasive. Plan for a feature branch + thorough test.

---

### C8 — Bill / Challan / Purchase-bill number races

- **Files:**
  - `Services/Implementations/InvoiceService.cs:415-422, 651-658`
  - `Repositories/Implementations/DeliveryChallanRepository.cs:114-132`
  - `Services/Implementations/PurchaseBillService.cs:164-169`
- **Issue:** `MAX(Number) + 1` reads under READ COMMITTED with no `UPDLOCK`,
  and `AppDbContext` defines the relevant indexes as NON-UNIQUE
  (`AppDbContext.cs:236,259,752`). Two concurrent creates on the same
  company → duplicate numbers.
- **Impact:** Breaks FBR submission (duplicate IRN attempts), breaks the
  "only-latest-bill-can-be-deleted" invariant.
- **Fix path A (minimal):** Add `UNIQUE (CompanyId, InvoiceNumber)` index +
  catch `DbUpdateException` (SQL 2601 / 2627) → recompute + retry (3
  attempts). Same for Challan + PurchaseBill.
- **Fix path B (cleaner):** Use a sequence per-company stored on `Companies`
  + `UPDLOCK,HOLDLOCK` on the SELECT. `SELECT CurrentInvoiceNumber FROM
  Companies WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id`. Increment + write back in
  the same txn.

---

### C9 — Swagger/OpenAPI exposed in production

- **File:** `Program.cs:1335-1336`
- **Issue:** `UseSwagger() / UseSwaggerUI()` unconditional. Full route map
  + permission keys baked into `[HasPermission]` summaries + DTO shapes
  leaked.
- **Fix:**
  ```csharp
  if (app.Environment.IsDevelopment())
  {
      app.UseSwagger();
      app.UseSwaggerUI();
  }
  ```
  Or gate behind an admin permission if you want it in staging.

---

### C10 — `/api/auditlogs` PII surface

- **Files:** `Controllers/AuditLogsController.cs:23-29`,
  `Services/Implementations/AuditLogService.cs:32-46`,
  `Middleware/GlobalExceptionMiddleware.cs:40-81,160-175`,
  `Helpers/SensitiveDataRedactor.cs:46-62`
- **Issue:** Returns `RequestBody`, `QueryString`, `StackTrace`. Single
  permission `auditlogs.view` (typically Admin only) but no per-tenant
  filter — Admin sees every tenant's request bodies. The redactor regex
  is JSON-only — form-data and multipart bypass it.
- **Fix:**
  1. Filter by `GetAccessibleCompanyIdsAsync(CurrentUserId)` unless caller
     is seed admin.
  2. Strip `StackTrace` from the wire response (operator UI doesn't need it
     — surface only on a dedicated drill-through endpoint gated by an extra
     permission).
  3. Extend redactor to handle form-encoded + multipart bodies (look for
     `Content-Type: application/x-www-form-urlencoded` or `multipart/...` and
     apply field-name based redaction).

---

### C11 — No `pageSize` upper bound

- **Files:**
  - `Controllers/AuditLogsController.cs:25`
  - `Controllers/InvoicesController.cs:66, 72, 102, 109`
  - `Controllers/DeliveryChallansController.cs:68, 75`
  - `Controllers/GoodsReceiptsController.cs:38, 45`
  - `Controllers/PurchaseBillsController.cs:49, 55`
  - `Controllers/StockController.cs:120, 130`
  - `Controllers/FbrMonitorController.cs:39, 47`
  - `Repositories/Implementations/AuditLogRepository.cs:22, 38-39`
- **Issue:** Caller can request `pageSize=1000000` → DoS-able read.
- **Fix:** Shared base controller or filter attribute:
  ```csharp
  // Clamp pageSize to max 100 (200 for audit logs).
  protected static int ClampPageSize(int? requested, int max = 100)
      => Math.Clamp(requested ?? 25, 1, max);
  ```
  Apply at every read action.

---

### C12 — Login rate-limit defeated behind reverse proxy

- **File:** `Program.cs:114, 1344-1347`
- **Issue:** Rate-limit partition key is `httpContext.Connection.RemoteIpAddress`.
  `UseForwardedHeaders` is registered but `KnownProxies` / `KnownNetworks`
  are at framework default (empty) → on MonsterASP/Render/CloudFlare,
  `RemoteIpAddress` is always the reverse-proxy IP, so every login attempt
  shares one bucket = effectively no throttle.
- **Fix:** Configure `ForwardedHeadersOptions`:
  ```csharp
  builder.Services.Configure<ForwardedHeadersOptions>(options =>
  {
      options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
      options.KnownNetworks.Clear();
      options.KnownProxies.Clear();
      // Trust your reverse proxy's IP(s). For MonsterASP this needs their docs;
      // for Cloudflare, their published IP ranges.
  });
  ```
  After this, `Connection.RemoteIpAddress` reflects the real client IP and the
  rate-limit partition works.

---

### C13 — FBR submit double-send via Polly retry

- **Files:** `Services/Implementations/FbrService.cs:986-989`,
  `Program.cs:229-245`
- **Issue:** `AddStandardResilienceHandler` retries POSTs on 5xx /
  `HttpRequestException`. `X-Idempotency-Key` is sent but PRAL's
  contract on it is unverified. On lost-response + retry, FBR may issue
  a second IRN. `PersistStatus` (`FbrService.cs:1194-1201`) overwrites
  `FbrIRN` with the latest — first IRN is silently lost.
- **Fix:**
  1. Configure resilience handler to **not retry POSTs** to FBR submit
     (or only retry on connect-failure, not response-timeout).
  2. Before any retry, call a `GetByIRN` lookup with the idempotency key
     to check if PRAL already accepted the first attempt.
  3. Alert loudly when `FbrIRN` is being overwritten with a different value.

---

### C14 — Oversell — `CheckAvailabilityAsync` defined but never called

- **File:** `Services/Implementations/StockService.cs:225`
- **Issue:** Method exists on `IStockService` but no caller in the entire
  solution. Two concurrent bills consuming the last 10 units both succeed →
  on-hand goes negative.
- **Fix:** Wire into invoice save paths. In `InvoiceService.CreateAsync` /
  `UpdateAsync` / `CreateStandaloneAsync` / `UpdateItemTypesAsync`, BEFORE
  the save:
  ```csharp
  var requirements = invoice.Items
      .Where(i => i.ItemTypeId.HasValue)
      .Select(i => new StockRequirement(
          i.ItemTypeId.Value, i.ItemTypeName ?? "", i.Quantity));
  var shortages = await _stock.CheckAvailabilityAsync(invoice.CompanyId, requirements);
  if (shortages.Count > 0)
      throw new InvalidOperationException($"Insufficient stock: {string.Join(", ", shortages.Select(s => s.ItemName))}");
  ```
  Consider making it a `409 Conflict` rather than `400` to distinguish.
  Make blocking optional via a `Company.EnforceStockAvailability` flag for
  tenants that don't want hard gating.

---

### C15 — Privilege escalation via legacy `Role` claim

- **Files:** `Controllers/UsersController.cs:97, 142`,
  `DTOs/UserDtos.cs:24`, `Controllers/AuthController.cs:226`
- **Issue:** `User.Role` is a free-text column. `UsersController.CreateUser` /
  `UpdateUser` accept it with only `users.manage.create` / `users.manage.update`
  permission. JWT emits it (`AuthController.cs:226`). Any
  `[Authorize(Roles="Admin")]` honors it. The new RBAC system is separate
  but the JWT claim path is still authoritative for legacy attribute usage.
- **Fix:**
  - Either remove the freeform `Role` column entirely (use only `UserRoles`
    join), or
  - Restrict assigning `Role = "Admin"` to seed admin only:
    ```csharp
    if (dto.Role == "Admin" && currentUserId != _seedAdminUserId)
        return Forbid();
    ```
  - Stop emitting `Role` claim in JWT — rely only on `[HasPermission]`
    attributes.

---

## 🟡 HIGH

### H1 — `Company.IsTenantIsolated` is operator-flippable

- **Files:** `DTOs/UpdateCompanyDto.cs:33`, `CompanyService.cs:173`,
  `CompanyAccessGuard.cs:82`
- **Fix:** Carve out a dedicated `tenantaccess.manage.update` permission;
  reject the flip unless the caller holds it. Audit-log every flip with
  before/after.

---

### H2 — `DeliveryChallansController.DeleteItem` no tenant guard

- **File:** `Controllers/DeliveryChallansController.cs:290`
- **Fix:** Load the challan-item, resolve its `Challan.CompanyId`, then
  `_access.AssertAccessAsync(CurrentUserId, companyId)`.

---

### H3 — `CompaniesController.UploadLogo` weak validation

- **File:** `Controllers/CompaniesController.cs:118-157`
- **Issue:** No tenant guard, no extension allowlist, no MIME check, no
  size cap. Operator can drop `.svg` with script or `.html` rendered from
  `/data/uploads/logos/`.
- **Fix:** Mirror `AuthController.UploadAvatar` (extension whitelist + size
  cap), add magic-bytes sniff, add tenant guard.

---

### H4 — `POFormatsController` no tenant access guards

- **File:** `Controllers/POFormatsController.cs`
- **Issue:** `dto.CompanyId` / `dto.ClientId` not access-checked on
  Create / UpdateSimple / Delete.
- **Fix:** Validate before write.

---

### H5 — `LookupController` global mutation by any authenticated user

- **File:** `Controllers/LookupController.cs:61, 83, 103, 155`
- **Issue:** `AddItem`, `SaveFbrDefaults`, `AddUnit`, `ToggleFavorite`
  mutate global `ItemDescriptions` / `Units` lookups. Any authenticated
  user — including read-only roles — can pollute these.
- **Fix:** Add `[HasPermission("itemtypes.manage.update")]` (or a more
  specific lookups perm) to each mutating endpoint.

---

### H6 — No rate limit on expensive endpoints

- **Files:** `Program.cs:109-125, 1410`
- **Endpoints unthrottled:**
  - `FbrController.cs:104, 117` — submit/validate (each = outbound FBR call)
  - `FbrSandboxController.cs:60, 67` — validate-all / submit-all
  - `FbrPurchaseImportController.cs:42, 87` — 25 MB XLSX × N
  - `POImportController.cs:80` — PDF parse (PdfPig CPU)
  - `DeliveryChallanImportController.cs:52` — 50×10 MB request
  - `AuthController.cs:128` — change-password (BCrypt CPU burn)
- **Fix:** Add per-policy throttles:
  ```csharp
  options.AddPolicy("fbrSubmit", ...);   // e.g. 30/min/user
  options.AddPolicy("import", ...);      // e.g. 5/min/user
  options.AddPolicy("passwordChange", ...); // e.g. 5/hour/user
  ```
  Apply via `[EnableRateLimiting("...")]` on each action.

---

### H7 — Sensitive-data redactor gaps

- **File:** `Helpers/SensitiveDataRedactor.cs:46-62`
- **Issue:** Mask list omits `strn`, `buyerstrn`, `sellerstrn`, `address`,
  `selleraddress`, `buyeraddress`, `phone`. CNIC last-4 already masked.
- **Fix:** Extend the regex's field-name disjunction:
  ```
  password|newpassword|currentpassword|token|authorization|bearer|
  ntn|cnic|strn|buyerstrn|sellerstrn|address|phone|email
  ```

---

### H8 — `FbrCommunicationLog` infinite retention

- **File:** `Services/Implementations/FbrCommunicationLogService.cs`
- **Issue:** No TTL/purge. Multi-year tax PII accumulation = GDPR/PECA
  exposure.
- **Fix:** Add a background hosted service that prunes rows older than
  N days (config: `Fbr:LogRetentionDays`, default 365). Keep summary
  metadata, drop request/response bodies first, then row entirely after
  retention.

---

### H9 — Cross-tenant FBR token bleed via donor pattern

- **File:** `Services/Implementations/FbrService.cs:1430-1448`
- **Issue:** When caller's company has no FBR token, code picks ANY other
  company's token for catalog calls. PRAL audit trail mis-attribution.
- **Fix:** Refuse to make the call. Return a clear error: "This company has
  no FBR token configured; ask an administrator to set one before using
  HS-code catalog features."

---

### H10 — `ClockSkew` default = 5 minutes on JWT validation

- **File:** `Program.cs:94-103`
- **Fix:** Add `ClockSkew = TimeSpan.Zero` (or 30s) to
  `TokenValidationParameters`.

---

### H11 — Dev JWT signing key committed to repo

- **File:** `appsettings.Development.json:10`
- **Issue:** `"Jwt:Key": "dev-only-jwt-signing-key-do-not-commit-32chars+"`
  — committed despite the warning string.
- **Fix:**
  1. Replace with `""` like production.
  2. Document in README: "Set `Jwt:Key` in `appsettings.Local.json`
     (gitignored) for local dev."
  3. Rotate any keys that were ever this value.

---

### H12 — Password policy = 6 chars no complexity

- **File:** `Controllers/AuthController.cs:139`
- **Fix:** Bump minimum to 8 chars. Optionally:
  - Reject top-1000 common passwords (compile a list at startup).
  - Integrate `HaveIBeenPwned`'s k-anonymity API (free).

---

### H13 — XSS via `nl2br` SafeString in print templates

- **File:** `myapp-frontend/src/utils/templateEngine.js:22-24`
- **Issue:** `nl2br` wraps raw operator input in `SafeString` after only
  `\n→<br>`. Operator can store `<script>` in `companyAddress` /
  `clientAddress` → executes in print popup. Requires existing edit rights;
  escalation surface.
- **Fix:** HTML-escape the input first, THEN do the `\n→<br>` replace:
  ```js
  function nl2br(str) {
      if (!str) return "";
      const escaped = Handlebars.Utils.escapeExpression(str);
      return new Handlebars.SafeString(escaped.replace(/\n/g, "<br>"));
  }
  ```

---

### H14 — Excel/CSV injection in exports

- **Files:** `Helpers/ExcelTemplateEngine.cs:588`,
  `myapp-frontend/src/pages/FbrPurchaseImportPage.jsx:227`
- **Issue:** Strings not prefixed against `=` / `+` / `-` / `@` / `\t` /
  `\r`. Recipient opening the file triggers formula → SSRF via
  `=WEBSERVICE`, exfil via `=HYPERLINK`.
- **Fix:** Add a helper:
  ```csharp
  static string CsvSafe(string s) =>
      string.IsNullOrEmpty(s) ? s :
      "=+-@\t\r".IndexOf(s[0]) >= 0 ? "'" + s : s;
  ```
  Apply to every operator-string write into Excel cells.

---

### H15 — Bulk batch endpoints iterate CompanyIds without per-id access check

- **Files:** `Controllers/ClientsController.cs:187`,
  `Controllers/SuppliersController.cs:101`
- **Fix:** Loop the `CompanyIds` list, assert access for each before
  proceeding.

---

### H16 — Mass-assignment of `Company.FbrToken` under generic perm

- **File:** `Services/Implementations/CompanyService.cs:162`
- **Fix:** Carve a separate `companies.manage.fbrtoken` permission. Audit-log
  every write (before-hash / after-hash, not the values).

---

## 🟢 MEDIUM

### M1 — `TaxClaimController` references non-existent permission

- **File:** `Controllers/TaxClaimController.cs:47`
- **Issue:** References `invoices.list.update` which is NOT in
  `Helpers/PermissionCatalog.cs`. PermissionService treats missing keys
  as deny → only seed admin can hit `/api/tax-claim/claim-summary`.
- **Fix:** Either add the permission to the catalog, or change the
  attribute to use the right existing permission (likely
  `invoices.list.view`).

---

### M2 — `PurchaseBillService.UpdateAsync` reversal date drift

- **File:** `Services/Implementations/PurchaseBillService.cs:376, 381`
- **Issue:** Reversal `OUT` movement uses `bill.Date` AFTER `dto.Date`
  mutated it. Reversal carries post-edit date, not original.
- **Fix:** Capture `bill.Date` into a local before mutating, use that
  for the reversal.

---

### M3 — `RbacSeeder.BootstrapExistingAdminUsersAsync` re-bootstrap risk

- **File:** `Data/RbacSeeder.cs:36`
- **Issue:** Gated by an AuditLog marker row. If AuditLog table is ever
  truncated, the bootstrap re-runs → any `User.Role = "Admin"` gets full
  Administrator on next start.
- **Fix:** Move the marker out of `AuditLogs` to a dedicated
  `SystemMigrations` table that doesn't get purged, OR add a hash-based
  marker stored in `Companies` metadata.

---

### M4 — `AuditLogService.LogAsync` dedup not transactional

- **File:** `Services/Implementations/AuditLogService.cs:60-73`
- **Issue:** Find-then-update isn't atomic. Burst writes defeat dedup
  (cosmetic).
- **Fix:** Wrap the find + update in a `SERIALIZABLE` transaction, or
  use SQL `MERGE` with a unique key on `(Fingerprint, Timestamp window)`.

---

### M5 — `CompaniesController.GetCompany` enumeration

- **File:** `Controllers/CompaniesController.cs:48`
- **Issue:** Returns 404 before `AssertAccessAsync` — distinguishes
  "exists in other tenant" from "doesn't exist".
- **Fix:** Assert access FIRST. If denied OR not found, return 404
  uniformly.

---

### M6 — `PrintTemplatesController.GetByCompany*` no permission

- **Issue:** Anyone with tenant access reads template HTML (operator-
  authored, may contain script).
- **Fix:** Add `[HasPermission("printtemplates.manage.view")]`.

---

### M7 — Avatar upload polyglot risk

- **File:** `Controllers/AuthController.cs:158-189`
- **Issue:** Extension-only whitelist. No magic-bytes check. 7 MB limit
  high.
- **Fix:** Sniff the first 8 bytes against known image signatures
  (PNG `89 50 4E 47`, JPEG `FF D8 FF`, WebP `52 49 46 46 .. .. .. .. 57 45 42 50`).
  Drop the limit to 2 MB. Confirm `/data/images/avatars/` static-file
  route forces `Content-Type: image/*`.

---

### M8 — Backfill marker write timing

- **File:** `Program.cs:1130-1186, 1205-1266`
- **Issue:** Marker written after work in same `SaveChangesAsync` —
  partial-crash window. SQL is idempotent so re-entry safe, but fragile.
- **Fix:** Wrap each backfill in an explicit `BeginTransactionAsync` so
  marker + work commit atomically.

---

### M9 — FBR reference-data endpoints no permission

- **File:** `Controllers/FbrController.cs:149-213`
- **Issue:** `provinces/{companyId}`, `hscodes/{companyId}`, etc. require
  `[AuthorizeCompany]` but no permission → any tenant member burns PRAL
  quota.
- **Fix:** Add `[HasPermission("fbr.reference.read")]` (new perm key).

---

### M10 — HSTS may never set behind misconfigured proxy

- **File:** `Program.cs:1344-1347, 1405-1408`
- **Issue:** HTTPS redirect disabled in prod (proxy terminates TLS). If
  `X-Forwarded-Proto` not honoured (per C12), HSTS header never sets on
  first request.
- **Fix:** Same as C12 — configure forwarded headers properly.

---

### M11 — Auto-migrate on every startup with no kill switch

- **File:** `Program.cs:317`
- **Fix:** Gate behind config: `if (configuration.GetValue<bool>("Database:AutoMigrate", true))`.
  Default true for dev, set to false in production `appsettings.Production.json`
  once schema is stable.

---

### M12 — Login timing-leak enables username enumeration

- **File:** `Controllers/AuthController.cs:38-43`
- **Issue:** `BCrypt.Verify` short-circuited on unknown user → response
  timing distinguishes "user exists" from "wrong password".
- **Fix:** Compute a dummy BCrypt verify on the unknown-user path:
  ```csharp
  if (user == null)
  {
      // Burn equivalent CPU so timing doesn't leak existence.
      BCrypt.Net.BCrypt.Verify(dto.Password, _dummyBcryptHash);
  }
  ```
  `_dummyBcryptHash` is a pre-computed hash of a random string.

---

### M13 — Challan duplicate flow not transactional

- **File:** `Services/Implementations/DeliveryChallanService.cs:923-966`
- **Issue:** Per-clone repository call, no surrounding transaction. Partial
  failure leaves some clones persisted.
- **Fix:** Wrap the loop in `await using var tx = await _context.Database.BeginTransactionAsync();`
  → `tx.CommitAsync()` after the loop.

---

## ⚪ LOW / VERIFIED-CLEAN

These came up clean but worth noting in case of future regression:

- JWT signing key length validated on startup (≥32 chars) ✓
- EF Core queries parameterized — no SQL injection on user input ✓
- BCrypt default work factor 11 — acceptable
- No `dangerouslySetInnerHTML` in frontend ✓
- All FBR endpoints use HTTPS (`gw.fbr.gov.pk`) ✓
- `InvoiceItemAdjustment` has unique index on `InvoiceItemId` — overlay write
  race caught loudly ✓
- Recent `STOCKMOVEMENT_OVERLAY_SYNC_V1` migration wraps per-bill failures
  in try/catch — partial failures logged ✓
- `JsonSerializer.Deserialize<T>` uses closed types only (no
  `TypeNameHandling`) ✓

---

## Phased Fix Plan

### Phase A (this week) — close cross-tenant data crossover

**Small, high-impact, low-risk diffs. Should take 1-2 days.**

- [ ] **C2** — `FbrMonitorController`: add `_access.AssertAccessAsync`
- [ ] **C3** — `FbrPurchaseImportController`: add `_access.AssertAccessAsync`
- [ ] **C4** — `CompaniesController.DeleteCompany`: add tenant guard
- [ ] **C5** — `ClientsController` read endpoints: add `[HasPermission("clients.manage.view")]`
- [ ] **H2** — `DeliveryChallansController.DeleteItem`: add tenant guard
- [ ] **H4** — `POFormatsController`: add tenant guards
- [ ] **H15** — `ClientsController.CreateBatch` + `SuppliersController.CreateBatch`: per-companyId access check
- [ ] **C9** — Gate Swagger behind `IsDevelopment()`
- [ ] **C11** — Shared `ClampPageSize` helper applied to every paged read

Suggested commit shape: one PR per controller, OR one batched "Phase A: tenant guards + pagination clamp" PR.

---

### Phase B (next sprint) — auth hardening

**More invasive — feature-branch + thorough test plan.**

- [ ] **C6** — Token revocation: `SecurityStamp` column + JWT claim + per-request check + server-side logout
- [ ] **C7** — Move token to HttpOnly cookie + CSRF token (optional, but considered)
- [ ] **C12** — Forwarded-headers KnownProxies/Networks configured
- [ ] **H10** — `ClockSkew = TimeSpan.Zero` on JWT validation
- [ ] **H11** — Rotate + remove dev JWT key from repo
- [ ] **H12** — Password policy → 8 chars + breach check
- [ ] **C15 / H1** — `tenantaccess.manage.update` permission + audit log; restrict Role="Admin" to seed admin
- [ ] **M12** — Dummy BCrypt verify on unknown-user login path

---

### Phase C (data integrity)

- [ ] **C8** — Unique index on `(CompanyId, InvoiceNumber)` + retry-on-conflict; same for Challan + PurchaseBill
- [ ] **C13** — Mark FBR submit POST non-retryable in Polly; add IRN lookup before retry
- [ ] **C14** — Wire `CheckAvailabilityAsync` into invoice save paths
- [ ] **M2** — `PurchaseBillService.UpdateAsync` reversal-date drift
- [ ] **M13** — Wrap challan duplicate flow in transaction

---

### Phase D (compliance / PII)

- [ ] **C1** — Encrypt `FbrToken` at rest (Data Protection API or Always Encrypted)
- [ ] **C10** — Per-tenant filter on `/api/auditlogs`; extend redactor for form-data/multipart
- [ ] **H7** — Redactor field-name list extended (strn, address, phone)
- [ ] **H8** — `FbrCommunicationLog` retention purge job
- [ ] **H13** — HTML-escape in `nl2br` template helper
- [ ] **H14** — Excel/CSV formula-injection prefix

---

### Phase E (operational hardening)

- [ ] **H6** — Rate-limit policies for FBR submit / imports / change-password
- [ ] **H3 / M7** — Logo/avatar upload: extension + MIME + magic-bytes + size cap
- [ ] **H5** — `LookupController` permission gates on mutations
- [ ] **H9** — FBR catalog donor-token: refuse to bleed across tenants
- [ ] **H16** — Separate `companies.manage.fbrtoken` permission
- [ ] **M3** — Move RBAC seeder marker out of AuditLogs to a dedicated table
- [ ] **M4** — AuditLog dedup made transactional
- [ ] **M5** — `GetCompany` access-first then 404
- [ ] **M6** — PrintTemplates read perm
- [ ] **M8** — Wrap backfills in explicit transactions
- [ ] **M9** — FBR reference-data permission
- [ ] **M10 / M11** — HSTS + auto-migrate kill switch
- [ ] **M1** — Fix `TaxClaimController` permission key typo

---

## How to resume in the next Claude session

1. Open Claude Code in this repo (`D:\huzefa-portfolio\github-projects\MyApp.Api`).
2. Say: *"Read `AUDIT_2026_05_13_SECURITY.md`. Start on Phase A — let's
   close C2 first."*
3. Each finding has the file:line ref + fix recipe. Most are < 20 lines
   of code each.
4. Run tests between phases; Phase A items are independent so they batch
   cleanly.
5. Phase B (auth hardening) is the riskiest — do that one on a feature
   branch with full smoke test before merging.

**Last audit context:** the previous session ended with all 8 commits
pushed to `huzefa5152/MyApp.Api` master at `2993e62` (2026-05-13). Local
backend was running on `:5134/:7158`. The recent feature work covered:
tax-claim optimization, dual-book `InvoiceItemAdjustment` overlay,
save-time stock-out, item-type dropdown sort, post-expiry login fix,
date-input hydration fix, Tax Invoice print → real qty, BulkFbrPreviewDialog.

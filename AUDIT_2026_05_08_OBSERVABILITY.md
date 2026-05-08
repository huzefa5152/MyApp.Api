# Production Observability Audit — `feature/purchase-module`

**Date:** 2026-05-08
**Branch:** `feature/purchase-module`
**Scope:** Exception handling, centralised error handling, logging architecture, FBR communication tracking, monitoring, audit-log noise, reliability/retry, sensitive-data hygiene
**Method:** Four parallel review agents (exception handling, logging architecture, FBR communication, background/reliability), plus direct review of `GlobalExceptionMiddleware`, `AuditLogService`, `httpClient.js`, `ErrorBoundary.jsx`. Synthesised into a single prioritised report.
**Stack:** ASP.NET 9 + EF Core 8 + SQL Server backend; React 19 + Vite frontend; multi-tenant FBR Digital Invoicing ERP for Hakimi Traders + Roshan Traders.
**Companion file:** `AUDIT_2026_05_05.md` (different lens — security/architecture). This file is observability/reliability.

> **How to use this file in a future session:**
> Drop a one-liner like `read AUDIT_2026_05_08_OBSERVABILITY.md and start with finding C-3` and the next session will have full context.

---

## TL;DR

The system has a **decent observability skeleton but is missing the load-bearing organs.** `GlobalExceptionMiddleware` is well-designed, frontend error handling is sane, transactions are tightly scoped, and there are zero fire-and-forget anti-patterns. **But:** production logs go only to stdout (lost on container restart), 27 of 30 controllers have no `ILogger` at all, FBR submissions log NTN/CNIC verbatim with no redaction, FBR imports are not idempotent (duplicate bill risk), there's no retry/Polly anywhere, and FBR traffic is buried inside the same `AuditLog` table as everything else. None of the gaps are catastrophic on day one — but every one of them turns into a 2-3 day incident the first time it bites.

**Five "do this week" items** dominate everything else (see Phase 1 in the roadmap). Everything below medium can wait.

---

## Status legend

| Marker | Meaning |
|---|---|
| 🔴 | Critical — blocks production-grade certification; data-loss / privacy / duplicate-write risk |
| 🟠 | High — significant gap that will compound under load or audit |
| 🟡 | Medium — quality / dx improvement; should fix in a sprint |
| 🟢 | Low — polish |
| ✅ | Already good — pattern to copy |

---

## CRITICAL findings

### C-1 🔴 Production logs are stdout-only — lost on container restart

`appsettings.Production.example.json` has the same minimal `Logging:LogLevel` block as base; no Serilog, no file sink, no Seq, no Application Insights. The `Dockerfile` runs `dotnet MyApp.Api.dll` and stdout is captured by Docker's default JSON-file driver — capped, rotated by Docker, gone on `docker rm`. After a deploy or container crash there is **no historical log to investigate from**.

**Why it matters:** when the FBR API starts returning 500s at 11pm, the only forensic surface is the `AuditLogs` SQL table — which (per finding C-2 and H-3) doesn't capture reference-API failures, ILogger calls from services, or any structured request trace.

**Fix sketch:** Add Serilog + `Serilog.Sinks.Async` + `Serilog.Sinks.File` (rolling, 30-day retention, 50 MB/file) wired in `Program.cs` via `builder.Host.UseSerilog(...)`. For Docker deployments mount `/app/logs` to a host volume. Optional: ship to Seq (free for solo) on `:5341` — game-changer for diagnostics.

---

### C-2 🔴 FBR audit logs leak NTN, CNIC, addresses verbatim

`Services/Implementations/FbrService.cs` line ~1166 (`LogFbrActionAsync`) writes the FULL request JSON to `AuditLog.RequestBody` and the FBR response JSON to `AuditLog.StackTrace`. Both go in unredacted — every Submit/Validate row contains:

```
SellerNTNCNIC: "1234567"           // 7-13 digit tax ID, plain text
SellerBusinessName: "Hakimi Traders Ltd"
SellerAddress: "123 Main St, Karachi"
BuyerNTNCNIC: "1234567890123"      // CNIC, plain text
BuyerBusinessName: "ABC Corp"
... line items, prices, totals ...
```

`GlobalExceptionMiddleware` *does* have a redactor (`SensitiveJsonRegex`) covering `password`, `token`, `apikey`, `secret`, `jwt`, `connectionstring` — but it's a private static, not a shared service, and `FbrService.LogFbrActionAsync` doesn't call it.

**Why it matters:** the `AuditLog` table is queryable via `auditlogs.view` permission. Anyone with that permission can read tens of thousands of NTN/CNIC pairs. That's a privacy breach and an FBR compliance issue (NTNs are PII under PDP Bill 2023 once enacted).

**Fix sketch:**
1. Lift `SensitiveJsonRegex` + `RedactSensitive` from middleware into a new `Helpers/SensitiveDataRedactor.cs` (singleton DI service).
2. Extend the field list with `ntn`, `cnic`, `sellerntncnic`, `buyerntncnic`, `nicnumber`.
3. Add a separate "mask not redact" mode for NTN/CNIC: replace all-but-last-4 with `*` so the ID is still recognisable for support without leaking the full number.
4. Call from `FbrService.LogFbrActionAsync` before persisting.

---

### C-3 🔴 FBR import is not idempotent — duplicate bill risk

From `Services/Implementations/FbrPurchaseImportCommitter.cs:244-253` and the `Models/PurchaseBill` schema: there is **no unique constraint on `(CompanyId, SupplierId, SupplierBillNumber)`**, and the committer's own comment acknowledges the race window:

> *"we could re-check by NTN here against a race condition where two operators commit the same FBR file simultaneously, but that's vanishingly rare..."*

**Failure modes:**
- Operator uploads Annexure-A, gets a 500 mid-loop on invoice 27/50 → invoices 1-26 are committed → operator re-uploads → invoices 1-26 duplicate.
- Two operators simultaneously click Commit on the same file → both get partial overlap.
- Network glitch on the FBR side, operator retries → duplicate IRN.

**Fix sketch:**
1. Add migration: `ALTER TABLE PurchaseBills ADD CONSTRAINT UX_PurchaseBills_Source UNIQUE (CompanyId, SupplierId, SupplierBillNumber)`.
2. In the committer's `catch`, detect `SqlException.Number IN (2601, 2627)` and treat it as `outcome = "skipped (already imported)"` instead of `"failed"`.
3. Surface that count to the UI alongside the existing decision counters.
4. Mirror the change for `Models.Invoice` if the same risk exists for sales invoices (worth a separate check).

---

### C-4 🔴 No idempotency on FBR submission — duplicate IRN risk

`FbrService.SubmitInvoiceAsync` issues a single POST to `gw.fbr.gov.pk/di_data/v1/di`. If the request reaches FBR, FBR processes it and returns an IRN, but the network drops *before* the client reads the response — the operator hits Submit again and **a second IRN is issued for the same invoice.** That's an FBR-side data error, not just an ERP one.

**No request-UUID / idempotency key is sent.** No "have we already got an IRN for this invoice?" pre-check before re-submit.

**Fix sketch:**
1. Generate a stable per-invoice `idempotencyKey = SHA256(companyId + invoiceId + invoiceVersion)` and send it as a custom request header. (FBR doesn't honour it server-side, but...)
2. Before any submit, check `Invoice.FbrIRN IS NOT NULL` → if set, refuse re-submission and return the existing IRN.
3. After timeout/cancel, mark the invoice `FbrStatus = "submission-uncertain"` instead of `"failed"` — the operator gets a separate "Verify with FBR" workflow that hits the FBR status endpoint to discover whether the original POST landed.
4. Add a manual "Force re-submit" override behind a permission, for the rare case the first submit truly didn't reach FBR.

---

### C-5 🔴 `StockService.RecordMovementAsync` does its own `SaveChangesAsync` mid-transaction

`Services/Implementations/StockService.cs:25-51`: each call adds a `StockMovement` and *immediately* calls `await _context.SaveChangesAsync()`. That's invoked from inside `PurchaseBillService.CreateAsync` and `FbrPurchaseImportCommitter.CommitOneInvoiceAsync`, both of which wrap an outer `BeginTransactionAsync`. Because the transaction is on the same `DbContext`, the inner `SaveChanges` is part of the outer transaction (so rollback works) — but:

- A deadlock on the stock-movement insert (SqlException 1205) **rolls back the entire bill**, and there's no retry. The bill the user just created vanishes.
- If `RecordMovementAsync` ever gets called from a context that is *not* inside a transaction, the bill+stock pairing is no longer atomic.

**Fix sketch:** Drop the `SaveChangesAsync` call inside `RecordMovementAsync` and let the outer caller commit. Document the contract in the method's XML comment ("caller MUST commit the surrounding transaction"). Add a debug-only guard: `if (!_context.Database.CurrentTransaction.HasValue) throw new InvalidOperationException("...")`.

---

## HIGH findings

### H-1 🟠 No retry / no Polly anywhere

Zero references to `Polly`, `IAsyncPolicy`, `WaitAndRetry`, `CircuitBreaker`. No manual retry loops on `SaveChangesAsync` or `HttpClient.SendAsync`. Every transient SQL deadlock (1205), connection-pool timeout, and FBR HTTP 503 fails the whole operation immediately and surfaces as a 500 to the user.

**Three highest-value Polly slot-ins:**
1. `IFbrService` Submit / Validate calls — exponential-backoff retry on `HttpRequestException` and 5xx FBR responses (3 attempts, 1s/3s/9s).
2. `StockService.RecordMovementAsync` (after fixing C-5) — retry on SQL 1205 deadlock (3 attempts, 50ms/200ms/1s).
3. `IHttpClientFactory.AddPolicyHandler` on the named `"FBR"` client — circuit breaker (5 consecutive 5xx → open 30s).

`Polly` and `Polly.Extensions.Http` are 1-line NuGet adds.

---

### H-2 🟠 Named `"FBR"` HttpClient has no timeout configured

`Program.cs:160`: `builder.Services.AddHttpClient("FBR");` — that's it. Falls back to the default 100-second timeout, which means a hung FBR endpoint blocks an HTTP request thread for **100 full seconds** before bubbling up. Under load that's a fast way to exhaust the Kestrel thread pool.

**Fix sketch:**

```csharp
builder.Services.AddHttpClient("FBR", c => {
    c.Timeout = TimeSpan.FromSeconds(30);
    c.DefaultRequestHeaders.Add("User-Agent", "MyApp.Api/1.0");
})
.AddPolicyHandler(GetRetryPolicy())
.AddPolicyHandler(GetCircuitBreakerPolicy());
```

---

### H-3 🟠 No dedicated `FbrCommunicationLog` table — FBR traffic mixed into general audit

Every FBR Submit/Validate is one row in `AuditLogs` with `ExceptionType = "FBR_Submit"`, request body in `RequestBody`, response in **`StackTrace`** (semantically wrong — that column was designed for .NET stack traces). Operators with `auditlogs.view` see FBR rows interleaved with login failures, invoice edits, validation errors. The user explicitly called this out: *"Admins should be able to monitor only FBR traffic, only FBR failures, only FBR warnings, without noise from normal ERP operations."*

**Fix sketch:**

```csharp
public class FbrCommunicationLog {
    public long Id { get; set; }
    public DateTime Timestamp { get; set; }
    public int CompanyId { get; set; }
    public int? InvoiceId { get; set; }
    public string Action { get; set; }                  // Submit | Validate | StatusCheck | RefData
    public string Endpoint { get; set; }
    public int? HttpStatusCode { get; set; }
    public string? FbrErrorCode { get; set; }
    public string? FbrErrorMessage { get; set; }
    public int RequestDurationMs { get; set; }
    public int RetryAttempt { get; set; }                // 0 for first try
    public string? RequestBodyMasked { get; set; }
    public string? ResponseBodyMasked { get; set; }
    public string? CorrelationId { get; set; }
    public string Status { get; set; }                  // queued | sent | acknowledged | failed | retrying
}
```

Index on `(CompanyId, Timestamp DESC)` and `(InvoiceId)`. A small `FbrCommunicationLogsController` + a `FbrMonitorPage.jsx` (last 50 rows + filters by Status / Action / CompanyId / date range + aggregate counters at the top) closes the visibility gap.

---

### H-4 🟠 No correlation ID / request tracing

No `X-Correlation-ID` header propagated, no `RequestId` enricher, no per-request scope on `ILogger`. When the FBR Submit path crosses 4 service boundaries (Controller → InvoiceService → FbrService → AuditLogService) and one of them fails, there is no way to stitch the related log lines together.

**Fix sketch:** Tiny middleware that reads `X-Correlation-ID` from the inbound request (or generates one), stuffs it onto `HttpContext.Items` and `Activity.Current`, returns it in the response. Combine with `Serilog.Enrichers.CorrelationId`. Add to `AuditLog` model as `CorrelationId` column (migration). FBR communication log too.

---

### H-5 🟠 27 of 30 controllers have zero ILogger usage

Only `FbrPurchaseImportController`, `POImportController`, and a couple of `FbrService` callers inject `ILogger`. The other 27 (`InvoicesController`, `ClientsController`, `CompaniesController`, `AuthController`, `PurchaseBillsController`, `GoodsReceiptsController`...) rely entirely on `GlobalExceptionMiddleware` for crash logging and emit no operational logs (login attempts, bulk operations, deletes, transitions).

**Why it matters:** when an admin asks "did anyone delete client #427 yesterday?", the answer today is "we don't know — check the audit table for /api/clients/427 with method DELETE and pray nobody dropped a row." With operational logging, `_logger.LogInformation("Client {ClientId} deleted by {UserId}", id, currentUser);` makes that trivial.

**Fix sketch:** Add an `[ApiController]` base `LoggedControllerBase` that injects `ILogger<T>` automatically (DI), and a Roslyn analyzer or just a code-review checklist requiring `LogInformation` on every state-changing endpoint. Don't add log calls to GETs (that's the noise the user wants to avoid).

---

### H-6 🟠 FBR reference API failures swallowed silently

`FbrService.GetProvincesAsync`, `GetUOMsAsync`, `GetSaleTypeRatesAsync`, etc. (~10 sites in lines 1187-1442) all share the same shape:

```csharp
try { ... }
catch { return new(); }   // ← silent
```

When FBR's reference endpoint goes down, every dropdown in the UI silently empties. Operator sees "no provinces" and assumes the feature is broken. There is no audit trail showing FBR was unreachable.

**Fix sketch:** Promote these from silent-empty to `_logger.LogWarning(ex, "FBR ref data {Endpoint} unavailable", url)` + return a cached fallback (we have `FbrLookups` table already). Surface a banner in the FBR settings page: "FBR reference catalogue last refreshed N hours ago — currently unreachable."

---

### H-7 🟠 `AuditLog` has no `CompanyId` column

Multi-tenant queries against the audit table need to JOIN to `Invoices` / `Suppliers` / `Clients` / `PurchaseBills` to figure out which tenant a row belongs to — or parse the `RequestBody` JSON. That's slow and brittle.

**Fix sketch:** Migration adds `CompanyId int NULL` (nullable for system-wide events: auth, bootstrap). Populate from `HttpContext.Items["currentCompanyId"]` if your `AuthorizeCompany` middleware can drop it there. Index `(CompanyId, Timestamp DESC)`.

---

### H-8 🟠 No log deduplication / rate limiting

Every 4xx and 5xx response is one fresh row in `AuditLogs`. If the FBR API is timing out, `FbrService.SubmitInvoiceAsync` can produce 500 audit rows in 30 minutes for the same root cause. The user explicitly called this out: *"Do NOT spam audit logs with repetitive identical exceptions."*

**Fix sketch:**

```csharp
// In AuditLogService.LogAsync:
var fingerprint = SHA1(level + exceptionType + message + path);
var recent = await _repo.FindByFingerprintAsync(fingerprint, since: now - 5min);
if (recent != null) {
    recent.Count++;
    recent.LastSeen = now;
    await _repo.UpdateAsync(recent);
    return;
}
// otherwise insert as today
```

Add `Fingerprint string`, `Count int = 1`, `FirstSeen DateTime`, `LastSeen DateTime` columns. The UI shows `Count > 1` rows as "X occurrences" with first/last timestamps.

---

## MEDIUM findings

### M-1 🟡 Generic `catch (Exception ex) { return BadRequest(ex.Message); }` patterns

Sampled in `InvoicesController.cs:168-190`, `ClientsController.cs:79-91`, `DeliveryChallansController.cs:127-130`, `GoodsReceiptsController.cs:70-71`. Each one:
- Returns the raw `ex.Message` to the user (could leak internals — e.g. `InvalidOperationException` carrying SQL details).
- Doesn't log at all (so no admin-side trail).

**Fix sketch:** Either delete these catches entirely (let `GlobalExceptionMiddleware` handle them) or replace with `_logger.LogWarning(ex, "...")` and return a sanitised user message.

---

### M-2 🟡 Empty `catch { ... throw; }` re-throws without logging

`UserCompaniesController.cs:206`, `DeliveryChallanService.cs:333`, `DeliveryChallanService.cs:583`. Each just rolls back a transaction and rethrows. The middleware will catch and log — but without the contextual breadcrumb of "we got here, then this failed." 

**Fix sketch:** Add a `_logger.LogError(ex, "TX failed in {Method}", nameof(...))` line before the throw.

---

### M-3 🟡 Some `LogInformation` calls should be `LogDebug`

`POImportController.cs:184` (`"No PO format matched — returning miss payload"`), `:271`, `:297` (`"Parsed via rule-set: formatId={Id}"`). These fire on every PDF upload and pollute the file sink with happy-path noise. Operators don't need them.

**Fix sketch:** Demote to `LogDebug`. In production `appsettings`, set `Logging:LogLevel:MyApp.Api.Controllers.POImportController = "Information"` — Debug suppressed by default.

---

### M-4 🟡 No JSON deserialisation guard on FBR responses

`FbrService.cs ~1000-1050`: `JsonSerializer.Deserialize<T>` is called on the FBR response body without a `try/catch (JsonException)`. If FBR returns malformed JSON (it's happened during their sandbox outages), the exception bubbles up as a generic 500 rather than a typed "FBR response was malformed" with the raw body captured for diagnosis.

**Fix sketch:**

```csharp
try {
    return JsonSerializer.Deserialize<FbrResponse>(body, JsonOptions);
} catch (JsonException ex) {
    _logger.LogError(ex, "FBR response not parseable. Body (first 500 chars): {Body}",
        body.Length > 500 ? body[..500] : body);
    return Fail("FBR returned an unrecognised response. Operator: contact support with the request ID.");
}
```

---

### M-5 🟡 No `CancellationToken` on async controller actions

None of the ~30 controllers accept `CancellationToken`. When the user closes the browser tab mid-import, the server keeps churning through the operation to completion. Wasted DB cycles, partial commits if the loop short-circuits awkwardly.

**Fix sketch:** Add `CancellationToken ct = default` to every async action signature, pass it down through the service layer to `SaveChangesAsync(ct)` and `HttpClient.SendAsync(req, ct)`. Mechanical change, big payoff under load.

---

### M-6 🟡 No FBR communication monitoring dashboard

Frontend has `InvoicePage.jsx` showing per-invoice `fbrStatus` and `FbrSandboxPage.jsx` for scenario tests, but no aggregate "today's pass rate / avg response time / error-code histogram / queue of failed submissions" view. Operators can't spot patterns ("every SN002 submission today is failing with code 0024") without SQL.

**Fix sketch:** New `/fbr/monitor` route + page showing (top section) today's submit/validate/failed counts and average response time, (middle section) a failed-submission queue with one-click retry per row, (bottom section) the last 50 communications with filter chips. Wire to `H-3`'s new `FbrCommunicationLog` endpoint.

---

### M-7 🟡 Frontend pages occasionally leak raw `err.message`

`ChallanForm.jsx:134`, `InvoicePage.jsx:480/536` use `err.message` as the fallback when `err.response?.data?.message` is missing. For axios that's `"Network Error"` or `"Request failed with status code 500"` — not user-facing-friendly.

**Fix sketch:** Replace fallbacks with stable strings like `"Could not contact server. Check your connection and try again."` and `"Server error. The team has been notified."` (the latter is a polite fiction unless you actually wire monitoring alerts — see C-1).

---

### M-8 🟡 No alert / notification on critical failures

If FBR has been down for 30 minutes and 50 submissions have failed, nobody knows until an operator checks. Email, Slack, or even a dashboard "system health" widget would close the gap.

**Fix sketch:** Lightest lift: a hosted service that runs every 5 minutes, queries `FbrCommunicationLog` for failures-in-last-5-minutes, and posts to a Slack webhook if count > threshold. Heavier lift: send to Application Insights with built-in metric alerts.

---

## LOW findings

### L-1 🟢 `LookupController:89` only handles SQL error 2601, not 1205 (deadlock) or 547 (FK violation)

`SqlException.Number == 2601` (unique constraint duplicate-key) is caught for race-condition writes. Other transient SQL errors aren't differentiated.

### L-2 🟢 27 `SaveChangesAsync` calls with no surrounding catch

Acceptable — `GlobalExceptionMiddleware` will catch — but a typed `DbUpdateException` handler in the middleware that maps unique-constraint violations to 409 Conflict instead of 500 would be friendlier.

### L-3 🟢 No request-duration metric in audit logs

Easy to add via middleware (`Stopwatch`). Useful for spotting slow endpoints.

### L-4 🟢 `Models/AuditLog.cs` has `Level` as `string`

Magic strings (`"Error"`, `"Warning"`, `"Info"`). Should be an enum for DB-side filtering and grep safety.

### L-5 🟢 Console-only logger framework can't structure-search logs

Even if file sink is added (C-1), unless logs are JSON, you can't grep by `companyId`. Serilog default JSON formatter solves this.

---

## STRENGTHS — patterns to copy

✅ **`Middleware/GlobalExceptionMiddleware.cs`** — correct use of typed exception switch, sensitive-data redaction, audit-trail-on-failure-never-crashes-pipeline pattern. Excellent baseline.

✅ **`Services/Implementations/FbrPurchaseImportCommitter.cs:98-235`** — textbook per-invoice transaction: `await using var tx = await _context.Database.BeginTransactionAsync()`, explicit rollback in catch, error message captured into the result DTO so the caller surfaces it without re-throwing.

✅ **`Services/Implementations/PurchaseBillService.cs:137-345` and `:349-511`** — Create/Update/Delete all use the same transaction pattern with stock-movement reversal handled correctly inside the transactional boundary.

✅ **`Services/Implementations/FbrService.cs:1058-1078`** — Distinct `catch (HttpRequestException)`, `catch (TaskCanceledException)`, `catch (Exception)` blocks with separate user-facing messages and audit calls. Replicate this shape across other HTTP integrations as they're added.

✅ **`myapp-frontend/src/api/httpClient.js`** — Excellent error-envelope normaliser (handles `{message}`, `{error}`, ProblemDetails, raw ModelState, ASP.NET validation dictionary). Single source of truth for what the frontend sees.

✅ **`myapp-frontend/src/Components/ErrorBoundary.jsx`** — React render-error catcher with friendly UI and reset action.

✅ **Zero fire-and-forget `Task.Run` / `_ = SomethingAsync()` patterns** — every async chain is correctly awaited. No silent failures from orphaned tasks. Strong baseline.

✅ **All 16 `ILogger` calls use template syntax (`{Var}`)** — no string-interpolation anti-pattern. Logs are structurally searchable already.

---

## Prioritised remediation roadmap

### Phase 1 — "Do this week" (5 days, blocks production-grade certification)

| # | Item | Severity | Est. effort |
|---|------|----------|-------------|
| 1 | **Add Serilog + file sink + Seq (optional)** — fixes C-1. Production logs persist beyond container lifetime. | 🔴 | 1 day |
| 2 | **Lift `SensitiveJsonRegex` into shared service + extend with NTN/CNIC/ntn-cnic + apply in `FbrService.LogFbrActionAsync`** — fixes C-2. | 🔴 | 0.5 day |
| 3 | **Add unique constraint on `(CompanyId, SupplierId, SupplierBillNumber)` + handle SqlException 2601/2627 as "skipped" in committer** — fixes C-3. | 🔴 | 0.5 day |
| 4 | **Pre-submit IRN check + idempotency-key header + `submission-uncertain` status** — fixes C-4. | 🔴 | 1.5 days |
| 5 | **Drop `SaveChangesAsync` from `StockService.RecordMovementAsync` + document caller-commits contract** — fixes C-5. | 🔴 | 0.5 day |
| 6 | **HttpClient timeout on `"FBR"` named client (30s)** — fixes H-2. | 🟠 | 15 minutes |
| 7 | **Polly retry + circuit breaker on FBR HttpClient** — closes part of H-1. | 🟠 | 0.5 day |

**Total Phase 1: ~5 days for one engineer.**

### Phase 2 — "Do this month" (8-10 days; unlocks proper monitoring)

| # | Item | Severity |
|---|------|----------|
| 1 | New `FbrCommunicationLog` table + repository + controller + new `/fbr/monitor` page (last 50 + aggregates + failed-queue retry) — fixes H-3 + M-6. | 🟠 |
| 2 | Correlation-ID middleware + `Activity.Current` enricher + `CorrelationId` column on AuditLog/FbrCommunicationLog — fixes H-4. | 🟠 |
| 3 | `CompanyId` column on `AuditLog` (migration + middleware-side population) — fixes H-7. | 🟠 |
| 4 | Audit-log dedup: `Fingerprint`/`Count`/`FirstSeen`/`LastSeen` columns + repo logic — fixes H-8. | 🟠 |
| 5 | Audit `LoggedControllerBase` + add `_logger.LogInformation` to all state-changing endpoints (the 27 missing) — fixes H-5. | 🟠 |
| 6 | Promote silent FBR reference-API catches to `LogWarning` + cached-fallback banner — fixes H-6. | 🟠 |
| 7 | Polly retry on `SaveChangesAsync` deadlocks (1205) — closes the rest of H-1. | 🟠 |

**Total Phase 2: ~8-10 days.**

### Phase 3 — "Do this quarter" (cleanup + alerting; quality of life)

| # | Item | Severity |
|---|------|----------|
| 1 | Demote `LogInformation` → `LogDebug` for hot-path PO parser logs — fixes M-3. | 🟡 |
| 2 | `try/catch (JsonException)` around FBR response deserialisation — fixes M-4. | 🟡 |
| 3 | `CancellationToken ct` parameter on every async controller action + service signature — fixes M-5. | 🟡 |
| 4 | Replace generic `catch (Exception ex) { return BadRequest(ex.Message); }` patterns with logger + sanitised messages — fixes M-1. | 🟡 |
| 5 | Add `_logger.LogError(ex, ...)` before each empty `catch { ...; throw; }` — fixes M-2. | 🟡 |
| 6 | Friendlier raw-error fallbacks in 3-4 frontend pages — fixes M-7. | 🟡 |
| 7 | Slack/email alert on critical-failure threshold — fixes M-8. | 🟡 |
| 8 | Convert `AuditLog.Level` to enum (migration) — fixes L-4. | 🟢 |
| 9 | Request-duration column + middleware — fixes L-3. | 🟢 |
| 10 | DbUpdateException → 409 mapping in `GlobalExceptionMiddleware` — fixes L-2. | 🟢 |

**Total Phase 3: ~5-7 days, can run in parallel with feature work.**

---

## Quick wins (under 2 hours each)

If you want fast wins before committing to a phase:

1. **HttpClient timeout** (15 min) — `Program.cs` 1-line change, immediate Kestrel-thread protection. (H-2)
2. **Demote noisy `LogInformation` to `LogDebug`** (15 min) — `POImportController` lines 184/271/297. (M-3)
3. **Add `_logger.LogError` to empty rethrow catches** (30 min) — 3 sites. (M-2)
4. **Replace 3-4 frontend `err.message` fallbacks with friendly strings** (30 min). (M-7)
5. **`Polly` retry on FBR HttpClient** (1 hour) — single `AddPolicyHandler` call. (H-1 partial)
6. **Add NTN / CNIC / sellerntncnic / buyerntncnic to `SensitiveFieldNames` regex** (15 min) — partial fix for C-2 even before full redactor refactor.

---

## Final goal — what production-grade looks like for this codebase

After Phase 1+2:

- **Errors are actionable** — every error row has a fingerprint, a CorrelationId, a CompanyId, an occurrence count. Operators see "26 occurrences of `FBR_Submit timeout` in last 30 min, last seen 2 min ago" instead of 26 separate rows.
- **Logs are clean** — production sink is JSON-structured rolling file (or Seq), excludes Debug, GET noise filtered, log levels actually mean something.
- **Monitoring is meaningful** — dedicated `/fbr/monitor` page shows pass-rate, error-code histogram, retry queue, system health at a glance.
- **FBR communication is isolated** — its own table, its own UI, its own redaction rules. General audit log stops being a dumping ground.
- **Users see friendly messages only** — `GlobalExceptionMiddleware` already does this for 5xx; M-1 closes the controller-level leaks.
- **Developers / admins can diagnose failures** — CorrelationId stitches a request across 5 service hops; FBR communication log preserves request/response/timing/retries; Serilog file gives 30 days of structured history.
- **No silent failures** — H-6 (FBR reference APIs) closes the only big one. UserCompaniesController + DeliveryChallanService rethrow with logging (M-2). FBR JSON parse failures captured (M-4).

The codebase is closer to that state than the laundry list suggests — `GlobalExceptionMiddleware`, the transaction patterns, and the redaction primitive are all already there. Phase 1 is mostly *propagation*, not *invention*.

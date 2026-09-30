# Trader performance port and application checks — 2026-09-30

Base: TraderFbrInvoicingSystem, 17e7517. This records pre-deployment verification. No production database access was used for these checks. The master-derived audit remains a separate branch; no product branches were merged.

## Scope and implementation

Adapted the audit's performance work to Trader: lazy protected page imports with permission checks and route props retained; memoized auth/company provider values; pending-only company/login-scoped template reads; company/auth request generation guards; bounded audit-body reads and streamed uploads; a dedicated 128-map Excel cache; request-local repeated last-rate reuse; batched selected-challan reads; reused previous-period dashboard aggregates; purchase create/edit/delete and FBR-import stock batches; unused frontend xlsx dependency removed.

Trader's stamp permission gate, access revalidation on focus/403, selected-company storage updates, immediate stamp clearing on refresh, private catalogs, /admin paths, document calculations and posting order remain in place. No new database migration, index, expiry policy, security headers, error status mapping or FBR-enrichment timeout was ported. No document numbering, grouping defaults, scenario selection, validation or template design was changed.

## Measured evidence

Comparable production builds with /admin base: entry JavaScript 4,021,243 -> 618,619 bytes (84.6% smaller); gzip 895,845 -> 188,596. This measures entry payload, not complete page payload or production latency. Pages/editor still have large deferred chunks.

Local SQL equivalence checks against frozen Trader code:

- Repeated rate lines: 101 -> 2 SELECTs; mixed fallback/misses: 151 -> 4. Exact DTO JSON remains identical, including decimals and excluded/demo/note/company filters.
- Three selected challan requests including a repeated ID: 9 -> 3 SELECTs. Requested order, repeated references, loaded graph and empty-input behavior remain intact.
- Dashboard hero with both KPI permissions: 6 -> 4 queries, identical result. Sales-only, purchases-only and neither permission retain the same results/nulls and query counts.
- FBR import successful paths: identical bills/lines/movements/counters with fractional quantities, mixed skip decisions, tracking enabled/disabled; injected stock-write failure rolls back the complete invoice in baseline and revised code.
- Three simultaneous template reads -> one request; settled responses are not retained. Auth/company scope, write invalidation, failures and old completion cleanup are tested.

## Verification

All integration writes used the disposable LOCAL database MyApp_Trader_Perf_20260930. No production fixtures or live FBR submission were used. Login limiting remains enabled; initial 429 failures were rerun in paced groups and passed.

| Check | Result |
|---|---|
| Backend build / frontend type+production build | 0 errors; 11 existing nullable warnings and existing frontend duplicate-key/large-chunk warnings |
| Added helper xUnit cases | 9/9 |
| Basic flows, unchanged suite | Baseline and revised both 67/72; see outdated fixture assumption below |
| Same basic-flow suite with explicit grouped fixture requests | 72/72; assertions and tracked test file unchanged |
| Stock reflow | Baseline/revised 183/183 |
| Tenant isolation / private catalogs / tenant leak sweep | all passed / 50/50 / 106/106 |
| Admin scope / edition roles | 115/115 / 97/97 |
| Chart / GL / posting / accounting reports | 103/103 / 93/93 / 82/82 / 55/55; final posting includes optional local DB note/demo cases |
| GL back-post | 46/46 |
| Document taxes / customer portal | 62/62 / 73/73 |
| Onboarding API / offline harness / frontend decisions | 78/78 / 97/97 / 23/23 |
| Exact totals / HS-code prints / company name-only create | 73/73 / 21/21 / 8/8 |
| Stamps / custom bill numbering / item delete / composite uniqueness | 18/18 / 42/42 / 5/5 / 10/10 |
| Route permissions / static tenant guard / security verifier | 147/147 / all guarded / 66/67; unchanged POFormats helper-name assertion fails |
| Line arithmetic / grouped quantity distribution | 23/23 / 27/27 |
| Template rendering / challan serial fields / document-lines mapping | 154 layouts passed / passed / passed |
| Frontend lint | Passed with current TS/TSX configuration; this does not claim JSX lint coverage |
| EF pending model changes | None |

Browser checks: local seed-admin sign-in; every sidebar destination finished loading (including accounting, catalogs, import pages, reports, templates and administration), without console errors. Titles such as Item Catalog, Units of Measure, User Management and FBR Communication Monitor differ from their menu labels and were confirmed in the resulting DOM. Bills and the standalone creation modal at 375/768/1280 have document width equal to viewport. Standalone form retains Individual lines as default. It was cancelled without saving. These are route/render smoke checks, not every operation on every screen or all-role browser coverage; restricted-role behavior is covered by the API suites.

## Resolved issue and remaining verification limits

1. **FBR purchase-import tenant-catalog correction authorized and implemented.** Commit-time HS matching now includes CompanyId, new item types receive the importing CompanyId, and matched supplier references are checked against that company. The new regression harness requires successful own-company reuse/private creation, oldest same-company selection and atomic foreign-supplier refusal, while reproducing the legacy failure. Final build passed with 0 errors; the database regression harness passed all four ownership scenarios, import equivalence and forced stock-write rollback. Final helper tests passed 9/9, inventory passed 183/183 and private catalogs passed 50/50. No migration is needed.
2. **Five old basic-flow assertions assume always-grouped tax invoices.** Trader's previously requested default is individual lines. No assertion was rewritten. Both baseline and revised return the same 67/72 results. Supplying groupTaxInvoiceByItemType=true in supplemental fixture requests runs the unchanged suite at 72/72; the normal browser form still defaults to Individual lines.
3. Static security verifier retains an old POFormats AssertClientAccessAsync helper-name assertion. That helper is absent in the unchanged Trader controller; current company-scoping checks and tenant-leak suites pass. The assertion was not rewritten.
4. No live FBR submission, production load profile, complete PDF/export matrix or exhaustive role-by-role UI editing was run. Optional SQL-backed posting note/demo cases and GL back-post were subsequently verified locally (82/82 and 46/46). Optional DB-only document-tax and filed-numbering cases remain unrun. Reference-data requests made by existing stock fixtures carried fake tokens; no invoice was submitted to FBR.

Master-derived audit broad rerun: basic 66/66, stock 161/161, tenant isolation all passed, exact totals 73/73, company stamps 18/18, composite uniqueness 10/10, security 67/67, line arithmetic 23/23, grouped distribution 27/27 and document-lines mapping passed. Handover suite requires a filed invoice and was not exercised. Synthetic local import HS fixture codes were excluded after an initial stock run selected them; the clean rerun passed. No audit/master code or remote state was changed by these additional checks.

Rough files/logs are under the already-ignored .codex-audit directory. The unrelated user skill folder was preserved. Repository rules require fresh approval for commit and for push; a Trader push deploys production.

## Deployment decision after concurrency fixes

The maintainer authorized commit, push and deployment after this local verification. This is a recommendation for this candidate, not a guarantee against every possible production failure.

SQL Server deadlock graphs confirmed two cycles: document write -> ledger read versus rebuild ledger delete -> document read; and ledger status reading lines -> headers versus a cascading ledger delete holding headers -> waiting for lines. The final patch coordinates SQL transactions before row locks. Ordinary transactions share a database-scoped application lock and can coexist; rebuilds and ledger reads acquire exclusive access. Ledger read scopes reuse an existing transaction and otherwise release their read-only transaction when the read finishes. Rebuild/default-account setup and lock-date reading are inside the protected rebuild transaction. Startup backfill obtains exclusive access before its outer transaction, and manual journal deletes now have an explicit transaction. No read-uncommitted hints, write retries, FBR retries, migrations, production configuration changes or accounting calculation changes were added.

The resource is database-wide because the captured queries scanned keys beyond one company. Rebuilds and ledger reads can briefly delay writes and other ledger reads across companies in this installation. This is concurrency coordination, not an authorization grant; company filters and permission checks remain unchanged. Cancellation/rollback/disposal release the SQL-owned locks. Production latency under load has not been profiled.

Final evidence:

- Debug and published Release two-process runs each passed 32 overlapping rebuilds plus 56 invoice/purchase/receipt create, edit, cancel and delete operations. Each independently expected a ledger total of 770.06, matched every ledger leg against a clean rebuild, and preserved manual/closed-period entry IDs and values.
- Independent-connection checks passed normal-writer concurrency, exclusive admission, rollback release, synchronous admission, cancellation cleanup, rejection of late lock upgrades, and restoration of ordinary transaction mode after a ledger read.
- An injected journal insert failure after ledger deletion restored the original committed entry IDs and lines. A rebuild inside the backfill-style outer exclusive transaction posted once and remained balanced.
- Final inventory 183/183 and tenant isolation passed concurrently, reproducing the original troublesome overlap without a deadlock.
- Final GL 93/93, posting 82/82, reports 55/55, back-post 46/46, private catalogs 50/50, tenant leak sweep 106/106 and Release helper tests 9/9 passed.
- Final FBR ownership/import equivalence and fault rollback checks passed. Release publish succeeded; no new compiler warning was introduced. No pending model change exists.

Two unchanged test assumptions described above remain documented, not silently re-baselined. Logs, temporary packages and SQL deadlock graphs remain under ignored .codex-audit. The user's unrelated skill folder remains untouched.

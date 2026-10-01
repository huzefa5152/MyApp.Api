# Trader local tenant-security audit — 2026-10-01

Scope: Trader branch, disposable empty local SQL database, synthetic users,
companies, documents and files only. No production access, schema migration,
production write, push or deployment was performed for this audit. Local commits
are authorized; pushing and deployment are explicitly on hold.

## Access contract

Non-seed users require explicit UserCompanies assignments AND the relevant
permission. An Administrator RBAC role alone does not grant company access.
Users with zero assignments see no companies. Multiple assignments grant only
those companies. The configured, authenticated seed-admin identity retains the
existing global administration exception. Customer portals retain their existing
token-based, company/client/document-scoped public capability; public product
imagery contains no tenant database data.

## Findings and fixes

1. Parser-feedback lists/statistics exposed other companies' metadata. Retained
   company-less feedback PDFs were downloadable by tenant users. Scope now
   applies in SQL before pagination and aggregation, to individual downloads and
   ZIP contents. Only seed admin may submit/read unattributed platform feedback.
2. Uploaded stamps, company logos and avatars were publicly served. Private
   files now require authenticated, database-backed ownership checks before both
   static providers; unknown data directories fail closed. An HttpOnly image-only
   session cookie preserves normal image rendering, without authenticating API
   calls. Responses prevent caching. Authorized customer-portal prints embed only
   their company's images, preserving the existing print designs.
3. Deleted users and tokens missing revocation context could remain authenticated.
   Every request now requires a valid positive user identity and matching persisted
   security stamp; missing/deleted users and legacy stamp-less tokens fail closed.
4. Process-local grant, permission and management-tree caches could preserve
   revoked access on another server process. Authorization caches now last only
   for a request/scoped service instance. Current grants/permissions are reread on
   the next request. This adds bounded authorization database reads; it is a
   deliberate correctness tradeoff, not a measured performance improvement.
5. Source review found unattributed archived PO PDFs accessible to non-seed
   users. Their download endpoint now reserves them for seed admin. A synthetic
   legacy null-company archive returned 401 anonymously, 404 to a non-seed
   Administrator with no assignments, and 200 to seed admin.
6. Browser logout previously cleared local state without invoking server session
   revocation. It now calls the existing logout API before discarding its token.
   Server logout also clears the image cookie. If the server is unreachable,
   local sign-out still completes but cannot guarantee server-side revocation.

## Verification evidence

All commands below target the disposable local server, never a live installation.
Raw outputs are retained privately under `.codex-audit/tenant-security/`.

| Check | Result |
| --- | --- |
| `test_trader_security_boundaries.py` on final backend, with second process and fixture signing key | 568/568 |
| `test_admin_scope_isolation.py` | 115/115 |
| `test_tenant_leak_sweep.py` | 106/106 |
| `test_edition_roles.py` | 97/97 |
| `test_customer_portal.py` | 73/73 |
| `test_accounting_gl.py` on final backend | 93/93 |
| `test_accounting_chart.py` | 103/103 |
| `test_accounting_reports.py` | 55/55 |
| Private legacy archived-PO fixture | 3/3; anonymous/tenant/seed controls |
| `verify_tenant_scope.py` | 144 guarded company-scoped actions |
| `test_route_permissions.mjs` | 150/150 |
| `verify_audit_2026_05_13_security.py` | 67/67 after separate test-contract correction |
| `test_basic_flows.py` | 72/72 after fixture explicitly requests grouped printing |
| `test_tenant_isolation.py` | All checks passed; summary description corrected |
| Backend build | 0 errors; 11 existing nullable warnings |
| Frontend production build | Passed; existing duplicate-key/bundle warnings remain |
| Production identifier scan and whitespace check | Passed |

The old H4 assertion expected a replaced PO-format helper name. The corrected
check accepts the current ownership validator and requires a company-access
assertion; runtime PO-format isolation also passes. The basic-flow fixture now
explicitly requests grouped printing instead of assuming grouping is the default.
Its existing numerical/grouping assertions are unchanged. The tenant suite's
assertions already enforce explicit grants; only its outdated summary description
was corrected. These corrections were committed separately from behavior fixes.

The new regression enumerates declared protected controller routes for anonymous
denial and uses real fixtures/owner-positive controls for manipulated company,
client, supplier, item, quote, order, challan, invoice, purchase-bill, goods-receipt,
folder and PO-format IDs. It tests foreign reads/updates/deletes, document prints,
stock/dashboard and report exports, attachments, feedback ZIP/PDFs, private image
URLs/cookies, customer-portal printing, forged/incomplete credentials, zero/multiple
assignments, deleted users, logout, and company/role revocation across processes.

Existing suites separately exercise management/delegation limits, roles/editions,
tenant endpoint filters, customer-portal capabilities and ledger/account isolation.
The source inventory reviewed static-file serving, authorization services, cache
consumers, and the FBR-log retention hosted service. The retention job is a
platform maintenance task, not a user-facing cross-company read endpoint; its
timed lifecycle was not exhaustively exercised. Automated checks are assertions,
not a count of distinct vulnerabilities or proof of every possible execution.

## Limits and release considerations

- The initial in-app browser attempts timed out. Chrome subsequently verified
  single-company selection, private buyer/bill visibility, the no-assignment
  empty screen, two-assignment selection and switching, bill view, protected image
  loading and successful PDF download. The final frontend was tested on a server
  with the development static-asset manifest disabled: the default manifest had
  served an older frontend bundle despite the isolated web-root setting. Latest
  UI logout returned to login and the server recorded a successful logout call.
  The synthetic PDF was inspected locally. Every page and Excel workflow has not
  been manually exercised; API export checks do not establish all UI rendering.
- No real FBR calls, hosting proxy/CDN behavior, production cookies, deployment
  configuration or existing live assignments were tested. Legacy sessions without
  a stamp will require login after this change.
- Previously public files already downloaded/cached cannot be withdrawn. New
  responses disable caching; old copies and any external CDN require operational
  review before release. Revocation applies to subsequent requests, not data
  already delivered or a request already authorized in flight.
- No schema changes were needed. Synthetic fixtures do not cover every historical
  malformed row, all concurrency schedules, or every record mutation endpoint.
- These results support the tested boundaries, not a whole-app “no leaks” claim.
  The changes remain local for review; no push or deployment is authorized yet.

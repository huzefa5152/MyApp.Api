# Customize Email Workspace verification

This is a deliberate port of Trader's optional Email Workspace (502b3e39), without merging the Trader production line. Customize retains division numbering, price/quantity precision, inventory and print templates. It uses a newly generated AddEmailWorkspace migration containing only the six email tables and indexes.

Verification is performed on .NET 9 and disposable local SQL databases with Gmail sync disabled. The SQL workflow uses a fake Gmail provider and the real quotation service; real Google consent and the user's example emails have not been tested.

Customize-specific acceptance covers restricted division writes: null and ungranted divisions are refused, foreign-company divisions are refused, an assigned division creates a correctly scoped quotation with the expected totals, and revoked grants cannot retrieve an existing conversion through the idempotency path. Contact information is retained in notes.

Live Google OAuth, reconnect, email arrival, attachment download and the cached-mail retention policy remain required before tenant rollout. No push or deployment is authorized.

## Verified local results (2026-10-08)

| Check | Actual result |
| --- | --- |
| .NET 9 Release build and SQL/unit tests | 0 build errors; 12 passed, 0 failed |
| Vitest page/navigation tests | 9 passed, 0 failed |
| TypeScript/Vite build | Passed; existing print-editor and large-chunk warnings |
| Optional module HTTP test | 67/67; existing staff and administrators, company denial, same-JWT grant/revocation |
| Tenant isolation | All passed; Email Workspace 17/17; no original assertion relaxed |
| Division isolation | 43/43 |
| Administrator management scope | 127/127 |
| Basic flows, freight and price precision | 108/108 |
| Document copying | 184/184 |
| Stock item-type reflow | 76/76 |
| Static security and permission sections | 67/67; 35/35 modules mapped |
| Fresh database migration | Applied successfully through Customize AddEmailWorkspace |
| EF model consistency | No changes since the last migration |
| Browser review/connections | 375, 768, 1280 px; no horizontal overflow; real shared item/division editors |
| Production-identifier scan | Clean |

Commands: `dotnet test tests/MyApp.Api.Tests/MyApp.Api.Tests.csproj -c Release` with `EMAIL_TEST_CONNECTION` set to an approved disposable local database; `node node_modules/vitest/vitest.mjs run src/pages/EmailWorkspacePage.test.jsx src/layouts/DashboardLayout.test.jsx`; `npm run build`; `python scripts/test_email_module_access.py --base <local-url>`; the existing tenant, division, basic-flow, administrator-scope, copy and stock scripts against that same isolated host.

Two older fixture problems were repaired separately from the application change: narrow provisioning roles now belong to the test tenant, and fresh databases receive the classified item required by the bill/rate-history scenarios. Original assertions remain intact. Sequential authentication-heavy runs can hit the existing ten-per-minute login limiter; reruns used a new local test host or a later window without changing that limiter.

A diagnostic run of Trader's edition script produced nine failures against Customize-specific accounting routes, balance-picker responses, portal access and role-list contracts. That script did not exist on Customize and is not shipped as a Customize acceptance suite. Its broader product-policy differences are not changed by this port; optional-email edition exclusion and grant/revocation are independently covered by the new module test. This evidence does not claim a full audit of Customize's accounting/edition policy.

The browser used synthetic mail and a disposable company. Google credentials were absent and Gmail background sync was disabled throughout. No production database was used. No push or deployment was performed.

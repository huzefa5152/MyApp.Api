---
name: trader-regression
description: >-
  Regression testing for the TraderFbrInvoicingSystem line. Use on EVERY bug fix
  and new feature on the Trader branch to decide which regression cases to add
  or update (always) and whether the suites need to RUN (only when the user asks
  for it, or the change is a breaking / high-risk one). Also use when the user
  says "run regression", "regression test", "did this break anything", "is it
  safe to deploy", or asks which tests cover an area. Trader branch only; local
  database only, never production.
---

# Trader regression testing

Two separate duties. Do not merge them.

1. **Maintain** the regression suite. Always, on every fix and feature.
2. **Run** the regression suite. Only when one of the triggers below fires.

The maintainer's rule (2026-11-20): *keep regression current on every change;
do not run it unless asked explicitly, or the change is breaking and you judge
it needs running.* Running everything on every small change wastes an hour and
trips the sign-in rate limiter; never maintaining it is how a regression ships.

## 1. Maintain: every fix and every feature

Before calling the work done:

- **A bug fix adds the case that would have caught it.** Write it so it fails on
  the old code. A fix with no failing-then-passing case is a guess.
- **A feature adds cases for its own behaviour**, including what it must refuse
  (wrong company, missing permission, bad input).
- **A changed behaviour updates the existing case, deliberately.** Say in the
  commit body what the assertion used to protect. Never re-baseline a test just
  to make a change pass, and never in the same breath as the behaviour it
  guards without saying so (see CLAUDE.md, "A test rewritten to fit the change
  proves nothing").
- **Put the case in the suite that owns the area** (map below). Create a new
  script only when no suite owns it; then add its row to the test table in
  `CLAUDE.md` with the exact command and the expected last line.
- **Update the expected count** in that table when a suite grows.
- **Assert the contract, not one implementation's shape.**
- A new endpoint that takes a `companyId` also gets a tenant case, and a new
  screen a `config/routePermissions.js` entry. Those are in CLAUDE.md; this
  skill does not relax them.

Writing or updating a case does not require running the whole suite. Run the
ONE script you touched, to prove the new case passes (and failed before).

## 2. Run: only on a trigger

Run regression when **any** of these is true:

| Trigger | What to run |
|---|---|
| The user asks ("run regression", "test everything", "is it safe to deploy") | What they asked for; default is the **core set** plus the suites for the areas changed |
| The change is **breaking or high-risk** (list below) | The suites for the areas it touches, plus the **core set** |
| A push that reaches a production branch | The **hard pre-push gate** in CLAUDE.md. That gate is the maintainer's standing rule and is NOT relaxed by this skill |

Otherwise do not run the suites. Say in your summary that regression was
maintained but not run, and name the suites that cover the change so the user
can ask for them.

**Breaking or high-risk** means the change touches any of:

- money arithmetic: totals, GST, further tax, withholding, rounding, freight
- what is sent to FBR, or FBR validate / submit / cancel
- stock movements or reflow, costing, automatic purchase bills
- the general ledger, posting, period locks
- tenant isolation, company access, permissions, roles, sign-in, sessions, MCP
- document numbering, or a create / edit path shared by several documents
- a database migration, a backfill, or a change to an existing column's meaning
- request / response shape of an existing endpoint, or middleware every request
  passes through (auth, compression, rate limiting, exception handling)
- shared helpers or components many screens use (`LineItemsEditor`,
  `printDocument`, `exportUtils`, `httpClient`, `theme.js`)

A wording change, a new isolated screen with its own endpoint, a style fix, a
doc or comment: not breaking. Maintain, do not run.

When unsure whether a change is breaking, read its callers. If you still cannot
tell, treat it as breaking for the area it touches and run only that area.

## Core set

Small enough to run in about ten minutes, wide enough to catch the expensive
mistakes. All take `--base <url>` unless noted.

| Suite | Guards |
|---|---|
| `python scripts/test_stock_itemtype_reflow.py` | inventory in / out through every edit path (the hard gate) |
| `python scripts/test_basic_flows.py` | challan, bill, edit, tax arithmetic |
| `python scripts/test_tenant_leak_sweep.py` | no tenant reads another's data |
| `python scripts/test_tenant_isolation.py` (hardcodes port 5134; run a scratch copy with the URL swapped) | company access on every companyId endpoint |
| `python scripts/test_fbr_further_tax_follows_bill.py` | FBR is sent what the bill carries |
| `node scripts/test_route_permissions.mjs` (offline) | every screen is behind a permission |
| `python scripts/verify_tenant_scope.py` (offline) | every company-scoped action asserts it |
| `python scripts/verify_no_production_identifiers.py` (offline) | nothing production is named in the repo |

## Which suite owns which area

The full list, with exact commands and expected last lines, is the test table
in `CLAUDE.md` ("Test discipline"). That table is the source of truth; this is
the index into it.

| Area changed | Suites |
|---|---|
| Bills, invoices, line arithmetic | `test_basic_flows.py`, `test_invoice_exact_line_total.py`, `test_line_amount.mjs`, `test_custom_bill_number.py`, `test_partial_billing.py` |
| Further tax, withholding, document taxes | `test_fbr_further_tax_follows_bill.py`, `test_further_tax_payload.py`, `test_further_tax_defaults.mjs`, `test_document_taxes.py` |
| FBR payload, filing, cancellation | `test_fbr_cancellation.py`, `test_fbr_no_double_submit.py`, `test_hscode_on_prints.py`, `test_mcp_masters_taxfiling.py`, `test_mcp_fbr_exclusion.py` |
| Stock, costing, purchases | `test_stock_itemtype_reflow.py`, `test_stock_entry_workflow.py`, `test_trader_commercial_costs.py`, `test_cost_purchase_sync.py` |
| Accounting | `test_accounting_chart.py`, `test_accounting_gl.py`, `test_accounting_posting.py`, `test_accounting_reports.py`, `test_gl_backfill.py` |
| Tenants, permissions, roles, editions | `test_tenant_isolation.py`, `test_tenant_leak_sweep.py`, `test_admin_scope_isolation.py`, `test_edition_roles.py`, `test_route_permissions.mjs`, `verify_tenant_scope.py` |
| MCP agent tools | `test_mcp_isolation.py`, `test_mcp_documents.py`, `test_mcp_writes.py`, `test_mcp_reports.py`, `test_mcp_tenant_sweep.py`, `test_mcp_agent_tokens.py`, `test_mcp_oauth.py` |
| Customer portal | `test_customer_portal.py` |
| Clients, suppliers, items, import | `test_party_name_guard.py`, `test_item_type_delete_guard.py`, `test_onboarding_import.py` (+ `.mjs`, + `scripts/onboarding_harness`) |
| Print, PDF, templates | `test_pdf_pagination.py`, `test_bill_print_merge.py`, `test_hscode_on_prints.py` |
| PO import / parser | `scripts/po_parser_harness`, `po_parser_prod_regression.py` (see `PO_IMPORT_PARSER_GUIDE.md`) |
| Request pipeline, compression, caching | `tests/MyApp.Api.Tests` (`ApiCompressionMiddlewareTests`, `KeepWarmOriginTests`), plus the core set |
| C# unit tests | `dotnet test tests/MyApp.Api.Tests --filter "Category!=LocalSql"` |

## How to run without breaking anything

- **Local only.** `MyApp_Trader_Local` on this machine. Never point a suite at a
  production host. Do not create a scratch database without asking the
  maintainer; the tests that demand an isolated one
  (`EMAIL_TEST_CONNECTION`, `FILING_TEST_CONNECTION`, `Category=LocalSql`) are
  skipped unless the maintainer has set that up.
- **Do not restart the maintainer's backend.** Port 5134 is usually theirs and
  holds `bin/Debug`. Build a private copy and run it on another port:

  ```bash
  dotnet build MyApp.Api.csproj -c Release -o "<short temp dir>"
  cp bin/Debug/net9.0/data/keys/*.xml "<short temp dir>/data/keys/"
  cd "<short temp dir>" && env ASPNETCORE_ENVIRONMENT=Development dotnet MyApp.Api.dll \
      --contentRoot "<repo root>" --urls "http://localhost:5136"
  ```

  Use a SHORT temp path (a deep one fails to load the SQL client), copy the key
  ring first, check the "Effective database connection" line says
  `MyApp_Trader_Local`, and stop the process and delete the folder afterwards.
- **Sign-in is rate limited.** Many suites back to back trip it and report
  `login failed: HTTP 429`. That is the limiter working, not a regression: wait
  a minute and rerun that suite alone. Do not loop on the login endpoint while
  waiting; every probe is another attempt.
- **Git Bash rewrites arguments that start with `/`.** Prefix with
  `MSYS_NO_PATHCONV=1` when passing URL paths or `VITE_BASE_PATH=/admin/`.
- **Suites clean up after themselves.** If one is interrupted, remove the
  `_test_*` company it left before the next run.
- Suites marked `--db` / `--sql-db` in the table need `sqlcmd` and the local
  database name; without it their FBR-filed cases are skipped, and the output
  says so. Report skipped cases as skipped.

## Reporting

State plainly, per suite: passed with its count, failed with the failing lines,
or not run. Never write "all tests pass" for suites you did not run. If
regression was maintained but not run, say exactly that and list the suites
that cover the change.

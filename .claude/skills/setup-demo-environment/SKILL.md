---
name: setup-demo-environment
description: Use when preparing or refreshing the LOCAL demo environment for showing this product to prospective users - "set up the demo", "reset demo data", "create demo companies", "make a demo login", "check the demo user cannot see client data". Builds three fictional companies with believable master data and transactions, imports the two sample workbooks, creates a Demo Administrator scoped to those companies only, and proves the isolation server-side. Local only - never touches production or any existing customer company.
---

# Set up the demo environment

Project-local to **MyApp.Api**. Everything here runs against a LOCAL dev server
over the ordinary API, so every tenant guard and permission check applies to it
exactly as it does to a person.

## The one command

```bash
python scripts/setup_demo_environment.py --reset
```

`--reset` deletes the demo companies (by exact name) and the demo user, then
rebuilds everything. Without it the script tops up what is missing and is safe
to re-run. `--isolation-only` re-runs just the review, which is the right thing
after touching authorization code.

The script is the source of truth for what the demo contains. Read its module
docstring before changing anything.

## Before you start

1. **Check the branch and the database.** The branch picks the database
   (`Helpers/LocalDevDatabase.cs`); the startup line says which one it chose.
2. **Have the dev server running** on `http://localhost:5134`.
3. Nothing else. The script creates what it needs.

## What it builds

| | |
|---|---|
| `Nova Industrial Supplies (Pvt.) Ltd.` | importer / engineering supplies. FBR **on**, sandbox, **no token**. Carries the two sample imports. |
| `Vertex Engineering & Trading (Pvt.) Ltd.` | engineering workshop and trading |
| `Prime Wholesale Solutions (Pvt.) Ltd.` | general wholesale and distribution |

Each gets 5-6 clients, 3-4 suppliers, a shared catalogue of ten real-HS-code
products, six purchase bills, ten sales bills, seven receipts and three
supplier payments, dated across about six months so the dashboards and reports
have something to say. Two sales in three are settled, so the receivables
report shows both states rather than one.

Then a **Demo Administrator** (`demo.admin`), granted the three demo companies
and nothing else.

## The rules this must keep

- **Never use a real customer's data as demo data**, and never write to an
  existing company. The script only ever creates, edits or deletes objects
  whose names are in its own `DEMO_COMPANIES` / `PRODUCTS` / `DEMO_ADMIN`
  tables. Other companies are read only, to prove they cannot be reached.
- **Never put a real FBR token on a demo company.** Nova is FBR-enabled with a
  sandbox environment and no token: everything worth showing on the FBR screens
  renders without one.
- **The demo identifiers must be impossible, not merely unused.** The NTNs
  start `000`, which no issued NTN does.
- **The Demo Administrator is an ordinary account.** Nothing in the application
  knows it exists, and no authorization code may learn its name. Access is
  fail-closed already (`CompanyAccessGuard`: a non-seed-admin sees only the
  companies in `UserCompanies`).
- **Its role withholds the installation-wide keys** — `users.*`, `rbac.*`,
  `tenantaccess.*`, `divisionaccess.*`, `auditlogs.*` and
  `companies.manage.delete`. Those are not company-scoped: with
  `tenantaccess.manage.assign` the account could grant itself another tenant,
  which would make the whole exercise pointless.
- **Never commit the demo password.** It comes from `--demo-password` or the
  `DEMO_PASSWORD` environment variable, and is created through the ordinary
  user-create endpoint so it is hashed like any other.

## Resetting

`--reset` notes the demo item types' ids, deletes the **companies**, then
deletes those item types by the ids it kept. The order is not obvious in either
direction and both naive orders fail:

- **Companies first, then look up the items** — they are orphaned by then.
  `ItemType` is a global catalog with no `CompanyId` and its visibility is
  DERIVED from the documents that reference it (CLAUDE.md 5b-2b), so an item
  no company references is invisible to every API while still holding the
  unique (name, HS code) key. The next build can neither re-create it nor find
  it, and the only way out is reading ids straight from the database.
- **Items first** — refused, because the demo bills still reference them.

Hence: look them up while they are visible, delete the companies, delete the
items by id.

`--reset` also drops and recreates the demo user. A **top-up** run (no
`--reset`) leaves the password alone when the one you passed already works.
Changing it rotates the account's SecurityStamp (audit C-6) and the server
holds the previous stamp briefly, so a token minted seconds later comes back
401 and the whole run reads as a total isolation failure. If you must change
it, wait a few seconds before signing in.

## The sample workbooks

Both are produced by one script and by nothing else:

```bash
python scripts/build_sample_import_sheets.py
```

- `myapp-frontend/public/templates/opening-stock-template.xlsx`
- `myapp-frontend/public/templates/gd-costing-template.xlsx`

They are served publicly out of `wwwroot/`, so they must contain no real
business's data — the opening-stock template shipped for a while with three
rows lifted from a live client sheet. Regenerate rather than editing by hand,
and rebuild the frontend (`npm run build`, copy `dist/` into `wwwroot/`) so the
served copies match.

Two things about them that are easy to break:

- The opening-stock workbook's **heading rows are its fingerprint**. The import
  identifies the layout by them, so the generator rewrites data rows only.
- Every HS code is a real, current tariff line. Validation is master-first, so
  an invented code is refused and the sample would fail the import it exists to
  demonstrate.

## The isolation review — do not accept a green run at face value

The script ends with a server-side review: it signs in as the demo account and
asks for every other company's data, through company-scoped reads, id-only
document routes, exports, search endpoints, a write carrying a foreign
`companyId` in the body, and the tenant-access endpoints themselves.

**The verdict rule is the part that goes wrong.** An early version counted
"200 whose body is not a non-empty list" as a pass, and that is exactly how it
green-lit `/dashboard/kpis?companyId=<other>` returning a whole other tenant's
dashboard — the body is an object, so it looked empty. Two rules now:

- A `200` passes only when the body returns no rows, does not name the company,
  and is not that company's own record.
- A `text/html` answer is the SPA fallback, i.e. **the route does not exist**.
  It is reported as SKIPPED, never counted — a probe aimed at a route that is
  not there proves nothing, and a list of invented route names will otherwise
  report a confident all-clear.

If a probe reports SKIP, find the real route and fix the probe.

A run should end `0 failed, 0 skipped`.

## When the review finds something

Fix it in the application's own authorization architecture — `[AuthorizeCompany]`
on the action, or `_access.AssertAccessAsync` / `GetAccessibleCompanyIdsAsync`
in the body. Never special-case the demo account, and never weaken a guard to
make a probe pass.

Three were found this way on 2026-09-14 and fixed:

| | |
|---|---|
| `GET /api/dashboard/kpis?companyId=` | No guard at all. Its own comment said "we trust the upstream guard"; there was none. Returned any company's sales, top clients by name, recent invoices and stock. |
| `GET /api/poimport/archives` and `archives/{id}/file` | Unscoped list, and a download that took an id and no company — customers' own purchase-order PDFs. |
| `GET /api/itemtypes/uoms-for-hs` and `fbr-hints` | Reference answers, but resolving them can spend that company's own FBR token (audit H-9). |

To find more of the same shape, sweep the controllers for an action taking a
`companyId` with no `[AuthorizeCompany]` and no `AssertAccessAsync` in its body.

## Verifying in the browser, not just the API

The API review is necessary and not sufficient. Sign in as `demo.admin` and
check the company selector lists exactly the three demo companies, that
switching between them changes the figures, and that the sidebar carries no
Users / Roles / Tenant Access / Audit Logs.

**Clear `localStorage` first.** The selector caches the company list, so a tab
that was previously signed in as an administrator will show that session's
companies to the demo account and look like a leak that is not one.

## Reporting

Say which companies were created and with what ids, the demo username, what
each company holds, whether both sample imports committed, and every isolation
probe that failed with what was done about it. A demo environment nobody has
signed into is not verified.

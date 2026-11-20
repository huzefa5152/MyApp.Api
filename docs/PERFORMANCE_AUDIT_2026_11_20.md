# Importer performance audit — 2026-11-20

Importer line (`feat/importer-ledger-receipts`) only. The Trader line has its own
audit under the same file name on its own branch; the two lines differ, so the
figures here are this line's.

Measured on Importer production, signed in as the primary admin, on the company
with the most data (company 4: 98 invoices, 47 customers, 104 journal entries;
the catalog holds about 7,900 items). Screens were opened through the app's own
router and the browser's resource timings read back; nothing that writes was
clicked. The same endpoints were then profiled on the local copy of production
with SQL logging on.

## Status — read this first

A session that does more performance work here should update this section, not
start a second document.

**Done and live on production** (`2612c170`–`36025f46`, deploy run 44772180619)

| Change | Where |
|---|---|
| The fingerprinted bundle actually gets its long cache header. The existing rule matched `/assets`, but this site serves the app under `/admin/assets`, so the bundle went out with no `Cache-Control` at all. Now one year, `immutable`; `runtime-env.js` joins the shell as `no-cache` | `Program.cs` (`IsFingerprintedAsset`, `IsHtmlShell`) |
| API reads compressed (JSON of 1 KB or more, one write, never sign-in or agent-token routes) | `Middleware/ApiCompressionMiddleware.cs`, `Program.cs` |
| The site pings itself every 4 minutes against cold starts | `Services/HostedServices/KeepWarmService.cs` |
| Every signed-in screen loads on demand instead of in one bundle: the first page load fetches 677 KB of script instead of 4.9 MB | `App.jsx`, `utils/lazyScreen.js`, `layouts/DashboardLayout.jsx` (Suspense around the outlet) |
| A screen's code is fetched before it is needed: the screen a page load is heading for, and the screen behind a link once the pointer or focus reaches it | `main.jsx`, `App.jsx` (`preloadScreenFor`) |
| Companies and permissions are asked for alongside the sign-in check, not after it | `utils/bootPrefetch.js`, the three contexts |
| Invoices, Credit Notes, Debit Notes, Challans, Sales Orders, Purchase Bills and Goods Receipts fetch their list once | the page components |

**Second pass — done and live on production** (`571b7f5b`, `f0cb00e9`; deploy run 44804108970)

Measured on production after the deploy, company 4, five runs each:

| Endpoint | Original median | After the first pass | Now (median, 5 runs) |
|---|---:|---:|---:|
| `reports/company/4/client-ledger?year=2026` | 1,619 ms | 1,088 ms | 206 ms |
| `itemtypes?companyId=4` (full catalog) | 2,309 ms | 1,289 ms | 228 ms |
| `itemtypes/paged?companyId=4&page=1` | 245–440 ms | — | 301 ms |

Before pushing, the branch had moved (three stock-sheet commits from another
session); the two changes were re-verified on the combined code: stock gate
114/114, client ledger suite 97/97, all 631 report variants identical to the
remote's code on the same data, and all 200 catalog requests identical when
fetched from both builds back to back (the local data was changing under the
captures, so each request was compared old/new/old).

| Change | Proof |
|---|---|
| Client Ledger report reads every customer's rows in one pass (`ICustomerLedgerService.GetWindowEntriesByClientAsync`) instead of calling the single-customer ledger per customer. Company 4's report: 170 SQL statements → 13 | All 583 report variants (every company, seven periods, every single-customer filter) captured before and after: identical, figure for figure and row for row. Client ledger 97/97, customer ledger 126/126, customer ledger groups 47/47, accounting reports 326/326 |
| The catalog's visibility rule is written as two disjoint halves joined with `UNION ALL` instead of an `OR` (`ItemTypeRepository.ScopeToCompany`). Count 92 ms → 7 ms, full list 90 ms → 6 ms locally; no schema change | 200 catalog responses (20 companies, list / paged / search variants) captured before and after: identical. Admin scope leak hunt 44/44, tenant isolation passed |

**Looked at and deliberately left**

| Item | What the code showed | Decision |
|---|---|---|
| Stock on hand runs 37 statements | The importer's stock valuation engine re-reads the same small sets (the item list six times, opening balances five) across its helpers | Leave. It is the valuation path the pre-push stock gate protects, and the helpers are shared with write paths that must re-read after a write. A request-scoped memo could remove ~20 statements; do it only with the valuation figures compared item by item |
| Dashboard runs 51 statements | 17 are invoice totals for different filters and periods, 7 purchase totals: distinct aggregates, not a loop | Leave. Merging them is a rewrite of every KPI; caching would show a figure that lags a posted bill |
| New Credit / Debit Note loads every invoice | Compression already took it from 9–21 s to 0.9–2.0 s (14 KB on the wire); what is left is its 9 statements | Leave unless felt slow; the fix is a new endpoint returning only eligible invoices, with its own tenant and permission cases |
| Keep-warm not yet proven | Needs the site to sit idle past the host's unload time | Leave the site untouched for an hour and open the dashboard: warm is 0.2–0.6 s per call, cold was 37.5 s for the page |

**Found while testing, not caused by this work**

- `scripts/test_mcp_parity.py` fails one check ("bill by amount: stock gave up the
  stock quantity, not the billed one") on the unchanged code as well as the
  changed code: 199/200 on both.

**Not measured**

- FBR Sandbox, Connect, the data-migration / manager-import / spreadsheet-import
  screens, Stock Reconcile and Stock Split were not opened on production: opening
  them can start work rather than only read.
- Create and edit forms, phone networks.

## What the time is made of

| Layer | Finding |
|---|---|
| Cold start | **The first page after an idle spell took 37.5 s just for the HTML.** The host unloads an idle site. |
| Script | **One bundle of 4.9 MB (2.1 MB compressed)** holding every screen, downloaded and parsed before the sign-in page could show. |
| Browser cache | **The bundle had no `Cache-Control`** (the rule's path missed `/admin`), so every load re-asked for it. |
| Payload | **API responses were not compressed.** Large ones were slow far beyond their size: the 232 KB invoice list took 9–21 s, the 43 KB catalog 2–3 s. |
| Database | Locally every endpoint takes 5–150 ms, so server work is not the bottleneck; on production each SQL statement is a round trip to the database host, which is why statement counts matter (above). |
| Duplicates | Seven list screens fetched their list twice. |
| Variance | The same call varied from 0.15 s to 0.7 s, and single calls occasionally took 8–40 s. Figures here are medians of three where possible. |

## Baseline, production, before any change

Key endpoints, three runs each, company 4:

| Endpoint | Body | Times (ms) |
|---|---:|---|
| `auth/me` | <1 KB | 691, 169, 154 |
| `companies` | 12 KB | 2146, 633, 630 |
| `clients/company/4` | 16 KB | 1328, 478, 967 |
| `printtemplates/company/4` | 9 KB | 8016, 755, 311 |
| `invoices/company/4/paged` | 26 KB | 902, 1650, 2867 |
| `invoices/company/4` (unpaged) | 232 KB | 11594, 9063, 20803 |
| `itemtypes?companyId=4` | 43 KB | 2948, 2309, 2104 |
| `stock/company/4/onhand` | 53 KB | 3498, 5137, 1974 |
| `stock/company/4/opening` | 36 KB | 914, 1558, 3547 |
| `stock/company/4/summary` | 25 KB | 924, 967, 1673 |
| `accounting/summary/company/4` | 2 KB | 933, 1652, 10061 |
| `reports/company/4/client-ledger` | 22 KB | 1619, 1280, 1913 |
| `dashboard/kpis` | 10 KB | 1162, 573, 788 |
| `roles` | 23 KB | 658, 1428, 1866 |

Static files, unauthenticated: the shell `/admin/` 0.5–0.9 s, the bundle 2.1 MB
compressed with no `Cache-Control`.

A full walk of 54 screens was also recorded; it is noisy (some responses took
20–40 s and landed on the next screen) and is kept only as evidence of the
duplicates: Invoices, Credit Notes, Debit Notes, Sales Orders, Purchase Bills and
Goods Receipts each fetched their list twice; Challans did too, seen locally.

## After, on production

Same company, same endpoints, three runs each, after the deploy. The host stays
noisy (one catalog request took 29 s on the second run).

| Endpoint | On the wire, before → after | Median before (ms) | Median after (ms) |
|---|---|---:|---:|
| `invoices/company/4` (unpaged) | 232 KB → 14 KB | 11,594 | 1,509 |
| `itemtypes?companyId=4` | 43 KB → 5 KB | 2,309 | 1,289 |
| `stock/company/4/onhand` | 53 KB → 9 KB | 3,498 | 1,293 |
| `stock/company/4/opening` | 36 KB → 4 KB | 1,558 | 520 |
| `stock/company/4/summary` | 25 KB → 3 KB | 967 | 208 |
| `accounting/summary/company/4` | 2 KB → 1 KB | 1,652 | 563 |
| `reports/company/4/client-ledger` | 22 KB → 3 KB | 1,619 | 1,088 |
| `roles` | 23 KB → 3 KB | 1,428 | 264 |
| `printtemplates/company/4` | 9 KB → 3 KB | 755 | 244 |
| `permissions/me` | 5 KB → 1 KB | 608 | 171 |
| `clients/company/4` | 16 KB → 4 KB | 967 | 941 |
| `invoices/company/4/paged` | 26 KB → 3 KB | 1,650 | 1,549 |
| `dashboard/kpis` | 10 KB → 3 KB | 788 | 749 |
| `companies` | 12 KB → 1 KB | 633 | 641 |
| `auth/me` | <1 KB | 169 | 204 |

Static files: the first-load bundle is now 302 KB on the wire (was 2.1 MB),
sent with `public, max-age=31536000, immutable`; the shell and `runtime-env.js`
are `must-revalidate, no-cache`.

Calls that were small already (sign-in check, company list, a page of invoices)
did not get faster: they are a network round trip either way. The paged invoice
list and the client ledger are still about 1–1.5 s; that is database round trips
(see "Not done"), not payload.

## Local verification

- **Compression:** 42 endpoints fetched plain, gzip and Brotli; every compressed
  body decodes to the same bytes, 25 of them compress (595 KB → 24 KB), Excel
  downloads, sign-in routes and small bodies are untouched.
- **Static headers:** bundle `public, max-age=31536000, immutable`; shell and
  `runtime-env.js` `must-revalidate, no-cache`.
- **Bundle:** sign-in page fetches 677 KB of script and makes no API call; the
  largest on-demand files are the template editor (1.1 MB) and the Excel library
  (0.9 MB), loaded only by the screens that use them.
- **Start-up:** with a saved sign-in, the screen's code, the sign-in check, the
  company list and the permissions all start within 10 ms of each other; with a
  stale sign-in the sign-in page shows the "session expired" banner and keeps the
  return path, as before.
- **Screens:** 26 screens opened in turn rendered, including the `/bills`
  redirect and an unknown path; lists load once; search and company switching
  still reload.
- **Suites:** stock gate 114/114, basic flows 92/92, further tax 37/37, bill
  pricing 109/109, customer portal 129/129, admin scope isolation, tenant
  isolation and MCP writes all passed; `scripts/perf_harness` 35/35 and
  `scripts/test_boot_prefetch.mjs` 6/6 are new.

## Risks considered

| Risk | How it is handled |
|---|---|
| Compression and secrets (BREACH) | Only `GET` under `/api`, never `/api/auth` or `/api/mcp`. |
| A stale app after a deploy | The shell and `runtime-env.js` are `no-cache`; only fingerprinted files are long-lived. A browser holding an old shell was already able to request pruned files; that is unchanged. |
| A screen that fails to load its code | The router keeps the previous screen during the download; a failed early fetch does not poison the real one (`lazyScreen`). |
| The keep-warm ping being steered elsewhere | Only the hosting platform's own domain or `KeepWarm:Host` is accepted; it asks for a static file only. |
| Caching tenant data | Nothing tenant-specific is cached anywhere. |

## How to measure again

Sign in on production in the browser, select company 4, and walk the routes
through the SPA router (`history.pushState` plus a `popstate` event), reading
`performance.getEntriesByType("resource")`. This host is noisy: time key
endpoints three times each with `fetch` rather than trusting a single walk, and
measure on production, not localhost. Navigation only; click nothing that
writes.

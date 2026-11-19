# Trader performance audit — 2026-11-20

Measured on Trader production, signed in as the primary admin, on the company
with the most data (295 invoices, 423 challans, 153 quotes, 803 stock movements,
359 journal entries). Every screen was opened through the app's own router and
the browser's resource timings were read back. Nothing was clicked that writes.

The same endpoints were then profiled on a local copy of the production data
with SQL logging on, to separate what the server does from what the network
costs.

## Status — read this first

Trader line only. Last updated 2026-11-20. A session that does more performance
work should update this section, not start a second document.

**Done and live on production**

| Change | Commit | Where |
|---|---|---|
| API reads compressed (JSON ≥ 1 KB, one write, never sign-in or agent-token routes) | `273e3681`, replaced by `0da95c86` | `Middleware/ApiCompressionMiddleware.cs`, `Program.cs` |
| Built bundle cached for a year, app shell always re-checked | `273e3681` | `Program.cs` (`spaStaticFiles`) |
| Site pings itself every 4 minutes against cold starts | `273e3681` | `Services/HostedServices/KeepWarmService.cs` |
| Purchase Bills and Goods Receipts fetch their list once | `361b087e` | the two page components |

Measured result on production, 52 screens: payload −89%, API time −25%, screen
settle time −39%. Tables are under "After, on production".

**Deployed but NOT verified**

- **Keep-warm.** Needs the site to sit idle past the host's unload time and then
  be visited. To check: leave the site untouched for an hour, open the
  dashboard, and read the API timings. Warm is about 0.15–0.25 s per call; cold
  was 3.7–10.6 s. If it is still cold, the host unloads the site regardless and
  the ping must move to an external scheduler.

**Tried and withdrawn**

- **The framework's `UseResponseCompression`.** Live for about 25 minutes on
  2026-11-20. Payload fell 89% but every single-call screen got about 170 ms
  slower (0.14 s became 0.32 s) because it sends a compressed response in more
  than one small write. Do not bring it back.

**Not done — the remaining work, largest first**

| Item | Why it is still there | What it would take |
|---|---|---|
| Print templates fetched whole on 14 list screens (15 KB compressed, one extra call each) | The picker needs names; the HTML is only needed at print time | A names-only list endpoint, HTML fetched on print |
| New Credit / Debit Note loads every invoice (76 KB compressed, 0.55–0.84 s) | The original-invoice picker is unpaged | A searchable, paged picker |
| FBR Settings loads every lookup row (265 KB compressed, 0.5–0.6 s) | The table is unpaged | Server-side paging of the lookup table |
| Two SQL statements on every request for the session and security stamp | Caching them delays a revocation; the isolation invariant forbids it | Nothing safe; leave |
| Dashboard and accounting summary run 28 and 34 statements | Each is a distinct aggregate, not an N+1; caching would show a figure that lags a posted bill | Only a rewrite that merges statements, proven figure-for-figure |
| First load is a chain of calls (sign-in check → companies and permissions → stamps → screen data) | The contexts load one after another | Loading them in parallel; touches sign-in and company selection, so it is a breaking-risk change |
| Google Fonts stylesheet blocks first paint (~0.4 s on a cold load) | Loaded from a third party | Self-host the fonts or preconnect |
| The app re-requests `/api/companies` when the tab regains focus | Seen during measurement, not investigated | Read `CompanyContext` before changing it |

**Not measured**

- Email Workspace, FBR Sandbox and Connect were not walked on production,
  because opening them can start outbound work.
- Create and edit forms (only list and report screens were timed).
- Phone networks. All figures are from one desktop connection.
- The other two production lines. Nothing here was ported to them.

**How to measure again**

Sign in on production in the browser, select the largest company, and walk the
routes through the SPA router (`history.pushState` plus a `popstate` event),
reading `performance.getEntriesByType("resource")` for `/api/` calls after each.
Walk every screen twice and keep the undisturbed pass: touching the tab during
a walk refetches the company list and inflates the figures. Measure on
production, not localhost. Localhost has no network cost, and the compression
regression above was invisible there. Navigation only; click nothing that
writes.

## What the time is made of

| Layer | Finding |
|---|---|
| Network | About 135 ms per API call before the server does anything (measured on the cheapest call, five runs: 131–137 ms). |
| Database | Queries are well shaped. No N+1 was found: the heaviest endpoints run 28–34 distinct aggregate statements, each 0–4 ms locally. On production each statement adds a round trip to the database host. |
| Payload | **API responses were not compressed.** The host compresses static files; nothing compressed what the app writes. |
| Browser cache | **No `Cache-Control` on anything.** Every load re-asked for every script and stylesheet (about 25 round trips of ~250 ms), and the browser was free to keep an old app shell by guesswork. |
| Cold start | **After an idle spell the first screen waited 3.7 s, 6.5 s, 6.5 s and 10.6 s** on calls that take 0.14–0.24 s warm. |
| Duplicates | Purchase Bills and Goods Receipts fetched their list twice on every visit. |

Server time on a same-machine database is 10–60 ms for every endpoint, so the
server's own work is not where the time goes.

## Baseline, every screen (production, warm)

`settled` is the time until the screen's network went quiet; `calls` and `KB`
are the API requests it made and their body size on the wire.

| Screen | settled ms | calls | API ms (sum) | KB | Largest call |
|---|---:|---:|---:|---:|---|
| Dashboard (first load, cold) | not timed | 5 | 27,335 | 29 | `companies` 10,558 ms |
| Dashboard (warm) | 301 | 2 | 375 | 8 | `dashboard/kpis` 237 ms |
| Bills | 2,700 | 6 | 4,104 | 148 | `printtemplates` 2,254 ms, 100 KB |
| Invoices | 614 | 7 | 1,475 | 148 | `printtemplates` 300 ms, 100 KB |
| Challans | 916 | 6 | 1,728 | 122 | `deliverychallans/paged` 488 ms |
| Sales Quotes | 801 | 5 | 990 | 132 | `salesquotes/paged` 323 ms |
| Sales Orders | 515 | 4 | 667 | 105 | `printtemplates` 233 ms, 100 KB |
| Import Challans | 400 | 3 | 427 | 10 | 155 ms |
| Credit Notes | 701 | 7 | 1,462 | 113 | `invoices/paged` 342 ms |
| Debit Notes | 303 | 6 | 1,009 | 105 | `printtemplates` 258 ms |
| New Credit / Debit Note | 1,401 | 1 | 1,132 | **1,033** | `invoices/company` (unpaged) |
| Item Rate History | 515 | 3 | 683 | 29 | 279 ms |
| Supplier Payables | 501 | 1 | 253 | 4 | 253 ms |
| Purchase Bills | 901 | 5 | 1,698 | 145 | list fetched **twice** (626 + 422 ms) |
| Purchase Debit Notes | 515 | 2 | 427 | 100 | `printtemplates` 224 ms |
| Goods Receipts | 600 | 4 | 985 | 107 | list fetched **twice** (373 + 232 ms) |
| Stock | 716 | 2 | 953 | 8 | `stock/onhand` 507 ms |
| FBR Purchase Import | 214 | 0 | 0 | 0 | — |
| Withholding Tax Receipts | 501 | 2 | 400 | 100 | `printtemplates` 221 ms |
| Bank & Cash Accounts | 600 | 4 | 1,148 | 22 | `bank-reconciliation/summary` 314 ms |
| Transfers | 1,816 | 3 | 546 | 100 | `printtemplates` 214 ms |
| Receipts | 817 | 3 | 684 | 127 | `receipts/paged` 340 ms |
| Payments | 313 | 2 | 436 | 100 | `printtemplates` 252 ms |
| Chart of Accounts | 412 | 2 | 320 | 20 | 167 ms |
| Journal Entries | 502 | 4 | 859 | 128 | 246 ms |
| Accounting Dashboard | 1,807 | 2 | 817 | 11 | `accounting/summary` 621 ms |
| Accounting Overview | 302 | 2 | 364 | 11 | 211 ms |
| Accounting Reports catalog | 206 | 0 | 0 | 0 | — |
| Accounting Reports | 510 | 1 | 188 | 1 | 188 ms |
| Customer Portals | 415 | 1 | 209 | 0 | 209 ms |
| Sales Report | 532 | 3 | 714 | 123 | 324 ms |
| Document Lines | 501 | 1 | 220 | 56 | 220 ms |
| Invoice Sales Detail | 510 | 1 | 288 | 89 | 288 ms |
| Ready for FBR | 500 | 1 | 294 | 0 | 294 ms |
| Tax Sheet | 805 | 3 | 493 | 5 | 219 ms |
| Outstanding | 517 | 2 | 435 | 51 | 299 ms |
| Item Types | 408 | 1 | 148 | 21 | 148 ms |
| Import Data | 201 | 0 | 0 | 0 | — |
| Units | 405 | 1 | 158 | 4 | 158 ms |
| PO Formats | 405 | 2 | 357 | 10 | 179 ms |
| Print Templates | 515 | 1 | 213 | 100 | 213 ms |
| Navigation Menu | 714 | 2 | 422 | 2 | 232 ms |
| FBR Settings | 3,816 | 2 | 1,774 | **3,300** | `FbrLookup` 1,512 ms, 3.2 MB |
| FBR Monitor | 510 | 2 | 445 | 18 | 233 ms |
| Users | 511 | 2 | 390 | 27 | 225 ms |
| Roles | 604 | 3 | 515 | 61 | 179 ms |
| Tenant Access | 402 | 1 | 218 | 14 | 218 ms |
| Administrators | 512 | 3 | 530 | 43 | 199 ms |
| Audit Logs | 405 | 2 | 377 | 15 | 191 ms |
| Clients | 1,201 | 2 | 473 | 6 | 290 ms |
| Profile, Companies, Suppliers | 0–404 | 0 | 0 | 0 | data already in hand |

Not walked on production, because opening them can start outbound work rather
than only read: Email Workspace, FBR Sandbox, Connect.

Three payloads stand out: print templates (100 KB, refetched on 14 screens),
the unpaged invoice list behind New Credit / Debit Note (1 MB) and the FBR
lookups behind FBR Settings (3.2 MB).

## What was changed

All four are transport or wiring changes. No query, calculation, validation,
permission or workflow was touched, and nothing that holds business data is
cached on the server.

1. **API responses are compressed** (Brotli, gzip fallback). Measured locally on
   the same data: print templates 100 KB → 15 KB, the invoice list 823 KB →
   65 KB, FBR lookups 2,451 KB → 247 KB. Bodies are byte-identical once
   decoded. JSON of 1 KB or more is compressed and sent in one write; smaller
   bodies and anything that is not JSON go out exactly as before.

   The framework's own compression middleware was deployed first and measured:
   payload fell 89%, but it sends a compressed response in more than one small
   write, and a screen making a single call waited about 170 ms longer (the
   same call measured 0.14 s before and 0.32 s after). It was replaced the same
   day by `Middleware/ApiCompressionMiddleware`, which sends each response
   whole.
2. **The built bundle is cached for a year; the app shell is always
   re-checked.** Files under `/admin/assets/` are fingerprinted by the build, so
   a changed file has a new name and the old name can never go stale.
   `index.html` and `runtime-env.js` keep their names, so they are sent
   `no-cache` and a deploy is picked up on the next load. On a reload all 53
   assets now come from the browser cache with no request at all.
3. **The site keeps itself warm.** A background service asks for one small
   static file from the site's own address every four minutes, so the host does
   not unload it and nobody meets the cold start.
4. **Purchase Bills and Goods Receipts fetch their list once.** Two effects both
   ran when the screen opened.

## Risks considered

| Risk | How it is handled |
|---|---|
| Compression and secrets (BREACH) | Only `GET` under `/api` is compressed, and never `/api/auth` or `/api/mcp`. A response that carries a token is not compressed. Auth is a bearer header, not a cookie, so a cross-site page cannot issue authenticated requests anyway. |
| Compressing downloads | PDF and Excel content types are not in the compressed set; checked on an Excel export. |
| A stale app after a deploy | The shell is `no-cache`; only fingerprinted files are long-lived. This also closes a latent fault: with no header at all, a browser could keep an old shell that points at bundle files the deploy has pruned. |
| Caching tenant data wrongly | Nothing tenant-specific is cached. The only long-lived responses are public, fingerprinted script and style files. |
| The keep-warm ping being steered elsewhere | The address is learned from a request's Host header, which the caller controls, so only the hosting platform's own domain (or a host named in `KeepWarm:Host`) is accepted. It asks for a static file: no data, no database, no audit row. Off in Development and with `KeepWarm:Enabled = false`. |
| The double-fetch fix dropping a refresh | Filters, search and paging still refetch; checked in the browser. |

## After, on production

The same walk of 52 screens, same company, after the deploy. Each screen was
walked twice; a pass was discarded for a screen when the tab was used during it
(that refetches the company list and inflates the figures).

| | Before | After | Change |
|---|---:|---:|---:|
| Payload on the wire, all screens | 6,882 KB | 729 KB | −89% |
| API time, all screens (sum) | 32.8 s | 24.4 s | −25% |
| Time until each screen's network went quiet (sum) | 35.4 s | 21.5 s | −39% |
| Screens with data that got at least 10% faster | | 26 of 46 | |
| Screens that got more than 10% slower | | 5 of 46 | all within 60 ms of before, or disturbed |

| Call | Before | After |
|---|---:|---:|
| Cheapest authenticated call | 131–137 ms | 135–143 ms |
| A small list (clients) | 138–194 ms | 135–142 ms |
| Print templates | 100 KB, 213–300 ms | 15 KB, 274–344 ms |
| Every invoice (New Credit / Debit Note) | 1,033 KB, 1,132 ms | 76 KB, 554–839 ms |
| FBR lookups (FBR Settings) | 3,300 KB, 1,512 ms | 265 KB, 525–634 ms |

| Screen | Before ms | After ms |
|---|---:|---:|
| Bills | 4,104 | 1,039 |
| Purchase Bills | 1,698 | 890 |
| Goods Receipts | 985 | 558 |
| Stock | 953 | 354 |
| FBR Settings | 1,774 | 525 |
| New Credit / Debit Note | 1,132 | 554 |
| Challans | 1,728 | 1,226 |

Asset caching is confirmed on production by its headers (bundle `immutable`,
shell `no-cache`); a reload makes no asset requests at all. Small calls did not
get faster: they are one network round trip either way.

**Not verified:** the keep-warm ping. Proving it needs the site to sit idle
past the host's unload time and then be visited; the next cold visit will show
it. If the first screen after a long idle spell is still slow, the host is
unloading the site regardless and the ping should move to an external
scheduler.

## Verification

- All 49 profiled endpoints return the same status, the same number of SQL
  statements and the same body size before and after; only the encoding differs.
- Stock reflow gate 257/257, basic flows 192/192, tenant leak sweep 123/123,
  tenant isolation, MCP documents 106/106, further tax 34/34 and 24, route
  permissions 187, tenant scope and production-identifier checks all pass.
- `KeepWarmOriginTests` (9 cases) pins which hosts the ping may go to.

## Left alone on purpose, and what would be next

- **Per-request sign-in checks** (two statements on every call: the session and
  the security stamp). Caching them would delay a revocation, which the
  isolation rule forbids.
- **Dashboard and accounting summaries** (28 and 34 statements). They could be
  cached, but a figure that lags a posted bill is a wrong figure.
- **New Credit / Debit Note loads every invoice** to offer the original. Now
  65 KB compressed; a searchable, paged picker would remove it.
- **FBR Settings loads every lookup row.** Now 247 KB compressed; paging the
  table would remove it.
- **Print templates are fetched whole on 14 list screens** to fill the template
  picker. Now 15 KB compressed; a names-only list would remove the rest.

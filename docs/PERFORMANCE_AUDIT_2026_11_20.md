# Trader performance audit — 2026-11-20

Measured on Trader production, signed in as the primary admin, on the company
with the most data (295 invoices, 423 challans, 153 quotes, 803 stock movements,
359 journal entries). Every screen was opened through the app's own router and
the browser's resource timings were read back. Nothing was clicked that writes.

The same endpoints were then profiled on a local copy of the production data
with SQL logging on, to separate what the server does from what the network
costs.

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
   decoded.
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

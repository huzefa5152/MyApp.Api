# Customize line — list performance and challan PO search

Record of the 2026-11-19/20 investigation and fix on `customize-solution-for-other`:
what was measured, what shipped, what was tried and rejected, and what is still
open. Read this before touching a list query on this line.

Shipped in `92f91f81` (paging + indexes), `c220071f` (search), `726ababd`
(changelog), after the formatting-only commits `f0524aaa` and `934c6ddc`.

## The cause, as production showed it

The data is small (about 2,800 challans, 2,600 invoices, 250 sales orders), so
size was never the problem. Most queries ran in tens of milliseconds. The slow
screens were queries **waiting for a memory grant** before they could start
(Query Store wait category "Memory", i.e. `RESOURCE_SEMAPHORE`).

| Query | Memory asked for | Waited in 7 days | Worst single wait |
|---|---|---|---|
| Sales order list (Sales Orders page and the SO dropdown on challan / bill forms) | ~2.9 GB | 69 s | 25.0 s |
| Item description autocomplete | small | 26 s | 10.2 s (queued behind the above) |
| Challan list items | 14 MB | 7.4 s | 7.4 s |
| Invoice / bill list | ~190 MB | | |
| Purchase bill list | ~29 MB | | |

The database is on a **shared SQL Server**: grant memory is shared with other
customers' databases. One query asking for gigabytes queues, and everything
behind it queues too, so one bad query made every screen slow, in bursts.

Why the grants were huge:

- SQL Server sizes a sort from each column's declared width and treats
  `nvarchar(max)` as large. `Companies` has 17 such columns (a joined row was
  estimated at ~68 KB), `Invoices` 13, `Clients` 9, `Divisions` 8. A joined
  sales-order row was estimated at ~166 KB.
- The lists sorted whole joined rows (`OFFSET/FETCH` over includes). EF sends
  `OFFSET @p ROWS FETCH NEXT @p ROWS` as **parameters**, so the optimizer has no
  row limit: Query Store's sales-order plan was compiled for company 1, page
  size 10, and still asked for 2.9 GB. The same query with the page size
  written in literally asks for about 100 KB.
- No index matched the lists' order (`CreatedAt DESC, Id DESC` for challans and
  invoices; the number indexes start `(CompanyId, DivisionId, …)` and cannot
  serve an order across divisions).

## Delivery challan PO search

The PO query itself was fast (about 31 ms). What broke it:

1. One full list request per keystroke (no debounce).
2. No stale-reply guard. Ten overlapping searches for `1` … `1040313608`
   (company 6, the PO users) came back in the order 5, 4, 7, 3, 9, 8, 6, 2, 10, 1;
   the last reply was the one-character search, so the screen showed **148**
   challans for a PO that matches **3**.

## What shipped

**Paging by id** (`Helpers/PageById.cs`), used by the Sales Orders, Bills /
Invoices and Delivery Challans paged lists:

1. Count with the caller's filters.
2. Sort and page **only the ids** (narrow, served by the new indexes).
3. Load the page's rows by id as a **split** query with `TOP(n)` written into
   the SQL (`EF.Constant`), so the optimizer knows the row limit.
4. Restore the id order in memory.

Same filters, same ORDER BY, same includes, so the same rows in the same order.
Supporting changes:

- Collections in those paged loads are included with `.OrderBy(x => x.Id)`
  (challan lines, the challan's bill lines, invoice lines and challans,
  sales-order lines). A split query does not order a collection by itself; the
  old queries happened to return them in id order, and two invoices showed their
  challans in a different order until this was pinned.
- The sales-order list uses `ListIncludes()` without `Company` (the list never
  reads it) and loads the page's `SalesQuote`s afterwards with one small query.
  The orders are tracked, so that fills `order.SalesQuote` exactly as the
  include did. The quote join was the one production misestimated (3,222 rows
  for a page of 100).
- Migration `20261119211040_AddListOrderIndexes` adds `IX_DeliveryChallans_List`
  and `IX_Invoices_List` on `(CompanyId, IsDemo, CreatedAt, Id)`,
  `IX_SalesOrders_List (CompanyId, SalesOrderNumber, Id)`,
  `IX_SalesQuotes_List (CompanyId, QuoteNumber, Id)` and
  `IX_PurchaseBills_List (CompanyId, PurchaseBillNumber)`.

**Search** (`hooks/useDebouncedValue.js`): Challans, Bills / Invoices, Sales
Orders, Quotes, Purchase Bills and Goods Receipts search once typing pauses for
350 ms, and each fetch carries a request counter so only the newest reply may
update the list or clear its loading state.

### Results on production after the deploy

| | Before | After |
|---|---|---|
| Largest memory a list plan asks for | 2.9 GB, queued up to 25 s | 1.3 MB |
| SO dropdown when opening Delivery Challans | 20.4 s at the worst moment | 0.4–0.5 s |
| Company 4 lists (quiet server) | 0.3–1 s | 0.3–1 s |
| Typing a 10-character PO | 10 requests, wrong final list possible | 1 request, correct list |

### How it was verified

- **Identical output:** old and new builds ran side by side on the same local
  copy of the data and answered 690 list requests (5 companies × 8 lists ×
  pages, page sizes, searches, filters, note types) byte for byte the same, in
  two consecutive runs.
- **Production estimates without running anything:** each new statement was
  compiled on production under `SET SHOWPLAN_XML ON` (compiles, never executes)
  with real ids, and its `SerialDesiredMemory` read from the plan. That is how
  the rejected approaches below were caught; a local SQL Server sizes these
  plans differently and cannot reproduce the gigabyte estimates.
- Suites: stock reflow 76/76, basic flows 112/112, admin scope isolation
  165/165, frontend tests 44/44. `test_tenant_isolation.py` fails one Email
  Workspace check (`POST messages/0/reextract` → 405, expects 403) on the old
  build as well: that route does not exist on this line.

## Tried and rejected — do not repeat without new evidence

| Approach | Production estimate | Why rejected |
|---|---|---|
| Ids-first, page loaded as **one joined query** with an `IN` list | 3.2 GB (sales orders) | EF orders a joined collection load by every table's key; with the misestimated joins the sort is enormous. |
| Split load with ids as a JSON parameter, no row limit | 430 MB + 101 MB (sales orders) | No row cap: production estimated 3,222 rows. Fixed by `TOP(n)` and dropping the quote join. |
| Ids written as literals in the SQL | same estimate as above, and a fresh compile per page | Literal ids did not fix the estimate and cost ~40–60 ms of compile time per page locally. |
| Ids-first paging for **purchase bills** with the whole source chain included | 72 MB at page size 10 (old plan: 29 MB) | Worse at the default size. Solved in round 2 by loading the sources separately (below). |
| Ids-first for quotes, goods receipts, payments | no gain (old plans already ≤ 2.3 MB) | Reverted to keep the change small. They still get the indexes and the search fix. |
| New `GET /salesorders/company/{id}/picker` endpoint | — | Not needed: fixing the paged list fixed the dropdown, without a new API surface to guard. |

## Round 2 (2026-11-20): the remaining items

Shipped after the first round, with the same verification (old and new builds
side by side, production estimates under SHOWPLAN, the suites):

1. **Purchase bill list** (`PurchaseBillService.GetPagedByCompanyAsync`): paged
   by id with only Supplier, lines (in id order) and Division; the page's line
   sources and their chain (order / challan / bill and client) are loaded
   afterwards in one query with no sort, and each line's sources are put back in
   id order. The bills are tracked, so the navigation properties fill exactly as
   the include did. Production estimate: ≤ 1.8 MB, was 29 MB (10 rows) and
   182 MB (100 rows).
2. **"Purchased / Partial" label on challan cards**
   (`DeliveryChallanService.MarkAutoPurchaseBillsAsync`):
   - `CustomerDemand.LoadAsync(companyId, onlyChallans)` loads only what the
     trails through the page's purchased challans hold: their order lines, every
     live challan line on those orders, the bill lines linked to any of them, and
     the challan lines those bills point at, so "a bill joins its challan's
     trail" still holds. The trails are built by the same code; with no scope
     (every other caller) the queries are unchanged.
   - `ChallanPurchases.ChallanIds(db, among)` applies the page's challan ids
     inside both halves of the union instead of computing every purchase in the
     installation and filtering afterwards. Other callers use the unscoped form.
   - Verified: labels identical for 17 purchased challans (both labels) across
     every page of every company, including the `test_purchase_demand.py`
     fixtures; that suite passes 49/49 on both builds.
3. **"Setup Required" re-check** (`GetSetupRequiredChallansAsync`): an
   existence check first; the company / client join runs only when such
   challans exist. Behaviour unchanged (it still runs on every load).
4. **Sales Orders, Purchase Bills and Goods Receipts pages** fetched page 1
   twice on open; their filter effect now skips its first run, as
   `ChallanPage` already did.
5. **Challan search**: `LOWER()` dropped from the searched columns. All four are
   `SQL_Latin1_General_CP1_CI_AS` on production and locally, so `LIKE` already
   ignored case; the id step's estimate went from ~16 MB to ≤ 2.3 MB.

After round 2 the largest memory any of these list statements asks production
for is 3.3 MB, the existing company-wide "already bought" query
(`CustomerDemand.LoadBoughtAsync`), which was not changed.

## Still open

- Every API call costs ~180–250 ms on the host even when trivial, and a screen
  opens 5–7 calls. App-pool cold starts after idle add seconds to the first
  request. These are hosting matters, not query plans: a keep-warm ping would
  need a scheduled job (a deployment pipeline change), and fewer calls per
  screen would mean merging endpoints. Neither was done.
- `CustomerDemand.LoadBoughtAsync` still reads the company's purchase sources
  (~3 MB estimate); scoping it like `LoadAsync` is possible if it ever grows.

## How to measure again

- **Query Store** (read-only, works on the shared host; server DMVs do not):
  `sys.query_store_runtime_stats` for duration, `sys.query_store_wait_stats`
  filtered to `wait_category_desc = 'Memory'` for grant queueing, and
  `//MemoryGrantInfo/@SerialDesiredMemory` from `sys.query_store_plan.query_plan`
  for what a plan asks for. Plans compiled after a deploy:
  `last_compile_start_time` later than the deploy.
- **Estimate a new query on production without running it:** `SET
  SHOWPLAN_XML ON`, then the statement with its parameter values written in.
  Capture the statement EF sends from a local run's plan cache
  (`sys.dm_exec_query_stats` + `sys.dm_exec_sql_text`). `sp_executesql` under
  SHOWPLAN does not compile the inner statement, so inline the values instead.
- **Browser:** the Resource Timing data of a signed-in tab gives each call's
  server wait and size when a screen opens; overlapping `fetch` calls show reply
  ordering.
- Production database access is read-only (`production.databases.json`);
  never name the database or host in a tracked file.

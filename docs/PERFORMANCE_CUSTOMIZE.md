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
| Ids-first paging for **purchase bills** | 72 MB at page size 10 (old plan: 29 MB) | Worse at the default page size. Purchase bills keep their original query. |
| Ids-first for quotes, goods receipts, payments | no gain (old plans already ≤ 2.3 MB) | Reverted to keep the change small. They still get the indexes and the search fix. |
| New `GET /salesorders/company/{id}/picker` endpoint | — | Not needed: fixing the paged list fixed the dropdown, without a new API surface to guard. |

## Still open

1. **Purchase bill list** (old plan ~29 MB at 10 rows, ~182 MB at 100). Its
   includes go deep (items → sources → sales order / challan / invoice →
   client). A narrower list projection would be the next step; measure with the
   SHOWPLAN method first.
2. **"Purchased / Partial" label on challan cards**
   (`DeliveryChallanService.MarkAutoPurchaseBillsAsync`): when any card is
   auto-purchased it loads the company's whole demand history
   (`CustomerDemand.LoadAsync`) for 10 cards, and runs a UNION over all purchase
   bills (~6,500 reads) on every load. Deferred because it touches costing; any
   change must keep the same labels (`test_cost_purchase_sync.py`, commercial
   cost suites).
3. **Challan list re-evaluates "Setup Required" on every load**
   (`ReEvaluateSetupRequiredAsync`) and may write status changes during a GET.
   Cheap today; moving it would change when statuses update.
4. **The Sales Orders page requests page 1 twice on open** (frontend effect
   order). Harmless now, but a wasted call.
5. **Challan search's id step** asks for ~16 MB with a search term (the
   `LOWER(…) LIKE '%term%'` over lines and item types). Dropping `LOWER()` is
   safe (the column collation is `SQL_Latin1_General_CP1_CI_AS`) but gains
   little, because `LIKE '%x%'` cannot use an index either way.
6. Every API call costs ~180–250 ms on the host even when trivial, and a screen
   opens 5–7 calls. App-pool cold starts after idle add seconds to the first
   request; Query Store cannot see web-server time.

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

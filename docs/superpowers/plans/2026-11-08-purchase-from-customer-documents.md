# Purchases for Customer Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One purchase flow that buys sales order, challan and sale bill lines as one demand ("trail"), so the same goods are never bought twice, with a simpler Purchase Bills screen.

**Architecture:** A new `PurchaseItemSources` table links each purchase row to the exact customer-document lines it buys, with a quantity per link. A scoped `CustomerDemandService` resolves trails (sales order line → challan lines → sale bill lines), computes Ordered / Delivered / Billed / Bought / Left, locks trail roots on save, and answers "is this line bought" for the document guards. The frontend replaces three pickers with one `CustomerDemandPicker` and trims the page to one create button and a row menu.

**Tech Stack:** .NET 9, EF Core 9, SQL Server, React 19 + Vite, Python test scripts (`scripts/test_basic_flows.http`).

**Spec:** `docs/superpowers/specs/2026-11-08-purchase-from-customer-documents-design.md`

## Global Constraints

- Branch `customize-multi-challan-purchase` (customize line). Commit locally per task; **never push**; never port to other lines.
- Commit identity `45231321+huzefa5152@users.noreply.github.com`; **no `Co-Authored-By` or AI trailer** (personal project). Imperative subjects ≤ 72 chars. Stage explicit paths: `git commit -F <msg> -- <paths>`; read `git diff --stat` first.
- Never restart the user's backend on 5134. Use 5136 (terminal tab c25) and stop/restart it yourself when a build is locked.
- Tests run against a local `MyApp_Customize_*` database only. Production is read-only; never name a production host or database in a tracked file.
- Customize has not had the one-time reformat: Prettier / `dotnet format` only the lines you write; never reformat a whole existing file inside a feature commit.
- Every new action: `[HasPermission]` + `[AuthorizeCompany]` + `ICompanyAccessGuard.AssertAccessAsync`; division scope via the controller's existing `GetDivisionScopeAsync` pattern. A body or query id is a request, never proof.
- Errors to the client are operator messages; the "line not found" message is exactly `A customer document line on this bill was not found.` for every foreign/missing/cancelled-company case.
- Over-buy message shape: `Order #12 → DC #101: only 40 Pcs of Bolt left to buy.` (trail numbers that exist, joined by ` → `; `SO`/`DC`/`Bill` prefixes in tags, `Order`/`DC`/`Bill` in messages).
- Quantities `decimal(28,12)`; money stays 2dp.
- UI: 375 / 768 / 1280, no horizontal page scroll; `formStyles` modals; icon buttons `display:grid; placeItems:center; padding:0; boxShadow:none`; tap targets ≥ 44 px; a control the user cannot use does not render.
- Frontend deploy after each frontend task: `npm run build` (Node 20: prefix PATH with `/c/Users/hussahuz/AppData/Local/nvm/v20.20.2`), revert `src/generated/product-manifest.json`, copy `dist/*` to `wwwroot/` and `wwwroot/admin/`.

## Review Focus

1. **A sales order line's quantity is lowered, or the line removed, after part of it was bought** — refused with "only N bought…" wording; covered by Task 4 `order_qty_below_bought_refused`.
2. **A bought sale bill line disappears through a side path** (remove a challan from the bill, partial-billing leave-out, bill delete or cancel) — refused, never a 500 from the NoAction FK; Task 4 `bill_remove_challan_with_bought_line_refused`, `bill_delete_with_bought_line_refused`.
3. **The same trail added twice in one form session through two groupings** (once under its order, once under its bill) — the picker subtracts what the form already holds per trail key, and the server refuses a second row for the trail; Task 3 `same_trail_two_rows_refused`, Task 6 manual check.
4. **Inconsistent chain data**: a bill line whose `SalesOrderItemId` and whose challan line's `SalesOrderItemId` differ — the root is taken from the challan line first, so it is never counted in two trails; Task 2 `trail_root_prefers_challan_order_link`.
5. **Combine with different unit costs or a fractional quantity on a whole-number unit** — combine merges only same item + unit + cost; the existing quantity validation still refuses fractions; Task 3 `combined_row_sources_must_sum`, Task 6 manual check.

---

### Task 1: `PurchaseItemSources` storage and migration

**Files:**
- Create: `Models/PurchaseItemSource.cs`
- Modify: `Models/PurchaseItem.cs` (remove `SourceDeliveryItemId` / `SourceDeliveryItem`; add `ICollection<PurchaseItemSource> Sources`)
- Modify: `Data/AppDbContext.cs:807-809` (replace the `SourceDeliveryItem` mapping), `DbSet<PurchaseItemSource> PurchaseItemSources`
- Delete: `Migrations/20261107164946_LinkPurchaseLinesToChallanLines.cs` + `.Designer.cs`; revert its `AppDbContextModelSnapshot.cs` hunk
- Create: `Migrations/<timestamp>_AddPurchaseItemSources.cs` (scaffolded)
- Create: `scripts/test_purchase_demand.py` (suite 1 only)

**Interfaces:**
- Produces: entity `PurchaseItemSource { int Id; int PurchaseItemId; int? SalesOrderItemId; int? DeliveryItemId; int? InvoiceItemId; decimal Quantity; nav PurchaseItem, SalesOrderItem?, DeliveryItem?, InvoiceItem? }`; `PurchaseItem.Sources`; `AppDbContext.PurchaseItemSources`.

- [ ] **Step 1: Roll the local DB back past the unpushed migration**
  Stop the 5136 backend. Run `dotnet ef database update <migration before 20261107164946> --connection "<MyApp_Customize_Local conn>"` (local only). Expected: `Done.` and the `SourceDeliveryItemId` column gone (`sqlcmd -Q "SELECT COL_LENGTH('PurchaseItems','SourceDeliveryItemId')"` → NULL).

- [ ] **Step 2: Model + mapping**
  `PurchaseItemSource` as above. Mapping: cascade from `PurchaseItem`; `NoAction` to the three line tables; `Quantity` precision (28,12); indexes on each of the four FK columns; check constraint `CK_PurchaseItemSources_OneLine`:
  ```sql
  (CASE WHEN SalesOrderItemId IS NULL THEN 0 ELSE 1 END
 + CASE WHEN DeliveryItemId   IS NULL THEN 0 ELSE 1 END
 + CASE WHEN InvoiceItemId    IS NULL THEN 0 ELSE 1 END) = 1
  ```

- [ ] **Step 3: Scaffold `AddPurchaseItemSources`, then append the legacy copy to `Up`**
  ```sql
  INSERT INTO PurchaseItemSources (PurchaseItemId, InvoiceItemId, Quantity)
  SELECT sl.PurchaseItemId, sl.InvoiceItemId,
         CAST(pi.Quantity * ii.Quantity / NULLIF(t.Total, 0) AS decimal(28,12))
  FROM PurchaseItemSourceLines sl
  JOIN PurchaseItems pi ON pi.Id = sl.PurchaseItemId
  JOIN InvoiceItems ii ON ii.Id = sl.InvoiceItemId
  JOIN (SELECT s.PurchaseItemId, SUM(i.Quantity) AS Total
        FROM PurchaseItemSourceLines s JOIN InvoiceItems i ON i.Id = s.InvoiceItemId
        GROUP BY s.PurchaseItemId) t ON t.PurchaseItemId = sl.PurchaseItemId
  WHERE t.Total > 0;
  ```
  `Down` drops the table only. `PurchaseItemSourceLines` is not touched.

- [ ] **Step 4: Write suite 1 of `scripts/test_purchase_demand.py`**
  Args `--base`, `--db` (local only; assert host is localhost). Suite 1 `legacy_copy_is_proportional`: via `sqlcmd` against `--db`, for every `PurchaseItemId` in `PurchaseItemSourceLines`, `SUM(PurchaseItemSources.Quantity)` equals `PurchaseItems.Quantity` within 0.0001 (`SELECT COUNT(*) …` mismatches → 0). Prints `PASS …`, ends with `N/N purchase demand checks passed`.

- [ ] **Step 5: Build, apply, test**
  `dotnet build MyApp.Api.csproj` → `0 Error(s)`. Start 5136 (applies the migration). `python scripts/test_purchase_demand.py --base http://localhost:5136 --db MyApp_Customize_Local` → suite 1 passes.
  Note: code that still reads `SourceDeliveryItemId` must compile — temporarily point those reads at `Sources` (`i.Sources.Any(s => s.DeliveryItemId != null)`) so the build passes; Task 3 replaces them properly.

- [ ] **Step 6: Commit** — `Add purchase item sources table` (model, context, migration, snapshot, removed old migration, script).

---

### Task 2: `CustomerDemandService` and the awaiting-lines read

**Files:**
- Create: `Services/Interfaces/ICustomerDemandService.cs`, `Services/Implementations/CustomerDemandService.cs`
- Create: `DTOs/CustomerDemandDto.cs`
- Modify: `Program.cs` (register scoped service)
- Modify: `Controllers/PurchaseBillsController.cs` (add `GET company/{companyId}/awaiting-lines`; remove `open-challan-lines`)
- Modify: `Services/Interfaces/IPurchaseBillService.cs`, `Services/Implementations/PurchaseBillService.cs` (remove `GetOpenChallanLinesAsync`)
- Delete: `Helpers/ChallanPurchases.cs` (its `Delivered()` moves into the service; callers move in Task 4)
- Test: `scripts/test_purchase_demand.py` suites 2–3

**Interfaces:**
- Consumes: `PurchaseItemSources` (Task 1).
- Produces:
  ```csharp
  public enum DemandKind { Order, Challan, Bill }
  public sealed record DemandRef(DemandKind Kind, int LineId);
  public sealed class DemandTrail {
      public string Key;                       // "o:{soItemId}" | "c:{deliveryItemId}" | "b:{invoiceItemId}" — the ROOT
      public int? SalesOrderItemId; public List<int> DeliveryItemIds; public List<int> InvoiceItemIds;
      public decimal Ordered, Delivered, Billed, Bought;
      public decimal ToBuy => Math.Max(Ordered, Math.Max(Delivered, Billed));
      public decimal Left => ToBuy - Bought;
      public List<DemandTagDto> Tags;          // SO / DC / Bill numbers + client, oldest stage first
      public string Description, Unit; public int? ItemTypeId, NonInventoryItemId; public string? ItemTypeName;
      public int? PlannedSupplierId; public string? PlannedSupplierName; public decimal? Cost;
  }
  Task<List<DemandTrail>> LoadOpenTrailsAsync(int companyId, HashSet<int>? allowedDivisionIds, int? excludeBillId);
  Task<Dictionary<DemandRef, DemandTrail>> ResolveAsync(int companyId, IReadOnlyCollection<DemandRef> refs, int? excludeBillId, bool lockRoots);
  Task<Dictionary<int, decimal>> BoughtByLineAsync(DemandKind kind, IReadOnlyCollection<int> lineIds); // trail Bought per member line
  IQueryable<int> PurchasedChallanIds();   // replaces ChallanPurchases.ChallanIds
  Task<List<AwaitingCardDto>> GetAwaitingLinesAsync(int companyId, AwaitingLinesQuery q, HashSet<int>? allowedDivisionIds, ISet<DemandKind> viewableKinds);
  ```
  DTOs: `DemandTagDto { string Kind; int DocumentId; int Number; string ClientName }`; `AwaitingLinesQuery { int? SupplierId; bool AllSuppliers; string? Search; string GroupBy = "latest"; int? ExcludeBillId; string? ForKind; int? ForId }`; `AwaitingCardDto { string Kind; int? DocumentId; int? Number; string Title; string ClientName; DateTime? Date; string? PoNumber; List<DemandTagDto> From; List<AwaitingLineDto> Lines }`; `AwaitingLineDto { string Kind; int LineId; string TrailKey; string Stage; string Description; int? ItemTypeId; string? ItemTypeName; int? NonInventoryItemId; string Unit; decimal Ordered, Delivered, Billed, Bought, Left; decimal? Cost; int? PlannedSupplierId; string? PlannedSupplierName; List<DemandTagDto> Trail }`.

**Trail rules (algorithm the signatures do not determine):**
- Company-scoped projections (ids + quantities only), one query per table: sales order items (order not cancelled → `Ordered = Quantity`; cancelled → 0), delivery items (challan `Status != "Cancelled"`, quantity `DeliveredQuantity ?? Quantity`), invoice items (`!IsCancelled && !IsDemo && DocumentType not in (9,10)`).
- Root: invoice item → its delivery item's root if `DeliveryItemId` set; else its `SalesOrderItemId`; else itself. Delivery item → its `SalesOrderItemId` if set; else itself. (Challan link wins over the bill's own order link.)
- Bought: `PurchaseItemSources` on any member, `PurchaseItem.PurchaseBillId != excludeBillId`; plus legacy: a purchase bill with `SourceDeliveryChallanId` and no `Sources` rows marks every member delivery item of that challan as fully bought (Bought += that line's delivered qty).
- Planned supplier / cost: from the first member challan line with `SupplierId` / `ActualUnitCost`.
- `lockRoots`: `SELECT Id FROM {table} WITH (UPDLOCK, HOLDLOCK) WHERE Id IN (...)` on each root table before loading.
- `// ponytail: loads a company's line projections into memory; push the trail grouping into SQL if a company passes ~100k lines.`
- Grouping: `latest` → card = newest stage document (bill > challan > order); `order` → card = sales order, else "No sales order"; `bill` → card = sale bill, else "Not billed yet". Line `Kind/LineId` = the member line of the card's stage (root line for the "No…/Not…" cards). Only trails with `Left > 0`; trails whose card kind is not in `viewableKinds` are dropped and `Trail` tags of non-viewable kinds removed. Supplier filter as in the spec. Search matches any tag number (as text), client, PO, description. `ForKind/ForId` keeps trails having that document. Newest 100 cards.

- [ ] **Step 1: Write failing suites 2–3**
  Fixture (fresh `[TEMP]` company per run): order SO1 (Bolt 100, Nut 10); challan DC1 from SO1 delivering Bolt 60; bill B1 from DC1; standalone challan DC2 (Washer 5); standalone bill B2 (Pin 3).
  Suite 2 `awaiting_lines`:
  - `trail_shown_once_per_grouping`: for each `groupBy` in latest/order/bill, the Bolt trail key appears exactly once.
  - `latest_card_is_newest_stage`: latest → Bolt sits on a `bill` card for B1; Washer on a `challan` card; Pin on a `bill` card; Nut on an `order` card.
  - `quantities`: Bolt `ordered==100, delivered==60, billed==60, bought==0, left==100`.
  - `group_by_order_has_no_order_card`: groupBy=order → a card titled `No sales order` holds Washer and Pin.
  - `for_filter`: `forKind=order&forId=SO1` returns only SO1's trails.
  - `trail_root_prefers_challan_order_link`: a bill line whose `SalesOrderItemId` points at Nut but whose `DeliveryItemId` is the Bolt challan line (set via `--db` sqlcmd) counts only in the Bolt trail.
  Suite 3 `awaiting_lines_access`: other-company id → 403; non-admin assigned only to another company → 403; `excludeBillId` of another company → 404; a role without `invoices.list.view` sees no `bill` cards.

- [ ] **Step 2: Run** `python scripts/test_purchase_demand.py --base http://localhost:5136 --db MyApp_Customize_Local` → suites 2–3 FAIL (404 on the route).

- [ ] **Step 3: Implement service, DTOs, registration, controller action**
  Action permissions: `[HasPermission("purchasebills.manage.create")]` + `[HasAnyPermission("salesorders.list.view","challans.list.view","invoices.list.view")]`, `[AuthorizeCompany]`, `AssertAccessAsync`; `viewableKinds` built from the caller's permissions.

- [ ] **Step 4: Run** suites 1–3 → PASS. `dotnet build` → `0 Error(s)`.

- [ ] **Step 5: Commit** — `Add customer demand trails and awaiting-lines read`.

---

### Task 3: Purchase bill writes through sources

**Files:**
- Modify: `DTOs/PurchaseBillDto.cs` (item DTOs: add `List<PurchaseItemSourceDto> Sources`; remove `SourceInvoiceItemIds`, `SourceDeliveryItemId`, `SourceChallanId/Number`, `SourceClientName`; response item gets `List<DemandTagDto> Tags`; bill gets `List<DemandTagDto> ForDocuments` replacing `LinkedChallans`)
- Modify: `Services/Implementations/PurchaseBillService.cs` (`ToDto`, includes, `fromChallan` filter → `forCustomerDocuments`, `CreateAsync`, `UpdateAsync`, whole-challan auto create/preview, delete `LinkChallanLinesAsync` / `AssertChallanLinesUnique` / `AssertNoLinePurchasesAsync` / the sale-bill `SourceLines` write at ~:484-500)
- Modify: `Controllers/PurchaseBillsController.cs` (`AssertChallanLineDivisionsAsync` → `AssertSourceDivisionsAsync` over all three kinds; paged query param `forCustomerDocuments`)
- Test: `scripts/test_purchase_demand.py` suites 4–6

**Interfaces:**
- Consumes: `ICustomerDemandService.ResolveAsync(..., lockRoots: true)`.
- Produces: `PurchaseItemSourceDto { string Kind; int LineId; decimal Quantity }` (`Kind` ∈ `order|challan|bill`); `PurchaseItemDto.Tags`; `PurchaseBillDto.ForDocuments`; paged filter `forCustomerDocuments=true|false`.

**Save rules (in one private `ApplySourcesAsync(int companyId, int supplierId, List<(PurchaseItem item, List<PurchaseItemSourceDto> sources, decimal unitPrice)> rows, int? excludeBillId)` inside the existing transaction, before totals):**
- Every source resolves inside the company and its document is live, else `A customer document line on this bill was not found.`
- A row with sources: `sum(sources.Quantity) == item.Quantity` (±0.0001), else `The quantities taken from customer documents must add up to the row's quantity.`
- A trail key may appear in only one row of the bill, else `"{description}" is on this bill twice for the same customer line.`
- Per trail: sum claimed on this bill ≤ `Left` (with `excludeBillId`), else the over-buy message (Global Constraints).
- Backfill member challan lines with no `SupplierId` / `ActualUnitCost` from the bill's supplier and the row's unit price.
- Whole-challan "Create purchase bills": each created item gets one `DeliveryItemId` source for the line's `Left`; lines with `Left <= 0` are skipped; nothing left → `This challan has nothing left to purchase.`

- [ ] **Step 1: Write failing suites 4–6** (same fixture as Task 2, extended)
  Suite 4 `buy_consumes_trail`:
  - `buy_order_line_consumes_challan_and_bill`: bill with source `order:SO1.Bolt qty 100` → 201; awaiting-lines has no Bolt trail under any grouping; DC1/B1 lines gone.
  - `partial_buy_leaves_rest_everywhere`: after deleting that bill, buy `bill:B1.Bolt qty 40` → Bolt shows `left==60` under latest/order/bill.
  - `combined_row`: one row qty 8 with sources `challan:DC2.Washer 5` + `bill:B2.Pin 3` → 201; response row `Tags` lists DC2 and B2; both trails gone.
  - `create_purchase_bills_buys_only_left`: challan from SO2 with a line bought 30 of 50 via the order → whole-challan create makes an item of qty 20.
  Suite 5 `refusals`:
  - `over_buy_refused`: `order:SO1.Bolt qty 61` after 40 bought → 400, message contains `only 60` and `Order #` and `DC #`.
  - `same_trail_two_rows_refused`: rows `order:SO1.Bolt 1` and `bill:B1.Bolt 1` → 400 contains `twice`.
  - `combined_row_sources_must_sum`: row qty 5 with sources summing 4 → 400 contains `add up`.
  - `foreign_line_refused`: another company's challan line id → 400 exactly `A customer document line on this bill was not found.`
  - `cancelled_document_refused`: cancelled challan's line → same message.
  - `edit_keeps_own_claim`: edit the 40-qty bill to 100 → 200; to 101 → 400.
  - `simultaneous_bills`: two parallel creates for the last 60 → codes `[201, 400]`.
  Suite 6 `lists`: paged `forCustomerDocuments=true` includes the bills above, `false` includes a bill with no sources; `ForDocuments` on a bill lists each customer document once.

- [ ] **Step 2: Run** → suites 4–6 FAIL.
- [ ] **Step 3: Implement** the DTO changes, `ApplySourcesAsync`, auto-create change, division assert, list filter, `ToDto` tags.
- [ ] **Step 4: Run** suites 1–6 → PASS; `python scripts/test_challan_supplier_purchase_preview.py --base http://localhost:5136 --customize` → `27/27`.
- [ ] **Step 5: Commit** — `Record purchase lines against customer document trails`.

---

### Task 4: Document guards for bought lines

**Files:**
- Modify: `Services/Implementations/DeliveryChallanService.cs` (all `ChallanPurchases.*` → `_demand.PurchasedChallanIds()`), `InvoiceService.Challans.cs`, `InvoiceService.PartialBilling.cs` (same)
- Modify: `Services/Implementations/SalesOrderService.cs` (`UpdateAsync` item removal ~:584 and quantity decrease; `SetStatusAsync` → `Cancelled`; `DeleteAsync`)
- Modify: `Services/Implementations/InvoiceService.cs` (`UpdateAsync` removal ~:1526 and quantity decrease; `DeleteAsync` ~:2586; `CancelAsync` ~:2684), `InvoiceService.Challans.cs:211` (remove challan from bill), `InvoiceService.PartialBilling.cs:60` (leave-out)
- Modify: `Services/Implementations/ClientService.cs:740`, `CompanyService.cs:417,485-491`, `SupplierService.cs:338` (hard deletes clear `PurchaseItemSources` rows for the lines/items being deleted, replacing the `SourceDeliveryItemId` / `PurchaseItemSourceLines` cleanup)
- Test: `scripts/test_purchase_demand.py` suite 7

**Interfaces:**
- Consumes: `BoughtByLineAsync`, `PurchasedChallanIds()`.
- Produces: refusal messages — `Order #{n} has purchased lines and cannot be cancelled.`, `"{description}" has {bought} {unit} purchased; it cannot go below that.`, `"{description}" has been purchased and cannot be removed.`, `Bill #{n} has purchased lines and cannot be deleted or cancelled.`

- [ ] **Step 1: Write failing suite 7 `guards`** (fixture: Bolt 40 bought via `bill:B1.Bolt`)
  - `order_qty_below_bought_refused`: SO1 Bolt qty 100 → 30 → 400; → 50 → 200.
  - `order_line_remove_refused`, `order_cancel_refused`, `order_delete_refused` → 400.
  - `challan_cancel_refused` (DC1, bought via the bill) → 400.
  - `bill_qty_below_bought_refused`: B1 Bolt → 30 → 400.
  - `bill_remove_challan_with_bought_line_refused` → 400 (not 500).
  - `bill_delete_with_bought_line_refused`, `bill_cancel_refused` → 400.
  - `guards_release_after_purchase_deleted`: delete the purchase → SO cancel 200.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** suites 1–7 → PASS; `test_partial_billing.py --base … --database <local *_Test db>` → `60/60`; `test_basic_flows.py` → `112/112`; `test_stock_itemtype_reflow.py` → `76/76`.
- [ ] **Step 5: Commit** — `Refuse changes that undo bought customer document lines`.

---

### Task 5: Retire the old purchase sources

**Files:**
- Modify: `Controllers/InvoicesController.cs` (remove `awaiting-purchase`, `{invoiceId}/purchase-template`), `Services/Interfaces/IInvoiceService.cs`, `Services/Implementations/InvoiceService.cs:3669-3810` (remove `GetAwaitingPurchaseAsync`, `GetPurchaseTemplateAsync`), their DTOs
- Modify: `Models/PurchaseItem.cs` (remove `SourceLines` nav), `Data/AppDbContext.cs:1939-1956` — keep `PurchaseItemSourceLine` mapped (table stays) but nothing reads/writes it; comment says "kept one release, data copied to PurchaseItemSources"
- Modify: `myapp-frontend/src/api/invoiceApi.js` (remove `getAwaitingPurchase`, `getPurchaseTemplate`)
- Delete: `scripts/test_challan_line_purchases.py` (its cases live in `test_purchase_demand.py`)

- [ ] **Step 1:** `grep -rn "GetAwaitingPurchase\|PurchaseTemplate\|SourceLines\|getAwaitingPurchase\|getPurchaseTemplate" --include=*.cs --include=*.js --include=*.jsx --include=*.py . | grep -v Migrations` → only the files above.
- [ ] **Step 2:** Remove. `dotnet build` → `0 Error(s)`; the API migration list unchanged (`dotnet ef migrations has-pending-model-changes` → none).
- [ ] **Step 3:** Run suites 1–7 → PASS.
- [ ] **Step 4: Commit** — `Remove the separate sale bill and order purchase paths`.

---

### Task 6: `CustomerDemandPicker`

**Files:**
- Create: `myapp-frontend/src/Components/CustomerDemandPicker.jsx` (from `ChallanLinePicker.jsx`, which is deleted)
- Modify: `myapp-frontend/src/api/purchaseBillApi.js` (`getAwaitingLines(companyId, params)` replaces `getOpenChallanLinesForPurchase`)

**Interfaces:**
- Consumes: `GET …/awaiting-lines` (Task 2).
- Produces: `<CustomerDemandPicker companyId suppliers supplierId onSupplierChange onSupplierCreated supplierLocked excludeBillId taken forDoc onAdd onClose />` where `taken: { [trailKey]: qty }`, `forDoc: { kind, id } | null`, and `onAdd(rows)` gets `rows: [{ description, itemTypeId, nonInventoryItemId, uom, unitPrice, quantity, sources: [{ kind, lineId, quantity }], tags, trailKeys: [] }]` — one row per picked line, or one per combined group when **Combine same items** is on (same `itemTypeId`/`nonInventoryItemId` + unit + cost; quantity = sum; sources = all).

- [ ] **Step 1:** Build the picker per spec §4 (Group by segmented control: `Latest step` / `Sales order` / `Sale bill`; stage chip colours Ordered `#1565c0`, Delivered `#00897b`, Billed `#6a1b9a`; row text `100 ordered · 60 delivered · 20 bought`; qty sub-text `of 80 left · Rs 7,800`; footer `N lines from M documents · Rs total`, `Combine same items` switch, `Add to bill`). Subtract `taken[trailKey]` from `left`; hide lines with nothing left.
- [ ] **Step 2:** `npm run format:check` on the new file → clean; build + deploy (Global Constraints).
- [ ] **Step 3: Commit** — `Add one picker for customer document lines` (picker, api, deleted old picker). Verified with Task 7 (it has no host until then).

---

### Task 7: Purchase bill form

**Files:**
- Modify: `myapp-frontend/src/Components/PurchaseBillForm.jsx` (remove `prefillFromInvoiceId`, `prefillItems`, `prefillSourceLabel`, `isAgainstSale`, `isFromOrders`, `getPurchaseTemplate` and the sale-bill HS-type branches; rows carry `sources` + `tags`; `takenByTrail` memo; empty-state choices; `+ From customer documents` link; "For" strip; tags under descriptions in table and card layouts; payload `sources`)

**Interfaces:**
- Consumes: `CustomerDemandPicker` (Task 6); response `Tags`/`ForDocuments` (Task 3).
- Produces: props `startWithPicker: boolean`, `forDoc: { kind, id } | null` (replacing `startWithChallanPicker`).

- [ ] **Step 1:** Implement. Empty state (no rows with a description): two 44-px-high tiles **Pick from customer documents** / **Enter lines myself**; the second adds one blank row.
- [ ] **Step 2:** Build + deploy. Browser on 5136 (demo company): create a bill from a sales order line partly, then reopen picker → remainder shown; combine two lines → one row with two tags; edit the bill → tags kept, save 200. Check 375 / 768 / 1280: `document.documentElement.scrollWidth === innerWidth`.
- [ ] **Step 3: Commit** — `Build purchase bills from customer document trails`.

---

### Task 8: Purchase Bills page

**Files:**
- Create: `myapp-frontend/src/Components/RowMenu.jsx`
- Modify: `myapp-frontend/src/pages/PurchaseBillsPage.jsx` (one **New purchase bill** button; remove sale-bill and order pickers, their state and `pickerStyles`; read `?for=order:12` / `challan:` / `bill:` → open form with `startWithPicker` + `forDoc`, then clear the query; filter options `For customer documents` / `Stock & other` bound to `forCustomerDocuments`; cards use RowMenu)
- Modify: `myapp-frontend/src/Components/PurchaseBillTable.jsx` (View + Edit buttons, RowMenu with Print, PDF, Record payment, Copy, Delete; "For" column from `forDocuments`)

**Interfaces:**
- Produces: `<RowMenu items={[{ label, icon, onClick, disabled?, title?, danger? }]} />` — a 44×44 `⋯` icon button opening a portaled list anchored to it; closes on outside click, Escape and item click; items with `hidden` are not rendered; renders nothing when no items.

- [ ] **Step 1:** Implement. Each RowMenu item keeps its existing permission check and disabled/title behaviour (print template missing, export in progress).
- [ ] **Step 2:** Build + deploy. Browser: header shows one create button; row has View, Edit, ⋯; every menu item works (print opens, PDF downloads, payment dialog opens, copy dialog opens, delete confirms); `/purchase-bills?for=order:<id>` opens the picker filtered. 375 / 768 / 1280.
- [ ] **Step 3: Commit** — `Simplify the purchase bills page to one create button`.

---

### Task 9: Buy from sales orders, challans and sale bills

**Files:**
- Modify: `myapp-frontend/src/pages/SalesOrderPage.jsx`, `myapp-frontend/src/Components/ChallanTable.jsx`, `myapp-frontend/src/Components/ChallanList.jsx`, `myapp-frontend/src/Components/InvoiceTable.jsx`

These screens have no row menu, so **Buy** is one icon button (`MdShoppingCart`, label "Buy for this document") per row, rendered only with `purchasebills.manage.create` and only for documents that are not cancelled. It navigates to `/purchase-bills?for=<kind>:<id>`.

- [ ] **Step 1:** Implement on all four.
- [ ] **Step 2:** Build + deploy. Browser: Buy on a sales order, a challan and a bill each opens the picker showing only that document's open lines; a role without `purchasebills.manage.create` sees no Buy. 375 / 768 / 1280.
- [ ] **Step 3: Commit** — `Add Buy to sales orders, challans and sale bills`.

---

### Task 10: Docs and full verification

**Files:**
- Modify: `README.md` (changelog `2026-11-08` entry; replaces the 2026-11-07 wording where superseded; states that sales-order purchases made before this change are not linked)
- Modify: `CLAUDE.md` (test-table row: replace the challan-line-purchases row with `test_purchase_demand.py`, its final count)

- [ ] **Step 1:** Run, all green: `dotnet build` (0 errors); `test_purchase_demand.py` (all suites); `test_stock_itemtype_reflow.py` 76/76; `test_basic_flows.py` 112/112; `test_partial_billing.py` 60/60; `test_challan_supplier_purchase_preview.py --customize` 27/27; `verify_no_production_identifiers.py`.
- [ ] **Step 2:** Re-seed the demo company (`[DEMO] Multi-challan purchases`) with one sales order → challan → bill chain so the user can try every grouping; leave 5136 running.
- [ ] **Step 3: Commit** — `Document purchases for customer documents`. Do not push. Spec and plan files are deleted after the user approves the result.

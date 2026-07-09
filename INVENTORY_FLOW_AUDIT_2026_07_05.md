# Inventory Flow Audit & Redesign Plan — 2026-07-05

**Scope:** Item-type selector standardization (Phase 1) + inventory lifecycle redesign
(Phase 2: SO reservation → challan delivery → invoice completion, purchase IN, GR policy,
ItemType inventory summary, stock dashboard with traceable movement history).

**Branch audited:** `feat/sales-quote-order` @ `cfbbf93`. **Status: IMPLEMENTED + VERIFIED
2026-07-07 (uncommitted).** Design validated 2026-07-05 (all questions Q1–Q14 + Q2b/Q3b
decided in §12); backend engine + regression benchmark + inventory UI built and green.
See §0 for the as-built summary.

---

## 0. As-built summary (2026-07-07) — IMPLEMENTED, uncommitted

Delivered against the 5-PR plan (§10); all verified against the branch DB
(`DeliveryChallanDb`), nothing committed/pushed (awaiting review).

**Schema / policy (PR-2 + PR-3)** — migration `20260707164342_AddInventoryV2Foundation`
(additive): `Company.InventoryFlowVersion` (default 1 = V1), `CompanyItemTypeSettings`
(per-company `Default`/`Tracked`/`FbrOnly` override + reorder level — since `ItemType` is
a global catalog), `Invoice.SalesOrderId` + `InvoiceItem.SalesOrderItemId` lineage,
covering/filtered indexes. `GetStockTrackedItemTypeIdsAsync(companyId,…)` is now
policy-aware (V1 = HS-gate byte-identical; V2 = all non-deleted items minus `FbrOnly`).

**Derived read model (PR-4)** — new `InventoryReadService`: OnHand from the ledger,
ToDeliver / Delivered / Committed / Available / Incoming computed live from open
documents (nothing persisted → nothing drifts). Endpoints: `GET …/summary`,
`POST …/flow-version` (reversible, audited). Fixed the DashboardService opening-balance
KPI bug (PR-16). Stock Dashboard gains an **Inventory** tab (buckets + FBR-only badge).

**Write path + enforcement (PR-2 svc + PR-5)** — invoice create stamps SO lineage
(line + header); SO create enforces item-type-required (Q5) + single base UOM (Q10) +
over-commit hard-block (Q4, 409); cross-tenant `SalesQuoteId` (PR-03) and challan
`SalesOrderId`/`SalesOrderItemId` (PR-04) forgeries fixed. Availability guards moved
inside the transaction under a per-company `sp_getapplock` (`StockLock`) — closes the
TOCTOU race. `StockGuardHardBlock` is now settable via the company create/update API and
defaults on when V2 is enabled.

**Admin controls (2026-07-07 follow-up)** — the V1⇄V2 switch is now a real UI
control: a version pill + "Switch to V1/V2" button on the Stock Dashboard header
(admin-gated `stock.policy.manage`, confirm dialog, reversible). The
`StockGuardHardBlock` flag is now a checkbox on the Company settings → Inventory
tab. Added `POST …/itemtype-policy` (set per-item `FbrOnly`/`Tracked` override +
reorder level — previously the override had no API). `CompanyDto` now exposes
`inventoryFlowVersion` + `stockGuardHardBlock`. Fixed a latent
`CompanyContext.refreshCompanies` bug that kept a stale `selectedCompany` object
after a refresh (the pill wouldn't update post-switch). All verified in a real
browser (headless Edge): switch flips V2→V1→V2 with the pill updating live, 0
console errors.

**Selector (PR-1, partial)** — the canonical `SearchableItemTypeSelect` gained a
`disabled` prop, a 44px tap target, a 375px viewport clamp, and the banned
nowrap+ellipsis on item names replaced with a 2-line clamp (fixes benefit all consumers).
*Deferred:* adding the picker to ChallanEditForm + replacing ItemRateHistoryPage's plain
`<select>` (create/edit-asymmetry + a filter — not core to the inventory engine).

**Verification (all green):** `dotnet build` 0 errors; **V1 reflow 76/76**, **basic flows
35/35**, **Inventory V2 lifecycle 29/29** (new benchmark — full reserve→deliver→bill +
over-commit 409 + concurrent-guard + invariants), tenant + division isolation, permission
mapping; frontend build clean + authenticated dashboard boots with 0 console errors.

**Known deferrals / notes:** running-balance is still client-side on the movement drill
(server-side window fn deferred); credit-note→SO-Delivered rewind (Q12) records physical
IN via `NoteAffectsStock` but full SO-fulfilment rewind on returns is a follow-up; single
base UOM enforced on SO lines (not yet standalone-invoice lines); the pre-existing
standalone-invoice concurrent ItemType-usage-counter race is untouched (out of scope).

**Method:** 40 agent-passes over the codebase in three waves — 8 subsystem auditors,
a synthesis pass, 12 adversarial claim verifications (each attempting to *refute* a
load-bearing claim), 4 independent architecture proposals, a 3-lens judge panel, a final
comparative arbiter, and a completeness critic — plus read-only SQL profiling of the
prod-replica (`db46684`) and branch (`DeliveryChallanDb`) databases.

---

## 1. Current flow — the verified statement

There is exactly one stock ledger: `StockMovements` (`Models/StockMovement.cs`) — per-company
rows, Direction In/Out, positive `decimal(18,4)` quantity, `SourceType`
{OpeningBalance=0, PurchaseBill=1, Invoice=2, Adjustment=3, GoodsReceipt=4}, `MovementDate`
= document date, denormalized nullable `DivisionId`. **No persisted on-hand/summary row
exists anywhere**; on-hand is always computed as
`Σ OpeningStockBalances.Quantity + Σ In − Σ Out` (`StockService.cs:200-249`).
Opening balances live in a separate mutable table and are **never** written as movement rows
(`SourceType.OpeningBalance` has zero writers; the doc comment in `OpeningStockBalance.cs:10-13`
claiming otherwise is false).

### 1.1 What gets tracked (the gate)

A document line records a movement only when ALL hold:

1. `Company.InventoryTrackingEnabled` (write-gate only; reads always work),
2. the line has a non-null `ItemTypeId`,
3. **the ItemType has a non-empty `HSCode`** — `StockService.GetStockTrackedItemTypeIdsAsync`
   (`StockService.cs:41-52`), enforced symmetrically on IN (`PurchaseBillService.cs:378-383,
   539-544`) and OUT (`StockService.cs:360-366`),
4. effective qty > 0, not `IsDemo`, not FBR-excluded/cancelled (those purge all rows).

**⚠ The Phase-2 requirement (non-HS = real inventory, HS = FBR-only) is an exact inversion
of today's polarity.** Verified by all 8 auditors and an adversarial pass — with three
counterexamples that refine the picture (verdict C1 = PARTIALLY TRUE):

- `POST /api/stock/adjust` inserts movements for **any** ItemTypeId — no HS check, and it
  deliberately bypasses the tracking flag (`StockController.cs:325-371`).
- `PurchaseBillService.ReversePostedStockAsync` emits compensating OUTs from the posted net
  **without re-checking HS** — clearing an item's HS code then editing/deleting its bill
  records OUTs for a now-unclassified item (`PurchaseBillService.cs:588-616`).
- `FbrPurchaseImportCommitter` records INs **without calling the gate** — the HS invariant
  holds only structurally, because it resolves/creates item types keyed on HS codes
  (`FbrPurchaseImportCommitter.cs:212-228, 322-386`). Any polarity change must update this
  path explicitly.

`ItemType` is a **global, cross-tenant table with no CompanyId** (`Models/ItemType.cs`) —
"Standard vs FBR item type" is HSCode-null vs non-null on one shared catalog. Any per-item
inventory policy therefore **cannot** live on ItemType without leaking semantics across
tenants.

### 1.2 Per-document lifecycle (all verified with citations)

| Document | Stock behaviour today | Verdict |
|---|---|---|
| **Sales Quote** | Zero stock interaction. | CONFIRMED |
| **Sales Order** | Zero stock interaction. No reservation concept anywhere. `SalesOrderItem.ItemTypeId` is nullable and unvalidated; SO is quantity-only. Delivered/remaining per line is **derived at read time** from `DeliveryItem.SalesOrderItemId` links, never stored. Over-delivery is flagged ("Over") but never blocked. | CONFIRMED |
| **Delivery Challan** | **Never writes stock movements in any path** (create, edit, cancel, delete, duplicate, Excel import). The only stock effect is re-syncing the *linked invoice* when an already-billed challan's lines change (`DeliveryChallanService.cs:625`). This answers the requirement's "verify current behaviour" clause: challans do **not** reduce physical inventory today — matching the requested default. | CONFIRMED |
| **Invoice / Bill** | **The sole OUT point, at save time** (moved off FBR-submit 2026-05-12). One `Invoice` entity covers bill-from-challan, standalone bill, credit note (IN when `NoteAffectsStock`), debit note (OUT when `NoteAffectsStock`), demo bills (nothing). All 7 mutation paths funnel through `SyncInvoiceStockMovementsAsync` — which is **destructive purge-and-reinsert**, not compensating rows. Delete/cancel purge movements outright. FBR-submitted bills are frozen; correction channel = credit/debit note. OUT qty uses the FBR overlay `InvoiceItemAdjustment.AdjustedQuantity` over `InvoiceItem.Quantity`. | CONFIRMED |
| **Purchase Bill** | **The sole physical IN point.** Create emits IN per tracked line in the create transaction; edit/delete use the mature **append-only net-reversal** pattern (`ReversePostedStockAsync` reads the posted net from the ledger and emits compensating OUTs — the classify-after-create phantom guard, pinned by the reflow suite). | CONFIRMED |
| **Goods Receipt** | **Advisory only — never moves stock, by design** (`GoodsReceiptService.cs:10-17`: "Stock IN is emitted by PurchaseBill save, which is the unambiguous chokepoint"). `SourceType.GoodsReceipt` has zero writers. GR→PB link is header-level (`GoodsReceipt.PurchaseBillId`); the line-level `PurchaseItem.GoodsReceiptItemId` column is schema-dead (never assigned). **Zero GR rows exist in production.** | CONFIRMED |
| **SO → Bill prefill** | The invoice stores **no link at all** to the sales order — `Invoice` has no `SalesOrderId`, `InvoiceItem` has no `SalesOrderItemId`. The invoice-completion edge of the new lifecycle **does not exist in the schema**. | CONFIRMED |
| **Importers** | FBR purchase import writes real INs (see §1.1). LegacyImport **force-enables tracking then imports bills/invoices with zero movements** — the branch DB shows the result: 6,052 invoice items, 6,049 with null ItemTypeId, zero movements. Challan Excel import & PO parser create no movements. | CONFIRMED |

### 1.3 Adversarial verification results (12 claims)

C2–C5, C7–C12 **CONFIRMED** (challans never move stock; GR advisory; quote/SO stock-free;
no Invoice→SO link; two ledger disciplines; selector census; dashboard omits openings;
ItemTypes reads ungated; duplicate challans drop SO links so they never double-count SO
fulfilment; UoM is never validated/converted before summing). C1 and C6 **PARTIALLY TRUE**
with the corrections noted in §1.1 and §3 (PR-01).

---

## 2. Live data profile (read-only SELECTs, 2026-07-05)

### Prod replica `db46684` (Hakimi CompanyId=1, Roshan=2, Sms Enterprise=3)

- **All 3 companies have `InventoryTrackingEnabled = 1`.**
- ItemTypes: 156 total → active: **33 HS / 18 no-HS**; soft-deleted: 105.
- StockMovements: **216 rows, 100% on HS items** (PurchaseBill 18 rows net +9,656.49;
  Invoice 184 rows net −4,016.87; Adjustment 14 rows net −1,302.59). Openings: 11 rows.
- **A naive polarity flip would strand real, live inventory** and activate 18 no-HS items
  that are *category-style* rows ("Pneumatic Item", "Rubber", "Medicines", "Stationary"…),
  not SKUs — see Q1/Q11 in §12.
- GoodsReceipts: **0**. SalesOrders/SalesQuotes: **0**. DeliveryItems: 584, **all** null
  ItemTypeId, none SO-linked. InvoiceItems: 495, only 7 null ItemTypeId.

### Branch DB `DeliveryChallanDb` (Jorbai Groups + test companies)

- StockMovements: **0** despite Jorbai having tracking ON and 1,274 invoices / 2,378
  purchase bills (LegacyImport gap, PR-05). SalesQuotes: 274; SalesOrders: 4 (7 lines, all
  null ItemTypeId); DeliveryItems SO-linked: 3.

**Implications:** the reservation flow is effectively greenfield (no legacy SO data to
migrate); the Delivered bucket starts from zero data because challan lines carry no item
types in prod — **Phase 1 selector convergence is a functional prerequisite for Phase 2,
not cosmetics**; and per-company migration is mandatory because live tenants actively use
the current HS-tracked model.

---

## 3. Problem register (30 findings)

Full details with citations live in the audit workpapers; severity-ordered summary:

**HIGH**

- **PR-01 TOCTOU availability check outside the transaction** — `CheckAvailabilityAsync`
  runs before `BeginTransactionAsync`, no lock; two concurrent creates for the last N units
  both pass. The in-code comment claiming "one accepted + one rejected"
  (`InvoiceService.cs:592-597`) is enforced by nothing. (The `/adjust` endpoint has its own
  guard with the same TOCTOU shape.)
- **PR-02 No availability check on ANY edit path** — full PUT, narrow PATCH, challan-driven
  reflow; qty 5→5000 drives on-hand negative even with hard-block on.
- **PR-03 Cross-tenant `SalesQuoteId` forgery on SO create/update**; quote delete performs a
  cross-tenant write (company-unscoped linked-checks).
- **PR-04 Unvalidated `SalesOrderId`/`SalesOrderItemId` on generic challan create** — the
  fulfilment numbers the new Committed/To-Deliver metrics derive from are **forgeable
  cross-tenant**.
- **PR-05 LegacyImport forces tracking on with zero movements** → phantom negatives on first
  edit of an imported invoice.
- **PR-06 FBR purchase import**: double-import → double IN (C-3 dedup constraint not
  deployed); any unique-violation misread as "already imported"; division-blind numbering;
  bypasses the tracking gate (§1.1).
- **PR-07 ItemType HSCode edit flips tracked-status with no stock reflow** — under the
  inversion, classification changes become the highest-risk operation. Needs an explicit
  policy mechanism, not an in-place predicate flip.
- **PR-08 Two ledger disciplines in one table** — invoice purge-and-reinsert vs purchase
  compensating rows. A trustworthy running-balance history is **impossible for invoice rows
  today**; the `StockMovement` immutability doc comment is false for invoices.

**MEDIUM**

- **PR-09** No concurrency token anywhere (no RowVersion); concurrent same-document edits =
  lost update or raw 500; concurrent PB edits can double-reverse.
- **PR-10** Reservation-critical SO/challan flows unguarded: over-delivery never prevented;
  "deliver remaining" races; quote→order conversion and quote/SO deletes are multi-save with
  no transaction.
- **PR-11** Canonical challan-number race (MAX+1, non-unique by design, no retry).
- **PR-12** PB `UpdateAsync`: zero item validation; silently drops against-sale
  `PurchaseItemSourceLine` links.
- **PR-13** PB delete blockers (GR/payment-allocation Restrict FKs) → raw 500.
- **PR-14** GR validation gaps: cross-tenant supplier on update; free-text `Status`
  ("Cancelled" has zero effects); `GoodsReceiptItem.Quantity` is **int** (unit mismatch vs
  decimal(18,4) everywhere else); empty items wipes lines. Load-bearing if GR feeds Incoming.
- **PR-15** Missing indexes: no `MovementDate` in any StockMovements index (movements feed
  scans+sorts); `SalesOrder.SalesQuoteId` / `SalesQuote.ConvertedToSalesOrderId` unindexed.
- **PR-16** Four duplicated on-hand implementations; **DashboardService's copy omits opening
  balances** → wrong KPIs (TotalStockValue, LowStockItemCount).
- **PR-17** SO IsLatest/delete-guard uses company-wide max while numbering is per-division.
- **PR-18** Backdating unguarded; as-of history mutable; period-close fires only on deletes.
- **PR-19** **ItemTypesController read endpoints have no `[HasPermission]`** (`[Authorize]`
  only) — mandatory fix before the page becomes the inventory hub (CLAUDE.md §2).
- **PR-20** Frontend drill running balance omits openings (drill total ≠ On-Hand column);
  movements UI sends only `page` (backend supports item/source/date filters); doc numbers are
  plain text, not links; adjustments have SourceId=null → untraceable.
- **PR-21** **Non-HS items cannot produce a billable challan** — `IsFbrReady` requires
  HS+UOM+SaleType unless the company is FBR-off. Under the new model, standard items have no
  challan→invoice path on FBR-enabled companies. Also `GetAwaitingPurchaseAsync` treats
  HS-empty lines as "needs procurement" — a colliding meaning of no-HS.
- **PR-22** `RecordMovementAsync` flushes the shared context per line; deadlock 1205
  unretried (known audit item H-1).

**LOW** (abbreviated)

- **PR-23** Opening-balance upsert mutates in place (no history), accepts negatives, races
  the unique index → 500; adjustments irreversible, division-blind, second direct writer.
- **PR-24** Dead/misleading artifacts: `SourceType.OpeningBalance`/`GoodsReceipt` never
  written; three false doc comments (§1); `FEATURE_CREDIT_DEBIT_NOTES.md` says debit note →
  no movement while code emits OUT; `PurchaseItem.GoodsReceiptItemId` schema-dead.
- **PR-25** Phase-1 work-list: ChallanEditForm has **no picker** (create/edit asymmetry);
  ItemRateHistoryPage plain `<select>`; dead `SmartItemAutocomplete` import in ChallanForm;
  pick-side-effect logic duplicated ×4; bulk-apply ×3 divergent; `getItemTypes(companyId)`
  passed by only ~half the call sites (stock chips vanish exactly where Phase 2 needs them).
- **PR-26** Mobile violations in the canonical selector: dropdown `width ≥ 360px` unclamped
  (overflows 375px), banned `nowrap+ellipsis` on item names (MEKO incident pattern), ~34px
  trigger < 44px tap target, no `disabled` prop.
- **PR-27** Stale UI copy encodes the old polarity everywhere ("items without an HS Code are
  hidden", "QUICK (no HS)", "out of stock" chips on FBR-only items, `availableQty` misnomer).
- **PR-28** Quote/SO lifecycle drift (quote stuck locked after SO unlink; fractional qty
  accepted at SO but rejected at challan; challan-edit-added lines and duplicates carry no SO
  links → Delivered undercounts — must become an explicit product rule).
- **PR-29** Bogus/soft-deleted ItemTypeIds accepted on SO/quote/PB/GR lines → FK 500s;
  soft-deleted HS items still move stock.
- **PR-30** `InventoryTrackingEnabled` flip has no backfill; tracked-window gaps are silent.

---

## 4. Gap analysis vs the requirements

### 4.1 Phase 1 — selector standardization (mostly convergence, not construction)

**The canonical component already exists and is what Invoice Edit uses:**
`Components/SearchableItemTypeSelect.jsx`, rendered by `EditBillForm.jsx:1320` (per-row) and
`:1217` (bulk-apply). It is already used at **12 render sites in 9 files** covering all 8
document forms + StockDashboardPage modals. Full census in the workpapers; the actual gaps:

| Screen | Today | Phase-1 action |
|---|---|---|
| ChallanEditForm | **No picker at all** — itemTypeId round-trips invisibly (create/edit asymmetry) | Add the canonical selector |
| ItemRateHistoryPage | Plain native `<select>` (the last one in the app) | Replace with canonical selector |
| ChallanForm | Dead `SmartItemAutocomplete` import + unused handler | Remove dead code |
| InvoiceForm / StandaloneInvoiceForm / PurchaseBillForm / GoodsReceiptForm / StockDashboardPage | Fetch `getItemTypes()` **bare** — no stock chips / IN-STOCK sorting | Pass `companyId` consistently |
| All call sites | Pick-side-effect logic ×4 slightly-different copies; bulk-apply ×3 divergent; scenario→saleType filter memo ×3 | Consolidate into a shared hook + component props |
| Component itself | 375px overflow, `nowrap+ellipsis` on names, 34px tap target, no `disabled` prop | Fix in-component (all consumers inherit) |

`SmartItemAutocomplete` is **not** a duplicate item-type selector — it's a description-first
picker (local descriptions + FBR HS catalog) live only in InvoiceForm for challan-derived
rows. Its fate is a product decision (Q13), not a mechanical dedupe.

### 4.2 Phase 2 — target metrics vs data reality

| Target metric | Exists today? | Data source under the new design |
|---|---|---|
| Qty In Stock (physical) | ✅ (4 drifting copies, one buggy) | Openings + Σ physical ledger (single consolidated implementation) |
| Movement history + source doc | ◐ plain-text doc numbers, adjustments untraceable | Extend `/movements` with links + filters |
| Running balance | ◐ client-only, omits openings | Server-side window function seeded with openings |
| Available | ❌ (`availableQty` today = physical on-hand, a misnomer) | OnHand − Committed |
| Qty Committed | ❌ no data source | Derived: To-Deliver + Delivered (open docs) |
| Qty To Deliver | ❌ | Derived: open SO lines, ordered − delivered − direct-invoiced |
| Qty Delivered (not yet billed) | ❌ | Derived: un-billed non-cancelled challan lines |
| Incoming | ❌ (no PO entity; GR advisory) | Derived: un-billed non-cancelled GR lines |
| Outgoing | ❌ | Physical OUT sum over a date range (definition needs Q-sign-off) |

**Blocking flow gap:** PR-21 — non-HS items can't travel the challan→invoice path on
FBR-enabled companies. No architecture fixes this; it's a product decision (Q2).

---

## 5. Goods Receipt recommendation (as requested: from existing behaviour, not assumption)

**Keep physical IN at Purchase Bill. Model GR as the derived "Incoming Qty" metric.**

Grounds: (1) the code documents this as a deliberate v1 design — GR is "advisory",
PB save is "the unambiguous chokepoint" (`GoodsReceiptService.cs:10-17`); (2) the GL engine
posts inventory at bill time (`PostPurchaseBillAsync`) — receiving at GR would desync stock
from GL; (3) FBR import and rate history key on bills; (4) **production has zero GR rows** —
there is no behaviour to migrate; (5) promoting GR to the IN point would require wiring the
dead line-level link plus a GR/PB dedup protocol that doesn't exist. A per-company
"receive-at-GR" mode remains possible later without schema change. Caveat: PR-14 must be
fixed before GR feeds any metric (notably `Quantity` is int, status is free text).

---

## 6. Architectures considered

Four complete designs were produced independently and judged (3 lenses + final arbiter):

| Proposal | Shape | Outcome |
|---|---|---|
| **A. Bucketed ledger + StockLevels snapshot** | Bucket column on StockMovements (OnHand/Reserved/ToDeliver/Delivered/Incoming) + per-(company,item) snapshot row; guarded UPDATE = enforcement | Judges' favourite of round 1 (8.5/8.5/8). Rejected by the final arbiter: dual-write drift risk + persisted reservation-row lifecycle (its own top-flagged defect areas), plus enable-time backfill machinery. |
| **B. Pure bucketed ledger + `sp_getapplock`** | Same buckets, no snapshot; whole-chain reflow | Disqualified: placed per-item policy on the **global** ItemType table (cross-tenant semantics leak — ItemType has no CompanyId); applock return value unchecked. Its whole-chain-reflow idea and lock discipline were grafted. |
| **C. Inventory V2: buckets + StockBalances projection + policy table** | 4 buckets + projection + `CompanyItemTypeSettings` | Strongest concurrency spec and backfill; rejected for the same projection-drift liability plus the weakest bucket decomposition (Reserved doing double duty). Its policy table, concurrency test, and enable-checklist were grafted. |
| **D. Derived read model** ("documents ARE the ledger") | Physical-only ledger unchanged; Committed/To-Deliver/Delivered/Incoming computed at read time from document state | **WINNER** — recommended base, hardened with grafts from A–C. |

---

## 7. Recommended architecture — Derived Inventory Read Model

**Core principle: `StockMovements` stays a physical-only ledger exactly as today. The
logical buckets are never persisted — they are computed from the documents that define
them,** generalizing the pattern the codebase already uses for SO fulfilment ("computed on
read, never stored, so they can't drift" — `SalesOrderItem.cs:8-9`).

Why this fits **this** codebase (final arbiter's reasoning):

1. **Drift is this repo's demonstrated failure mode** — phantom inventory (2026-05-13),
   phantom reversal (2026-06-29), four drifting on-hand copies, the dashboard
   opening-balance bug, LegacyImport drift. Every bucketed rival ships a reconcile endpoint
   on day one — a repair tool for corruption its own architecture makes possible. The
   derived model has nothing to reconcile.
2. **Reservation-row lifecycle is the rivals' self-admitted highest-defect area** (SO edit →
   min-clamps; challan cancel → conditional restore; invoice exclude → conditional
   re-instatement; duplicate challans). In the derived model every such edge case is a WHERE
   clause evaluated at read time — a missed edge costs one wrong page load, not permanently
   corrupted state.
3. **No backfill, real rollback.** Enabling the new mode requires no bucket backfill — open
   documents appear in the buckets definitionally. Rollback = flip the flag back; no
   synthetic rows to purge. On a no-staging CI-to-prod pipeline this is the strongest safety
   property of the four designs.
4. **Read cost is bounded by the OPEN-document working set** via filtered indexes (a company
   with 50k historical challans and 30 open ones pays for 30). Measured on the branch DB
   before ship; 30s cache valve for dropdown chips; explicit exit ramp — if a tenant's open
   set ever gets huge, add a summary table *then*, as a pure cache with the derived queries
   as its reconciliation oracle.

### Bucket definitions

```
OnHand    = Σ openings + Σ physical In − Σ physical Out          (ledger, as today)
ToDeliver = Σ over open SO lines: max(ordered − delivered − directInvoiced, 0)
Delivered = Σ DeliveryItem qty on non-cancelled, un-billed challans
Committed = ToDeliver + Delivered
Available = OnHand − Committed
Incoming  = Σ GR lines on non-cancelled, un-billed GRs
Outgoing  = Σ physical OUT over a date range (reporting metric)
```

HS-coded items are excluded by the V2 predicate and render an "FBR-only" pill (no numbers);
`CompanyItemTypeSettings.Mode = ForceTracked` covers the "unless explicitly required" case
(an HS item that IS real inventory), `ForceFbrOnly` the reverse.

> **⚠ Superseded by the Q1 decision (2026-07-05, see §12):** under V2, **ALL item types
> (HS and non-HS) are inventory items**; inventory identity = the (Name, HSCode) pair, and
> HS code becomes FBR-reporting metadata rather than a tracking discriminator. The V2
> tracked-set predicate is therefore "every non-deleted item type" (with
> `CompanyItemTypeSettings.Mode = FbrOnly` as the per-company opt-out override for items a
> company does not want tracked). This **removes the history-stranding problem entirely** —
> existing HS-item movements remain valid inventory under V2 — and simplifies migration:
> V1→V2 keeps HS items tracked and simply adds no-HS items (starting from openings).

### Key design decisions (with grafts from the rejected proposals)

- **Lineage first:** add `Invoice.SalesOrderId` + `InvoiceItem.SalesOrderItemId` (nullable,
  NoAction FKs), stamped and company-validated on both create paths — closes C5 and the
  PR-03/PR-04 cross-tenant forgeries in the same PR.
- **Per-company policy, never global:** `Company.InventoryFlowVersion` (default 1 = today's
  HS-gate, byte-identical for Hakimi/Roshan and the pinned 52/52 suite) +
  `CompanyItemTypeSettings(CompanyId, ItemTypeId, Mode, ReorderLevel)`.
  `GetStockTrackedItemTypeIdsAsync` gains `companyId` and loads policy **inside** the method.
- **One read service:** new read-only `InventoryReadService` (five grouped `AsNoTracking`
  queries riding filtered indexes) becomes the **single** on-hand implementation, replacing
  the four drifting copies and fixing the DashboardService bug (PR-16).
- **Concurrency (two modes, mirroring `StockGuardHardBlock`):** default = visualize-only
  (today's default enforces nothing, so no regression). Hard-block = transaction-owned
  `sp_getapplock` per `(company, itemType)` in ascending item order, **return value
  checked**, then recompute Available under the lock on the same connection — enforcement
  against the truth, not a possibly-drifted snapshot. Covers invoice create AND qty-increase
  edits (fixes PR-01/PR-02) and SO over-commit; typed `StockShortageException` → 409 with a
  structured DTO (never `ex.Message`); Polly retry on SqlException 1205 around the document
  transaction (closes H-1).
- **Item-reclassification guard (graft):** adding/clearing an HS code or flipping a policy
  override while any V2 company holds non-zero physical stock refuses unless confirmed, then
  zeroes via traceable Adjustment rows (answers PR-07/Q3).
- **Opening-balance edits through the ledger (graft):** In/Out `SourceType=OpeningBalance`
  delta rows instead of today's silent in-place rewrite (fixes PR-23 and finally gives that
  enum value a writer).
- **Phase 2b (recommended, ~1 day):** convert `SyncInvoiceStockMovementsAsync` to
  diff-and-compensate (the `ReversePostedStockAsync` shape) for V2 companies, so the
  running-balance view is stable across edits (PR-08). Until then, running balance is only
  as immutable as the invoice side allows — a debt shared by every proposal.
- **GR stays advisory** (§5); setting the existing `GoodsReceipt.PurchaseBillId` is what
  moves qty from Incoming to InStock — no new write path at all.

---

## 8. Concrete change lists

### 8.1 Database (all additive; migration batches split per CLAUDE.md §11, IF NOT EXISTS-guarded, verified against the branch DB `DeliveryChallanDb`, never the replica)

New columns: `Invoice.SalesOrderId int NULL` (FK NoAction), `InvoiceItem.SalesOrderItemId
int NULL` (FK NoAction), `Company.InventoryFlowVersion tinyint NOT NULL DEFAULT 1`.
New table: `CompanyItemTypeSettings (Id, CompanyId, ItemTypeId, Mode tinyint, ReorderLevel
decimal(18,4) NULL, UNIQUE(CompanyId, ItemTypeId))`.
New indexes: `StockMovements (CompanyId, ItemTypeId, MovementDate, Id) INCLUDE (Direction,
Quantity, SourceType, SourceId, DivisionId)` (running balance — Id as a KEY column);
`StockMovements (CompanyId, MovementDate) INCLUDE (…)` (feed); filtered
`DeliveryChallans WHERE InvoiceId IS NULL`, `GoodsReceipts WHERE PurchaseBillId IS NULL`;
`SalesOrders (CompanyId, Status)`; line indexes on `DeliveryItems(SalesOrderItemId)`,
`InvoiceItems(SalesOrderItemId)`, `Invoices(SalesOrderId)`; PR-15 link indexes
(`SalesOrder.SalesQuoteId`, `SalesQuote.ConvertedToSalesOrderId`).
**No** Bucket column, **no** new SourceType values, **no** snapshot table.

### 8.2 API

- `GET /api/stock/company/{id}/summary` — per-item buckets for the ItemType screen
  (`[HasPermission]`, `[AuthorizeCompany]`, division D1 scope, `PaginationHelper` clamp).
- `GET /api/stock/company/{id}/summary/{itemTypeId}/detail` — drill: the actual open
  SOs/challans/GRs composing each bucket (full explainability).
- `GET /api/stock/company/{id}/movements` — extended: `runningBalance` (server-side,
  parameterized `SqlQueryRaw` window over `(MovementDate, Id)` seeded with openings, only
  when filtered to one item), source-doc deep links, division column, existing filters
  finally wired to the UI.
- `POST /api/stock/company/{id}/flow-version` — V2 enable (new `stock.policy.manage`
  permission); returns the checklist of newly-tracked items lacking opening balances.
- Permission keys: `stock.policy.manage`, `stock.overcommit.allow` (+ enforce existing
  `itemtypes.manage.view` on ItemTypesController reads — PR-19). Modules stay `Inventory` /
  `ItemTypes` → **no `permissionSections.js` change needed**, but
  `python scripts/verify_permission_sections.py` runs in the same change regardless.

### 8.3 Services

- New `InventoryReadService` (read-only; the single bucket/on-hand implementation).
- New `IStockGuard.EnsureAsync` (applock + recompute-under-lock; called by InvoiceService
  create/edit, SO create/edit under hard-block, adjustments).
- `StockService.GetStockTrackedItemTypeIdsAsync(companyId)` — policy-aware (V1 verbatim /
  V2 inverted + overrides); all 6 call sites updated in one commit, **including
  `FbrPurchaseImportCommitter`** (PR-06).
- `SalesOrderService` / `DeliveryChallanService`: PR-03/PR-04 link validation; transactions
  around multi-save flows (PR-10); V2 rule requiring ItemTypeId on SO lines (Q5).
- `InvoiceService`: stamp SO lineage on create; move availability checks inside the
  transaction; fix the misleading C-14 comment; V2 tracked items use `InvoiceItem.Quantity`
  (not the FBR overlay) for stock.
- `ItemTypeService`: reclassification guard; `DashboardService`: delegate to
  `InventoryReadService` (fixes PR-16).

### 8.4 UI

- Phase 1 per §4.1 (canonical selector everywhere + in-component mobile fixes).
- ItemTypesPage → central inventory summary for the selected company: Available, Committed,
  To Deliver, Delivered, In Stock, Incoming (+ recommended: reorder level, last movement
  date, shortage badge); FBR-only pill for HS items; explicit company selector semantics
  (today it silently aggregates cross-company — Q11).
- StockDashboardPage: bucket columns, movement history with server running balance, source
  document **links**, division column, filter bar wired to the existing backend params.
- Purge stale polarity copy (PR-27). All new tables responsive per repo grid rules
  (375/768/1280) — wide metric tables get `overflow-x: auto` containers.

---

## 9. Migration & rollback strategy

1. **Nothing changes for existing companies by default** — `InventoryFlowVersion = 1`
  everywhere; the 52/52 reflow suite runs byte-identical; Hakimi/Roshan/Sms untouched.
2. **Per-company opt-in** via the flow-version endpoint: sets version 2, seeds
  `CompanyItemTypeSettings` defaults from HS presence, returns the opening-balance checklist
  (the one unavoidable manual step in any design). **No bucket backfill exists** — open
  documents appear in the buckets on the next read, complete by construction.
3. **HS-item history freezes in place** — physical rows stay queryable under an "FBR-legacy"
  section with an adjust-to-zero helper; nothing is rewritten (additive-history constraint).
4. **Rollback = flip the version back.** No synthetic rows to purge, no snapshot to
  reconcile. (Recommended posture: admin-only toggle, Q8.)
5. LegacyImport companies (Jorbai): opening balances entered as of a cutover date rather
  than history reconstruction (PR-05 documented as a known limitation).

---

## 10. Step-by-step implementation plan (5 PRs, each independently valuable, ~10 dev-days)

| PR | Content | Gate |
|---|---|---|
| **PR-1** (1–1.5d) | Phase 1: canonical selector into ChallanEditForm + ItemRateHistoryPage; `companyId` fetch everywhere; consolidate pick-side-effect/bulk-apply logic; in-component mobile fixes; remove dead code. Frontend bundle rebuild in same commit. | UI smoke at 375/768/1280; existing suites green |
| **PR-2** (1.5–2d) | Lineage columns + PR-03/PR-04 cross-tenant validation + PR-10 transactions + all indexes. **Worth merging standalone — fixes two HIGH security findings.** | `dotnet build` 0 errors; new tenant-isolation cases in `test_tenant_isolation.py`; 52/52 reflow unchanged |
| **PR-3** (1d) | Dormant policy plumbing: `InventoryFlowVersion`, `CompanyItemTypeSettings`, policy-aware gate (all call sites incl. FBR import). Provably behaviour-neutral at V1. | All existing suites byte-identical green |
| **PR-4** (3d) | `InventoryReadService` + summary/detail/movements endpoints + ItemTypesPage summary + StockDashboard rebuild + PR-19 permission fix + PR-16 consolidation. | New V2 suite read-path cases; `verify_permission_sections.py`; responsive checks |
| **PR-5** (2d) | Enforcement (`IStockGuard`), flow-version endpoint + checklist, reclassification guard, opening-balance delta rows, Phase 2b invoice diff-and-compensate, `scripts/test_stock_v2_lifecycle.py` (incl. the **two-parallel-invoices concurrency test** and derived-invariant assertion after every scenario). | Full regression: 52/52 reflow (V1, unmodified) + new V2 suite + basic flows + tenant/division isolation; branch-DB soak |

Test impact: `test_stock_itemtype_reflow.py` stays **byte-identical** (pins V1 forever).
The inversion is pinned by the NEW `test_stock_v2_lifecycle.py` against a V2 ephemeral
company (checks 1.4/2.1 equivalents inverted; phantom-guard *invariant* — never fabricate,
never double — preserved across the transition; suite-5 equivalent proves challans alone
still never move physical stock).

---

## 11. Risks

- **Read cost** O(open documents) per summary load — bounded by filtered indexes; measured
  on the branch DB before ship; cache valve + summary-table exit ramp documented.
- **Enforcement discipline**: a missed applock call site is an enforcement hole but never a
  data-corruption hole (numbers stay correct — categorically safer than a missed snapshot
  update).
- **Bucket accuracy = link hygiene**: V2 requires ItemTypeId on SO lines; PR-03/PR-04 must
  ship first. Challan-edit-added lines carry no SO link (fulfilment undercounts unless
  linked). Per the Q3/Q3b decision, duplicated challans are ordinary inventory documents:
  their lines must support SO re-linking (today's duplicate flow nulls the links), and an
  unedited duplicate overlapping the original's open lines should trigger a warning to
  preserve "each shipped item deducted exactly once".
- **No as-of history for derived buckets** (current-state only; same limitation in all four
  designs). Physical as-of works as today.
- **Standalone invoices that conceptually fulfil an SO but bypass the prefill** leave
  Committed inflated until the SO closes (same weakness in all four designs; visible, not
  corrupting).
- **Division scope**: buckets/enforcement are company-wide while a division-restricted
  user's view is D1-filtered — numbers can legitimately differ (Q6; surfaced in the shortage
  DTO + tooltip).
- **UoM**: quantities are summed without unit validation/conversion (C12 confirmed) — Q10.

---

## 12. Open questions — answers needed before implementation

### 12.1 ✅ DECIDED 2026-07-05 (Q1–Q5) — recorded, NOT yet implemented

1. **Q1 — DECIDED: per-company opt-in V2, with an adjusted model.** Under V2, **both
   HS-coded and non-HS item types are inventory items**. Inventory identity/uniqueness =
   **(Item Type Name + HS Code)**: the same name may repeat only with a different HS code
   (or one no-HS variant). *Audit note: this uniqueness rule is ALREADY enforced by the
   filtered unique index at `AppDbContext.cs:474-479` (`(Name, HSCode) UNIQUE WHERE
   IsDeleted = 0`, one NULL-HS row per name) — no schema change needed for it.*
   **Design delta:** the V2 tracked-set predicate becomes “all non-deleted item types”
   (HS = FBR metadata only, not a tracking discriminator; a per-company `FbrOnly` override
   remains available for items a company does not want tracked). This eliminates the
   HS-history-stranding problem — see the delta note in §7.
2. **Q2 — DECIDED: relax `IsFbrReady`.** Billability must not depend on HS code; non-HS
   inventory items are fully billable through challan→invoice. Only HS-coded items
   participate in FBR reporting.
   **Q2b — DECIDED (2026-07-05): mixed invoices are allowed; FBR payload = HS lines only.**
   Invoicing and FBR submission are separate concerns: non-HS lines are invoiced normally
   but **never included in the FBR payload**; saving/posting an invoice never requires
   every line to carry an HS code; FBR submission simply ignores non-HS lines.
   *Design notes for implementation:* (a) the FBR-filed invoice value will be **less than**
   the commercial invoice total whenever non-HS lines exist — FBR preview/monitor UI must
   make the submitted-subset explicit so operators aren't surprised; (b) FBR validation
   (e.g. partial-HS error 0052) applies to the HS subset only; (c) the
   `InvoiceItemAdjustment` FBR overlay continues to apply to HS lines only, and V2 stock
   OUT uses `InvoiceItem.Quantity` per the §7 design.
3. **Q3 + Q3b — DECIDED & CLARIFIED (2026-07-05): duplicate challans are ordinary
   inventory documents whose stock effects follow their OWN line items.** The business
   process: one physical dispatch covers multiple customer POs, but a challan carries one
   PO number — so the operator creates Challan 1 (PO1 → items A, B) and a duplicate
   (PO2 → items C, D). The duplicate is **not** a copy/reprint and **not** commercial-only:
   each challan in the family contains *different* line items of the same dispatch.
   Rules: inventory is deducted for every item appearing on every challan; the **same line
   item must never be deducted twice**; each challan is independently billable; the audit
   link to the original is kept (`DuplicatedFromId` already exists).
   *Design consequences (this is simpler than the earlier commercial-only reading):*
   (a) **no duplicate-specific stock logic is needed** — movements/buckets derive from
   actual lines per challan/invoice, exactly like any other challan; (b) duplicates must
   **support SO line links** so PO2's items count toward their own SO fulfilment — today's
   duplicate flow nulls `SalesOrderItemId` on copied lines (verified, C11), which is the
   right starting state for lines the operator will replace, but re-linking the edited
   lines to the correct SO must be possible on the duplicate; (c) *residual risk*: an
   **unedited** duplicate still carries the original's lines, and billing both would
   double-deduct those items by line-driven design — recommend a warning (or soft block)
   when a duplicate family contains overlapping identical open lines, since "exactly once
   per shipped item" is guaranteed by the business process, not by schema.
4. **Q4 — DECIDED: hard block by default** at SO create when Available is insufficient —
   409 Conflict with structured shortage details. A permission/config override
   (`stock.overcommit.allow`) may be introduced later as warn-then-override.
5. **Q5 — DECIDED: reject.** On V2 companies, every inventory-affecting SO line must carry a
   valid Item Type; return a validation error (no silent exclusion — it would corrupt
   Committed).

### 12.2 ✅ DECIDED 2026-07-05 (Q6–Q14) — recorded, NOT yet implemented

6. **Q6 — DECIDED: company-wide inventory; division = filtered view.** Buckets and the
   oversell guard enforce against company-wide numbers; division-restricted users see
   D1-filtered views that can legitimately differ — surfaced in the shortage DTO and a UI
   tooltip. Revisit only if divisions ever become physical warehouses.
7. **Q7 — DECIDED: inventory posts on Purchase Bill only.** §5 confirmed — GR stays
   advisory, feeds the derived Incoming metric via the existing `PurchaseBillId` link;
   PR-14 validation fixes ship with it; `GoodsReceiptItem.Quantity` int→decimal as a later
   additive column.
8. **Q8 — DECIDED & CONFIRMED: admin-toggle, reversible, audited.** V1↔V2 is reversible —
   safe precisely because the derived read model persists no bucket snapshots, so a policy
   change requires **no inventory cleanup or data migration**. Requirements: gated by the
   admin `stock.policy.manage` permission; **every** policy change writes an AuditLog
   entry; no synthetic bucket cleanup on switch in either direction.
9. **Q9 — DECIDED: respect the GL lock date; order by (MovementDate, Id).** Stock-bearing
   V2 writes honour the GL period lock when GL is enabled; running-balance and history
   ordering tie-breaks on `MovementDate, Id`.
10. **Q10 — DECIDED & CONFIRMED: enforce a single configured base UOM per tracked item.**
    On V2 companies: every inventory-affecting document line must use the item's configured
    base UOM (`ItemType.UOM` is the natural home for the configured value); a different
    UOM **fails validation** (400, not silent coercion); **mixed-UOM quantities are never
    aggregated** (closes C12: blind cross-unit summation).
11. **Q11 — DECIDED: company-scoped ItemTypes page with FBR-only badge.** The page shows
    ONE selected company's numbers (no more silent cross-company aggregation). Items
    excluded from tracking (per-company `FbrOnly` override) show a badge instead of
    quantities; HS-coded tracked items carry an FBR-reportable indicator.
12. **Q12 — DECIDED & CONFIRMED: `NoteAffectsStock` governs.** A credit note representing a
    physical goods return (`NoteAffectsStock = true`) reverses **all three**: inventory,
    the SO's Delivered quantity, and SO fulfilment. A financial/value-only credit note
    (`NoteAffectsStock = false`) leaves all three unchanged — physical inventory movements
    stay strictly separate from purely financial adjustments.
13. **Q13 — DECIDED: keep SmartItemAutocomplete** as the description-first picker on
    InvoiceForm (it is not an item-type selector duplicate); backend search may be shared
    with the canonical selector if convenient. The dead import in ChallanForm is still
    removed in PR-1.
14. **Q14 — DECIDED & CONFIRMED: scope.** GL posting of inventory (COGS/asset) is **out of
    scope**. CSV/Excel export of the summary + movement history is **in scope** (PR-4; all
    operator-controlled/user-entered strings pass through `CsvSafe` before export, per
    CLAUDE.md §8). FBR purchase imports remain **FBR-only unless explicitly mapped**: item
    types auto-created by the FBR import default to the per-company `FbrOnly` override on
    V2 companies — imported HS-coded purchase lines create **no inventory movements
    automatically**; if the business wants those purchases to affect inventory, an operator
    must explicitly map or convert them to tracked inventory items.

---

### Design status: **VALIDATED 2026-07-05 — all questions (Q1–Q14, Q2b, Q3b) decided.**
Implementation has NOT started; it begins with PR-1 (§10) on explicit go-ahead.

---

*Workpapers (detailed per-subsystem audit reports, the four full proposals, judge
scorecards, and 12 verification verdicts with citations) are preserved in the session
scratchpad and can be copied into the repo on request.*

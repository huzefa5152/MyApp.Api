# FEATURE — Non-Inventory Items (per-company GL-account line items)

**Status:** PLANNED (not implemented). Researched 2026-07-12 during the Manager.io
migration work. Implement in a fresh session — see the **Handoff command** at the end.

---

## Decision (locked)

- **`ItemType` stays exactly as it is** — the product / real-inventory concept
  (HS code, UOM, FBR classification, stock tracking). Do **not** overload it.
- Add a **separate, per-company `NonInventoryItem`** entity whose *only* job is
  **GL-account mapping** (a named shortcut to an income/expense account, no stock).
- The document line-item **dropdown shows BOTH**, visually separated
  ("Item Types" vs "Non-Inventory Items"). **Each selection does its own work**:
  an ItemType line = product/inventory/FBR behaviour; a NonInventoryItem line =
  posts to its mapped GL account, moves no stock.

Mirrors Manager.io exactly: Manager has *Inventory Items* (stock) and
*Non-inventory Items* (account shortcuts) and both appear in the line "Item"
picker.

---

## Research (Al-Qahera Trading Co., pulled live from Manager + its trial balance)

A Manager **non-inventory item** carries a **"When sold → Account"** and a
**"When purchased → Account"** (fields `SaleItemAccount` / `PurchaseItemAccount`
on `GET /api2/non-inventory-item-form/{key}`), plus optional Code, Unit Name,
DefaultLineDescription, autofill flags, and "Hide item name on printed documents".
No price, no stock.

Al-Qahera's three items and their account mapping:

| Non-inv item | When **sold** → account | When **purchased** → account | Trial-balance section / balance |
|---|---|---|---|
| **Freight Charges** | **Freight Charges** | Suspense | Income — 639,749.97 |
| **Discount** | **Discount** | Suspense | Expense — 15,418.06 |
| **Others** | Sales | Cost of Cash | (defined, **0 uses**) |

**Usage:** Freight Charges is on **2,192 / 2,307 invoices (95%)** (also 209 quotes,
58 purchase bills, 22 credit notes, 20 delivery notes); Discount on 2; Others on 0.
Only ~377 freight lines carry an amount (the rest are blank template lines); total
freight income ≈ 636,750 PKR. The amount sits in the line's unit price (qty implied 1).

**GL posting pattern** — a non-inventory line just splits the document's
credit/debit onto the mapped account; **no stock movement**. A sales invoice with
product lines + a Freight line + a Discount line posts:

```
Dr  Accounts Receivable            invoice total
  Cr  Sales (income)               product lines            ← default sales account
  Cr  Freight Charges (income)     freight line             ← item's SaleItemAccount
Dr  Discount (contra/expense)      discount line            ← item's SaleItemAccount
  Cr  Output Tax                   (if a tax code applies)
```

Purchase side posts the line to `PurchaseItemAccount` (Al-Qahera left these at
"Suspense", i.e. unconfigured).

---

## Design

### 1. Entity — `Models/NonInventoryItem.cs` (per company)

| Field | Notes |
|---|---|
| `Id` | PK |
| `CompanyId` | **per-company scope** (FK → Company, Restrict) |
| `Name` | e.g. "Freight Charges" |
| `Code` | optional |
| `UnitName` | optional (UOM label) |
| `SaleAccountId` | nullable FK → `Account` (the "when sold" income account) |
| `PurchaseAccountId` | nullable FK → `Account` (the "when purchased" expense/asset account) |
| `DefaultLineDescription` | optional |
| `DefaultSalePrice` / `DefaultPurchasePrice` | optional (Manager autofill) |
| `HideNameOnPrint` | optional |
| `IsActive` | soft-disable |
| `ExternalRef` | migration idempotency (`mgr-niitem:{managerGuid}`) |

- Unique index `(CompanyId, Name)`.
- Account FKs are **per-company** (each company's chart of accounts differs) —
  this is why the entity is company-scoped, NOT global like ItemType.
- `SaleAccountId`/`PurchaseAccountId` nullable → fall back to Suspense at posting
  time (matches Manager's default).

### 2. Line reference (the "each does its own work" part)

Add a nullable **`NonInventoryItemId`** to the line entities that need it:
`InvoiceItem`, `PurchaseItem`, `SalesQuoteItem` (and `DeliveryItem` if freight
appears on challans — 20 cases; optional). A line has **at most one** of:
`ItemTypeId` (product), `NonInventoryItemId` (charge), or neither (free text).
Add a CHECK/guard so both aren't set at once.

### 3. Unified line dropdown (frontend)

A single picker (reuse/extend the existing item-type `SearchableSelect`) that
renders **two `<optgroup>`s**: **"Item Types"** (products) and
**"Non-Inventory Items"** (charges), with a divider. On select:
- **ItemType chosen** → set `ItemTypeId`, keep product behaviour (HS/UOM/stock/FBR).
- **NonInventoryItem chosen** → set `NonInventoryItemId`, prefill
  Description/UOM/price from the item, **skip** HS/stock/FBR classification.

### 4. GL posting — `PostingService`

When posting an invoice/bill line, resolve the credit/debit target account:
- line has `NonInventoryItemId` → use its `SaleAccountId` (sales side) /
  `PurchaseAccountId` (purchase side); fall back to Suspense if null.
- else → the default Sales / Purchases account (current behaviour).
This makes freight/discount lines land on Freight Charges / Discount, matching Manager.

### 5. Stock

Non-inventory lines **never** move stock. The stock engine keys off `ItemTypeId` /
HS code; a line with only `NonInventoryItemId` has neither, so it's naturally
skipped. Verify in `StockService` / the V2 read model that a `NonInventoryItemId`
line is ignored (add a guard if needed).

### 6. FBR consideration (important)

FBR submission is line-based and requires an HS code per line. A non-inventory
(service) line has **no HS code**, so on an **FBR-submitting** company it would
need an HS/UOM or be disallowed. **Scope for phase 1: non-inventory lines are for
non-FBR / FBR-excluded invoices** (migrated data + FBR-off companies like
Al-Qahera). For FBR companies, either (a) block non-inv lines, or (b) later add an
HS-code field to the non-inv item. Al-Qahera is FBR-off, so unblocked there.

### 7. Per-company scoping + CoA mapping

`NonInventoryItem.CompanyId` scopes it. Its account FKs point at that company's
`Account` rows. A small **Configuration → Non-Inventory Items** CRUD page
(company-selected) lets operators define them + pick the sale/purchase account
from the company's chart of accounts.

---

## Migration mapping (`ManagerImportService`)

Add a phase (masters, before documents):
1. Read `non-inventory-items` (summary) + each `non-inventory-item-form/{key}`
   (for `SaleItemAccount`/`PurchaseItemAccount`).
2. For each, create a `NonInventoryItem` for the target company, mapping the
   Manager account GUID → the company's imported `Account` **by account name**
   (the trial-balance import creates accounts by name; match on name, else leave
   null → Suspense). `ExternalRef = mgr-niitem:{guid}`.
3. In the sales-invoice / quote / bill loops: a line whose `Item` GUID is a
   non-inv item → create the line with `NonInventoryItemId` set (+ amount from
   unit price, qty 1 if blank), **not** as a product/free-text line.
4. GrandTotal stays authoritative (Manager `invoiceAmount`); the non-inv lines are
   part of that total.

This replaces the reverted "header Freight field" approach — faithful to Manager.

---

## Files touched (checklist)

**Backend**
- `Models/NonInventoryItem.cs` (new)
- `Models/InvoiceItem.cs`, `PurchaseItem.cs`, `SalesQuoteItem.cs` (+ `NonInventoryItemId`)
- `Data/AppDbContext.cs` (DbSet + FKs + unique index + both-set guard)
- new EF migration (use `dotnet ef migrations add` — worked fine this session despite the running :5134)
- `DTOs/` — `NonInventoryItemDto` + add `NonInventoryItemId` (+ name) to the line DTOs
- `Services/Implementations/NonInventoryItemService.cs` + `INonInventoryItemService` (per-company CRUD, `AssertAccessAsync`)
- `Controllers/NonInventoryItemsController.cs` (CRUD, `[HasPermission]`, `[AuthorizeCompany]`)
- `PostingService.cs` (line → mapped account)
- `InvoiceService.cs` / `SalesQuoteService.cs` / purchase paths (accept + validate `NonInventoryItemId`; no stock)
- `StockService` / V2 read model (skip non-inv lines — verify)
- `Helpers/PermissionCatalog.cs` (`noninventoryitems.list.view` / `.manage.create/update/delete`) + map the module in `myapp-frontend/src/config/permissionSections.js` + run `python scripts/verify_permission_sections.py`
- `ManagerImportService.cs` (migration phase above)

**Frontend**
- `api/nonInventoryItemApi.js` (new)
- unified line picker (extend the item-type `SearchableSelect` → two optgroups)
- `Components/InvoiceForm.jsx`, `EditBillForm.jsx`, `StandaloneInvoiceForm.jsx`, `SalesQuoteForm.jsx`, `PurchaseBillForm.jsx` (use the unified picker; handle non-inv selection)
- `pages/NonInventoryItemsPage.jsx` (Configuration → Non-Inventory Items CRUD) + route in `App.jsx` + nav in `DashboardLayout.jsx`
- print templates (non-inv lines render as ordinary lines)

**Tenant / standards (CLAUDE.md)**
- Every endpoint takes `companyId` → `_access.AssertAccessAsync`.
- Action buttons permission-gated; mobile-first; verify before push.

---

## Phased plan

1. **Entity + CRUD + management page** — `NonInventoryItem`, migration, service,
   controller, permissions, Configuration page. (Standalone; nothing else depends on it.)
2. **Line reference + unified dropdown** — `NonInventoryItemId` on line entities,
   the two-group picker, form wiring, print. (Lines can now use non-inv items.)
3. **GL posting** — `PostingService` routes non-inv lines to their mapped account;
   verify against a re-imported Al-Qahera + enable-GL (should show Freight Charges /
   Discount balances matching Manager).
4. **Migration mapping** — `ManagerImportService` creates the items + wires the lines.
5. **FBR handling** — decide block-vs-HS for non-inv lines on FBR companies (Al-Qahera unaffected).

---

## Environment / continuity notes for next session

- Branch **`feat/sales-quote-order`**; local DB **`DeliveryChallanDb`** on
  `CRKRL-HUSSAHUZ1\MSSQLSERVER2`. Migrated company = **id 2178** ("Al-Qahera Trading Co.").
- A **parallel session** has uncommitted work (WithholdingTaxReceipt feature, Client
  drilldown, attachment, supplier) — **do not commit those**; hunk-stage only your own.
- Migration exporter (with Manager Desktop open + a token): `python scripts/manager_export.py --key <token>`.
- Manager non-inv item accounts are readable at `GET /api2/non-inventory-item-form/{key}`
  (`SaleItemAccount` / `PurchaseItemAccount`); resolve GUIDs via `GET /api2/chart-of-accounts`.
- The committed Manager import lives in `14c76c1`; the reverted "header Freight" attempt is gone.

---

## Handoff command (paste into the next session)

> Read `FEATURE_NON_INVENTORY_ITEMS.md` and implement the Non-Inventory Items feature
> per that plan, starting with **Phase 1** (entity + per-company CRUD + Configuration
> page). Non-Inventory Items are a NEW per-company entity, **separate from ItemType**,
> that map to GL accounts (sale/purchase). The document line dropdown must list both
> ItemTypes and Non-Inventory Items in separate groups, each with its own behaviour
> (ItemType = product/inventory/FBR; Non-Inventory = GL account, no stock). Work on
> branch `feat/sales-quote-order` against `DeliveryChallanDb`; verify build + run before
> committing; do NOT touch the other session's uncommitted WHT/Client work; ask before
> commit and before push.

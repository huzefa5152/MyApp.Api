# Feature guide — Company-specific Item Types with per-line GL accounts (sales + purchase)

Goal: match Manager.io, where **every invoice AND purchase-bill line posts to a GL
account**, and the item you pick auto-fills that account — a default income account
on sales, a default expense/COGS account on purchases, each overridable per item.
Also: make Item Types behave **per company** (each company's own catalog + its own
GL accounts), which today they are not.

> Status: DESIGN ONLY. Nothing here is implemented yet. This is the plan.

---

## 1. Current architecture (what exists today)

- **`Models/ItemType.cs` is GLOBAL** — no `CompanyId`. It's a shared, FBR-mapped
  catalog (HS code, UOM, sale type, favourite/usage curation) reused across every
  tenant of the user (see the `ItemTypesController.GetAll` comment: "items are common
  across all tenants"). Unique index `(Name, HSCode)` filtered to `IsDeleted = 0`.
  **It carries NO GL account.**
- **`Models/CompanyItemTypeSetting.cs`** — a per-`(CompanyId, ItemTypeId)` overlay that
  ALREADY holds company-specific behaviour: `Mode` (inventory tracking override) +
  `ReorderLevel`. This is the natural home for per-company GL accounts.
- **`Models/NonInventoryItem.cs`** — per-company, HAS `SaleAccountId` / `PurchaseAccountId`
  (income / expense GL accounts). This is exactly the "item → account" mapping we want,
  but only for non-inventory lines.
- **Line models** `InvoiceItem` / `PurchaseItem` carry `ItemTypeId?` XOR
  `NonInventoryItemId?` (at most one). **Neither has a per-line `AccountId`.**
- **`Services/Implementations/PostingService.cs`** (GL engine, gated by
  `Company.GlPostingEnabled`):
  - `PostInvoiceAsync`: non-inventory lines are grouped by `NonInventoryItem.SaleAccountId`
    and posted to those accounts; **everything else lumps into a single Sales control
    account** (`ResolveSalesAsync`: `seed:sales` → an account named "Sales" → first Income
    → Suspense).
  - `PostPurchaseBillAsync`: symmetric — non-inventory lines grouped by
    `NonInventoryItem.PurchaseAccountId`; **the rest lumps into one Purchases control
    account** (`ResolvePurchasesAsync` → Suspense).

**The gap:** inventory `ItemType` lines carry no per-line GL account, so sales income
and purchase expense can't be split per line/item the way Manager does; and the account
mapping can't differ per company because `ItemType` is global.

---

## 2. Design decision — OVERLAY, don't add CompanyId to ItemType

There are two ways to make item types "company-specific":

**A. Full isolation — add `CompanyId` to `ItemType` (NOT recommended).**
Blast radius is huge: every picker/query, the `(Name,HSCode)` unique index, stock
movements, FBR submission, the shared Item Catalog admin page, and all existing rows
(shared item types used by BOTH businesses) would have to be split/cloned per company
and re-pointed on historical `InvoiceItems`/`PurchaseItems`/`StockMovements` (all
`Restrict` FKs). High risk, large migration, and you LOSE the benefit that HS codes are
genuinely universal.

**B. Per-company OVERLAY on `CompanyItemTypeSetting` (RECOMMENDED).**
Keep `ItemType` as the shared FBR-metadata catalog (HS code / UOM / sale type are the
same fact for everyone). Move everything *company-specific* — GL accounts, curation,
tracking mode, and **presence** (which item types this company actually uses) — onto
`CompanyItemTypeSetting`. Then:
- Each company sees/uses only the item types it has a `CompanyItemTypeSetting` for →
  effectively a per-company catalog.
- Each company maps the same item type to ITS OWN GL accounts.
This matches Manager's real split (HS code = universal; income/expense account =
per-business) and reuses the overlay you already have. The rest of this guide assumes B.

If you insist on A, keep the account fields on `CompanyItemTypeSetting` anyway (accounts
are per-company by nature) and treat A as an orthogonal, separate migration.

---

## 3. Schema changes

### 3.1 `CompanyItemTypeSetting` — add GL mapping
```
public int?  SaleAccountId     { get; set; }   // income account for SALES lines of this item type (this company)
public int?  PurchaseAccountId { get; set; }   // expense/COGS account for PURCHASE lines
public Account? SaleAccount     { get; set; }   // nav
public Account? PurchaseAccount { get; set; }   // nav
// null on either = "use the company default" (see §4). Setting a value = Manager's
// "Custom income/expense account" override.
```
FK → `Accounts` with `OnDelete(Restrict)` (never orphan a posted line's account).
No new unique constraints. Migration is purely additive (new nullable columns).

### 3.2 Company-level default accounts (the fallback both item-types resolve to)
Reuse the existing resolver defaults, but make them configurable so a company can pin
its "Inventory – sales" / "Inventory – purchases (COGS)" accounts instead of the
name-guess chain. Add to `Company` (or a small `CompanyGlDefaults` row):
```
public int? DefaultSalesAccountId    { get; set; }   // default income  (Manager's "Inventory - sales")
public int? DefaultPurchaseAccountId { get; set; }   // default expense/COGS
```
Both nullable → when null, fall back to today's `ResolveSalesAsync` / `ResolvePurchasesAsync`
chain, so nothing breaks for companies that don't set them.

#### 3.2.1 Seed + route the default accounts into the CoA if they don't exist
The default inventory **sales** (income) and **purchase/COGS** (expense) accounts MUST
exist in the company's chart of accounts and be attached to the right account group, or
posting has nothing to route to. Do NOT assume they're present — **seed-if-missing**,
idempotently, mirroring the existing on-demand pattern (`PostingService.SuspenseAsync`
creates the Suspense account tagged `ExternalRef = "seed:suspense"`; `ResolveSalesAsync`
already looks for `seed:sales`, `ResolvePurchasesAsync` for `seed:cogs`).

Add an `EnsureDefaultInventoryAccountsAsync(companyId)` that, per company:
1. **Sales income** — find by `ExternalRef == "seed:inv-sales"` (or reuse `seed:sales`);
   if absent, **create** an `Account` (Name "Inventory – sales", `AccountType = Income`,
   `ExternalRef = "seed:inv-sales"`, `IsActive = true`) and **route it** under a
   `FinancialStatement.ProfitAndLoss` income `AccountGroup` for that `CompanyId`
   (create/find the group too — e.g. "Income"/"Sales"), so it shows on the P&L.
2. **Purchase/COGS expense** — find by `ExternalRef == "seed:cogs"` (or
   `seed:inv-purchases"`); if absent, **create** ("Cost of goods sold" / "Inventory –
   purchases", `AccountType = Expense`, `ExternalRef`, active) under a
   `FinancialStatement.ProfitAndLoss` expense group.
3. Point `Company.DefaultSalesAccountId` / `DefaultPurchaseAccountId` (§3.2) at whatever
   was found/created, so §4 resolves to a real, correctly-placed CoA account rather than
   the name-guess fallback or Suspense.

Lookup is by `ExternalRef` (stable, survives renames) so it's safe to re-run — never
create a duplicate. Call it when GL is enabled for the company (`GeneralLedgerService`
enable path), at company setup, and defensively inside the resolver (same lazy
create-on-demand as `SuspenseAsync`) so a first post can't fail for lack of the account.
The perpetual-GL importer (`BuildPerpetualGlAsync`) already creates a full CoA, so for
migrated companies these accounts usually exist — `EnsureDefault…` just adopts them.

### 3.3 Per-line account (for full Manager parity — editable Account column)
```
// on BOTH InvoiceItem and PurchaseItem
public int? AccountId { get; set; }   // resolved+editable GL account for this line; null = derive at post time
public Account? Account { get; set; } // nav
```
Additive + nullable → `null` means "engine derives it" = exactly today's behaviour, so
existing rows and companies with GL off are unaffected.

---

## 4. Account resolution order (the core rule)

For a SALES line, the posting account is the first non-null of:
1. `line.AccountId` (operator edited it on the line), else
2. `NonInventoryItem.SaleAccountId` (if the line is a non-inventory item), else
3. `CompanyItemTypeSetting.SaleAccountId` for `(companyId, itemTypeId)` (per-item-type override), else
4. `Company.DefaultSalesAccountId` (company default "Inventory – sales"), else
5. `ResolveSalesAsync` today's chain (`seed:sales` → "Sales" → first Income → Suspense).

PURCHASE line is symmetric with `PurchaseAccountId` / `DefaultPurchaseAccountId` /
`ResolvePurchasesAsync`. Unresolved/inactive account → **Suspense** (the engine's
existing invariant — never drop an amount).

---

## 5. Auto-fill on the form (sales AND purchase)

The line-item dropdown already lists Item Types + Non-Inventory Items (separate groups).
On selecting a line item, resolve and pre-fill `line.AccountId` using steps 2→4 of §4
(non-inventory account, else per-company item-type account, else company default), and
show it in an editable **Account** column (mirror Manager). Applies identically to the
Invoice/Bill form and the Purchase Bill form. Purchase side uses the purchase accounts.

While here, consider matching Manager's other item auto-fills (optional, per item-type
setting): unit price, UOM, tax code, division, line description — you already inherit
HS/UOM/SaleType from `ItemType`; the account is the missing one.

Gate the whole Account column behind `Company.GlPostingEnabled` (or a lighter "show GL
account column" flag) so non-GL companies (e.g. Al-Qahera snapshot) don't see it.

---

## 6. Posting engine changes

- **`PostInvoiceAsync`**: replace "non-inventory split + single Sales remainder" with a
  group-by over the §4-resolved account for **every** line (inventory + non-inventory +
  plain), summing net per account, crediting each; AR debit + GST credit unchanged.
- **`PostPurchaseBillAsync`**: same on the expense side (debit each resolved purchase
  account; AP credit + input-tax debit unchanged).
- Keep the Suspense plug so entries always balance.
- This is what actually splits the P&L by account like Manager. Only runs when GL is on.

Note: the **perpetual-GL migration (`ManagerImportService.PerpetualGl.cs`
`BuildPerpetualGlAsync`) already posts per-line by the Manager line's Account/Item** —
so historical books are already faithful; this section only brings the LIVE engine to
parity.

---

## 7. Making the catalog effectively company-specific (pickers)

- **Item Type pickers on documents**: scope to item types the company uses — i.e. those
  with a `CompanyItemTypeSetting` row for `companyId` (create the row lazily the first
  time a company favourites/uses an item type). This gives each company its own working
  set without touching the global rows.
- **Item Catalog admin page**: keep it able to browse the shared FBR catalog, but edit
  the *company overlay* (accounts, tracking, reorder, favourite) in the context of the
  selected company. The account fields are per-company by construction.
- Moving curation (`IsFavorite`, `UsageCount`, `LastUsedAt`) from the global `ItemType`
  onto `CompanyItemTypeSetting` is optional but recommended (today one tenant's usage
  skews another's "favourites"). Do it in a later phase to limit blast radius.

---

## 8. Migration / backfill

1. EF migration: add the nullable columns (§3.1–3.3). Additive; safe on the live DB.
2. Backfill `CompanyItemTypeSetting` rows for every `(CompanyId, ItemTypeId)` pair that
   already appears on that company's `InvoiceItems` / `PurchaseItems` / stock (so each
   company "owns" the item types it has used), leaving accounts null (→ company default).
3. Run `EnsureDefaultInventoryAccountsAsync(companyId)` (§3.2.1) per GL-enabled company:
   seed the "Inventory – sales" income + "COGS/Inventory – purchases" expense accounts
   into the CoA under the right P&L groups **if they don't already exist**, and point
   `Company.DefaultSalesAccountId` / `DefaultPurchaseAccountId` at them — so defaults
   resolve to a real, correctly-routed CoA account rather than the name-guess chain.
4. No data change for companies with GL off — accounts stay null, behaviour unchanged.

---

## 9. Cross-cutting impacts to respect

- **Tenant isolation**: every new endpoint that reads/writes `CompanyItemTypeSetting`
  accounts must `_access.AssertAccessAsync(CurrentUserId, companyId)`; verify each
  `AccountId` belongs to the SAME company's CoA (cross-tenant link guard).
- **FBR**: unaffected — HS code / UOM / SaleType still come from the shared `ItemType`.
  GL accounts are orthogonal to FBR submission.
- **Stock**: unaffected — inventory movement keys off `ItemTypeId`, not the account.
- **GL flag**: all posting/account behaviour stays behind `Company.GlPostingEnabled`;
  the account column is hidden when off. Backward-compatible (null = today).
- **Permissions**: reuse/extend the accounting + item-type permission keys; account
  mapping edits are a config action (`config.*` / `stock.policy.manage`-style).

---

## 10. File checklist (approx.)

- `Models/CompanyItemTypeSetting.cs` (+`Account` nav), `Models/Company.cs` (defaults),
  `Models/InvoiceItem.cs`, `Models/PurchaseItem.cs` (`AccountId`).
- `Data/AppDbContext.cs` — FK configs (Restrict), new migration under `Migrations/`.
- `DTOs/` — item-type-setting DTO (+ account ids), invoice/bill line DTOs (+ `accountId`),
  print DTOs unchanged.
- `Services/Implementations/PostingService.cs` — group-by-resolved-account for invoice
  + purchase; a shared `ResolveLineAccountAsync(line, isSale)` helper implementing §4.
- Item-type service/controller — expose/scope the company overlay; account CRUD.
- Frontend: line-item dropdown auto-fill + editable **Account** column (gated),
  item-type settings UI for the account mapping.
- Tests: extend `scripts/test_stock_v2_lifecycle.py` / a GL posting test to assert
  per-line account splitting on both sales and purchase; tenant-isolation case for the
  new account endpoints.

---

## 11. Phased plan

1. **Schema + defaults** (§3) — additive migration, no behaviour change.
2. **Resolver + posting** (§4, §6) — engine splits by resolved account; still lumps to
   company default until mappings are set. Verify GL still reconciles on a test company.
3. **Item-type account mapping UI + auto-fill** (§3.1, §5) — operators can map accounts;
   forms pre-fill the line account.
4. **Editable per-line Account column** (§3.3) — full Manager parity.
5. **Company-scoped pickers + curation move** (§7) — item types become per-company.

Ship 1–2 behind GL-off no-ops; 3–5 are where the Manager-like behaviour becomes visible.

---

## 12. Verification

- GL reconciliation on a fresh test company (NOT 2178/2190): create a sales invoice and
  a purchase bill mixing inventory + non-inventory lines with distinct mapped accounts →
  enable GL → assert the trial balance credits/debits split across the mapped accounts
  (not a single Sales/Purchases lump), and the balance sheet still balances.
- Backward-compat: a company with all accounts null posts identically to today.
- Tenant isolation + cross-tenant account guard tests.
- Follow the repo standards (build 0 errors, audit/basic/tenant/stock scripts green)
  before any push.

---

### TL;DR
You already have the non-inventory half (`NonInventoryItem.Sale/PurchaseAccountId` +
per-account posting) and the per-company overlay (`CompanyItemTypeSetting`). Add
`SaleAccountId`/`PurchaseAccountId` to that overlay + company default accounts + a
nullable per-line `AccountId`, resolve per §4, and make `PostInvoiceAsync` /
`PostPurchaseBillAsync` group by the resolved account. That gives Manager-style
per-line GL posting on BOTH sales and purchases and makes item types company-specific —
without the risk of putting `CompanyId` on the shared `ItemType` catalog.

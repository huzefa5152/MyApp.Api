# Feature guide — Company/Division item types + per-line GL posting

Runbook for the "company-specific item types with per-line GL accounts" feature
(shipped 2026-07-14). Read this first if you're debugging or extending anything
about item-type → GL-account mapping, the per-line `AccountId`, the P&L split on
invoices/purchase bills, or the Item Catalog company/division UI.

> This is a durable `*_GUIDE.md` runbook (kept, per `CLAUDE.md` doc-lifecycle).
> The original design doc `FEATURE_ITEMTYPE_COMPANY_GL.md` was folded into this
> and deleted.

---

## 1. What it does

Manager-style GL behaviour: **every invoice AND purchase-bill line posts to a GL
account**, and the item you pick auto-fills that account — a default income
account on sales, a default expense/COGS account on purchases, overridable per
item **and** per line. Item types are also made **per-company** (each company's
own GL mapping + optional division scope) without cloning the shared FBR catalog.

Everything here is **gated behind `Company.GlPostingEnabled`**. With GL off,
behaviour is byte-identical to before (all fields are nullable; null = derive).

---

## 2. Core design decision — OVERLAY, not `CompanyId` on `ItemType`

`ItemType` stays the **GLOBAL** FBR-metadata catalog (HS code / UOM / sale type
are the same fact for every tenant — no `CompanyId`). All per-company data lives
on the existing per-`(company, item-type)` overlay **`CompanyItemTypeSetting`**.
This avoids re-pointing historical `InvoiceItems`/`PurchaseItems`/`StockMovements`
(all `Restrict` FKs) and keeps HS codes universal.

**The overlay's unique index stays `(CompanyId, ItemTypeId)`** — one row per pair.
`DivisionId` is a scope **tag**, NOT part of the key, so the inventory-tracking
lookups that do `.ToDictionary(ItemTypeId)` (`StockService.GetStockTrackedItemTypeIdsAsync`,
`InventoryReadService` reorder levels) stay 1:1 and untouched. ⚠️ **Do not add
`DivisionId` to that unique index** — it would break those dictionaries and the
pinned inventory tests.

---

## 3. Schema (migration `20260714064510_AddItemTypeCompanyGlAccounts`, additive)

| Table | Columns added | Notes |
|---|---|---|
| `CompanyItemTypeSettings` | `DivisionId?`, `SaleAccountId?`, `PurchaseAccountId?` | FKs **NoAction** (Division already cascades from Company; two Account FKs from one table would trip SQL 1785). `DivisionId` null = company-wide. |
| `Companies` | `DefaultSalesAccountId?`, `DefaultPurchaseAccountId?` | **Bare scalar columns, no FK/nav** — a real FK would make a Company↔Account cascade cycle. Validated in code. |
| `InvoiceItem`, `PurchaseItem` | `AccountId?` (+ `Account` nav) | Per-line override. FK **NoAction**. null = engine derives. |

All nullable → safe on the live DB; existing rows and GL-off companies unaffected.
Migration was generated with `dotnet ef migrations add … --configuration Release`
so it built into `bin/Release` and didn't fight a running Debug app's `bin` lock.

---

## 4. Account resolution order (`PostingService.GroupLinesByAccountAsync`)

Per document line, the posting account is the **first ACTIVE non-null** of:

- **Non-inventory line** (`NonInventoryItemId` set): `line.AccountId` →
  `NonInventoryItem.Sale/PurchaseAccountId` → **Suspense** (a non-inv item's job
  IS its mapped account; unmapped pools on Suspense, exactly as before).
- **Otherwise** (inventory item-type / plain line): `line.AccountId` →
  `CompanyItemTypeSetting.Sale/PurchaseAccountId` for `(companyId, itemTypeId)` →
  `Company.DefaultSales/PurchaseAccountId` → the classic fallback
  (`ResolveSalesAsync` = seed:sales → "Sales" → first Income → Suspense;
  `ResolvePurchasesAsync` = Inventory control if tracking → seed:cogs → first
  Expense → Suspense).

Any rounding **residual** (`net − Σ assigned`) plugs to the fallback account so
the split always sums to the document net and the entry balances (AR/AP + tax
legs are unchanged). `PostInvoiceAsync` / `PostPurchaseBillAsync` group **every**
line by its resolved account. Credit/Debit notes flip direction and **mirror the
original line's `AccountId`/`NonInventoryItemId`** so a reversal hits the same
accounts.

`EnsureDefaultInventoryAccountsAsync(companyId)` (called from
`GeneralLedgerService.EnableAsync`, idempotent) adopts `seed:sales`/`seed:cogs`
(or creates "Inventory – sales" / "Cost of goods sold" under P&L groups) and pins
`Company.Default*`. The purchase default is **inventory-aware** (Inventory-asset
control account for tracking companies, else COGS) so pinning it is
behaviour-neutral vs `ResolvePurchasesAsync`.

---

## 5. File map

| Layer | File |
|---|---|
| Overlay model | `Models/CompanyItemTypeSetting.cs` |
| Company defaults | `Models/Company.cs` |
| Per-line account | `Models/InvoiceItem.cs`, `Models/PurchaseItem.cs` |
| FK config | `Data/AppDbContext.cs` (search `CompanyItemTypeSetting`, `ii.Account`, `pi.Account`) |
| Posting split + defaults | `Services/Implementations/PostingService.cs` (`GroupLinesByAccountAsync`, `EnsureDefaultInventoryAccountsAsync`, `EnsurePlGroupAsync`, `FlagsAsync` cache) + `Services/Interfaces/IPostingService.cs` |
| GL enable hook | `Services/Implementations/GeneralLedgerService.cs` (`EnableAsync`) |
| Overlay CRUD + reads | `Services/Implementations/ItemTypeService.cs` (`UpsertOverlayAsync` — gated on `dto.WriteCompanyOverlay`; `ApplyOverlayAsync`) + `Services/Interfaces/IItemTypeService.cs` + `Controllers/ItemTypesController.cs` (asserts `_access` on `companyId`) |
| Per-line passthrough | `Services/Implementations/InvoiceService.cs` + `PurchaseBillService.cs` (`ValidCompanyAccountIdsAsync` + `Coerce` — foreign/inactive id → null) |
| DTOs | `DTOs/ItemTypeDto.cs` (+`WriteCompanyOverlay`), `DTOs/InvoiceDto.cs`, `DTOs/PurchaseBillDto.cs` |
| Item Catalog UI | `myapp-frontend/src/pages/ItemTypesPage.jsx` (company dropdown, Division/GL column) + `myapp-frontend/src/Components/ItemTypeForm.jsx` (`showGlMapping` → Division + account pickers) |
| Editable per-line Account column | `myapp-frontend/src/Components/PurchaseBillForm.jsx` (gated on `glOn`, auto-fills from item overlay) |
| Test | `scripts/test_accounting_gl.py` suite **14** (per-line split) |

---

## 6. Prerequisites / flags

- GL: `Company.GlPostingEnabled = true` (enable via `POST /api/accounting/gl/company/{id}/enable`, perm `accounting.gl.manage`).
- Overlay account pickers on the form need the caller to have `accounting.coa.view` (the flat-accounts fetch) and a CoA to exist; column/section auto-hides otherwise.
- `POST/PUT /api/itemtypes?companyId=X` upserts the overlay ONLY when the body has `writeCompanyOverlay: true` — so the bill-form quick-create (which passes `companyId` only for FBR enrichment) never clobbers the overlay.

---

## 7. How to verify

- **Automated (ephemeral company):** `python scripts/test_accounting_gl.py --base http://localhost:5134` → 71/71, incl. suite 14 proving a mapped item's net lands on its own account, not the Sales lump. (Default base is 5199 — pass `--base`.)
- **Real-data smoke (done 2026-07-14 on Jorbai Groups id=5, V2 + GL on):** create a temp item type mapped to real income/expense accounts + a division, then Purchase (IN 100) → Sales Order (commit 30) → Challan (deliver 30) → Bill (physical OUT → on-hand 70). On-hand tracked correctly at every stage; sale net → mapped income, purchase net → mapped expense; trial balance balanced; deletes reversed cleanly. **Note (V2):** physical stock leaves at **bill** time, not challan time (challan only moves the *delivered* bucket).
- Full pre-push suite: `dotnet build` (0 err), `test_basic_flows`, `test_tenant_isolation`, `test_stock_itemtype_reflow` (76/76), `test_stock_v2_lifecycle` (29/29), `verify_audit_2026_05_13_security.py` (67/67), `verify_permission_sections.py`.

---

## 8. Debugging map (symptom → look here)

- **Sale/purchase lumps on one account (no split):** GL off? item type has no overlay row for that company AND `Company.Default*` null → falls to the `Sales`/`Purchases` chain — that's expected. Check `CompanyItemTypeSettings` for a `(CompanyId, ItemTypeId)` row with `SaleAccountId`/`PurchaseAccountId`.
- **Line posts to Suspense:** the resolved account is inactive or belongs to another company (coerced away). `LoadAccountsAsync` only loads `IsActive` accounts of the company.
- **Overlay not saving from the Item Catalog form:** confirm the request carried `writeCompanyOverlay: true` and a `companyId`; the controller also asserts tenant access on `companyId`.
- **"Selected division does not belong to this company":** `UpsertOverlayAsync` rejects a `DivisionId` whose `CompanyId` ≠ the item's company (cross-tenant guard).
- **Entry unbalanced / posting throws:** the residual plug in `GroupLinesByAccountAsync` should prevent this; if it fires, check that `Σ line.LineTotal` relates to `GrandTotal − GSTAmount` for that doc.
- **Inventory not tracking:** unrelated to this feature — check `Company.InventoryTrackingEnabled` + `InventoryFlowVersion` and the overlay `Mode` (Tracked/FbrOnly), NOT the GL account fields.

---

## 9. Deferred (not yet built)

- Editable per-line **Account** column on `StandaloneInvoiceForm`, `EditBillForm`, `InvoiceForm` (only `PurchaseBillForm` has it). The sales-side P&L split still works — it just derives the account from the item-type overlay instead of offering a manual per-line override.
- Division-**filtered document pickers** (design §7): a division-scoped item type is tagged but pickers don't yet filter documents by division scope.
- Moving item-type curation (`IsFavorite`/`UsageCount`) onto the overlay (still global on `ItemType`).

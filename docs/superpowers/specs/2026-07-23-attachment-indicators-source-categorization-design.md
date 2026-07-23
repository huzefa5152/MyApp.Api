# Attachment indicators + source categorization — design

**Date:** 2026-07-23
**Branch:** `feat/sales-quote-order-flow`
**Status:** approved design, pending implementation plan

## Problem

Two gaps in the unified attachment/folder system:

1. **No at-a-glance attachment indicator on document lists.** A user browsing
   Sales Quotes, Invoices, Payments, etc. can't tell which documents carry
   attachments without opening each one. The batch-count backend endpoint
   (`GET /attachments/company/{id}/entity-counts/{entityType}?ids=`) and the
   frontend API fn `getEntityAttachmentCounts` **already exist but are unused**.

2. **No source categorization in the folder view.** Inside a folder (and the
   Uncategorized bucket) an attachment may have been uploaded directly into the
   folder OR carried in from a business document (Sales Quote, Order, Delivery
   Challan, Invoice, Purchase Bill, Goods Receipt, Payment). The DTO already
   carries `EntityType`/`EntityId`, but the UI shows neither the source nor a
   way to filter by it, and there is no human doc number — only a raw id.

## Decisions (locked)

- **Badge is clickable** → opens the document's attachments in a lightweight
  modal (view/download, and upload if permitted) without full edit.
- **Badge hidden at count 0** (no "0 📎" clutter).
- **Source detail = doc type + real number** (e.g. `Sales Quote #12`,
  `Credit Note #3`, `Receipt #48`), resolved server-side.
- **Source filtering is server-side** (query param + a source-summary endpoint),
  not client-side.
- **Byte storage stays on disk** — blob-in-DB is explicitly out of scope for
  this build (revisit once MonsterASP DB quota is confirmed).
- **No new permission keys** — everything reuses `attachments.list.view` /
  `attachments.manage.upload` / `attachments.manage.delete`.

## Part A — attachment count badge on document lists

### Backend
No change. Reuse existing `entity-counts/{entityType}` endpoint.

### Frontend — new reusable pieces
1. **`hooks/useEntityAttachmentCounts.js`** — `(companyId, entityType, ids)` →
   `{ [entityId]: count }`. One batch call per loaded page; refetches when the
   id set or company changes. Returns `{}` and skips the call when the user
   lacks `attachments.list.view`. Exposes a `refresh()` so a list can re-pull
   counts after the quick modal changes something.
2. **`Components/AttachmentBadge.jsx`** — paperclip + count pill. Renders
   `null` when `count` is falsy/0. Clickable (≥ 44×44 tap target); `onClick`
   opens the quick modal. Layout-agnostic inline element (works in a card's top
   row and in a table cell).
3. **`Components/AttachmentQuickModal.jsx`** — thin modal wrapping the existing
   `<AttachmentManager entityType entityId mode="edit" />`. `mode="edit"` so
   view/download/upload/delete all honor their existing permission gates inside
   AttachmentManager. On close, calls back so the list can `refresh()` counts.

### Frontend — wiring (8 list surfaces)
Each page: instantiate the hook with its ids after load, render `<AttachmentBadge>`
in the card/row, and host one `<AttachmentQuickModal>` for the currently-opened
record. ~4–6 lines per page.

| Page | entityType | id field |
|---|---|---|
| `SalesQuotePage` | `SalesQuote` | `q.id` |
| `SalesOrderPage` | `SalesOrder` | `o.id` |
| `ChallanPage` | `DeliveryChallan` | `c.id` |
| `InvoicePage` (bills + invoices tabs) | `Invoice` | `inv.id` |
| `PurchaseBillsPage` | `PurchaseBill` | `b.id` |
| `GoodsReceiptsPage` | `GoodsReceipt` | `g.id` |
| `PaymentsPage` | `Payment` | `p.id` |
| `CreditDebitNotePage` | `Invoice` | `n.id` |

Note: `Invoice` type is shared by InvoicePage and CreditDebitNotePage (notes are
Invoice rows) — counts are keyed per invoice id, so no collision.

## Part B — source categorization in the folder view (server-side)

### Backend — DTO
Add to `AttachmentDto`:
- `string? EntityNumber` — the linked document's display number (e.g. `"12"`),
  null for direct uploads.
- `string? SourceLabel` — friendly source label: `"Direct upload"`, or
  `"Sales Quote"`, `"Sales Order"`, `"Delivery Challan"`, `"Invoice"` /
  `"Credit Note"` / `"Debit Note"`, `"Purchase Bill"`, `"Goods Receipt"`,
  `"Receipt"` / `"Payment"`.

### Backend — new `Helpers/AttachmentSourceResolver.cs`
Given a `List<Attachment>` (folder or uncategorized rows), batch-resolves each
`(EntityType, EntityId)` group to its doc number + label and populates
`EntityNumber`/`SourceLabel` on the corresponding DTOs. One query per entity
type present (not per row). Sub-type handling:
- **Invoice** → `NoteKind` 0 = *Invoice*, 1 = *Debit Note*, 2 = *Credit Note*;
  number = `InvoiceNumber`.
- **Payment** → `Direction` In = *Receipt*, Out = *Payment*; number = `Number`.
- Others map 1:1 to their `*Number` field (`QuoteNumber`, `SalesOrderNumber`,
  `ChallanNumber`, `PurchaseBillNumber`, `GoodsReceiptNumber`).
- `EntityType == null` → `SourceLabel = "Direct upload"`, `EntityNumber = null`.

Only used by folder/uncategorized listings; entity listings skip it (single
source). All queries tenant-scoped by `companyId`.

### Backend — repository + service + controller
- **Source sentinel:** `"Direct"` (not a member of `AttachmentEntityTypes.All`)
  means "EntityType IS NULL". Canonical entity-type strings mean that type.
  Empty/absent = All.
- **Filtered listing:** `GetByFolderAsync` / `GetUncategorizedAsync` gain an
  optional `string? source` arg → SQL predicate (`EntityType == null` for
  `Direct`, `EntityType == canonical` for a type, no predicate for All).
  Invalid source → treated as All.
- **Source summary:** new
  `GET /attachments/company/{id}/folder/{folderId}/source-summary` and
  `.../uncategorized/source-summary` → `Dictionary<string,int>` keyed by source
  (`"Direct"`, `"SalesQuote"`, …) with only non-zero entries. Powers the filter
  chips + their counts. Tenant-guarded (`AuthorizeCompany` + `attachments.list.view`).
- Reconcile (disk self-heal) still runs on the listing path as today.

### Frontend
- **`api/attachmentApi.js`:** add optional `source` param to
  `getAttachmentsByFolder` / `getUncategorizedAttachments`; add
  `getFolderSourceSummary` / `getUncategorizedSourceSummary`.
- **`AttachmentManager.jsx` (folder/uncategorized mode only):**
  - On load, fetch the source summary → render a **filter chip row** above the
    list: `All · 📁 Direct · Sales Quote · …`, each with its count. Only
    categories present in the summary render. Selecting a chip refetches the
    listing with `source=`.
  - Each file **Row** shows a **source chip** built from `SourceLabel` +
    `EntityNumber` (e.g. `📄 Sales Quote #12`, `📁 Direct upload`). Entity mode
    is unchanged (single source, no chip/filter).
- Filter chips wrap on phone; chip text uses `-webkit-box` clamp — never
  `nowrap`+ellipsis on names (CLAUDE.md §3).

## Non-goals
- Blob-in-DB storage (deferred).
- Attachment pagination within a folder (folders hold modest volumes; add later
  if a tenant accumulates thousands).
- New permission keys.

## Testing
- Extend `scripts/test_basic_flows.py` (or a focused attachment script) to
  assert: entity-count badge numbers; resolver returns correct number + label
  per entity type including Invoice note sub-types and Payment Receipt/Payment;
  `source-summary` counts; `source=` filtering (Direct vs a type vs All);
  tenant isolation on the new summary endpoints.
- `dotnet build MyApp.Api.csproj` → 0 errors.
- Frontend `npm run build` clean; DOM-verify badge renders (svg width > 0) and
  the quick modal opens, per the icon-button verification rule.
- README `## Changelog` entry (newest first).

## Files touched (anticipated)
**Backend:** `DTOs/AttachmentDto.cs`, `Helpers/AttachmentSourceResolver.cs`
(new), `Services/Implementations/AttachmentService.cs`,
`Services/Interfaces/IAttachmentService.cs`,
`Repositories/Implementations/AttachmentRepository.cs`,
`Repositories/Interfaces/IAttachmentRepository.cs`,
`Controllers/AttachmentsController.cs`, `Helpers/AttachmentMapper.cs` (populate
new fields as null by default).
**Frontend:** `hooks/useEntityAttachmentCounts.js` (new),
`Components/AttachmentBadge.jsx` (new), `Components/AttachmentQuickModal.jsx`
(new), `api/attachmentApi.js`, `Components/AttachmentManager.jsx`, and the 8
list pages in the table above.

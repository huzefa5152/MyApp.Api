# Purchases for customer documents — design

Line: `customize-solution-for-other` (built on `customize-multi-challan-purchase`, local until reviewed).
Status: approved design, not built. Delete this file once built and verified.

## Problem

A customer demand moves through three documents: a sales order line becomes a
challan line (`DeliveryItem.SalesOrderItemId`), which becomes a sale bill line
(`InvoiceItem.DeliveryItemId` / `InvoiceItem.SalesOrderItemId`). The purchase
screen has a separate flow per document, and they do not know about each other:

| Purchase against | Link stored | Remaining tracked |
|---|---|---|
| Sale bill | `PurchaseItemSourceLine` (N:M to sale bill lines) | per sale bill line |
| Sales order | none — copies text lines | no |
| Delivery challan | `PurchaseItem.SourceDeliveryItemId` (unpushed) | per challan line |

So the same goods can be bought three times, and the page has four create
buttons and seven buttons per row.

## Goal

One way to record a purchase. Whichever document the user starts from, the
system knows what the customer wants and what is already bought, so nothing is
bought twice. Each purchase line says which customer document it serves.
Purchases without a customer document (stock, expenses) stay possible.

## 1. Business logic

### Trail

A **trail** is one customer demand followed through its stages. Its root is:

1. a sales order line, if one exists;
2. else a challan line with no `SalesOrderItemId`;
3. else a sale bill line with no `DeliveryItemId` and no `SalesOrderItemId`.

Members: the root, the challan lines whose `SalesOrderItemId` is the root, and
the sale bill lines whose `DeliveryItemId` is a member challan line or whose
`SalesOrderItemId` is the root.

Excluded from every count: cancelled documents, demo documents, credit and debit
notes (`DocumentType` 9 / 10), and a cancelled sales order's undelivered rest.

### Quantities

- **Ordered** = the sales order line's quantity (0 when no order).
- **Delivered** = sum of member challan lines (`DeliveredQuantity ?? Quantity`).
- **Billed** = sum of member sale bill lines.
- **To buy** = max(Ordered, Delivered, Billed). Over-delivery and over-billing
  are covered; a partly delivered order still shows its full order.
- **Bought** = sum of `PurchaseItemSources.Quantity` on any member line,
  excluding the bill being edited.
- **Legacy whole-challan auto bills** (`PurchaseBill.SourceDeliveryChallanId`
  set, no source rows) count every line of that challan as fully bought — the
  rule already in `ChallanPurchases.PurchasedAsync`.
- **Left** = To buy − Bought. A trail with Left ≤ 0 is not offered.

Buying against any stage consumes the whole trail: buy a sales order line in
full and its challan lines and bill lines show nothing left; buy part of it and
every stage shows the same remainder.

### Rules (one shared helper, replacing `Helpers/ChallanPurchases.cs`)

On create and update of a purchase bill:

- Each source line is loaded with its document; it must belong to the bill's
  company, and its document must not be cancelled or demo. Otherwise:
  "A customer document line on this bill was not found." (generic, no oracle).
- Trail rows are locked (`UPDLOCK, HOLDLOCK`) before Left is computed, so two
  simultaneous saves cannot both take the same remainder.
- Per trail, the quantity claimed on this bill must not exceed Left:
  "Order #12 → DC #101: only 40 Pcs of Bolt left to buy."
- The same trail may appear on only one row of a bill unless that row is a
  combined row (below).
- A combined row's source quantities must add up to the row's quantity.
- Backfill: a challan line with no supplier or cost takes the purchase's
  supplier and unit price (kept from the challan-line work).

On the customer documents, once any member line is bought:

- the document cannot be cancelled;
- a bought line cannot be deleted, nor its quantity reduced below what is bought
  on its trail;
- partial-billing leave-out and row merge stay refused for purchased challans
  (existing behaviour, read from the new helper).

**Create purchase bills** on a challan stays, and buys only what is left on each
trail (lines with nothing left are skipped; none left → refused).

### Combine same items

A switch in the picker. Picked lines with the same item type (or non-inventory
item), same unit and same unit cost merge into one purchase row, which keeps one
source entry per picked line with that line's quantity.

## 2. Storage

New table `PurchaseItemSources`:

| Column | Type | Notes |
|---|---|---|
| Id | int identity | |
| PurchaseItemId | int | FK, cascade delete |
| SalesOrderItemId | int? | FK, NoAction |
| DeliveryItemId | int? | FK, NoAction |
| InvoiceItemId | int? | FK, NoAction |
| Quantity | decimal(28,12) | quantity this row buys for that line |

- CHECK: exactly one of the three line ids is not null.
- Index on each line id and on PurchaseItemId.
- Hard deletes of clients / companies clear these rows before deleting the lines
  (as done today for `SourceDeliveryItemId`).

Migration:

- Replaces the unpushed `20261107164946_LinkPurchaseLinesToChallanLines` (roll
  back the local `MyApp_Customize_Local` first; never applied elsewhere).
- Copies every `PurchaseItemSourceLines` row into `PurchaseItemSources` with
  `InvoiceItemId`, splitting each purchase row's quantity across its linked bill
  lines in proportion to each bill line's quantity.
- `PurchaseItemSourceLines` stays untouched for one release; its model is no
  longer read or written. Dropping it is a separate, later change.
- Sales-order purchases made before this change stored no link and cannot be
  backfilled; those orders show as unbought. Say so in the changelog.

## 3. API

### Read — `GET /api/purchasebills/company/{companyId}/awaiting-lines`

Query: `supplierId`, `allSuppliers`, `search`, `groupBy=latest|order|bill`,
`excludeBillId`.

- Permissions: `purchasebills.manage.create`, plus at least one of
  `salesorders.list.view`, `challans.list.view`, `invoices.list.view`; lines from
  a document type the caller cannot view are not returned.
- `[AuthorizeCompany]` + `AssertAccessAsync`, division scope applied to every
  document, `excludeBillId` must belong to the company (404 otherwise).
- Supplier filter: lines planned for that supplier (challan line `SupplierId`)
  or planned for nobody, unless `allSuppliers`.
- Search: any sales order / challan / bill number in the trail, customer name,
  PO, item description.
- Newest 100 cards. Card = one document (by `groupBy`), lines = trails with
  Left > 0, each carrying: the line id and kind to link, trail numbers, Ordered,
  Delivered, Billed, Bought, Left, unit, item type / non-inventory item, planned
  supplier, cost.
- `groupBy=latest`: each trail under its newest document.
  `groupBy=order`: under its sales order; trails without one in a "No sales
  order" card. `groupBy=bill`: under its sale bill; unbilled trails in a "Not
  billed yet" card. A trail appears once per grouping.

### Write — purchase bill create / update

Each item gains `sources: [{ kind: "order" | "challan" | "bill", lineId, quantity }]`,
replacing `sourceDeliveryItemId` and `sourceInvoiceItemIds`. Division access is
asserted for every source document. Responses carry, per item, its trail tags
(document kind, number, customer) and, per bill, the distinct customer documents
it serves.

### Retired once unused

`GET /api/invoices/company/{id}/awaiting-purchase`, the sale-bill purchase
template endpoint, `open-challan-lines`, and the page's sales-order prefill.

## 4. Screens

### Purchase Bills page

- Header: one button, **New purchase bill**.
- Rows (table and phone cards): **View** and **Edit**; Print, PDF, Record
  payment, Copy and Delete in a **⋯** menu (permission-gated as today).
- A "For" column with trail tags (`SO #12 · DC #101 · Bill #55`).
- Source filter: **For customer documents / Stock & other**.

### Purchase bill form

- Supplier first. With no lines, the lines area offers two large choices:
  **Pick from customer documents** and **Enter lines myself**.
- Afterwards a small **+ From customer documents** link above the lines, and a
  "For" strip listing the documents served.
- Each line shows its trail tag; the full trail in its title.

### Picker — "What are you buying for?"

- Top: Supplier (with **+ New**), Search, **Group by** (Latest step / Sales
  order / Sale bill), "Show lines planned for other suppliers".
- Cards: header `Challan #101 · Sample Textiles · from SO #12`, tick-all
  checkbox, line count.
- Rows: stage chip (Ordered / Delivered / Billed), "100 ordered · 60 delivered ·
  20 bought", planned-supplier chip, qty box with "of 80 left · Rs cost".
- Footer: **Combine same items**, "N lines from M documents · Rs total",
  **Add to bill**.
- Responsive at 375 / 768 / 1280, no horizontal scroll.

### Starting from a customer document

A **Buy** entry in the row menu of a sales order, challan and sale bill opens a
new purchase with the picker searched to that document. No new header buttons.

## 5. Testing

- New `scripts/test_purchase_demand.py` (absorbs
  `test_challan_line_purchases.py`): buying at each stage consumes the trail;
  partial buys; the three groupings; combine; over-buy refusal; duplicate trail;
  order / challan / bill locks; Create purchase bills buys only what is left;
  legacy proportional counts and legacy auto bills; foreign and cancelled lines;
  a non-admin user of another company; simultaneous saves.
- Must stay green: `test_stock_itemtype_reflow.py` (pre-push gate),
  `test_basic_flows.py`, `test_partial_billing.py`,
  `test_challan_supplier_purchase_preview.py --customize`,
  `verify_no_production_identifiers.py`.
- Browser check of page, form and picker at 375 / 768 / 1280.
- README changelog entry; CLAUDE.md test-table row replaced.

## Out of scope

- Ports to Trader, Importer or master.
- Dropping `PurchaseItemSourceLines`.
- Goods receipts.

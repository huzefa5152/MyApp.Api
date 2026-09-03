# MyApp ERP - Delivery Challan & Invoicing System

![.NET](https://img.shields.io/badge/.NET-9.0-512BD4?logo=dotnet&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![SQL Server](https://img.shields.io/badge/SQL%20Server-2022-CC2927?logo=microsoftsqlserver&logoColor=white)
![FBR](https://img.shields.io/badge/FBR-DI%20V1.12-green)
![AI](https://img.shields.io/badge/AI-Gemini%202.0%20Flash-4285F4?logo=google&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green.svg)

A full-stack ERP system for Pakistani businesses to manage the complete **Purchase Order -> Delivery Challan -> Invoice -> FBR Submission** workflow. Built with ASP.NET Core 9 and React 19, featuring AI-powered PO parsing, FBR Digital Invoicing integration, customizable print templates, and multi-company support.

---

## Features

### Core Business

- **Multi-Company Support** - Manage multiple business entities with independent challan/invoice numbering
- **Client Management** - Clients with FBR-required fields (NTN, STRN, CNIC, Province, Registration Type)
- **Delivery Challans** - Create, track, and manage deliveries with automatic status workflow
- **Invoicing** - Bundle multiple challans into invoices with GST calculations and amount-in-words
- **Item Types & Lookups** - Autocomplete item descriptions and units, auto-create on first use

### FBR Digital Invoicing

- **Full V1.12 API Integration** - Submit invoices to FBR and receive Invoice Reference Numbers (IRN)
- **Sandbox + Production** - Test with 28 FBR scenarios before going live
- **Reference Data** - HS codes, provinces, UOM, sale types, SRO schedules from FBR API
- **FBR Readiness Validation** - Auto-detects missing fields and shows warnings per challan
- **Registration Status Check** - Verify buyer NTN/STRN against FBR database

### AI-Powered PO Import

- **PDF Upload** - Extract PO data from any PDF format using AI
- **Text Paste** - Parse pasted PO text with regex (LLM fallback)
- **Google Gemini 2.0 Flash** - Free AI parser (1500 req/day) for unstructured documents
- **Auto-fill** - Extracted items populate challan form automatically
- **Smart Lookup** - Auto-creates missing item descriptions and units

### Print & Export

- **3 Template Types** - Delivery Challan, Bill (Business Invoice), Tax Invoice
- **Visual Editor** - GrapesJS drag-and-drop template builder
- **Code Editor** - Direct HTML/CSS editing with 200+ merge fields
- **Excel Export** - Upload Excel templates, export filled documents
- **PDF Generation** - Client-side PDF via jsPDF + html2canvas

### Administration

- **JWT Authentication** - 8-hour token expiry, BCrypt password hashing
- **Role-Based Access** - Admin and User roles
- **User Management** - Create, edit, delete users (Admin only)
- **Audit Logging** - All errors/warnings logged with request details
- **Profile Settings** - Avatar upload, password change

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | ASP.NET Core 9, C# 13 |
| **ORM** | Entity Framework Core 9 |
| **Database** | SQL Server 2019+ |
| **Frontend** | React 19, React Router 7 |
| **UI** | Bootstrap 5 |
| **Build** | Vite 7 |
| **PDF Parsing** | UglyToad.PdfPig |
| **AI** | Google Gemini 2.0 Flash |
| **FBR API** | V1.12 (REST/JSON) |
| **Excel** | ClosedXML |
| **PDF Export** | jsPDF + html2canvas |
| **Template Editor** | GrapesJS + Handlebars |
| **CI/CD** | GitHub Actions + FTP Deploy |

---

## Architecture

```
                    React SPA (Vite + React 19)
                              |
                              v
               ASP.NET Core 9 Web API (15 controllers)
                              |
          +-------------------+-------------------+
          |                   |                   |
     Services            Repositories         External APIs
  (business logic)      (data access)              |
          |                   |              +-----+-----+
          v                   v              |           |
     Entity Framework Core 9            FBR Gateway  Gemini AI
          |
          v
      SQL Server (12 tables, 45+ migrations)
```

### Domain Model

```
Company ----< Client
   |              |
   +----< DeliveryChallan >---- Client
   |           |         \
   |           |          +--- Invoice
   |           |                  |
   |      DeliveryItem       InvoiceItem
   |           |                  |
   +----< PrintTemplate     (linked via DeliveryItemId)
   |
   +---- FBR Config (token, province, sector...)
```

---

## Delivery Challan Workflow

```
Create Challan
     |
     +--[FBR Ready + Has PO]--> Pending ----> Invoiced
     |                              |              |
     +--[FBR Ready + No PO]---> No PO             | (delete invoice)
     |                            |                v
     +--[FBR Not Ready]----> Setup Required    Pending
     |
     +-- Any editable status ----> Cancelled
```

| Status | Meaning | Can Edit | Can Invoice |
|--------|---------|----------|-------------|
| **Pending** | Ready to invoice | Yes | Yes |
| **No PO** | Missing PO details | Yes | No |
| **Setup Required** | Missing FBR fields | Yes | No |
| **Invoiced** | Linked to invoice | No | N/A |
| **Cancelled** | User cancelled | No | No |

---

## Getting Started

### Prerequisites

- [.NET 9 SDK](https://dotnet.microsoft.com/download/dotnet/9.0)
- [Node.js 20+](https://nodejs.org/)
- [SQL Server](https://www.microsoft.com/en-us/sql-server/) (local or remote)

### Setup

```bash
# Clone
git clone https://github.com/huzefa5152/MyApp.Api.git
cd MyApp.Api

# Update connection string in appsettings.json
# "DefaultConnection": "Server=YOUR_SERVER;Database=DeliveryChallanDb;..."

# Apply migrations
dotnet ef database update

# Build frontend
cd myapp-frontend && npm install && npm run build && cd ..

# Copy frontend to wwwroot
cp -r myapp-frontend/dist/* wwwroot/

# Run (serves both API and frontend)
dotnet run --urls "http://localhost:5134"
```

Open `http://localhost:5134` - login with `admin` / `admin123`.

### Configuration

Edit `appsettings.json`:

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=...;Database=DeliveryChallanDb;..."
  },
  "Jwt": {
    "Key": "<256-bit secret key>",
    "ExpirationHours": 8
  },
  "Gemini": {
    "ApiKey": "<Google AI API key (free tier)>",
    "Model": "gemini-2.0-flash"
  }
}
```

| Config | Required | Description |
|--------|----------|-------------|
| `ConnectionStrings.DefaultConnection` | Yes | SQL Server connection string |
| `Jwt.Key` | Yes | Secret key for JWT signing (min 32 chars) |
| `Gemini.ApiKey` | No | Enables AI PO parsing ([Get free key](https://aistudio.google.com/apikey)) |
| FBR Token | No | Set per company in UI after FBR IRIS registration |

---

## API Overview

15 controllers with 70+ endpoints. Full specification in [TECHNICAL_SPEC.md](TECHNICAL_SPEC.md).

| Area | Base Route | Key Operations |
|------|-----------|----------------|
| Auth | `/api/auth` | Login, profile, password, avatar |
| Companies | `/api/companies` | CRUD, logo upload |
| Clients | `/api/clients` | CRUD, FBR fields |
| Challans | `/api/deliverychallans` | CRUD, paged list, print, cancel |
| Invoices | `/api/invoices` | Create from challans, print bill/tax |
| PO Import | `/api/poimport` | Parse PDF/text, auto-create lookups |
| FBR | `/api/fbr` | Submit, validate, reference data |
| Templates | `/api/printtemplates` | CRUD, Excel upload/export |
| Users | `/api/users` | Admin CRUD |
| Audit Logs | `/api/auditlogs` | Paged logs, summary |
| Lookups | `/api/lookup` | Item descriptions, units |
| Item Types | `/api/itemtypes` | CRUD |
| Merge Fields | `/api/mergefields` | Template field definitions |

---

## Project Structure

```
MyApp.Api/
+-- Controllers/              # 15 API controllers
+-- Services/
|   +-- Interfaces/           # Service contracts
|   +-- Implementations/      # Business logic
|       +-- DeliveryChallanService.cs   (workflow + FBR validation)
|       +-- InvoiceService.cs           (creation + calculations)
|       +-- FbrService.cs               (FBR API V1.12 client)
|       +-- POParserService.cs          (PDF/text parsing)
|       +-- LlmPOParserService.cs       (Gemini AI integration)
+-- Repositories/             # Data access layer
+-- Models/                   # 12 entity models
+-- DTOs/                     # 25+ data transfer objects
+-- Data/AppDbContext.cs      # EF Core config + seeding
+-- Migrations/               # 45+ database migrations
+-- Middleware/                # Global exception handler
+-- Helpers/                  # NumberToWords, ExcelEngine
+-- myapp-frontend/
|   +-- src/
|       +-- pages/            # 11 page components
|       +-- Components/       # Forms, lists, editors
|       +-- api/              # Axios API clients
|       +-- utils/            # Template engine, helpers
+-- wwwroot/                  # Built frontend (production)
+-- .github/workflows/        # CI/CD pipeline
+-- TECHNICAL_SPEC.md         # Detailed technical docs
+-- USER_GUIDE.md             # End-user documentation
```

---

## Deployment

Automated via GitHub Actions on push to `master`:

- **Frontend-only changes** -> Builds React, FTP-deploys static files (no app restart, ~2 min)
- **Backend changes** -> Full build, publish, stop app, FTP deploy, restart (~5 min)
- **Incremental FTP** -> Only changed files are uploaded (checksum-based sync)

Publish output optimized from 79 MB to 37 MB via:
- Excluded design-time DLLs (`PrivateAssets=all`)
- English-only satellite assemblies
- No PDB files in Release builds

---

## Documentation

| Document | Audience | Description |
|----------|----------|-------------|
| [TECHNICAL_SPEC.md](TECHNICAL_SPEC.md) | Developers | Full API spec, database schema, workflows |
| [USER_GUIDE.md](USER_GUIDE.md) | End Users | Step-by-step usage guide with screenshots |

---

## Changelog

### 2026-09-04 — Reversing a sale gives the goods back

- **A credit note that reverses a bill in full now releases its delivery challans.** Until now the challans stayed marked Invoiced against the reversed bill, so the goods could never be billed again on a fresh number — they simply disappeared from the pending list. Three challans were stranded that way behind bills 3912 and 3913. A **partial** credit note still leaves them billed: part of that bill stands.
- **You can record that an invoice was cancelled on the FBR portal.** FBR allows a filed invoice to be withdrawn there within 72 hours. The bill → **Correct** dialog has a new option for it, showing the IRN, when it was filed and how much of the 72 hours is left. Recording it releases the challans and returns the stock, and needs **no credit note** — useful when the customer never received the invoice.
- **It is a marker, not a void.** The bill keeps its number and its IRN and stays in the list with a red **FBR CANCELLED** badge. It is not hidden, because it was genuinely filed and then withdrawn, and that history matters.
- **Stock comes back exactly once.** If a credit note with "affects stock" already returned the goods, recording the FBR cancellation afterwards will not return them a second time.
- **The Sales Report no longer counts a reversed sale.** An FBR-cancelled bill, and one that a credit note has reversed in full, both drop out. That report lists sale invoices only and never shows the offsetting note, so leaving them in reported revenue that had been given back in its entirety. A partly reversed bill still appears.

### 2026-08-09 — Customer Document Handover status

- **New "Documents" status on the Invoices + Credit/Debit-Note views** answering one question per FBR-submitted invoice: *have the printed customer copies (Bill + Tax Invoice) been physically handed to the customer?* Shown as a **Pending 🟡 / Delivered 🟢 / — (n/a)** badge, kept deliberately separate from the FBR-submission and payment statuses (print history is **not** a proxy for handover).
- **Actions (all permission-gated):** per-row **Mark Delivered** (optional remark) and **Revert to Pending**, plus a **bulk "Mark delivered"** that flips every Pending row matching the current filters, and a server-side **All / Pending / Delivered** filter. New permissions `invoices.docs.deliver` and `invoices.docs.revert` (the badge itself is visible to anyone who can view the list).
- **Data:** three additive, nullable columns on `Invoice` (`HandoverAt`, `HandoverByUserId` → `Users` SetNull, `HandoverRemark`); the status is **derived at read time**, never stored. A one-time idempotent backfill (`HANDOVER_BACKFILL_V1`) marks pre-existing submitted invoices Delivered (migrated, no operator) so the Pending worklist starts empty. Every write is audited.
- **Safety:** touches no FBR-submission, tax/calculation, payment, printing, numbering, or stock path. Tenant-guarded + a new `scripts/test_doc_handover.py` flow test; stock-reflow stayed 140/140.

### 2026-08-05 — PO import: fix single-item POs whose amount ends in "Rs." (Hudson Pharma)

- **Fixed POs that produced an empty parse.** The importer's page-chrome skip rule matched any line ending in `Rs.`, so a single-item order (e.g. Hudson Pharma → ABBAS ALI & SONS: `Butter Paper  12  pack  6,500.00000  78,000.00 Rs.`) had its only item row discarded as footer chrome — the "format matched but nothing parsed" symptom. The rule now only skips a line that is *just* `Rs.`; a data/total row that merely ends in `Rs.` is kept. Both sample POs added to the parser regression corpus.

### 2026-07-30 — Attachment badge refreshes without a full page reload

- **List badges now update the moment a document form closes.** Uploading a file
  inside a create/edit form (or removing one) attaches it via the shared
  `AttachmentManager`, but the list's paperclip-count hook only re-fetched when
  the set of visible ids changed — so editing an existing record and adding a
  file left the badge stale until a full page refresh. Every listing that shows
  the badge (Sales Quote, Sales Order, Delivery Challan, Invoice/Bill, Purchase
  Bill, Goods Receipt, Payment/Receipt) now calls `refreshAttachCounts()` on the
  form's post-save/close path (the same hook the quick-attach modal already
  used), covering both the card and table views. No backend change.

### 2026-07-29 — Form UX: scroll-to-error + delivered-qty guard

- **Auto-scroll to the error on submit.** Create/edit forms live in a scrollable
  modal with the submit button at the bottom and the error banner at the top, so
  a validation error could fire off-screen. A shared `useScrollToError` hook now
  scrolls the banner into view the moment an error appears — wired into every
  such form (Sales Quote/Order, Challan, Bill/Invoice, Purchase Bill, Goods
  Receipt, Payment, PO import/format, Item Type, Company, Common Client/Supplier,
  Folder, attach/deliver modals).
- **Sales Order edit can't drop a line below its delivered qty on the client.**
  Each delivered line's quantity input is floored at the already-delivered
  quantity (`min`), so the spinner stops there and the browser blocks a
  below-delivered submit before it reaches the server. The backend guard remains
  the backstop.
- Challans page: **"Link to Order"** now shows only on **No-PO** challans (a
  Pending challan already carries its own PO), and the **Sales Order** filter's
  dropdown respects the client filter (a selected client narrows the SO list).
- **Create/Edit Sales Order modal widened** (`lg`→`xl`, matching the Quote/Challan
  forms) so the item-line **Description** column isn't cramped after adding the
  Unit Price/Amount columns; the Description column also has a min-width floor.
  Still collapses to stacked cards on mobile.

### 2026-07-29 — Sales Order ↔ Challan ↔ Bill linkage

Three connected improvements to the Sales Order flow:

- **Generate Bill from the Sales Order screen.** A **Bill** action on the SO
  card + detail (shown whenever the order has ≥1 delivered, unbilled challan)
  opens the bill form with the order's billable challans pre-ticked. Un-tick to
  bill a subset, so one order can be billed across several bills (e.g. 4
  challans → Bill A = 2, Bill B = 2). The detail modal now shows a billed-vs-left
  summary and the bill number on each billed challan.
- **Attach an existing No-PO challan to a Sales Order.** For the phone-order
  workflow — deliveries raised with no PO before the formal PO arrives — a new
  **Attach delivered challan** action (on the SO detail) and **Link to Sales
  Order** action (on an unlinked challan row) open a mapping modal: each challan
  line is auto-matched (by item type, then description) to an order line, with
  manual override and a live preview. Only No-PO challans are attachable, and the
  picker is searchable by item description with expandable per-challan line
  detail. Attaching rolls matched quantities into fulfilment and **adds any
  delivered item not on the order as a new order line** (ordered = delivered), so
  the order shows everything delivered with no duplicates. It adopts the order's
  PO (flipping a `No PO` challan to `Pending`/billable). No stock movement — the
  challan's stock was already booked at creation.
- **Challan ↔ Sales Order navigation.** The SO card/detail links straight to
  its challans (`/challans?salesOrderId=`), and the Challans page gains a
  searchable **Sales Order** filter plus an **SO #** badge/column on linked
  challans.
- **Optional unit price on Sales Order lines.** A Sales Order line can now carry
  an optional unit price (`SalesOrderItem.UnitPrice`, nullable). When billing
  from an order — the SO **Bill** button or the bill form's Sales Order picker —
  a line's own price pre-fills the bill (price source `SalesOrder`, ahead of the
  source quote and last-billed rate); lines left unpriced still require a price
  at bill time. (PO import doesn't set prices yet — scheduled separately.)

### 2026-07-28 — Outstanding Ledger: company + period filters, all-clients default

The Outstanding Ledger now carries the same filter set as the Sales Report and
Tax Sheet — a **Company** dropdown, an **all-clients-by-default** searchable
**Client** picker, and a **period** control (Month/Year + "Full year" + Custom
range, filtering on the invoice date). Opens on the current year, all clients.
This is the standard for every Reports-module report going forward: Company +
Client + period, plus any report-specific filters (here: All/Unpaid/Paid).

### 2026-07-28 — Multi-page print / PDF paginate with margins

Multi-page documents (e.g. a Sales Quote with 50+ line items) no longer butt
page-to-page. The PDF export (`utils/exportUtils.js:exportToPdf`) now leaves an
8mm top+bottom margin on every sliced A4 page — page 1 ends with a bottom margin
and the next page starts with a top margin (previously the tall canvas was
sliced edge-to-edge, so the break looked "combined" and rows were cut flush).
The print popup (`utils/printDocument.js:writeAndPrint`) injects a default
`@page{size:A4;margin:12mm}` + `page-break-inside:avoid` (rows) + a repeating
`thead` for any template that doesn't define its own `@page` (Hakimi/Roshan's
Sales Quote templates had none).

### 2026-07-28 — Outstanding Ledger report + searchable client picker

- **New Outstanding Ledger report** (Reports module, per-client): each sale bill
  with its amount / paid / balance / payment status and the receipts that
  settled it (cheque #, online ref, date, amount). Filter **All / Unpaid /
  Paid**. Excel export styled to match the operator's manual sheet (company-name
  banner, bold header, grand total) plus a matching PDF. The **P.O number is
  derived from the linked delivery challan(s)** (a bill can have several
  challans, each carrying a PO); D.C # lists the challan numbers. Permissions
  `reports.outstanding.view` / `reports.outstanding.export`; responsive
  table/cards at 375/768/1280.
- **Searchable client picker** (`Components/SearchableClientSelect.jsx`) — the
  new standard for client dropdowns (type to search by name / NTN / phone,
  portaled so it escapes overflow/modals). Adopted on the Sales Report, Tax
  Sheet and Outstanding Ledger filters.

### 2026-07-28 — Tax Sheet accuracy + attachment-module permission gating

- **Tax Sheet** now lists only invoices that still need the tax consultant's
  classification. An invoice drops off once it is submitted to FBR
  (`FbrSubmittedAt` set), marked skip / exclude-from-FBR (`IsFbrExcluded`), or
  fully classified and current — where "classified"
  honours the dual-book overlay (`InvoiceItemAdjustment.AdjustedHSCode`), not
  just the physical line / item-type HS. If the delivery bill is edited after
  the overlay was reconciled (overlay total drifts beyond the FBR tolerance),
  the invoice re-appears for re-adjustment. Same predicate applied to the
  tax-sheet "transfer to next month" action. (Previously a bill filed to FBR
  via the overlay still showed as "pending HS" — e.g. invoice 3855.)
- **Attachments**: a role with bill/invoice access but no `attachments.list.view`
  (e.g. a tax consultant) no longer gets a 403 "permission" warning when opening
  an invoice/bill form. `AttachmentManager` skips the attachment/folder list
  fetches and renders nothing when the view permission is absent (the folder
  picker is also gated on `folders.list.view`).

### 2026-07-28 — Mobile responsiveness sweep: pagination, layout overflow, forms & modals

Frontend audit of every screen for phone / tablet / desktop, verified at 393 px
(Infinix Note 30 Pro) against the local prod replica.

- **Fixed horizontal page scroll on phones (root cause).** The layout content
  column (`.dl-content-wrapper` / `.dl-main`) was a flex child with the default
  `min-width:auto`, so a wide table (Sales Report, Tax Sheet, credit/debit-note
  builder) stretched the whole content column — and the page — sideways instead
  of scrolling inside its own wrapper. Added `min-width:0` to both; wide tables
  now scroll within their container (contained side-scroll) and the page never
  scrolls horizontally.
- **Shared `<Pagination>` component** (`Components/Pagination.jsx` + `.css`)
  replaces ~11 copy-pasted inline pagination bars (Invoices, Bills, Purchase
  Bills, Goods Receipts, Payments, Sales Quotes/Orders, Item Rate History, Audit
  Logs, FBR Monitor, Stock movements). On a phone it wraps to a full-width nav
  row (Prev · page · Next) plus a rows-per-page line, ≥44 px tap targets, and
  drops the long "(n total)" suffix to save space.
- **Purchase Bill & Goods Receipt forms** — hardcoded header field grids
  (`2fr 1fr 1fr`, `1fr 1fr 1fr`, `1fr 1fr`) replaced with `auto-fit` so they
  collapse to one column on a phone instead of cramping.
- **Modals** — Stock opening-balance/adjustment `SmallModal` and the Tax Sheet
  transfer dialog now use `overflowY:auto` on the overlay + `maxHeight` on the
  card, so a tall modal can't clip its top on a short viewport.
- **Reports readable on phones with no side-scroll.** Sales Report and Tax Sheet
  render as stacked cards below 768px (Sales Report keeps tap-to-expand line
  items); the wide table stays for tablet/desktop. New shared
  `hooks/useIsNarrow.js` consolidates the duplicated `innerWidth` breakpoint
  logic.
- **Card/Table toggle now on every viewport.** `useListViewMode` no longer hides
  the toggle below 1280px, so Invoices, Challans, Purchase Bills and Goods
  Receipts can switch to the dense table on a phone (it scrolls inside its own
  container); card stays the default.
- Removed a duplicate `padding` key in the Stock `TabBtn` style.

### 2026-07-27 — Company form: Sales Quote & Sales Order starting numbers

The Company create/edit form now exposes "Starting Sales Quote #" and "Starting
Sales Order #" inputs, mirroring the existing challan / invoice / note /
purchase-bill / goods-receipt seeds. `Company.StartingSalesQuoteNumber` /
`StartingSalesOrderNumber` already existed and drove the numbering services, but
were never wired into `CreateCompanyDto` / `UpdateCompanyDto` / `CompanyDto` or
the form — so the seed could previously only be set via a direct DB update.
Honoured only while the company has no quotes / orders yet (server-side guard).

### 2026-07-27 — Excel export: wrapped item descriptions no longer clip

Item rows in Excel template exports now auto-grow to fit multi-line wrapped
text (long product descriptions). ClosedXML copies the template row's fixed
height onto every expanded item row, and Excel won't auto-fit rows carrying an
explicit height — so a 2-line description showed only its first line. The
engine now estimates each wrapped cell's line count from the (possibly merged)
column width and bumps the row height to fit. Only grows rows, never shrinks.

### 2026-07-27 — Per-quotation Contact Person (sourced from the client)

Clients now hold a semicolon-separated **Contact Persons** list (same pattern as
Sites). The Sales Quote form shows a **Contact Person dropdown** populated from
the selected client's list — with a free-text fallback when the client has none
— so operators pick a contact instead of retyping it. The chosen value is stored
on the quote and rendered on the print via the new `{{contactPerson}}` merge
field (added to the Sales Quote template field sidebar). Contact person is
per-quote, so the same client can use different contacts on different quotations.

### 2026-07-27 — Paste-list now captures Unit (description, qty, unit, unit price)

- The shared line-items editor's **Paste list** (Sales Quote, Sales Order, Delivery Challan) now reads a **Unit** column. Pasted rows follow a fixed column order — **description, quantity, unit, unit price** — tab- or comma-separated, each trailing column optional; the unit-price column is honoured only on priced documents (Quote/Bill), never a Sales Order / Challan. The parser peels the longest valid trailing tail matching `qty [unit] [price]` (qty/price numeric, unit the non-numeric token), so a number embedded in the description (a size like `12mm` or `1/2"`) stays in the description. Previously only qty + unit price were parsed and the unit was dropped. `POImportForm`'s PO-text paste already captured the unit, so every paste path now follows description → qty → unit → price.

### 2026-07-27 — Per-screen "rows per page" selector

Added a Rows-per-page dropdown (10/20/50/100/200) to every paginated screen
(Invoices/Bills/Notes, Sales Quotes, Sales Orders, Purchase Bills, Goods
Receipts, Delivery Challans, Payments, Attachment Folders, Item Rate History,
Audit Logs, FBR Monitor). The choice is remembered per screen in localStorage
and reused on reload; screens left untouched fall back to the appsettings
`Pagination:DefaultPageSize` (10), read back from the response so the dropdown
shows the real default. Raised `PaginationHelper.DefaultMax` 100→200 so the 200
option works on ordinary endpoints too — still bounded, so the audit C-11 DoS
guard is intact. New shared `usePageSize` hook + `PageSizeSelect` component;
FBR Monitor's fixed 25/page becomes the appsettings-driven default.

### 2026-07-27 — FBR monitor Bill column shows the real bill/invoice number, not the DB id

- The FBR Communication Monitor's **Bill** column (and the detail line) rendered the invoice's raw database id (`#240`) instead of the bill/invoice **sequence number** the operator recognises (`#3819` — driven by the company's Starting/Current `InvoiceNumber`). `FbrCommunicationLog` stores only `InvoiceId`, so the real number was never surfaced. **Fix:** added `InvoiceNumber` to `FbrCommunicationLogDto`, resolved from `InvoiceId` in one batch query per page (and for the single-row detail fetch) in `FbrCommunicationLogService` — left null when the invoice was since deleted — and bound the monitor's Bill column + detail line to it. Verified on the prod-replica: rows now read `#3819 / #3816 / #3823` (the sequence) instead of `#240 / #237 / #455` (the ids).

### 2026-07-27 — Fix mis-parsed production PO PDFs (Meko/Aqua "packaging-unit" rows + leaked numeric runs)

- **Failed/mis-parsed customer POs** flagged from production (Meko Denim/Fabrics format). Two failure modes on rows shaped `[code] [description] [UNIT] [Qty] [Rate] …` where the code+description are single-spaced (one cell) but the header lists Code / Item Name as separate columns — so the generic column reader misaligns and the adjacency fallback takes over. (1) A **packaging unit** the adjacency scanner didn't recognise (`PKT`, `TIN`) meant it anchored on the wrong token: `CABLE TIE 6" PKT 50` parsed as description `"CABLE"`, qty `6` (the size), unit `Tie`, instead of `CABLE TIE 6"` / qty `50` / `Pkt`; `SAMAD BOND 3.75LTR TIN 1` parsed as `"SAMAD"` / `3` / `Bond`. (2) A **leaked numeric run** — the qty/rate/amount columns spilling into the front of a wrapped description (`"1 4200.00 4,200 18.00 TO 24VDC 30A MOD# P30"`) — beat the correct extraction because it wasn't detected as a mis-map. **Fix (`RuleBasedPOParser`):** add `PKT/PKTS/TIN/TINS/RFT` to `RecognisedUnits` so the adjacency extractor treats them as real unit anchors (they were already in the mis-map `UnitOnlyWords` set); and add a leading-`\d[\d,]* \d[\d,]*\.\d{2}` rule to `DescriptionLooksMismapped` so a leaked "qty rate" run at the start of a description demotes that candidate and the correct extraction wins. Verified against the actual production PDFs (`PO-270165`, `PO-270147`) — now `CABLE TIE 6"/4"/24"/12"` qty `50/50/12/50` Pkt, and `SMART BATTERY CHARGER 220VAC TO 24VDC 30A MOD# P30` qty `1` (continuation line correctly appended). New corpus cases added (`prod-270165`, `prod-270147`, `prod-270027`) and the stale `prod-123` SAMAD-BOND expectation corrected; offline corpus **ALL REGRESSION CORPORA PASSED** (production_formats 11/11), prod read-only check shows **0** extraction regressions. (Also: the offline reparse tool now emits the extracted PdfPig text to make building a corpus case from a prod PDF a one-step reproduce.)

### 2026-07-27 — Fix stock OUT never recorded for FBR-reclassified (dual-book overlay) invoice lines

- **Prod incident (Hakimi, HS 8467.2100).** The tax consultant reclassifies a bill line from a non-HS "product family" (e.g. "Electric Hammer") to an HS-coded item type through the dual-book adjustment overlay (`InvoiceItemAdjustment.AdjustedItemTypeId`), which leaves the physical `InvoiceItem` untouched. `StockService.SyncInvoiceStockMovementsAsync` keyed stock OUT off the **physical** `InvoiceItem.ItemTypeId` and read the overlay for **quantity only** — never `AdjustedItemTypeId`. So the non-HS base line was untracked (no OUT) and the FBR-classified HS type never decremented: purchases booked 3000 IN on item 130 while the "sales" filed on paper produced **0 OUT**, and the stock dashboard showed no movement for 8467.2100. **Fix:** the sync now computes an effective type `AdjustedItemTypeId ?? ItemTypeId` (mirroring `FbrService.ApplyAdjustmentOverlay`) and uses it for the tracked-set gate, the desired-net map, **and** the `StockMovement.ItemTypeId` it writes — so OUT lands on the type actually filed to FBR. Because the overlay-write path (`InvoiceService` `PATCH /invoices/{id}/itemtypes-and-qty` in `writeMode:"adjustment"`) already calls the sync inside its transaction, stock now reflows the moment the consultant adjusts, reverts, re-applies, or changes the adjusted qty — and reverses on delete. **No new startup backfill** was added (the change only alters on-save behavior); the historical rows were corrected by a one-time SQL script run separately against prod. Verified with a comprehensive overlay matrix in `test_stock_itemtype_reflow.py` (suites 8–13): non-HS→HS overlay reclassification; HS→HS→HS reclassification **chain** (each hop reverts the old type's OUT and records a new OUT on the new HS type); bill (PUT) edits **under** an active overlay (physical qty reflows while the overlay carries no filed qty, and the filed qty becomes authoritative once set); repeated quantity **re-adjustment** with the bill total held constant; multi-line invoices with mixed overlays (per-line independence); and challan-driven bills reflowing onto the overlay type — plus revert-to-base and delete reversal in every case. **140/140** reflow checks, build 0 err, basic flows **37/37**, security audit **67/67**.

### 2026-07-27 — Compact status pills on invoice/bill cards + payment-status now access-controlled server-side

The invoice/bill list cards were tall — payment status and FBR status each rendered as a stacked block. They now collapse to compact pills: the **FBR lifecycle** (Ready / Pending / Setup·N / Submitted / Failed / Re-adjust / Excluded / Cancelled) and any **note relationship** (Credit/Debit note, Reversed, Adjusted) show as small pills in the card header; **payment status** (Unpaid / Part-paid / Paid) sits in the Grand Total row. Full detail — missing FBR fields, IRN, error text, balance, overdue days — moves to hover tooltips. Cards are markedly shorter with every status still readable by colour. (`pages/InvoicePage.jsx`.)

Security fix found while verifying the payment pill: the payment fields (`AmountPaid` / `BalanceDue` / `PaymentStatus` / `DaysOverdue`) were only hidden in the UI — the invoices/bills list + get-by-id APIs returned them to anyone with list-view, so a user without `accounting.paymentstatus.view` could still read them via the API. They are now **nulled server-side** for callers lacking payment visibility (`accounting.paymentstatus.view`, or the relevant `receipts.*` / `payments.*` settle permission so the Receipts/Payments screen keeps its balances) — on invoices, bills, and purchase bills, list and get-by-id. DTO fields made nullable; controllers scrub before returning. New durable test `scripts/test_payment_status_permission.py` (5/5) proves the fields are populated for admin and null for a restricted user; tenant-isolation suite still green.

### 2026-07-27 — Shared line-item editor: fast desktop entry + mobile cards across every sales form

Completed the Sales-Quote mobile work into one reusable component. `Components/LineItemsEditor.jsx` is now the single line-item grid behind **Sales Quote, Sales Order, and both Challan forms** (create + edit): a dense table on desktop, tap-friendly stacked cards below 760px, no horizontal scroll on phones. Each form opts into just the columns it needs — item-type picker + bulk-apply for Quote/Order, unit price + last-billed-rate auto-fill for Quote, quantity-only for Challan — and keeps its own totals, validation, save shape, and couplings (quote/SO prefill, delivered-qty lock, duplicate-mode, item-type passthrough) unchanged.

**Faster desktop entry** (the per-cell table was slow for long lists): **Enter** in any row commits and advances — on the last row it appends a fresh line and focuses the description, otherwise it jumps to the next row — so it's type · Enter · type · Enter down the list. Plus **Repeat last** (clones the previous line's item type / unit / price) and **Paste list** (one item per line; a trailing tab/comma number becomes qty, a second becomes unit price). `LookupAutocomplete` gained optional `inputRef` / `autoFocus` / `onEnterKey` props (backward-compatible) to drive this.

The three FBR bill forms — `InvoiceForm`, `StandaloneInvoiceForm`, `EditBillForm` — also render their line items as responsive stacked cards below 760px, mirroring their existing columns (HS code, sale type, MRP/SRO, per-cell locks) with **no change** to their FBR / challan-projection / adjustment logic (EditBill cards the individual-lines view; the grouped lens stays a table).

### 2026-07-25 — Mobile-friendly line-item entry (Sales Quote)

The Sales Quote form's line items were a horizontal table — cramped and side-scrolling on a phone. Below 760px they now render as **tap-friendly stacked cards** (description full-width; Qty / Unit / Unit Price in a row; amount + remove) with no horizontal scroll; desktop keeps the dense table, switching automatically on resize. Reuses the existing item-type picker, description autocomplete, last-rate auto-fill, validation, and save shape unchanged. First of the sales forms — Order / Challan / Bill to follow, plus a faster desktop quick-add. (`Components/SalesQuoteForm.jsx`.)

### 2026-07-25 — Paste-a-list PO import (no PO Format required)

The **Paste Text** import path no longer dead-ends when a client has no saved PO Format. When the format match misses (`422 no-format`), the pasted content is now parsed generically into review line items instead of forcing manual entry: each line becomes a row (leading `N.`/bullet stripped, embedded sizes like `1/2"` / `Length 3"` preserved), a trailing number is read as the quantity only when clearly delimited (dash/colon or 2+ spaces) else it defaults to `1`, and PO number/date are lifted from the header lines. Lets an operator paste a plain item list (e.g. a customer's emailed PO) straight into a Sales Quote / Order / Challan and just fill quantities & prices in the review step. Frontend-only fallback in `Components/POImportForm.jsx` (`parsePlainList` / `extractPoMeta`); the PDF format-matching path and the backend `RuleBasedPOParser` are unchanged — PO parser regression corpus still green. Verified live: a 21-line PO pasted into a Sales Quote produced 21 clean line items with PO#/date auto-filled.

### 2026-07-25 — Post-FBR-submission invoice correction ("Correct" wizard)

A filed invoice can't be edited or cancelled at FBR, so corrections are now a guided flow. A **Correct** action on any FBR-submitted bill opens a wizard that issues the correct linked document from what the operator enters:
- **More goods delivered (under-billed quantity)** → a new **unclassified** supplementary bill for the delta, carrying the original's delivery challan & PO (cloned, same number), handed to the tax consultant to classify (HS) and submit — replaces the manual SQL workaround for this case.
- **Overcharged / goods returned** → a **Credit Note** (partial or full) at the original rate.
- **Undercharged rate (same quantity)** → a **Debit Note** carrying the per-unit price delta.

Backend: `Invoice.SupplementsInvoiceId` audit link + migration; `CreateSupplementaryInvoiceAsync` and `POST /invoices/{id}/supplement` (creates the delta bill + cloned challan in one SaveChanges; unclassified line, no dual-book overlay). Credit/Debit branches reuse the existing note engine (`POST /invoices/notes`). Gated by `invoices.note.create`. Verified end-to-end — 16/16 integration plus live UI for all three branches (supplement, credit, debit).

### 2026-07-23 — Sales Quote / Sales Order Excel export + Sales Quote print template

- **Excel export for Sales Quote & Sales Order** (parity with Challan/Bill/Tax-Invoice). New `ExcelTemplateEngine.QuoteToDict`/`OrderToDict` + `POST /printtemplates/company/{id}/SalesQuote|SalesOrder/export-excel` endpoints; a "Download Excel" button appears on the Sales Quote / Sales Order lists once an Excel template is uploaded for that company+type (gated by `hasExcelTemplate`). Fills the uploaded `.xlsx` template — item rows loop via `{{#each items}}`, and the template's Sub-total / GST / Net cells stay live Excel formulas (the `{{#each}}` row-expansion auto-grows a `SUM` that spans the item rows + a blank spacer row, so totals stay correct for any item count).
- **Sales Quote print template** (Handlebars) matching the Hakimi/Roshan quotation format — seller block, "Quote To", Prepared-by, S.No/Description/Qty/Unit Price/Total columns, SUB TOTAL / GST (18%) / NET TOTAL, footer. Seller identity/prepared-by/email hardcoded per company; date, client and line items are merge fields. Seeded as the default `SalesQuote` template on both tenants.

### 2026-07-23 — Attachment indicators on document lists + source categorization in folders

- **Attachment count badge on every document list.** Sales Quotes, Sales Orders, Delivery Challans (card + table), Bills/Invoices/Notes (card + table), Purchase Bills (card + table), Goods Receipts (card + table) and Payments now show a paperclip + count badge on each card/row. The badge is hidden when a document has no files; clicking it opens a lightweight modal to view/download (and, with permission, add) that document's attachments without entering full edit. Counts come from the existing batch `entity-counts` endpoint (one call per page); new reusable `useEntityAttachmentCounts` hook + `AttachmentBadge` / `AttachmentQuickModal` components.
- **Source categorization in the folder view.** Inside a folder (and the Uncategorized bucket) each file now shows where it came from — `📁 Direct upload` or the source document with its real number (`📄 Delivery Challan #262`, `Credit Note #3`, `Receipt #48`, …) — and, when a folder mixes sources, a filter-chip row (All · Direct · Sales Quote · …) filters the list server-side. Backend resolves the document number + label per source type (`AttachmentDto.EntityNumber`/`SourceLabel`, new `AttachmentSourceResolver`) and exposes a `source` filter + `source-summary` endpoints; the frontend hardens against a stale/absent backend (a 404 that the SPA fallback serves as `index.html` no longer leaks into the UI).

### 2026-07-23 — Sales/UI refinements: searchable client pickers, SQ/SO item-type UX, site dropdowns, attachment scroll fix

- **Searchable client pickers.** The document forms that select a client (Sales Quote, Sales Order, Delivery Challan create + edit, Standalone Bill) now use the same type-ahead `SearchableSelect` the Receipts/Payments screen uses, instead of a long plain `<select>` — much faster on companies with many clients.
- **Sales Quote / Sales Order item types.** Their item-type picker now lists only **non-HS** item types (matching Bill mode; HS-coded types are the FBR-classification set used on the Invoices tab). Both forms also gained the Bill-mode bulk UX: a **"+ New Item Type"** shortcut (opens the catalog form inline, permission-gated) and, when a document has more than one line, an **"Apply same Item Type to all / only-empty rows"** picker with **Clear all**.
- **Site dropdown from the client's configured sites.** The Sales Order create/edit form and the **Deliver Sales Order** modal now offer the client's saved sites as a dropdown (like Delivery Challan), with a free-text fallback when the client has none — fixing the earlier free-text-only / empty-in-edit behaviour.
- **Fixed attachment section clipped on Purchase Bill.** The Purchase Bill create/edit/view modal placed the attachments section outside its scrollable body (its body sat inside a disabled `<fieldset>`), so the section and the footer were cut off with no scroll. The scrollable body now wraps the fieldset with the attachments inside it (an audit confirmed every other document form was already correct).

### 2026-07-23 — Unified attachments + document folders (Navigation Menu), Division-free

- **Folder document library.** A new **Configuration → Navigation Menu** screen manages per-company **folders**; each folder holds uploaded documents with **preview + download**. A permanent "Uncategorized" bucket collects files filed in no folder. Backed by `Folder` + a single unified `Attachment` entity (bytes on disk under `data/attachments/{folder}/…`, never in the DB; SHA-256 + disk-reconcile so a manually-deleted file prunes its row).
- **Any business file type.** Upload images, PDF, Word, Excel, PowerPoint, text/CSV, ZIP — validated by an extension allowlist **+ magic-byte sniff** (renamed executables/scripts/HTML/SVG rejected), 25 MB cap.
- **Attachments on every document.** A reusable `AttachmentManager` is wired into all document screens — Sales Quote, Sales Order, Delivery Challan (create + edit), Bill/Invoice (+ standalone + edit), Credit/Debit Notes, Purchase Bill, Goods Receipt, Receipt, Payment. In create/edit it uploads/stages + attaches; on read-only detail views it shows files **preview/download only**. Files staged before a new record exists are flushed against the new id after save.
- **Security.** `/data/attachments/*` is **not** publicly served — a middleware 404s any direct hit; downloads go only through the authenticated, company-access-checked `GET /api/attachments/{id}/download`. Every upload cross-checks that the linked document belongs to the caller's company. 7 permissions (`folders.*` / `attachments.*`). GL/Division-free (the source build's Division tagging was stripped).

### 2026-07-23 — Accounting: Receipts & Payments (AR/AP subledger) + payment-status on invoices/bills

- **Receipts (money in) and Payments (money out).** A single `Payment` entity models both directions, each with its own gap-free per-company numbering (RCP-#### / PMT-####) and one or more allocation lines that settle sales invoices (receipts) or purchase bills (payments). Cross-tenant guards on every referenced document, an over-allocation guard (a document can't be paid beyond its balance), and a cheque/PDC lifecycle (Pending → Deposited → Cleared / Bounced). This is the AR/AP payment subledger — **no General Ledger / Chart of Accounts** in this build; the bank/cash destination is a free-text name. Endpoints under `/api/payments/{receipts|payments}` gated by the eight `accounting.receipts.*` / `accounting.payments.*` keys; a print voucher endpoint (`/print`) with amount-in-words renders through the **Receipt** print-template type.
- **Balance-due on invoices & bills.** `Invoice` and `PurchaseBill` now carry `AmountPaid` (reflowed from non-cancelled allocations) + an optional `DueDate`; their DTOs and paged lists surface `AmountPaid` / `BalanceDue` / `PaymentStatus` (Unpaid / Partially Paid / Paid / Overdue, derived at read time in Pakistan calendar time) / `DaysOverdue`. New `PUT /invoices/{id}/due-date` and `PUT /purchasebills/{id}/due-date` endpoints.
- **Payment-status badge — permission-gated.** A new **`accounting.paymentstatus.view`** permission gates a payment-status badge (with balance due) shown on the **Bills and Invoices** screens (both modes) and the **Purchase Bills** screen (card + table views). A user without the key sees no badge; those screens are otherwise unchanged.
- **Receipts / Payments screens.** New `/receipts` and `/payments` pages (one component, two modes) under a new **Accounting** sidebar group: responsive card list, record/edit/delete with a live allocation table against a contact's open documents, a per-document payment-history summary, and the generic print-template selector + Print/PDF. `DivisionSelect`, the Chart-of-Accounts bank picker, and attachment upload from the source build are intentionally omitted (this build has none of those).
- **Separate Receipt & Payment print-template types.** The print-template catalog grows to **11 types**: a distinct **Payment Voucher** type (4 starters, money-out styling) joins the **Receipt Voucher** type so each voucher is correctly titled from its own templates (the Receipts screen uses the Receipt type, the Payments screen the Payment type). Both bind the same print payload; the `direction` field marks which.
- **Fixed print-template picker flicker.** The shared `usePrintTemplates` hook reported "show the picker" before the template list had loaded, so on any screen whose company has no template of that type (e.g. Receipts / Payments) the dropdown flashed in, then vanished with a toolbar reflow once the fetch returned empty. It now appears only once ≥1 template is confirmed loaded — no flash, on every document screen.

### 2026-07-21 — Print Template system: multi-template, 10 document types, generic on-screen selector

- **Multi-template per document type.** A company can now keep several named print templates per document type with one flagged the **default** (was: exactly one template per type). New `PrintTemplate.Name`/`IsDefault`, a filtered-unique "one default per (company, type)" index, and id-based CRUD on `PrintTemplatesController` (create / update / set-default / delete / apply-starter / id-based Excel), all audit-logged. New permissions `printtemplates.manage.delete` + `printtemplates.starter.apply`.
- **10 supported document types.** Added **Sales Quote, Sales Order, Purchase Invoice (Purchase Bill), Goods Receipt, Debit Note, Credit Note, Receipt** to the existing Delivery Challan / Bill / Sales Tax Invoice. ~15 professionally-designed starter templates ship per new type (~139 total). Merge-field catalogs for the new types are seeded at startup for the editor's field picker.
- **Print data for the new types.** New `GET /purchasebills/{id}/print` and `GET /goodsreceipts/{id}/print` endpoints; the Sales Tax Invoice print payload now also carries Credit/Debit-note fields (note kind, original-invoice reference, reason) and a per-unit price so notes and Manager-style unit-price columns render.
- **Print Templates management screen** (`/templates`): tabbed Print / Starter / Excel management with create-from-starter, duplicate, set-default, delete, apply-starter, live preview, and per-template Excel upload — for all 10 types. Excel import/export layouts live on their own tab and are **one per document type** (a type can have many HTML print formats but a single Excel layout); a document screen only shows its "Export Excel" button when that type's Excel layout is set. The editor is focused on authoring one template: a **Saved Templates** dropdown switches between a type's formats or starts a new one, a **Design Gallery** applies a professionally-designed layout (with live A4 previews), and a **Set as default** button promotes the open template — while rename/duplicate/copy/delete stay on the list page.
- **Copy — same or across document types.** One Copy action per template: pick the **same type to duplicate** it, or a **different type** to reuse the layout as a new template of that type (opens in the editor to adapt the type-specific merge fields).
- **A configured template is required to print.** When a document type has no print template configured, that screen's template dropdown, **Print** and **Export-PDF** are disabled with a tooltip pointing to Print Templates — rather than silently printing a generic built-in. (Print-only roles that can't manage templates keep the built-in fallback so they aren't locked out.)
- **Generic on-screen template selector.** A reusable picker now appears on every document screen (Challan, Bill, Sales Tax Invoice, Credit Note, Debit Note, Sales Quote, Sales Order, Purchase Bill, Goods Receipt): it lists that type's active templates, defaults to the flagged default, is switchable, **remembers the last choice per company+type**, and drives both Print and PDF (falling back to the built-in default when none is set). Purchase Bill and Goods Receipt gained a Print/PDF flow they previously lacked. (The Receipt document + its selector arrive with the Accounting/Receipt module.)

### 2026-07-21 — Sales flow enhancements: PO import to SQ/SO, order→challan→bill wiring, PO threading

- **Import PO → Sales Quote / Sales Order.** The PO importer is now multi-target (Challan / Sales Order / Sales Quote); "Import PO" buttons on both sales pages create a quote or order from a customer PO using the client's saved PO format (imports description, qty, unit, PO number, PO date). Gated by `poformats.import.create`.
- **Delivery Challan form → "From Sales Order" picker.** An optional searchable dropdown of open (partial + undelivered) orders; selecting one autofills the client/PO/site and the order's remaining lines, and creates the challan through the order's fulfilment flow so each line links back to its ordered line and the order auto-closes when fully delivered.
- **PO threading.** The Sales Order's PO number/date is authoritative: it's inherited by every challan raised from the order and **propagates to all its linked (unbilled) challans** when the order's PO is set or changed (flipping a "No PO", FBR-ready challan to billable). A challan-linked bill derives its PO from the challans as before.
- **Bill creation from a Sales Order (both paths).** The standalone (no-challan) bill gets an optional "From Sales Order" section that prefills the order's lines with server-resolved prices (source quote → last-billed) + client + GST; the challan-linked bill gets a "Bill from Sales Order" picker that pre-ticks the order's billable challans in the existing multi-challan flow.
- **PO at bill time on standalone bills.** A standalone bill has no challan to carry a PO, so **`Invoice` now stores `PoNumber`/`PoDate`** (additive migration) — settable at bill time and shown on the bill; challan-linked bills keep deriving the PO from their challans.
- **Lifecycle.** A Sales Quote auto-expires past its validity (derived "Expired") and can no longer be converted or picked; the order-form quote picker now offers only open (non-expired, non-accepted) quotes; a Sales Order auto-closes once fully delivered on every challan path.

### 2026-07-21 — Sales Quote + Sales Order (ported from the customer build, Division-free)

- **New Sales module: Sales Quotes and Sales Orders**, ported from the `customize-solution-for-other` branch and adapted to run natively on `master` — with the **Division concept deliberately left out** (master isolates tenants via `Company.IsTenantIsolated` + `UserCompany`, not divisions). A **Sales Quote** is the priced pre-sale quotation (unit price required per line); it converts into a **Sales Order** (quantity-only), which drives one or more delivery challans and, in turn, billing. Numbering is per-company (`Starting/CurrentSalesQuoteNumber`, `Starting/CurrentSalesOrderNumber` on `Company`), unique-indexed with a concurrent-create retry. Neither document is an FBR document and neither posts to the GL.
- **Quote → Order → Challan → Bill chain.** Converting a quote copies its client + lines into an order and locks the quote as *Accepted*. "Deliver" raises a delivery challan against the order (links each challan line back to its ordered line via new nullable `DeliveryChallan.SalesOrderId` / `DeliveryItem.SalesOrderItemId`), so delivered-vs-ordered quantities roll up on read (Not/Partially/Fully/Over Delivered) and the order auto-closes when fully delivered. The bill-prefill endpoint resolves each line's unit price from the **source quote first**, then the item's last billed rate — so a quote's price is remembered for later billing.
- **Item descriptions feed the shared catalog.** Quote and order lines upsert their descriptions into the generic `ItemDescription` table (new `Helpers/ItemDescriptionRegistry`), so they become reusable suggestions across every document.
- Every endpoint is permission-gated (`salesquotes.*` / `salesorders.*`, 10 new catalog keys) and tenant-guarded via `ICompanyAccessGuard` (`AssertAccessAsync` + `[AuthorizeCompany]`); linked quotes/clients are cross-tenant-checked. Sales Quotes + Sales Orders screens added under the Sales sidebar section (create / edit / view with challan drill-down / convert / deliver / print / PDF / status / delete). Printing uses built-in company-level templates; the multi-template picker and PO-import-to-order are deferred.

### 2026-07-24 — Fix "Could not allocate a unique invoice number" — item-description dedup vs SQL collation

- **Second, independent bill-create failure** (surfaced once the SQL-2025 FK fix let creates get further). The item-description auto-save (best-effort autocomplete catalog) deduped with a **C# `!existing.Contains(desc)`** while the `IX_ItemDescriptions_Name` unique index uses a **case- AND trailing-space-insensitive** SQL collation. When a stored row differed from the typed description only by trailing space or case (prod had `"Jointing Sheet 4'x4'x1mm Without Wire Klinger "` with a trailing space), the SQL existence query matched it but the exact C# compare did **not**, so the code tried to `INSERT` the "new" value → **SQL 2601** → the invoice-number **retry loop** (which retries on *any* unique violation) re-collided and exhausted 3 attempts → the misleading `"Could not allocate a unique invoice number after 3 attempts."` The whole bill failed over a best-effort catalog write. **Fix:** dedup the same way the index compares — `Trim()` + `Distinct(OrdinalIgnoreCase)` and match `existing` as a trimmed `OrdinalIgnoreCase` `HashSet` — in both `CreateAsync` and `CreateStandaloneAsync`, so an existing trailing-space/case variant is recognized and never re-inserted. Verified on the prod-replica by seeding a trailing-space `ItemDescription` and confirming a create with the trimmed description now succeeds (was 2601) with no duplicate row. Diagnosed against the live prod DB (SQL Server 2025) with the operator's read-only credentials.

### 2026-07-24 — Fix bill create on SQL Server 2025: insert invoice + link challans in ONE SaveChanges (real root cause)

- **The actual fix.** On prod (SQL Server 2025 + `MultipleActiveResultSets=True`), a **second** `SaveChanges` inside a user transaction does not reliably see rows a **first** `SaveChanges` inserted in that same transaction. Bill create did exactly that — save the invoice, then in a separate save set `DeliveryChallans.InvoiceId = created.Id` — so the challan UPDATE couldn't see the just-inserted invoice and failed `FK_DeliveryChallans_Invoices_InvoiceId` (SQL 547; prod #828–#830). This is **not** the earlier hypotheses: `OUTPUT` and `SCOPE_IDENTITY` both work fine on prod (verified on a temp table), and the DB compat-level change (170→160) did not help — the fault is EF's per-`SaveChanges` unit-of-work behavior on this engine, not identity read-back. The local prod-replica is SQL 2022 without MARS, which is why it never reproduced. **Fix:** `InvoiceService.CreateAsync` now `Add`s the invoice and links each challan via its **navigation** (`dc.Invoice = invoice`), then calls `SaveChanges` **once** — EF orders `INSERT invoice → UPDATE challan FK` within that single save with no cross-save dependency (challan status set on the tracked entity → surgical column update, no full-graph cascade). The `UseSqlOutputClause(false)` and applock/graph fixes from the same day remain (correct + harmless). Verified: 20-way concurrent burst all 201 with every challan linked+invoiced, build 0 err, audit 67/67, basic 37/37, stock 76/76.

### 2026-07-24 — Fix bill create broken by SQL Server 2025 (compat 170): stop EF using the OUTPUT clause

- **The real, blocking prod cause.** Production `db46684` was on **SQL Server 2025** at **compatibility level 170**. EF Core 9 reads a newly-inserted row's identity via the T-SQL `OUTPUT` clause (`INSERT … OUTPUT INSERTED.[Id]`), and at compat 170 that read-back returns **0 rows** — so `created.Id` came back **0**. The bill-create flow then set `DeliveryChallans.InvoiceId = 0`, which violated `FK_DeliveryChallans_Invoices_InvoiceId` (SQL 547); the same broken INSERT earlier surfaced as the `DbUpdateConcurrencyException` "expected to affect 1 row, affected 0". Bills last created successfully **2026-07-16**, consistent with the DB being moved to SQL 2025 around then; the item type the operator created was coincidental. The local prod-replica runs SQL 2022 (compat 160), which is exactly why it never reproduced. **Fixes applied:** (1) prod DB compatibility level lowered 170 → 160 (reversible, immediate unblock); (2) durable code fix — every entity is configured `ToTable(t => t.UseSqlOutputClause(false))` in `AppDbContext.OnModelCreating`, so EF uses the classic `INSERT` + `SELECT … WHERE @@ROWCOUNT = 1 AND [Id] = SCOPE_IDENTITY()` path that returns generated keys correctly on **any** server compatibility level (survives a DB reset back to 170 or a new tenant DB provisioned at 170). No entity uses a concurrency token, so dropping the OUTPUT read-back is safe. Verified: EF now emits `SCOPE_IDENTITY()` (0 `OUTPUT INSERTED`), build 0 err, audit 67/67, basic 37/37, stock 76/76, tenant-iso green.

### 2026-07-24 — Fix deterministic 500 on bill create (challan transition) + capture inner exceptions

- **A bill create that got past number allocation could still 500 at the challan-transition step** (`DeliveryChallanRepository.UpdateAsync`, prod #828 — a `DbUpdateException` whose generic outer message hid the real SQL cause). Root cause: the transition called `_challanRepo.UpdateAsync(dc)` → `DbSet.Update(dc)`, which marks the **entire loaded challan graph** (Client, Company, Invoice, DeliveryItems, ItemTypes, DuplicatedFrom) Modified and fires a **full-column UPDATE for every one of them**. For challans whose shared Client/Company rows don't round-trip a full-column rewrite cleanly on prod, one of those cascade UPDATEs failed — even though the challan itself was perfectly valid (a clean synthetic clone reproduced the *success* path locally, confirming the fault was the cascade, not the challan). Fix: the transition is now **surgical** — the challan is already tracked, so only its own `Status` / `InvoiceId` / `PoDate` columns are marked modified and saved; no graph cascade. **Also**: `GlobalExceptionMiddleware` now records the **full inner-exception chain** (message + `ToString()`) in the audit log, so a `DbUpdateException`'s real SQL error/constraint is diagnosable straight from the log without a repro. This surfaced only after the number-race fix (below) let creates reach the transition step.

### 2026-07-24 — Fix intermittent 500 on concurrent bill create (invoice-number race)

- **Creating a bill occasionally failed with a 500 (`DbUpdateConcurrencyException` / "affected 0 rows").** Root cause was a concurrency race, not the item type the operator had just added. When two bill-creates for the same company arrived at nearly the same instant (operator double-click, or a client auto-retry), both read `MAX(InvoiceNumber)+1` and raced on the unique index — surfacing intermittently as SQL 2601 (duplicate key), 1205 (deadlock), 544 (explicit IDENTITY_INSERT from a reused entity graph) or an EF "affected 0 rows" concurrency error. The retry loop only caught 2601/2627, so the other variants fell through to a 500. Confirmed on the prod audit log (6 occurrences across both tenants over ~6 weeks, all at the first `SaveChanges`) and reproduced locally against the prod-replica DB (60 simultaneous creates → 54 failed; 2 simultaneous → one failed every time). Fix: **all three invoice-number allocation paths** (`CreateAsync`, `CreateStandaloneAsync`, `CreateNote`) now take a transaction-scoped `sp_getapplock` keyed per company (`invoice-alloc-{companyId}`), so same-company creates run the `MAX+1`→INSERT critical section one-at-a-time (auto-released on commit/rollback; different companies never block each other), and each attempt builds **navigation-free** line clones with a full `ChangeTracker.Clear()` on retry so a rolled-back graph can never be re-inserted or phantom-updated. No schema change, no migration. Post-fix the same repro is **60/60 + 20/20 green** with unique sequential numbers. (`PurchaseBill` / `GoodsReceipt` share the same latent `NumberAllocationRetry` race but were out of scope here — flagged as a follow-up.)

### 2026-07-20 — FBR adjustment drift tolerance raised to 10 PKR (config-driven)

- **"Bill changed — re-adjust bill" no longer blocks FBR submission over a few rupees of rounding.** When the tax consultant adjusts quantities / unit prices on the dual-book FBR overlay, rounding across many lines routinely leaves the overlay total a rupee or two off the delivery-bill total. The stale-adjustment guard treated that as "the bill changed after it was adjusted" and blocked Validate/Submit. The acceptable tolerance is now **10 PKR** (was a hardcoded 2 PKR) and is a single operator-tunable setting — **`Invoice:NarrowEditTotalTolerancePkr`** in `appsettings.json`. All three consumers read that one key so they can never disagree: the `FbrAdjustmentStale` UI flag and the narrow-edit / adjustment total-preservation guard (`InvoiceService`), and the Validate/Submit gate (`FbrService`, which now takes `IConfiguration`). This directly clears cases like Hakimi invoice #3842 (bill Rs 287,000 vs FBR Rs 286,998). A read-only sweep of every adjusted invoice in the prod replica shows the largest real drift is **0.80 PKR**, so 10 PKR sits well above genuine rounding noise yet far below any material bill change. Also excluded `tools/**` from the main API compile (mirrors the existing `scripts/**` exclusion) so a locally-built ETL tool's generated `obj/` no longer breaks the API build with duplicate assembly attributes.

### 2026-07-18 — PO parser: stop the column reader from wrecking tuned production formats

- **Fixed a severe regression the generic parser introduced on real production POs.** An audit re-parsed all **125** PO PDFs ever uploaded to production (read-only) and found the new column-position reader garbled **98** of them. The column reader assumes every header column also appears in every data row; the Meko Denim/Fabric + Innovative Aqua layouts merge the item **code into the item-name cell**, and Lotte's "Non-Inventory Items" layout leaves the **Required Delivery Date** cell blank — both shift the data columns left of the header, so descriptions collapsed to bare UOM tokens (`PC`, `PCS`, `TIN`, `RFT`) and quantities became the rate/amount (e.g. `S.S JUBLEE CLIP 2"`×10 → `PC`×215). The parser now runs the tuned adjacency scanner alongside the column reader and **prefers whichever yields more plausible items** (real product names over mis-mapped UOM tokens), so the column reader still wins on well-aligned tables (and where it reads a buried quantity better) while the adjacency scanner recovers the misaligned production layouts. Also restored two footer stop-markers (`Total <amount>` at line-end, `Sales Tax Amount`) the earlier rewrite had dropped, which were leaking totals into the last item. All **125** now parse as well as or better than before; the offline harness stays green (**197/197** diverse, **57/65** adversarial, **8/8** new production-format cases) and a new full-item production dump/classify tool backs the read-only check.

### 2026-07-18 — Generic PO parser + Parser Feedback

- **Generic PO parser — works for (almost) any PO layout** — item extraction was reworked to be layout-agnostic. Only **Description and Quantity are required** now; the Unit column is optional (defaults to `Pcs`), as are the PO number/date labels. A column-position reader parses each field by its header's column, so it handles arbitrary column order, **alphanumeric item codes** (`A100`, `SKU-9931`), **no unit-of-measure column**, header-word **synonyms**, thousands separators + decimals, currency in price columns, multi-line descriptions, and multi-page footers — and never confuses the quantity with a price/amount column. The legacy scanner remains as a fallback. Hardened over two adversarial rounds (**197/197** diverse + **57/65** adversarial layouts); a committed regression harness (`scripts/po_parser_harness`) and a production read-only check on real uploaded PDFs (`scripts/po_parser_prod_regression.py`) gate future changes. Runbook: `PO_IMPORT_PARSER_GUIDE.md`.
- **Parser Feedback on PO imports** — when a PO parses, the import Review screen shows a **Parser Feedback** question above Create — *"Was this Purchase Order imported correctly?"* (Yes / No). Optional and non-blocking; the answer, the original PDF, and the parser version are retained. New `api/import-feedback` endpoints list flagged imports, download the original PDFs (single or ZIP), and report accuracy — a foundation for improving every document importer. Gated by `importfeedback.*` permissions.

### 2026-07-17 — Report client filters, Tax Sheet transfer, invoice-list scroll fix

- **Client filter** (specific client name, e.g. "Lotte Kolson") on both the **Tax Sheet** and the **Sales** report, each carrying through to its **Excel export**. On the Sales report it sits alongside the existing buyer-type filter (they combine).
- **Transfer remaining → next month** on the Tax Sheet: when the consultant classified only some of a period's invoices, the still-unclassified ones can be moved to a chosen date (defaults to the 1st of next month) in one action, instead of re-dating each bill by hand. The server recomputes exactly what the sheet shows (period + client filter), moves those invoices' dates, and skips any already submitted to FBR. Gated by a new `reports.taxsheet.transfer` permission; audit-logged.
- **Fixed:** the Bills/Invoices list jumped to the top after Validate / Submit / Edit-Save (and other row actions) — it now keeps its scroll position (the list stays mounted during the refresh instead of being replaced by a spinner).

### 2026-07-15 — Bill-mode vs Invoice-mode Item Types (HS-aware) + dual-book reclassification

- **Fixed:** an Item Type picked on the challan-based bill-create form was silently dropped — `CreateInvoiceItemDto` carried no `ItemTypeId` and `InvoiceService.CreateAsync` read the type from the source challan line instead of the operator's pick. The pick now wins (falling back to the challan's type when none is sent), so it persists to the bill line, the Invoice-tab view/edit, and the grouped Sales Tax Invoice print.
- **Item Type pickers are now HS-code-aware and role-scoped:** Bill mode (Bills tab + both create forms) offers only **non-HS** "product family" types (the operator declares what shipped); Invoice mode (Invoices tab) offers only **HS-coded** types (the tax consultant assigns the FBR classification).
- **Dual-book reclassification:** on the Invoices tab the consultant reclassifies each grouped row to an HS-coded type and adjusts qty/unit price. Those changes land on the `InvoiceItemAdjustment` overlay only (no schema change) — the Bill/delivery document keeps the operator's declared non-HS type and real qty, while the Sales Tax Invoice and FBR Validate/Submit read the reclassified HS type. A bill of 10 lines (5 + 5) shows as 2 editable grouped rows.
- **FBR-ready badge + workflow filter are dual-book-aware:** a bill reclassified to HS types in Invoice mode now shows the green "ready" badge and appears under the "ready" list filter (previously it read the non-HS base line and stayed stuck in "not adjusted").
- **UX fixes:** the "Apply same Item Type to all" bulk picker now retains its selection on the create forms; and the Invoice-mode grouped picker shows the line's current (non-HS declared) type instead of an empty "Pick item…", while still offering HS-coded types to reclassify to.
- **"Adjustment out of date" guard:** if the delivery bill is edited *after* the tax consultant reconciled the FBR adjustment (qty / unit price / line changed), the invoice's FBR total no longer matches the bill total. The invoice drops out of "ready", shows a **"Bill changed — re-adjust"** badge + a clear Invoice-mode banner, and FBR **Validate/Submit are blocked server-side** until the consultant re-adjusts — robust across repeated bill edits (a per-line snapshot backfills onto existing adjustments). When re-opening a stale invoice, the rows show the consultant's **last adjusted** quantities & unit prices, each with a **"bill: …"** note showing what the bill now says; the total-preservation panel shows the gap between the last adjustment and the current bill so they can reconcile to the bill total, then Save.

---

## Roadmap

- [x] Multi-company delivery challans
- [x] JWT authentication & role-based access
- [x] Server-side pagination & filtering
- [x] Invoice generation from challans
- [x] GST calculations with amount in words
- [x] FBR Digital Invoicing (V1.12)
- [x] AI-powered PO import (Gemini)
- [x] Customizable print templates (HTML + GrapesJS)
- [x] Excel export
- [x] Audit logging
- [x] User management
- [ ] Dashboard analytics & charts
- [ ] Dark mode
- [ ] Mobile app (React Native)
- [ ] Multi-language support (Urdu)

---

## Contributing

Contributions welcome! Please open an issue first to discuss changes.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

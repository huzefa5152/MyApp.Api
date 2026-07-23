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

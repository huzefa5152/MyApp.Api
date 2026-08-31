# MyApp ERP - Delivery Challan & Invoicing System

![.NET](https://img.shields.io/badge/.NET-9.0-512BD4?logo=dotnet&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![SQL Server](https://img.shields.io/badge/SQL%20Server-2022-CC2927?logo=microsoftsqlserver&logoColor=white)
![FBR](https://img.shields.io/badge/FBR-DI%20V1.12-green)
![AI](https://img.shields.io/badge/AI-Gemini%202.0%20Flash-4285F4?logo=google&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green.svg)

A full-stack ERP system for Pakistani businesses to manage the complete **Purchase Order -> Delivery Challan -> Invoice -> FBR Submission** workflow. Built with ASP.NET Core 9 and React 19, featuring AI-powered PO parsing, FBR Digital Invoicing integration, customizable print templates, and multi-company support.

> Actively evolved across many focused sessions — see the **[Changelog](#changelog)** for the incremental, session-by-session history.

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
- **Granular RBAC** - permission catalog (`module.page.action`) with custom roles; action buttons render only when permitted
- **Multi-Tenant Isolation** - per-company access control (`UserCompany` + division-level scoping)
- **User Management** - Create, edit, delete users and assign roles/companies
- **Audit Logging** - All errors/warnings + FBR communication logged with request details
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

> This project evolves across many focused sessions. **Every session that ships a
> feature or bug fix appends a dated entry here (newest first)** — README is the
> running, incremental record of the product's evolution. (See the rule in
> `CLAUDE.md`.)

### 2026-08-31 — Accounting Reports: Balance Sheet, Profit & Loss and the General Ledger

- **A real Balance Sheet.** Assets, liabilities and equity as at a date, laid out as a proper statement — indented groups, subtotals at every level, totals in bold — with the same date one year earlier beside it and the change. Until now the product only had the Chart of Accounts split into two statement sections with all-time balances; there was no statement, no period and no comparative.
- **A real Profit & Loss** for a period, against the period immediately before it of the same length. Income shows positive, a Gross Profit line appears where a Cost of Sales group actually has activity, and Net Profit ties exactly to the Trial Balance.
- **The Balance Sheet states whether it balances.** A green *Assets = Liabilities + Equity* confirmation at the top, or a red banner naming the difference. Equity carries a **Current-Year Earnings** line — the profit that would otherwise be stranded in the income and expense accounts — using the same rule the Chart of Accounts already applies, so the two can never disagree.
- **General Ledger** — every posting, chronological, across all accounts or one, with the document and party behind each line. Scope it to a single account and a running balance appears; across mixed accounts it does not, because that total would be meaningless. The report checks that debits equal credits and says so if they ever do not.
- **Account Balance Summary** — opening, movement and closing per account, filterable by group and by account type, built on the Trial Balance so the two cannot drift apart.
- **Trial Balance** now also available as a full report with the shared header, Print, PDF and Excel.
- Click any account on a statement to open its ledger. Statements print as their hierarchy rather than as a generic grid.
- If a company tracks stock, the Profit & Loss says on its face that a sale does not yet relieve inventory, so the profit shown is before cost of sales.

### 2026-08-31 — Accounting Reports: customers and suppliers

- **Customer Ledger and Supplier Ledger.** Every transaction on a party's account in date order with a running balance — invoices, credit and debit notes, receipts, payments, advances and journal entries. Set Period to **All Periods** and the ledger answers "how did this balance arise?" from the very first entry. Pick one party, or leave it empty to see everyone in one stream.
- **Customer Statement and Supplier Statement** — the same figures laid out to send out: your letterhead, the customer's name and address, the period, the transactions, **Amount Due** in its own panel, and an age breakdown of the balance at the foot. Print or PDF.
- **Customer / Supplier Balance Summary** — one line per party: opening, invoiced, received, owed, open documents and status. Click a party to open their ledger.
- **AR / AP Aging, upgraded** — now proper reports with filters, an as-of date taken from the period end, and a drill-down: click a customer to see the individual invoices making up their balance. A past as-of date now re-derives what was actually settled by then instead of using today's paid figures.
- **Outstanding Invoices / Outstanding Bills** — the unpaid documents, oldest debt first, each with an age bucket and days overdue, plus a by-party breakdown.
- **Customer Sales / Supplier Purchases** — document-and-item detail of what each party bought or supplied, with a by-item-type breakdown. Also serves Sales by Customer and Purchases by Supplier.
- **Money you owe reads positive.** A payable is a credit balance in the accounts, which would print as a minus; the supplier reports flip the balance so "we owe 50,000" shows as 50,000.
- **Imported data is handled honestly.** A company migrated from another system has ledger entries that were never attributed to individual customers, so the party reports build from the documents instead and say so in a note. The figures reconcile to the aging report either way.
- **Where two reports differ, they explain themselves.** The Balance Summary states, with the exact figure, when its total differs from the Aging total — aging counts only open documents, while the summary is the full position including credit notes and parties in credit.
- **Supplier Sales** is listed as Blocked with the reason on the card: a sales invoice is always raised to a Client, so suppliers are purchase-side only.
- One reporting index added (`JournalLines(PartyType, PartyId)`); no table or column changes.

### 2026-08-31 — Accounting Reports: an organised reporting section, and the Company Expense Report

- **Reports → Accounting Reports is now a proper section, not a three-tab screen.** Reports are grouped into ten categories — Expenses, Cash & Bank, Financial Statements, Customers, Suppliers, Sales, Purchases, Taxes, Accounting Control, Management — with a "Start here" row for the ones most people open. Reports not built yet are listed and marked **Soon** rather than hidden, so you can see the shape of the module.
- **Company Expense Report** — the answer to "where did the money go?". Every expense in a period with payee, expense account, payment account, tax and reference; totals for Total Expenses / Total Tax / Total Paid / Transactions; and two breakdowns (by Account, by Payee) with a share bar. Click any breakdown line to see the transactions behind it, then open the original payment or bill.
- **Eight more expense views** off the same figures: Expense Detail, by Account, by Payee, by Category, by Date, Monthly, by Payment Account, by Tax.
- **Cash & Bank (10 reports):** Cash & Bank Summary (opening → receipts → payments → closing → uncleared cheques per account), Cash Book, Bank Book with a running balance, Receipt and Payment Registers, Receipts/Payments by Account, Cheques in Hand, Cheques Issued (post-dated flagged, days-to-due, past-due total) and Unallocated Payments (advances nothing has absorbed yet, oldest first).
- **The dashboard is now a starting point.** Cash & Bank, Receipts, Payments, Net cash flow, Receivables, Payables, Net position, Expenses and both cheque cards open the matching report, carrying the period the card was showing so the figures match. Recent receipt/payment rows open the document.
- **Every report is filtered the same way:** Period (Today, This Week, This Month, Last Month, This Quarter, This Year, Last Year, Custom, **All Periods**), plus Branch, Expense account, Category, Payee type, Payee, Payment account, Tax, Status and Search where they make sense. Applied filters show as chips, print on the report, and live in the address bar so a view can be bookmarked or shared.
- **Excel, Print and PDF on every report.** Excel exports the whole filtered set — not just the page on screen — with the company name, period, filters and totals on the sheet.
- **Expenses are read from the general ledger, not the payments table**, so an expense that arrived via a purchase bill or a manual journal is included. The report total equals the Trial Balance's expense-account debits, and a Cash/Bank Book's closing balance equals that account's Chart of Accounts balance — the reports read the same ledger rather than recalculating it.
- **Honest about what isn't there.** Gross Profit and Customer Profitability are listed as **Blocked**, with the reason on the card: sales record revenue but nothing yet relieves inventory, so there is no cost of sales to compare against. Suppliers remain purchase-side only, so there is no "Supplier Sales" report.
- Accounting guide gains an **Accounting Reports** chapter: how to read any report, the filters, the Company Expense Report end to end, Cash & Bank, the registers, cheques, exporting, and dashboard drill-down.
- New permission `accounting.reports.export` gates Excel download; it is granted automatically to every role that already had `accounting.reports.view`, so nobody loses access. Two reporting indexes added (`Payments(CompanyId, Direction, Date)`, `PaymentAllocations(Kind, AccountId)`); no table or column changes.

### 2026-08-31 — Record any payment or receipt, without knowing accounting

- **You can now record an ordinary expense.** Until today the only way to enter "paid the electricity bill" was to invent a purchase bill or write a journal entry. Accounting → Payments → **Record Payment** now asks two plain questions — *who are you paying?* and *what is this payment for?* — and writes the accounting itself. Receipts work the same way.
- **Pay or be paid by anyone.** The payee can be a **Client**, a **Supplier**, or **Someone else** (a landlord, a courier, an employee) whose name you simply type — nothing is added to your master data. Paying a supplier for a one-off cost with no bill is now a single document instead of two.
- **Three things a payment can be for:** settle their unpaid invoices/bills (as before), **an expense or other income**, or an **advance / on account**.
- **Advances are finally real.** Money paid to a supplier before their bill, or taken from a customer before you invoice them, now sits against that party's balance and is absorbed when the document arrives. Previously such amounts disappeared into a Suspense account and never showed on the party's ledger.
- **Recoverable tax on an expense.** Enter the amount as it appears on the bill and a Tax %; the form shows the split before you save, the expense records net of tax, and the tax goes to Input Sales Tax (or Output Sales Tax on money in).
- **Spending shows up in the supplier's ledger.** An expense paid to a known supplier is now tagged to them instead of being left unattributed.
- **Every account dropdown shows which group an account belongs to**, and searching matches the group name too — so two similarly-named accounts are easy to tell apart.
- **Chart of Accounts ships more of what a business actually needs**: Electricity, Internet, Telephone, Office supplies, Travel & conveyance, Repairs & maintenance, Marketing & advertising, Professional fees, plus Owner's capital, Owner drawings, Service revenue, Other income, Prepaid expenses and Loans payable.
- **New in-app Accounting Guide** (Accounting → **Accounting Guide**) — written for business owners, not accountants: how to set a company up, when to use Receipts vs Payments, what each document does to your accounts, ten worked examples, and how to trace any figure back to the transaction behind it.
- Wrong entries are now refused with a readable reason instead of being quietly posted: no payee, no payment account, no expense account, zero or negative amounts, tax larger than the line, tax on a line that settles a document, an advance with no party, and posting an expense straight at a system-maintained account.

### 2026-08-29 — Printed documents: signature at the foot of every page, and no more filler rows

- **The signature block now prints at the bottom of every page.** Before, it only appeared on the last page of a document, part-way up — so a two-page invoice had no signature line at all on page 1, and a long one had none on pages 1 and 2. Every document type is covered: bill, tax invoice, delivery challan, sales quote, sales order, credit and debit note, purchase bill, goods receipt, and the receipt, payment, transfer, journal and withholding-tax vouchers.
- **The empty rows after the last line item are gone.** Item tables were padded out to a fixed row count (18, 20, 22 rows depending on the template), so a three-line invoice printed with seventeen blank ruled rows under it. Tables now print exactly the lines the document has, and the signature is still held at the foot of the page.
- **Line items can never run underneath the signature.** Each page reserves exactly the room the signature block needs — measured from the block itself, so it is right whether or not your company has a stamp image on it.
- **Column headings now repeat on continuation pages.** Some templates dropped the table header on page 2; a multi-page document keeps its headings throughout.
- Totals, amount in words and the FBR digital-invoice panel still print once, after the items, exactly as before — only the signature repeats. Existing template designs, fonts, colours, logos and stamps are unchanged, and the fix applies to templates you have already saved as well as to every starter design, so anything created from now on behaves the same way.
- Also applies to **Export PDF**, not just Print.

### 2026-08-29 — Customer Portal: choose the document, and a redesigned customer view

- **Pick which document customers download.** When you create a portal you now choose the **Bill** or the **Tax Invoice**, and the portal always uses that one. Only documents your company actually has a template for can be selected — the rest are shown greyed out so it's obvious what's missing. You can change the choice on an existing portal at any time from the list, and the customer's link stays the same.
- **Fixes a case where Print and PDF never appeared.** The portal previously looked only for a Bill template, so a company that had set up a Tax Invoice template got no download buttons and no explanation. It now uses whichever document you chose, with the matching data behind it.
- **The customer-facing page has been redesigned.** It leads with the one figure that matters — the amount outstanding — with supporting totals beside it, status filters that show how many invoices sit in each state, and amounts set in aligned figures so columns read like a statement. Overdue invoices are called out, the company's details stay pinned at the foot of the page while the invoice list scrolls, and the whole thing is built for phones, tablets and large screens alike.
- **Only the invoice list scrolls now.** The header, the summary figures, the status filters, the pager and the company footer all stay put; the list itself scrolls inside its own panel — with its column headings pinned — and shows no scrollbar at all when everything fits. The summary was reworked from a block of cards into a single compact strip, so a laptop screen now shows around ten invoices at once instead of one or two.
- **Choose how many invoices to show.** A rows-per-page control on the pager offers 10, 20, 50, 100 or 200, and the pager reads "1–20 of 137" so it is always clear where you are in the list.

### 2026-08-29 — Uploaded files are private by default

- **Closed a hole in the public file server.** The app served the whole `data/` folder over the web and blocked one sub-folder by name, which left several things readable by anyone who guessed the address — archived customer PO documents (numbered `archive-1`, `archive-2`, …), each company's branded Excel workbook, and the PDFs behind PO import and parser feedback.
- Only the four folders a browser genuinely has to load are public now: company logos, stamps/signatures, quote line photos, and avatars. Everything else under `data/` — today's folders and any added later — is unreachable over the web and stays available only through the app's normal, permission-checked screens.
- Nothing changes for users: logos, stamps and photos still appear on screen and on printed documents, Excel export and PO import work exactly as before, and attachments continue to download through the app.

### 2026-08-28 — Customer Portal: give a client a private link to their own invoices

- **Create a public portal for any client** from *Configuration → Customer Portal*. Pick the company and the client, and the system generates one secret link. Copy it, open it, disable it, or revoke it for good — one live link per client, and the screen tells you plainly that anyone holding the link can see that client's invoices.
- **Your customer needs no login.** The link opens a clean, branded page showing your company name and logo, their name, and their invoices — total, paid, outstanding, and a card for anything they've overpaid. They can filter by Unpaid / Partially Paid / Overdue / Paid / Overpaid, search by invoice number, filter by date, open any invoice in full, and print or download it as a PDF using **your** configured invoice template. Works on a phone.
- **They only ever see their own.** The link decides which customer's invoices load — the company and client are resolved on the server from the link itself, so no amount of editing the address bar reaches another customer's documents. Disabling a link cuts access instantly; re-enabling restores the same link; revoking kills it permanently.
- **Overpayments are finally visible.** If a customer has paid more than an invoice ended up being worth, the portal shows the credit. The internal Bills list still reports that as simply "Paid" with a zero balance.
- Print and PDF are hidden automatically for a company with no invoice template, rather than offering a button that can only fail. Excel download is not in this first version.

### 2026-08-28 — Copy any document, or turn it into the next one

- **Copy is now on every Sales Quote, Sales Order, Delivery Challan, Bill, Purchase Bill and Goods Receipt** — on the cards and, where the screen has a table view, on the row too. One dialog asks what to copy it as, what to bring across, and the date; the new document number is always allocated by the system.
- **Copy as the same kind of document, or into the next one in the flow.** Supported conversions: Quote → Order, Order → Challan, Order → Bill, Purchase Bill → Goods Receipt, and Goods Receipt → Purchase Bill. Conversions that don't make business sense aren't offered — a challan still becomes a bill through the billing flow, so nothing can be billed twice.
- **The original is never touched.** Lines, quantities, prices, tax settings, party and division come across; the identity of the source does not — new number, today's date, fresh status, no payments, no FBR submission, no supplier IRN. Anything deliberately dropped or adjusted is reported back (a rounded goods-receipt quantity, a blanked supplier invoice number, a receipt copied to a bill with no prices yet).
- **Copies remember where they came from**, and attachments can come along — each file is duplicated, so deleting one copy never removes the other's.
- **Your permissions decide what you can copy into.** A destination you can't create is shown greyed out with the reason, and the server enforces the same rule.

### 2026-08-28 — Bills can be dated in the future

- **Raise a bill ahead of its billing date.** Both create paths — *from a challan* and *standalone (without a challan)* — now accept a future **Bill Date**, so you can cut a 1-September bill in late August. Editing a bill's date to a future day works too. The date you pick is the date that is stored and printed; nothing is silently moved to today.
- **FBR submission is unchanged.** FBR rule **[0043]** still refuses a future-dated invoice, so a bill dated ahead simply can't be validated/submitted until its date arrives — you'll get the same clear *"Invoice date cannot be in the future. [FBR 0043]"* message at submit time instead of at create time. Companies with FBR off are unaffected.

### 2026-08-11 — Product photos on Sales Quote lines (and on the printed quote)

- **Attach a photo to any Sales Quote line.** Each line in the quote form has a photo slot — click it to pick a file, drag an image onto it, or paste one with `Ctrl+V`. Filled slots show a thumbnail with a small ✕ to clear it, and clicking replaces it. Phone photos are shrunk in the browser before upload (long edge 1200px), so a 4 MB snap uploads in a fraction of a second and still prints sharp. *Repeat last* copies the photo along with the rest of the line. Works the same on phone, tablet and desktop.
- **Photos print on the quote.** The printed quote (and its PDF) gains an **Image** column: every photo is drawn inside an identical fixed box, so tall, wide or huge source images all sit level and never stretch a row or crop the product. The column appears **only** when a quote actually has photos — a photo-free quote prints exactly as before. Lines without a photo simply leave the cell empty.
- **Available in every quote design.** All 15 Sales Quote starter designs and the existing default quote templates carry the column, with new merge fields (`{{this.imagePath}}`, `{{#if hasLineImages}}`) listed in the template editor's sidebar for custom layouts.
- **Photos are per-quote and tidy up after themselves.** Replacing or clearing a line's photo — or deleting the quote — removes the stored file. Uploads are validated (JPG/PNG/WebP/GIF, 5 MB cap, real image contents), scoped to the company that uploaded them, and a quote can never be saved pointing at another company's photo or an outside web address.

### 2026-08-11 — Per-invoice print grouping + Sales Order → challan → bill flow fixes

- **Choose how each document prints its lines — grouped by item type or individual.** Every bill now carries an independent print-grouping choice for its **Bill** print and its **Tax Invoice** print: *Individual* (the default) prints each line with its own quantity and real description; *Grouped* collapses lines that share an item type into one summed row labelled by the item type. The choice is saved per invoice, applies to print **and** PDF, appears whenever you edit a bill (even single-line), and the two documents are independent (grouping the Tax Invoice never changes the Bill). For **FBR-off** companies the Invoices tab is now **grouping-choice-only** — item type/quantity stay read-only there (edited on the Bills tab), so stock can't be disturbed from the invoice view.
- **Sales Order → challan → bill flow fixes.** (1) Deleting or cancelling a challan now **re-opens** a Sales Order that had auto-closed on full delivery, so *Create Challan* returns (and the order's stock reservation is restored) instead of leaving the order stuck. (2) Adding or editing a **PO on a Sales Order now propagates** to its existing challans (sets the PO and flips *No PO* → *Pending*), which also unblocks billing them. (3) Generating a bill from a Sales Order now **keeps that order selected** in the Create Bill "Sales Order" dropdown.

### 2026-08-10 — Smoother roles & access: no false "no-permission" warnings, ready-made roles, one-step user setup

- **Create screens stop nagging for "view" permissions.** Opening a create/edit form (invoice, delivery challan, sales quote, sales order, bill, purchase bill, goods receipt, payment, withholding-tax receipt) no longer throws a *"You don't have permission"* warning just to fill its dropdowns. A role that can **create** a document can now load the customers, suppliers, divisions, item/GL-account lines, open sales orders, print templates and pending challans those forms need — **without** also being granted the broad "view" permission that opens the module's sidebar tab. Least-privilege is preserved: the tab stays hidden and the module's full list / summary pages stay gated, and tenant isolation is unchanged (you still only ever see companies you're assigned to).
- **Background look-ups no longer pop warning toasts.** A dropdown that can't load shows its own quiet inline state instead of a global red warning; the permission warning still appears for actions you actually click (save / submit / delete).
- **Division-restricted operators are no longer blocked.** They can pick their division on create forms without needing the Divisions admin permission.
- **Six ready-made starter roles.** **Sales Operator, FBR Officer, Bookkeeper, Inventory Manager, Accountant, Read-Only Auditor** ship out of the box — each a coherent, warning-free permission bundle, fully editable and cloneable. Existing roles are untouched.
- **One-step new-user setup.** The Add User dialog now assigns the role **and** company access together, so a new user works on first login instead of landing on an empty company picker. Each grant still respects the creator's own permissions.
- **Direct-URL hardening.** A page you hold no permission for now redirects to the dashboard instead of loading behind an already-hidden nav link.

### 2026-08-08 — Bank & Cash accounts: edit / retire / correct opening balance; empty-list page-size fix

- **Bank & Cash Accounts — manage accounts, not just view them.** Each account now has **Edit** (name, code, group, division), **Deactivate / Reactivate**, and **Delete**. Deactivating hides an account from the receipt/payment pickers while keeping its full history and balance (reactivate any time) — the way to retire a wrongly-created or no-longer-used bank/cash account. Delete is offered only for empty accounts with no transactions; anything referenced by history (or a system control account) is protected and deactivates instead. Retired accounts stay listed with an **inactive** badge.
- **Correct a wrong opening balance.** The Edit dialog lets you fix an account's opening balance; the offsetting amount posts to **Retained earnings** so the balance sheet stays balanced, with a live preview of the offset before you save. (Deactivating a bank account is safe for the ledger — an edited/re-posted payment tied to it still books to that same account.)
- **Fix: the "Rows per page" selector no longer shows on empty lists.** Screens with no data (e.g. Payments showing "No payments yet") were still rendering a lone "Rows: 10" control — now hidden until there's something to page through. Applies to every paged list (Invoices, Bills, Payments, Journal Entries, …).

### 2026-08-09 — Sales flow: standalone bill items, No-PO billing, order lifecycle & clearer locks

- **Edit a standalone bill's line items.** A bill created directly — no delivery challan, no sales order — can now have items **added and removed** when edited, just like the create form. Bills that came from a delivery challan or a sales order still direct you to the source (challan or order) to change items, so a bill never drifts from what it was billed against. (Previously every bill blocked add/remove, which stranded standalone invoices — you couldn't add a line after saving.)
- **Bill "No PO" delivery challans when FBR is off.** For companies without FBR integration, a delivery challan that has no customer PO is now billable directly from the challan list/table and counts toward its sales order's billable challans. FBR-enabled companies still require a PO first.
- **Cancel or delete a sales order that only has cancelled challans.** A voided (cancelled) delivery challan no longer keeps its order stuck **Open** — cancelling or deleting the order now ignores cancelled challans (delete unlinks them, preserving their history). Active challans still block it.
- **Clearer locked states on quotes & orders.** When a quote is locked (converted to an order) or an order is locked (a challan from it was billed), the Edit button now shows **disabled with a tooltip explaining why**, instead of silently disappearing.
- **Consistent, responsive form field alignment.** Data-entry forms — Create/Edit Bill, Delivery Challan (create + edit), Sales Order, Sales Quote, Withholding Tax Receipt, Create-Challan-from-Order, PO Import — now lay their fields on an aligned responsive grid: fields line up in even columns and collapse cleanly to fewer columns on narrow screens instead of wrapping raggedly. Pure UI, no behavior change.

### 2026-08-08 — Company Stamps + print-template load speed & preview loaders

- **Company Stamps — reusable stamp/signature images as print-template merge fields.** Upload multiple stamps per company on the new **Stamps** tab (Configuration → Print Templates), then drop any of them into a template as `{{stamps.<name>}}` — one click in the editor's merge-field sidebar inserts a ready `<img>`. No more pasting giant base64 images into template HTML, and each template can carry different stamps. Stamps render in the live preview, Print, and PDF. Managed under new permissions `printtemplates.stamps.view` / `printtemplates.stamps.manage`; each stamp keeps a stable key so renaming it never breaks templates already using it.
- **Print Templates page + editor load much faster.** The template list now loads metadata only (names, types, scopes) instead of every template's full HTML — a company with megabytes of template markup went from multi-MB list loads to a few KB. Template bodies are fetched on demand when you open, preview, or duplicate one.
- **Loaders everywhere in the editor.** Opening or switching a template shows a spinner while its content loads (no more blank editor that fills in a second later), and the preview shows a "Rendering preview…" spinner while a heavy template (e.g. one with a large embedded image) paints.
- **Editor Excel bar decluttered.** The "No Excel template" prompt no longer shows in the editor — Excel layouts are managed on the dedicated Excel Templates tab; the bar appears in the editor only when a layout is attached.
- **Template header shows the logo _or_ the company name — not both.** Every starter and default print template now shows the company logo when one is set, and falls back to the company name only when there's no logo (previously both rendered, which looked cluttered). Division-logo-aware headers fall back correctly too.

### 2026-08-07 — Bill/invoice description fix + Grouped-by-Item-Type invoice view

- **Receipts & Payments — settle-remainder adjustments + focused from-document form (Manager.io parity).** When you record a receipt/payment against a document, each line now takes the **cash received** plus an optional **adjustment** that clears the rest of the balance — routed to any GL account you choose (one-tap **Discount** / **Write-off** presets, or **Other** to pick any account). Examples: a 30,000.50 invoice settled by 30,000 cash + 0.50 discount; a 300,000 invoice settled by 200,000 cash + 100,000 written off. The invoice shows fully **Paid**, cash recorded is only what came in, and (GL on) the gap posts `Dr <chosen account> / Cr Accounts receivable` — balanced. Over-settling past the balance is rejected. Opening the form **from a specific invoice/bill** now shows only that one document (locked); the standalone Receipts/Payments page keeps the full client picker + all open documents.
- **Withholding tax on sales invoices & purchase bills (Manager.io parity).** Each invoice/bill can now carry an income-tax withholding rate (%) or a fixed amount that reduces the **balance due** by the withheld slice — the customer/supplier settles the reduced amount, and recording a receipt/payment of that reduced balance now marks the document paid in full (over-allocation past it is rejected). Grand total, GST and the FBR payload are **unchanged** (WHT is income-tax, layered on top of sales tax). When the GL is enabled the withheld amount posts to a dedicated *Withholding tax receivable* (sales) / *Withholding tax payable* (purchase) account, splitting the AR/AP line; balance-due, aging and the customer/supplier summaries all reflect the reduced collectible. A company-level **default WHT rate** pre-fills new documents.
- **Fixed: line descriptions no longer get replaced by the Item Type name.** When a sales order line carried an Item Type, creating the bill from its delivery challan overwrote each line's description with the Item Type's name (and locked the field), so the bill and invoice showed e.g. "Hardware Items" instead of the actual product text. Item Type now sets **only** the FBR fields (HS Code / UOM / Sale Type / GL account); the description always keeps the challan/order's own product text and stays editable.
- **Sales Invoice edit — "Grouped by Item Type ⇄ Individual lines" toggle.** The Invoices-tab edit now defaults to a grouped view that collapses every line sharing an Item Type into one row with **summed quantity + value** — the same shape FBR receives. Editing a group's **Qty** spreads the new total across its lines (proportional, whole-number-aware for Pcs/SET); editing **Unit Price** sets one price for the whole group. Switch to **Individual lines** to re-classify or fine-tune a single line. The toggle only appears when grouping actually collapses lines; Save, the total-preservation guard, and the tax-claim panel are unchanged (grouping is a pure view over the same line data).
- **Invoice-mode Edit reachable on FBR-off companies.** The Invoices-tab **Edit** button was previously hidden whenever a company had FBR turned off, so those companies could only *view* invoices (and never reach the grouped/individual editor). It now shows for FBR-off companies too — letting the operator adjust item type / qty / unit price (kept as an adjustment overlay over the bill, total reconciled) and pick the grouped-vs-individual view. Still hidden once an invoice is FBR-submitted or cancelled.
- **Print templates — faster loading + clearer create/edit UX.** Every document screen's print-template picker (challans, invoices, bills, quotes, orders, notes, receipts, …) now loads the template list **once per company and shares it across screens** instead of refetching on every visit, and shows a brief "Loading templates…" state instead of flashing a bare "Default" before the rest pop in. The list endpoint no longer opens and parses every attached Excel workbook just to enumerate them (the main slowdown) — template bodies are still returned, so printing/preview are unchanged. In the Template Editor's **Saved Templates** manager, renaming is now instant and reliably saved (the old inline rename could look stuck and lose the new name), and set-default / rename / duplicate / delete show a spinner on the row being changed; the **Print Templates** page shows per-card progress and a "Creating…" overlay when building a template from a starter. Any template change refreshes the document-screen pickers automatically.

### 2026-08-06 — Purchase-bill sources + optional Sales Order item type

- **Item type is now OPTIONAL on a sales order (V2 companies).** An order captures intent, not a stock movement, and PO imports arrive unclassified — so the previous "every line must have an Item Type" hard block is lifted. Bills/purchase bills still **require** classification, and a type set on the order propagates to the bill; leave it blank and you classify at bill time. Classified lines are still committed + base-UOM-validated, so V2 stock numbers (on-hand, committed, available) are unaffected. This unblocks PO import → Sales Order on standard-inventory companies.
- **PO import review** (Sales Order / Sales Quote) gains an optional per-line **Item Type** picker, so operators can classify during import if they want.
- **Purchase bill from a sales order** now lists **every open OR closed** order (auto-closed once fully delivered), not just partially-delivered ones — purchasing is independent of delivery. Lines prefill at the **full ordered quantity**.
- **Purchase bill from delivery challan(s)** — a new "Purchase Against Delivery Challan" button lets the operator multi-select challans; their lines merge (identical items summed) into a purchase-bill prefill, same as the sales-order flow.
- **Supplier quick-create** — the purchase-bill form has a "+ New supplier" shortcut that opens the supplier form inline and auto-selects the new supplier on save.

### 2026-08-05 — PO import: recognise a unit-price column (Sales Order + Sales Quote)

- **The generic parser (`simple-headers-v1`) can now read a per-unit price/rate column.** PO Formats gains an optional **"Unit price column header"** (e.g. `Rate`, `Unit Price`); when set — or when the parser auto-detects a `Rate`/`Price`/`Cost` column (never an `Amount`/`Total`/`Value` line-total) — each parsed line carries its `unitPrice`.
- **Sales Order and Sales Quote imports now prefill the unit price** from that column (Sales Order gained the price column in the import review; Sales Quote already had one). A **Delivery Challan** import stays quantity-only and ignores price by design. Sales Order lines with no detected price keep "no agreed price" so the bill still falls back to quote / last-billed.
- Extraction is additive — description/quantity/unit reading is unchanged. New `unit_price_corpus.json` cases added; the offline corpus harness stays green.

### 2026-08-05 — Purchase Bill + Import Challan: mobile-friendly forms, dialogs & pickers

- **Purchase Bill fully usable on a phone.** The New/Edit Purchase Bill modal now scrolls correctly on short screens (footer no longer clipped) and its line items render as stacked cards below 768px — item type / non-inventory picker, description, qty, unit, price and GL account all editable — instead of a cramped wide table. The dialogs on that screen (the Sale Bill / Sales Order / Delivery Challan pickers, the supplier quick-create form, and the payment allocation table) all get phone card / stacked layouts. Desktop tables unchanged.
- **Import Challan**: the results table and field grids stack on phones — no sideways page scroll.

### 2026-08-05 — Line items: paste-list, repeat-last, responsive editor

- **Faster, mobile-friendly line entry on Sales Quote / Sales Order / Delivery Challan.** A shared line-item editor replaces the per-form tables: **Paste list** turns pasted rows (tab/comma → description, qty, unit, price) into lines, **Repeat last** clones the previous line, and each line renders as a **card on phones / a table on desktop**. Item type, non-inventory items, division scoping, the optional Sales-Order unit price, and delivered-line locks are all preserved.

### 2026-08-05 — Mobile responsiveness: shared pagination/rows-per-page + screen sweep

- **Shared pagination + rows-per-page** across the list screens (Sales Quote/Order, Challans, Invoices, Payments, Purchase Bills, Goods Receipts, Journal Entries, Transfers, FBR Monitor, Audit Logs, Item Rate History, Stock movements) — one wrapping, touch-friendly pager with a per-screen rows-per-page selector.
- **Phone card fallbacks** for previously desktop-only tables (Purchase Debit Notes, WHT receipts, Non-Inventory Items, Bank & Cash accounts, Clients list) — every column preserved, desktop tables unchanged.
- **Forms**: auto-scroll to the first validation error; purchase/receipt/debit-note line grids stack on phones instead of overflowing; multi-page print/PDF gets A4 page margins.

### 2026-08-05 — PO import: fix single-item POs whose amount ends in "Rs." (Hudson Pharma)

- **Fixed POs that produced an empty parse.** The importer's page-chrome skip rule matched any line ending in `Rs.`, so a single-item order (e.g. Hudson Pharma → ABBAS ALI & SONS: `Butter Paper  12  pack  6,500.00000  78,000.00 Rs.`) had its only item row discarded as footer chrome — the "format matched but nothing parsed" symptom. The rule now only skips a line that is *just* `Rs.`; a data/total row that merely ends in `Rs.` is kept. Both sample POs added to the parser regression corpus.

### 2026-08-05 — Sales Order: jump to challans + filter by client

- **View Challans shortcut.** A Sales Order's challan count is now a link, and its detail screen has a **View Challans** button — both open the Delivery Challan screen filtered to that order.
- **Filter Sales Orders by client.** The Sales Order list gains a searchable **Client** filter next to the division/status filters.

### 2026-08-05 — Sales Orders: attach an existing delivery challan to an order

- **Link a challan raised before the order.** A Sales Order now has an **Attach Challan** action (on the card and in the order detail view, beside Create Challan) that links an existing, unlinked, unbilled delivery challan to the order — for deliveries made before the customer PO / order existed. The operator picks the challan and maps each of its lines onto an ordered line (auto-suggested by item type / description) or adds it as a new order line; the delivered quantity then counts toward fulfilment and the challan becomes billable under the order's PO. No stock movement is recorded (the challan already booked its stock at creation). Only challans in the **same company, same division, and same customer** as the order are offered, and attaching never moves a challan across divisions.

### 2026-08-05 — Mobile responsiveness pass (reports, stock, dashboard, layout)

- **Wide report tables now readable on a phone.** The Sales Report and Tax Sheet switch to a stacked, tappable **card per row** below 768px instead of forcing a horizontal-scrolling table; the desktop tables are unchanged. The Stock Dashboard's Inventory (V2 buckets) table — previously blank on phones — now renders mobile cards too.
- **No more sideways page-scroll on small screens.** The dashboard content wrappers no longer let a wide child stretch the whole page horizontally, and long item/counterparty names on the dashboard wrap to two lines (line-clamp) instead of being clipped so similar-prefix names ("MEKO FABRICS" vs "MEKO DENIM") stay distinguishable. Common-client/supplier company lists wrap the same way.

### 2026-08-05 — Fixes: Item Type carries onto bills from a Sales Order; inline "create item type" no longer closes the parent form

- **Item Type now flows Sales Order → bill.** Creating a bill from a Sales Order (via its delivered challans, or the bill form's "From Sales Order" picker) now shows each line's **Item Type already selected** instead of forcing the operator to re-pick every line. The bill form seeds each challan line's stored type (with its HS/UOM/Sale-Type/account) for untouched rows only, and the Sales-Order bill-prefill payload now carries the item-type name so it survives even before the catalog loads.
- **Inline "Create new item type" only closes its own mini-modal.** Adding a new item type from the quick-create shortcut on any line editor (Sales Order, Quote, Challan, Bill, Purchase Bill) no longer submits and closes the parent document form — the mini-modal's submit/backdrop events are kept from bubbling to the parent, so the parent stays open with the new type selected.

### 2026-08-05 — Sales Order flow: line prices, challan shortcut, challan SO filter

- **Optional unit price on Sales Order lines.** Each order line now has an optional **Unit Price** field. When a bill is created from the order, a line that carries an agreed price prefills the bill at that price; lines left blank fall back to the previous behaviour (source-quote price, then the item's last-billed rate). Prices are optional, so quantity-only orders keep working unchanged.
- **"Create Challan" shortcut on the Sales Order list.** The order row's delivery action is now a clear **Create Challan** button (was the ambiguous "Deliver") that opens the create-from-order flow directly, matching the detail screen — shown only while the order is open and not fully delivered.
- **Filter the Delivery Challan list by Sales Order.** The Challans page has a new **Sales Order** filter (searchable, scoped to the selected company + division) so you can see just the challans raised against one order. It's a plain view filter layered on top of the existing tenant + division scoping.

### 2026-08-05 — Post-sale invoice correction (Correct action)

- **Correct a finalised bill without editing it in place.** A new **Correct** action on the Bills list opens a wizard that bills quantity under-reported on an original bill as a **new delta bill** (optionally cloning the original's delivery challan so the delta prints the same DC#/PO), or raises a **Credit / Debit Note** — the original stays untouched as filed. The delta bill is created unclassified and flows through the normal bill → classify → (FBR) pipeline, keeps the original's **division** and per-division numbering, and posts to the ledger when GL is on.
- **Eligibility follows the company's FBR setting:** when FBR integration is **on**, a bill is correctable once it is **FBR-submitted** (an unsubmitted bill is just edited directly); when FBR integration is **off**, a bill is correctable once it is **fully paid**. The Correct action only appears when the bill is eligible, and **hides after a correction already exists** so no duplicate correction can be raised (also enforced server-side). Gated by the existing `invoices.note.create` permission; every correction is audit-logged.

### 2026-08-05 — Sensible defaults for newly created companies

- **A new company now starts ready to trade, with three defaults applied automatically:** **FBR Integration OFF** (non-FBR wholesalers are onboarded first; turn it on in the FBR tab when the company files digital invoices), **Inventory Tracking ON using the V2 engine** (every item type is stock-tracked; HS code is FBR metadata only), and the **General Ledger ON** (a wholesale Chart of Accounts is seeded and invoices/bills/payments post to journals from day one). The company create form's **Inventory** tab notes the V2 default, and a new **Accounting** tab carries the "Enable General Ledger" toggle (checked by default). Each default is fully overridable on the create screen, and **existing companies are untouched** — the defaults apply only when a company is created (there is no migration or backfill, and company edits are unchanged). Covered by a new `scripts/test_company_defaults.py` regression check.

### 2026-07-18 — Print letterhead logo fix (tax invoice, credit/debit notes) + Purchase Debit Note picker

- **Company logo now prints on the Sales Tax Invoice, Credit Notes and Debit Notes** — the letterhead logo was missing from these printed/PDF documents. Root cause: their print templates render the logo via `{{companyLogoPath}}`/`{{divisionLogoPath}}`, but the tax-invoice print payload (shared by tax invoices and sales credit/debit notes) only supplied the issuer logo under `{{supplierLogoPath}}`, so the token resolved blank. The payload now provides the issuer (your company/division) under **both** naming conventions — `company*`/`division*` **and** `supplier*` — so the logo and letterhead render regardless of which convention the active template was authored with. Same fix applied to the Purchase Debit Note print payload. No template edits or data changes required.
- **Print-template picker on the Purchase Debit Notes screen** — like every other document screen (Sales Quotes, Bills, Purchase Bills…), the Purchase Debit Notes page now shows a **print-template dropdown** in the filter bar, scoped to the selected **company and division**. "All Divisions" lists the company-wide Debit Note templates; picking a division lists that division's; your choice is remembered per company/division. If the selected scope has no Debit Note template, the picker hides and Print/PDF are blocked (consistent with the other screens).



- **Fixed a severe regression the generic parser introduced on real production POs.** An audit re-parsed all **125** PO PDFs ever uploaded to production (read-only) and found the new column-position reader garbled **98** of them. The column reader assumes every header column also appears in every data row; the Meko Denim/Fabric + Innovative Aqua layouts merge the item **code into the item-name cell**, and Lotte's "Non-Inventory Items" layout leaves the **Required Delivery Date** cell blank — both shift the data columns left of the header, so descriptions collapsed to bare UOM tokens (`PC`, `PCS`, `TIN`, `RFT`) and quantities became the rate/amount (e.g. `S.S JUBLEE CLIP 2"`×10 → `PC`×215). The parser now runs the tuned adjacency scanner alongside the column reader and **prefers whichever yields more plausible items** (real product names over mis-mapped UOM tokens), so the column reader still wins on well-aligned tables (and where it reads a buried quantity better) while the adjacency scanner recovers the misaligned production layouts. Also restored two footer stop-markers (`Total <amount>` at line-end, `Sales Tax Amount`) the earlier rewrite had dropped, which were leaking totals into the last item. All **125** now parse as well as or better than before; the offline harness stays green (**197/197** diverse, **57/65** adversarial, **8/8** new production-format cases) and a new full-item production dump/classify tool backs the read-only check.

### 2026-07-18
- **PO Formats are now per-company** — the PO Formats screen has a **Company** dropdown (listing only the companies you can access), and each company owns its own PO formats: the same client can have a different PO layout in each company that trades with it. The list is scoped to the selected company; the Add/Edit form is scoped to it too.
- **Searchable client picker on the PO Format form** — the Add/Edit form's client field is now the same **searchable dropdown** used elsewhere in the app (type to filter), replacing the plain select. It lists **all of the selected company's clients**; clients that already have a format in that company are hidden so you can't create a duplicate.
- **Import PO → Sales Quote and Delivery Challan** — the "Import PO" wizard (upload the customer's PO PDF, parse it against that company's saved PO format, review, create) now works on the **Sales Quotes** and **Delivery Challans** screens too, not just Sales Orders. It parses using the selected company's client PO format, pre-fills the client + line items, and shows an editable preview before you create. The Quote import adds a **Unit Price** column (a quote is a priced document); the Challan import creates a challan **directly** (no sales order needed). If no PO format is saved for that client's layout yet, it falls back to manual entry — save a format under *Configuration → PO Formats* first for automatic parsing.
- **Generic PO parser — works for (almost) any PO layout** — item extraction was reworked to be layout-agnostic. Only **Description and Quantity are required** now; the Unit column is optional (defaults to `Pcs`), as are the PO number/date labels. A new column-position reader parses each field by its header's column, so it handles arbitrary column order, **alphanumeric item codes** (`A100`, `SKU-9931`) as a separate leading column, **no unit-of-measure column** (Item / Description / Qty / Unit Price / Total), header-word **synonyms** (Item/Particulars/Product/…, Qty/Quantity/Nos/…), thousands separators + decimals in the quantity, currency in price columns, multi-line wrapped descriptions, and repeated headers + totals/terms footers on multi-page POs. It never confuses the quantity with a price/amount column (the old scanner could). The legacy scanner remains as a safety fallback. Hardened over two adversarial test rounds — **197/197** on a generated corpus of diverse layouts and **57/65** on layouts purpose-built to break it, plus real sample POs. The handful of remaining misses are cases where the quantity is genuinely unknowable from the text (a blank quantity cell, a quantity buried in the description, a `10 x 12` multiplier, or a locale-ambiguous `10.000`) — exactly what the Review stage and the new Parser Feedback loop are there to catch. A committed regression harness (`scripts/po_parser_harness`, 262 layouts) and a production read-only check on real uploaded PDFs (`scripts/po_parser_prod_regression.py`) now gate every future parser/import change; the full runbook is `PO_IMPORT_PARSER_GUIDE.md`.
- **Parser Feedback on PO imports** — when a PO PDF parses successfully, the import Review screen now shows a **Parser Feedback** question above the Create button — *"Was this Purchase Order imported correctly?"* (Yes / No). It's optional and never blocks creating the document. The answer, the original uploaded PDF, and the parser version are retained so parser mistakes stop being invisible (previously a user could silently fix bad values and move on). New `api/import-feedback` endpoints let developers list the imports users flagged as incorrect (paged/filter/sort/date-range), download the original PDFs (single or as a ZIP), and see parser-accuracy statistics — a reusable foundation for improving every document importer. Gated by new `importfeedback.*` permissions.

### 2026-07-17
- **Purchase (supplier-side) Debit Notes** — a new document type for debit notes issued to a **supplier** (a purchase-side adjustment), distinct from the existing sales Credit/Debit Notes which are customer-side. New **Purchases → Purchase Debit Notes** screen. The Manager.io import maps Manager's supplier debit notes here (they were previously skipped, since the sales note screens are client-based and had no home for a supplier document).
- **Purchase Debit Notes — full Create / Edit / Delete with GL + inventory** — user-authored notes now work like Manager.io's Debit Note: a note is the **exact mirror of a Purchase Bill**. When the company has GL posting enabled it posts **Dr Accounts Payable / Cr Inventory-or-line-account / Cr Input Tax** (reducing what you owe the supplier); when the company tracks inventory, a line carrying an **Item Type** records a stock **OUT** (goods returned reduce on-hand). Editing re-posts and re-reconciles stock by delta; deleting reverses both. Each line can carry an Item Type (inventory) and/or a GL Account, or be value-only. Per-row **Print** + **PDF** use the Debit Note template. **Migration-created notes stay lean** — they post no GL and move no stock (their figures are already in the CoA opening balances / GL true-up), so existing imported notes are untouched.
- **Withholding-Tax grid: inline Print + PDF** — the Withholding Tax Receipts list now has per-row **Print** and **PDF** buttons (previously only inside the View dialog), gated on a valid certificate template like the other document grids.
- **Item Types adapt to FBR-off companies** — item types are no longer auto-seeded (operators curate their own catalog; the Demo environment still seeds its starter set). For a company with FBR integration **off**, the Item Catalog hides the FBR-catalog guidance banner and the **HS Code** field on the new/edit-item form, so an FBR-off business gets a clean, HS-code-free item catalog.
- **Manager.io Import — Full General Ledger (perpetual) option** — the in-app **Manager.io Import** now has a **"Full General Ledger"** checkbox. With it (plus the Trial Balance and a `perpetual/` folder in the export zip) the import builds the complete ledger — a journal entry per document, inter-account transfers, and a migration true-up — so the **Chart of Accounts matches Manager with GL posting enabled** in a single step (previously only the console tool could do this; the UI did a snapshot with GL off). Pick an **existing** company and it rebuilds **only** the CoA + journal entries (documents untouched) — the recovery path for a company whose GL was turned on after a snapshot import and no longer matches.
- **Export bundles the perpetual reference data** — `scripts/manager_export.py` now writes a `perpetual/` folder (chart of accounts, bank/BS starting balances, and the tax codes / non-inventory items used on documents, resolved to their rates + accounts) into the upload zip, so the Full-GL import is self-contained. Skip with `--no-perpetual`.
- **Guard against double-counting on "Enable GL"** — enabling GL on a company imported as a **Manager.io snapshot** (opening balances + migrated documents, no GL cutover date) is now blocked with a clear message pointing to the Full-GL import, instead of silently posting the documents on top of the opening balances and doubling the P&L. (Set a GL lock-date first if you intentionally want history frozen.)
- **Credit/Debit-Note numbering retained on import** — when every imported note is division-scoped (as Manager.io exports them), the **company-level** Credit/Debit-Note starting number is now seeded from the overall imported max (so it continues the sequence instead of restarting at 1). Also fixed the company-numbering editor: the note starting number was locked whenever the company had *any* note (even division-tagged), unlike other document types which lock only on a company-level document — now consistent, so the company-level note number is editable when only division notes exist.
- **Bill without a customer PO** — a PO is no longer required to bill a delivery challan or sales order. Challans with no PO are billable in every FBR mode (a PO is optional metadata that prefills onto the bill from the Sales Order or the selected challan when present; incomplete FBR fields still block, since that isn't about the PO).
- **Sales Order picker on the bill forms**
  - **New Bill (No Challan)** now lists all **partially- and fully-delivered** sales orders (previously only "Open" ones — a fully-delivered order auto-closes, so it was hidden), each labelled with its delivery status; picking one loads the order's items.
  - **New Bill (with challan)** lists every order that still has **at least one unbilled challan** — a **No PO** challan counts (a customer PO isn't required to bill), and fully-delivered orders stay listed until all their challans are billed. Picking one sets the buyer and auto-ticks its unbilled challans.
- **Customer solution brought up to date** — merged the full `feat/sales-quote-order` feature set into the `customize-solution-for-other` deployment (company/division item types with per-line GL posting, Inventory V2, Chart of Accounts + General Ledger, Non-Inventory items, Withholding-Tax receipts, Bank & Cash accounts + reconciliation, multi-document print templates, division-scoped printing, the Reports module, and the Manager.io import). Deployed to the customer's hosted ERP (landing at `/`, app under `/admin`).
- **Al-Qahera Trading Co. migrated onto the customer instance** — imported the business as a new company via the in-app Manager.io Import (documents + trial-balance opening balances), reconciled against Manager.

### 2026-07-15
- **Division-scoped print templates across every document** — every document screen now has a **Division** dropdown next to the Company dropdown that drives which print templates Print / Export-PDF use, consistently across all document types (challans, sales quotes/orders, bills, tax invoices, credit/debit notes, purchase bills, goods receipts, receipts, payments, transfers, journal entries, withholding-tax receipts). Picking **All Divisions** lists only company-wide templates; picking a specific division lists only that division's. If the selected division has **no** template for that document type, the template picker is hidden and **Print + Export PDF are blocked** (disabled with an explanatory tooltip) in **both** card and table/grid views — so you can never print with no valid template. Logic is centralised in the shared `usePrintTemplates` hook + `PrintTemplateSelect`, so behaviour is identical everywhere. Fixed the goods-receipts table view, which previously left Print/PDF enabled when no template existed.

### 2026-07-14
- **See the posting account while billing** — on the sales bill forms (with **and** without challan) and the purchase bill form, picking an Item Type now shows an **Account (GL)** column naming exactly which income/expense account that line's amount will post to. It auto-fills from the item type's per-company mapping and is overridable per line; a line with no explicit mapping names the company's resolved default account (e.g. `→ Inventory – sales`). Only shown when the company has a Chart of Accounts; GL-off companies are unchanged.
- **Pixel-faithful "Delivery Note" print template** — the company-wide delivery-challan template now matches the Manager-style layout (document title top-left, logo top-right, three-column party band with the recipient / delivery-date + reference / seller block, and a clean borderless items table — rule above & below the header and a closing rule, no cell grid). Delivery date prints as `dd/mm/yyyy`.
- **New `fmtQty` print helper** — formats item quantities with a thousands separator but keeps decimals only when present (`1,000`, `500`, `2.5`), so whole units read cleanly while fractional quantities are never rounded. Available to every print template.
- **Company-specific item types with GL account mapping** — the Item Catalog screen now has a **company selector**; each item type can be mapped, per company, to a **division** (optional — leave blank for company-wide) and to its own **sales (income)** and **expense/COGS** accounts. The shared FBR catalog (HS code / UOM / sale type) stays global; the per-company data lives on an overlay.
- **Per-line GL posting** — invoices and purchase bills now split their net across the accounts resolved per line (line override → item-type mapping → company default → the classic Sales/Purchases fallback), so the P&L breaks down by account like Manager instead of lumping onto one control account. Reversal notes mirror the original lines' accounts. All behind the GL-posting flag; companies with GL off are unchanged.
- **Default inventory accounts guaranteed in the CoA** — enabling GL seeds (if missing) and pins each company's default **Inventory – sales** and **Cost of goods sold / Inventory** accounts, so item-type lines always resolve to a real, correctly-placed account.
- Unified item picker on **every** document line — pick an inventory **Item Type** or a **Non-Inventory item** (GL-account line) from one grouped dropdown.
- **Item Type (or Non-Inventory) required** on bills and purchase bills; optional on quotes / orders / delivery challans / goods receipts.
- Bill-from-Sales-Order now **auto-selects** the order's unbilled challans and pins the checked ones to the top of the (long) pending list.
- **Any** invoice/bill can be deleted (not just the latest) — reverts its GL + inventory impact and frees its challans.
- Invoices tab is **view-only for FBR-off companies** (edits routed to the Bills tab); read-only **View** available on both Bills and Invoices tabs.
- Company + Division cards now list **all** document-number sequences (challan, invoice, sales quote/order, purchase bill, goods receipt, credit/debit note) with starting + last-issued.
- **Sidebar restructure**: single **Dashboards** group (Overview / Inventory / Accounting); Accounting Reports moved under **Reports**; Configuration split into **Master Data** + **Settings**; import/migration tools moved to **Administration**.
- Fixed Bank & Cash Accounts column misalignment (missing Pending Out cell).

### 2026-07 (earlier)
- **Non-Inventory Items** — per-company GL-account line items (Freight, Discount, …) that post to a mapped income/expense account and move no stock.
- **Manager.io migration** — full-fidelity ETL importing a Manager.io business (documents + perpetual GL); reconciles the chart of accounts to the trial balance to the paisa.
- **Chart of Accounts + General Ledger** — CoA tree, posting engine (one balanced journal entry per document), trial balance, AR/AP aging, live account balances; per-company flag (default off).
- **Bank & Cash / Reconciliation** — bank & cash accounts with live balances, bank-statement import, auto-match, categorize, reconcile + period lock; inter-account transfers; receipts & payments (AR/AP subledger).
- **Sales Quotes & Sales Orders** — priced quote -> confirmed order -> delivery challans -> bill, with fulfilment tracking.
- **Divisions (sub-companies)** — per-division branding and document numbering, with division-scoped access control.
- **Inventory V2** — derived read model (Committed / To-Deliver / Delivered / Incoming) with an over-commit guard; per-company flow version.
- **Withholding Tax Receipts**, **Credit/Debit Notes** (FBR reversal flow), **multi-template per company/division** with a per-screen template picker, and a **Reports** module (FBR Sales report, Tax Sheet).
- **Granular RBAC** — permission catalog (`module.page.action`) replacing the old Admin/User roles; multi-tenant + division isolation.

---

## Roadmap

- [x] Multi-company delivery challans
- [x] JWT authentication & granular RBAC (permission catalog)
- [x] Multi-tenant + division isolation
- [x] Server-side pagination & filtering
- [x] Invoice generation from challans
- [x] GST calculations with amount in words
- [x] FBR Digital Invoicing (V1.12)
- [x] AI-powered PO import (Gemini)
- [x] Customizable print templates (HTML + GrapesJS), multi-doc + per-division
- [x] Excel export
- [x] Audit logging + FBR communication log
- [x] User management
- [x] Sales Quotes & Sales Orders
- [x] Chart of Accounts + General Ledger posting engine
- [x] Bank & Cash accounts + reconciliation
- [x] Manager.io migration (full-fidelity perpetual GL)
- [x] Non-Inventory (GL-account) line items
- [x] Dashboard analytics & charts (Overview / Inventory / Accounting)
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

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

### 2026-09-02 — Stock is worth something: value alongside quantity

- **Opening stock now carries its value.** The stock spreadsheet import reads the Balance block's value, rate and sales-tax columns, not just the quantity, and the preview shows all five figures so they can be read against the sheet before anything is written. A rate written as `0.18` is stored as 18%, and the sheet's own tax column is recomputed and compared as a check that the columns were mapped to the right place.
- **The stock dashboard shows the five figures you asked for** — quantity, excluding tax, sales-tax rate, sales tax and including tax — per item and as totals across whatever the search has left on screen. Opening balances show them too, and both can be entered by hand.
- **Purchases, sales and adjustments now move the value as well as the quantity.** A purchase adds stock at what was actually paid for it and re-averages the item. A sale takes value off at the average cost, never at the sale price — selling at a margin must not drain more value than the goods cost. An adjustment up can state what the goods are worth, or be left blank to use the current average; an adjustment down always uses the average. Selling the last unit leaves the value at exactly zero rather than a stray paisa.
- **Every movement shows its own money.** The movements list and the per-item history now carry unit cost, the value in or out, and a running quantity-and-value balance — so a stock ledger reads like a bank statement.
- **A purchase at a different sales-tax rate re-prices the item**, and the tax and inclusive figures follow it.
- Verified end to end against the client's stock sheet: `scripts/test_stock_valuation_flow.py` (55 checks) imports the sheet, confirms the dashboard reproduces its quantity and all three money columns, then runs a purchase, a sale and three adjustments and asserts both quantity and value after each.

### 2026-09-02 — Item Catalog: one list, and proper paging

- **Every item type is in one list now.** Items typed in by hand, the placeholder rows the HS code import creates, and items brought in by a spreadsheet import all appear together — the "Show HS-code placeholders" switch is gone. Splitting the catalog in two is what made an imported item look missing.
- **The list pages on the server**, with the same rows-per-page choice as the other grids (10 / 20 / 50 / 100 / 200, remembered per screen), so a catalog of several thousand items loads a page at a time instead of all at once. Searching happens on the server too, across the whole catalog rather than the page in front of you.
- **A row created by the HS import is badged** until someone adopts it, so a name like "HS Code 6109.1000" is recognisable for what it is.
- **The item form no longer promises a unit it cannot supply.** The published customs tariff has no unit column, so codes loaded from it have no unit to offer. Where nothing is published, the form now suggests the unit your other items under the same heading already use, and says so — and where there is nothing to suggest, it says that plainly instead of leaving an empty required field unexplained.

### 2026-09-02 — Item Catalog: the unit now fills in, and imported codes are reachable

- **Picking an HS code fills the unit again.** The Item Type form asked for units down a path that only ever tried the company's own FBR token — so a company with FBR off got nothing back, even when the system already knew the unit and the HS code screen was happy to show it. It now reads the local HS master first, then falls back to the installation's reference token.
- **This is also why the form could not be saved.** Update is disabled while the unit is blank, so a unit that never arrived meant a permanently greyed button. With the unit filling in, the button works — and when something genuinely does block saving, the reason is now printed next to the button instead of hidden in a tooltip.
- **Imported HS codes can be found in every item picker.** Pickers were handed the short curated list, so thousands of imported codes were unreachable on invoices, challans, bills, stock adjustments and everywhere else. Typing two characters now searches the full catalog. The curated list is still what you see before you type, so the dropdown does not fill with thousands of rows.
- **New "Fill missing units" action** on Import HS Codes. The published tariff carries no units at all, so codes loaded from it start blank; this asks FBR for them a batch at a time. Defaults to only the codes your items actually use — a few dozen rather than thousands.
- **Adopting an imported code now works.** Renaming a placeholder, giving it a unit and ticking "show in dropdowns" left it hidden anyway — the flag marking it as import-created is never cleared, and the list filtered on that flag alone. So an imported catalogue could never be brought into use at all. The filter now hides only placeholders nobody has adopted yet.

### 2026-09-01 — Item Catalog: stop nagging companies that do not use FBR

- **The Item Type form no longer reports FBR problems to a company with FBR switched off.** It was headed "FBR suggestions", offered a sale type, and complained that the FBR UOM list could not be loaded and that no FBR province was set — pushing the operator to configure an integration they had deliberately turned off.
- It now reads "Suggestions for this HS code", drops the sale type (the one genuinely FBR-only field), and says the unit simply is not restricted. **The recommended rate stays** — it pre-fills GST on bills whether or not you submit to FBR.
- A company that *does* use FBR still gets the missing-province warning, because for them it is a real omission.
- **The Item Catalog screen now shows how many HS codes are loaded**, and says so plainly when there are none — with a pointer to the token-free tariff option. Previously that option was only visible after opening the import dialog, so the people who most needed it had no way to discover it.

### 2026-09-01 — HS codes without an FBR token

- **The HS code master can now be filled with no FBR token at all.** FBR's catalog service refuses every request without OAuth credentials, so a business that has not been issued a token could not classify its items — which defeated the point of keeping classification independent of FBR.
- FBR publishes the **Pakistan Customs Tariff** as an open download, and that is now parsed and shipped with the product: **7,594 PCT codes with descriptions**, loaded by a new *Load from published tariff* button beside the existing FBR import. Takes about three seconds, needs no network, and running it twice adds nothing.
- The FBR import stays the better source when a token exists, because it also brings units. **The published tariff has no unit column**, so codes loaded this way carry no unit — you set it on the Item Type as before, and it fills in automatically if a token is added later.
- Verified against the client's own stock sheet: all 38 of its HS codes are present.
- Worth knowing: Pakistan splits some international subheadings into its own national lines, so `8536.5000` is genuinely absent while `8536.5010` exists. Codes are validated against the master, so an invented one is rejected.

### 2026-09-01 — Guide: entering the same data by hand

- **The in-app Accounting Guide now covers doing it manually**, not just importing — three new sections under *Starting from Excel*: typing one customer's ledger in, typing one item's stock in, and which correction to use when.
- Written against the real screens: which row of the spreadsheet becomes which document, why the closing balance is never typed in, why a negative opening balance is a receipt rather than a negative invoice, and why the same invoice number on several rows is one invoice.
- The corrections section separates the three things people call an adjustment — a stock adjustment for what physically happened, a re-entered opening balance for a wrong starting figure, and a journal entry for moving an account balance — and warns against using a journal entry to fix a customer's balance, which leaves their own ledger showing the old figure.
- Same material added to `SPREADSHEET_IMPORT_GUIDE.md`.

### 2026-09-01 — Fix: the browser kept showing the previous version after a deploy

- **A deploy is now picked up on the next page load.** `index.html` was served with no cache instruction, so browsers were free to reuse a stored copy without checking. Because each deploy replaces the fingerprinted bundle it points at, that stored copy asked for a file that no longer existed — the app then failed to start and the site looked unchanged, or blank.
- `index.html` is now sent as no-cache and must be revalidated; the fingerprinted assets under `/assets` are cached for a year, which is safe because their names change whenever their contents do.
- Anyone still holding the old page needs one hard refresh (Ctrl+Shift+R). After that it corrects itself.

### 2026-09-01 — Spreadsheet import: built-in layouts

- **Two layouts now ship with the product** — a standard stock sheet and a standard customer ledger — so a first import starts from a described layout instead of a blank mapping form. They are installation-wide, cannot be deleted, and a layout you save for your own company is used ahead of them.
- **A layout is recognised by its headings, not its contents.** Next period's workbook is matched automatically even though every product, customer, amount and date in it has changed — which is the point: a monthly re-upload should never be re-mapped by hand. Previously the file's own product names went into the fingerprint, so the same template scored too low against itself to even be offered.
- **A layout no longer carries dates.** The period a ledger covers is asked for on each import, so one layout stays correct year after year.
- When a workbook genuinely is not recognised, the built-in is offered as a starting point and clearly labelled as one, rather than presented as a confident match.

### 2026-09-01 — Spreadsheet import: the screens

- **Accounting → Spreadsheet Import** is now a page, not just an API. Pick the company and what you are importing, upload the workbook, say which column is which, review, import.
- **The layout is described once.** When a workbook shape is not recognised, the page shows the top-left corner of each sheet with the column numbers along the top and asks which column holds what. Save it under a name and the next file in that shape is recognised automatically.
- **The review step shows the numbers before anything is written** — for stock, what happens to every item and whether it is matched or created; for the ledger, every customer's calculated closing balance beside the one the workbook states, with any difference called out.
- An **Import history** tab lists what has been loaded into the company and who loaded it, and is where a completed import is set aside if it has to be run again.

### 2026-09-01 — Spreadsheet import: customer outstanding ledger

- **A customer outstanding ledger workbook can now be imported** — an index sheet naming every customer plus one sheet each. Customers, their invoices and their receipts all land in one go, and the Customer Ledger screen then shows the same running balance the workbook does.
- **Every customer is reconciled against the index sheet before anything is written.** Preview shows, per customer, the closing balance worked out from the rows against the one the index states, and the import is refused if they disagree by more than rounding. A reporting import fails as a plausible wrong number rather than a crash, so this check is the point of the whole preview.
- **Amounts are shown at the precision they will be stored** (two decimal places), so the balance previewed is the balance the system ends up holding — no surprise paisa appearing after the import.
- Handles what these workbooks actually contain: a reference that wanders between two columns, one invoice written across several rows, a row with no date (it inherits the date above it), a customer whose opening balance is negative because they paid ahead (recorded as money received, not a negative invoice), and customer names that differ slightly between the index and their own sheet (surfaced for confirmation, never silently guessed).
- **Receipts are recorded on account.** The workbook never says which invoice a payment settled, so the importer does not invent that link — the balance is right either way, and an on-account receipt can be applied to an invoice later.
- The general ledger is frozen at the imported period's end and the receivable total is loaded onto Accounts receivable, which is what keeps the GL enable path open afterwards.
- Imported invoices carry no tax split, because the workbook records totals only — the tax reports therefore show no output tax for the imported period, and the import screen says so before you commit.
- An import run no longer blocks deleting its company.

### 2026-08-31 — Spreadsheet import: opening stock

- **An opening stock sheet can now be imported.** Upload the workbook, review what it would do row by row, then import — item types, opening quantities and the stock's total value all land in one go.
- **Existing items are reused, never duplicated.** An item already in the catalog has its opening quantity updated; a placeholder created by the HS code import is reused and renamed; an item that was never classified has its HS code filled in. Only a genuinely new item creates a catalog row, and where the same name already exists under a different HS code the importer asks rather than guessing.
- **One item held across several customs lots becomes one item** with the quantities added together, and the lot references are kept on the opening balance so the figure can be traced back to the sheet.
- **The stock's total value posts as the Inventory opening balance**, with the contra to Retained earnings, so the opening balance sheet balances without a manual journal.
- Importing also switches the company to tracking every item type as inventory, which turns on the block against selling more than is on hand — the import screen says so before you commit.
- Re-importing is safe: the same file is refused, and so is a re-saved copy whose rows are all already present. A sheet that has genuinely gained rows still imports, adding only the new ones.
- New suite `scripts/test_spreadsheet_import.py` (54 checks) covers layouts, file validation, the match ladder, commit and re-import protection.

### 2026-08-31 — Spreadsheet import: recognised layouts, file checks and re-import protection

- **New Spreadsheet Import module** (Accounting → Spreadsheet Import) for onboarding a business from its own Excel books — an opening stock sheet and a customer outstanding ledger — instead of typing them in.
- **A layout is described once and remembered.** The first upload of an unfamiliar workbook asks which column is which; that mapping is saved, fingerprinted and matched automatically next time, so a monthly re-upload needs no re-mapping. Layouts can be private to a company or shared installation-wide, and every mapping change is versioned and can be rolled back.
- **Uploads are checked before anything is read** — extension, magic bytes, that the container matches the extension, and that the workbook actually opens and holds data. A renamed PDF, a `.xls` renamed `.xlsx`, and a password-protected or empty file each get their own plain-English message instead of an internal error.
- **The same data cannot be imported twice.** A file already imported into that company is refused outright, naming when and by whom. A re-saved or re-exported copy — different bytes, identical content — is refused too. A workbook that has genuinely grown still imports, adding only its new rows. Deliberately re-importing over a completed run needs its own permission and a recorded reason.
- New guide: `SPREADSHEET_IMPORT_GUIDE.md` — the step-by-step onboarding runbook covering what to create, on which screen, and how to prove the imported numbers agree with the source.

### 2026-08-31 — Fix: billing an item whose name already exists in another case

- **Creating a bill no longer fails when a line's item name already exists in the catalog under different capitalisation.** Typing "Steel Pipe" where the catalog holds "STEEL PIPE" — or a name that was stored with a trailing space — used to make the save fail outright. The item catalog is deliberately case-insensitive (one entry per item, keeping the spelling it was first saved with), but the bill's own "is this name new?" check was case-sensitive, so it tried to add a second copy of the same item and the save was rejected.
- **The message it produced pointed at the wrong thing.** The failure surfaced as "Could not allocate a unique invoice number", after several silent retries, sending anyone investigating towards bill numbering instead of the item name. Both bill paths were affected — with and without a delivery challan. Delivery challans themselves already handled this correctly.
- Registering item names now goes through a single shared component used by the bill and challan screens, so they cannot drift apart on this again.

### 2026-08-31 — Accounting Reports: tax, control checks and management summaries

- **Tax Summary, Output Tax, Input Tax, Tax Transaction Detail, Tax by Customer and Tax by Supplier.** All of them read the Output Tax and Input Tax accounts in the ledger rather than adding up GST on invoices — so tax paid on an expense, and any adjustment an accountant journalled, are included, and the tax reports always agree with the Balance Sheet.
- **Sales tax and withholding tax are reported separately and never netted.** They are different taxes — sales tax on the goods, withholding income tax deducted at source — and a single combined figure would be neither the position you file nor the one you reclaim.
- **Journal Register** — every journal entry with its source, line count, amount and balance check, filterable to manual journals only.
- **Posting Exceptions** replaces the "unposted transactions" report this system cannot have (documents post immediately; there is no draft state). It checks the three things that actually make the accounts wrong — postings that fell into Suspense, documents with no ledger entry, and unbalanced entries — and each row says what to do. When nothing is wrong it says so explicitly.
- **Revenue Summary and Expense Summary** — the Profit & Loss figures ordered by size instead of laid out as a statement, tying exactly to it.
- **Monthly Sales, Monthly Purchases, Monthly Expenses** and a **Cash Flow Summary** that reads like a bank statement by month: each month opens where the last closed, and the closing figure matches Cash & Bank Summary. Labelled as a cash-movement summary, not a statutory statement of cash flows, since the accounts carry no operating/investing/financing classification.
- **Gross Profit, Monthly Profit and Customer Profitability** are listed as Blocked with the reason on the card: a sale does not yet relieve inventory, so there is no cost of sales to compare against.
- Every report in the module now has Excel, Print and PDF, standard filters, and drill-down where it makes sense.

### 2026-08-31 — Accounting Reports: sales and purchase registers

- **Sales Invoice Register and Purchase Bill Register** — every document with subtotal, tax, withholding, grand total, paid, outstanding and payment status, filterable by customer/supplier, tax and status, with a breakdown by status.
- **Twelve groupings** off the same documents: sales and purchases by customer/supplier, item, item type, account, date, month and tax. **by Account reads the general ledger**, so it agrees with the Profit & Loss instead of re-deriving which account a line should have hit.
- **Sales / Purchase Payment Status** — paid, part-paid, unpaid and overdue at a glance, tied exactly to the register.
- **Credit & Debit Notes** report for sales returns and adjustments. Notes are kept out of the invoice register, so its total keeps meaning "what we sold".
- **The register explains itself against the aging report.** A register nets overpaid documents; aging excludes them. Where that happens the register shows an *Overpaid* total so outstanding plus overpaid visibly equals the aging figure.
- Status and payment figures come from `PaymentStatusCalculator` and the documents' own stored totals, so a register row can never disagree with the invoice it reports on.
- Still no Discount column anywhere: the model stores no discount on a document or its lines, and an invented one would be worse than none.

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

### 2026-08-31 — The screens for paying a payee

- **The Receipt and Payment forms now ask the two questions in plain language.** Who paid you / who are you paying — a client, a supplier, or someone not on your books, named free-text — and what the money is for: settle their unpaid invoices or bills, an expense or other income, or an advance on account. Until now the Accounting Guide described controls that had no screen behind them.
- **Recording an expense is a real form.** Pick the account, type the amount as it appears on the bill and (optionally) the tax rate; the line shows how much tax is recoverable and how much lands on the account before you save.
- **The Suppliers screen shows Accounts payable and a status on each supplier**, and the figure opens that supplier's ledger — bills, payments, advances and refunds with a running amount owed.
- **A customer in credit is labelled as such.** Their statement says "Held for this customer (in credit)" and shows a positive figure instead of a bare minus sign under "Accounts Receivable".
- **Recording a receipt straight from an invoice pre-fills the amount received** with that invoice's balance, so the shortcut no longer opens in a state it refuses to save.
- **Account pickers show and search the group an account belongs to**, so two similarly named accounts are told apart at a glance.
- Buttons and list rows on the Receipts, Payments, Client Ledger and Accounting Guide screens are now full-size tap targets on a phone.

### 2026-08-31 — An advance reads the same on every screen

- **The customer portal shows an advance again.** An advance recorded as its own "advance / on account" line was being netted away to nothing on the portal, so a customer who had paid ahead saw no credit and a balance overstated by the whole amount they had paid. Advances entered the other way — a receipt saved without picking an invoice — were always shown correctly; both now read the same.
- **A cash sale recorded against a customer no longer lands on their ledger.** Money received against a customer's name but booked straight to an income account is not payment of anything they owe, and the Customers screen never counted it as such. The customer ledger did, so the same customer could show two different balances on two screens and appear to hold an advance they had never paid. The ledger, its summary row, the customer statement and the A/R column now agree.

### 2026-08-31 — Record any payment or receipt against a payee

- **Recording an ordinary expense no longer needs a purchase bill.** A payment line can now point straight at an income or expense account — electricity, rent, freight, professional fees — so paying a bill you were never invoiced for is a two-field job instead of an invented document or a hand-written journal entry.
- **You can pay, or be paid by, someone who is not on your books.** Choose "Other" as the payee and type their name — a landlord, a courier, an employee reimbursement — and it is recorded and printed on the voucher without adding them to your Customers or Suppliers.
- **An expense line can carry recoverable sales tax.** Enter the gross amount and the rate; the account takes the net and Input Tax takes the rest (Output Tax on money coming in), the same tax-inclusive way invoice and bill totals already work.
- **An advance now shows on the party's own account.** Money received before there is an invoice, or paid before there is a bill, sits against that customer's or supplier's balance instead of somewhere separate — so it nets against what they owe, appears on their ledger, in the A/R and A/P columns and on the aged reports, and can be applied to an invoice raised later. The same rule covers refunds in both directions.
- **A supplier paid for a one-off expense now shows up in their ledger.** Every journal line carries the party named on the document, not only the ones settling an invoice or bill, so that spend is visible against the supplier who received it.
- **Suppliers gain the payables view customers already had** — Accounts payable and a status on each supplier, and a supplier ledger reached from that figure showing bills, payments, advances and refunds with a running amount owed.
- **A payment can only settle documents belonging to the party named on it**, so a receipt can no longer clear another customer's invoice by accident and tag it to the wrong ledger. Records that already carry an older mismatch stay editable.
- **The chart of accounts ships with the everyday categories** — electricity, internet, telephone, office supplies, travel, repairs, marketing, professional fees — plus prepaid expenses, loans payable, owner's capital and drawings, service revenue and other income. Every account picker now shows which group an account belongs to, and searches it.

### 2026-08-31 — Editing a receipt keeps what it was applied to

- **Editing a receipt no longer risks dropping its allocations.** The form now sends the amount you actually typed, and while it is still loading which invoices a receipt was applied to, Save is held shut and reads "Loading…" — so a quick save can't write the receipt back with its allocations, or its advance, missing.
- **If those allocations fail to load, Save stays shut** and says so, rather than letting you overwrite the receipt from a form that never finished filling itself in.
- **Switching the customer mid-entry clears the previous customer's ticked invoices.** Before, they stayed behind out of sight and were still counted into the Allocated and Advance figures, which could show an advance with nothing on screen to explain it.
- **Changing company clears the payment methods** carried over from the company you were just looking at.
- **The customer portal's advance figure only counts documents that customer can see**, so it can no longer hint at invoices hidden from their portal.

### 2026-08-31 — Client Ledger report

- **Client Ledger** is a new report under Reports: every customer's statement for one period, on one screen. Each customer gets their own section — opening balance, the full trail with a running balance, and the balance carried out — laid out exactly like the ledger workbook you already keep.
- **Same period controls as the other reports** — a month, a whole year, or a custom date range. Everything dated before the start of the period is rolled up into that customer's opening balance, so narrowing the window moves the split without changing what anyone owes.
- **Filter to one customer** when you only need their statement, or leave it on "All customers" for the whole company. Customers with no activity and no carried-in balance are left out rather than padding the page.
- **Export to Excel** gives you a Summary sheet followed by one sheet per customer, in the workbook's own layout (company name, "Ledger", customer, the totals band, then the numbered transaction rows).
- Figures follow the same familiar ledger layout as the Customer Ledger screen — invoices and debit notes in the Credit column, receipts, credit notes and write-offs in the Debit column, a positive balance meaning the customer owes you — because both read the same underlying ledger.

### 2026-08-31 — Customer Ledger screen

- **Customer Ledger** is a new tab under Accounting, beside Receipts and Payments. It lists every customer once with their Opening, Invoiced, Received, Outstanding, Advance and Closing figures, biggest debtor first.
- **Click a customer to open their ledger in place.** Their full trail — date, reference, type, debit, credit and running balance — drops open underneath the row; clicking again closes it. You never leave the list, and you can have several customers open side by side to compare them.
- **Filters say what they narrow.** Period changes every figure on the page; Customers (owes / in advance, and a name search) narrows which customers are listed; Entries (transaction type, payment method) narrows what you see inside a customer you have opened. They are grouped and labelled that way on screen, so a payment method can't be mistaken for "customers who paid by cheque".
- **A customer kept under two records reads as one customer throughout.** Where the same business appears twice on your books, the row and the ledger you open beneath it both cover both records, so the two can never show different closing balances.
- Figures follow the same familiar ledger layout as the statement: invoices and debit notes in the Credit column, receipts, credit notes and write-offs in the Debit column, with a positive balance meaning the customer owes you and a negative one meaning they are in credit.
- Each customer's entries are fetched only when you open that customer, so the list stays quick however many customers you have.

### 2026-08-30 — Customer receipts without an invoice, and customer advances

- **Record a receipt without picking an invoice.** Money received from a customer can now be entered on its own — date, customer, amount, method, reference and notes — with no invoice selected. Previously every receipt had to be applied to at least one invoice at the moment the cash arrived, which is not how payments actually turn up.
- **Money paid in excess becomes a customer advance.** When a customer pays more than they owe, the extra is no longer rejected: it stays on their account as an advance. A single receipt can be part-applied to invoices and part-advance.
- **Apply an advance to invoices later.** An existing advance can be settled against one or more of that customer's invoices whenever you choose, without re-entering the receipt.
- **Customer ledger.** Each customer now has a full chronological trail — invoices, receipts, credit and debit notes, write-offs, opening balance and a running balance — instead of a list of invoices only. Amounts follow the familiar ledger layout: invoices in the Credit column, money received in the Debit column.
- **Fixes a statement that could disagree with the balance owed.** Where a receipt settled an invoice partly in cash and partly by writing off the remainder, the old statement counted only the cash, so its closing figure drifted from the customer's real balance. Credit and debit notes were missing from it altogether, and it silently stopped after 200 rows.
- **Where unapplied money sits.** Money received but not applied to an invoice is held against the customer's own account, so it nets against what they owe while still showing as a credit on their ledger, in the A/R column and on the aged reports. (This first used a separate "Advance from Customers" account; that was replaced on 2026-08-31 — see that entry. A chart that already carries the account keeps it, unused.)
- **New companies start with access restricted to assigned users.** The option is on by default when creating a company, and the wording beside it now describes what it actually does.

### 2026-08-30 — Refreshing a page keeps you on that page

- **F5 no longer throws you back to the Dashboard.** Reloading Invoices, Clients, Reports — any screen — now reloads that screen. Opening a sidebar link in a new tab (ctrl-click or middle-click) lands on the right page too, instead of the Dashboard.
- The cause: on a fresh page load the app decided what you were allowed to see a moment before it knew who you were, concluded you had no permissions, and redirected. It now waits for the sign-in check to finish before making that decision.

### 2026-08-30 — Import your customer list from a spreadsheet

- **Import Clients** on the Clients screen adds hundreds of customers in one go. Download the sample CSV, paste your list under its headings, upload it, and the screen shows what it will do — row by row — before anything is saved.
- **Nothing is written until you confirm.** Each row is marked *will be added*, *already exists* or *cannot import*, with the reason next to it (blank name, the same customer twice in the file, a customer already on your books).
- **Re-importing is safe.** Customers you already have are skipped, never overwritten, so uploading next month's updated list only adds the new names.
- The sample file opens straight in Excel (UTF-8 with a byte-order mark, Windows line endings), so customer names with Urdu or accented characters survive the round trip.
- Accepts CSV and Excel (.xlsx), copes with commas inside quoted addresses, semicolon-separated exports and files saved by Excel with a byte-order mark, and reads the usual column names (Customer / Party / Client all map to Name).
- Bad rows never sink the whole file: the good ones import and the rest are listed with their reasons.

### 2026-08-30 — HS codes are your own master data, and new companies start with FBR off

- **New companies now start with FBR integration switched OFF.** Nobody has to paste FBR credentials just to set up their catalog or raise documents; you turn FBR on when you are ready to file digital invoices. Existing companies are untouched — Hakimi and Roshan keep the setting they already have.
- **HS / PCT codes now live in this system.** A new HS code master holds the tariff — code, description and the applicable UOM — once for the whole installation instead of being fetched from FBR every time someone opens the Item Type form. Searching it, classifying items against it and picking a UOM all work with FBR integration off.
- **Import HS Codes.** A new button on the Item Catalog screen pulls the tariff straight from FBR (7,803 codes today) with a progress state and a summary: total received, new codes added, already existing, descriptions updated, and skipped. Running it again is safe by design — codes you already have keep their row, only genuinely new ones are added — so you can re-run it whenever FBR updates the tariff. Errors are reported without throwing the whole import away.
- **Reading the tariff needs one token, set once.** The import authorises itself with an installation-wide FBR reference token you paste in the import dialog. It is used only to read HS codes and UOMs, it is stored encrypted, it is never shown back to you in full, and it does **not** switch FBR invoice submission on for anybody.
- **Item Types can be created from HS codes automatically.** The import can create an item for each new code, named "HS Code 6109.1000" until you rename it — renaming keeps the code attached. Those placeholder items are hidden from the bill and challan pickers and from the Item Catalog list by default (there are thousands); a "Show HS-code placeholders" switch on the Item Catalog finds them when you want to curate one.
- **The HS Code field now appears for every company**, not just FBR-enabled ones, and searches by code or description with the UOM shown alongside. Sale Type stays where it was — it is genuinely FBR submission metadata.
- **Stricter, clearer validation.** Once the tariff has been imported, a code that isn't in it is refused at save time with an explanation, instead of being accepted and later rejected by FBR with error 0007.

### 2026-08-29 — Printed documents: signature at the foot of every page, and no more filler rows

- **The signature block now prints at the bottom of every page.** Before, it only appeared on the last page of a document, part-way up — so a two-page invoice had no signature line at all on page 1, and a long one had none on pages 1 and 2. Every document type is covered: bill, tax invoice, delivery challan, sales quote, sales order, credit and debit note, purchase bill, goods receipt, and the receipt, payment, transfer, journal and withholding-tax vouchers.
- **The empty rows after the last line item are gone.** Item tables were padded out to a fixed row count (18, 20, 22 rows depending on the template), so a three-line invoice printed with seventeen blank ruled rows under it. Tables now print exactly the lines the document has, and the signature is still held at the foot of the page.
- **Line items can never run underneath the signature.** Each page reserves exactly the room the signature block needs — measured from the block itself, so it is right whether or not your company has a stamp image on it.
- **Column headings now repeat on continuation pages.** Some templates dropped the table header on page 2; a multi-page document keeps its headings throughout.
- Totals, amount in words and the FBR digital-invoice panel still print once, after the items, exactly as before — only the signature repeats. Existing template designs, fonts, colours, logos and stamps are unchanged, and the fix applies to templates you have already saved as well as to every starter design, so anything created from now on behaves the same way.
- Also applies to **Export PDF**, not just Print.

### 2026-08-29 — Trimmed the sidebar to the tabs this deployment uses

- **Eight sidebar tabs are hidden**: Sales Quotes, Sales Orders and Import Challans (Sales); FBR Settings, FBR Sandbox and FBR Monitor (Settings); Data Migration and Manager.io Import (Administration). The section counts next to each heading follow suit.
- **Nothing was removed.** The pages, their data and their permissions are all still there — the features keep working, are still reachable by address, and are still assignable in Roles & Permissions. Only the menu entries are hidden.
- Which tabs show is now one list in `myapp-frontend/src/config/navVisibility.js`. To bring a tab back, flip its `visible` to `true` — no other change needed.

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

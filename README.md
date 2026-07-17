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

### 2026-07-17
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

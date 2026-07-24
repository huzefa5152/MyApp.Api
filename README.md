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

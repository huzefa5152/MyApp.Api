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

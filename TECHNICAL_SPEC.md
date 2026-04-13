# Technical Specification Document

**System:** MyApp ERP - Delivery Challan & Invoicing System  
**Version:** 2.0  
**Last Updated:** 2026-04-14  
**Stack:** .NET 9 + React 19 + SQL Server

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Technology Stack](#2-technology-stack)
3. [Database Schema](#3-database-schema)
4. [API Specification](#4-api-specification)
5. [Authentication & Authorization](#5-authentication--authorization)
6. [Business Workflows](#6-business-workflows)
7. [FBR Digital Invoicing Integration](#7-fbr-digital-invoicing-integration)
8. [PO Import Pipeline](#8-po-import-pipeline)
9. [Print Template Engine](#9-print-template-engine)
10. [Audit Logging](#10-audit-logging)
11. [Error Handling](#11-error-handling)
12. [Configuration Reference](#12-configuration-reference)
13. [Deployment Architecture](#13-deployment-architecture)

---

## 1. System Architecture

### Overview

N-tier architecture with clean separation of concerns:

```
React SPA (Vite)
    |
    v
ASP.NET Core 9 Web API
    |
    +--> Controllers (request/response)
    |        |
    |        v
    +--> Services (business logic)
    |        |
    |        v
    +--> Repositories (data access)
    |        |
    |        v
    +--> Entity Framework Core 9
    |        |
    |        v
    +--> SQL Server
    |
    +--> External APIs
         |- FBR DI Gateway (gw.fbr.gov.pk)
         |- Google Gemini 2.0 Flash
```

### Project Structure

```
MyApp.Api/
+-- Controllers/           # 15 API controllers
+-- Services/
|   +-- Interfaces/        # Service contracts
|   +-- Implementations/   # Business logic (180KB+)
+-- Repositories/
|   +-- Interfaces/        # Repository contracts
|   +-- Implementations/   # Data access
+-- Models/                # 12 entity models
+-- DTOs/                  # 25+ data transfer objects
+-- Data/
|   +-- AppDbContext.cs    # EF Core configuration
+-- Migrations/            # 45+ database migrations
+-- Middleware/             # Global exception handler
+-- Helpers/               # Utility classes
+-- myapp-frontend/        # React SPA
|   +-- src/
|       +-- pages/         # 11 page components
|       +-- Components/    # Reusable UI components
|       +-- api/           # Axios API clients
|       +-- utils/         # Template engines, helpers
|       +-- contexts/      # React context providers
+-- wwwroot/               # Built frontend (served by Kestrel)
+-- .github/workflows/     # CI/CD pipeline
```

### Request Pipeline

```
HTTP Request
  -> Kestrel Server
  -> Static Files Middleware (wwwroot)
  -> CORS Middleware
  -> Authentication Middleware (JWT)
  -> Authorization Middleware
  -> Global Exception Middleware (AuditLog)
  -> Controller Action
  -> Service Layer
  -> Repository Layer
  -> Database
```

---

## 2. Technology Stack

### Backend

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | .NET | 9.0 |
| Web Framework | ASP.NET Core | 9.0 |
| ORM | Entity Framework Core | 9.0.8 |
| Database | SQL Server | 2019+ |
| Auth | JWT Bearer | 9.0.x |
| Password Hashing | BCrypt.Net | 4.1.0 |
| PDF Parsing | UglyToad.PdfPig | 1.7.0 |
| Excel Export | ClosedXML | 0.104.2 |
| API Docs | Swashbuckle (Swagger) | 9.0.4 |

### Frontend

| Component | Technology | Version |
|-----------|-----------|---------|
| Framework | React | 19.x |
| Build Tool | Vite | 7.x |
| Routing | React Router | 7.x |
| UI Framework | Bootstrap | 5.x |
| HTTP Client | Axios | - |
| Template Engine | Handlebars | - |
| Visual Editor | GrapesJS | - |
| PDF Generation | jsPDF + html2canvas | - |

### External Services

| Service | Purpose | Endpoint |
|---------|---------|----------|
| FBR DI Gateway | Tax invoice submission | `gw.fbr.gov.pk/pdi/v1/` |
| FBR Sandbox | Testing | `gw-sandbox.fbr.gov.pk/pdi/v1/` |
| Google Gemini | AI PO parsing | `generativelanguage.googleapis.com/v1beta/` |

---

## 3. Database Schema

### Entity Relationship Diagram

```
Company (1) ---> (*) Client
Company (1) ---> (*) DeliveryChallan
Company (1) ---> (*) Invoice
Company (1) ---> (*) PrintTemplate

Client (1) ---> (*) DeliveryChallan

DeliveryChallan (1) ---> (*) DeliveryItem
DeliveryChallan (*) ---> (0..1) Invoice

Invoice (1) ---> (*) InvoiceItem
InvoiceItem (*) ---> (0..1) DeliveryItem

ItemType (1) ---> (*) DeliveryItem
```

### Tables

#### Users

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| Id | int | PK, Identity | Auto-increment ID |
| Username | nvarchar | Unique, Required | Login username |
| PasswordHash | nvarchar | Required | BCrypt hash (cost 11) |
| FullName | nvarchar | Required | Display name |
| Role | nvarchar | Default: "User" | User/Admin |
| AvatarPath | nvarchar | Nullable | Path to avatar image |
| CreatedAt | datetime2 | Default: GETUTCDATE() | Registration timestamp |

#### Companies

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| Id | int | PK, Identity | |
| Name | nvarchar | Required | Legal company name |
| BrandName | nvarchar | Nullable | Trade/brand name |
| LogoPath | nvarchar | Nullable | Path to uploaded logo |
| FullAddress | nvarchar | Nullable | Complete address |
| Phone | nvarchar | Nullable | Contact number |
| NTN | nvarchar | Nullable | National Tax Number |
| STRN | nvarchar | Nullable | Sales Tax Registration Number |
| StartingChallanNumber | int | Required | First challan number |
| CurrentChallanNumber | int | Required | Next challan to assign |
| StartingInvoiceNumber | int | Required | First invoice number |
| CurrentInvoiceNumber | int | Required | Next invoice to assign |
| InvoiceNumberPrefix | nvarchar | Nullable | Prefix for FBR (e.g., "INV-") |
| FbrProvinceCode | int | Nullable | FBR province ID |
| FbrBusinessActivity | nvarchar | Nullable | Business type |
| FbrSector | nvarchar | Nullable | Industry sector |
| FbrToken | nvarchar | Nullable | FBR API bearer token |
| FbrEnvironment | nvarchar | Nullable | "sandbox" or "production" |

#### Clients

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| Id | int | PK, Identity | |
| Name | nvarchar | Required | Client name |
| Address | nvarchar | Nullable | Client address |
| Phone | nvarchar | Nullable | Contact number |
| Email | nvarchar | Nullable | Email address |
| NTN | nvarchar | Nullable | National Tax Number |
| STRN | nvarchar | Nullable | Sales Tax Registration Number |
| Site | nvarchar | Nullable | Default delivery site |
| CompanyId | int | FK (Restrict) | Parent company |
| RegistrationType | nvarchar | Nullable | Registered/Unregistered/CNIC |
| CNIC | nvarchar | Nullable | 13-digit CNIC |
| FbrProvinceCode | int | Nullable | FBR province ID |
| CreatedAt | datetime2 | Default: GETUTCDATE() | |

#### DeliveryChallans

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| Id | int | PK, Identity | |
| CompanyId | int | FK (Cascade) | Parent company |
| ChallanNumber | int | Unique per company | Sequential number |
| ClientId | int | FK (Restrict) | Target client |
| PoNumber | nvarchar | Nullable | Purchase order reference |
| PoDate | datetime2 | Nullable | PO date |
| DeliveryDate | datetime2 | Nullable | Delivery date |
| Site | nvarchar | Nullable | Delivery location |
| Status | nvarchar | Default: "Pending" | Workflow state |
| InvoiceId | int | FK (Restrict), Nullable | Linked invoice |

**Composite Index:** (CompanyId, ChallanNumber) - Unique

**Status Values:** `Pending`, `No PO`, `Setup Required`, `Invoiced`, `Cancelled`

#### DeliveryItems

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| Id | int | PK, Identity | |
| DeliveryChallanId | int | FK (Cascade) | Parent challan |
| ItemTypeId | int | FK (Restrict), Nullable | Item category |
| Description | nvarchar | Required | Item description |
| Quantity | int | Required | Delivery quantity |
| Unit | nvarchar | Required | Unit of measure |

#### Invoices

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| Id | int | PK, Identity | |
| InvoiceNumber | int | Unique per company | Sequential number |
| Date | datetime2 | Required | Invoice date |
| CompanyId | int | FK (Restrict) | Issuing company |
| ClientId | int | FK (Restrict) | Billed client |
| Subtotal | decimal(18,2) | Required | Sum of line totals |
| GSTRate | decimal(5,2) | Required | GST percentage (0-100) |
| GSTAmount | decimal(18,2) | Required | = Subtotal * GSTRate / 100 |
| GrandTotal | decimal(18,2) | Required | = Subtotal + GSTAmount |
| AmountInWords | nvarchar | Required | English words representation |
| PaymentTerms | nvarchar | Nullable | Payment conditions |
| CreatedAt | datetime2 | Default: GETUTCDATE() | |
| DocumentType | int | Nullable | FBR document type ID |
| PaymentMode | nvarchar | Nullable | FBR payment method |
| FbrInvoiceNumber | nvarchar | Nullable | Formatted: prefix + number |
| FbrIRN | nvarchar | Nullable | FBR Invoice Reference Number |
| FbrStatus | nvarchar | Nullable | Draft/Submitted/Accepted/Rejected |
| FbrSubmittedAt | datetime2 | Nullable | FBR submission timestamp |
| FbrErrorMessage | nvarchar | Nullable | FBR error details |

**Composite Index:** (CompanyId, InvoiceNumber) - Unique

#### InvoiceItems

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| Id | int | PK, Identity | |
| InvoiceId | int | FK (Cascade) | Parent invoice |
| DeliveryItemId | int | FK (SetNull), Nullable | Source delivery item |
| ItemTypeName | nvarchar | Required | Item category name |
| Description | nvarchar | Required | Item description |
| Quantity | int | Required | Quantity |
| UOM | nvarchar | Required | Unit of measure |
| UnitPrice | decimal(18,2) | Required | Price per unit |
| LineTotal | decimal(18,2) | Required | = Quantity * UnitPrice |
| HSCode | nvarchar | Nullable | FBR HS/PCT code |
| FbrUOMId | int | Nullable | FBR UOM reference ID |
| SaleType | nvarchar | Nullable | FBR sale type |
| RateId | int | Nullable | FBR rate ID |

#### PrintTemplates

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| Id | int | PK, Identity | |
| CompanyId | int | FK (Cascade) | Owner company |
| TemplateType | nvarchar | Required | Challan/Bill/TaxInvoice |
| HtmlContent | nvarchar(max) | Required | HTML with merge fields |
| TemplateJson | nvarchar(max) | Nullable | GrapesJS editor state |
| EditorMode | nvarchar | Nullable | html/grapesjs |
| ExcelTemplatePath | nvarchar | Nullable | Excel template file path |
| UpdatedAt | datetime2 | Default: GETUTCDATE() | |

**Unique Constraint:** (CompanyId, TemplateType)

#### MergeFields (Seeded: 200+ rows)

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| Id | int | PK, Identity | |
| TemplateType | nvarchar | Required | Challan/Bill/TaxInvoice |
| FieldExpression | nvarchar | Required | e.g., `{{companyBrandName}}` |
| Label | nvarchar | Required | Human-readable label |
| Category | nvarchar | Nullable | Company/Document/Client/Items |
| SortOrder | int | Required | Display order |

**Unique Constraint:** (TemplateType, FieldExpression)

#### AuditLogs

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| Id | int | PK, Identity | |
| Timestamp | datetime2 | Indexed | Event time |
| Level | nvarchar | Required | Error/Warning/Info |
| UserName | nvarchar | Nullable | Authenticated user |
| HttpMethod | nvarchar | Required | GET/POST/PUT/DELETE |
| RequestPath | nvarchar | Required | API endpoint |
| StatusCode | int | Required | HTTP response code |
| ExceptionType | nvarchar | Nullable | Exception class name |
| Message | nvarchar | Required | Error/warning message |
| StackTrace | nvarchar(max) | Nullable | Stack trace (5xx only) |
| RequestBody | nvarchar(4000) | Nullable | Request payload (truncated) |
| QueryString | nvarchar | Nullable | Query parameters |

#### ItemTypes

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| Id | int | PK, Identity | |
| Name | nvarchar | Unique, Required | Category name |
| CreatedAt | datetime2 | Default: GETUTCDATE() | |

#### ItemDescriptions & Units (Lookup tables)

| Column | Type | Constraints |
|--------|------|-------------|
| Id | int | PK, Identity |
| Name | nvarchar | Unique, Required |

#### FbrLookups

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| Id | int | PK, Identity | |
| Category | nvarchar | Required | HSCodes/UOM/Provinces/etc. |
| Code | nvarchar | Required | FBR code |
| Label | nvarchar | Required | Display label |
| SortOrder | int | Required | Display order |
| IsActive | bit | Default: true | Soft delete |

### Delete Behavior Matrix

| Parent | Child | On Delete |
|--------|-------|-----------|
| Company | DeliveryChallan | Cascade |
| Company | PrintTemplate | Cascade |
| DeliveryChallan | DeliveryItem | Cascade |
| Invoice | InvoiceItem | Cascade |
| Client | DeliveryChallan | Restrict |
| Company | Invoice | Restrict |
| Client | Invoice | Restrict |
| DeliveryChallan | Invoice | Restrict |
| Invoice | DeliveryItem (via InvoiceItem) | SetNull |

---

## 4. API Specification

### Base URL

```
Development: http://localhost:5134/api
Production:  https://<your-domain>/api
```

### Authentication Endpoints

| Method | Path | Auth | Request | Response |
|--------|------|------|---------|----------|
| POST | `/auth/login` | None | `{ username, password }` | `{ token, username, fullName, expiration }` |
| GET | `/auth/me` | JWT | - | `{ id, username, fullName, role, avatarPath }` |
| PUT | `/auth/profile` | JWT | `{ username?, fullName? }` | 200 OK |
| PUT | `/auth/password` | JWT | `{ currentPassword, newPassword }` | 200 OK |
| POST | `/auth/avatar` | JWT | multipart/form-data (file) | `{ avatarPath }` |
| DELETE | `/auth/avatar` | JWT | - | 200 OK |

### Company Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/companies` | JWT | List all companies |
| GET | `/companies/{id}` | JWT | Get company by ID |
| POST | `/companies` | JWT | Create company |
| PUT | `/companies/{id}` | JWT | Update company |
| DELETE | `/companies/{id}` | JWT | Delete company |
| POST | `/companies/{id}/logo` | JWT | Upload logo (multipart) |

### Client Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/clients` | JWT | List all clients |
| GET | `/clients/count?companyId=` | JWT | Count clients |
| GET | `/clients/company/{companyId}` | JWT | Clients by company |
| GET | `/clients/{id}` | JWT | Get client |
| POST | `/clients` | JWT | Create client |
| PUT | `/clients/{id}` | JWT | Update client |
| DELETE | `/clients/{id}` | JWT | Delete client |

### Delivery Challan Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/deliverychallans/count?companyId=` | JWT | Count challans |
| GET | `/deliverychallans/company/{id}` | JWT | All challans for company |
| GET | `/deliverychallans/company/{id}/paged?page=&pageSize=&search=&status=&clientId=&dateFrom=&dateTo=` | JWT | Paged + filtered |
| GET | `/deliverychallans/company/{id}/pending` | JWT | Pending challans only |
| GET | `/deliverychallans/{id}` | JWT | Get challan |
| POST | `/deliverychallans/company/{id}` | JWT | Create challan |
| PUT | `/deliverychallans/{id}/items` | JWT | Update items |
| PUT | `/deliverychallans/{id}/po` | JWT | Update PO details |
| PUT | `/deliverychallans/{id}/cancel` | JWT | Cancel challan |
| DELETE | `/deliverychallans/{id}` | JWT | Delete challan |
| DELETE | `/deliverychallans/items/{itemId}` | JWT | Delete single item |
| GET | `/deliverychallans/{id}/print` | JWT | Print data |

### Invoice Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/invoices/count?companyId=` | JWT | Count invoices |
| GET | `/invoices/company/{id}` | JWT | All invoices |
| GET | `/invoices/company/{id}/paged?page=&pageSize=&search=&clientId=&dateFrom=&dateTo=` | JWT | Paged + filtered |
| GET | `/invoices/{id}` | JWT | Get invoice |
| POST | `/invoices` | JWT | Create invoice |
| DELETE | `/invoices/{id}` | JWT | Delete invoice |
| GET | `/invoices/{id}/print/bill` | JWT | Bill print data |
| GET | `/invoices/{id}/print/tax-invoice` | JWT | Tax invoice print data |

**Create Invoice Request:**
```json
{
  "date": "2026-04-14",
  "companyId": 1,
  "clientId": 1,
  "gstRate": 18,
  "paymentTerms": "Net 30",
  "documentType": 4,
  "paymentMode": "Bank Transfer",
  "challanIds": [1, 2, 3],
  "items": [
    {
      "deliveryItemId": 1,
      "unitPrice": 500.00,
      "hsCode": "8432.1010",
      "fbrUOMId": 13,
      "saleType": "Standard Rate",
      "rateId": 413
    }
  ],
  "poDateUpdates": { "1": "2026-04-01" }
}
```

### PO Import Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/poimport/parse-pdf` | JWT | Parse PDF (max 10MB) |
| POST | `/poimport/parse-text` | JWT | Parse pasted text |
| POST | `/poimport/ensure-lookups` | JWT | Auto-create items/units |

### FBR Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/fbr/{invoiceId}/submit` | JWT | Submit to FBR |
| POST | `/fbr/{invoiceId}/validate` | JWT | Validate with FBR |
| GET | `/fbr/provinces/{companyId}` | JWT | Province list |
| GET | `/fbr/doctypes/{companyId}` | JWT | Document types |
| GET | `/fbr/hscodes/{companyId}?search=` | JWT | HS code lookup |
| GET | `/fbr/uom/{companyId}` | JWT | Units of measure |
| GET | `/fbr/saletyperates/{companyId}?date=&transTypeId=&provinceId=` | JWT | Sale type rates |
| POST | `/fbr/regstatus/{companyId}` | JWT | Registration status check |

### Print Template Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/printtemplates/company/{id}` | JWT | All templates |
| GET | `/printtemplates/company/{id}/{type}` | JWT | Get by type |
| PUT | `/printtemplates/company/{id}/{type}` | JWT | Create/update |
| POST | `/printtemplates/company/{id}/{type}/excel-template` | JWT | Upload Excel template |
| POST | `/printtemplates/company/{id}/Challan/export-excel` | JWT | Export challan Excel |
| POST | `/printtemplates/company/{id}/Bill/export-excel` | JWT | Export bill Excel |
| POST | `/printtemplates/company/{id}/TaxInvoice/export-excel` | JWT | Export tax invoice Excel |

### Admin Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/users` | Admin | List users |
| POST | `/users` | Admin | Create user |
| PUT | `/users/{id}` | Admin | Update user |
| DELETE | `/users/{id}` | Admin | Delete user |
| GET | `/auditlogs?page=&pageSize=&level=&search=` | Admin | Audit logs |
| GET | `/auditlogs/summary` | Admin | Error/warning counts |

### Lookup Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/lookup/items?query=` | JWT | Search item descriptions |
| POST | `/lookup/items` | JWT | Add item description |
| GET | `/lookup/units?query=` | JWT | Search units |
| POST | `/lookup/units` | JWT | Add unit |
| GET | `/itemtypes` | JWT | All item types |
| POST | `/itemtypes` | JWT | Create item type |
| GET | `/mergefields/{type}` | JWT | Fields for template type |

---

## 5. Authentication & Authorization

### JWT Token Structure

```
Header: { alg: "HS256", typ: "JWT" }
Payload: {
  sub: "<user_id>",
  "http://schemas.xmlsoap.org/.../name": "<username>",
  "http://schemas.microsoft.com/.../role": "<role>",
  fullName: "<full_name>",
  jti: "<unique_guid>",
  exp: <unix_timestamp>,
  iss: "MyApp.Api",
  aud: "MyApp.Frontend"
}
```

### Token Lifecycle

- **Expiry:** 8 hours from issuance
- **Storage:** Frontend stores in localStorage
- **Injection:** Axios interceptor adds `Authorization: Bearer {token}` to every request
- **Refresh:** No refresh token; user re-authenticates on expiry

### Role-Based Access

| Resource | User | Admin |
|----------|------|-------|
| Companies (CRUD) | Yes | Yes |
| Clients (CRUD) | Yes | Yes |
| Challans (CRUD) | Yes | Yes |
| Invoices (CRUD) | Yes | Yes |
| Print Templates | Yes | Yes |
| PO Import | Yes | Yes |
| FBR Operations | Yes | Yes |
| User Management | No | Yes |
| Audit Logs | No | Yes |

### Password Policy

- Minimum 6 characters
- Hashed with BCrypt (cost factor 11)
- Seed admin (ID=1) cannot be deleted or have role changed

---

## 6. Business Workflows

### Delivery Challan Lifecycle

```
                    +---> [Cancelled]
                    |
[Create] --+--> [Pending] --+--> [Invoiced]
            |                |        |
            |                |        | (delete invoice)
            |                |        v
            |                +--- [Pending]
            |
            +--> [No PO] ---+--> [Pending] (after PO added + FBR ready)
            |                |
            |                +--> [Setup Required] (after PO added, FBR not ready)
            |
            +--> [Setup Required] --+--> [Pending] (FBR fields filled + has PO)
                                     |
                                     +--> [No PO] (FBR fields filled, no PO)
```

**Status Determination on Create:**
1. Check FBR readiness (company + client fields)
2. If not FBR ready -> `Setup Required`
3. If FBR ready and has PO -> `Pending`
4. If FBR ready and no PO -> `No PO`

**FBR Readiness Requirements:**

Company must have ALL of:
- NTN, STRN
- FbrProvinceCode, FbrBusinessActivity, FbrSector
- FbrToken, FbrEnvironment

Client must have ALL of:
- NTN, STRN
- RegistrationType, FbrProvinceCode
- CNIC (only if RegistrationType is "Unregistered" or "CNIC")

**Editable Statuses:** Pending, No PO, Setup Required  
**Locked Statuses:** Invoiced, Cancelled

### Invoice Creation Flow

```
1. User selects company
2. System loads "Pending" challans for that company
3. User selects 1+ challans (must be same client)
4. System extracts delivery items from selected challans
5. User enters unit price for each item
6. User enters GST rate (0-100%)
7. System calculates:
   - Subtotal = SUM(quantity * unitPrice)
   - GSTAmount = Subtotal * GSTRate / 100
   - GrandTotal = Subtotal + GSTAmount
   - AmountInWords = NumberToWords(GrandTotal)
8. System auto-generates next InvoiceNumber
9. Creates invoice + items in single transaction
10. Transitions selected challans -> "Invoiced"
11. Saves new item descriptions to lookup table
```

**Invoice Deletion Rules:**
- Cannot delete if FbrStatus == "Submitted"
- Reverts linked challans to "Pending" (or "No PO" if no PO number)
- All operations wrapped in database transaction

### Number to Words Conversion

Supports Pakistani currency format:
- `123456.78` -> `"One Lakh Twenty Three Thousand Four Hundred Fifty Six and 78/100"`
- Handles amounts up to Arab (10^9)
- Uses Lakh/Crore notation (South Asian numbering)

---

## 7. FBR Digital Invoicing Integration

### Overview

Integration with Pakistan FBR (Federal Board of Revenue) Digital Invoicing system per API V1.12 specification.

### Endpoints

| Environment | Base URL |
|-------------|----------|
| Sandbox | `https://gw-sandbox.fbr.gov.pk/pdi/v1/` |
| Production | `https://gw.fbr.gov.pk/pdi/v1/` |

### Authentication

```
Authorization: Bearer {company.FbrToken}
```

Token obtained from FBR IRIS portal after company registration.

### Invoice Submission Flow

```
1. User clicks "Submit to FBR" on invoice
2. System builds FbrInvoiceRequest from invoice data:
   - Maps company fields -> seller fields
   - Maps client fields -> buyer fields
   - Maps invoice items -> FBR item format
3. POST to /pdi/v1/postinvoicedata
4. FBR returns:
   - Success: IRN (Invoice Reference Number)
   - Failure: Error details per item
5. System stores FbrIRN, FbrStatus, FbrSubmittedAt
```

### Reference Data APIs Used

| API | Purpose | Cache |
|-----|---------|-------|
| GET /provinces | Province codes | FbrLookup table |
| GET /documenttypes | Invoice/Debit/Credit note types | FbrLookup table |
| GET /hscodes | HS/PCT commodity codes | FbrLookup table |
| GET /uom | Units of measurement | FbrLookup table |
| GET /transactiontypes | Transaction categories | FbrLookup table |
| GET /saletyperates | Applicable tax rates | On-demand |
| GET /sroschedule | SRO exemptions | On-demand |
| POST /getregistrationstatus | Buyer NTN validation | On-demand |

### Sandbox Testing

28 test scenarios (SN001-SN028) required before production approval. System supports `scenarioId` parameter for sandbox testing.

---

## 8. PO Import Pipeline

### Architecture

```
PDF/Text Input
    |
    v
[Text Extraction]  (PdfPig: page.GetWords() + Y-coordinate grouping)
    |
    v
[LLM Parser]  (Gemini 2.0 Flash, if configured)
    |     |
    | fail/unconfigured
    |     |
    v     v
[Regex Parser]  (Position-based column detection)
    |
    v
[False Positive Filter]  (sentence detection, address patterns, legal text)
    |
    v
ParsedPODto { PONumber, PODate, Items[], Warnings[] }
```

### Strategy by Input Type

| Input | Primary Parser | Fallback |
|-------|---------------|----------|
| PDF file | LLM (Gemini) | Position-based regex |
| Pasted text | Regex | LLM (Gemini) |

Rationale: PDFs often have complex layouts better handled by AI. Pasted text is usually well-structured and matches regex patterns reliably.

### Gemini Integration

```
Model: gemini-2.0-flash
Temperature: 0.1
Max input: 8000 chars
Output: responseMimeType = "application/json"
Free tier: 1500 requests/day, 1M tokens/day
```

### Position-Based PDF Parser

1. Extract words with coordinates using PdfPig
2. Group words into lines by Y-coordinate proximity
3. Detect table headers (Description, Qty, Unit, etc.)
4. Calculate column boundaries using midpoints between headers
5. Refine boundaries by sampling actual data row positions
6. Extract items from data rows using column boundaries

### False Positive Filtering

Items are rejected if:
- Description > 100 chars (likely a sentence)
- Contains legal keywords (warranty, liability, terms)
- Matches address patterns
- Contains only numbers
- Quantity > 999,999 (unrealistic)
- PO number matches common English words (blocklist)

---

## 9. Print Template Engine

### Template Types

| Type | Purpose | Data Source |
|------|---------|-------------|
| Challan | Delivery challan document | PrintChallanDto |
| Bill | Business invoice | PrintBillDto |
| TaxInvoice | FBR tax-compliant invoice | PrintTaxInvoiceDto |

### Merge Field Syntax (Handlebars)

```handlebars
Simple:        {{companyBrandName}}
Date format:   {{fmtDate deliveryDate}}
Multiline:     {{{nl2br companyAddress}}}
Conditional:   {{#if invoiceNumber}}...{{/if}}
Loop:          {{#each items}}{{description}}{{/each}}
Index:         {{@index}} (0-based), used as {{add @index 1}} for 1-based
```

### Editor Modes

1. **HTML Mode** - Direct code editing with syntax highlighting
2. **GrapesJS Mode** - Visual drag-and-drop builder
   - Components: text, image, table, container
   - Merge fields inserted as editable tokens
   - Exports to HTML for rendering

### Excel Export

- Upload `.xlsx/.xlsm` template per company per template type
- Named cells are filled with merge field values using ClosedXML
- Supports item row cloning for variable-length lists

---

## 10. Audit Logging

### Capture Points

Implemented via `GlobalExceptionMiddleware`:

| Condition | Level | Captured |
|-----------|-------|----------|
| Unhandled exception | Error | Full stack trace, request body |
| 4xx response | Warning | Status code, request path |
| 5xx response | Error | Exception details, stack trace |

### Queryable Dimensions

- Time range (Timestamp index)
- Log level (Error/Warning/Info)
- User name
- HTTP method
- Request path (supports LIKE search)
- Status code

### Data Retention

All logs retained indefinitely. No automatic purging configured.

---

## 11. Error Handling

### Global Exception Middleware

```
try {
    await next(context);
    if (statusCode >= 400) -> log Warning
} catch (Exception ex) {
    statusCode = 500
    log Error with stack trace
    return ProblemDetails JSON
}
```

### Validation Patterns

| Layer | Validation | Response |
|-------|-----------|----------|
| Controller | `[Required]`, `[Range]` attributes | 400 with ModelState |
| Service | Business rules | 400 with `{ error: "message" }` |
| Repository | FK violations | 500 (caught by middleware) |
| Database | Unique constraints | 409 or caught as DbUpdateException |

### Race Condition Handling

- `EnsureLookups` endpoint catches `SqlException 2601/2627` (duplicate key) silently
- Invoice creation wrapped in `IDbContextTransaction` with rollback on failure

---

## 12. Configuration Reference

### appsettings.json

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "<SQL Server connection string>"
  },
  "Jwt": {
    "Key": "<min 256-bit secret key>",
    "Issuer": "MyApp.Api",
    "Audience": "MyApp.Frontend",
    "ExpirationHours": 8
  },
  "Gemini": {
    "ApiKey": "<Google AI API key>",
    "Model": "gemini-2.0-flash"
  },
  "Pagination": {
    "DefaultPageSize": 10
  },
  "AppSettings": {
    "SeedAdminUserId": 1
  }
}
```

### Environment-Specific Overrides

| Setting | Development | Production |
|---------|-------------|------------|
| Database | LocalDB/Express | Azure SQL / Remote SQL Server |
| Swagger | Enabled | Disabled |
| CORS | localhost:5173 | Production domain |
| Logging | Console | File-based |

### File Storage Paths

| Content | Path | Served At |
|---------|------|-----------|
| Company logos | `data/uploads/logos/` | `/data/uploads/logos/{file}` |
| User avatars | `data/images/avatars/` | `/data/images/avatars/{file}` |
| Excel templates | `data/uploads/excel-templates/` | Not served (download via API) |
| Product images | `wwwroot/images/products/` | `/images/products/{category}/{file}` |

---

## 13. Deployment Architecture

### CI/CD Pipeline

```
git push master
    |
    v
GitHub Actions (.github/workflows/deploy.yml)
    |
    +--> [Detect Changes] (dorny/paths-filter)
    |        |
    |        +--> Frontend only? --> [Build React] --> [FTP deploy wwwroot/]
    |        |                                          (no app restart)
    |        |
    |        +--> Backend changed? --> [Build React] --> [dotnet publish]
    |                                       |                 |
    |                                       v                 v
    |                                  [Copy to wwwroot] [Upload app_offline.htm]
    |                                       |                 |
    |                                       v                 v
    |                                  [Merge into publish]  [Wait 5s]
    |                                       |                 |
    |                                       +--------+--------+
    |                                                |
    |                                                v
    |                                    [FTP Deploy (incremental)]
    |                                    (only changed files uploaded)
    v
MonsterASP.NET (IIS + .NET 9)
```

### Optimization

| Optimization | Impact |
|-------------|--------|
| `PrivateAssets=all` on CodeGeneration.Design | -32 MB, -100 DLLs |
| `SatelliteResourceLanguages=en` | -12 MB, -40 locale folders |
| `DebugType=none` | No .pdb files |
| FTP exclude: linux/osx runtimes | Skip unnecessary platform binaries |
| Frontend-only deploy path | Skip .NET build, zero downtime |
| FTP sync state | Only upload changed files |

**Result:** 352 files / 79 MB -> 169 files / 37 MB (53% reduction)

### Hosting

| Component | Host |
|-----------|------|
| Web Server | IIS on MonsterASP.NET |
| Runtime | .NET 9 (in-process) |
| Database | SQL Server (same or remote) |
| Static Files | Served by ASP.NET from `wwwroot/` |
| FTP | `site61833.siteasp.net` |

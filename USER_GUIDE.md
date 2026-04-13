# MyApp ERP - Complete User Guide

## Table of Contents

1. [System Overview](#system-overview)
2. [Getting Started](#getting-started)
3. [Company Setup](#company-setup)
4. [Client Management](#client-management)
5. [Item Types](#item-types)
6. [Delivery Challans](#delivery-challans)
7. [PO Import (Smart Challan Creation)](#po-import)
8. [Invoices](#invoices)
9. [Print Templates](#print-templates)
10. [FBR Digital Invoicing Integration](#fbr-digital-invoicing)
11. [User Management](#user-management)
12. [Profile Settings](#profile-settings)
13. [Audit Logs](#audit-logs)
14. [Deployment & Configuration](#deployment-configuration)

---

## 1. System Overview <a name="system-overview"></a>

MyApp ERP is a full-stack business management system built for Pakistani businesses. It handles the complete supply chain document flow:

**Purchase Order -> Delivery Challan -> Invoice -> FBR Submission**

### Key Features
- Multi-company support (manage multiple businesses from one system)
- Delivery challan creation and tracking
- Invoice generation from challans with GST calculation
- PO Import from PDF or text (AI-powered with Google Gemini)
- FBR Digital Invoicing integration (submit invoices to FBR for tax compliance)
- Customizable print templates (HTML visual editor + Excel export)
- Role-based user management (Admin / User)
- Audit logging for all API errors

### Technology Stack
- **Backend:** ASP.NET 9, Entity Framework Core, SQL Server
- **Frontend:** React (Vite), served from the same backend port
- **Authentication:** JWT (JSON Web Token), 8-hour session
- **AI Parser:** Google Gemini 2.0 Flash (free tier)
- **Deployment:** MonsterASP.NET via GitHub Actions (auto-deploy on push to master)

---

## 2. Getting Started <a name="getting-started"></a>

### Logging In

1. Open the application URL in your browser
2. Enter your **Username** and **Password**
3. Click **Login**
4. You will be redirected to the Dashboard

Default admin credentials (first-time setup):
- Username: `admin`
- Password: `admin123`

> **Important:** Change the default password immediately after first login via Profile > Change Password.

### Dashboard

After login, the Dashboard shows:
- Total companies, clients, challans, and invoices
- Quick links to create new challans and invoices
- Company overview cards

### Navigation

The sidebar contains:
- **Main:** Dashboard, Companies, Clients, Item Types, Challans, Invoices
- **Management:** Templates, FBR Settings, Audit Logs (Admin only), Users (Admin only)
- **Bottom:** Profile, Logout

---

## 3. Company Setup <a name="company-setup"></a>

Companies are the top-level entities. Each company has its own challans, invoices, clients, and templates.

### Creating a Company

1. Go to **Companies** from the sidebar
2. Click **Add Company**
3. Fill in the required fields:
   - **Company Name** (must be unique)
   - **Brand Name** (appears on printed documents)
   - **Full Address**
   - **Phone**
   - **NTN** (National Tax Number)
   - **STRN** (Sales Tax Registration Number)

### Numbering Configuration

- **Starting Challan Number:** The first challan number for this company (e.g., 1001). Once a challan is created, this cannot be changed.
- **Starting Invoice Number:** The first invoice number (e.g., 5001). Once an invoice is created, this cannot be changed.
- **Invoice Number Prefix:** Optional text prepended to invoice numbers for FBR submission. Example: If prefix is `INV-` and invoice number is `5001`, the FBR invoice number becomes `INV-5001`. This is useful because FBR requires alphanumeric invoice numbers, while internally the system uses sequential integers.

### Company Logo

Click the logo area to upload a company logo (JPG/PNG/WebP). This appears on printed challans and invoices.

### FBR Settings (per company)

If you plan to use FBR Digital Invoicing, configure these in the company form:
- **Province Code:** Select the province where your business operates
- **Business Activity:** Manufacturer, Importer, Distributor, etc.
- **Sector:** Steel, FMCG, Textile, etc.
- **FBR Token:** Bearer token from the FBR IRIS portal
- **FBR Environment:** Sandbox (testing) or Production (live)

> These fields are required before you can submit invoices to FBR.

---

## 4. Client Management <a name="client-management"></a>

Clients are your buyers/customers, linked to a specific company.

### Creating a Client

1. Go to **Clients** from the sidebar
2. Select the company from the dropdown
3. Click **Add Client**
4. Fill in:
   - **Name** (required)
   - **Address**
   - **Phone**
   - **Email**
   - **NTN** and **STRN**
   - **Site** (delivery location)

### FBR Client Fields

For FBR submission, you also need:
- **Registration Type:** Registered, Unregistered, FTN, or CNIC
- **CNIC:** Required if the buyer is unregistered (13-digit CNIC number)
- **Province Code:** Destination province for tax calculation

---

## 5. Item Types <a name="item-types"></a>

Item Types are categories for your delivery items (e.g., "Electrical", "Mechanical", "Consumables").

1. Go to **Item Types** from the sidebar
2. Click **Add Item Type**
3. Enter the type name
4. Click Save

Item types are optional when creating challan items but help organize your inventory.

---

## 6. Delivery Challans <a name="delivery-challans"></a>

A Delivery Challan (DC) is a document that accompanies goods being delivered to a client. It lists what items are being sent, in what quantity, and to where.

### Creating a Challan (Manual)

1. Go to **Challans** from the sidebar
2. Select a company
3. Click **New Challan**
4. Fill in:
   - **Client:** Select from dropdown (clients of the selected company)
   - **PO Number:** Purchase order reference (optional but recommended)
   - **PO Date:** Date of the purchase order
   - **Delivery Date:** When goods will be delivered
   - **Site:** Delivery location
5. Add items:
   - **Description:** Type to search existing items (autocomplete) or enter new
   - **Quantity:** Number of items
   - **Unit:** Select from autocomplete (Pcs, Kg, Mtr, etc.)
6. Click **Save**

### Challan Status Lifecycle

| Status | Meaning |
|--------|---------|
| **Pending** | Challan created, waiting to be invoiced |
| **No PO** | Challan has no purchase order linked |
| **Setup Required** | Missing required fields |
| **Invoiced** | Included in an invoice |
| **Cancelled** | Cancelled by user |

### Filtering & Search

- Filter by status, client, or date range
- Search by challan number, PO number, or description
- Paginated results (configurable page size)

### Printing a Challan

- Click the print icon on any challan
- Choose PDF or Excel export
- The system uses the company's configured print template

---

## 7. PO Import (Smart Challan Creation) <a name="po-import"></a>

Instead of manually entering challan items, you can import them from a Purchase Order.

### How to Import a PO

1. Go to **Challans** page
2. Click the teal **Import PO** button
3. Choose import method:

**Option A: Upload PDF**
- Click "Choose PDF File" and select the PO document
- The system extracts text using PdfPig and parses it with AI (Google Gemini)
- If AI is unavailable, falls back to regex-based parsing

**Option B: Paste Text**
- Copy the PO text from any source (email, website, another PDF viewer)
- Paste it into the text area
- Click "Parse Text"

### After Parsing

The system shows an editable preview:
- **PO Number** and **PO Date** (auto-detected, editable)
- **Client** (select from dropdown)
- **Delivery Date** and **Site**
- **Items table** with Description, Quantity, and Unit (all editable)
- Add or remove items as needed

### How AI Parsing Works

1. **PDF Upload:** Text is extracted from the PDF using word-level coordinates (PdfPig library). Words are grouped into lines by Y-position for accurate layout reconstruction.
2. **AI Parser (Primary):** The extracted text is sent to Google Gemini 2.0 Flash with a structured prompt. Gemini identifies the PO number, date, supplier, and line items regardless of format.
3. **Regex Parser (Fallback):** If the AI is unavailable or returns no results, a position-based regex parser handles the text. It detects table headers, maps columns by position, and extracts items.

### Auto-Creation of Items and Units

When you submit an imported PO, the system automatically:
- Creates any new item descriptions not already in the database
- Creates any new units not already in the database
- These become available in autocomplete for future challans

### Supported PO Formats

The AI parser handles virtually any PO format. The regex fallback specifically handles:
- Row-based tables (Description | Qty | Unit columns)
- Columnar format (values above headers, common in Pakistani ERP exports like Meko Denim)
- List-style items with embedded quantities

---

## 8. Invoices <a name="invoices"></a>

Invoices are created from one or more delivery challans for the same client.

### Creating an Invoice

1. Go to **Invoices** from the sidebar
2. Select a company
3. Click **Create Invoice**
4. Select a client — the system shows all pending challans for that client
5. Check the challans to include
6. For each item, enter:
   - **Description:** Pre-filled from challan, but editable (autocomplete from database)
   - **Unit Price:** Required, must be greater than 0
7. Set **GST Rate** (percentage, e.g., 18)
8. Click **Create Invoice**

### Invoice Calculations

The system automatically calculates:
- **Subtotal:** Sum of (Quantity x Unit Price) for all items
- **GST Amount:** Subtotal x GST Rate / 100
- **Grand Total:** Subtotal + GST Amount
- **Amount in Words:** Converted to English words (e.g., "Five Thousand Nine Hundred Only")

### Invoice Number Format

- Internal: Sequential integer (e.g., 5001, 5002, 5003)
- FBR Number: Prefix + integer (e.g., `INV-5001` if prefix is configured)
- The prefix is set in Company Settings and is optional

### Validation Rules

- All items must have a unit price greater than 0
- The "Create Invoice" button is disabled until all prices are filled
- A warning message appears if any item has no price

### Printing an Invoice

Two print formats available:
- **Bill:** Commercial invoice for the buyer
- **Tax Invoice:** FBR-compliant sales tax invoice

Both use the company's configured print template (HTML or Excel).

### Deleting an Invoice

When you delete an invoice:
- All associated delivery challans revert to "Pending" status
- They become available for inclusion in a new invoice

---

## 9. Print Templates <a name="print-templates"></a>

Each company can have custom print templates for Challans, Bills, and Tax Invoices.

### Template Types

| Type | Used For |
|------|----------|
| **Challan** | Delivery challan printout |
| **Bill** | Commercial invoice |
| **TaxInvoice** | FBR sales tax invoice |

### Editing Templates

1. Go to **Templates** from the sidebar
2. Select a company and template type
3. Choose editor mode:
   - **Visual Editor:** Drag-and-drop WYSIWYG editor (powered by GrapeJS)
   - **Code Editor:** Write HTML/CSS directly
   - **Starter Templates:** Pick from built-in defaults and customize

### Merge Fields

Templates use merge fields (placeholders) that get replaced with actual data when printing:

**Company Fields:**
- `{{companyBrandName}}`, `{{companyFullAddress}}`, `{{companyPhone}}`
- `{{companyNTN}}`, `{{companySTRN}}`, `{{companyLogoUrl}}`

**Client Fields:**
- `{{clientName}}`, `{{clientAddress}}`, `{{clientPhone}}`
- `{{clientNTN}}`, `{{clientSTRN}}`

**Document Fields:**
- `{{challanNumber}}`, `{{invoiceNumber}}`, `{{date}}`
- `{{poNumber}}`, `{{poDate}}`, `{{site}}`
- `{{subtotal}}`, `{{gstRate}}`, `{{gstAmount}}`, `{{grandTotal}}`
- `{{amountInWords}}`

**Item Loop:**
- `{{#items}}...{{/items}}` — repeats for each item
- Inside: `{{items.description}}`, `{{items.quantity}}`, `{{items.uom}}`, `{{items.unitPrice}}`, `{{items.lineTotal}}`

### Excel Templates

1. Upload an Excel template (.xlsx or .xlsm, max 10MB)
2. The system fills designated cells with data
3. Users can export challans/invoices as filled Excel files
4. Useful for companies that need a specific Excel format

---

## 10. FBR Digital Invoicing Integration <a name="fbr-digital-invoicing"></a>

The system integrates with Pakistan's Federal Board of Revenue (FBR) Digital Invoicing system for sales tax compliance.

### What is FBR Digital Invoicing?

FBR requires certain businesses to electronically report their sales invoices. When you submit an invoice to FBR:
1. FBR validates the invoice data
2. Returns an **Invoice Reference Number (IRN)** — a unique identifier
3. The IRN must be printed on the invoice (as text and QR code)

### Setup Requirements

Before submitting invoices to FBR, you need:

#### Step 1: Register on FBR IRIS Portal
1. Go to the FBR IRIS portal (https://iris.fbr.gov.pk)
2. Register your business for Digital Invoicing
3. Choose an integrator (PRAL is free, government-provided)
4. Get your **Bearer Token** from the portal

#### Step 2: IP Whitelisting
- Your server's IP address must be whitelisted on the IRIS portal
- For MonsterASP.NET hosting, contact your host for the server IP

#### Step 3: Configure in MyApp

**Company Settings:**
1. Go to Companies > Edit your company
2. In the FBR Digital Invoicing section, fill in:
   - **Province Code:** Your business province (e.g., Sindh = 8)
   - **Business Activity:** Your business type
   - **Sector:** Your industry sector
   - **FBR Token:** Paste the bearer token from IRIS
   - **FBR Environment:** Start with "Sandbox" for testing

**Client Settings:**
1. Go to Clients > Edit the client
2. Fill in FBR fields:
   - **Registration Type:** Registered / Unregistered / FTN / CNIC
   - **CNIC:** If buyer is unregistered
   - **Province Code:** Buyer's province (destination of supply)

**Invoice Item Settings:**
When creating invoices, each item needs:
- **HS Code:** Harmonized System code from FBR reference data
- **FBR UOM:** FBR's unit of measure ID
- **Sale Type:** Type of sale (e.g., Goods at Standard Rate)
- **Rate ID:** FBR tax rate identifier

#### Step 4: Sandbox Testing

FBR requires you to pass 28 test scenarios on the sandbox before going live:
1. Set FBR Environment to **Sandbox** in company settings
2. Create test invoices
3. Use **Validate** to check without submitting
4. Use **Submit** to send to FBR sandbox
5. Verify each scenario passes

#### Step 5: Go Live

After passing sandbox tests:
1. Request production access from FBR
2. Get production bearer token
3. Change FBR Environment to **Production** in company settings
4. Start submitting real invoices

### Submitting an Invoice to FBR

1. Go to **Invoices** > select an invoice
2. Ensure all FBR fields are filled (company, client, items)
3. Click **Validate with FBR** first (dry run, no submission)
4. If validation passes, click **Submit to FBR**
5. On success:
   - FBR returns an IRN (Invoice Reference Number)
   - Status changes to "Submitted"
   - IRN is stored and can be printed on the invoice

### FBR Reference Data

The system provides dropdown lookups for FBR-required fields, fetched from FBR's API:
- **Provinces:** Punjab, Sindh, KP, Balochistan, etc.
- **Document Types:** Sale Invoice, Debit Note, Credit Note
- **HS Codes:** Thousands of product classification codes (searchable)
- **Units of Measure:** FBR's standard UOM list
- **Sale Types & Rates:** Tax rates by province and transaction type

### FBR Settings Page

Accessible from the sidebar under Management:
- View and manage FBR lookup data (provinces, business activities, sectors, etc.)
- These are cached locally and can be manually updated
- Categories: Province, Business Activity, Sector, Registration Type, Environment, Document Type, Payment Mode

### FBR Invoice Status

| Status | Meaning |
|--------|---------|
| **Not Submitted** | Invoice created but not sent to FBR |
| **Validated** | Passed FBR validation (dry run) |
| **Submitted** | Successfully submitted, IRN received |
| **Failed** | Submission failed (error message stored) |

---

## 11. User Management <a name="user-management"></a>

> Only the primary admin (seed admin) can manage users.

### Roles

| Role | Access |
|------|--------|
| **Admin** | Full access including user management, audit logs |
| **User** | Standard access to companies, clients, challans, invoices |

### Creating a User

1. Go to **Users** from the sidebar (Admin only)
2. Click **Add User**
3. Enter: Username, Full Name, Password, Role
4. Click Save

### Editing a User

- Change username, full name, role
- Optionally reset password
- Cannot modify the primary admin account

### Deleting a User

- Click delete on any user (with confirmation)
- Cannot delete the primary admin or yourself

---

## 12. Profile Settings <a name="profile-settings"></a>

Access via the **Profile** link at the bottom of the sidebar.

### Edit Profile
- Update your **Username** (must be unique)
- Update your **Full Name**

### Change Password
- Enter your **Current Password** (verification required)
- Enter and confirm your **New Password** (minimum 6 characters)

### Avatar
- Click the avatar area to upload a photo (JPG, PNG, or WebP, max 7MB)
- Click the remove button to delete your avatar

---

## 13. Audit Logs <a name="audit-logs"></a>

> Admin only

The system automatically logs all API errors and exceptions.

### Viewing Logs

1. Go to **Audit Logs** from the sidebar
2. Filter by:
   - **Level:** Error, Warning, Info
   - **Search:** Text search across messages, paths, users
3. Click any log entry to see full details:
   - HTTP method and path
   - Status code
   - Exception type and message
   - Stack trace (for 500 errors)
   - Request body

### What Gets Logged

- All HTTP 4xx and 5xx responses
- Unhandled exceptions
- Authentication failures (401)
- Validation errors (400)

---

## 14. Deployment & Configuration <a name="deployment-configuration"></a>

### Automatic Deployment

The system deploys automatically when code is pushed to the `master` branch on GitHub:

1. GitHub Actions builds the React frontend (`npm run build`)
2. Publishes the .NET API (`dotnet publish -c Release`)
3. Deploys to MonsterASP.NET via FTP
4. The app restarts automatically

### Configuration Files

**appsettings.json** (base configuration):
```json
{
  "ConnectionStrings": {
    "DefaultConnection": "your-sql-server-connection-string"
  },
  "Gemini": {
    "ApiKey": "your-google-gemini-api-key",
    "Model": "gemini-2.0-flash"
  },
  "Jwt": {
    "Key": "your-secret-key-minimum-32-chars",
    "Issuer": "MyApp.Api",
    "Audience": "MyApp.Frontend",
    "ExpirationHours": 8
  }
}
```

**appsettings.Production.json** (overrides for production):
- Connection string for production SQL Server
- JWT settings (should match)

### Gemini AI Setup (for PO Import)

1. Go to https://aistudio.google.com/apikey
2. Create an API key (free tier: 1500 requests/day)
3. Add it to `appsettings.json` under `Gemini:ApiKey`
4. The PO Import feature will automatically use AI parsing
5. If no key is configured, the system falls back to regex parsing

### Database

- SQL Server (any edition)
- Migrations run automatically on startup
- No manual database setup needed — EF Core handles schema creation

### File Storage

Files are stored in the `data/` folder:
- `data/uploads/logos/` — Company logos
- `data/images/avatars/` — User avatars
- `data/uploads/excel-templates/` — Excel print templates

> This folder must be persistent across deployments. On MonsterASP.NET, it's outside the deploy directory.

---

## Quick Reference

### Keyboard Shortcuts
- **Esc** — Close any open modal/dialog

### Common Workflows

**Daily Challan Creation:**
Companies > Select Company > Challans > New Challan > Add Items > Save

**Quick PO Import:**
Challans > Import PO > Upload PDF > Review & Edit > Submit

**Invoice from Challans:**
Invoices > Create Invoice > Select Client > Check Challans > Enter Prices > Create

**FBR Submission:**
Invoices > Select Invoice > Validate with FBR > Submit to FBR

### Troubleshooting

| Issue | Solution |
|-------|----------|
| 401 Unauthorized | Log out and log back in (token expired) |
| PO Import shows no items | Try pasting text manually instead of PDF |
| FBR submission fails | Check all required FBR fields are filled (company + client + items) |
| Print template empty | Configure template in Templates page first |
| Invoice number not incrementing | Check starting invoice number is set in Company settings |

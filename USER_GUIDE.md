# MyApp ERP - User Guide

A step-by-step guide for using the Delivery Challan & Invoicing System. This guide is written for everyday users -- no technical knowledge required.

---

## Table of Contents

1. [Logging In](#1-logging-in)
2. [Dashboard Overview](#2-dashboard-overview)
3. [Setting Up a Company](#3-setting-up-a-company)
4. [Adding Clients](#4-adding-clients)
5. [Creating Delivery Challans](#5-creating-delivery-challans)
6. [Understanding Challan Statuses](#6-understanding-challan-statuses)
7. [Importing a Purchase Order (PO)](#7-importing-a-purchase-order-po)
8. [Creating Invoices](#8-creating-invoices)
9. [Printing & Exporting Documents](#9-printing--exporting-documents)
10. [Customizing Print Templates](#10-customizing-print-templates)
11. [FBR Digital Invoicing](#11-fbr-digital-invoicing)
12. [Managing Users](#12-managing-users)
13. [Your Profile](#13-your-profile)
14. [Audit Logs](#14-audit-logs)
15. [Quick Reference](#15-quick-reference)

---

## 1. Logging In

When you open the application, you will see the login screen with the company branding on the left and a login form on the right.

**How to log in:**

1. Enter your **Username** in the first field
2. Enter your **Password** in the second field (click the eye icon to show/hide your password)
3. Click the **Login** button

> **Default login:** Username: `admin` / Password: `admin123`
> Change this password immediately after your first login (see [Your Profile](#13-your-profile)).

After a successful login, you will be taken to the Dashboard. Your login session lasts **8 hours**, after which you will need to log in again.

---

## 2. Dashboard Overview

The Dashboard is your home screen. It shows a quick summary of your business at a glance.

**What you see:**

- **Welcome banner** with your name and today's date
- **Company filter** dropdown -- select "All Companies" or a specific company to filter the counts below
- **Overview cards** showing totals for:
  - Companies (how many business entities are registered)
  - Clients (total customers)
  - Challans (total delivery challans created)
  - Invoices (total invoices generated)
- **Quick Actions** -- shortcut cards to jump directly to Companies, Clients, Challans, or Invoices

**Sidebar Navigation** (always visible on the left):

| Section | Pages |
|---------|-------|
| **Main** | Dashboard |
| **Management > Configuration** | Companies List, Clients List, Item Types, Print Templates, FBR Settings |
| **Management** | Challans, Invoices |
| **Admin** | Users, Audit Logs |
| **Account** | My Profile, Logout |

---

## 3. Setting Up a Company

Before you can create challans or invoices, you need to register at least one company.

### Creating a New Company

1. Go to **Configuration > Companies List** in the sidebar
2. Click the **+ New Company** button (top right, blue button)
3. Fill in the company details:

| Field | Required? | Description |
|-------|-----------|-------------|
| Company Name | Yes | Legal name of the business (e.g., "Hakimi Traders") |
| Brand Name | No | Trade name if different from legal name |
| Full Address | No | Complete business address |
| Phone | No | Contact number |
| NTN | No* | National Tax Number (required for FBR/invoicing) |
| STRN | No* | Sales Tax Registration Number (required for FBR/invoicing) |
| Starting Challan Number | Yes | The first challan number (e.g., 1001) |
| Starting Invoice Number | Yes | The first invoice number (e.g., 5001) |
| Invoice Number Prefix | No | Optional text added before invoice numbers (e.g., "INV-" makes invoices show as INV-5001) |

> *Fields marked "No*" are optional for basic use but **required** for FBR Digital Invoicing.

4. Click **Save** to create the company

### Editing a Company

- Click the **Edit** button on any company card
- Make your changes
- Click **Save**

### Uploading a Company Logo

- Click the **Edit** button on a company card
- Find the logo upload section
- Select an image file (JPG, PNG, or WebP)
- The logo will appear on printed documents if your template uses the `{{companyLogoPath}}` merge field

### Company Cards Display

Each company card shows:
- Company name and brand name
- Address and phone
- NTN and STRN numbers
- Challan number range (Starting # and Current #)
- Invoice number range (Starting # and Current #)
- Company logo (if uploaded)

---

## 4. Adding Clients

Clients are the customers you deliver goods to. Each client belongs to one company.

### Creating a New Client

1. Go to **Configuration > Clients List** in the sidebar
2. Use the **company dropdown** at the top to select which company this client belongs to
3. Click the **+ New Client** button (top right)
4. Fill in the client details:

| Field | Required? | Description |
|-------|-----------|-------------|
| Name | Yes | Client/customer name |
| Address | No | Delivery address |
| Phone | No | Contact number |
| Email | No | Email address |
| NTN | No* | Client's National Tax Number |
| STRN | No* | Client's Sales Tax Registration Number |
| Site | No | Default delivery site/location |

**FBR Fields** (needed for FBR Digital Invoicing):

| Field | When Required | Description |
|-------|--------------|-------------|
| Registration Type | For FBR | "Registered", "Unregistered", or "CNIC" |
| CNIC | If Unregistered/CNIC | Client's 13-digit CNIC number |
| Province | For FBR | Client's province (Punjab, Sindh, KPK, etc.) |

5. Click **Save**

### Client Cards Display

Each client card shows the client name, address, NTN, STRN, site, and action buttons for Edit and Delete.

> **Note:** You cannot delete a client that has existing delivery challans. Remove the challans first.

---

## 5. Creating Delivery Challans

A **Delivery Challan** (DC) is a document that records what items were delivered to a client. It is the starting point for the invoicing process.

### Creating a New Challan

1. Go to **Challans** in the sidebar
2. Select the **company** from the dropdown at the top
3. Click the **+ New Challan** button (top right)
4. Fill in the challan form:

| Field | Required? | Description |
|-------|-----------|-------------|
| Client | Yes | Select the client (dropdown lists all clients for this company) |
| PO Number | No | Purchase Order reference number |
| PO Date | No | Date of the purchase order |
| Delivery Date | No | When the goods were/will be delivered |
| Site | No | Delivery location (auto-fills from client's default site) |

5. **Add Items** -- for each line item, fill in:
   - **Item Type** -- select a category (optional)
   - **Description** -- what was delivered (autocomplete suggests from previous entries)
   - **Quantity** -- how many
   - **Unit** -- unit of measure (e.g., pcs, kg, meters -- autocomplete suggests from previous entries)

6. Click the **+ Add Item** button to add more line items
7. Click **Save** to create the challan

> **The challan number is auto-generated.** It takes the next number in sequence for that company. You do not choose it yourself.

### Viewing Challans

The Challans page shows all challans as cards in a grid layout. Each card displays:
- **Challan number** (e.g., Challan #44556)
- **Status badge** (colored label showing current status)
- **Client name**
- **PO number and date**
- **Delivery date**
- **Number of items**

### Filtering Challans

Use the filter bar at the top to narrow down challans:
- **Search box** -- search by challan number, client name, or PO number
- **Status dropdown** -- filter by All Status, Pending, Invoiced, Cancelled, etc.
- **Client dropdown** -- show challans for a specific client only
- **Date range** -- filter by delivery date range

### Actions Available on Challans

Depending on the challan's status, different buttons appear:

| Button | What It Does |
|--------|-------------|
| **View** | Open challan details in a popup |
| **Print** | Open print preview of the challan |
| **PDF** | Download challan as PDF |
| **Excel** | Download challan as Excel file |
| **Edit** | Edit items (only for editable challans) |
| **Cancel** | Mark challan as cancelled |
| **Delete** | Permanently remove the challan |

---

## 6. Understanding Challan Statuses

Every delivery challan has a **status** that controls what you can do with it. Understanding these statuses is key to using the system correctly.

### Status Flow Diagram

```
Create Challan
     |
     +--[FBR fields OK + has PO]--> PENDING ----> INVOICED
     |                                 |              |
     +--[FBR fields OK + no PO]---> NO PO           | (if invoice deleted)
     |                                |               v
     +--[FBR fields missing]----> SETUP REQUIRED   PENDING
     |
     +-- Any editable status ------> CANCELLED
```

### Status Descriptions

| Status | Color | Meaning | Can Edit? | Can Invoice? |
|--------|-------|---------|-----------|-------------|
| **Pending** | Green | Ready to be included in an invoice | Yes | **Yes** |
| **No PO** | Orange | Delivery done but PO details not yet entered | Yes | No |
| **Setup Required** | Yellow | Company or client is missing FBR fields (NTN, STRN, Province, etc.) | Yes | No |
| **Invoiced** | Blue | Already included in an invoice | No | N/A |
| **Cancelled** | Red | Cancelled by user | No | No |

### How Status is Determined

When you create a challan, the system automatically checks:

1. **Are all FBR fields filled?** The system checks both the company and client for: NTN, STRN, Province, Business Activity, Sector, FBR Token, FBR Environment (company side) and NTN, STRN, Registration Type, Province (client side).

2. Based on the check:
   - If FBR fields are **missing** --> Status = **Setup Required** (with a list of what's missing)
   - If FBR fields are **complete** and challan **has a PO number** --> Status = **Pending**
   - If FBR fields are **complete** but **no PO number** --> Status = **No PO**

### Moving Between Statuses

| From | To | How |
|------|----|-----|
| No PO | Pending | Add PO details (the system auto-checks FBR readiness) |
| Setup Required | Pending | Fill in the missing FBR fields on the company/client, then the system auto-updates |
| Setup Required | No PO | Fill FBR fields but still no PO number |
| Pending | Invoiced | Create an invoice that includes this challan |
| Invoiced | Pending | Delete the invoice (challan reverts back) |
| Any editable | Cancelled | Click the Cancel button |

### When Can You Invoice?

**Only challans with "Pending" status can be selected for invoicing.** This means:
- The challan must have a PO number
- The company must have all FBR fields filled
- The client must have all FBR fields filled

If a challan shows "Setup Required", check the warnings (yellow text) on the challan card -- they tell you exactly which fields are missing.

---

## 7. Importing a Purchase Order (PO)

Instead of manually entering challan items one by one, you can import them directly from a Purchase Order document.

### Two Ways to Import

1. **Upload a PDF** -- Upload the PO as a PDF file
2. **Paste Text** -- Copy-paste the PO text from email, Word document, etc.

### How to Import a PO

1. Go to **Challans** in the sidebar
2. Click the **Import PO** button (top right, next to New Challan)
3. Choose your import method:

**PDF Upload:**
- Click "Upload PDF"
- Select your PO file (maximum 10 MB)
- Wait for the system to process it

**Text Paste:**
- Click "Paste Text"
- Paste the PO content into the text box
- Click "Parse"

4. The system will extract:
   - **PO Number** (if found)
   - **PO Date** (if found)
   - **Line Items** -- description, quantity, and unit for each item

5. Review the extracted data -- you can edit any field before saving
6. Click **Create Challan** to generate the delivery challan with these items

### How the AI Parser Works

The system uses **Google Gemini AI** to intelligently read PO documents:
- For **PDFs**: AI reads the document first. If AI is unavailable, falls back to pattern-based extraction
- For **pasted text**: Uses pattern matching first (usually works well for structured text). Falls back to AI if no items found

> **Tip:** If the parser misses some items, try the "Paste Text" option -- copy the relevant portion of the PO and paste it. Structured text is easier to parse accurately.

---

## 8. Creating Invoices

Invoices are generated from one or more **Pending** delivery challans. The system bundles the delivery items and lets you set prices.

### Creating a New Invoice

1. Go to **Invoices** in the sidebar
2. Select the **company** from the dropdown
3. Click the **+ New Invoice** button (top right)
4. The invoice creation form opens:

**Step 1: Select Challans**
- You will see a list of all **Pending** challans for this company
- **Check the boxes** next to the challans you want to include
- All selected challans must be for the **same client** (the system filters automatically)

**Step 2: Set Prices**
- For each delivery item, enter the **Unit Price**
- The system auto-calculates:
  - **Line Total** = Quantity x Unit Price
  - **Subtotal** = Sum of all line totals
  - **GST Amount** = Subtotal x GST Rate / 100
  - **Grand Total** = Subtotal + GST Amount
  - **Amount in Words** (e.g., "Fifty Thousand and 00/100")

**Step 3: Invoice Details**

| Field | Required? | Description |
|-------|-----------|-------------|
| Invoice Date | Yes | Date of the invoice |
| GST Rate | Yes | GST percentage (0-100%) |
| Payment Terms | No | e.g., "Net 30 days", "Due on Receipt" |
| Document Type | No | FBR document type (Sale Invoice, Debit Note, Credit Note) |
| Payment Mode | No | Payment method (Cash, Bank Transfer, etc.) |

5. Click **Create Invoice**

### What Happens When You Create an Invoice

- The invoice is saved with the next auto-generated invoice number
- All selected challans change from **Pending** to **Invoiced**
- The items, prices, and GST calculations are locked in
- New item descriptions are automatically saved for future autocomplete

### Invoice Cards Display

Each invoice card on the Invoices page shows:
- **Invoice number** (e.g., Invoice #43461)
- **Client name**
- **Invoice date**
- **Grand Total** (in Pakistani Rupees)
- **Challan numbers** that are included (e.g., DC#44556)
- **Number of items**
- Action buttons: Bill, Bill PDF, Bill XLS, Delete

### Deleting an Invoice

- Click the **Delete** button on an invoice card
- Confirm the deletion
- The linked challans revert back to **Pending** status (so you can re-invoice them)

> **Important:** You cannot delete an invoice that has been submitted to FBR.

---

## 9. Printing & Exporting Documents

### Challan Documents

From any challan card, you have these print/export options:

| Button | Format | Description |
|--------|--------|-------------|
| **Print** | Browser print | Opens print preview in browser |
| **PDF** | PDF download | Generates and downloads a PDF file |
| **Excel** | XLSX download | Exports to Excel using uploaded template |

### Invoice Documents

From any invoice card:

| Button | Format | Description |
|--------|--------|-------------|
| **Bill** | Browser print | Business invoice (for the client) |
| **Bill PDF** | PDF download | Business invoice as PDF |
| **Bill XLS** | XLSX download | Business invoice as Excel |

> **Note:** Tax Invoice printing (with FBR details) is available from the invoice detail view.

### Print Templates

All printed documents use customizable HTML templates. Each company can have its own unique template design for:
1. **Challan** -- Delivery challan format
2. **Bill** -- Business invoice format
3. **Tax Invoice** -- FBR-compliant tax invoice format

See [Customizing Print Templates](#10-customizing-print-templates) for how to edit these.

---

## 10. Customizing Print Templates

The Template Editor lets you design how your printed documents look.

### Accessing the Template Editor

1. Go to **Configuration > Print Templates** in the sidebar
2. Select the **company** from the first dropdown
3. Select the **template type** from the second dropdown:
   - Delivery Challan
   - Bill
   - Tax Invoice

### Two Editor Modes

**Code Editor** (default):
- Write HTML and CSS directly
- Full control over the layout
- On the left panel, you see available **Merge Fields** organized by category (Company, Document, Client, Items)
- Click a merge field to copy it, then paste it into your HTML

**Visual Editor**:
- Drag-and-drop interface (GrapesJS)
- Click the **Visual** button to switch
- Add text blocks, images, tables by dragging from the left panel
- Double-click text to edit it and insert merge fields

### Merge Fields

Merge fields are placeholders that get replaced with real data when printing. They look like `{{fieldName}}`.

**Common merge fields:**

| Field | Replaced With |
|-------|--------------|
| `{{companyBrandName}}` | Company brand name |
| `{{companyLogoPath}}` | Company logo image URL |
| `{{{nl2br companyAddress}}}` | Company address (with line breaks) |
| `{{clientName}}` | Client name |
| `{{challanNumber}}` | Challan number |
| `{{invoiceNumber}}` | Invoice number |
| `{{fmtDate deliveryDate}}` | Formatted delivery date |
| `{{poNumber}}` | PO number |
| `{{subtotal}}` | Invoice subtotal |
| `{{gstRate}}` | GST percentage |
| `{{grandTotal}}` | Invoice grand total |
| `{{amountInWords}}` | Total in words |

**For item rows** (used inside `{{#each items}}...{{/each}}`):

| Field | Replaced With |
|-------|--------------|
| `{{description}}` | Item description |
| `{{quantity}}` | Quantity |
| `{{unit}}` | Unit of measure |
| `{{unitPrice}}` | Price per unit |
| `{{lineTotal}}` | Quantity x Unit Price |

### Excel Templates

You can also upload an Excel template (.xlsx or .xlsm) for each template type:

1. In the Template Editor, you'll see "Excel Template: UPLOADED" or a button to upload
2. Click **Upload** to select your Excel template file
3. The system fills named cells with data when you click "Excel" on a challan/invoice

### Saving Templates

- Click the **Save** button (top right, green) after making changes
- Use **Preview** tab to see how the template will look with sample data
- Use **Templates** button to load a pre-made starter template
- Use **Reset** to revert to the default template

---

## 11. FBR Digital Invoicing

The system integrates with Pakistan's **Federal Board of Revenue (FBR)** Digital Invoicing portal. This allows you to electronically submit invoices to FBR and receive an **Invoice Reference Number (IRN)**.

### Prerequisites for FBR

Before you can submit invoices to FBR, you need:

1. **Company registration** on the FBR IRIS portal
2. **API Token** from FBR (obtained after IRIS registration)
3. **IP Whitelisting** -- your server's IP must be registered with FBR
4. **Sandbox Testing** -- pass 28 test scenarios before going live

### Setting Up FBR - Company Side

1. Go to **Configuration > Companies List**
2. Click **Edit** on your company
3. Fill in the FBR fields:

| Field | Description |
|-------|-------------|
| **NTN** | Your National Tax Number (must match FBR registration) |
| **STRN** | Your Sales Tax Registration Number |
| **Province** | Select your province (Punjab, Sindh, KPK, etc.) |
| **Business Activity** | Manufacturer, Importer, Distributor, Wholesaler, etc. |
| **Sector** | Industry sector (Steel, FMCG, Textile, etc.) |
| **FBR Token** | Bearer token from FBR IRIS portal (paste it in) |
| **FBR Environment** | "Sandbox" for testing, "Production" for real submissions |

### Setting Up FBR - Client Side

1. Go to **Configuration > Clients List**
2. Click **Edit** on each client
3. Fill in:

| Field | Description |
|-------|-------------|
| **NTN** | Client's National Tax Number |
| **STRN** | Client's Sales Tax Registration Number |
| **Registration Type** | "Registered" (has STRN), "Unregistered", or "CNIC" |
| **CNIC** | Required if Registration Type is Unregistered or CNIC |
| **Province** | Client's province |

### FBR Settings Page

Go to **Configuration > FBR Settings** to manage FBR reference data:

- **Provinces** -- Pakistani provinces with FBR codes
- **Business Activity** -- Types of business activities
- **Sectors** -- Industry sectors
- **Document Types** -- Invoice, Debit Note, Credit Note
- **HS Codes** -- Harmonized System commodity codes
- **UOM** -- Units of Measure

You can add, edit, or delete values in each category. These appear as dropdown options throughout the system.

### Submitting an Invoice to FBR

1. Create an invoice normally (see [Creating Invoices](#8-creating-invoices))
2. Make sure all FBR fields are filled on the company and client
3. Open the invoice detail view
4. Click **Validate with FBR** (optional dry run)
5. Click **Submit to FBR**
6. If successful:
   - You receive an **IRN** (Invoice Reference Number)
   - The FBR status changes to "Submitted"
   - The IRN appears on printed invoices
7. If it fails:
   - An error message shows what went wrong
   - Fix the issue and try again

### FBR Status Values

| Status | Meaning |
|--------|---------|
| (none) | Not yet submitted to FBR |
| Draft | Validated but not submitted |
| Submitted | Successfully submitted, IRN received |
| Accepted | FBR accepted the invoice |
| Rejected | FBR rejected -- check error message |

---

## 12. Managing Users

Only **Admin** users can manage other users. Go to **Users** in the sidebar.

### User List

The Users page shows all registered users with their:
- Avatar/profile picture
- Full name
- Username
- Role badge (Admin)
- Join date

### Adding a New User

1. Click **+ Add User** (top right)
2. Fill in:
   - **Username** -- login name (must be unique)
   - **Full Name** -- display name
   - **Password** -- minimum 6 characters
   - **Role** -- Admin (currently the only role)
3. Click **Save**

### Editing a User

- Hover over a user card and click **Edit**
- Change username, full name, or role
- Click **Save**

### Deleting a User

- Hover over a user card and click **Delete**
- Confirm the deletion

> **Important:**
> - You cannot delete the default admin user (ID 1)
> - You cannot delete yourself
> - You cannot change the default admin user's role

---

## 13. Your Profile

Go to **My Profile** in the sidebar (bottom left) to manage your account.

### Profile Page Shows

- Your avatar (with upload option)
- Your full name and username
- Your role

### Updating Your Profile

1. Click the **Edit** button next to "Profile Details"
2. Change your username or full name
3. Click **Save**

### Changing Your Password

1. Scroll down to find the "Change Password" section
2. Enter your **Current Password**
3. Enter your **New Password** (minimum 6 characters)
4. Click **Change Password**

### Uploading an Avatar

1. Click the **Upload Photo** button
2. Select an image file (JPG, PNG, or WebP, max 7 MB)
3. Your new avatar appears immediately and shows in the sidebar and top-right corner

---

## 14. Audit Logs

Audit Logs track all system errors and warnings. Only **Admin** users can view them. Go to **Audit Logs** in the sidebar.

### What's Shown

Each log entry shows:
- **Time** -- when it happened
- **Level** -- Warning (yellow) or Error (red)
- **Method** -- HTTP method (GET, POST, PUT, DELETE)
- **Path** -- which API endpoint was called
- **Status** -- HTTP status code (e.g., 404, 500)
- **User** -- who triggered it
- **Message** -- what went wrong

### Summary Badges

At the top right, you see:
- **X errors (24h)** -- number of errors in the last 24 hours
- **X warnings (24h)** -- number of warnings in the last 24 hours

### Filtering Logs

- **Level dropdown** -- filter by All Levels, Error only, or Warning only
- **Search box** -- search by path, message, or user
- Click **Search** to apply filters

### When to Check Audit Logs

- When something isn't working as expected
- When a page shows an error message
- When FBR submission fails
- To monitor system health

---

## 15. Quick Reference

### Complete Application Flow

```
1. Set up Company (with NTN, STRN, FBR fields)
          |
2. Add Clients (with NTN, STRN, FBR fields)
          |
3. Create Delivery Challans (with items)
     or Import from PO (PDF/text)
          |
4. Challan becomes "Pending" when ready
          |
5. Create Invoice (select pending challans, set prices)
          |
6. Print/Export (Bill, Tax Invoice, PDF, Excel)
          |
7. Submit to FBR (optional, receive IRN)
```

### Status Quick Reference

| Want to... | Challan Must Be... |
|-----------|-------------------|
| Edit items | Pending, No PO, or Setup Required |
| Add PO details | No PO or Setup Required |
| Include in invoice | **Pending only** |
| Print/export | Any status |
| Cancel | Pending, No PO, or Setup Required |
| Delete | Pending, No PO, or Setup Required |

### Common Workflows

**"I delivered goods and want to record it"**
1. Go to Challans > + New Challan
2. Select client, add items, save

**"I received a PO and want to create a challan from it"**
1. Go to Challans > Import PO
2. Upload PDF or paste text
3. Review extracted items > Create Challan

**"I want to bill a client for deliveries"**
1. Go to Invoices > + New Invoice
2. Select the pending challans
3. Enter unit prices and GST rate
4. Create Invoice > Print Bill

**"Challan says Setup Required"**
1. Check the warning messages on the challan
2. Go to the company or client edit form
3. Fill in the missing FBR fields (NTN, STRN, Province, etc.)
4. Return to challans -- status will auto-update

**"I need to change an invoice"**
1. Delete the existing invoice (challans revert to Pending)
2. Create a new invoice with the corrections

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Enter | Submit forms |
| Esc | Close modals/popups |
| Tab | Move to next field |

### Troubleshooting

| Problem | Solution |
|---------|----------|
| "Session expired" message | Log in again (sessions last 8 hours) |
| Cannot delete a client | The client has challans -- delete or re-assign them first |
| Cannot delete an invoice | The invoice was submitted to FBR -- FBR submissions are permanent |
| Challan stuck on "Setup Required" | Check warnings -- fill missing FBR fields on company/client |
| PO import shows no items | Try pasting text instead of PDF, or vice versa |
| Print looks wrong | Check the Print Template editor -- ensure merge fields are correct |
| FBR submission fails | Check Audit Logs for details, verify token and FBR environment setting |

---

*This guide covers the MyApp ERP system version 2.0. For technical documentation, see [TECHNICAL_SPEC.md](TECHNICAL_SPEC.md).*

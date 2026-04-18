"""
Generate USER_GUIDE.pdf with embedded screenshots from the running app.
Uses Playwright for screenshots and ReportLab for PDF generation.
"""
import os
import time
from playwright.sync_api import sync_playwright
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch, mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable
)

BASE_URL = "http://localhost:5134"
SCREENSHOT_DIR = os.path.join(os.path.dirname(__file__), "..", "docs", "screenshots")
OUTPUT_PDF = os.path.join(os.path.dirname(__file__), "..", "docs", "USER_GUIDE.pdf")

os.makedirs(SCREENSHOT_DIR, exist_ok=True)
os.makedirs(os.path.dirname(OUTPUT_PDF), exist_ok=True)

# ── Step 1: Take screenshots ──────────────────────────────────────────────

PAGES = [
    ("01_login", "/login", "Login Page", False),
    ("02_dashboard", "/dashboard", "Dashboard", True),
    ("03_companies", "/companies", "Companies", True),
    ("04_clients", "/Clients/list", "Clients List", True),
    ("05_challans", "/challans", "Delivery Challans", True),
    ("06_invoices", "/invoices", "Invoices", True),
    ("07_templates", "/templates", "Print Templates", True),
    ("08_users", "/users", "User Management", True),
    ("09_audit_logs", "/audit-logs", "Audit Logs", True),
    ("10_profile", "/profile", "My Profile", True),
    ("11_fbr_settings", "/fbr-settings", "FBR Settings", True),
    ("12_item_types", "/item-types", "Item Types", True),
]

def take_screenshots():
    print("Taking screenshots...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()

        # Login first
        page.goto(f"{BASE_URL}/login")
        page.wait_for_load_state("networkidle")
        time.sleep(1)

        # Screenshot login page before logging in
        path = os.path.join(SCREENSHOT_DIR, "01_login.png")
        page.screenshot(path=path, full_page=False)
        print(f"  Saved: {path}")

        # Now login
        page.fill('input[placeholder="Username"]', "admin")
        page.fill('input[placeholder="Password"]', "admin123")
        page.click('button[type="submit"]')
        page.wait_for_load_state("networkidle")
        time.sleep(2)

        # Take remaining screenshots
        for filename, url_path, label, needs_auth in PAGES:
            if filename == "01_login":
                continue  # already done
            full_url = f"{BASE_URL}{url_path}"
            print(f"  Navigating to {full_url} ({label})...")
            page.goto(full_url)
            page.wait_for_load_state("networkidle")
            time.sleep(1.5)
            path = os.path.join(SCREENSHOT_DIR, f"{filename}.png")
            page.screenshot(path=path, full_page=False)
            print(f"  Saved: {path}")

        browser.close()
    print("All screenshots taken!\n")


# ── Step 2: Build PDF ─────────────────────────────────────────────────────

PRIMARY = HexColor("#1a3a5c")
ACCENT = HexColor("#2563eb")
LIGHT_BG = HexColor("#f0f4f8")
TABLE_HEADER_BG = HexColor("#1e40af")
TABLE_ALT_BG = HexColor("#eff6ff")

def get_styles():
    styles = getSampleStyleSheet()

    styles.add(ParagraphStyle(
        "DocTitle", parent=styles["Title"],
        fontSize=28, textColor=PRIMARY, spaceAfter=6, alignment=TA_CENTER
    ))
    styles.add(ParagraphStyle(
        "DocSubtitle", parent=styles["Normal"],
        fontSize=12, textColor=HexColor("#64748b"), alignment=TA_CENTER, spaceAfter=20
    ))
    styles.add(ParagraphStyle(
        "SectionTitle", parent=styles["Heading1"],
        fontSize=20, textColor=PRIMARY, spaceBefore=24, spaceAfter=10,
        borderWidth=0, borderPadding=0
    ))
    styles.add(ParagraphStyle(
        "SubSection", parent=styles["Heading2"],
        fontSize=14, textColor=ACCENT, spaceBefore=14, spaceAfter=6
    ))
    styles.add(ParagraphStyle(
        "BodyText2", parent=styles["Normal"],
        fontSize=10, leading=14, spaceAfter=6
    ))
    styles.add(ParagraphStyle(
        "Caption", parent=styles["Normal"],
        fontSize=9, textColor=HexColor("#64748b"), alignment=TA_CENTER,
        spaceBefore=4, spaceAfter=12, italic=True
    ))
    styles.add(ParagraphStyle(
        "TableHeader", parent=styles["Normal"],
        fontSize=9, textColor=white, alignment=TA_LEFT, leading=12
    ))
    styles.add(ParagraphStyle(
        "TableCell", parent=styles["Normal"],
        fontSize=9, leading=12
    ))
    styles.add(ParagraphStyle(
        "Tip", parent=styles["Normal"],
        fontSize=9, leading=13, leftIndent=12, borderWidth=1,
        borderColor=ACCENT, borderPadding=8, backColor=HexColor("#eff6ff"),
        spaceAfter=10
    ))
    styles.add(ParagraphStyle(
        "BulletItem", parent=styles["Normal"],
        fontSize=10, leading=14, leftIndent=20, bulletIndent=8, spaceAfter=3
    ))
    return styles

def add_screenshot(story, filename, caption, styles, width=6.5*inch):
    path = os.path.join(SCREENSHOT_DIR, f"{filename}.png")
    if os.path.exists(path):
        img = Image(path, width=width, height=width * 0.56)
        img.hAlign = "CENTER"
        story.append(img)
        story.append(Paragraph(caption, styles["Caption"]))
    else:
        story.append(Paragraph(f"[Screenshot: {caption}]", styles["Caption"]))

def make_table(headers, rows, styles, col_widths=None):
    data = [[Paragraph(f"<b>{h}</b>", styles["TableHeader"]) for h in headers]]
    for row in rows:
        data.append([Paragraph(str(c), styles["TableCell"]) for c in row])

    if not col_widths:
        col_widths = [6.5 * inch / len(headers)] * len(headers)

    t = Table(data, colWidths=col_widths, repeatRows=1)
    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("ALIGN", (0, 0), (-1, 0), "LEFT"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
        ("TOPPADDING", (0, 0), (-1, 0), 8),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 5),
        ("TOPPADDING", (0, 1), (-1, -1), 5),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), TABLE_ALT_BG))
    t.setStyle(TableStyle(style_cmds))
    return t

def hr():
    return HRFlowable(width="100%", thickness=1, color=HexColor("#e2e8f0"), spaceAfter=10, spaceBefore=10)

def build_pdf():
    print("Building PDF...")
    styles = get_styles()
    s = styles

    doc = SimpleDocTemplate(
        OUTPUT_PDF, pagesize=A4,
        leftMargin=0.75*inch, rightMargin=0.75*inch,
        topMargin=0.6*inch, bottomMargin=0.6*inch,
        title="MyApp ERP - User Guide",
        author="Hakimi Traders"
    )

    story = []

    # ── Cover ──
    story.append(Spacer(1, 1.5*inch))
    story.append(Paragraph("MyApp ERP", s["DocTitle"]))
    story.append(Paragraph("User Guide", ParagraphStyle(
        "CoverSub", parent=s["DocTitle"], fontSize=22, textColor=ACCENT, spaceAfter=12
    )))
    story.append(Paragraph("Delivery Challan & Invoicing System with FBR Integration", s["DocSubtitle"]))
    story.append(Spacer(1, 0.5*inch))
    story.append(hr())
    story.append(Paragraph("Version 2.0 &nbsp;&bull;&nbsp; April 2026", s["DocSubtitle"]))
    story.append(PageBreak())

    # ── Table of Contents ──
    story.append(Paragraph("Table of Contents", s["SectionTitle"]))
    toc_items = [
        "1. Logging In", "2. Dashboard Overview", "3. Setting Up a Company",
        "4. Adding Clients", "5. Creating Delivery Challans",
        "6. Understanding Challan Statuses", "7. Importing a Purchase Order (PO)",
        "8. Creating Invoices", "9. Printing & Exporting Documents",
        "10. Customizing Print Templates", "11. FBR Digital Invoicing",
        "12. Managing Users", "13. Your Profile", "14. Audit Logs",
        "15. Quick Reference"
    ]
    for item in toc_items:
        story.append(Paragraph(f"&bull;&nbsp; {item}", s["BodyText2"]))
    story.append(PageBreak())

    # ── 1. Logging In ──
    story.append(Paragraph("1. Logging In", s["SectionTitle"]))
    story.append(Paragraph(
        "When you open the application, you will see the login screen with the company "
        "branding on the left and a login form on the right.", s["BodyText2"]))
    add_screenshot(story, "01_login", "Figure 1: Login Page", s)

    story.append(Paragraph("<b>How to log in:</b>", s["BodyText2"]))
    for step in [
        "1. Enter your <b>Username</b> in the first field",
        "2. Enter your <b>Password</b> in the second field (click the eye icon to show/hide)",
        "3. Click the <b>Login</b> button",
    ]:
        story.append(Paragraph(step, s["BulletItem"]))

    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "<b>Tip:</b> Default login is <b>admin / admin123</b>. "
        "Change this immediately after first login from My Profile.", s["Tip"]))
    story.append(Paragraph(
        "Your login session lasts <b>8 hours</b>, after which you will need to log in again.",
        s["BodyText2"]))

    # ── 2. Dashboard ──
    story.append(PageBreak())
    story.append(Paragraph("2. Dashboard Overview", s["SectionTitle"]))
    story.append(Paragraph(
        "The Dashboard is your home screen. It shows a quick summary of your business at a glance.",
        s["BodyText2"]))
    add_screenshot(story, "02_dashboard", "Figure 2: Dashboard with overview cards and quick actions", s)

    story.append(Paragraph("<b>What you see:</b>", s["BodyText2"]))
    for item in [
        "<b>Welcome banner</b> with your name and today's date",
        "<b>Company filter</b> dropdown to filter counts by company",
        "<b>Overview cards:</b> Companies, Clients, Challans, Invoices totals",
        "<b>Quick Actions:</b> Shortcut cards to jump to any section",
    ]:
        story.append(Paragraph(f"&bull;&nbsp; {item}", s["BulletItem"]))

    story.append(Spacer(1, 8))
    story.append(Paragraph("Sidebar Navigation", s["SubSection"]))
    story.append(make_table(
        ["Section", "Pages"],
        [
            ["Main", "Dashboard"],
            ["Configuration", "Companies, Clients, Item Types, Print Templates, FBR Settings"],
            ["Management", "Challans, Invoices"],
            ["Admin", "Users, Audit Logs"],
            ["Account", "My Profile, Logout"],
        ], s, col_widths=[1.5*inch, 5*inch]
    ))

    # ── 3. Companies ──
    story.append(PageBreak())
    story.append(Paragraph("3. Setting Up a Company", s["SectionTitle"]))
    story.append(Paragraph(
        "Before you can create challans or invoices, you need to register at least one company. "
        "Go to <b>Configuration &gt; Companies List</b> in the sidebar.", s["BodyText2"]))
    add_screenshot(story, "03_companies", "Figure 3: Companies List showing registered companies", s)

    story.append(Paragraph("Creating a New Company", s["SubSection"]))
    story.append(Paragraph(
        "Click the <b>+ New Company</b> button (top right). Fill in the form:", s["BodyText2"]))
    story.append(make_table(
        ["Field", "Required?", "Description"],
        [
            ["Company Name", "Yes", "Legal name of the business"],
            ["Brand Name", "No", "Trade name if different from legal name"],
            ["Full Address", "No", "Complete business address"],
            ["Phone", "No", "Contact number"],
            ["NTN", "For FBR", "National Tax Number"],
            ["STRN", "For FBR", "Sales Tax Registration Number"],
            ["Starting Challan #", "Yes", "First challan number (e.g., 1001)"],
            ["Starting Invoice #", "Yes", "First invoice number (e.g., 5001)"],
            ["Invoice Prefix", "No", 'Optional prefix (e.g., "INV-" makes INV-5001)'],
        ], s, col_widths=[1.5*inch, 1*inch, 4*inch]
    ))

    # ── 4. Clients ──
    story.append(PageBreak())
    story.append(Paragraph("4. Adding Clients", s["SectionTitle"]))
    story.append(Paragraph(
        "Clients are the customers you deliver goods to. Each client belongs to one company. "
        "Go to <b>Configuration &gt; Clients List</b>.", s["BodyText2"]))
    add_screenshot(story, "04_clients", "Figure 4: Clients List for a selected company", s)

    story.append(Paragraph(
        "Select the company from the dropdown, then click <b>+ New Client</b>.", s["BodyText2"]))
    story.append(make_table(
        ["Field", "Required?", "Description"],
        [
            ["Name", "Yes", "Client/customer name"],
            ["Address", "No", "Delivery address"],
            ["Phone / Email", "No", "Contact details"],
            ["NTN / STRN", "For FBR", "Tax registration numbers"],
            ["Site", "No", "Default delivery site"],
            ["Registration Type", "For FBR", "Registered / Unregistered / CNIC"],
            ["CNIC", "If Unregistered", "13-digit CNIC number"],
            ["Province", "For FBR", "Client's province (Punjab, Sindh, etc.)"],
        ], s, col_widths=[1.5*inch, 1*inch, 4*inch]
    ))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "<b>Note:</b> You cannot delete a client that has existing delivery challans.", s["Tip"]))

    # ── 5. Challans ──
    story.append(PageBreak())
    story.append(Paragraph("5. Creating Delivery Challans", s["SectionTitle"]))
    story.append(Paragraph(
        "A <b>Delivery Challan</b> (DC) is a document that records what items were delivered "
        "to a client. It is the starting point for invoicing.", s["BodyText2"]))
    add_screenshot(story, "05_challans",
        "Figure 5: Challans page with status badges (Invoiced, Pending, Cancelled)", s)

    story.append(Paragraph("Creating a New Challan", s["SubSection"]))
    for step in [
        '1. Go to <b>Challans</b> in the sidebar, select the company',
        '2. Click <b>+ New Challan</b>',
        '3. Select the <b>Client</b>, enter PO Number, PO Date, Delivery Date',
        '4. Add items: Description (autocomplete), Quantity, Unit',
        '5. Click <b>+ Add Item</b> for more lines, then <b>Save</b>',
    ]:
        story.append(Paragraph(step, s["BulletItem"]))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "<b>Tip:</b> The challan number is auto-generated. It takes the next number "
        "in the company's sequence.", s["Tip"]))

    story.append(Paragraph("Challan Actions", s["SubSection"]))
    story.append(make_table(
        ["Button", "What It Does"],
        [
            ["View", "Open challan details in a popup"],
            ["Print", "Open print preview in browser"],
            ["PDF", "Download as PDF file"],
            ["Excel", "Export to Excel using uploaded template"],
            ["Edit", "Edit items (only for editable challans)"],
            ["Cancel", "Mark as cancelled"],
            ["Delete", "Permanently remove the challan"],
        ], s, col_widths=[1.5*inch, 5*inch]
    ))

    # ── 6. Statuses ──
    story.append(PageBreak())
    story.append(Paragraph("6. Understanding Challan Statuses", s["SectionTitle"]))
    story.append(Paragraph(
        "Every challan has a <b>status</b> that controls what you can do with it. "
        "This is the most important concept in the system.", s["BodyText2"]))

    story.append(make_table(
        ["Status", "Color", "Meaning", "Can Edit?", "Can Invoice?"],
        [
            ["Pending", "Green", "Ready to be included in an invoice", "Yes", "YES"],
            ["No PO", "Orange", "Delivery done but PO not yet entered", "Yes", "No"],
            ["Setup Required", "Yellow", "Company/client missing FBR fields", "Yes", "No"],
            ["Invoiced", "Blue", "Already included in an invoice", "No", "N/A"],
            ["Cancelled", "Red", "Cancelled by user", "No", "No"],
        ], s, col_widths=[1.1*inch, 0.7*inch, 2.2*inch, 0.8*inch, 1.0*inch]
    ))

    story.append(Spacer(1, 8))
    story.append(Paragraph("How Status is Determined", s["SubSection"]))
    story.append(Paragraph("When you create a challan, the system automatically checks:", s["BodyText2"]))
    for item in [
        "If FBR fields are <b>missing</b> on company or client &rarr; <b>Setup Required</b>",
        "If FBR fields are complete and challan <b>has a PO</b> &rarr; <b>Pending</b>",
        "If FBR fields are complete but <b>no PO</b> &rarr; <b>No PO</b>",
    ]:
        story.append(Paragraph(f"&bull;&nbsp; {item}", s["BulletItem"]))

    story.append(Spacer(1, 8))
    story.append(Paragraph("When Can You Invoice?", s["SubSection"]))
    story.append(Paragraph(
        "<b>Only challans with 'Pending' status can be selected for invoicing.</b> "
        "This means the challan must have a PO number, and both the company and client "
        "must have all FBR fields filled (NTN, STRN, Province, etc.).", s["BodyText2"]))
    story.append(Paragraph(
        "<b>Tip:</b> If a challan shows 'Setup Required', check the warnings on the "
        "challan card -- they tell you exactly which fields are missing.", s["Tip"]))

    story.append(Paragraph("Moving Between Statuses", s["SubSection"]))
    story.append(make_table(
        ["From", "To", "How"],
        [
            ["No PO", "Pending", "Add PO details (system auto-checks FBR readiness)"],
            ["Setup Required", "Pending", "Fill missing FBR fields on company/client"],
            ["Pending", "Invoiced", "Create an invoice that includes this challan"],
            ["Invoiced", "Pending", "Delete the invoice (challan reverts)"],
            ["Any editable", "Cancelled", "Click the Cancel button"],
        ], s, col_widths=[1.3*inch, 1.3*inch, 3.9*inch]
    ))

    # ── 7. PO Import ──
    story.append(PageBreak())
    story.append(Paragraph("7. Importing a Purchase Order (PO)", s["SectionTitle"]))
    story.append(Paragraph(
        "Instead of entering items manually, you can import them from a PO document. "
        "Click <b>Import PO</b> on the Challans page.", s["BodyText2"]))

    story.append(Paragraph("Two Ways to Import", s["SubSection"]))
    story.append(make_table(
        ["Method", "How", "Best For"],
        [
            ["Upload PDF", "Click Upload, select file (max 10MB)", "PDF purchase orders"],
            ["Paste Text", "Copy-paste PO text, click Parse", "Email/Word PO text"],
        ], s, col_widths=[1.3*inch, 2.7*inch, 2.5*inch]
    ))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "The system uses <b>Google Gemini AI</b> to read PDFs and extract PO number, date, "
        "and line items. For pasted text, it uses pattern matching first (faster and more "
        "accurate for structured text), with AI as fallback.", s["BodyText2"]))
    story.append(Paragraph(
        "<b>Tip:</b> If PDF parsing misses items, try copying the text and using Paste Text instead.",
        s["Tip"]))

    # ── 8. Invoices ──
    story.append(PageBreak())
    story.append(Paragraph("8. Creating Invoices", s["SectionTitle"]))
    story.append(Paragraph(
        "Invoices are generated from one or more <b>Pending</b> delivery challans. "
        "The system bundles delivery items and lets you set prices.", s["BodyText2"]))
    add_screenshot(story, "06_invoices",
        "Figure 6: Invoices page showing bills with grand totals and linked challans", s)

    story.append(Paragraph("Creating a New Invoice", s["SubSection"]))
    for step in [
        '1. Go to <b>Invoices</b>, select company, click <b>+ New Invoice</b>',
        '2. <b>Select challans</b> -- check boxes next to Pending challans (same client)',
        '3. <b>Set prices</b> -- enter Unit Price for each item',
        '4. <b>Set GST rate</b> (0-100%) and optional Payment Terms',
        '5. System calculates: Subtotal, GST Amount, Grand Total, Amount in Words',
        '6. Click <b>Create Invoice</b>',
    ]:
        story.append(Paragraph(step, s["BulletItem"]))

    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "When an invoice is created, all selected challans change from <b>Pending</b> "
        "to <b>Invoiced</b>. The invoice number is auto-generated.", s["BodyText2"]))
    story.append(Paragraph(
        "<b>Important:</b> To correct an invoice, delete it (challans revert to Pending) "
        "and create a new one. You cannot delete FBR-submitted invoices.", s["Tip"]))

    # ── 9. Printing ──
    story.append(PageBreak())
    story.append(Paragraph("9. Printing & Exporting Documents", s["SectionTitle"]))
    story.append(Paragraph("Challan Documents", s["SubSection"]))
    story.append(make_table(
        ["Button", "Format", "Description"],
        [
            ["Print", "Browser", "Opens print preview"],
            ["PDF", "PDF file", "Downloads as PDF"],
            ["Excel", "XLSX file", "Exports using uploaded template"],
        ], s, col_widths=[1.3*inch, 1.2*inch, 4*inch]
    ))
    story.append(Spacer(1, 6))
    story.append(Paragraph("Invoice Documents", s["SubSection"]))
    story.append(make_table(
        ["Button", "Format", "Description"],
        [
            ["Bill", "Browser", "Business invoice preview"],
            ["Bill PDF", "PDF file", "Business invoice as PDF"],
            ["Bill XLS", "XLSX file", "Business invoice as Excel"],
        ], s, col_widths=[1.3*inch, 1.2*inch, 4*inch]
    ))

    # ── 10. Templates ──
    story.append(PageBreak())
    story.append(Paragraph("10. Customizing Print Templates", s["SectionTitle"]))
    story.append(Paragraph(
        "The Template Editor lets you design how printed documents look. "
        "Go to <b>Configuration &gt; Print Templates</b>.", s["BodyText2"]))
    add_screenshot(story, "07_templates",
        "Figure 7: Template Editor with merge fields panel and HTML code editor", s)

    story.append(Paragraph("Two Editor Modes", s["SubSection"]))
    for item in [
        "<b>Code Editor</b> -- Write HTML/CSS directly. Merge fields panel on the left.",
        "<b>Visual Editor</b> -- Drag-and-drop builder (GrapesJS). Click 'Visual' to switch.",
    ]:
        story.append(Paragraph(f"&bull;&nbsp; {item}", s["BulletItem"]))

    story.append(Spacer(1, 6))
    story.append(Paragraph("Common Merge Fields", s["SubSection"]))
    story.append(make_table(
        ["Merge Field", "Replaced With"],
        [
            ["{{companyBrandName}}", "Company brand name"],
            ["{{clientName}}", "Client name"],
            ["{{challanNumber}}", "Challan number"],
            ["{{invoiceNumber}}", "Invoice number"],
            ["{{fmtDate deliveryDate}}", "Formatted delivery date"],
            ["{{poNumber}}", "PO number"],
            ["{{grandTotal}}", "Invoice grand total"],
            ["{{amountInWords}}", "Total amount in words"],
            ["{{#each items}}...{{/each}}", "Loop over line items"],
        ], s, col_widths=[2.5*inch, 4*inch]
    ))

    # ── 11. FBR ──
    story.append(PageBreak())
    story.append(Paragraph("11. FBR Digital Invoicing", s["SectionTitle"]))
    story.append(Paragraph(
        "The system integrates with Pakistan's <b>Federal Board of Revenue (FBR)</b> "
        "Digital Invoicing portal to submit invoices electronically.", s["BodyText2"]))
    add_screenshot(story, "11_fbr_settings",
        "Figure 8: FBR Settings page with provinces, business activities, and sectors", s)

    story.append(Paragraph("FBR Setup - Company Side", s["SubSection"]))
    story.append(make_table(
        ["Field", "Description"],
        [
            ["NTN / STRN", "Must match FBR registration"],
            ["Province", "Select from dropdown (Punjab, Sindh, KPK, etc.)"],
            ["Business Activity", "Manufacturer, Importer, Distributor, etc."],
            ["Sector", "Industry sector (Steel, FMCG, Textile, etc.)"],
            ["FBR Token", "Bearer token from FBR IRIS portal"],
            ["FBR Environment", "'Sandbox' for testing, 'Production' for live"],
        ], s, col_widths=[1.5*inch, 5*inch]
    ))

    story.append(Spacer(1, 6))
    story.append(Paragraph("FBR Setup - Client Side", s["SubSection"]))
    story.append(make_table(
        ["Field", "Description"],
        [
            ["NTN / STRN", "Client's tax registration numbers"],
            ["Registration Type", "Registered, Unregistered, or CNIC"],
            ["CNIC", "Required if Unregistered/CNIC type"],
            ["Province", "Client's province"],
        ], s, col_widths=[1.5*inch, 5*inch]
    ))

    story.append(Spacer(1, 6))
    story.append(Paragraph("Submitting an Invoice to FBR", s["SubSection"]))
    for step in [
        '1. Create an invoice normally',
        '2. Ensure all FBR fields are filled on company and client',
        '3. Open the invoice, click <b>Validate with FBR</b> (optional dry run)',
        '4. Click <b>Submit to FBR</b>',
        '5. If successful: receive <b>IRN</b> (Invoice Reference Number)',
        '6. If failed: check error message, fix, and retry',
    ]:
        story.append(Paragraph(step, s["BulletItem"]))

    # ── 12. Users ──
    story.append(PageBreak())
    story.append(Paragraph("12. Managing Users", s["SectionTitle"]))
    story.append(Paragraph(
        "Only <b>Admin</b> users can manage other users. Go to <b>Users</b> in the sidebar.",
        s["BodyText2"]))
    add_screenshot(story, "08_users", "Figure 9: User Management page", s)

    story.append(Paragraph(
        "Click <b>+ Add User</b> to create a new user. Fill in username, full name, "
        "password (min 6 chars), and role.", s["BodyText2"]))
    story.append(Paragraph(
        "<b>Note:</b> You cannot delete the default admin user (ID 1) or yourself.",
        s["Tip"]))

    # ── 13. Profile ──
    story.append(Spacer(1, 12))
    story.append(Paragraph("13. Your Profile", s["SectionTitle"]))
    story.append(Paragraph(
        "Go to <b>My Profile</b> in the sidebar to manage your account.",
        s["BodyText2"]))
    add_screenshot(story, "10_profile", "Figure 10: Profile page with avatar and details", s)

    story.append(Paragraph(
        "From here you can: edit your username/full name, change your password, "
        "and upload an avatar (JPG/PNG/WebP, max 7 MB).", s["BodyText2"]))

    # ── 14. Audit Logs ──
    story.append(PageBreak())
    story.append(Paragraph("14. Audit Logs", s["SectionTitle"]))
    story.append(Paragraph(
        "Audit Logs track all system errors and warnings. Admin only. "
        "Go to <b>Audit Logs</b> in the sidebar.", s["BodyText2"]))
    add_screenshot(story, "09_audit_logs", "Figure 11: Audit Logs with filters and summary badges", s)

    story.append(Paragraph(
        "Filter by level (Error/Warning), search by path or user, "
        "and view summary badges showing 24-hour counts.", s["BodyText2"]))

    # ── 15. Quick Reference ──
    story.append(PageBreak())
    story.append(Paragraph("15. Quick Reference", s["SectionTitle"]))

    story.append(Paragraph("Complete Application Flow", s["SubSection"]))
    flow_steps = [
        "1. Set up Company (with NTN, STRN, FBR fields)",
        "2. Add Clients (with NTN, STRN, FBR fields)",
        "3. Create Delivery Challans (with items) or Import from PO",
        "4. Challan becomes 'Pending' when ready",
        "5. Create Invoice (select pending challans, set prices)",
        "6. Print / Export (Bill, Tax Invoice, PDF, Excel)",
        "7. Submit to FBR (optional, receive IRN)",
    ]
    for step in flow_steps:
        story.append(Paragraph(f"&bull;&nbsp; {step}", s["BulletItem"]))

    story.append(Spacer(1, 10))
    story.append(Paragraph("Status Quick Reference", s["SubSection"]))
    story.append(make_table(
        ["I Want To...", "Challan Must Be..."],
        [
            ["Edit items", "Pending, No PO, or Setup Required"],
            ["Add PO details", "No PO or Setup Required"],
            ["Include in invoice", "Pending ONLY"],
            ["Print / export", "Any status"],
            ["Cancel", "Pending, No PO, or Setup Required"],
            ["Delete", "Pending, No PO, or Setup Required"],
        ], s, col_widths=[2.5*inch, 4*inch]
    ))

    story.append(Spacer(1, 10))
    story.append(Paragraph("Troubleshooting", s["SubSection"]))
    story.append(make_table(
        ["Problem", "Solution"],
        [
            ["Session expired", "Log in again (sessions last 8 hours)"],
            ["Cannot delete client", "Client has challans -- remove them first"],
            ["Cannot delete invoice", "Invoice submitted to FBR -- permanent"],
            ["Challan stuck on Setup Required", "Check warnings, fill missing FBR fields"],
            ["PO import shows no items", "Try Paste Text instead of PDF (or vice versa)"],
            ["Print looks wrong", "Check Print Templates, ensure merge fields are correct"],
            ["FBR submission fails", "Check Audit Logs, verify token and environment"],
        ], s, col_widths=[2.3*inch, 4.2*inch]
    ))

    # Build
    doc.build(story)
    print(f"\nPDF generated: {OUTPUT_PDF}")


if __name__ == "__main__":
    take_screenshots()
    build_pdf()

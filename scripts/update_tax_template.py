import requests, json

BASE = "http://localhost:5134"

# Login
resp = requests.post(f"{BASE}/api/auth/login", json={"username": "admin", "password": "admin123"})
token = resp.json()["token"]
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

html = '''<!DOCTYPE html>
<html>
<head>
<title>Sales Tax Invoice #{{invoiceNumber}}</title>
<meta name="format-detection" content="telephone=no">
<style>
    @page { size: A4; margin: 0; }

    @media print {
        body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        .page { border: none !important; }
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Arial Narrow", Arial, sans-serif; font-size: 9pt; color: #000; line-height: 1.2; margin: 0; }

    .page {
        width: 210mm;
        min-height: 297mm;
        margin: auto;
        padding: 10mm 12mm;
        background: #fff;
    }

    a { color: inherit !important; text-decoration: none !important; }

    /* Header Title */
    .invoice-header {
        border: 2px solid #000;
        text-align: center;
        padding: 5px;
        margin-bottom: 15px;
    }
    .invoice-header h1 {
        font-size: 22pt;
        letter-spacing: 2px;
        font-weight: bold;
        text-transform: uppercase;
    }

    /* Meta Info (Date & Number) */
    .meta-container {
        display: flex;
        justify-content: space-between;
        margin-bottom: 15px;
        padding: 0 10px;
    }
    .meta-item { font-size: 10pt; }

    /* Party Section */
    .parties-wrapper {
        display: flex;
        justify-content: space-between;
        gap: 40px;
        margin-bottom: 20px;
    }
    .party-box {
        flex: 1;
        border: 1px solid #000;
        display: flex;
    }
    .label-col {
        width: 100px;
        border-right: 1px solid #000;
        font-weight: bold;
        font-size: 8pt;
        padding: 4px;
        display: flex;
        flex-direction: column;
    }
    .label-col div { border-bottom: 1px solid #000; padding: 4px 0; height: 35px; display: flex; align-items: center; }
    .label-col div:last-child { border-bottom: none; }

    .value-col {
        flex: 1;
        padding: 4px;
        text-align: center;
        display: flex;
        flex-direction: column;
    }
    .value-col div { border-bottom: 1px solid #000; padding: 4px 0; height: 35px; display: flex; align-items: center; justify-content: center; }
    .value-col div:last-child { border-bottom: none; }

    .supplier-name { font-size: 18pt; font-weight: bold; }
    .client-name { font-weight: bold; font-size: 11pt; text-transform: uppercase; }

    /* Table Section */
    .items-table {
        width: 100%;
        border-collapse: collapse;
        border: 2px solid #000;
    }
    .items-table th {
        border: 1px solid #000;
        background-color: #fff;
        font-size: 8pt;
        padding: 5px 2px;
        text-align: center;
        font-weight: bold;
    }
    .items-table td {
        border: 1px solid #000;
        height: 22px;
        padding: 2px 5px;
        font-size: 9pt;
    }
    .center { text-align: center; }
    .right { text-align: right; }

    /* Totals Row */
    .total-row {
        font-weight: bold;
        background-color: #fff;
    }

    /* Amount in Words */
    .words-container {
        margin-top: 20px;
        border: 1px solid #000;
    }
    .words-label {
        font-weight: bold;
        padding-left: 5px;
        padding-top: 2px;
    }
    .words-box {
        text-align: center;
        padding: 8px;
        font-style: italic;
        color: #555;
    }

    /* Signatures */
    .signature-section {
        margin-top: 60px;
        display: flex;
        justify-content: space-between;
    }
    .sig-line {
        width: 250px;
        border-top: 1px solid #000;
        text-align: center;
        padding-top: 5px;
        font-size: 8pt;
        font-weight: bold;
        text-transform: uppercase;
    }
</style>
</head>
<body>

<div class="page">

<div class="invoice-header">
    <h1>Sales Tax Invoice</h1>
</div>

<div class="meta-container">
    <div class="meta-item">Date of Invoice &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <strong>{{fmtDate date}}</strong></div>
    <div class="meta-item">Invoice Number &nbsp;&nbsp;&nbsp; <strong>{{invoiceNumber}}</strong></div>
</div>

<div class="parties-wrapper">
    <div class="party-box">
        <div class="label-col">
            <div>Client Name</div>
            <div style="height:50px">Client Address</div>
            <div>NTN #:</div>
            <div>Sales Tax #</div>
        </div>
        <div class="value-col">
            <div class="client-name">{{buyerName}}</div>
            <div style="height:50px; font-size: 8pt;">{{{nl2br buyerAddress}}}</div>
            <div>{{buyerNTN}}</div>
            <div>{{buyerSTRN}}</div>
        </div>
    </div>

    <div class="party-box">
        <div class="label-col">
            <div style="line-height: 1; text-align: center;">Invoice<br>Generated<br>From</div>
            <div style="height:50px">Address :</div>
            <div>NTN #:</div>
            <div>Sales Tax #</div>
        </div>
        <div class="value-col">
            <div class="supplier-name">{{supplierName}}</div>
            <div style="height:50px; font-size: 8pt;">{{{nl2br supplierAddress}}}</div>
            <div>{{supplierNTN}}</div>
            <div>{{supplierSTRN}}</div>
        </div>
    </div>
</div>

<table class="items-table">
    <thead>
        <tr>
            <th style="width: 5%;">Qty</th>
            <th style="width: 7%;">UOM</th>
            <th style="width: 40%;">Item Description</th>
            <th style="width: 12%;">Amount<br>(Excluding GST)</th>
            <th style="width: 8%;">GST %<br>18%</th>
            <th style="width: 13%;">GST Amount<br>Only</th>
            <th style="width: 15%;">Total Amount<br>Including GST (18%)</th>
        </tr>
    </thead>
    <tbody>
        {{#each items}}
        <tr>
            <td class="center">{{this.quantity}}</td>
            <td class="center">{{this.uom}}</td>
            <td>{{this.description}}</td>
            <td class="right">{{fmtDec this.valueExclTax}}</td>
            <td class="center">{{this.gstRate}}%</td>
            <td class="right">{{fmtDec this.gstAmount}}</td>
            <td class="right">{{fmtDec this.totalInclTax}}</td>
        </tr>
        {{/each}}

        {{taxEmptyRows (math 15 "-" items.length)}}
    </tbody>
    <tfoot>
        <tr class="total-row">
            <td colspan="3" class="center">Total Sales Tax Amount Outstanding</td>
            <td class="right">{{fmtDec subtotal}}</td>
            <td class="center">18%</td>
            <td class="right">{{fmtDec gstAmount}}</td>
            <td class="right">{{fmtDec grandTotal}}</td>
        </tr>
    </tfoot>
</table>

<div class="words-container">
    <div class="words-label">Amount in Words</div>
    <div class="words-box">{{amountInWords}}</div>
</div>

<div class="signature-section">
    <div class="sig-line">Signature and Stamp</div>
    <div class="sig-line">Receiver Signature and Stamp</div>
</div>

</div>

</body>
</html>'''

payload = json.dumps({"htmlContent": html})
resp = requests.put(f"{BASE}/api/printtemplates/company/2/TaxInvoice", headers=headers, data=payload)
print(f"Status: {resp.status_code}")
if resp.status_code == 200:
    print("Tax Invoice template updated successfully")
else:
    print(f"Error: {resp.text[:300]}")

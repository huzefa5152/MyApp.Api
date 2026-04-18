import requests, json

BASE = "http://localhost:5134"

# Login
resp = requests.post(f"{BASE}/api/auth/login", json={"username": "admin", "password": "admin123"})
token = resp.json()["token"]
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

html = '''<!DOCTYPE html>
<html>
<head>
<title>Bill #{{invoiceNumber}}</title>
<meta name="format-detection" content="telephone=no">

<style>
@page {
  size: A4;
  margin: 8mm;
}

body {
  font-family: Arial, sans-serif;
  font-size: 12px;
  margin: 0;
  background: #fff;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}

a { color: inherit !important; text-decoration: none !important; }

.container {
  border: 2px solid #000;
  padding: 10px;
}

/* HEADER */
.header {
  display: flex;
  justify-content: space-between;
}

.company {
  font-family: "Times New Roman", serif;
  font-size: 42px;
  font-weight: bold;
  max-width: 280px;
  line-height: 1;
}

.tagline {
  font-size: 11px;
  margin-top: 5px;
}

.tax {
  margin-top: 10px;
  font-weight: bold;
  color: #004269;
}

/* RIGHT HEADER */
.header-right {
  text-align: center;
}

.bill-title {
  font-size: 32px;
  font-weight: bold;
  color: #1f4e79;
  text-align: center;
}

/* RIGHT INFO TABLE - labels outside box, values inside box */
.info-table {
  border-collapse: collapse;
  margin-top: 5px;
}

.info-table td {
  padding: 3px 5px;
  font-size: 11px;
  white-space: nowrap;
}

.info-table .label {
  text-align: right;
  font-weight: bold;
  padding-right: 6px;
}

.info-table .value {
  border: 1px solid #000;
  min-width: 120px;
  padding: 3px 6px;
}

/* BILL TO */
.billto-header {
  background: #1f4e79 !important;
  color: #fff !important;
  padding: 5px;
  font-weight: bold;
  margin-top: 10px;
  text-align: center;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}

.billto-box {
  border: 1px solid #000;
  display: flex;
}

.billto-left, .billto-right {
  width: 50%;
  border-right: 1px solid #000;
}

.billto-right {
  border-right: none;
}

.billto-title {
  background: #4f81bd !important;
  color: #000;
  text-align: center;
  font-weight: bold;
  padding: 5px;
  border-bottom: 1px solid #000;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}

.billto-content {
  padding: 20px;
  text-align: center;
  font-weight: bold;
}

/* TABLE */
.table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 10px;
}

.table th {
  background: #1f4e79 !important;
  color: #fff !important;
  border: 1px solid #000;
  padding: 5px;
  font-size: 11px;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}

.table td {
  border: 1px solid #999;
  padding: 4px;
  height: 24px;
}

.table tbody tr:nth-child(even) {
  background: #e6e6e6 !important;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}

/* TOTALS */
.totals {
  display: flex;
  margin-top: 10px;
}

.words-box {
  width: 60%;
  border: 1px solid #000;
}

.words-header {
  background: #1f4e79 !important;
  color: #fff !important;
  padding: 5px;
  font-weight: bold;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}

.words-content {
  padding: 20px;
  text-align: center;
}

.totals-box {
  width: 40%;
  padding-left: 20px;
}

.totals-table {
  width: 100%;
  border-collapse: collapse;
}

.totals-table td {
  border: 1px solid #999;
  padding: 5px;
}

.total-bold {
  font-weight: bold;
  border-top: 2px solid #000 !important;
}

/* FOOTER */
.signatures {
  display: flex;
  justify-content: space-between;
  margin-top: 40px;
  padding: 0 50px;
}

.thankyou {
  text-align: center;
  font-weight: bold;
  margin-top: 20px;
}

.contact {
  text-align: center;
  margin-top: 10px;
}
</style>
</head>

<body>

<div class="container">

  <!-- HEADER -->
  <div class="header">
    <div>
      <div class="company">{{companyBrandName}}</div>
      <div class="tagline">General Order Supplies / Stockiest in All Kinds Of Hardware Tools</div>
      <div class="tax">STRN # {{companySTRN}}</div>
      <div class="tax">NTN # {{companyNTN}}</div>
    </div>

    <div class="header-right">
      <div class="bill-title">Bill</div>
      <table class="info-table">
        <tr><td class="label">Date:</td><td class="value">{{fmtDate date}}</td></tr>
        <tr><td class="label">Bill #</td><td class="value">{{invoiceNumber}}</td></tr>
        <tr><td class="label">Delivery Challan #</td><td class="value">{{join challanNumbers}}</td></tr>
        <tr><td class="label">Purchase Order #</td><td class="value">{{poNumber}}</td></tr>
        <tr><td class="label">Payment Due by:</td><td class="value">As Per Required Date</td></tr>
      </table>
    </div>
  </div>

  <!-- BILL TO -->
  <div class="billto-header">Bill To:</div>

  <div class="billto-box">
    <div class="billto-left">
      <div class="billto-title">Company Name</div>
      <div class="billto-content">{{clientName}}</div>
    </div>

    <div class="billto-right">
      <div class="billto-title">Concern Department</div>
      <div class="billto-content">{{concernDepartment}}</div>
    </div>
  </div>

  <!-- ITEMS -->
  <table class="table">
    <thead>
      <tr>
        <th>Item #</th>
        <th>Description</th>
        <th>Qty</th>
        <th>Unit Price</th>
        <th>Line Total</th>
      </tr>
    </thead>
    <tbody>
      {{#each items}}
      <tr>
        <td>{{this.sNo}}</td>
        <td>{{this.description}}</td>
        <td>{{this.quantity}}</td>
        <td>{{fmt this.unitPrice}}</td>
        <td>{{fmt this.lineTotal}}</td>
      </tr>
      {{/each}}

      <!-- EMPTY ROWS -->
      {{billEmptyRows (math 12 "-" items.length)}}
    </tbody>
  </table>

  <!-- TOTALS -->
  <div class="totals">

    <div class="words-box">
      <div class="words-header">Amount In Words:</div>
      <div class="words-content">{{amountInWords}}</div>
    </div>

    <div class="totals-box">
      <table class="totals-table">
        <tr><td>Subtotal</td><td>{{fmt subtotal}}</td></tr>
        <tr><td>Sales Tax Rate</td><td>{{gstRate}}%</td></tr>
        <tr><td>Sales Tax Amount</td><td>{{fmt gstAmount}}</td></tr>
        <tr><td>Cartridge</td><td></td></tr>
        <tr class="total-bold"><td>Total</td><td>{{fmt grandTotal}}</td></tr>
      </table>
    </div>

  </div>

  <!-- FOOTER -->
  <div class="signatures">
    <div>Signature and Stamp</div>
    <div>Receiver Signature and Stamp</div>
  </div>

  <div class="thankyou">Thank you for your business!</div>

  <div class="contact">
    Should you have any enquiries concerning this invoice, please contact<br>
    Mr. Hussain 0333-1665253
  </div>

</div>

</body>
</html>'''

payload = json.dumps({"htmlContent": html})
resp = requests.put(f"{BASE}/api/printtemplates/company/2/Bill", headers=headers, data=payload)
print(f"Status: {resp.status_code}")
if resp.status_code == 200:
    print("Bill template updated successfully")
else:
    print(f"Error: {resp.text[:300]}")

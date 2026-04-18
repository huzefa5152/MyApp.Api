"""Convert 6 existing Excel files into templates with merge field placeholders.
Uses win32com (Excel COM) to preserve exact formatting, borders, and merged cells."""
import win32com.client
import os, sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

excel = win32com.client.Dispatch('Excel.Application')
excel.Visible = False
excel.DisplayAlerts = False

DL = r'C:\Users\hussahuz\Downloads'
OUT = r'D:\huzefa-portfolio\github-projects\MyApp.Api\data\excel-templates'

def save(wb, name):
    p = os.path.join(OUT, name)
    if os.path.exists(p): os.remove(p)
    wb.SaveAs(os.path.abspath(p), FileFormat=51)
    print(f"  Created: {name}")


# ═══════════════════════════════════════════════════════════════
# 1. HAKIMI DELIVERY CHALLAN
# ═══════════════════════════════════════════════════════════════
def hakimi_dc():
    print("1. Hakimi DC...")
    wb = excel.Workbooks.Open(os.path.abspath(os.path.join(DL, 'DC # 4161 Afroz Textile.xls')))
    ws = wb.Sheets("Packing slip")

    # Header fields
    ws.Range("C1").Value = "{{companyBrandName}}"
    ws.Range("F2").Value = "{{fmtDate deliveryDate}}"
    ws.Range("B3").Value = "{{companyAddress}}"
    ws.Range("F4").Value = "DC # {{challanNumber}}"
    ws.Range("B5").Value = "{{companyPhone}}"
    ws.Range("C9").Value = "{{clientName}}"
    ws.Range("D11").Value = "{{poNumber}}"

    # Clear stray values in col A
    ws.Range("A18").Value = ""
    ws.Range("A19").Value = ""

    # Items: header R13, items R14-R30 (17 rows)
    # R14 → marker, R15 → template, R16 → end marker
    ws.Rows(14).ClearContents()
    ws.Range("B14").Value = "{{#each items 17}}"

    ws.Rows(15).ClearContents()
    ws.Range("B15").Value = "{{this.quantity}}"
    ws.Range("C15").Value = "{{this.description}}"

    ws.Rows(16).ClearContents()
    ws.Range("B16").Value = "{{/each}}"

    # Delete extra item rows R17-R30
    ws.Rows("17:30").Delete()

    save(wb, "Hakimi_Challan_Template.xlsx")
    wb.Close(False)


# ═══════════════════════════════════════════════════════════════
# 2. ROSHAN DELIVERY CHALLAN
# ═══════════════════════════════════════════════════════════════
def roshan_dc():
    print("2. Roshan DC...")
    wb = excel.Workbooks.Open(os.path.abspath(os.path.join(DL, 'DC # 1073 MEKO DENIM.xls')))
    ws = wb.Sheets("Delivery Note 1")

    # Header fields
    ws.Range("B1").Value = "{{companyBrandName}}"
    ws.Range("I3").Value = "{{fmtDate poDate}}"
    ws.Range("I4").Value = "{{poNumber}}"
    ws.Range("I5").Value = "{{challanNumber}}"
    ws.Range("I7").Value = "{{fmtDate deliveryDate}}"

    # Company address (multi-row → single cell)
    ws.Range("B11").Value = "{{companyAddress}}"
    ws.Range("B12").Value = ""
    ws.Range("B13").Value = ""
    ws.Range("B14").Value = ""
    ws.Range("B15").Value = "{{companyPhone}}"

    # Client info (right side)
    ws.Range("G11").Value = "{{clientName}}"
    ws.Range("G13").Value = "{{clientSite}}"
    ws.Range("G14").Value = "{{clientAddress}}"

    # Clear #REF error
    ws.Range("K2").Value = ""

    # Items: header R17, items R18-R37 (20 rows)
    ws.Rows(18).ClearContents()
    ws.Range("B18").Value = "{{#each items 20}}"

    ws.Rows(19).ClearContents()
    ws.Range("B19").Value = "{{this.quantity}}"
    ws.Range("C19").Value = "{{this.description}}"

    ws.Rows(20).ClearContents()
    ws.Range("B20").Value = "{{/each}}"

    ws.Rows("21:37").Delete()

    save(wb, "Roshan_Challan_Template.xlsx")
    wb.Close(False)


# ═══════════════════════════════════════════════════════════════
# 3. HAKIMI BILL
# ═══════════════════════════════════════════════════════════════
def hakimi_bill():
    print("3. Hakimi Bill...")
    wb = excel.Workbooks.Open(os.path.abspath(os.path.join(DL, 'Bill # 3719 AFROZE TEXTILE.xlsx')))
    ws = wb.Sheets("Invoice")

    # Remove Excel Table (Table2) to prevent formula issues during row deletion
    while ws.ListObjects.Count > 0:
        ws.ListObjects(1).Unlist()

    # Header fields
    ws.Range("A1").Value = "{{companyBrandName}}"
    ws.Range("B2").Value = "{{companyAddress}}"
    ws.Range("E2").Value = "{{fmtDate date}}"
    ws.Range("D3").Value = "BILL # {{invoiceNumber}}"
    ws.Range("A5").Value = "{{companyPhone}}"
    ws.Range("D5").Value = "DC # {{join challanNumbers}}"
    ws.Range("E7").Value = "{{joinDates challanDates}}"
    ws.Range("B9").Value = "{{clientName}}"
    ws.Range("D9").Value = "NTN # {{clientNTN}}"
    ws.Range("D10").Value = "GST # {{clientSTRN}}"
    ws.Range("C12").Value = "{{poNumber}}"
    ws.Range("C13").Value = "{{fmtDate poDate}}"

    # Totals (original positions — set BEFORE deleting rows)
    ws.Range("E37").Value = "{{subtotal}}"
    ws.Range("A38").Value = "{{amountInWords}}"
    ws.Range("D38").Value = "GST ({{gstRate}}%)"
    ws.Range("E38").Value = "{{gstAmount}}"
    ws.Range("E39").Value = "{{grandTotal}}"

    # Items: header R15, items R16-R36 (21 rows)
    ws.Rows(16).ClearContents()
    ws.Range("A16").Value = "{{#each items 21}}"

    ws.Rows(17).ClearContents()
    ws.Range("A17").Value = "{{@index}}"
    ws.Range("B17").Value = "{{this.quantity}}"
    ws.Range("C17").Value = "{{this.description}}"
    ws.Range("D17").Value = "{{this.unitPrice}}"
    ws.Range("E17").Value = "{{this.lineTotal}}"

    ws.Rows(18).ClearContents()
    ws.Range("A18").Value = "{{/each}}"

    ws.Rows("19:36").Delete()

    save(wb, "Hakimi_Bill_Template.xlsx")
    wb.Close(False)


# ═══════════════════════════════════════════════════════════════
# 4. ROSHAN BILL
# ═══════════════════════════════════════════════════════════════
def roshan_bill():
    print("4. Roshan Bill...")
    wb = excel.Workbooks.Open(os.path.abspath(os.path.join(DL, 'Bill # 970 MEKO DENIM.xls')))
    ws = wb.Sheets("Sales Invoice 1")

    # Header fields
    ws.Range("A1").Value = "{{companyBrandName}}"
    ws.Range("K4").Value = "{{fmtDate date}}"
    ws.Range("K5").Value = "{{invoiceNumber}}"
    ws.Range("K6").Value = "{{join challanNumbers}}"
    ws.Range("B7").Value = "{{companySTRN}}"
    ws.Range("K7").Value = "{{poNumber}}"
    ws.Range("B8").Value = "{{companyNTN}}"
    ws.Range("K8").Value = "{{paymentTerms}}"

    # Client info
    ws.Range("A13").Value = "{{clientName}}"
    ws.Range("H14").Value = "{{concernDepartment}}"

    # Clear errors and annotations
    ws.Range("M2").Value = ""
    ws.Range("N36").Value = ""
    ws.Range("N37").Value = ""
    ws.Range("N39").Value = ""
    ws.Range("N40").Value = ""

    # Totals (original positions)
    ws.Range("L36").Value = "{{subtotal}}"
    ws.Range("A37").Value = "{{amountInWords}}"
    ws.Range("K37").Value = "{{gstRate}}"
    ws.Range("L38").Value = "{{gstAmount}}"
    ws.Range("L39").Value = ""
    ws.Range("K40").Value = "{{grandTotal}}"

    # Items: header R20, items R21-R34 (14 rows)
    ws.Rows(21).ClearContents()
    ws.Range("A21").Value = "{{#each items 14}}"

    ws.Rows(22).ClearContents()
    ws.Range("A22").Value = "{{@index}}"
    ws.Range("B22").Value = "{{this.description}}"
    ws.Range("I22").Value = "{{this.quantity}}"
    ws.Range("J22").Value = "{{this.unitPrice}}"
    ws.Range("K22").Value = "{{this.lineTotal}}"

    ws.Rows(23).ClearContents()
    ws.Range("A23").Value = "{{/each}}"

    ws.Rows("24:34").Delete()

    save(wb, "Roshan_Bill_Template.xlsx")
    wb.Close(False)


# ═══════════════════════════════════════════════════════════════
# 5. HAKIMI TAX INVOICE
# ═══════════════════════════════════════════════════════════════
def hakimi_tax():
    print("5. Hakimi Tax Invoice...")
    wb = excel.Workbooks.Open(os.path.abspath(os.path.join(DL, 'INVOICE # 3719 AFROZE TEXTILE.xlsx')))
    ws = wb.Sheets("Sheet2")

    # Invoice header
    ws.Range("C7").Value = "{{invoiceNumber}}"
    ws.Range("E7").Value = "{{fmtDate date}}"

    # Supplier info (left)
    ws.Range("C10").Value = "{{supplierName}}"
    ws.Range("C12").Value = "{{supplierAddress}}"
    ws.Range("C13").Value = ""
    ws.Range("C14").Value = ""
    ws.Range("C15").Value = "{{supplierPhone}}"
    ws.Range("C16").Value = "{{supplierSTRN}}"
    ws.Range("C17").Value = "{{supplierNTN}}"

    # Buyer info (right)
    ws.Range("I10").Value = "{{buyerName}}"
    ws.Range("I12").Value = "{{buyerAddress}}"
    ws.Range("I13").Value = ""
    ws.Range("I14").Value = ""
    ws.Range("I15").Value = "{{buyerPhone}}"
    ws.Range("I16").Value = "{{buyerSTRN}}"
    ws.Range("I17").Value = "{{buyerNTN}}"

    # Totals (original positions)
    ws.Range("H49").Value = "{{subtotal}}"
    ws.Range("I49").Value = "{{gstRate}}"
    ws.Range("J49").Value = "{{gstAmount}}"
    ws.Range("K49").Value = "{{grandTotal}}"
    ws.Range("H51").Value = "{{amountInWords}}"

    # Items: headers R21-R25, items R26-R48 (23 rows)
    ws.Rows(26).ClearContents()
    ws.Range("A26").Value = "{{#each items 23}}"

    ws.Rows(27).ClearContents()
    ws.Range("A27").Value = "{{this.quantity}}"
    ws.Range("B27").Value = "{{this.uom}}"
    ws.Range("C27").Value = "{{this.description}}"
    ws.Range("H27").Value = "{{this.valueExclTax}}"
    ws.Range("I27").Value = "{{this.gstRate}}"
    ws.Range("J27").Value = "{{this.gstAmount}}"
    ws.Range("K27").Value = "{{this.totalInclTax}}"

    ws.Rows(28).ClearContents()
    ws.Range("A28").Value = "{{/each}}"

    ws.Rows("29:48").Delete()

    save(wb, "Hakimi_TaxInvoice_Template.xlsx")
    wb.Close(False)


# ═══════════════════════════════════════════════════════════════
# 6. ROSHAN TAX INVOICE
# ═══════════════════════════════════════════════════════════════
def roshan_tax():
    print("6. Roshan Tax Invoice...")
    wb = excel.Workbooks.Open(os.path.abspath(os.path.join(DL, 'Invoice # 970 Meko DENIM.xlsx')))
    ws = wb.Sheets("Sheet2")

    # Invoice header
    ws.Range("D7").Value = "{{fmtDate date}}"
    ws.Range("I7").Value = "{{invoiceNumber}}"

    # Buyer info (left side in Roshan layout)
    ws.Range("C10").Value = "{{buyerName}}"
    ws.Range("C12").Value = "{{buyerAddress}}"
    ws.Range("C13").Value = ""
    ws.Range("C15").Value = "{{buyerNTN}}"
    ws.Range("C16").Value = "{{buyerSTRN}}"

    # Supplier info (right side)
    ws.Range("I10").Value = "{{supplierName}}"
    ws.Range("I12").Value = "{{supplierAddress}}"
    ws.Range("I13").Value = ""
    ws.Range("I14").Value = ""
    ws.Range("I15").Value = "{{supplierNTN}}"
    ws.Range("I16").Value = "{{supplierSTRN}}"

    # Totals (original positions)
    ws.Range("H48").Value = "{{subtotal}}"
    ws.Range("J48").Value = "{{gstAmount}}"
    ws.Range("K48").Value = "{{grandTotal}}"
    ws.Range("A51").Value = "{{amountInWords}}"

    # Items: headers R20-R24, items R25-R47 (23 rows)
    ws.Rows(25).ClearContents()
    ws.Range("A25").Value = "{{#each items 23}}"

    ws.Rows(26).ClearContents()
    ws.Range("A26").Value = "{{this.quantity}}"
    ws.Range("B26").Value = "{{this.uom}}"
    ws.Range("C26").Value = "{{this.description}}"
    ws.Range("H26").Value = "{{this.valueExclTax}}"
    ws.Range("I26").Value = "{{this.gstRate}}"
    ws.Range("J26").Value = "{{this.gstAmount}}"
    ws.Range("K26").Value = "{{this.totalInclTax}}"

    ws.Rows(27).ClearContents()
    ws.Range("A27").Value = "{{/each}}"

    ws.Rows("28:47").Delete()

    save(wb, "Roshan_TaxInvoice_Template.xlsx")
    wb.Close(False)


if __name__ == "__main__":
    hakimi_dc()
    roshan_dc()
    hakimi_bill()
    roshan_bill()
    hakimi_tax()
    roshan_tax()
    excel.Quit()
    print("\nAll 6 templates created in:", OUT)

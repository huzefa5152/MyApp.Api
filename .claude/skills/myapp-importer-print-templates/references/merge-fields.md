# Importer merge-field inventory

Branch `feat/importer-ledger-receipts`, revision `eef1dede497abb343d4cb915127b58fea80ecfa2`. Source-only snapshot; revalidate against live JSON.

## Renderer catalog

Expressions below come from this branch's `MERGE_FIELDS`. Fields beginning with `this` require their corresponding loop. They are not universally available on every document type.


### Challan

| Expression | Catalog description |
| --- | --- |
| `{{companyBrandName}}` | Company Brand Name |
| `{{companyLogoPath}}` | Company Logo URL |
| `{{{nl2br companyAddress}}}` | Company Address (with line breaks) |
| `{{{nl2br companyPhone}}}` | Company Phone (with line breaks) |
| `{{challanNumber}}` | Challan Number |
| `{{fmtDate deliveryDate}}` | Delivery Date |
| `{{clientName}}` | Client Name |
| `{{clientAddress}}` | Client Address |
| `{{clientSite}}` | Client Site |
| `{{poNumber}}` | PO Number |
| `{{fmtDate poDate}}` | PO Date |
| `{{items.length}}` | Item Count |
| `{{#each items}}` | Loop: Items Start |
| `{{/each}}` | Loop: End |
| `{{this.quantity}}` | Item Quantity (in loop) |
| `{{fmtQty this.quantity}}` | Item Quantity — formatted (1,000 / 2.5) |
| `{{this.unit}}` | Item Unit (in loop) |
| `{{{richText this.description}}}` | Item Description (in loop) |

### Bill

| Expression | Catalog description |
| --- | --- |
| `{{companyBrandName}}` | Company Brand Name |
| `{{companyLogoPath}}` | Company Logo URL |
| `{{{nl2br companyAddress}}}` | Company Address (with line breaks) |
| `{{{nl2br companyPhone}}}` | Company Phone (with line breaks) |
| `{{companyNTN}}` | Company NTN |
| `{{companySTRN}}` | Company STRN |
| `{{invoiceNumber}}` | Invoice/Bill Number |
| `{{fmtDate date}}` | Invoice Date |
| `{{join challanNumbers}}` | Challan Numbers |
| `{{joinDates challanDates}}` | Challan Dates |
| `{{poNumber}}` | PO Number |
| `{{fmtDate poDate}}` | PO Date |
| `{{clientName}}` | Client Name |
| `{{clientAddress}}` | Client Address |
| `{{concernDepartment}}` | Concern Department |
| `{{clientNTN}}` | Client NTN |
| `{{clientSTRN}}` | Client STRN/GST |
| `{{fmt subtotal}}` | Subtotal |
| `{{gstRate}}` | GST Rate % |
| `{{fmt gstAmount}}` | GST Amount |
| `{{fmt grandTotal}}` | Grand Total |
| `{{amountInWords}}` | Amount In Words |
| `{{#each items}}` | Loop: Items Start |
| `{{/each}}` | Loop: End |
| `{{this.sNo}}` | Item S# (in loop) |
| `{{this.quantity}}` | Item Quantity (in loop) |
| `{{{richText this.description}}}` | Item Description (in loop) |
| `{{this.itemTypeName}}` | Item Type Name (in loop) |
| `{{fmt this.unitPrice}}` | Item Unit Price (in loop) |
| `{{fmtPrice this.unitPrice}}` | Item Unit Price — keeps up to 12 decimals |
| `{{fmt this.lineTotal}}` | Item Line Total (in loop) |

### TaxInvoice

| Expression | Catalog description |
| --- | --- |
| `{{supplierName}}` | Supplier Name |
| `{{{nl2br supplierAddress}}}` | Supplier Address (with line breaks) |
| `{{{nl2br supplierPhone}}}` | Supplier Phone (with line breaks) |
| `{{supplierNTN}}` | Supplier NTN |
| `{{supplierSTRN}}` | Supplier STRN |
| `{{buyerName}}` | Buyer Name |
| `{{{nl2br buyerAddress}}}` | Buyer Address (with line breaks) |
| `{{buyerPhone}}` | Buyer Phone |
| `{{buyerNTN}}` | Buyer NTN |
| `{{buyerSTRN}}` | Buyer STRN |
| `{{invoiceNumber}}` | Invoice Number |
| `{{fmtDate date}}` | Invoice Date |
| `{{join challanNumbers}}` | Challan Numbers |
| `{{poNumber}}` | PO Number |
| `{{gstRate}}` | GST Rate % |
| `{{fmtDec subtotal}}` | Subtotal |
| `{{fmtDec gstAmount}}` | GST Amount |
| `{{fmtDec grandTotal}}` | Grand Total |
| `{{amountInWords}}` | Amount In Words |
| `{{#each items}}` | Loop: Items Start |
| `{{/each}}` | Loop: End |
| `{{this.quantity}}` | Item Quantity (in loop) |
| `{{this.uom}}` | Item UOM (in loop) |
| `{{{richText this.description}}}` | Item Description (in loop) |
| `{{fmtDec this.valueExclTax}}` | Value Excl Tax (in loop) |
| `{{this.gstRate}}` | GST Rate % (in loop) |
| `{{fmtDec this.gstAmount}}` | GST Amount (in loop) |
| `{{fmtDec this.totalInclTax}}` | Total Incl Tax (in loop) |
| `{{fbrIRN}}` | FBR Invoice Reference Number (IRN) |
| `{{fbrStatus}}` | FBR Status (Submitted/Failed) |
| `{{fmtDate fbrSubmittedAt}}` | FBR Submission Date |
| `{{{fbrQrPngDataUrl}}}` | FBR QR Code (base64 PNG) |
| `{{fbrLogoUrl}}` | FBR Logo URL |

### Receipt

| Expression | Catalog description |
| --- | --- |
| `{{companyBrandName}}` | Company Brand Name |
| `{{companyLogoPath}}` | Company Logo URL |
| `{{{nl2br companyAddress}}}` | Company Address (with line breaks) |
| `{{{nl2br companyPhone}}}` | Company Phone (with line breaks) |
| `{{companyNTN}}` | Company NTN |
| `{{companySTRN}}` | Company STRN |
| `{{reference}}` | Voucher Reference (RCV-#) |
| `{{fmtDate date}}` | Receipt Date |
| `{{contactName}}` | Received From (Name) |
| `{{{nl2br contactAddress}}}` | Contact Address |
| `{{contactPhone}}` | Contact Phone |
| `{{method}}` | Payment Method |
| `{{bankAccountName}}` | Bank/Cash Account |
| `{{chequeNumber}}` | Cheque Number |
| `{{fmtDate chequeDate}}` | Cheque Date |
| `{{description}}` | Description |
| `{{fmt amount}}` | Amount |
| `{{amountInWords}}` | Amount In Words |
| `{{#if allocations.length}}` | If: Has Allocations |
| `{{/if}}` | End If |
| `{{#each allocations}}` | Loop: Allocations Start |
| `{{/each}}` | Loop: End |
| `{{this.documentLabel}}` | Settled Document (in loop) |
| `{{fmtDate this.date}}` | Document Date (in loop) |
| `{{fmt this.amount}}` | Settled Amount (in loop) |

### Payment

| Expression | Catalog description |
| --- | --- |
| `{{companyBrandName}}` | Company Brand Name |
| `{{companyLogoPath}}` | Company Logo URL |
| `{{{nl2br companyAddress}}}` | Company Address (with line breaks) |
| `{{{nl2br companyPhone}}}` | Company Phone (with line breaks) |
| `{{companyNTN}}` | Company NTN |
| `{{companySTRN}}` | Company STRN |
| `{{reference}}` | Voucher Reference (PMT-#) |
| `{{fmtDate date}}` | Payment Date |
| `{{contactName}}` | Paid To (Name) |
| `{{{nl2br contactAddress}}}` | Contact Address |
| `{{contactPhone}}` | Contact Phone |
| `{{method}}` | Payment Method |
| `{{bankAccountName}}` | Bank/Cash Account |
| `{{chequeNumber}}` | Cheque Number |
| `{{fmtDate chequeDate}}` | Cheque Date |
| `{{description}}` | Description |
| `{{fmt amount}}` | Amount |
| `{{amountInWords}}` | Amount In Words |
| `{{#if allocations.length}}` | If: Has Allocations |
| `{{/if}}` | End If |
| `{{#each allocations}}` | Loop: Allocations Start |
| `{{/each}}` | Loop: End |
| `{{this.documentLabel}}` | Settled Document (in loop) |
| `{{fmtDate this.date}}` | Document Date (in loop) |
| `{{fmt this.amount}}` | Settled Amount (in loop) |

### Transfer

| Expression | Catalog description |
| --- | --- |
| `{{companyBrandName}}` | Company Brand Name |
| `{{companyLogoPath}}` | Company Logo URL |
| `{{{nl2br companyAddress}}}` | Company Address (with line breaks) |
| `{{{nl2br companyPhone}}}` | Company Phone (with line breaks) |
| `{{reference}}` | Voucher Reference (TRF-#) |
| `{{fmtDate date}}` | Transfer Date |
| `{{fromAccountName}}` | From Account |
| `{{toAccountName}}` | To Account |
| `{{description}}` | Description / Remarks |
| `{{fmt amount}}` | Amount |
| `{{amountInWords}}` | Amount In Words |

### JournalEntry

| Expression | Catalog description |
| --- | --- |
| `{{companyBrandName}}` | Company Brand Name |
| `{{companyLogoPath}}` | Company Logo URL |
| `{{{nl2br companyAddress}}}` | Company Address (with line breaks) |
| `{{{nl2br companyPhone}}}` | Company Phone (with line breaks) |
| `{{reference}}` | Voucher Reference (JE-#) |
| `{{entryNo}}` | Entry Number |
| `{{fmtDate date}}` | Entry Date |
| `{{narration}}` | Narration |
| `{{fmt totalDebit}}` | Total Debit |
| `{{fmt totalCredit}}` | Total Credit |
| `{{#each lines}}` | Loop: Lines Start |
| `{{/each}}` | Loop: End |
| `{{this.accountCode}}` | Account Code (in loop) |
| `{{this.accountName}}` | Account Name (in loop) |
| `{{{richText this.description}}}` | Line Description (in loop) |
| `{{fmt this.debit}}` | Line Debit (in loop) |
| `{{fmt this.credit}}` | Line Credit (in loop) |

### WithholdingTaxReceipt

| Expression | Catalog description |
| --- | --- |
| `{{companyBrandName}}` | Company Brand Name |
| `{{companyLogoPath}}` | Company Logo URL |
| `{{{nl2br companyAddress}}}` | Company Address (with line breaks) |
| `{{{nl2br companyPhone}}}` | Company Phone (with line breaks) |
| `{{companyNTN}}` | Company NTN |
| `{{companySTRN}}` | Company STRN |
| `{{receiptNumber}}` | Certificate / Receipt Number |
| `{{fmtDate date}}` | Date |
| `{{customerName}}` | Withheld From (Name) |
| `{{{nl2br customerAddress}}}` | Customer Address |
| `{{customerNTN}}` | Customer NTN |
| `{{customerSTRN}}` | Customer STRN |
| `{{description}}` | Particulars / Description |
| `{{fmt amount}}` | Tax Amount Withheld |
| `{{amountInWords}}` | Amount In Words |

## DTO property inventory

These are C# property names from `DTOs/PrintDtos.cs`, retained exactly to avoid guessing serializer casing. Use the catalog/actual JSON for merge-token spelling. Collection item DTOs define row fields; nullable properties can be blank. Other document DTOs may live in separate files.


### PrintChallanDto

`DivisionId` (int?), `CompanyBrandName` (string), `CompanyLogoPath` (string?), `CompanyAddress` (string?), `CompanyPhone` (string?), `ChallanNumber` (int), `DeliveryDate` (DateTime?), `ClientName` (string), `ClientAddress` (string?), `ClientSite` (string?), `PoNumber` (string), `PoDate` (DateTime?), `IndentNo` (string?), `Items` (List<PrintChallanItemDto>)


### PrintChallanItemDto

`Quantity` (decimal), `Description` (string), `Unit` (string)


### PrintBillDto

`DivisionId` (int?), `CompanyBrandName` (string), `CompanyLogoPath` (string?), `CompanyAddress` (string?), `CompanyPhone` (string?), `CompanyNTN` (string?), `CompanySTRN` (string?), `InvoiceNumber` (int), `Date` (DateTime), `ChallanNumbers` (List<int>), `ChallanDates` (List<DateTime?>), `PoNumber` (string), `PoDate` (DateTime?), `ClientName` (string), `ClientAddress` (string?), `ConcernDepartment` (string?), `ClientNTN` (string?), `ClientSTRN` (string?), `Subtotal` (decimal), `GSTRate` (decimal), `GSTAmount` (decimal), `GrandTotal` (decimal), `AmountInWords` (string), `AdvanceTaxSection` (string?), `AdvanceTaxRate` (decimal?), `AdvanceTaxAmount` (decimal), `AdvanceTaxLabel` (string), `TotalWithAdvanceTax` (decimal), `WithholdingTaxRate` (decimal?), `WithholdingTaxAmount` (decimal), `BalanceDueAfterWht` (decimal), `FurtherTaxRate` (decimal?), `FurtherTaxAmount` (decimal), `TotalBeforeFurtherTax` (decimal), `Collectible` (decimal), `PaymentTerms` (string?), `FbrIRN` (string?), `FbrInvoiceNumber` (string?), `FbrStatus` (string?), `FbrSubmittedAt` (DateTime?), `FbrQrPngDataUrl` (string?), `FbrLogoUrl` (string), `Items` (List<PrintBillItemDto>)


### PrintBillItemDto

`SNo` (int), `ItemTypeName` (string), `Description` (string), `Quantity` (decimal), `UOM` (string), `UnitPrice` (decimal), `LineTotal` (decimal)


### PrintTaxInvoiceDto

`DivisionId` (int?), `SupplierName` (string), `SupplierAddress` (string?), `SupplierNTN` (string?), `SupplierSTRN` (string?), `SupplierPhone` (string?), `SupplierLogoPath` (string?), `CompanyBrandName` (string), `CompanyLogoPath` (string?), `CompanyAddress` (string?), `CompanyPhone` (string?), `CompanyNTN` (string?), `CompanySTRN` (string?), `DivisionName` (string?), `DivisionBrandName` (string?), `DivisionLogoPath` (string?), `DivisionAddress` (string?), `DivisionPhone` (string?), `DivisionNTN` (string?), `DivisionSTRN` (string?), `BuyerName` (string), `BuyerAddress` (string?), `BuyerPhone` (string?), `BuyerNTN` (string?), `BuyerSTRN` (string?), `InvoiceNumber` (int), `Date` (DateTime), `ChallanNumbers` (List<int>), `PoNumber` (string), `Subtotal` (decimal), `GSTRate` (decimal), `GSTAmount` (decimal), `GrandTotal` (decimal), `SubtotalRounded` (decimal), `GSTAmountRounded` (decimal), `GrandTotalRounded` (decimal), `TotalBeforeFurtherTaxRounded` (decimal), `TotalBeforeFurtherTax` (decimal), `WithholdingTaxRate` (decimal?), `WithholdingTaxAmount` (decimal), `BalanceDueAfterWht` (decimal), `FurtherTaxRate` (decimal?), `FurtherTaxAmount` (decimal), `Collectible` (decimal), `CollectibleRounded` (decimal), `AmountInWordsRounded` (string), `AmountInWords` (string), `AdvanceTaxSection` (string?), `AdvanceTaxRate` (decimal?), `AdvanceTaxAmount` (decimal), `AdvanceTaxLabel` (string), `TotalWithAdvanceTax` (decimal), `FbrIRN` (string?), `FbrInvoiceNumber` (string?), `FbrStatus` (string?), `FbrSubmittedAt` (DateTime?), `FbrQrPngDataUrl` (string?), `FbrLogoUrl` (string), `NoteKindLabel` (string?), `OriginalInvoiceNumber` (int?), `OriginalInvoiceDate` (DateTime?), `OriginalInvoiceRefIRN` (string?), `NoteReason` (string?), `NoteReasonRemarks` (string?), `Items` (List<PrintTaxItemDto>)


### PrintTaxItemDto

`ItemTypeName` (string), `Quantity` (decimal), `UOM` (string), `Description` (string), `UnitPrice` (decimal), `ValueExclTax` (decimal), `GSTRate` (decimal), `GSTAmount` (decimal), `TotalInclTax` (decimal), `ValueExclTaxRounded` (decimal), `GSTAmountRounded` (decimal), `TotalInclTaxRounded` (decimal), `HSCode` (string?)


### PrintQuoteDto

`CompanyBrandName` (string), `CompanyLogoPath` (string?), `CompanyAddress` (string?), `CompanyPhone` (string?), `CompanyNTN` (string?), `CompanySTRN` (string?), `DivisionName` (string?), `DivisionBrandName` (string?), `DivisionLogoPath` (string?), `DivisionAddress` (string?), `DivisionPhone` (string?), `DivisionNTN` (string?), `DivisionSTRN` (string?), `DivisionEmail` (string?), `QuoteNumber` (int), `Date` (DateTime), `ValidUntil` (DateTime?), `CustomerEnquiryRef` (string?), `EnquiryDate` (DateTime?), `ClientName` (string), `ClientAddress` (string?), `ClientNTN` (string?), `ClientSTRN` (string?), `Subtotal` (decimal), `GSTRate` (decimal), `GSTAmount` (decimal), `GrandTotal` (decimal), `AmountInWords` (string), `Notes` (string?), `HasLineImages` (bool), `Items` (List<PrintQuoteItemDto>)


### PrintQuoteItemDto

`SNo` (int), `ItemTypeName` (string), `Description` (string), `Quantity` (decimal), `Uom` (string), `UnitPrice` (decimal), `LineTotal` (decimal), `ImagePath` (string?)


### PrintOrderDto

`CompanyBrandName` (string), `CompanyLogoPath` (string?), `CompanyAddress` (string?), `CompanyPhone` (string?), `SalesOrderNumber` (int), `OrderDate` (DateTime), `RequiredDate` (DateTime?), `CustomerPoNumber` (string?), `CustomerPoDate` (DateTime?), `Status` (string), `ClientName` (string), `ClientAddress` (string?), `Site` (string?), `Items` (List<PrintOrderItemDto>)


### PrintOrderItemDto

`SNo` (int), `ItemTypeName` (string), `Description` (string), `Quantity` (decimal), `Uom` (string), `DeliveredQuantity` (decimal), `RemainingQuantity` (decimal)


### PrintPurchaseBillDto

`CompanyBrandName` (string), `CompanyLogoPath` (string?), `CompanyAddress` (string?), `CompanyPhone` (string?), `CompanyNTN` (string?), `CompanySTRN` (string?), `DivisionName` (string?), `DivisionBrandName` (string?), `DivisionLogoPath` (string?), `DivisionAddress` (string?), `DivisionPhone` (string?), `DivisionNTN` (string?), `DivisionSTRN` (string?), `DivisionEmail` (string?), `SupplierName` (string), `SupplierAddress` (string?), `SupplierPhone` (string?), `SupplierNTN` (string?), `SupplierSTRN` (string?), `PurchaseBillNumber` (int), `Date` (DateTime), `SupplierBillNumber` (string?), `SupplierIRN` (string?), `PaymentTerms` (string?), `DueDate` (DateTime?), `GoodsReceiptNumbers` (List<int>), `LinkedSaleBillNumbers` (List<int>), `Subtotal` (decimal), `GSTRate` (decimal), `GSTAmount` (decimal), `GrandTotal` (decimal), `AmountInWords` (string), `WithholdingTaxRate` (decimal?), `WithholdingTaxAmount` (decimal), `BalanceDueAfterWht` (decimal), `Items` (List<PrintPurchaseBillItemDto>)


### PrintPurchaseBillItemDto

`SNo` (int), `ItemTypeName` (string), `Description` (string), `Quantity` (decimal), `UOM` (string), `UnitPrice` (decimal), `LineTotal` (decimal), `HSCode` (string?)


### PrintGoodsReceiptDto

`CompanyBrandName` (string), `CompanyLogoPath` (string?), `CompanyAddress` (string?), `CompanyPhone` (string?), `DivisionName` (string?), `DivisionBrandName` (string?), `DivisionLogoPath` (string?), `DivisionAddress` (string?), `DivisionPhone` (string?), `DivisionNTN` (string?), `DivisionSTRN` (string?), `DivisionEmail` (string?), `SupplierName` (string), `SupplierAddress` (string?), `SupplierPhone` (string?), `GoodsReceiptNumber` (int), `ReceiptDate` (DateTime), `SupplierChallanNumber` (string?), `PurchaseBillNumber` (int?), `Site` (string?), `Status` (string), `Items` (List<PrintGoodsReceiptItemDto>)


### PrintGoodsReceiptItemDto

`SNo` (int), `ItemTypeName` (string), `Description` (string), `Quantity` (int), `Unit` (string)


### PrintPurchaseDebitNoteDto

`SupplierName` (string), `SupplierLogoPath` (string?), `SupplierAddress` (string?), `SupplierPhone` (string?), `SupplierNTN` (string?), `SupplierSTRN` (string?), `DivisionId` (int?), `CompanyBrandName` (string), `CompanyLogoPath` (string?), `CompanyAddress` (string?), `CompanyPhone` (string?), `CompanyNTN` (string?), `CompanySTRN` (string?), `DivisionName` (string?), `DivisionBrandName` (string?), `DivisionLogoPath` (string?), `DivisionAddress` (string?), `DivisionPhone` (string?), `DivisionNTN` (string?), `DivisionSTRN` (string?), `BuyerName` (string), `BuyerAddress` (string?), `BuyerPhone` (string?), `BuyerNTN` (string?), `BuyerSTRN` (string?), `InvoiceNumber` (string), `Date` (DateTime), `Subtotal` (decimal), `GstRate` (decimal), `GstAmount` (decimal), `GrandTotal` (decimal), `AmountInWords` (string), `OriginalInvoiceNumber` (string?), `NoteKindLabel` (string), `Items` (List<PrintPurchaseDebitNoteItemDto>)


### PrintPurchaseDebitNoteItemDto

`ItemTypeName` (string?), `Quantity` (decimal), `Uom` (string?), `Description` (string), `HsCode` (string?), `ValueExclTax` (decimal), `GstRate` (decimal), `GstAmount` (decimal), `TotalInclTax` (decimal)

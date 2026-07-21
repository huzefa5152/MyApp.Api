using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;

namespace MyApp.Api.Data
{
    /// <summary>
    /// Idempotent runtime seeder for the <c>CreditNote</c> / <c>DebitNote</c> /
    /// <c>PurchaseBill</c> / <c>GoodsReceipt</c> print-template merge fields
    /// (the field-picker shown in the Template Editor sidebar).
    ///
    /// Same pattern (and same rationale) as <see cref="SalesMergeFieldSeeder"/>:
    /// runtime-seeded rather than HasData because hard-coded ids collide with
    /// operator-added MergeField rows; keyed by the unique
    /// (TemplateType, FieldExpression) index so re-running on boot is a no-op.
    ///
    /// Field contracts:
    /// - CreditNote/DebitNote bind the note row's PrintTaxInvoiceDto payload
    ///   (supplier* = tenant company, buyer* = client) plus the note fields
    ///   (originalInvoiceNumber, noteReason, ...) — see GetPrintTaxInvoiceAsync.
    /// - PurchaseBill binds PrintPurchaseBillDto (company* = tenant/buyer,
    ///   supplier* = vendor party).
    /// - GoodsReceipt binds PrintGoodsReceiptDto (quantity-only, no money).
    /// </summary>
    public static class NoteAndPurchaseMergeFieldSeeder
    {
        private static readonly string[] SeededTypes =
            { "CreditNote", "DebitNote", "PurchaseBill", "GoodsReceipt" };

        // CreditNote and DebitNote share one data contract — generate both
        // sets from the same field list, TaxInvoice-style naming throughout.
        private static IEnumerable<MergeField> NoteFieldsFor(string type)
        {
            var kind = type == "CreditNote" ? "Credit Note" : "Debit Note";
            return new[]
            {
                new MergeField { TemplateType = type, FieldExpression = "{{supplierName}}", Label = "Supplier (Company) Name", Category = "Supplier", SortOrder = 1 },
                new MergeField { TemplateType = type, FieldExpression = "{{{nl2br supplierAddress}}}", Label = "Supplier Address (with line breaks)", Category = "Supplier", SortOrder = 2 },
                new MergeField { TemplateType = type, FieldExpression = "{{{nl2br supplierPhone}}}", Label = "Supplier Phone (with line breaks)", Category = "Supplier", SortOrder = 3 },
                new MergeField { TemplateType = type, FieldExpression = "{{supplierNTN}}", Label = "Supplier NTN", Category = "Supplier", SortOrder = 4 },
                new MergeField { TemplateType = type, FieldExpression = "{{supplierSTRN}}", Label = "Supplier STRN", Category = "Supplier", SortOrder = 5 },
                new MergeField { TemplateType = type, FieldExpression = "{{supplierLogoPath}}", Label = "Supplier (Company) Logo URL", Category = "Supplier", SortOrder = 6 },
                new MergeField { TemplateType = type, FieldExpression = "{{buyerName}}", Label = "Buyer Name", Category = "Buyer", SortOrder = 10 },
                new MergeField { TemplateType = type, FieldExpression = "{{{nl2br buyerAddress}}}", Label = "Buyer Address (with line breaks)", Category = "Buyer", SortOrder = 11 },
                new MergeField { TemplateType = type, FieldExpression = "{{buyerPhone}}", Label = "Buyer Phone", Category = "Buyer", SortOrder = 12 },
                new MergeField { TemplateType = type, FieldExpression = "{{buyerNTN}}", Label = "Buyer NTN", Category = "Buyer", SortOrder = 13 },
                new MergeField { TemplateType = type, FieldExpression = "{{buyerSTRN}}", Label = "Buyer STRN", Category = "Buyer", SortOrder = 14 },
                new MergeField { TemplateType = type, FieldExpression = "{{invoiceNumber}}", Label = $"{kind} Number", Category = "Document", SortOrder = 20 },
                new MergeField { TemplateType = type, FieldExpression = "{{fmtDate date}}", Label = $"{kind} Date", Category = "Document", SortOrder = 21 },
                new MergeField { TemplateType = type, FieldExpression = "{{noteKindLabel}}", Label = "Note Kind Label", Category = "Note", SortOrder = 22 },
                new MergeField { TemplateType = type, FieldExpression = "{{originalInvoiceNumber}}", Label = "Original Invoice Number", Category = "Note", SortOrder = 23 },
                new MergeField { TemplateType = type, FieldExpression = "{{fmtDate originalInvoiceDate}}", Label = "Original Invoice Date", Category = "Note", SortOrder = 24 },
                new MergeField { TemplateType = type, FieldExpression = "{{originalInvoiceRefIRN}}", Label = "Original Invoice FBR IRN", Category = "Note", SortOrder = 25 },
                new MergeField { TemplateType = type, FieldExpression = "{{noteReason}}", Label = "Reason for Issuance", Category = "Note", SortOrder = 26 },
                new MergeField { TemplateType = type, FieldExpression = "{{noteReasonRemarks}}", Label = "Reason Remarks", Category = "Note", SortOrder = 27 },
                new MergeField { TemplateType = type, FieldExpression = "{{gstRate}}", Label = "GST Rate %", Category = "Totals", SortOrder = 30 },
                new MergeField { TemplateType = type, FieldExpression = "{{fmtDec subtotal}}", Label = "Subtotal (2 decimals)", Category = "Totals", SortOrder = 31 },
                new MergeField { TemplateType = type, FieldExpression = "{{fmtDec gstAmount}}", Label = "GST Amount (2 decimals)", Category = "Totals", SortOrder = 32 },
                new MergeField { TemplateType = type, FieldExpression = "{{fmtDec grandTotal}}", Label = "Grand Total (2 decimals)", Category = "Totals", SortOrder = 33 },
                new MergeField { TemplateType = type, FieldExpression = "{{amountInWords}}", Label = "Amount In Words", Category = "Totals", SortOrder = 34 },
                new MergeField { TemplateType = type, FieldExpression = "{{#each items}}", Label = "Loop: Items Start", Category = "Items", SortOrder = 40 },
                new MergeField { TemplateType = type, FieldExpression = "{{/each}}", Label = "Loop: End", Category = "Items", SortOrder = 41 },
                new MergeField { TemplateType = type, FieldExpression = "{{this.quantity}}", Label = "Item Quantity (in loop)", Category = "Items", SortOrder = 42 },
                new MergeField { TemplateType = type, FieldExpression = "{{this.uom}}", Label = "Item UOM (in loop)", Category = "Items", SortOrder = 43 },
                new MergeField { TemplateType = type, FieldExpression = "{{this.description}}", Label = "Item Description (in loop)", Category = "Items", SortOrder = 44 },
                new MergeField { TemplateType = type, FieldExpression = "{{fmtDec this.valueExclTax}}", Label = "Value Excl Tax (in loop)", Category = "Items", SortOrder = 45 },
                new MergeField { TemplateType = type, FieldExpression = "{{this.gstRate}}", Label = "GST Rate % (in loop)", Category = "Items", SortOrder = 46 },
                new MergeField { TemplateType = type, FieldExpression = "{{fmtDec this.gstAmount}}", Label = "GST Amount (in loop)", Category = "Items", SortOrder = 47 },
                new MergeField { TemplateType = type, FieldExpression = "{{fmtDec this.totalInclTax}}", Label = "Total Incl Tax (in loop)", Category = "Items", SortOrder = 48 },
                new MergeField { TemplateType = type, FieldExpression = "{{this.hsCode}}", Label = "Item HS Code (in loop)", Category = "Items", SortOrder = 49 },
                new MergeField { TemplateType = type, FieldExpression = "{{#if originalInvoiceNumber}}", Label = "If: Has Original Invoice", Category = "Conditionals", SortOrder = 50 },
                new MergeField { TemplateType = type, FieldExpression = "{{#if originalInvoiceRefIRN}}", Label = "If: Has Original IRN", Category = "Conditionals", SortOrder = 51 },
                new MergeField { TemplateType = type, FieldExpression = "{{#if noteReason}}", Label = "If: Has Reason", Category = "Conditionals", SortOrder = 52 },
                new MergeField { TemplateType = type, FieldExpression = "{{#if noteReasonRemarks}}", Label = "If: Has Reason Remarks", Category = "Conditionals", SortOrder = 53 },
                new MergeField { TemplateType = type, FieldExpression = "{{#if supplierNTN}}", Label = "If: Has Supplier NTN", Category = "Conditionals", SortOrder = 54 },
                new MergeField { TemplateType = type, FieldExpression = "{{#if buyerNTN}}", Label = "If: Has Buyer NTN", Category = "Conditionals", SortOrder = 55 },
                new MergeField { TemplateType = type, FieldExpression = "{{#if this.hsCode}}", Label = "If: Item Has HS Code", Category = "Conditionals", SortOrder = 56 },
                new MergeField { TemplateType = type, FieldExpression = "{{else}}", Label = "Else", Category = "Conditionals", SortOrder = 57 },
                new MergeField { TemplateType = type, FieldExpression = "{{/if}}", Label = "End If", Category = "Conditionals", SortOrder = 58 },
                new MergeField { TemplateType = type, FieldExpression = "{{fbrIRN}}", Label = "FBR Invoice Reference Number (IRN)", Category = "FBR", SortOrder = 60 },
                new MergeField { TemplateType = type, FieldExpression = "{{fbrStatus}}", Label = "FBR Status (Submitted/Failed/Validated)", Category = "FBR", SortOrder = 61 },
                new MergeField { TemplateType = type, FieldExpression = "{{fmtDate fbrSubmittedAt}}", Label = "FBR Submission Date", Category = "FBR", SortOrder = 62 },
                new MergeField { TemplateType = type, FieldExpression = "{{#if fbrIRN}}", Label = "If: Has FBR IRN (for conditional FBR section)", Category = "FBR", SortOrder = 63 },
                new MergeField { TemplateType = type, FieldExpression = "{{{fbrQrPngDataUrl}}}", Label = "FBR QR Code (base64 PNG)", Category = "FBR", SortOrder = 64 },
                new MergeField { TemplateType = type, FieldExpression = "{{fbrLogoUrl}}", Label = "FBR Logo URL", Category = "FBR", SortOrder = 65 },
            };
        }

        private static IEnumerable<MergeField> PurchaseBillFields() => new[]
        {
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{companyBrandName}}", Label = "Company Brand Name", Category = "Company", SortOrder = 1 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{companyLogoPath}}", Label = "Company Logo URL", Category = "Company", SortOrder = 2 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{{nl2br companyAddress}}}", Label = "Company Address (with line breaks)", Category = "Company", SortOrder = 3 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{{nl2br companyPhone}}}", Label = "Company Phone (with line breaks)", Category = "Company", SortOrder = 4 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{companyNTN}}", Label = "Company NTN", Category = "Company", SortOrder = 5 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{companySTRN}}", Label = "Company STRN", Category = "Company", SortOrder = 6 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{supplierName}}", Label = "Supplier (Vendor) Name", Category = "Supplier", SortOrder = 10 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{{nl2br supplierAddress}}}", Label = "Supplier Address (with line breaks)", Category = "Supplier", SortOrder = 11 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{supplierPhone}}", Label = "Supplier Phone", Category = "Supplier", SortOrder = 12 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{supplierNTN}}", Label = "Supplier NTN", Category = "Supplier", SortOrder = 13 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{supplierSTRN}}", Label = "Supplier STRN", Category = "Supplier", SortOrder = 14 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{purchaseBillNumber}}", Label = "Purchase Bill Number", Category = "Document", SortOrder = 20 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{fmtDate date}}", Label = "Bill Date", Category = "Document", SortOrder = 21 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{supplierBillNumber}}", Label = "Supplier's Invoice Number", Category = "Document", SortOrder = 22 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{supplierIRN}}", Label = "Supplier's FBR IRN", Category = "Document", SortOrder = 23 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{paymentTerms}}", Label = "Payment Terms", Category = "Document", SortOrder = 24 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{fmtDate dueDate}}", Label = "Payment Due Date", Category = "Document", SortOrder = 25 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{join goodsReceiptNumbers}}", Label = "Goods Receipt Numbers (comma-separated)", Category = "Document", SortOrder = 26 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{join linkedSaleBillNumbers}}", Label = "Linked Sale Bill Numbers (comma-separated)", Category = "Document", SortOrder = 27 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{fmt subtotal}}", Label = "Subtotal (formatted)", Category = "Totals", SortOrder = 30 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{gstRate}}", Label = "GST Rate %", Category = "Totals", SortOrder = 31 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{fmt gstAmount}}", Label = "GST Amount (formatted)", Category = "Totals", SortOrder = 32 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{fmt grandTotal}}", Label = "Grand Total (formatted)", Category = "Totals", SortOrder = 33 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{amountInWords}}", Label = "Amount In Words", Category = "Totals", SortOrder = 34 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{#each items}}", Label = "Loop: Items Start", Category = "Items", SortOrder = 40 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{/each}}", Label = "Loop: End", Category = "Items", SortOrder = 41 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{this.sNo}}", Label = "Item S# (in loop)", Category = "Items", SortOrder = 42 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{this.itemTypeName}}", Label = "Item Type Name (in loop)", Category = "Items", SortOrder = 43 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{this.description}}", Label = "Item Description (in loop)", Category = "Items", SortOrder = 44 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{this.quantity}}", Label = "Item Quantity (in loop)", Category = "Items", SortOrder = 45 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{this.uom}}", Label = "Item UOM (in loop)", Category = "Items", SortOrder = 46 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{fmt this.unitPrice}}", Label = "Unit Price (in loop)", Category = "Items", SortOrder = 47 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{fmt this.lineTotal}}", Label = "Line Total (in loop)", Category = "Items", SortOrder = 48 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{this.hsCode}}", Label = "Item HS Code (in loop)", Category = "Items", SortOrder = 49 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{#if companyLogoPath}}", Label = "If: Has Logo", Category = "Conditionals", SortOrder = 50 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{#if supplierNTN}}", Label = "If: Has Supplier NTN", Category = "Conditionals", SortOrder = 51 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{#if supplierSTRN}}", Label = "If: Has Supplier STRN", Category = "Conditionals", SortOrder = 52 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{#if supplierBillNumber}}", Label = "If: Has Supplier Invoice #", Category = "Conditionals", SortOrder = 53 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{#if supplierIRN}}", Label = "If: Has Supplier IRN", Category = "Conditionals", SortOrder = 54 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{#if paymentTerms}}", Label = "If: Has Payment Terms", Category = "Conditionals", SortOrder = 55 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{#if dueDate}}", Label = "If: Has Due Date", Category = "Conditionals", SortOrder = 56 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{#if goodsReceiptNumbers}}", Label = "If: Has Goods Receipts", Category = "Conditionals", SortOrder = 57 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{#if this.hsCode}}", Label = "If: Item Has HS Code", Category = "Conditionals", SortOrder = 58 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{else}}", Label = "Else", Category = "Conditionals", SortOrder = 59 },
            new MergeField { TemplateType = "PurchaseBill", FieldExpression = "{{/if}}", Label = "End If", Category = "Conditionals", SortOrder = 60 },
        };

        private static IEnumerable<MergeField> GoodsReceiptFields() => new[]
        {
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{companyBrandName}}", Label = "Company Brand Name", Category = "Company", SortOrder = 1 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{companyLogoPath}}", Label = "Company Logo URL", Category = "Company", SortOrder = 2 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{{nl2br companyAddress}}}", Label = "Company Address (with line breaks)", Category = "Company", SortOrder = 3 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{{nl2br companyPhone}}}", Label = "Company Phone (with line breaks)", Category = "Company", SortOrder = 4 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{supplierName}}", Label = "Supplier (Vendor) Name", Category = "Supplier", SortOrder = 10 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{{nl2br supplierAddress}}}", Label = "Supplier Address (with line breaks)", Category = "Supplier", SortOrder = 11 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{supplierPhone}}", Label = "Supplier Phone", Category = "Supplier", SortOrder = 12 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{goodsReceiptNumber}}", Label = "Goods Receipt Number", Category = "Document", SortOrder = 20 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{fmtDate receiptDate}}", Label = "Receipt Date", Category = "Document", SortOrder = 21 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{supplierChallanNumber}}", Label = "Supplier's Challan Number", Category = "Document", SortOrder = 22 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{purchaseBillNumber}}", Label = "Against Purchase Bill Number", Category = "Document", SortOrder = 23 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{site}}", Label = "Site / Location", Category = "Document", SortOrder = 24 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{status}}", Label = "Receipt Status", Category = "Document", SortOrder = 25 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{#each items}}", Label = "Loop: Items Start", Category = "Items", SortOrder = 30 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{/each}}", Label = "Loop: End", Category = "Items", SortOrder = 31 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{this.sNo}}", Label = "Item S# (in loop)", Category = "Items", SortOrder = 32 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{this.itemTypeName}}", Label = "Item Type Name (in loop)", Category = "Items", SortOrder = 33 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{this.description}}", Label = "Item Description (in loop)", Category = "Items", SortOrder = 34 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{this.quantity}}", Label = "Item Quantity (in loop)", Category = "Items", SortOrder = 35 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{this.unit}}", Label = "Item Unit (in loop)", Category = "Items", SortOrder = 36 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{#if companyLogoPath}}", Label = "If: Has Logo", Category = "Conditionals", SortOrder = 40 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{#if supplierChallanNumber}}", Label = "If: Has Supplier Challan #", Category = "Conditionals", SortOrder = 41 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{#if purchaseBillNumber}}", Label = "If: Has Purchase Bill #", Category = "Conditionals", SortOrder = 42 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{#if site}}", Label = "If: Has Site", Category = "Conditionals", SortOrder = 43 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{else}}", Label = "Else", Category = "Conditionals", SortOrder = 44 },
            new MergeField { TemplateType = "GoodsReceipt", FieldExpression = "{{/if}}", Label = "End If", Category = "Conditionals", SortOrder = 45 },
        };

        public static async Task SeedAsync(AppDbContext db)
        {
            var defs = NoteFieldsFor("CreditNote")
                .Concat(NoteFieldsFor("DebitNote"))
                .Concat(PurchaseBillFields())
                .Concat(GoodsReceiptFields())
                .ToList();

            var existing = (await db.MergeFields
                    .Where(m => SeededTypes.Contains(m.TemplateType))
                    .Select(m => new { m.TemplateType, m.FieldExpression })
                    .ToListAsync())
                .Select(m => m.TemplateType + "|" + m.FieldExpression)
                .ToHashSet();

            var toAdd = defs.Where(d => !existing.Contains(d.TemplateType + "|" + d.FieldExpression)).ToList();
            if (toAdd.Count == 0) return;

            db.MergeFields.AddRange(toAdd);
            await db.SaveChangesAsync();
        }
    }
}

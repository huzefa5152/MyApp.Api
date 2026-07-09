using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;

namespace MyApp.Api.Data
{
    /// <summary>
    /// Idempotent runtime seeder for the <c>SalesQuote</c> / <c>SalesOrder</c>
    /// print-template merge fields (the field-picker shown in the Template
    /// Editor sidebar).
    ///
    /// Seeded at RUNTIME rather than via <c>HasData</c> on purpose: hard-coded
    /// HasData ids collide with operator-added MergeField rows on databases
    /// where the identity counter has already advanced past the seed range
    /// (operators can create merge fields via the UI — config.mergefields.manage).
    /// Keyed by the unique <c>(TemplateType, FieldExpression)</c> index, so
    /// re-running on every boot is a no-op once seeded.
    /// </summary>
    public static class SalesMergeFieldSeeder
    {
        public static async Task SeedAsync(AppDbContext db)
        {
            var defs = new List<MergeField>
            {
                // ── SalesQuote (priced — mirrors Bill) ──
                new() { TemplateType = "SalesQuote", FieldExpression = "{{companyBrandName}}", Label = "Company Brand Name", Category = "Company", SortOrder = 1 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{companyLogoPath}}", Label = "Company Logo URL", Category = "Company", SortOrder = 2 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{{nl2br companyAddress}}}", Label = "Company Address (with line breaks)", Category = "Company", SortOrder = 3 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{{nl2br companyPhone}}}", Label = "Company Phone (with line breaks)", Category = "Company", SortOrder = 4 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{companyNTN}}", Label = "Company NTN", Category = "Company", SortOrder = 5 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{companySTRN}}", Label = "Company STRN", Category = "Company", SortOrder = 6 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{quoteNumber}}", Label = "Quote Number", Category = "Document", SortOrder = 10 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{fmtDate date}}", Label = "Quote Date", Category = "Document", SortOrder = 11 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{fmtDate validUntil}}", Label = "Valid Until", Category = "Document", SortOrder = 12 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{customerEnquiryRef}}", Label = "Customer Enquiry Ref", Category = "Document", SortOrder = 13 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{fmtDate enquiryDate}}", Label = "Enquiry Date", Category = "Document", SortOrder = 14 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{clientName}}", Label = "Client Name", Category = "Client", SortOrder = 20 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{clientAddress}}", Label = "Client Address", Category = "Client", SortOrder = 21 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{clientNTN}}", Label = "Client NTN", Category = "Client", SortOrder = 22 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{clientSTRN}}", Label = "Client STRN/GST", Category = "Client", SortOrder = 23 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{fmt subtotal}}", Label = "Subtotal (formatted)", Category = "Totals", SortOrder = 30 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{gstRate}}", Label = "GST Rate %", Category = "Totals", SortOrder = 31 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{fmt gstAmount}}", Label = "GST Amount (formatted)", Category = "Totals", SortOrder = 32 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{fmt grandTotal}}", Label = "Grand Total (formatted)", Category = "Totals", SortOrder = 33 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{amountInWords}}", Label = "Amount In Words", Category = "Totals", SortOrder = 34 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{{nl2br notes}}}", Label = "Notes / Terms", Category = "Totals", SortOrder = 35 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{#each items}}", Label = "Loop: Items Start", Category = "Items", SortOrder = 40 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{/each}}", Label = "Loop: End", Category = "Items", SortOrder = 41 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{this.sNo}}", Label = "Item S# (in loop)", Category = "Items", SortOrder = 42 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{this.description}}", Label = "Item Description (in loop)", Category = "Items", SortOrder = 43 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{this.quantity}}", Label = "Item Quantity (in loop)", Category = "Items", SortOrder = 44 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{this.uom}}", Label = "Item UOM (in loop)", Category = "Items", SortOrder = 45 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{fmt this.unitPrice}}", Label = "Unit Price (in loop)", Category = "Items", SortOrder = 46 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{fmt this.lineTotal}}", Label = "Line Total (in loop)", Category = "Items", SortOrder = 47 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{#if companyLogoPath}}", Label = "If: Has Logo", Category = "Conditionals", SortOrder = 50 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{#if validUntil}}", Label = "If: Has Valid Until", Category = "Conditionals", SortOrder = 51 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{#if customerEnquiryRef}}", Label = "If: Has Enquiry Ref", Category = "Conditionals", SortOrder = 52 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{else}}", Label = "Else", Category = "Conditionals", SortOrder = 53 },
                new() { TemplateType = "SalesQuote", FieldExpression = "{{/if}}", Label = "End If", Category = "Conditionals", SortOrder = 54 },

                // ── SalesOrder (quantity-only — mirrors Challan + fulfilment) ──
                new() { TemplateType = "SalesOrder", FieldExpression = "{{companyBrandName}}", Label = "Company Brand Name", Category = "Company", SortOrder = 1 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{companyLogoPath}}", Label = "Company Logo URL", Category = "Company", SortOrder = 2 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{{nl2br companyAddress}}}", Label = "Company Address (with line breaks)", Category = "Company", SortOrder = 3 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{{nl2br companyPhone}}}", Label = "Company Phone (with line breaks)", Category = "Company", SortOrder = 4 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{salesOrderNumber}}", Label = "Sales Order Number", Category = "Document", SortOrder = 10 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{fmtDate orderDate}}", Label = "Order Date", Category = "Document", SortOrder = 11 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{fmtDate requiredDate}}", Label = "Required Date", Category = "Document", SortOrder = 12 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{customerPoNumber}}", Label = "Customer PO Number", Category = "Document", SortOrder = 13 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{fmtDate customerPoDate}}", Label = "Customer PO Date", Category = "Document", SortOrder = 14 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{status}}", Label = "Fulfilment Status", Category = "Document", SortOrder = 15 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{clientName}}", Label = "Client Name", Category = "Client", SortOrder = 20 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{clientAddress}}", Label = "Client Address", Category = "Client", SortOrder = 21 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{site}}", Label = "Delivery Site", Category = "Client", SortOrder = 22 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{#each items}}", Label = "Loop: Items Start", Category = "Items", SortOrder = 30 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{/each}}", Label = "Loop: End", Category = "Items", SortOrder = 31 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{this.sNo}}", Label = "Item S# (in loop)", Category = "Items", SortOrder = 32 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{this.description}}", Label = "Item Description (in loop)", Category = "Items", SortOrder = 33 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{this.quantity}}", Label = "Ordered Quantity (in loop)", Category = "Items", SortOrder = 34 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{this.uom}}", Label = "Item UOM (in loop)", Category = "Items", SortOrder = 35 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{this.deliveredQuantity}}", Label = "Delivered Quantity (in loop)", Category = "Items", SortOrder = 36 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{this.remainingQuantity}}", Label = "Remaining Quantity (in loop)", Category = "Items", SortOrder = 37 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{#if companyLogoPath}}", Label = "If: Has Logo", Category = "Conditionals", SortOrder = 40 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{#if customerPoNumber}}", Label = "If: Has Customer PO", Category = "Conditionals", SortOrder = 41 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{else}}", Label = "Else", Category = "Conditionals", SortOrder = 42 },
                new() { TemplateType = "SalesOrder", FieldExpression = "{{/if}}", Label = "End If", Category = "Conditionals", SortOrder = 43 },
            };

            var existing = (await db.MergeFields
                    .Where(m => m.TemplateType == "SalesQuote" || m.TemplateType == "SalesOrder")
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

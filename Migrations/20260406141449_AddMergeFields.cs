using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddMergeFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "MergeFields",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    TemplateType = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    FieldExpression = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    Label = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Category = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    SortOrder = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MergeFields", x => x.Id);
                });

            migrationBuilder.InsertData(
                table: "MergeFields",
                columns: new[] { "Id", "Category", "FieldExpression", "Label", "SortOrder", "TemplateType" },
                values: new object[,]
                {
                    { 1, "Company", "{{companyBrandName}}", "Company Brand Name", 1, "Challan" },
                    { 2, "Company", "{{companyLogoPath}}", "Company Logo URL", 2, "Challan" },
                    { 3, "Company", "{{{nl2br companyAddress}}}", "Company Address (with line breaks)", 3, "Challan" },
                    { 4, "Company", "{{{nl2br companyPhone}}}", "Company Phone (with line breaks)", 4, "Challan" },
                    { 5, "Document", "{{challanNumber}}", "Challan Number", 10, "Challan" },
                    { 6, "Document", "{{fmtDate deliveryDate}}", "Delivery Date", 11, "Challan" },
                    { 7, "Document", "{{poNumber}}", "PO Number", 12, "Challan" },
                    { 8, "Document", "{{fmtDate poDate}}", "PO Date", 13, "Challan" },
                    { 9, "Client", "{{clientName}}", "Client Name", 20, "Challan" },
                    { 10, "Client", "{{clientAddress}}", "Client Address", 21, "Challan" },
                    { 11, "Client", "{{clientSite}}", "Client Site", 22, "Challan" },
                    { 12, "Items", "{{items.length}}", "Item Count", 30, "Challan" },
                    { 13, "Items", "{{#each items}}", "Loop: Items Start", 31, "Challan" },
                    { 14, "Items", "{{/each}}", "Loop: End", 32, "Challan" },
                    { 15, "Items", "{{this.quantity}}", "Item Quantity (in loop)", 33, "Challan" },
                    { 16, "Items", "{{this.description}}", "Item Description (in loop)", 34, "Challan" },
                    { 17, "Conditionals", "{{#if companyLogoPath}}", "If: Has Logo", 40, "Challan" },
                    { 18, "Conditionals", "{{#if companyAddress}}", "If: Has Address", 41, "Challan" },
                    { 19, "Conditionals", "{{#if companyPhone}}", "If: Has Phone", 42, "Challan" },
                    { 20, "Conditionals", "{{#if poNumber}}", "If: Has PO Number", 43, "Challan" },
                    { 21, "Conditionals", "{{#if poDate}}", "If: Has PO Date", 44, "Challan" },
                    { 22, "Conditionals", "{{#if clientSite}}", "If: Has Client Site", 45, "Challan" },
                    { 23, "Conditionals", "{{else}}", "Else", 46, "Challan" },
                    { 24, "Conditionals", "{{/if}}", "End If", 47, "Challan" },
                    { 25, "Company", "{{companyBrandName}}", "Company Brand Name", 1, "Bill" },
                    { 26, "Company", "{{companyLogoPath}}", "Company Logo URL", 2, "Bill" },
                    { 27, "Company", "{{{nl2br companyAddress}}}", "Company Address (with line breaks)", 3, "Bill" },
                    { 28, "Company", "{{{nl2br companyPhone}}}", "Company Phone (with line breaks)", 4, "Bill" },
                    { 29, "Company", "{{companyNTN}}", "Company NTN", 5, "Bill" },
                    { 30, "Company", "{{companySTRN}}", "Company STRN", 6, "Bill" },
                    { 31, "Document", "{{invoiceNumber}}", "Invoice/Bill Number", 10, "Bill" },
                    { 32, "Document", "{{fmtDate date}}", "Invoice Date", 11, "Bill" },
                    { 33, "Document", "{{join challanNumbers}}", "Challan Numbers (comma-separated)", 12, "Bill" },
                    { 34, "Document", "{{joinDates challanDates}}", "Challan Dates (comma-separated)", 13, "Bill" },
                    { 35, "Document", "{{poNumber}}", "PO Number", 14, "Bill" },
                    { 36, "Document", "{{fmtDate poDate}}", "PO Date", 15, "Bill" },
                    { 37, "Client", "{{clientName}}", "Client Name", 20, "Bill" },
                    { 38, "Client", "{{clientAddress}}", "Client Address", 21, "Bill" },
                    { 39, "Client", "{{concernDepartment}}", "Concern Department", 22, "Bill" },
                    { 40, "Client", "{{clientNTN}}", "Client NTN", 23, "Bill" },
                    { 41, "Client", "{{clientSTRN}}", "Client STRN/GST", 24, "Bill" },
                    { 42, "Totals", "{{fmt subtotal}}", "Subtotal (formatted)", 30, "Bill" },
                    { 43, "Totals", "{{gstRate}}", "GST Rate %", 31, "Bill" },
                    { 44, "Totals", "{{fmt gstAmount}}", "GST Amount (formatted)", 32, "Bill" },
                    { 45, "Totals", "{{fmt grandTotal}}", "Grand Total (formatted)", 33, "Bill" },
                    { 46, "Totals", "{{amountInWords}}", "Amount In Words", 34, "Bill" },
                    { 47, "Items", "{{#each items}}", "Loop: Items Start", 40, "Bill" },
                    { 48, "Items", "{{/each}}", "Loop: End", 41, "Bill" },
                    { 49, "Items", "{{this.sNo}}", "Item S# (in loop)", 42, "Bill" },
                    { 50, "Items", "{{this.quantity}}", "Item Quantity (in loop)", 43, "Bill" },
                    { 51, "Items", "{{this.description}}", "Item Description (in loop)", 44, "Bill" },
                    { 52, "Items", "{{this.itemTypeName}}", "Item Type Name (in loop)", 45, "Bill" },
                    { 53, "Items", "{{fmt this.unitPrice}}", "Unit Price (in loop)", 46, "Bill" },
                    { 54, "Items", "{{fmt this.lineTotal}}", "Line Total (in loop)", 47, "Bill" },
                    { 55, "Conditionals", "{{#if companyLogoPath}}", "If: Has Logo", 50, "Bill" },
                    { 56, "Conditionals", "{{#if clientNTN}}", "If: Has Client NTN", 51, "Bill" },
                    { 57, "Conditionals", "{{#if clientSTRN}}", "If: Has Client STRN", 52, "Bill" },
                    { 58, "Conditionals", "{{#if poNumber}}", "If: Has PO Number", 53, "Bill" },
                    { 59, "Conditionals", "{{#if poDate}}", "If: Has PO Date", 54, "Bill" },
                    { 60, "Conditionals", "{{else}}", "Else", 55, "Bill" },
                    { 61, "Conditionals", "{{/if}}", "End If", 56, "Bill" },
                    { 62, "Supplier", "{{supplierName}}", "Supplier Name", 1, "TaxInvoice" },
                    { 63, "Supplier", "{{{nl2br supplierAddress}}}", "Supplier Address (with line breaks)", 2, "TaxInvoice" },
                    { 64, "Supplier", "{{{nl2br supplierPhone}}}", "Supplier Phone (with line breaks)", 3, "TaxInvoice" },
                    { 65, "Supplier", "{{supplierNTN}}", "Supplier NTN", 4, "TaxInvoice" },
                    { 66, "Supplier", "{{supplierSTRN}}", "Supplier STRN", 5, "TaxInvoice" },
                    { 67, "Buyer", "{{buyerName}}", "Buyer Name", 10, "TaxInvoice" },
                    { 68, "Buyer", "{{{nl2br buyerAddress}}}", "Buyer Address (with line breaks)", 11, "TaxInvoice" },
                    { 69, "Buyer", "{{buyerPhone}}", "Buyer Phone", 12, "TaxInvoice" },
                    { 70, "Buyer", "{{buyerNTN}}", "Buyer NTN", 13, "TaxInvoice" },
                    { 71, "Buyer", "{{buyerSTRN}}", "Buyer STRN", 14, "TaxInvoice" },
                    { 72, "Document", "{{invoiceNumber}}", "Invoice Number", 20, "TaxInvoice" },
                    { 73, "Document", "{{fmtDate date}}", "Invoice Date", 21, "TaxInvoice" },
                    { 74, "Document", "{{join challanNumbers}}", "Challan Numbers", 22, "TaxInvoice" },
                    { 75, "Document", "{{poNumber}}", "PO Number", 23, "TaxInvoice" },
                    { 76, "Totals", "{{gstRate}}", "GST Rate %", 30, "TaxInvoice" },
                    { 77, "Totals", "{{fmtDec subtotal}}", "Subtotal (2 decimals)", 31, "TaxInvoice" },
                    { 78, "Totals", "{{fmtDec gstAmount}}", "GST Amount (2 decimals)", 32, "TaxInvoice" },
                    { 79, "Totals", "{{fmtDec grandTotal}}", "Grand Total (2 decimals)", 33, "TaxInvoice" },
                    { 80, "Totals", "{{amountInWords}}", "Amount In Words", 34, "TaxInvoice" },
                    { 81, "Items", "{{#each items}}", "Loop: Items Start", 40, "TaxInvoice" },
                    { 82, "Items", "{{/each}}", "Loop: End", 41, "TaxInvoice" },
                    { 83, "Items", "{{this.quantity}}", "Item Quantity (in loop)", 42, "TaxInvoice" },
                    { 84, "Items", "{{this.uom}}", "Item UOM (in loop)", 43, "TaxInvoice" },
                    { 85, "Items", "{{this.description}}", "Item Description (in loop)", 44, "TaxInvoice" },
                    { 86, "Items", "{{fmtDec this.valueExclTax}}", "Value Excl Tax (in loop)", 45, "TaxInvoice" },
                    { 87, "Items", "{{this.gstRate}}", "GST Rate % (in loop)", 46, "TaxInvoice" },
                    { 88, "Items", "{{fmtDec this.gstAmount}}", "GST Amount (in loop)", 47, "TaxInvoice" },
                    { 89, "Items", "{{fmtDec this.totalInclTax}}", "Total Incl Tax (in loop)", 48, "TaxInvoice" },
                    { 90, "Conditionals", "{{#if supplierAddress}}", "If: Has Supplier Address", 50, "TaxInvoice" },
                    { 91, "Conditionals", "{{#if supplierPhone}}", "If: Has Supplier Phone", 51, "TaxInvoice" },
                    { 92, "Conditionals", "{{#if supplierSTRN}}", "If: Has Supplier STRN", 52, "TaxInvoice" },
                    { 93, "Conditionals", "{{#if supplierNTN}}", "If: Has Supplier NTN", 53, "TaxInvoice" },
                    { 94, "Conditionals", "{{#if buyerAddress}}", "If: Has Buyer Address", 54, "TaxInvoice" },
                    { 95, "Conditionals", "{{#if buyerPhone}}", "If: Has Buyer Phone", 55, "TaxInvoice" },
                    { 96, "Conditionals", "{{#if buyerSTRN}}", "If: Has Buyer STRN", 56, "TaxInvoice" },
                    { 97, "Conditionals", "{{#if buyerNTN}}", "If: Has Buyer NTN", 57, "TaxInvoice" },
                    { 98, "Conditionals", "{{else}}", "Else", 58, "TaxInvoice" },
                    { 99, "Conditionals", "{{/if}}", "End If", 59, "TaxInvoice" }
                });

            migrationBuilder.CreateIndex(
                name: "IX_MergeFields_TemplateType_FieldExpression",
                table: "MergeFields",
                columns: new[] { "TemplateType", "FieldExpression" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MergeFields");
        }
    }
}

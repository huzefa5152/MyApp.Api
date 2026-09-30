using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;

namespace MyApp.Api.Data;

public static class WithholdingReceiptMergeFieldSeeder
{
    public static async Task SeedAsync(AppDbContext db)
    {
        var definitions = new List<MergeField>
        {
            new() { TemplateType = "WithholdingTaxReceipt", FieldExpression = "{{companyBrandName}}", Label = "Company name", Category = "Company", SortOrder = 1 },
            new() { TemplateType = "WithholdingTaxReceipt", FieldExpression = "{{companyLogoPath}}", Label = "Company logo", Category = "Company", SortOrder = 2 },
            new() { TemplateType = "WithholdingTaxReceipt", FieldExpression = "{{companyAddress}}", Label = "Company address", Category = "Company", SortOrder = 3 },
            new() { TemplateType = "WithholdingTaxReceipt", FieldExpression = "{{companyPhone}}", Label = "Company phone", Category = "Company", SortOrder = 4 },
            new() { TemplateType = "WithholdingTaxReceipt", FieldExpression = "{{companyNTN}}", Label = "Company NTN", Category = "Company", SortOrder = 5 },
            new() { TemplateType = "WithholdingTaxReceipt", FieldExpression = "{{companySTRN}}", Label = "Company STRN", Category = "Company", SortOrder = 6 },
            new() { TemplateType = "WithholdingTaxReceipt", FieldExpression = "{{receiptNumber}}", Label = "Receipt number", Category = "Document", SortOrder = 7 },
            new() { TemplateType = "WithholdingTaxReceipt", FieldExpression = "{{fmtDate date}}", Label = "Receipt date", Category = "Document", SortOrder = 8 },
            new() { TemplateType = "WithholdingTaxReceipt", FieldExpression = "{{customerName}}", Label = "Deducting customer", Category = "Customer", SortOrder = 9 },
            new() { TemplateType = "WithholdingTaxReceipt", FieldExpression = "{{customerAddress}}", Label = "Customer address", Category = "Customer", SortOrder = 10 },
            new() { TemplateType = "WithholdingTaxReceipt", FieldExpression = "{{customerNTN}}", Label = "Customer NTN", Category = "Customer", SortOrder = 11 },
            new() { TemplateType = "WithholdingTaxReceipt", FieldExpression = "{{customerSTRN}}", Label = "Customer STRN", Category = "Customer", SortOrder = 12 },
            new() { TemplateType = "WithholdingTaxReceipt", FieldExpression = "{{description}}", Label = "Certificate reference / description", Category = "Document", SortOrder = 13 },
            new() { TemplateType = "WithholdingTaxReceipt", FieldExpression = "{{fmtDec amount}}", Label = "Certificate amount (including paisa)", Category = "Totals", SortOrder = 14 },
            new() { TemplateType = "WithholdingTaxReceipt", FieldExpression = "{{amountInWords}}", Label = "Amount in words", Category = "Totals", SortOrder = 15 },
        };
        var existing = (await db.MergeFields
            .Where(f => f.TemplateType == "WithholdingTaxReceipt")
            .Select(f => f.FieldExpression).ToListAsync()).ToHashSet();
        db.MergeFields.AddRange(definitions.Where(f => !existing.Contains(f.FieldExpression)));
        await db.SaveChangesAsync();
    }
}

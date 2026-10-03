using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Helpers;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers;

public partial class McpController
{
    // Resolve during catalogue construction; partial-class field order is unspecified.
    private static string[] DocumentPrintPermissions => new[]
    {
        "challans.print.view", "bills.print.view", "invoices.print.view", "salesquotes.print.view",
        "salesorders.print.view", "purchasebills.print.view", "goodsreceipts.print.view",
        "accounting.receipts.print", "accounting.payments.print", "withholdingtax.print.view"
    };

    private static void AddDocumentPrintTools(List<ExpandedTool> tools) => tools.Add(new(
        "get_document_print_data",
        "Actual screen print data, without recalculation. Header omits inline image bytes and arrays; read a bounded collection section separately. Bill quantities stay commercial; TaxInvoice items use the effective tax projection.",
        ExpandedSchema(new
        {
            companyId = new { type = "integer", minimum = 1 },
            documentType = new { type = "string", @enum = PrintTemplateTypes.All },
            documentId = new { type = "integer", minimum = 1 },
            section = new { type = "string", @enum = new[] { "header", "items", "billItems", "allocations", "challanNumbers", "challanDates", "goodsReceiptNumbers", "linkedSaleBillNumbers" } },
            offset = new { type = "integer", minimum = 0 },
            limit = new { type = "integer", minimum = 1, maximum = 100 }
        }, "companyId", "documentType", "documentId"), DocumentPrintPermissions, McpScopes.DocumentsRead));

    private async Task<object> CallDocumentPrintToolAsync(string name, JsonElement args)
    {
        if (name != "get_document_print_data") throw new ToolError("Unknown tool.");
        var companyId = await CompanyArg(args);
        var type = PrintTypeArg(args);
        var id = IntArg(args, "documentId");
        if (id is not > 0) throw new ToolError("documentId must be a positive integer.");
        var permission = type switch
        {
            "Challan" => "challans.print.view", "Bill" => "bills.print.view",
            "TaxInvoice" or "CreditNote" or "DebitNote" => "invoices.print.view",
            "SalesQuote" => "salesquotes.print.view", "SalesOrder" => "salesorders.print.view",
            "PurchaseBill" => "purchasebills.print.view", "GoodsReceipt" => "goodsreceipts.print.view",
            "Receipt" => "accounting.receipts.print", "Payment" => "accounting.payments.print",
            "WithholdingTaxReceipt" => "withholdingtax.print.view",
            _ => throw new ToolError("Unknown document type.")
        };
        await Need(permission);
        // Scope ownership in SQL before any service loads parties or document lines.
        var exists = type switch
        {
            "Challan" => await _context.DeliveryChallans.AsNoTracking().AnyAsync(x => x.Id == id && x.CompanyId == companyId),
            "Bill" or "TaxInvoice" => await _context.Invoices.AsNoTracking().AnyAsync(x => x.Id == id && x.CompanyId == companyId && x.NoteKind == 0),
            "DebitNote" => await _context.Invoices.AsNoTracking().AnyAsync(x => x.Id == id && x.CompanyId == companyId && x.NoteKind == 1),
            "CreditNote" => await _context.Invoices.AsNoTracking().AnyAsync(x => x.Id == id && x.CompanyId == companyId && x.NoteKind == 2),
            "SalesQuote" => await _context.SalesQuotes.AsNoTracking().AnyAsync(x => x.Id == id && x.CompanyId == companyId),
            "SalesOrder" => await _context.SalesOrders.AsNoTracking().AnyAsync(x => x.Id == id && x.CompanyId == companyId),
            "PurchaseBill" => await _context.PurchaseBills.AsNoTracking().AnyAsync(x => x.Id == id && x.CompanyId == companyId),
            "GoodsReceipt" => await _context.GoodsReceipts.AsNoTracking().AnyAsync(x => x.Id == id && x.CompanyId == companyId),
            "Receipt" => await _context.Payments.AsNoTracking().AnyAsync(x => x.Id == id && x.CompanyId == companyId && x.Direction == PaymentDirection.Receipt),
            "Payment" => await _context.Payments.AsNoTracking().AnyAsync(x => x.Id == id && x.CompanyId == companyId && x.Direction == PaymentDirection.Payment),
            "WithholdingTaxReceipt" => await _context.WithholdingTaxReceipts.AsNoTracking().AnyAsync(x => x.Id == id && x.CompanyId == companyId),
            _ => false
        };
        if (!exists) throw new ToolError("Resource unavailable or access denied.");
        var services = HttpContext.RequestServices;
        object? dto = type switch
        {
            "Challan" => await _challans.GetPrintDataAsync(id.Value),
            "Bill" => await _invoices.GetPrintBillAsync(id.Value),
            "TaxInvoice" or "CreditNote" or "DebitNote" => await _invoices.GetPrintTaxInvoiceAsync(id.Value),
            "SalesQuote" => await _quotes.GetPrintDataAsync(id.Value),
            "SalesOrder" => await services.GetRequiredService<ISalesOrderService>().GetPrintDataAsync(id.Value),
            "PurchaseBill" => await services.GetRequiredService<IPurchaseBillService>().GetPrintDataAsync(id.Value),
            "GoodsReceipt" => await services.GetRequiredService<IGoodsReceiptService>().GetPrintDataAsync(id.Value),
            "Receipt" or "Payment" => await services.GetRequiredService<IPaymentService>().GetPrintDataAsync(id.Value),
            "WithholdingTaxReceipt" => await services.GetRequiredService<IWithholdingTaxReceiptService>().GetPrintDataAsync(id.Value),
            _ => null
        };
        if (dto == null) throw new ToolError("Resource unavailable or access denied.");
        var data = JsonSerializer.SerializeToElement(dto, dto.GetType(), Json);
        var section = OptText(args, "section", 40) ?? "header";
        if (section == "header")
        {
            var header = new Dictionary<string, JsonElement>();
            var collections = new Dictionary<string, int>();
            var omittedAssets = new List<string>();
            foreach (var property in data.EnumerateObject())
            {
                if (property.Value.ValueKind == JsonValueKind.Array)
                    collections[property.Name] = property.Value.GetArrayLength();
                else if (property.Value.ValueKind == JsonValueKind.String && property.Value.GetString()!.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                    omittedAssets.Add(property.Name);
                else header[property.Name] = property.Value;
            }
            return new { companyId, documentType = type, documentId = id.Value, section, data = header, collections, omittedAssets };
        }
        var supported = new[] { "items", "billItems", "allocations", "challanNumbers", "challanDates", "goodsReceiptNumbers", "linkedSaleBillNumbers" };
        if (!supported.Contains(section) || !data.TryGetProperty(section, out var collection) || collection.ValueKind != JsonValueKind.Array)
            throw new ToolError("That collection is not available on this document type.");
        var offset = NonNegativeArg(args, "offset");
        var limit = Size(args, "limit");
        var count = collection.GetArrayLength();
        return new { companyId, documentType = type, documentId = id.Value, section, totalCount = count,
            offset, limit, items = collection.EnumerateArray().Skip(offset).Take(limit).ToArray(),
            nextOffset = (long)offset + limit < count ? (int?)(offset + limit) : null };
    }
}

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using MyApp.Api.Models;
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

    private static void AddDocumentPrintTools(List<ExpandedTool> tools)
    {
        tools.Add(new("get_document_render_bundle",
            "Everything needed to print one document exactly as its Print button does: the chosen company template (templateId, else the type's default), the actual print data and the company's own images inlined. signed=false prints without a signature, signed=true requires one, omitted prints as the template is set up. Read the JSON bundle in chunks by offset, verify sha256, and render it with the application's templateEngine.mergeTemplate.",
            ExpandedSchema(new
            {
                companyId = new { type = "integer", minimum = 1 },
                documentType = new { type = "string", @enum = PrintTemplateTypes.All },
                documentId = new { type = "integer", minimum = 1 },
                templateId = new { type = "integer", minimum = 1 },
                signed = new { type = "boolean" },
                offset = new { type = "integer", minimum = 0 },
                length = new { type = "integer", minimum = 1, maximum = RenderChunkMax }
            }, "companyId", "documentType", "documentId"), DocumentPrintPermissions, McpScopes.DocumentsRead));
        AddDocumentPrintData(tools);
    }

    private static void AddDocumentPrintData(List<ExpandedTool> tools) => tools.Add(new(
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

    // The print permission and the stored CompanyId are checked before any service loads the document.
    private async Task<object> LoadPrintDtoAsync(int companyId, string type, int? id)
    {
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
        return dto ?? throw new ToolError("Resource unavailable or access denied.");
    }

    private async Task<object> CallDocumentPrintToolAsync(string name, JsonElement args)
    {
        if (name == "get_document_render_bundle") return await RenderBundleAsync(args);
        if (name != "get_document_print_data") throw new ToolError("Unknown tool.");
        var companyId = await CompanyArg(args);
        var type = PrintTypeArg(args);
        var id = IntArg(args, "documentId");
        if (id is not > 0) throw new ToolError("documentId must be a positive integer.");
        var dto = await LoadPrintDtoAsync(companyId, type, id.Value);
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

    private const int RenderChunkMax = 50000;
    private const int RenderAssetMaxBytes = 2 * 1024 * 1024;
    private static readonly Regex OwnedImagePath = new(@"/data/uploads/(?:logos|stamps|quoteitems)/[A-Za-z0-9_./-]+\.(?:png|jpe?g|gif|webp|svg)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex PinnedStampImage = new(@"<img\b[^>]*\{\{\s*stamps\.[a-z0-9_]+\s*\}\}[^>]*>",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private async Task<object> RenderBundleAsync(JsonElement args)
    {
        var companyId = await CompanyArg(args);
        var type = PrintTypeArg(args);
        var id = IntArg(args, "documentId");
        if (id is not > 0) throw new ToolError("documentId must be a positive integer.");
        var dto = await LoadPrintDtoAsync(companyId, type, id.Value);

        // Same choice as the screen's picker: an explicit template, else the default, else the oldest.
        var templates = await _context.PrintTemplates.AsNoTracking()
            .Where(t => t.CompanyId == companyId && t.TemplateType == type).OrderBy(t => t.Id).ToListAsync();
        var template = IntArg(args, "templateId") is { } templateId
            ? templates.SingleOrDefault(t => t.Id == templateId) ?? throw new ToolError($"That is not a {type} template of this company.")
            : templates.FirstOrDefault(t => t.IsDefault) ?? templates.FirstOrDefault()
              ?? throw new ToolError("No print template exists for this document type yet. Add one on the Print Templates page.");

        var stamps = await _context.CompanyStamps.AsNoTracking().Where(s => s.CompanyId == companyId).ToListAsync();
        bool? signed = Has(args, "signed") ? args.GetProperty("signed").ValueKind switch
        {
            JsonValueKind.True => true, JsonValueKind.False => false,
            _ => throw new ToolError("signed must be true or false.")
        } : null;
        bool CarriesSignature(PrintTemplate t) => StampSlot.Detect(t.HtmlContent) switch
        {
            StampSlot.Slotted => t.StampId is { } stampId && stamps.Any(s => s.Id == stampId),
            StampSlot.Pinned => StampSlot.PinnedSlugs(t.HtmlContent).All(slug => stamps.Any(s => s.Slug == slug)),
            _ => false
        };
        var html = template.HtmlContent ?? "";
        var state = StampSlot.Detect(html);
        CompanyStamp? stamp = null;
        var pinned = new List<CompanyStamp>();
        if (signed == false)
            html = PinnedStampImage.Replace(html, "");
        else
        {
            if (signed == true && !CarriesSignature(template))
            {
                var signedNames = templates.Where(CarriesSignature).Select(t => $"#{t.Id} {t.Name}").ToList();
                throw new ToolError($"Template #{template.Id} \"{template.Name}\" has no signature to print. " + (signedNames.Count > 0
                    ? $"Signed {type} templates: {string.Join(", ", signedNames)}."
                    : $"No {type} template of this company carries a signature."));
            }
            // As configured: the assigned stamp fills the slot; pinned tokens see every company stamp.
            stamp = state == StampSlot.Slotted && template.StampId is { } sid ? stamps.SingleOrDefault(s => s.Id == sid) : null;
            if (state == StampSlot.Pinned) pinned = stamps;
        }

        var logo = await _context.Companies.AsNoTracking().Where(c => c.Id == companyId).Select(c => c.LogoPath).SingleOrDefaultAsync();
        var dataRoot = Path.GetFullPath(Path.Combine(HttpContext.RequestServices.GetRequiredService<IWebHostEnvironment>().ContentRootPath, "data"));
        string Inline(string path)
        {
            // Only this company's own uploads are inlined; anything else stays as written.
            var owned = path.StartsWith("/data/uploads/logos/", StringComparison.OrdinalIgnoreCase) ? path == logo
                : path.StartsWith("/data/uploads/stamps/", StringComparison.OrdinalIgnoreCase) ? stamps.Any(s => s.FilePath == path)
                : QuoteLineImages.CompanyId(path) == companyId;
            if (!owned) return path;
            var file = Path.GetFullPath(Path.Combine(dataRoot, path["/data/".Length..]));
            if (!file.StartsWith(dataRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
                || !System.IO.File.Exists(file) || new FileInfo(file).Length > RenderAssetMaxBytes) return path;
            var mime = Path.GetExtension(file).ToLowerInvariant() switch
            {
                ".png" => "image/png", ".gif" => "image/gif", ".webp" => "image/webp", ".svg" => "image/svg+xml", _ => "image/jpeg"
            };
            return $"data:{mime};base64,{Convert.ToBase64String(System.IO.File.ReadAllBytes(file))}";
        }
        string InlineAll(string text) => OwnedImagePath.Replace(text, m => Inline(m.Value));

        using var data = JsonDocument.Parse(InlineAll(JsonSerializer.Serialize(dto, dto.GetType(), Json)));
        var bundle = JsonSerializer.Serialize(new
        {
            companyId, documentType = type, documentId = id.Value,
            template = new { id = template.Id, name = template.Name, isDefault = template.IsDefault, stampState = state },
            signed = stamp != null || pinned.Count > 0,
            html = InlineAll(html),
            data = data.RootElement,
            stamp = stamp == null ? null : Inline(stamp.FilePath),
            stamps = pinned.ToDictionary(s => s.Slug, s => Inline(s.FilePath))
        }, Json);
        var offset = NonNegativeArg(args, "offset");
        var length = Math.Clamp(NonNegativeArg(args, "length", RenderChunkMax), 1, RenderChunkMax);
        var count = Math.Min(length, Math.Max(0, bundle.Length - offset));
        return new
        {
            companyId, documentType = type, documentId = id.Value, totalCharacters = bundle.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(bundle))).ToLowerInvariant(),
            offset, content = count == 0 ? "" : bundle.Substring(offset, count),
            nextOffset = (long)offset + count < bundle.Length ? (int?)(offset + count) : null
        };
    }
}

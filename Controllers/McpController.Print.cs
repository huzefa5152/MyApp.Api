using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Print designs (read only on this line) and the actual print data a screen prints for a
    /// document, without recalculation. Both need their own explicit token scope
    /// (templates.read / documents.read) because they carry operator HTML and full documents.
    /// </summary>
    public partial class McpController
    {
        private static readonly string[] PrintSections = { "items", "billItems", "allocations", "challanNumbers", "challanDates", "goodsReceiptNumbers", "linkedSaleBillNumbers" };

        private void AddPrintTools(List<Tool> t)
        {
            var type = new { type = "string", @enum = PrintTemplateTypes.All };
            t.AddRange(new Tool[]
            {
                new("list_print_templates", "Print designs and metadata for one company; content omitted.",
                    Obj(new { companyId = CompanyProp, documentType = type, offset = new { type = "integer", minimum = 0 }, limit = new { type = "integer", minimum = 1, maximum = MaxToolRows } }, "companyId"),
                    Read: ListPrintTemplatesAsync),
                new("get_print_template", "Read one template section (metadata, html or project), at most 16000 characters at a time.",
                    Obj(new { companyId = CompanyProp, templateId = Int(), section = new { type = "string", @enum = new[] { "metadata", "html", "project" } }, offset = new { type = "integer", minimum = 0 }, length = new { type = "integer", minimum = 1, maximum = 16000 } }, "companyId", "templateId"),
                    Read: GetPrintTemplateAsync),
                new("get_print_contract", "Merge fields and helpers for a document type; no business data.",
                    Obj(new { documentType = type }, "documentType"), Read: GetPrintContractAsync),
                new("get_document_print_data", "A document's actual print data as its screen prints it. The header omits inline images and lists; read a list section separately.",
                    Obj(new { companyId = CompanyProp, documentType = type, documentId = Int(), section = new { type = "string", @enum = new[] { "header" }.Concat(PrintSections).ToArray() }, offset = new { type = "integer", minimum = 0 }, limit = new { type = "integer", minimum = 1, maximum = MaxToolRows } }, "companyId", "documentType", "documentId"),
                    Read: GetDocumentPrintDataAsync),
            });
        }

        private static string PrintRevision(PrintTemplate t) =>
            Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
            {
                t.Id, t.CompanyId, t.TemplateType, t.Name, t.HtmlContent, t.TemplateJson, t.EditorMode,
                t.IsDefault, t.ExcelTemplatePath, t.ExcelSheetName, t.StampId, t.UpdatedAt,
            })))).ToLowerInvariant();

        private static object PrintMetadata(PrintTemplate t) => new
        {
            id = t.Id, companyId = t.CompanyId, divisionId = t.DivisionId, documentType = t.TemplateType, name = t.Name,
            isDefault = t.IsDefault, editorMode = t.EditorMode, stampId = t.StampId, stampState = StampSlot.Detect(t.HtmlContent),
            hasExcelTemplate = !string.IsNullOrEmpty(t.ExcelTemplatePath), updatedAt = t.UpdatedAt, revision = PrintRevision(t),
        };

        private static string PrintTypeArg(JsonElement args, bool optional = false)
        {
            var type = OptText(args, "documentType", 40);
            if (optional && string.IsNullOrEmpty(type)) return "";
            return PrintTemplateTypes.All.Contains(type, StringComparer.Ordinal) ? type! : throw new ToolError("Unknown document type.");
        }

        private async Task<List<PrintTemplate>> VisibleTemplatesAsync(int companyId)
        {
            var rows = (await Svc<IPrintTemplateRepository>().GetByCompanyAsync(companyId)).Where(x => x.CompanyId == companyId).ToList();
            var scope = await DivisionScopeAsync(companyId);
            return scope == null ? rows : rows.Where(x => x.DivisionId == null || scope.Contains(x.DivisionId.Value)).ToList();
        }

        private async Task<object> ListPrintTemplatesAsync(JsonElement args)
        {
            await Need("printtemplates.manage.view");
            var companyId = await CompanyArg(args);
            var type = PrintTypeArg(args, optional: true);
            var rows = (await VisibleTemplatesAsync(companyId)).Where(x => type == "" || x.TemplateType == type)
                .OrderBy(x => x.TemplateType).ThenBy(x => x.Id).ToList();
            var (offset, limit) = Window(args);
            return new { companyId, totalCount = rows.Count, offset, items = rows.Skip(offset).Take(limit).Select(PrintMetadata) };
        }

        private async Task<object> GetPrintTemplateAsync(JsonElement args)
        {
            await Need("printtemplates.manage.view");
            var companyId = await CompanyArg(args);
            var id = IdArg(args, "templateId");
            var template = (await VisibleTemplatesAsync(companyId)).FirstOrDefault(x => x.Id == id) ?? throw new ToolError(Denied);
            var section = OptText(args, "section", 20) ?? "metadata";
            if (section == "metadata") return PrintMetadata(template);
            if (section is not ("html" or "project")) throw new ToolError("section must be metadata, html or project.");
            var text = section == "html" ? template.HtmlContent : template.TemplateJson ?? "";
            var offset = Math.Max(0, IntArg(args, "offset") ?? 0);
            var length = Math.Clamp(IntArg(args, "length") ?? 16000, 1, 16000);
            var count = Math.Min(length, Math.Max(0, text.Length - offset));
            return new
            {
                companyId, templateId = id, revision = PrintRevision(template), section, totalCharacters = text.Length, offset,
                content = count == 0 ? "" : text.Substring(offset, count),
                nextOffset = (long)offset + count < text.Length ? (int?)(offset + count) : null,
            };
        }

        private async Task<object> GetPrintContractAsync(JsonElement args)
        {
            await Need("printtemplates.manage.view");
            var type = PrintTypeArg(args);
            var fields = await _context.MergeFields.AsNoTracking().Where(m => m.TemplateType == type)
                .OrderBy(m => m.SortOrder).ThenBy(m => m.Id)
                .Select(m => new { expression = m.FieldExpression, label = m.Label, category = m.Category }).ToListAsync();
            return new
            {
                documentType = type, fields,
                guidance = "Render with the application's template engine. Presentation must keep service-computed amounts; do not infer absent fields.",
            };
        }

        private async Task<object> GetDocumentPrintDataAsync(JsonElement args)
        {
            var companyId = await CompanyArg(args);
            var type = PrintTypeArg(args);
            var id = IdArg(args, "documentId");
            var permission = type switch
            {
                "Challan" => "challans.print.view", "Bill" => "bills.print.view",
                "TaxInvoice" or "CreditNote" or "DebitNote" => "invoices.print.view",
                "SalesQuote" => "salesquotes.print.view", "SalesOrder" => "salesorders.print.view",
                "PurchaseBill" => "purchasebills.print.view", "GoodsReceipt" => "goodsreceipts.print.view",
                "Receipt" => "accounting.receipts.print", "Payment" => "accounting.payments.print",
                _ => throw new ToolError("That document type has no print data here."),
            };
            await Need(permission);
            // Ownership and division in SQL before any service loads parties or lines.
            (bool Found, int? Division) owner = type switch
            {
                "Challan" => await Owner(_context.DeliveryChallans.Where(x => x.Id == id && x.CompanyId == companyId).Select(x => new { x.DivisionId })),
                "Bill" or "TaxInvoice" => await Owner(_context.Invoices.Where(x => x.Id == id && x.CompanyId == companyId && x.NoteKind == 0).Select(x => new { x.DivisionId })),
                "DebitNote" => await Owner(_context.Invoices.Where(x => x.Id == id && x.CompanyId == companyId && x.NoteKind == 1).Select(x => new { x.DivisionId })),
                "CreditNote" => await Owner(_context.Invoices.Where(x => x.Id == id && x.CompanyId == companyId && x.NoteKind == 2).Select(x => new { x.DivisionId })),
                "SalesQuote" => await Owner(_context.SalesQuotes.Where(x => x.Id == id && x.CompanyId == companyId).Select(x => new { x.DivisionId })),
                "SalesOrder" => await Owner(_context.SalesOrders.Where(x => x.Id == id && x.CompanyId == companyId).Select(x => new { x.DivisionId })),
                "PurchaseBill" => await Owner(_context.PurchaseBills.Where(x => x.Id == id && x.CompanyId == companyId).Select(x => new { x.DivisionId })),
                "GoodsReceipt" => await Owner(_context.GoodsReceipts.Where(x => x.Id == id && x.CompanyId == companyId).Select(x => new { x.DivisionId })),
                "Receipt" => await Owner(_context.Payments.Where(x => x.Id == id && x.CompanyId == companyId && x.Direction == PaymentDirection.Receipt).Select(x => new { x.DivisionId })),
                "Payment" => await Owner(_context.Payments.Where(x => x.Id == id && x.CompanyId == companyId && x.Direction == PaymentDirection.Payment).Select(x => new { x.DivisionId })),
                _ => (false, null),
            };
            if (!owner.Found) throw new ToolError(Denied);
            await AssertDivisionReadAsync(companyId, owner.Division);
            object? dto = type switch
            {
                "Challan" => await Svc<IDeliveryChallanService>().GetPrintDataAsync(id),
                "Bill" => await Svc<IInvoiceService>().GetPrintBillAsync(id),
                "TaxInvoice" or "CreditNote" or "DebitNote" => await Svc<IInvoiceService>().GetPrintTaxInvoiceAsync(id),
                "SalesQuote" => await Svc<ISalesQuoteService>().GetPrintDataAsync(id),
                "SalesOrder" => await Svc<ISalesOrderService>().GetPrintDataAsync(id),
                "PurchaseBill" => await Svc<IPurchaseBillService>().GetPrintDataAsync(id),
                "GoodsReceipt" => await Svc<IGoodsReceiptService>().GetPrintDataAsync(id),
                "Receipt" or "Payment" => await Svc<IPaymentService>().GetPrintDataAsync(id),
                _ => null,
            };
            if (dto == null) throw new ToolError(Denied);
            var data = JsonSerializer.SerializeToElement(dto, dto.GetType(), Json);
            var section = OptText(args, "section", 40) ?? "header";
            if (section == "header")
            {
                var header = new Dictionary<string, JsonElement>();
                var collections = new Dictionary<string, int>();
                var omittedAssets = new List<string>();
                foreach (var p in data.EnumerateObject())
                {
                    if (p.Value.ValueKind == JsonValueKind.Array) collections[p.Name] = p.Value.GetArrayLength();
                    else if (p.Value.ValueKind == JsonValueKind.String && p.Value.GetString()!.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) omittedAssets.Add(p.Name);
                    else header[p.Name] = p.Value.Clone();
                }
                return new { companyId, documentType = type, documentId = id, section, data = header, collections, omittedAssets };
            }
            if (!PrintSections.Contains(section) || !data.TryGetProperty(section, out var list) || list.ValueKind != JsonValueKind.Array)
                throw new ToolError("That list is not available on this document type.");
            var (offset, limit) = Window(args);
            var total = list.GetArrayLength();
            return new
            {
                companyId, documentType = type, documentId = id, section, totalCount = total, offset,
                items = list.EnumerateArray().Skip(offset).Take(limit).Select(e => e.Clone()).ToArray(),
                nextOffset = (long)offset + limit < total ? (int?)(offset + limit) : null,
            };

            static async Task<(bool, int?)> Owner<T>(IQueryable<T> q) where T : class
            {
                var row = await q.AsNoTracking().FirstOrDefaultAsync();
                if (row == null) return (false, null);
                return (true, (int?)row.GetType().GetProperty("DivisionId")!.GetValue(row));
            }
        }
    }
}

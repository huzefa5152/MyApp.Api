using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Helpers;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Models;

namespace MyApp.Api.Controllers;

public partial class McpController
{
    private static void AddPrintTools(List<ExpandedTool> tools)
    {
        var company = new { type = "integer", minimum = 1 };
        var type = new { type = "string", @enum = PrintTemplateTypes.All };
        var id = new { type = "integer", minimum = 1 };
        tools.Add(new("list_print_templates", "Print designs and metadata for one company; content omitted. Page using offset/limit.",
            ExpandedSchema(new { companyId = company, documentType = type, offset = new { type = "integer", minimum = 0 }, limit = new { type = "integer", minimum = 1, maximum = 100 } }, "companyId"),
            new[] { "printtemplates.manage.view" }, McpScopes.TemplatesRead));
        tools.Add(new("get_print_template", "Read one template section (html, project, metadata), at most 16000 characters. Revision covers content and metadata.",
            ExpandedSchema(new { companyId = company, templateId = id, section = new { type = "string", @enum = new[] { "metadata", "html", "project" } },
                offset = new { type = "integer", minimum = 0 }, length = new { type = "integer", minimum = 1, maximum = 16000 } }, "companyId", "templateId"),
            new[] { "printtemplates.manage.view" }, McpScopes.TemplatesRead));
        tools.Add(new("get_print_contract", "Merge fields and supported helpers for a document type; no business data. Reuse the existing print renderer.",
            ExpandedSchema(new { documentType = type }, "documentType"), new[] { "printtemplates.manage.view" }, McpScopes.TemplatesRead));
    }

    private static string PrintRevision(PrintTemplate t) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        {
            t.Id, t.CompanyId, t.TemplateType, t.Name, t.HtmlContent, t.TemplateJson, t.EditorMode,
            t.IsDefault, t.ExcelTemplatePath, t.ExcelSheetName, t.StampId, t.UpdatedAt
        })))).ToLowerInvariant();

    private static object PrintMetadata(PrintTemplate t) => new
    {
        id = t.Id, companyId = t.CompanyId, documentType = t.TemplateType, name = t.Name,
        isDefault = t.IsDefault, editorMode = t.EditorMode, stampId = t.StampId,
        stampState = StampSlot.Detect(t.HtmlContent), hasExcelTemplate = !string.IsNullOrEmpty(t.ExcelTemplatePath),
        excelSheetName = t.ExcelSheetName, updatedAt = t.UpdatedAt, revision = PrintRevision(t)
    };

    private static int NonNegativeArg(JsonElement args, string name, int fallback = 0)
    {
        if (!Has(args, name)) return fallback;
        var value = IntArg(args, name);
        return value is >= 0 ? value.Value : throw new ToolError($"{name} must be a non-negative integer.");
    }

    private static string PrintTypeArg(JsonElement args, bool optional = false)
    {
        var type = OptText(args, "documentType", 40);
        if (optional && string.IsNullOrEmpty(type)) return "";
        return PrintTemplateTypes.All.Contains(type, StringComparer.Ordinal) ? type! : throw new ToolError("Unknown document type.");
    }

    private async Task<object> CallPrintToolAsync(string name, JsonElement args)
    {
        if (name == "get_print_contract")
        {
            var type = PrintTypeArg(args);
            var fields = await _context.MergeFields.AsNoTracking().Where(m => m.TemplateType == type)
                .OrderBy(m => m.SortOrder).ThenBy(m => m.Id)
                .Select(m => new { expression = m.FieldExpression, label = m.Label, category = m.Category }).ToListAsync();
            return new { documentType = type, fields,
                helpers = new[] { "fmtDate", "fmtDMY", "fmt", "fmtDec", "fmtQty", "nl2br", "richText", "join", "joinDates", "emptyRows", "math", "gt", "eq", "or", "uniqueTypes", "inc", "billEmptyRows", "taxEmptyRows", "if", "unless", "each", "with" },
                guidance = "Render with the application's templateEngine and stamp resolution. Presentation must preserve service-computed amounts; do not infer absent fields." };
        }
        var companyId = await CompanyArg(args);
        var repo = HttpContext.RequestServices.GetRequiredService<IPrintTemplateRepository>();
        if (name == "list_print_templates")
        {
            var type = PrintTypeArg(args, true);
            var rows = (await repo.GetByCompanyAsync(companyId)).Where(t => t.CompanyId == companyId && (type == "" || t.TemplateType == type))
                .OrderBy(t => t.TemplateType).ThenBy(t => t.Id).ToList();
            var offset = NonNegativeArg(args, "offset");
            var limit = Size(args, "limit");
            return new { companyId, totalCount = rows.Count, items = rows.Skip(offset).Take(limit).Select(PrintMetadata),
                nextOffset = (long)offset + limit < rows.Count ? (int?)(offset + limit) : null };
        }
        if (name == "get_print_template")
        {
            var id = IntArg(args, "templateId") ?? throw new ToolError("templateId is required.");
            var template = await repo.GetByIdAsync(id);
            if (template == null || template.CompanyId != companyId) throw new ToolError("Resource unavailable or access denied.");
            var section = OptText(args, "section", 20) ?? "metadata";
            if (section == "metadata") return PrintMetadata(template);
            if (section is not ("html" or "project")) throw new ToolError("section must be metadata, html or project.");
            var text = section == "html" ? template.HtmlContent : template.TemplateJson ?? "";
            var offset = NonNegativeArg(args, "offset");
            var length = Math.Clamp(NonNegativeArg(args, "length", 16000), 1, 16000);
            var count = Math.Min(length, Math.Max(0, text.Length - offset));
            return new { companyId, templateId = id, revision = PrintRevision(template), section,
                totalCharacters = text.Length, offset, content = count == 0 ? "" : text.Substring(offset, count),
                nextOffset = (long)offset + count < text.Length ? (int?)(offset + count) : null };
        }
        throw new ToolError("Unknown tool.");
    }
}

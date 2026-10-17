using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Data;
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
        tools.Add(new("prepare_print_template_update", "Prepare edits to an existing company's print template of any supported document type. Read its revision first. Nothing is saved until commit_action after human approval. Sanitized HTML is shown in the plan; saving switches to code mode and clears stale visual project data. Default, stamp and Excel assignments are preserved. Existing tokens need explicit templates.write authorization.",
            ExpandedSchema(new { companyId = company, templateId = id, documentType = type,
                revision = new { type = "string", minLength = 64, maxLength = 64 },
                htmlContent = new { type = "string", minLength = 1, maxLength = 24000 },
                name = new { type = "string", minLength = 1, maxLength = 200 },
                idempotencyKey = new { type = "string", maxLength = 100 } },
                "companyId", "templateId", "documentType", "revision", "htmlContent"),
            new[] { "printtemplates.manage.update" }, McpScopes.TemplatesWrite, Writes: true));
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
        if (name == "prepare_print_template_update") return await PreparePrintTemplateAsync(args);
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

    private async Task<object> PreparePrintTemplateAsync(JsonElement args)
    {
        var agent = await RequireWriterAsync(McpScopes.TemplatesWrite);
        await Need("printtemplates.manage.view");
        await Need("printtemplates.manage.update");
        var companyId = await CompanyArg(args);
        var id = IntArg(args, "templateId") is { } n and > 0 ? n : throw new ToolError("templateId must be positive.");
        var type = PrintTypeArg(args);
        var revision = OptText(args, "revision", 64);
        if (revision?.Length != 64 || revision.Any(c => !Uri.IsHexDigit(c))) throw new ToolError("A saved template revision is required.");
        var key = IdemKey(args);
        if (await PriorForKeyAsync(agent, key, companyId, McpScopes.TemplatesWrite) is { } prior) return prior;
        var template = await _context.PrintTemplates.AsNoTracking().SingleOrDefaultAsync(t => t.Id == id && t.CompanyId == companyId);
        if (template == null || template.TemplateType != type) throw new ToolError("Resource unavailable or access denied.");
        if (PrintRevision(template) != revision) throw new ToolError("The template changed. Read it again and prepare a new plan.");
        var html = OptText(args, "htmlContent", 24000);
        if (string.IsNullOrWhiteSpace(html)) throw new ToolError("htmlContent is required.");
        html = TemplateHtmlSafety.Strip(html)!;
        if (string.IsNullOrWhiteSpace(html)) throw new ToolError("htmlContent must contain printable content.");
        var name = OptText(args, "name", 200) ?? template.Name;
        if (string.IsNullOrWhiteSpace(name)) throw new ToolError("name must not be blank.");
        var payload = new { templateId = id, documentType = type, revision, name, htmlContent = html,
            editorMode = "code", templateJson = (string?)null, isDefault = template.IsDefault,
            stampId = template.StampId, clearsVisualProject = template.TemplateJson != null };
        if (Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(payload, Json)) > 40000)
            throw new ToolError("The printable content is too large for one reviewed MCP plan. Use the template editor for this design.");
        return await StorePlanAsync(agent, "template.update", companyId, payload,
            $"Update {type} print template #{id} \"{name}\" in company #{companyId}; preserve default, stamp and Excel settings; save in code mode", key);
    }

    private async Task<(string Ref, string Summary)> CommitPrintTemplateAsync(McpPendingAction plan, JsonElement payload)
    {
        await Need("printtemplates.manage.view");
        await Need("printtemplates.manage.update");
        await PinCompanyAsync(plan.CompanyId);
        var id = payload.GetProperty("templateId").GetInt32();
        // The update lock closes the gap between checking the revision and saving.
        // Ordinary template saves acquire the same row's write lock.
        await using var tx = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        var template = await _context.PrintTemplates.FromSqlInterpolated(
            $"SELECT * FROM PrintTemplates WITH (UPDLOCK, ROWLOCK) WHERE Id = {id} AND CompanyId = {plan.CompanyId}")
            .AsNoTracking().SingleOrDefaultAsync();
        if (template == null || template.TemplateType != payload.GetProperty("documentType").GetString())
            throw new ToolError("Resource unavailable or access denied.");
        if (PrintRevision(template) != payload.GetProperty("revision").GetString())
            throw new ToolError("The template changed. Read it again and prepare a new plan.");
        var repo = HttpContext.RequestServices.GetRequiredService<IPrintTemplateRepository>();
        var updated = await repo.UpdateContentAsync(id, payload.GetProperty("name").GetString()!,
            payload.GetProperty("htmlContent").GetString()!, null, "code")
            ?? throw new ToolError("Resource unavailable or access denied.");
        _context.AuditLogs.Add(new AuditLog { Timestamp = DateTime.UtcNow, Level = "Information",
            UserName = User.Identity?.Name, CompanyId = plan.CompanyId, HttpMethod = "POST", RequestPath = "/mcp",
            StatusCode = 200, ExceptionType = "PrintTemplateUpdated",
            Message = $"MCP updated {updated.TemplateType} template #{id} by user #{CurrentUserId}" });
        await _context.SaveChangesAsync();
        await tx.CommitAsync();
        return ($"PrintTemplate:{id}", $"Updated {updated.TemplateType} print template #{id} \"{updated.Name}\"");
    }
}

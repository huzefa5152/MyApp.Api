using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers;

/// <summary>
/// The Stamps tab over MCP: list, see, add, replace, rename, set default, delete, and assign a stamp
/// to a template. Writes go through ICompanyStampService and the template repository, the same code
/// the screen uses, and every stamp or template reached by id must belong to the plan's company.
/// </summary>
public partial class McpController
{
    private const int StampChangesPerHour = 30;
    // An image travels inside the JSON-RPC body, so it has its own ceiling, lower than the screen's.
    private const int MaxStampImageBytes = 256 * 1024;
    private const int MaxStampImageBase64 = (MaxStampImageBytes + 2) / 3 * 4;
    private const int MaxStampBodyBytes = MaxStampImageBase64 + 8 * 1024;
    private const int MaxStampInlineCharacters = 100_000;
    private const string StampSlotMarkup = "<span class=\"stamp-slot\" style=\"display:block;text-align:center\"><img class=\"stamp-img\" src=\"{{stamp}}\" alt=\"Signature stamp\" style=\"display:block;height:64px;max-width:180px;object-fit:contain;margin:0 auto 4px\"></span>";

    private static void AddStampTools(List<ExpandedTool> tools)
    {
        var company = new { type = "integer", minimum = 1 };
        var id = new { type = "integer", minimum = 1 };
        tools.Add(new("list_company_stamps", "A company's stamp and signature images: id, name, merge field, default, how many templates use each, and the revision to prepare a change. No image data. slotMarkup is the block to add to a template that has no signature slot.",
            ExpandedSchema(new { companyId = company }, "companyId"),
            new[] { "printtemplates.stamps.view" }, McpScopes.TemplatesRead));
        tools.Add(new("get_company_stamp", "One stamp with its image as a data URL. A large image is left out; see it on the Stamps tab.",
            ExpandedSchema(new { companyId = company, stampId = id }, "companyId", "stampId"),
            new[] { "printtemplates.stamps.view" }, McpScopes.TemplatesRead));
        tools.Add(new("prepare_company_stamp", "Prepare one stamp change. add: new stamp from imageBase64 and fileName. replace: new image for stampId, keeping its merge field and every template using it. rename: new name. set_default. delete: templates using it print unsigned, and {{stamps.<slug>}} shows a broken image. assign_template: stampId on templateId, or no stampId to remove it; to add a slot or convert {{stamps.<slug>}} to {{stamp}}, send the rewritten htmlContent too. replace, rename, set_default and delete need the stamp's revision; assign_template needs the template's revision from list_print_templates. Images are PNG, JPG, WebP or GIF up to 256 KB here; larger ones go through the Stamps tab. Nothing is saved until commit_action after human approval.",
            ExpandedSchema(new
            {
                companyId = company,
                action = new { type = "string", @enum = new[] { "add", "replace", "rename", "set_default", "delete", "assign_template" } },
                stampId = id,
                templateId = id,
                revision = new { type = "string", minLength = 64, maxLength = 64 },
                name = new { type = "string", minLength = 1, maxLength = 100 },
                fileName = new { type = "string", minLength = 1, maxLength = 200, description = "The image's file name; its extension sets the format." },
                imageBase64 = new { type = "string", maxLength = MaxStampImageBase64 + 40, description = "The image as base64, or a data URL." },
                htmlContent = new { type = "string", minLength = 1, maxLength = 24000 },
                idempotencyKey = new { type = "string", maxLength = 100 }
            }, "companyId", "action"),
            new[] { "printtemplates.stamps.manage", "printtemplates.manage.update" }, McpScopes.TemplatesWrite, Writes: true));
    }

    private static string StampRevision(CompanyStamp s) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        {
            s.Id,
            s.CompanyId,
            s.Name,
            s.Slug,
            s.FilePath,
            s.IsDefault,
            s.SortOrder,
            s.UpdatedAt
        })))).ToLowerInvariant();

    private static object StampMetadata(CompanyStamp s, int usedByTemplates) => new
    {
        id = s.Id,
        companyId = s.CompanyId,
        name = s.Name,
        slug = s.Slug,
        mergeField = $"{{{{stamps.{s.Slug}}}}}",
        isDefault = s.IsDefault,
        sortOrder = s.SortOrder,
        usedByTemplates,
        updatedAt = s.UpdatedAt,
        revision = StampRevision(s)
    };

    private async Task<object> CallStampToolAsync(string name, JsonElement args)
    {
        if (name == "prepare_company_stamp") return await PrepareStampAsync(args);
        var companyId = await CompanyArg(args);
        var repo = OperationService<ICompanyStampRepository>();
        if (name == "list_company_stamps")
        {
            var usage = await repo.TemplateUsageCountsAsync(companyId);
            var items = (await repo.GetByCompanyAsync(companyId)).Select(s => StampMetadata(s, usage.GetValueOrDefault(s.Id)));
            return new { companyId, items, slotMarkup = StampSlotMarkup };
        }
        var stamp = await OwnStampAsync(repo, args, companyId);
        var root = OperationService<IWebHostEnvironment>().ContentRootPath;
        var image = await PrivateImageDataUrl.ReadAsync(root, stamp.FilePath);
        var tooLarge = image?.Length > MaxStampInlineCharacters;
        return new
        {
            stamp = StampMetadata(stamp, await repo.TemplateUsageCountAsync(stamp.Id)),
            image = tooLarge ? null : image,
            note = tooLarge ? "The image is too large to include. See it on the Stamps tab." : image == null ? "The image file could not be read." : null
        };
    }

    private async Task<CompanyStamp> OwnStampAsync(ICompanyStampRepository repo, JsonElement args, int companyId)
    {
        var id = IntArg(args, "stampId") ?? throw new ToolError("stampId is required.");
        var stamp = await repo.GetByIdAsync(id);
        return stamp == null || stamp.CompanyId != companyId ? throw new ToolError("Resource unavailable or access denied.") : stamp;
    }

    private static (byte[] Bytes, string FileName) StampImageArg(JsonElement args)
    {
        var text = OptText(args, "imageBase64", MaxStampImageBase64 + 40);
        var fileName = Path.GetFileName(OptText(args, "fileName", 200) ?? "");
        if (string.IsNullOrEmpty(text) || string.IsNullOrEmpty(fileName)) throw new ToolError("imageBase64 and fileName are required.");
        if (text.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) text = text[(text.IndexOf(',') + 1)..];
        var bytes = new byte[Math.Min(text.Length, MaxStampImageBase64) / 4 * 3 + 3];
        if (text.Length > MaxStampImageBase64 || !Convert.TryFromBase64String(text, bytes, out var written))
            throw new ToolError("imageBase64 must be valid base64, at most 256 KB of image.");
        if (written > MaxStampImageBytes) throw new ToolError("The image is over 256 KB. Upload it on the Stamps tab.");
        Array.Resize(ref bytes, written);
        using var check = new MemoryStream(bytes);
        var error = ImageUploadValidator.Validate(StampFormFile(check, fileName), ImageUploadValidator.LogoMaxBytes);
        return error != null ? throw new ToolError(error) : (bytes, fileName);
    }

    private static FormFile StampFormFile(Stream content, string fileName) => new(content, 0, content.Length, "file", fileName);

    private async Task<object> PrepareStampAsync(JsonElement args)
    {
        var agent = await RequireWriterAsync(McpScopes.TemplatesWrite);
        var action = OptText(args, "action", 20);
        var kind = action switch
        {
            "add" => "stamp.add",
            "replace" => "stamp.replace",
            "rename" => "stamp.rename",
            "set_default" => "stamp.default",
            "delete" => "stamp.delete",
            "assign_template" => "stamp.assign",
            _ => throw new ToolError("Unknown stamp action.")
        };
        await Need(PermissionFor(kind));
        await Need(ReadPermissionFor(kind)!);
        var companyId = await CompanyArg(args);
        var key = IdemKey(args);
        if (await PriorForKeyAsync(agent, key, companyId, McpScopes.TemplatesWrite) is { } prior) return prior;

        var revision = OptText(args, "revision", 64);
        if (kind != "stamp.add" && (revision?.Length != 64 || revision.Any(c => !Uri.IsHexDigit(c))))
            throw new ToolError("A current revision is required. Read it first.");
        var repo = OperationService<ICompanyStampRepository>();

        if (kind == "stamp.assign") return await PrepareStampAssignmentAsync(agent, repo, args, companyId, revision!, key);

        if (kind == "stamp.add")
        {
            var image = StampImageArg(args);
            var name = OptText(args, "name", 100);
            var label = string.IsNullOrWhiteSpace(name) ? Path.GetFileNameWithoutExtension(image.FileName) : name;
            return await StorePlanAsync(agent, kind, companyId, new { action, name, fileName = image.FileName, imageBytes = image.Bytes.Length, imageSha256 = Convert.ToHexString(SHA256.HashData(image.Bytes)).ToLowerInvariant(), imageBase64 = Convert.ToBase64String(image.Bytes) },
                $"Add stamp \"{label}\" ({image.Bytes.Length} bytes) to company #{companyId}", key);
        }

        var stamp = await OwnStampAsync(repo, args, companyId);
        if (StampRevision(stamp) != revision) throw new ToolError("The stamp changed. Read it again and prepare a new plan.");
        var usedBy = await repo.TemplateUsageCountAsync(stamp.Id);
        var field = $"{{{{stamps.{stamp.Slug}}}}}";
        switch (kind)
        {
            case "stamp.replace":
                var image = StampImageArg(args);
                return await StorePlanAsync(agent, kind, companyId, new { action, stampId = stamp.Id, revision, name = stamp.Name, mergeField = field, usedByTemplates = usedBy, fileName = image.FileName, imageBytes = image.Bytes.Length, imageSha256 = Convert.ToHexString(SHA256.HashData(image.Bytes)).ToLowerInvariant(), imageBase64 = Convert.ToBase64String(image.Bytes) },
                    $"Replace the image of stamp \"{stamp.Name}\" ({field}) in company #{companyId} with a new {image.Bytes.Length} byte image; every template using it shows the new image", key);
            case "stamp.rename":
                var name = OptText(args, "name", 100);
                if (string.IsNullOrWhiteSpace(name)) throw new ToolError("name is required.");
                return await StorePlanAsync(agent, kind, companyId, new { action, stampId = stamp.Id, revision, oldName = stamp.Name, name, mergeField = field },
                    $"Rename stamp \"{stamp.Name}\" to \"{name}\" in company #{companyId}; its merge field {field} stays", key);
            case "stamp.default":
                return await StorePlanAsync(agent, kind, companyId, new { action, stampId = stamp.Id, revision, name = stamp.Name },
                    $"Make \"{stamp.Name}\" the default stamp of company #{companyId}", key);
            default:
                return await StorePlanAsync(agent, kind, companyId, new { action, stampId = stamp.Id, revision, name = stamp.Name, mergeField = field, usedByTemplates = usedBy },
                    $"Delete stamp \"{stamp.Name}\" from company #{companyId}; {usedBy} template(s) using it will print unsigned, and {field} will show a broken image", key);
        }
    }

    private async Task<object> PrepareStampAssignmentAsync(McpAgentToken agent, ICompanyStampRepository repo, JsonElement args, int companyId, string revision, string? key)
    {
        var templateId = IntArg(args, "templateId") ?? throw new ToolError("templateId is required.");
        var template = await _context.PrintTemplates.AsNoTracking().SingleOrDefaultAsync(t => t.Id == templateId && t.CompanyId == companyId)
            ?? throw new ToolError("Resource unavailable or access denied.");
        if (PrintRevision(template) != revision) throw new ToolError("The template changed. Read it again and prepare a new plan.");
        var stamp = Has(args, "stampId") ? await OwnStampAsync(repo, args, companyId) : null;
        var html = OptText(args, "htmlContent", 24000);
        if (html != null)
        {
            html = TemplateHtmlSafety.Strip(html)!;
            if (string.IsNullOrWhiteSpace(html)) throw new ToolError("htmlContent must contain printable content.");
        }
        if (stamp != null && StampSlot.Detect(html ?? template.HtmlContent) != StampSlot.Slotted)
            throw new ToolError("This template has no {{stamp}} slot, so the stamp would not print. Send htmlContent with the slot added.");
        return await StorePlanAsync(agent, "stamp.assign", companyId, new { action = "assign_template", templateId, revision, documentType = template.TemplateType, template = template.Name, stampId = stamp?.Id, stamp = stamp?.Name, htmlContent = html },
            (stamp == null ? $"Remove the stamp from {template.TemplateType} template \"{template.Name}\"" : $"Use stamp \"{stamp.Name}\" on {template.TemplateType} template \"{template.Name}\"")
            + (html == null ? "" : ", and save its rewritten HTML") + $" in company #{companyId}", key);
    }

    private async Task<(string Ref, string Summary)> CommitStampAsync(McpPendingAction plan, JsonElement p)
    {
        await PinCompanyAsync(plan.CompanyId);
        var companyId = plan.CompanyId;
        var service = OperationService<ICompanyStampService>();
        if (plan.Kind == "stamp.assign") return await CommitStampAssignmentAsync(companyId, p);

        string message;
        CompanyStamp stamp;
        if (plan.Kind == "stamp.add")
        {
            using var content = new MemoryStream(Convert.FromBase64String(p.GetProperty("imageBase64").GetString()!));
            stamp = await service.AddAsync(companyId, StampFormFile(content, p.GetProperty("fileName").GetString()!), p.TryGetProperty("name", out var n) ? n.GetString() : null);
            message = $"Added stamp \"{stamp.Name}\" as {{{{stamps.{stamp.Slug}}}}}";
        }
        else
        {
            var id = p.GetProperty("stampId").GetInt32();
            var current = await OperationService<ICompanyStampRepository>().GetByIdAsync(id);
            if (current == null || current.CompanyId != companyId) throw new ToolError("Resource unavailable or access denied.");
            if (StampRevision(current) != p.GetProperty("revision").GetString()) throw new ToolError("The stamp changed. Read it again and prepare a new plan.");
            switch (plan.Kind)
            {
                case "stamp.replace":
                    using (var content = new MemoryStream(Convert.FromBase64String(p.GetProperty("imageBase64").GetString()!)))
                        stamp = await service.ReplaceImageAsync(companyId, id, StampFormFile(content, p.GetProperty("fileName").GetString()!)) ?? throw new ToolError("Resource unavailable or access denied.");
                    message = $"Replaced the image of stamp \"{stamp.Name}\"; {{{{stamps.{stamp.Slug}}}}} now shows it";
                    break;
                case "stamp.rename":
                    stamp = await service.UpdateAsync(companyId, id, p.GetProperty("name").GetString(), null) ?? throw new ToolError("Resource unavailable or access denied.");
                    message = $"Renamed stamp #{id} to \"{stamp.Name}\"";
                    break;
                case "stamp.default":
                    stamp = await service.SetDefaultAsync(companyId, id) ?? throw new ToolError("Resource unavailable or access denied.");
                    message = $"Made \"{stamp.Name}\" the default stamp";
                    break;
                case "stamp.delete":
                    stamp = await service.DeleteAsync(companyId, id) ?? throw new ToolError("Resource unavailable or access denied.");
                    message = $"Deleted stamp \"{stamp.Name}\"";
                    break;
                default: throw new ToolError("Unknown plan type.");
            }
        }
        await AuditStampAsync(companyId, plan.Kind, message);
        return ($"CompanyStamp:{stamp.Id}", message);
    }

    private async Task<(string Ref, string Summary)> CommitStampAssignmentAsync(int companyId, JsonElement p)
    {
        await Need("printtemplates.manage.view");
        var id = p.GetProperty("templateId").GetInt32();
        var template = await _context.PrintTemplates.AsNoTracking().SingleOrDefaultAsync(t => t.Id == id && t.CompanyId == companyId)
            ?? throw new ToolError("Resource unavailable or access denied.");
        if (PrintRevision(template) != p.GetProperty("revision").GetString()) throw new ToolError("The template changed. Read it again and prepare a new plan.");
        var stampId = p.GetProperty("stampId").ValueKind == JsonValueKind.Number ? p.GetProperty("stampId").GetInt32() : (int?)null;
        if (stampId.HasValue)
        {
            var stamp = await OperationService<ICompanyStampRepository>().GetByIdAsync(stampId.Value);
            if (stamp == null || stamp.CompanyId != companyId) throw new ToolError("Resource unavailable or access denied.");
        }
        var html = p.GetProperty("htmlContent").ValueKind == JsonValueKind.String ? p.GetProperty("htmlContent").GetString() : null;
        var updated = await OperationService<IPrintTemplateRepository>().SetStampAsync(id, stampId, html)
            ?? throw new ToolError("Resource unavailable or access denied.");
        var message = stampId.HasValue ? $"Assigned stamp #{stampId} to print template #{id} \"{updated.Name}\"" : $"Removed the stamp from print template #{id} \"{updated.Name}\"";
        await AuditStampAsync(companyId, "stamp.assign", message);
        return ($"PrintTemplate:{id}", message);
    }

    private async Task AuditStampAsync(int companyId, string kind, string message)
    {
        _context.AuditLogs.Add(new AuditLog
        {
            Timestamp = DateTime.UtcNow,
            Level = "Information",
            UserName = User.Identity?.Name,
            CompanyId = companyId,
            HttpMethod = "POST",
            RequestPath = "/mcp",
            StatusCode = 200,
            ExceptionType = "COMPANYSTAMP_" + kind["stamp.".Length..].ToUpperInvariant(),
            Message = $"MCP, user #{CurrentUserId}: {message} in company {companyId}"
        });
        await _context.SaveChangesAsync();
    }
}

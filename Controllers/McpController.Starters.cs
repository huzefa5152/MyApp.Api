using System.Text;
using System.Text.Json;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers;

/// <summary>
/// Shared starter designs through MCP (2026-10-29). Reading is open to anyone who can open the
/// template editor; prepare_starter_template is the seed admin's only, checked when the plan is
/// made AND again at commit (the catalogue also hides it from everyone else). Every write goes
/// through IStarterTemplateService, the same service the HTTP API uses. The starters shipped in
/// code are not listed here: they live in the app itself and change only with a release.
/// </summary>
public partial class McpController
{
    private const int StarterHtmlMax = 24000;

    private static void AddStarterTools(List<ExpandedTool> tools)
    {
        var type = new { type = "string", @enum = PrintTemplateTypes.All };
        var id = new { type = "integer", minimum = 1 };
        var readKeys = new[] { "printtemplates.manage.view", "printtemplates.starter.apply" };
        tools.Add(new("list_starter_templates", "Shared starter designs every company of this installation sees in its Starter Gallery (added by the system administrator). Metadata and revision; read the HTML with get_starter_template. The starters shipped with the app are not listed.",
            ExpandedSchema(new { documentType = type, includeInactive = new { type = "boolean" } }), readKeys, McpScopes.TemplatesRead));
        tools.Add(new("get_starter_template", "Read one shared starter's HTML in sections of at most 16000 characters, with its revision.",
            ExpandedSchema(new { starterId = id, offset = new { type = "integer", minimum = 0 }, length = new { type = "integer", minimum = 1, maximum = 16000 } }, "starterId"),
            readKeys, McpScopes.TemplatesRead));
        tools.Add(new("prepare_starter_template", "System administrator only. Prepare adding, changing, hiding, showing or deleting a shared starter design that every company sees. companyId only files the activity; the starter belongs to no company. The design may hold no script and no company's data (NTN/CNIC/STRN, phone, e-mail, a logo image): use merge fields from get_print_contract. Merge fields the type lacks are refused unless acceptUnknownFields is true (they print blank). Nothing is saved until commit_action after human approval.",
            ExpandedSchema(new
            {
                companyId = new { type = "integer", minimum = 1 },
                action = new { type = "string", @enum = new[] { "create", "update", "activate", "deactivate", "delete" } },
                starterId = id, revision = new { type = "string", minLength = 64, maxLength = 64 },
                documentType = type, name = new { type = "string", minLength = 1, maxLength = 200 },
                description = new { type = "string", maxLength = 500 },
                htmlContent = new { type = "string", minLength = 1, maxLength = StarterHtmlMax },
                sortOrder = new { type = "integer", minimum = 0, maximum = 10000 },
                acceptUnknownFields = new { type = "boolean" },
                idempotencyKey = new { type = "string", maxLength = 100 },
            }, "companyId", "action"),
            new[] { "printtemplates.manage.update" }, McpScopes.TemplatesWrite, SeedOnly: true, Writes: true));
    }

    private static object StarterMetadata(StarterTemplate s) => new
    {
        id = s.Id, documentType = s.TemplateType, name = s.Name, description = s.Description, isActive = s.IsActive,
        sortOrder = s.SortOrder, htmlCharacters = s.HtmlContent.Length, updatedAt = s.UpdatedAt ?? s.CreatedAt,
        revision = StarterTemplateService.Revision(s), source = "shared",
    };

    private IStarterTemplateService Starters => HttpContext.RequestServices.GetRequiredService<IStarterTemplateService>();

    private async Task<object> CallStarterToolAsync(string name, JsonElement args)
    {
        if (name == "prepare_starter_template") return await PrepareStarterAsync(args);
        if (name == "list_starter_templates")
        {
            var type = PrintTypeArg(args, true);
            var hidden = Has(args, "includeInactive") && args.GetProperty("includeInactive").ValueKind == JsonValueKind.True
                         && _permissions.IsSeedAdmin(CurrentUserId);
            var rows = await Starters.ListAsync(type, hidden);
            return new { totalCount = rows.Count, items = rows.Select(StarterMetadata) };
        }
        if (name == "get_starter_template")
        {
            var row = await Starters.GetAsync(IntArg(args, "starterId") ?? 0);
            if (row == null || (!row.IsActive && !_permissions.IsSeedAdmin(CurrentUserId))) throw new ToolError("That starter was not found.");
            var offset = NonNegativeArg(args, "offset");
            var length = Math.Clamp(NonNegativeArg(args, "length", 16000), 1, 16000);
            var text = row.HtmlContent;
            var count = Math.Min(length, Math.Max(0, text.Length - offset));
            return new { starter = StarterMetadata(row), offset, totalCharacters = text.Length,
                content = count == 0 ? "" : text.Substring(offset, count),
                nextOffset = (long)offset + count < text.Length ? (int?)(offset + count) : null };
        }
        throw new ToolError("Unknown tool.");
    }

    private void RequireSeedAdminForStarters()
    {
        if (!_permissions.IsSeedAdmin(CurrentUserId))
            throw new ToolError("Shared starters are seen by every company, so only the system administrator can change them.");
    }

    private async Task<object> PrepareStarterAsync(JsonElement args)
    {
        RequireSeedAdminForStarters();
        var agent = await RequireWriterAsync(McpScopes.TemplatesWrite);
        await Need("printtemplates.manage.update");
        var companyId = await CompanyArg(args);
        var key = IdemKey(args);
        if (await PriorForKeyAsync(agent, key, companyId, McpScopes.TemplatesWrite) is { } prior) return prior;
        var action = OptText(args, "action", 20) ?? "";
        var accept = Has(args, "acceptUnknownFields") && args.GetProperty("acceptUnknownFields").ValueKind == JsonValueKind.True;

        if (action == "create")
        {
            var type = PrintTypeArg(args);
            var name = OptText(args, "name", 200) ?? throw new ToolError("name is required.");
            var description = OptText(args, "description", 500);
            var html = OptText(args, "htmlContent", StarterHtmlMax) ?? throw new ToolError("htmlContent is required.");
            var sortOrder = IntArg(args, "sortOrder") ?? 0;
            var check = await CheckStarterAsync(type, name, description, html, accept);
            var payload = new { action, documentType = type, name, description, htmlContent = check.Html, sortOrder, acceptUnknownFields = accept, unknownFields = check.UnknownFields };
            return await StoreStarterPlanAsync(agent, "starter.create", companyId, payload,
                $"Add a shared {type} starter \"{name}\" that every company sees" + UnknownNote(check), key);
        }

        var id = IntArg(args, "starterId") is { } n and > 0 ? n : throw new ToolError("starterId is required.");
        var revision = OptText(args, "revision", 64);
        if (revision?.Length != 64) throw new ToolError("The starter's revision is required. Read it with list_starter_templates first.");
        var row = await Starters.GetAsync(id) ?? throw new ToolError("That starter was not found.");
        if (StarterTemplateService.Revision(row) != revision) throw new ToolError("The starter changed. Read it again and prepare a new plan.");

        if (action == "update")
        {
            var name = OptText(args, "name", 200) ?? row.Name;
            var description = Has(args, "description") ? OptText(args, "description", 500) : row.Description;
            var html = OptText(args, "htmlContent", StarterHtmlMax) ?? row.HtmlContent;
            var sortOrder = IntArg(args, "sortOrder") ?? row.SortOrder;
            var check = await CheckStarterAsync(row.TemplateType, name, description, html, accept);
            var payload = new { action, starterId = id, revision, documentType = row.TemplateType, name, description, htmlContent = check.Html, sortOrder, acceptUnknownFields = accept, unknownFields = check.UnknownFields };
            return await StoreStarterPlanAsync(agent, "starter.update", companyId, payload,
                $"Change shared {row.TemplateType} starter #{id} \"{name}\" for every company" + UnknownNote(check), key);
        }
        if (action is "activate" or "deactivate" or "delete")
        {
            var payload = new { action, starterId = id, revision, documentType = row.TemplateType, name = row.Name };
            var verb = action switch { "activate" => "Show", "deactivate" => "Hide", _ => "Delete" };
            return await StorePlanAsync(agent, $"starter.{action}", companyId, payload,
                $"{verb} shared {row.TemplateType} starter #{id} \"{row.Name}\" for every company", key);
        }
        throw new ToolError("action must be create, update, activate, deactivate or delete.");
    }

    private static string UnknownNote(StarterCheck check) => check.UnknownFields.Count == 0 ? ""
        : $". WARNING: these merge fields are not offered for this type and will print blank: {string.Join(", ", check.UnknownFields)}";

    private async Task<StarterCheck> CheckStarterAsync(string type, string name, string? description, string html, bool accept)
    {
        var check = await Starters.CheckAsync(type, name, description, html);
        if (check.Refusal != null) throw new ToolError(check.Refusal);
        if (check.UnknownFields.Count > 0 && !accept)
            throw new ToolError($"These merge fields are not offered for {type} and will print blank: {string.Join(", ", check.UnknownFields)}. Fix them from get_print_contract, or pass acceptUnknownFields=true to keep them.");
        return check;
    }

    private async Task<object> StoreStarterPlanAsync(McpAgentToken agent, string kind, int companyId, object payload, string summary, string? key)
    {
        if (Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(payload, Json)) > 60000)
            throw new ToolError("The design is too large for one reviewed MCP plan.");
        return await StorePlanAsync(agent, kind, companyId, payload, summary, key);
    }

    private async Task<(string Ref, string Summary)> CommitStarterAsync(McpPendingAction plan, JsonElement p)
    {
        RequireSeedAdminForStarters();
        string Str(string name) => p.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";
        string? OptStr(string name) => p.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        int Int(string name) => p.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : 0;
        bool Accept() => p.TryGetProperty("acceptUnknownFields", out var v) && v.ValueKind == JsonValueKind.True;
        var actor = User.Identity?.Name;
        try
        {
            switch (plan.Kind)
            {
                case "starter.create":
                {
                    var row = await Starters.CreateAsync(CurrentUserId, actor, Str("documentType"), Str("name"), OptStr("description"), Str("htmlContent"), Int("sortOrder"), Accept());
                    return ($"StarterTemplate:{row.Id}", $"Added shared {row.TemplateType} starter #{row.Id} \"{row.Name}\"");
                }
                case "starter.update":
                {
                    var row = await Starters.UpdateAsync(CurrentUserId, actor, Int("starterId"), Str("revision"), Str("name"), OptStr("description"), Str("htmlContent"), Int("sortOrder"), Accept());
                    return ($"StarterTemplate:{row.Id}", $"Changed shared {row.TemplateType} starter #{row.Id} \"{row.Name}\"");
                }
                case "starter.activate":
                case "starter.deactivate":
                {
                    var row = await Starters.SetActiveAsync(CurrentUserId, actor, Int("starterId"), Str("revision"), plan.Kind == "starter.activate");
                    return ($"StarterTemplate:{row.Id}", $"{(row.IsActive ? "Showed" : "Hid")} shared starter #{row.Id} \"{row.Name}\"");
                }
                case "starter.delete":
                {
                    await Starters.DeleteAsync(CurrentUserId, actor, Int("starterId"), Str("revision"));
                    return ($"StarterTemplate:{Int("starterId")}", $"Deleted shared starter #{Int("starterId")} \"{Str("name")}\"");
                }
                default: throw new ToolError("Unknown plan type.");
            }
        }
        catch (StarterTemplateException ex) { throw new ToolError(ex.Message); }
    }
}

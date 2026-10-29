using System.Text.Json;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Shared starter designs through MCP (2026-10-29). Reading is open to anyone who can open the
    /// template editor; prepare_starter_template is the seed admin's only, checked in its Build, which
    /// runs at prepare AND again at commit (the catalogue also hides it from everyone else). Every
    /// write goes through IStarterTemplateService, the same service the HTTP API uses. The starters
    /// shipped in code are not listed here: they live in the app itself and change only with a release.
    /// </summary>
    public partial class McpController
    {
        private const int StarterHtmlMax = 24000;

        private void AddStarterTools(List<Tool> t)
        {
            var type = new { type = "string", @enum = PrintTemplateTypes.Offered };
            t.AddRange(new Tool[]
            {
                new("list_starter_templates", "Shared starter designs every company of this installation sees in its Starter Gallery (added by the system administrator). Metadata and revision; read the HTML with get_starter_template. The starters shipped with the app are not listed.",
                    Obj(new { documentType = type, includeInactive = new { type = "boolean" } }), Read: ListStartersAsync),
                new("get_starter_template", "Read one shared starter's HTML in sections of at most 16000 characters, with its revision.",
                    Obj(new { starterId = Int(), offset = new { type = "integer", minimum = 0 }, length = new { type = "integer", minimum = 1, maximum = 16000 } }, "starterId"),
                    Read: GetStarterAsync),
                new("prepare_starter_template", "System administrator only. Prepare adding, changing, hiding, showing or deleting a shared starter design that every company sees. companyId only files the activity; the starter belongs to no company. The design may hold no script and no company's data (NTN/CNIC/STRN, phone, e-mail, a logo image): use merge fields from get_print_contract. Merge fields the type lacks are refused unless acceptUnknownFields is true (they print blank). Nothing is saved until commit_action after human approval.",
                    Obj(new
                    {
                        companyId = CompanyProp,
                        action = new { type = "string", @enum = new[] { "create", "update", "activate", "deactivate", "delete" } },
                        starterId = Int(), revision = new { type = "string", minLength = 64, maxLength = 64 },
                        documentType = type, name = new { type = "string", minLength = 1, maxLength = 200 },
                        description = Str(500),
                        htmlContent = new { type = "string", minLength = 1, maxLength = StarterHtmlMax },
                        sortOrder = new { type = "integer", minimum = 0, maximum = 10000 },
                        acceptUnknownFields = new { type = "boolean" },
                        idempotencyKey = IdemProp,
                    }, "companyId", "action"),
                    Build: BuildStarterAsync, PerHour: 20, Noun: "shared starter changes"),
            });
        }

        private static object StarterMetadata(StarterTemplate s) => new
        {
            id = s.Id, documentType = s.TemplateType, name = s.Name, description = s.Description, isActive = s.IsActive,
            sortOrder = s.SortOrder, htmlCharacters = s.HtmlContent.Length, updatedAt = s.UpdatedAt ?? s.CreatedAt,
            revision = StarterTemplateService.Revision(s), source = "shared",
        };

        private IStarterTemplateService Starters => Svc<IStarterTemplateService>();

        private static readonly string[] StarterReadKeys = { "printtemplates.manage.view", "printtemplates.starter.apply" };

        private async Task<object> ListStartersAsync(JsonElement args)
        {
            await Need(StarterReadKeys);
            var type = PrintTypeArg(args, optional: true);
            var hidden = OptBool(args, "includeInactive") == true && _permissions.IsSeedAdmin(CurrentUserId);
            var rows = await Starters.ListAsync(type, hidden);
            return new { totalCount = rows.Count, items = rows.Select(StarterMetadata) };
        }

        private async Task<object> GetStarterAsync(JsonElement args)
        {
            await Need(StarterReadKeys);
            var row = await Starters.GetAsync(IdArg(args, "starterId"));
            if (row == null || (!row.IsActive && !_permissions.IsSeedAdmin(CurrentUserId))) throw new ToolError("That starter was not found.");
            var offset = Math.Max(0, IntArg(args, "offset") ?? 0);
            var length = Math.Clamp(IntArg(args, "length") ?? 16000, 1, 16000);
            var text = row.HtmlContent;
            var count = Math.Min(length, Math.Max(0, text.Length - offset));
            return new
            {
                starter = StarterMetadata(row), offset, totalCharacters = text.Length,
                content = count == 0 ? "" : text.Substring(offset, count),
                nextOffset = (long)offset + count < text.Length ? (int?)(offset + count) : null,
            };
        }

        private void RequireSeedAdminForStarters()
        {
            if (!_permissions.IsSeedAdmin(CurrentUserId))
                throw new ToolError("Shared starters are seen by every company, so only the system administrator can change them.");
        }

        /// <summary>Runs at prepare and again at commit, so the seed-admin check and the revision are re-checked then.</summary>
        private async Task<Built> BuildStarterAsync(int companyId, JsonElement args)
        {
            RequireSeedAdminForStarters();
            await Need("printtemplates.manage.update");
            var action = OptText(args, "action", 20) ?? "";
            var accept = OptBool(args, "acceptUnknownFields") == true;
            var actor = User.Identity?.Name;
            var userId = CurrentUserId;

            if (action == "create")
            {
                var type = PrintTypeArg(args);
                var name = OptText(args, "name", 200) ?? throw new ToolError("name is required.");
                var description = OptText(args, "description", 500);
                var html = OptText(args, "htmlContent", StarterHtmlMax) ?? throw new ToolError("htmlContent is required.");
                var sortOrder = IntArg(args, "sortOrder") ?? 0;
                var check = await CheckStarterAsync(type, name, description, html, accept);
                return new Built(new { action, documentType = type, name, description, htmlLength = check.Html.Length, sortOrder, acceptUnknownFields = accept, unknownFields = check.UnknownFields },
                    $"Add a shared {type} starter \"{name}\" that every company sees" + UnknownNote(check),
                    () => StarterCommitAsync(async () =>
                    {
                        var row = await Starters.CreateAsync(userId, actor, type, name, description, check.Html, sortOrder, accept);
                        return ($"StarterTemplate:{row.Id}", $"Added shared {row.TemplateType} starter #{row.Id} \"{row.Name}\"");
                    }));
            }

            var id = IdArg(args, "starterId");
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
                return new Built(new { action, starterId = id, revision, documentType = row.TemplateType, name, description, htmlLength = check.Html.Length, sortOrder, acceptUnknownFields = accept, unknownFields = check.UnknownFields },
                    $"Change shared {row.TemplateType} starter #{id} \"{name}\" for every company" + UnknownNote(check),
                    () => StarterCommitAsync(async () =>
                    {
                        var saved = await Starters.UpdateAsync(userId, actor, id, revision, name, description, check.Html, sortOrder, accept);
                        return ($"StarterTemplate:{saved.Id}", $"Changed shared {saved.TemplateType} starter #{saved.Id} \"{saved.Name}\"");
                    }));
            }
            if (action is "activate" or "deactivate" or "delete")
            {
                var verb = action switch { "activate" => "Show", "deactivate" => "Hide", _ => "Delete" };
                return new Built(new { action, starterId = id, revision, documentType = row.TemplateType, name = row.Name },
                    $"{verb} shared {row.TemplateType} starter #{id} \"{row.Name}\" for every company",
                    () => StarterCommitAsync(async () =>
                    {
                        if (action == "delete")
                        {
                            await Starters.DeleteAsync(userId, actor, id, revision);
                            return ($"StarterTemplate:{id}", $"Deleted shared starter #{id} \"{row.Name}\"");
                        }
                        var saved = await Starters.SetActiveAsync(userId, actor, id, revision, action == "activate");
                        return ($"StarterTemplate:{saved.Id}", $"{(saved.IsActive ? "Showed" : "Hid")} shared starter #{saved.Id} \"{saved.Name}\"");
                    }));
            }
            throw new ToolError("action must be create, update, activate, deactivate or delete.");
        }

        private static async Task<(string Ref, string Summary)> StarterCommitAsync(Func<Task<(string Ref, string Summary)>> write)
        {
            try { return await write(); }
            catch (StarterTemplateException ex) { throw new ToolError(ex.Message); }
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
    }
}

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class StarterTemplateService(AppDbContext db, IPermissionService permissions, IAuditLogService audit) : IStarterTemplateService
    {
        /// <summary>Changes whenever anything a reader sees changes, so an edit made from a stale copy is refused.</summary>
        public static string Revision(StarterTemplate t) =>
            Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
            {
                t.Id, t.TemplateType, t.Name, t.Description, t.HtmlContent, t.IsActive, t.SortOrder,
                // Ticks, not the DateTime: a saved value is Utc and a re-read one Unspecified, and JSON
                // writes them differently, so hashing the DateTime made every fresh revision stale.
                Updated = t.UpdatedAt?.Ticks,
            })))).ToLowerInvariant();

        public Task<List<StarterTemplate>> ListAsync(string? templateType, bool includeInactive) =>
            db.StarterTemplates.AsNoTracking()
                .Where(s => (includeInactive || s.IsActive) && (templateType == null || templateType == "" || s.TemplateType == templateType))
                .OrderBy(s => s.TemplateType).ThenBy(s => s.SortOrder).ThenBy(s => s.Id).ToListAsync();

        public Task<StarterTemplate?> GetAsync(int id) => db.StarterTemplates.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id);

        public async Task<StarterCheck> CheckAsync(string templateType, string name, string? description, string html)
        {
            if (!PrintTemplateTypes.All.Contains(templateType, StringComparer.Ordinal))
                return new($"Unknown template type \"{templateType}\". Allowed: {PrintTemplateTypes.AllForDisplay}.", html, new());
            if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > StarterTemplateRules.MaxNameChars)
                return new($"A name of 1 to {StarterTemplateRules.MaxNameChars} characters is required.", html, new());
            if ((description ?? "").Length > StarterTemplateRules.MaxDescriptionChars)
                return new($"The description is longer than {StarterTemplateRules.MaxDescriptionChars} characters.", html, new());
            if (string.IsNullOrWhiteSpace(html)) return new("The design has no HTML.", html, new());
            // Refuse first, on what the author sent; then clean what is left as a company template is cleaned.
            var refusal = StarterTemplateRules.Refusal(html) ?? StarterTemplateRules.Refusal(name) ?? StarterTemplateRules.Refusal(description ?? "");
            if (refusal != null) return new(refusal, html, new());
            var clean = TemplateHtmlSafety.Strip(html) ?? "";
            if (string.IsNullOrWhiteSpace(clean)) return new("The design has no printable content.", clean, new());
            var fields = await db.MergeFields.AsNoTracking().Where(m => m.TemplateType == templateType).Select(m => m.FieldExpression).ToListAsync();
            return new(null, clean, StarterTemplateRules.UnknownFields(clean, fields));
        }

        private void RequireSeedAdmin(int actorUserId)
        {
            if (!permissions.IsSeedAdmin(actorUserId))
                throw new StarterTemplateException("Shared starters are seen by every company, so only the system administrator can change them.", 403);
        }

        private async Task<StarterCheck> ValidAsync(string type, string name, string? description, string html, bool acceptUnknownFields)
        {
            var check = await CheckAsync(type, name, description, html);
            if (check.Refusal != null) throw new StarterTemplateException(check.Refusal);
            if (check.UnknownFields.Count > 0 && !acceptUnknownFields)
                throw new StarterTemplateException($"These merge fields are not offered for {type} and will print blank: {string.Join(", ", check.UnknownFields)}. Fix them, or accept them explicitly.");
            return check;
        }

        private async Task<StarterTemplate> TrackedAsync(int id, string revision)
        {
            var row = await db.StarterTemplates.FirstOrDefaultAsync(s => s.Id == id)
                      ?? throw new StarterTemplateException("That starter was not found.", 404);
            if (!string.Equals(Revision(row), revision, StringComparison.OrdinalIgnoreCase))
                throw new StarterTemplateException("The starter changed since it was read. Read it again and redo the change.", 409);
            return row;
        }

        public async Task<StarterTemplate> CreateAsync(int actorUserId, string? actorName, string templateType, string name, string? description, string html, int sortOrder, bool acceptUnknownFields)
        {
            RequireSeedAdmin(actorUserId);
            var check = await ValidAsync(templateType, name, description, html, acceptUnknownFields);
            var row = new StarterTemplate
            {
                TemplateType = templateType, Name = name.Trim(), Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim(),
                HtmlContent = check.Html, SortOrder = sortOrder, IsActive = true, CreatedAt = DateTime.UtcNow, CreatedByUserId = actorUserId,
            };
            db.StarterTemplates.Add(row);
            await db.SaveChangesAsync();
            await AuditAsync("STARTER_TEMPLATE_CREATE", actorName, $"Added shared {row.TemplateType} starter #{row.Id} \"{row.Name}\"");
            return row;
        }

        public async Task<StarterTemplate> UpdateAsync(int actorUserId, string? actorName, int id, string revision, string name, string? description, string html, int sortOrder, bool acceptUnknownFields)
        {
            RequireSeedAdmin(actorUserId);
            var row = await TrackedAsync(id, revision);
            var check = await ValidAsync(row.TemplateType, name, description, html, acceptUnknownFields);
            row.Name = name.Trim();
            row.Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim();
            row.HtmlContent = check.Html;
            row.SortOrder = sortOrder;
            row.UpdatedAt = DateTime.UtcNow;
            row.UpdatedByUserId = actorUserId;
            await db.SaveChangesAsync();
            await AuditAsync("STARTER_TEMPLATE_UPDATE", actorName, $"Changed shared {row.TemplateType} starter #{row.Id} \"{row.Name}\"");
            return row;
        }

        public async Task<StarterTemplate> SetActiveAsync(int actorUserId, string? actorName, int id, string revision, bool active)
        {
            RequireSeedAdmin(actorUserId);
            var row = await TrackedAsync(id, revision);
            row.IsActive = active;
            row.UpdatedAt = DateTime.UtcNow;
            row.UpdatedByUserId = actorUserId;
            await db.SaveChangesAsync();
            await AuditAsync(active ? "STARTER_TEMPLATE_ACTIVATE" : "STARTER_TEMPLATE_DEACTIVATE", actorName,
                $"{(active ? "Showed" : "Hid")} shared {row.TemplateType} starter #{row.Id} \"{row.Name}\"");
            return row;
        }

        public async Task DeleteAsync(int actorUserId, string? actorName, int id, string revision)
        {
            RequireSeedAdmin(actorUserId);
            var row = await TrackedAsync(id, revision);
            db.StarterTemplates.Remove(row);
            await db.SaveChangesAsync();
            await AuditAsync("STARTER_TEMPLATE_DELETE", actorName, $"Deleted shared {row.TemplateType} starter #{row.Id} \"{row.Name}\"");
        }

        // A platform event: no CompanyId, so only the seed admin's unscoped audit log shows it. Its own
        // fingerprint, because the 24h de-duplication would fold two same-day changes into one row.
        private Task AuditAsync(string type, string? actorName, string message) => audit.LogAsync(new AuditLog
        {
            Level = "Info", UserName = actorName, HttpMethod = "POST", RequestPath = "/api/starter-templates", StatusCode = 200,
            ExceptionType = type, Message = message, CompanyId = null, Fingerprint = Guid.NewGuid().ToString("N"),
        });
    }
}

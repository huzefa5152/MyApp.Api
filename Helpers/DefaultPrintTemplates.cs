using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using MyApp.Api.Data;
using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// The built-in Challan / Bill / Tax Invoice print templates, on the server.
    ///
    /// The frontend has always shipped these in
    /// <c>myapp-frontend/src/utils/defaultTemplates.js</c> and used them when a
    /// company had no saved template. But the Bills screen gated Print / PDF on
    /// a saved template existing, so a company with only a Tax Invoice template
    /// could not print a Bill at all (all three live tenants, 2026-09-10), and
    /// the bulk download skipped such documents outright. Two rules now:
    ///
    ///  1. A NEW company gets a default Challan, Bill and Tax Invoice template
    ///     row on creation (<see cref="SeedForCompanyAsync"/>), so the operator
    ///     starts with something to print and to edit.
    ///  2. A company that still has none falls back to the built-in HTML — on
    ///     the screen (usePrintTemplates) and in the bulk download
    ///     (<see cref="AsTemplate"/>). Never a disabled button.
    ///
    /// The HTML files under <c>Data/DefaultPrintTemplates</c> are generated FROM
    /// the JS module by <c>scripts/sync_default_print_templates.mjs</c>; the JS
    /// stays the single source of truth and the <c>--check</c> form of that
    /// script fails when the copies drift.
    /// </summary>
    public static class DefaultPrintTemplates
    {
        /// <summary>The document types a company is born with.</summary>
        public static readonly string[] SeededTypes = { "Challan", "Bill", "TaxInvoice" };

        public const string SeededName = "Default";
        public const string BuiltInName = "Built-in default";

        private static readonly Dictionary<string, string?> Cache = new();
        private static readonly object Gate = new();

        /// <summary>The built-in HTML for a template type, or null when none is embedded.</summary>
        public static string? TryGetHtml(string templateType)
        {
            lock (Gate)
            {
                if (Cache.TryGetValue(templateType, out var cached)) return cached;
                var asm = Assembly.GetExecutingAssembly();
                var name = asm.GetManifestResourceNames()
                    .FirstOrDefault(n => n.EndsWith($".DefaultPrintTemplates.{templateType}.html", StringComparison.Ordinal));
                string? html = null;
                if (name != null)
                {
                    using var stream = asm.GetManifestResourceStream(name);
                    if (stream != null)
                    {
                        using var reader = new StreamReader(stream);
                        html = reader.ReadToEnd();
                        if (string.IsNullOrWhiteSpace(html)) html = null;
                    }
                }
                Cache[templateType] = html;
                return html;
            }
        }

        /// <summary>
        /// An UNSAVED template object carrying the built-in HTML, for a renderer
        /// that needs a <see cref="PrintTemplate"/> and found none for the company.
        /// Id is 0 so nothing can mistake it for a row.
        /// </summary>
        public static PrintTemplate? AsTemplate(int companyId, string templateType)
        {
            var html = TryGetHtml(templateType);
            if (html == null) return null;
            return new PrintTemplate
            {
                Id = 0,
                CompanyId = companyId,
                DivisionId = null,
                TemplateType = templateType,
                Name = BuiltInName,
                IsDefault = true,
                HtmlContent = html,
                EditorMode = "code",
                UpdatedAt = DateTime.UtcNow,
            };
        }

        /// <summary>
        /// Gives a company a company-wide default row for every seeded type it
        /// does not already have one for. Idempotent: an existing row of that
        /// type (default or not) is left alone. Returns the types written.
        /// </summary>
        public static async Task<List<string>> SeedForCompanyAsync(AppDbContext db, int companyId, ILogger? logger = null)
        {
            var existing = await db.PrintTemplates.AsNoTracking()
                .Where(t => t.CompanyId == companyId && t.DivisionId == null)
                .Select(t => t.TemplateType)
                .Distinct()
                .ToListAsync();

            var written = new List<string>();
            foreach (var type in SeededTypes)
            {
                if (existing.Contains(type)) continue;
                var html = TryGetHtml(type);
                if (html == null)
                {
                    logger?.LogWarning("No built-in {TemplateType} print template is embedded; company {CompanyId} starts without one.",
                        type, companyId);
                    continue;
                }
                db.PrintTemplates.Add(new PrintTemplate
                {
                    CompanyId = companyId,
                    DivisionId = null,
                    TemplateType = type,
                    Name = SeededName,
                    IsDefault = true,
                    HtmlContent = html,
                    EditorMode = "code",
                    UpdatedAt = DateTime.UtcNow,
                });
                written.Add(type);
            }
            if (written.Count > 0) await db.SaveChangesAsync();
            return written;
        }
    }
}

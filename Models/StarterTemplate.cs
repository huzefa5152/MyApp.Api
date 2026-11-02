namespace MyApp.Api.Models
{
    /// <summary>
    /// A print design shared with every company of this installation as a starter (2026-10-29),
    /// beside the starters shipped in code (myapp-frontend/src/utils/starters). Platform content,
    /// not tenant data: no CompanyId, readable by anyone who can open the template editor, written
    /// by the seed admin only (StarterTemplateService). Because every tenant sees it, it must never
    /// hold one tenant's name, numbers or contact details -- StarterTemplateRules refuses them.
    /// </summary>
    public class StarterTemplate
    {
        public int Id { get; set; }
        public string TemplateType { get; set; } = "";
        public string Name { get; set; } = "";
        public string? Description { get; set; }
        public string HtmlContent { get; set; } = "";
        public bool IsActive { get; set; } = true;
        public int SortOrder { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public int? CreatedByUserId { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public int? UpdatedByUserId { get; set; }
    }
}

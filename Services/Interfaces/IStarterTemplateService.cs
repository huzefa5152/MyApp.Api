using MyApp.Api.Models;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Shared starter designs (installation-wide). The ONE place they are read and written, used by
    /// both the HTTP API and the MCP tools, so the two cannot drift. Every write is refused unless
    /// the actor is the seed admin.
    /// </summary>
    public interface IStarterTemplateService
    {
        Task<List<StarterTemplate>> ListAsync(string? templateType, bool includeInactive);
        Task<StarterTemplate?> GetAsync(int id);

        /// <summary>Checks a design without saving it: the refusal (or null), the cleaned HTML, and merge fields the type lacks.</summary>
        Task<StarterCheck> CheckAsync(string templateType, string name, string? description, string html);

        Task<StarterTemplate> CreateAsync(int actorUserId, string? actorName, string templateType, string name, string? description, string html, int sortOrder, bool acceptUnknownFields);
        Task<StarterTemplate> UpdateAsync(int actorUserId, string? actorName, int id, string revision, string name, string? description, string html, int sortOrder, bool acceptUnknownFields);
        Task<StarterTemplate> SetActiveAsync(int actorUserId, string? actorName, int id, string revision, bool active);
        Task DeleteAsync(int actorUserId, string? actorName, int id, string revision);
    }

    public sealed record StarterCheck(string? Refusal, string Html, List<string> UnknownFields);

    /// <summary>A write the rules refuse; the message is safe to show (it names the rule, not internals).</summary>
    public sealed class StarterTemplateException(string message, int status = 400) : Exception(message)
    {
        public int Status { get; } = status;
    }
}

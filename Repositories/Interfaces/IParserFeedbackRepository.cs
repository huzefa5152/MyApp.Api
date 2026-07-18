using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    /// <summary>
    /// Data access for parser feedback. This is the ONE layer intended to vary
    /// between branches if their persistence differs — everything above it
    /// (service, controller, DTOs, API routes, enum) is byte-identical, so a
    /// differing implementation stays contained here and cherry-picks cleanly.
    /// </summary>
    public interface IParserFeedbackRepository
    {
        Task<ParserFeedback> AddAsync(ParserFeedback feedback);
        Task<ParserFeedback?> GetAsync(int id);
        Task<List<ParserFeedback>> GetManyAsync(IReadOnlyCollection<int> ids);

        Task<(List<ParserFeedback> Rows, int Total)> ListAsync(
            ParserFeedbackStatus? status,
            DateTime? from,
            DateTime? to,
            string? parserVersion,
            string? sortBy,
            bool descending,
            int page,
            int pageSize);

        /// <summary>Per-(version, status) counts backing the statistics view.</summary>
        Task<List<ParserFeedbackVersionCount>> AggregateAsync();
    }

    /// <summary>One grouped count row: how many feedbacks of a given status
    /// exist for a given parser version.</summary>
    public record ParserFeedbackVersionCount(string? ParserVersion, ParserFeedbackStatus Status, int Count);
}

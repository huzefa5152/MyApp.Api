using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Repositories.Implementations
{
    public class ParserFeedbackRepository : IParserFeedbackRepository
    {
        private readonly AppDbContext _db;
        public ParserFeedbackRepository(AppDbContext db) => _db = db;

        public async Task<ParserFeedback> AddAsync(ParserFeedback feedback)
        {
            _db.ParserFeedbacks.Add(feedback);
            await _db.SaveChangesAsync();
            return feedback;
        }

        public Task<ParserFeedback?> GetAsync(int id) =>
            _db.ParserFeedbacks.AsNoTracking().FirstOrDefaultAsync(f => f.Id == id);

        public async Task<List<ParserFeedback>> GetManyAsync(IReadOnlyCollection<int> ids)
        {
            if (ids == null || ids.Count == 0) return new List<ParserFeedback>();
            var idList = ids.Distinct().ToList();
            return await _db.ParserFeedbacks.AsNoTracking()
                .Where(f => idList.Contains(f.Id))
                .ToListAsync();
        }

        public async Task<(List<ParserFeedback> Rows, int Total)> ListAsync(
            ParserFeedbackStatus? status, DateTime? from, DateTime? to,
            string? parserVersion, string? sortBy, bool descending, int page, int pageSize,
            IReadOnlyCollection<int>? accessibleCompanyIds)
        {
            var q = Scoped(accessibleCompanyIds);
            if (status.HasValue) q = q.Where(f => f.FeedbackStatus == status.Value);
            if (from.HasValue) q = q.Where(f => f.CreatedDate >= from.Value);
            if (to.HasValue) q = q.Where(f => f.CreatedDate < to.Value);
            if (!string.IsNullOrWhiteSpace(parserVersion)) q = q.Where(f => f.ParserVersion == parserVersion);

            var total = await q.CountAsync();

            q = (sortBy?.Trim().ToLowerInvariant()) switch
            {
                "filename"      => descending ? q.OrderByDescending(f => f.OriginalFileName) : q.OrderBy(f => f.OriginalFileName),
                "parserversion" => descending ? q.OrderByDescending(f => f.ParserVersion)    : q.OrderBy(f => f.ParserVersion),
                _               => descending ? q.OrderByDescending(f => f.CreatedDate)      : q.OrderBy(f => f.CreatedDate),
            };

            var rows = await q.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
            return (rows, total);
        }

        // Null is explicitly reserved for the seed admin; an empty set reads nothing.
        private IQueryable<ParserFeedback> Scoped(IReadOnlyCollection<int>? accessibleCompanyIds)
        {
            var query = _db.ParserFeedbacks.AsNoTracking();
            return accessibleCompanyIds == null ? query : query.Where(f =>
                f.CompanyId.HasValue && accessibleCompanyIds.Contains(f.CompanyId.Value));
        }

        public async Task<List<ParserFeedbackVersionCount>> AggregateAsync(IReadOnlyCollection<int>? accessibleCompanyIds)
        {
            var raw = await Scoped(accessibleCompanyIds)
                .GroupBy(f => new { f.ParserVersion, f.FeedbackStatus })
                .Select(g => new { g.Key.ParserVersion, g.Key.FeedbackStatus, Count = g.Count() })
                .ToListAsync();
            return raw.Select(r => new ParserFeedbackVersionCount(r.ParserVersion, r.FeedbackStatus, r.Count)).ToList();
        }
    }
}

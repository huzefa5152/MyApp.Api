using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;

namespace MyApp.Api.Helpers;

/// <summary>
/// Pages a list query by sorting only the ids, then loading that page's rows.
/// Sorting the full rows with their includes made SQL Server ask for a memory
/// grant sized for every wide column of every joined row (about 2.9 GB for the
/// sales order list on production), and on the shared server that request
/// queued for up to 25 seconds and held up every other screen (2026-11-20).
/// The rows, their order and the total are exactly what the one-shot query
/// returned: the same filters, the same ORDER BY, and the page reloaded through
/// the caller's own query so its includes are unchanged.
/// </summary>
public static class PageById
{
    public static async Task<(List<T> Items, int TotalCount)> PageAsync<T>(
        IQueryable<T> query,
        Func<IQueryable<T>, IOrderedQueryable<T>> order,
        Expression<Func<T, int>> id,
        int page, int pageSize) where T : class
    {
        var total = await query.CountAsync();
        var ids = await order(query).Select(id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();
        if (ids.Count == 0) return (new List<T>(), total);

        // The ids go in as a parameter (a member of a captured object, which EF sends
        // as one JSON parameter), not as literals: literal ids make every page new
        // SQL text that SQL Server compiles again.
        var pageIds = new IdList { Ids = ids };
        var inPage = Expression.Lambda<Func<T, bool>>(
            Expression.Call(typeof(Enumerable), nameof(Enumerable.Contains), new[] { typeof(int) },
                Expression.Property(Expression.Constant(pageIds), nameof(IdList.Ids)), id.Body),
            id.Parameters);
        // Split: a page loaded as one join sorts every joined row by every key, and
        // production's optimizer sized that sort in gigabytes. The repositories order
        // their collections by id, the order the single query returned them in.
        // TOP(n) with n written into the SQL: at most n rows match the ids anyway, and
        // a known limit stops the optimizer estimating thousands of joined rows.
        var ordered = query.Where(inPage).OrderBy(id);
        var limited = ordered.Provider.CreateQuery<T>(Expression.Call(
            typeof(Queryable), nameof(Queryable.Take), new[] { typeof(T) }, ordered.Expression,
            Expression.Call(typeof(EF), nameof(EF.Constant), new[] { typeof(int) }, Expression.Constant(ids.Count))));
        var rows = await limited.AsSplitQuery().ToListAsync();

        var position = ids.Select((value, index) => (value, index)).ToDictionary(p => p.value, p => p.index);
        var idOf = id.Compile();
        return (rows.OrderBy(r => position[idOf(r)]).ToList(), total);
    }

    private sealed class IdList
    {
        public List<int> Ids { get; init; } = new();
    }
}

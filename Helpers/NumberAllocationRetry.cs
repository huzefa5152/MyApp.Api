using Microsoft.EntityFrameworkCore;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Audit C-8 (2026-05-13): retry helper for "number-per-tenant"
    /// allocation flows (Invoice, PurchaseBill, GoodsReceipt). Pre-fix,
    /// two concurrent creates could both compute MAX(*Number)+1 and land
    /// the same number. The unique composite index now blocks the second
    /// write — when that happens SQL Server raises 2601 / 2627, EF Core
    /// surfaces it as <see cref="DbUpdateException"/>. The retry loop
    /// recomputes the next number and tries again.
    /// </summary>
    public static class NumberAllocationRetry
    {
        public const int DefaultMaxAttempts = 3;

        /// <summary>
        /// True when an EF write failure is the SQL Server "duplicate key
        /// in unique index" error — the only failure mode we want to
        /// retry. Anything else propagates.
        /// </summary>
        public static bool IsUniqueViolation(DbUpdateException ex)
        {
            // Microsoft.Data.SqlClient surfaces 2601 (duplicate key in
            // unique index) and 2627 (unique-constraint violation). EF
            // wraps the raw SqlException as InnerException.
            for (var inner = ex.InnerException; inner != null; inner = inner.InnerException)
            {
                if (inner is Microsoft.Data.SqlClient.SqlException sql
                    && (sql.Number == 2601 || sql.Number == 2627))
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>
        /// Execute the work in a loop, retrying up to <paramref name="maxAttempts"/>
        /// times when a unique-key violation is caught.
        /// </summary>
        public static async Task<T> ExecuteAsync<T>(
            Func<int, Task<T>> work,
            int maxAttempts = DefaultMaxAttempts)
        {
            DbUpdateException? lastFailure = null;
            for (var attempt = 1; attempt <= maxAttempts; attempt++)
            {
                try
                {
                    return await work(attempt);
                }
                catch (DbUpdateException ex) when (IsUniqueViolation(ex))
                {
                    lastFailure = ex;
                    if (attempt == maxAttempts) break;
                    // Short non-blocking backoff so two losers in a row
                    // don't immediately re-collide. Linear is fine — at 3
                    // attempts the worst case is ~30ms total.
                    await Task.Delay(10 * attempt);
                }
            }
            throw new InvalidOperationException(
                "Could not allocate a unique document number after " + maxAttempts +
                " attempts. Please retry the request.", lastFailure);
        }
    }
}

using System.Data;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// SQL Server application-lock helper for the inventory availability guard.
    /// A per-company exclusive, transaction-owned lock serialises the
    /// check-then-write critical section so two concurrent documents can't
    /// both pass an availability check on the last units and jointly oversell
    /// (closes the TOCTOU race the old pre-transaction check had).
    ///
    /// MUST be called with an open transaction on <paramref name="ctx"/> — the
    /// lock is released automatically when that transaction commits or rolls
    /// back, and the subsequent availability read runs under the lock on the
    /// same connection so it sees every committed peer.
    /// </summary>
    public static class StockLock
    {
        public static async Task AcquireCompanyAsync(AppDbContext ctx, int companyId, int timeoutMs = 15000)
        {
            var resource = $"stockguard:{companyId}";

            // sp_getapplock's status is its RETURN value (>= 0 granted: 0 at
            // once / 1 after a wait; < 0 failed: -1 timeout, -2 cancelled,
            // -3 deadlock, -999 bad param). Capture it via an OUTPUT parameter
            // with ExecuteSqlRaw — SqlQuery + First() would try to compose a
            // TOP over the non-composable EXEC batch and throw.
            var resultParam = new SqlParameter
            {
                ParameterName = "@result",
                SqlDbType = SqlDbType.Int,
                Direction = ParameterDirection.Output,
            };
            await ctx.Database.ExecuteSqlRawAsync(
                "EXEC @result = sp_getapplock @Resource = @res, @LockMode = 'Exclusive', " +
                "@LockOwner = 'Transaction', @LockTimeout = @timeout",
                resultParam,
                new SqlParameter("@res", resource),
                new SqlParameter("@timeout", timeoutMs));

            var code = resultParam.Value is int v ? v : -999;
            if (code < 0)
                throw new InvalidOperationException(
                    $"Could not acquire the inventory lock for company {companyId} (code {code}). Please retry.");
        }
    }
}

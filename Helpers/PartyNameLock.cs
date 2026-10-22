using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using MyApp.Api.Data;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Serialises "is this client / supplier name free? then save" per company.
    /// Without it two simultaneous saves of one name both pass the check and both
    /// insert (a double-click produced two identical customers 65 ms apart).
    /// Joins the caller's transaction when there is one; otherwise opens one that
    /// the caller commits right after its save.
    /// </summary>
    public static class PartyNameLock
    {
        public static async Task<IDbContextTransaction?> AcquireAsync(AppDbContext db, string kind, int companyId)
        {
            var own = db.Database.CurrentTransaction == null ? await db.Database.BeginTransactionAsync() : null;
            // ponytail: on lock timeout sp_getapplock returns -1 and the save goes ahead unlocked, as before this fix.
            await db.Database.ExecuteSqlRawAsync(
                "EXEC sp_getapplock @Resource = {0}, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000",
                $"{kind}-name:{companyId}");
            return own;
        }
    }
}

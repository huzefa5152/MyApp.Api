using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Begin a transaction, or join the caller's when one is already open
    /// (2026-10-28). Same idea as AuditLogService / PartyNameLock, for code
    /// written as "begin, commit, roll back": joined, Commit and Rollback do
    /// nothing and the CALLER's transaction decides. A failed SaveChanges
    /// inside a caller's transaction is still undone by EF's own savepoint.
    ///
    /// Used by the invoice create / update paths, which an invoice that makes
    /// a new catalog item on save runs inside one outer transaction, so the
    /// item and the invoice land together or not at all.
    /// </summary>
    public static class JoinedTransaction
    {
        public static async Task<IDbContextTransaction> BeginOrJoinTransactionAsync(this DatabaseFacade db)
            => db.CurrentTransaction != null ? new Joined(db.CurrentTransaction) : await db.BeginTransactionAsync();

        private sealed class Joined : IDbContextTransaction
        {
            private readonly IDbContextTransaction _outer;
            public Joined(IDbContextTransaction outer) => _outer = outer;
            public Guid TransactionId => _outer.TransactionId;
            public void Commit() { }
            public Task CommitAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;
            public void Rollback() { }
            public Task RollbackAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;
            public void Dispose() { }
            public ValueTask DisposeAsync() => ValueTask.CompletedTask;
        }
    }
}

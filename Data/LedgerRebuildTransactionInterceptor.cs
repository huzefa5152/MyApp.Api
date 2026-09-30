using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace MyApp.Api.Data;

/// <summary>
/// Coordinate rebuilds before document or ledger row locks are taken. Normal
/// transactions share the barrier; rebuilds and ledger reads hold it exclusively. The resource
/// is database-wide because query scans can lock rows belonging to other companies.
/// SQL Server releases it on commit/rollback, including a disconnected process.
/// </summary>
internal sealed class LedgerRebuildTransactionInterceptor : DbTransactionInterceptor
{
    internal static readonly LedgerRebuildTransactionInterceptor Instance = new();

    public override DbTransaction TransactionStarted(DbConnection connection,
        TransactionEndEventData eventData, DbTransaction result)
    {
        if (connection is not Microsoft.Data.SqlClient.SqlConnection) return result;
        using var command = CreateCommand(result, eventData);
        try { command.ExecuteNonQuery(); }
        catch
        {
            result.Dispose();
            throw;
        }
        return result;
    }

    public override async ValueTask<DbTransaction> TransactionStartedAsync(DbConnection connection,
        TransactionEndEventData eventData, DbTransaction result, CancellationToken cancellationToken = default)
    {
        if (connection is not Microsoft.Data.SqlClient.SqlConnection) return result;
        await using var command = CreateCommand(result, eventData);
        try { await command.ExecuteNonQueryAsync(cancellationToken); }
        catch (Exception ex)
        {
            await result.DisposeAsync();
            if (cancellationToken.IsCancellationRequested)
                throw new OperationCanceledException("Ledger transaction wait was cancelled.", ex, cancellationToken);
            throw;
        }
        return result;
    }

    private static DbCommand CreateCommand(DbTransaction transaction, TransactionEndEventData eventData)
    {
        var command = transaction.Connection!.CreateCommand();
        command.Transaction = transaction;
        command.CommandTimeout = 0;
        command.CommandText = """
            DECLARE @result int;
            EXEC @result = sys.sp_getapplock
                @Resource = N'MyApp:LedgerRebuild', @LockMode = @mode,
                @LockOwner = N'Transaction', @LockTimeout = -1;
            IF @result < 0 THROW 51000, 'Could not coordinate the ledger transaction.', 1;
            """;
        var mode = command.CreateParameter();
        mode.ParameterName = "@mode";
        mode.Value = eventData.Context is AppDbContext { IsLedgerExclusiveTransaction: true }
            ? "Exclusive" : "Shared";
        command.Parameters.Add(mode);
        return command;
    }
}

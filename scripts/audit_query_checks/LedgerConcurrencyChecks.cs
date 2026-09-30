using System.Reflection;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;

public static class LedgerConcurrencyChecks
{
    public static async Task RunAsync(DbContextOptions<AppDbContext> options)
    {
        await using var first = new AppDbContext(options);
        await using var second = new AppDbContext(options);
        await using var rebuild = new AppDbContext(options);
        await using var later = new AppDbContext(options);
        await using var one = await first.Database.BeginTransactionAsync();
        await using var two = await second.Database.BeginTransactionAsync().WaitAsync(TimeSpan.FromSeconds(10));
        Console.WriteLine("PASS: normal transactions coexist on independent connections.");

        using var scope = RebuildScope(rebuild);
        var pendingRebuild = rebuild.Database.BeginTransactionAsync();
        await AssertWaiting(pendingRebuild, "Rebuild entered while writers were active");
        await one.CommitAsync();
        await AssertWaiting(pendingRebuild, "Rebuild entered before the last writer ended");
        await two.RollbackAsync();
        await using var exclusive = await pendingRebuild.WaitAsync(TimeSpan.FromSeconds(10));
        var pendingWriter = later.Database.BeginTransactionAsync();
        await AssertWaiting(pendingWriter, "Writer entered while rebuild was active");
        await exclusive.RollbackAsync();
        await using var admitted = await pendingWriter.WaitAsync(TimeSpan.FromSeconds(10));
        await admitted.CommitAsync();
        Console.WriteLine("PASS: rebuild waits for writers; later writers wait for rebuild; rollback releases the barrier.");

        await using var syncRebuild = new AppDbContext(options);
        using var syncScope = RebuildScope(syncRebuild);
        using var syncTx = syncRebuild.Database.BeginTransaction();
        await using var cancelled = new AppDbContext(options);
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(500));
        try
        {
            await using var unexpected = await cancelled.Database.BeginTransactionAsync(cancellation.Token);
            throw new Exception("Waiting transaction ignored cancellation");
        }
        catch (OperationCanceledException) { }
        syncTx.Commit();
        await using var afterCancellation = new AppDbContext(options);
        await using var released = await afterCancellation.Database.BeginTransactionAsync().WaitAsync(TimeSpan.FromSeconds(10));
        await released.CommitAsync();
        Console.WriteLine("PASS: synchronous transactions coordinate too; a cancelled wait leaves no blocking lock.");

        using var normal = new AppDbContext(options);
        using var normalTx = normal.Database.BeginTransaction();
        try
        {
            using var invalid = RebuildScope(normal);
            throw new Exception("Rebuild upgraded a transaction after it could acquire document locks");
        }
        catch (TargetInvocationException ex) when (ex.InnerException is InvalidOperationException) { }
        normalTx.Rollback();
        Console.WriteLine("PASS: late shared-to-exclusive upgrades are refused before touching the ledger.");

        await using var reader = new AppDbContext(options);
        var company = new MyApp.Api.Models.Company { Name = "Sample ledger reader", GlPostingEnabled = true };
        reader.Add(company);
        await reader.SaveChangesAsync();
        await using var writer = new AppDbContext(options);
        await using var writing = await writer.Database.BeginTransactionAsync();
        var read = new MyApp.Api.Services.Implementations.GeneralLedgerService(reader).GetStatusAsync(company.Id);
        await AssertWaiting(read, "Ledger status entered while a writer was active");
        await writing.RollbackAsync();
        var status = await read.WaitAsync(TimeSpan.FromSeconds(10));
        if (status.EntryCount != 0 || status.TotalDebit != 0 || status.TotalCredit != 0)
            throw new Exception("Ledger status changed figures while coordinating");
        await using var afterRead = await reader.Database.BeginTransactionAsync();
        await using var otherWriter = new AppDbContext(options);
        await using var concurrentWriter = await otherWriter.Database.BeginTransactionAsync().WaitAsync(TimeSpan.FromSeconds(10));
        await concurrentWriter.RollbackAsync();
        await afterRead.RollbackAsync();
        Console.WriteLine("PASS: ledger reads wait for writes and restore ordinary concurrent transaction mode afterwards.");
    }

    private static IDisposable RebuildScope(AppDbContext db) =>
        (IDisposable)typeof(AppDbContext).GetMethod("ExclusiveLedgerScope", BindingFlags.NonPublic | BindingFlags.Instance)!.Invoke(db, null)!;

    private static async Task AssertWaiting(Task pending, string error)
    {
        await Task.Delay(200);
        if (pending.IsCompleted) throw new Exception(error);
    }
}

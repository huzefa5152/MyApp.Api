using System.Data.Common;
using System.Reflection;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Implementations;
using MyApp.Api.Services.Implementations;

public static class LedgerRebuildRollbackChecks
{
    public static async Task RunAsync(DbContextOptions<AppDbContext> options)
    {
        var failure = new FailJournalInsert();
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>(options).AddInterceptors(failure).Options);
        var company = new Company { Name = "Sample nested rebuild", GlPostingEnabled = true };
        var buyer = new Client { Name = "Sample rebuild buyer", Company = company };
        db.AddRange(company, buyer);
        await db.SaveChangesAsync();
        var invoice = new Invoice { CompanyId = company.Id, ClientId = buyer.Id,
            InvoiceNumber = 1, Date = new DateTime(2001, 1, 1), Subtotal = 10m,
            GSTAmount = 1.8m, GrandTotal = 11.8m, DocumentType = 4 };
        db.Invoices.Add(invoice);
        await db.SaveChangesAsync();
        await new CoaPresetSeeder(new AccountRepository(db)).SeedWholesaleAsync(company.Id);
        var posting = new PostingService(db, new GeneralLedgerService(db), NullLogger<PostingService>.Instance);
        await posting.PostInvoiceAsync(invoice);
        var original = await Snapshot();
        failure.Enabled = true;
        try
        {
            await posting.RebuildAsync(company.Id);
            throw new Exception("Injected journal failure did not abort rebuild");
        }
        catch (Exception ex) when (ex.GetBaseException().Message == "Synthetic journal insert failure") { }
        finally { failure.Enabled = false; db.ChangeTracker.Clear(); }
        if (await Snapshot() != original) throw new Exception("Failed rebuild altered committed entries or lines");
        Console.WriteLine("PASS: failure after ledger removal restores original entry IDs and every ledger leg.");

        using var scope = (IDisposable)typeof(AppDbContext).GetMethod("ExclusiveLedgerScope", BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(db, null)!;
        await using var outer = await db.Database.BeginTransactionAsync();
        await posting.RebuildAsync(company.Id);
        await outer.CommitAsync();
        var entries = await db.JournalEntries.AsNoTracking().Where(e => e.CompanyId == company.Id).ToListAsync();
        var debit = await db.JournalLines.Where(l => l.JournalEntry.CompanyId == company.Id).SumAsync(l => l.Debit);
        var credit = await db.JournalLines.Where(l => l.JournalEntry.CompanyId == company.Id).SumAsync(l => l.Credit);
        if (entries.Count != 1 || debit != 11.8m || credit != 11.8m)
            throw new Exception("Nested backfill-style rebuild did not converge");
        Console.WriteLine("PASS: rebuild inside an existing exclusive backfill transaction remains balanced and posts each source once.");

        async Task<string> Snapshot() => JsonSerializer.Serialize(await db.JournalEntries.AsNoTracking()
            .Where(e => e.CompanyId == company.Id).Select(e => new { e.Id, e.EntryNo, e.SourceDocId,
                Lines = e.Lines.OrderBy(l => l.Id).Select(l => new { l.Id, l.AccountId, l.Debit, l.Credit }) }).ToListAsync());
    }

    private sealed class FailJournalInsert : DbCommandInterceptor
    {
        public bool Enabled;
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (Enabled && command.CommandText.Contains("INSERT INTO [JournalEntries]"))
                throw new InvalidOperationException("Synthetic journal insert failure");
            return ValueTask.FromResult(result);
        }
    }
}

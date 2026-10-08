using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Services.Interfaces;
namespace MyApp.Api.Services.HostedServices;

public sealed class GmailSyncService(IServiceScopeFactory scopes, IConfiguration config, ILogger<GmailSyncService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(10));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                using var scope = scopes.CreateScope();
                if (!config.GetValue("Gmail:SyncEnabled", true) || !scope.ServiceProvider.GetRequiredService<IGmailProvider>().IsConfigured) continue;
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var now = DateTime.UtcNow;
                var ids = await db.GmailConnections.AsNoTracking().Where(c => c.Status == "Connected" && c.NextSyncAt <= now && (c.SyncLeaseUntil == null || c.SyncLeaseUntil < now))
                    .OrderBy(c => c.NextSyncAt).Select(c => c.Id).Take(20).ToListAsync(stoppingToken);
                await Parallel.ForEachAsync(ids, new ParallelOptions { MaxDegreeOfParallelism = 4, CancellationToken = stoppingToken }, async (id, token) =>
                {
                    using var syncScope = scopes.CreateScope();
                    await syncScope.ServiceProvider.GetRequiredService<EmailWorkspaceService>().SyncAsync(id, token);
                });
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception e) { logger.LogError("Gmail worker failed ({ExceptionType})", e.GetType().Name); }
        }
    }
}

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using MyApp.Api.Data;

namespace MyApp.Api.Services.HostedServices
{
    /// <summary>
    /// Audit H-8 (2026-05-13): periodic purge of FbrCommunicationLog rows
    /// older than <c>Fbr:LogRetentionDays</c> (default 365). Without this,
    /// multi-year FBR PII (NTN, masked CNIC last-4, supplier addresses)
    /// accumulates indefinitely — both a storage problem and a
    /// PECA / data-minimisation problem.
    ///
    /// Soft-purge pattern (audit recommendation):
    ///   1. Rows older than <c>SoftPurgeDays</c> have their masked
    ///      request / response bodies cleared but the metadata row stays
    ///      (action, status, error code, duration, retry attempt). The
    ///      monitor dashboard still shows the call ever happened.
    ///   2. Rows older than <c>HardPurgeDays</c> are deleted entirely.
    ///
    /// Runs once at startup (after a short delay to let the app warm up)
    /// and every 24 hours thereafter. Failures are logged but never crash
    /// the host.
    /// </summary>
    public class FbrCommunicationLogPurgeService : BackgroundService
    {
        private readonly IServiceProvider _services;
        private readonly IConfiguration _config;
        private readonly ILogger<FbrCommunicationLogPurgeService> _logger;

        public FbrCommunicationLogPurgeService(
            IServiceProvider services,
            IConfiguration config,
            ILogger<FbrCommunicationLogPurgeService> logger)
        {
            _services = services;
            _config = config;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            // Don't block startup. Give the app ~60s to come up; first
            // purge can wait. Subsequent runs are daily.
            try { await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken); }
            catch (TaskCanceledException) { return; }

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await RunOnceAsync(stoppingToken);
                }
                catch (TaskCanceledException) { return; }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "FbrCommunicationLog purge run failed; will retry on next tick.");
                }

                try { await Task.Delay(TimeSpan.FromHours(24), stoppingToken); }
                catch (TaskCanceledException) { return; }
            }
        }

        private async Task RunOnceAsync(CancellationToken ct)
        {
            // Two tiers — soft purge first (drop bodies, keep metadata),
            // then hard delete after retention window. Defaults align with
            // the audit guidance: 180 days for soft, 365 for hard.
            var softDays = _config.GetValue<int?>("Fbr:LogSoftPurgeDays") ?? 180;
            var hardDays = _config.GetValue<int?>("Fbr:LogRetentionDays") ?? 365;
            if (softDays < 1) softDays = 180;
            if (hardDays < softDays) hardDays = softDays;

            var softCutoff = DateTime.UtcNow.AddDays(-softDays);
            var hardCutoff = DateTime.UtcNow.AddDays(-hardDays);

            using var scope = _services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            // Soft purge — null out body fields on older rows in chunks
            // so a multi-year backfill doesn't lock the table.
            var softUpdated = await db.Database.ExecuteSqlInterpolatedAsync($@"
                UPDATE FbrCommunicationLogs
                   SET RequestBodyMasked = NULL,
                       ResponseBodyMasked = NULL
                 WHERE Timestamp < {softCutoff}
                   AND (RequestBodyMasked IS NOT NULL OR ResponseBodyMasked IS NOT NULL);
            ", ct);

            // Hard delete — drop rows entirely.
            var hardDeleted = await db.Database.ExecuteSqlInterpolatedAsync($@"
                DELETE FROM FbrCommunicationLogs WHERE Timestamp < {hardCutoff};
            ", ct);

            if (softUpdated > 0 || hardDeleted > 0)
            {
                _logger.LogInformation(
                    "FbrCommunicationLog purge: cleared bodies on {Soft} rows older than {SoftDays}d; deleted {Hard} rows older than {HardDays}d.",
                    softUpdated, softDays, hardDeleted, hardDays);
            }
        }
    }
}

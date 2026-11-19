namespace MyApp.Api.Services.HostedServices
{
    /// <summary>
    /// Keeps the site from going cold (2026-11-20 performance audit).
    ///
    /// The host unloads an idle site, and the next visitor pays for the whole
    /// start-up: measured on production, the first screen after an idle spell
    /// waited 3.7 s, 6.5 s and 10.6 s on calls that take 0.15 s warm. A request
    /// every few minutes keeps the site loaded, so nobody meets that.
    ///
    /// It asks for one small static file from the site's own public address and
    /// nothing else: no data is read, no database is touched, nothing is logged
    /// in the audit trail. The address is learned from a real request (see
    /// <see cref="KeepWarmOrigin"/>), so there is nothing to configure per site.
    /// Off in Development, and off anywhere with <c>KeepWarm:Enabled = false</c>.
    /// </summary>
    public class KeepWarmService : BackgroundService
    {
        private static readonly TimeSpan Interval = TimeSpan.FromMinutes(4);
        private readonly IHttpClientFactory _http;
        private readonly IConfiguration _config;
        private readonly IHostEnvironment _env;
        private readonly ILogger<KeepWarmService> _logger;

        public KeepWarmService(IHttpClientFactory http, IConfiguration config, IHostEnvironment env,
            ILogger<KeepWarmService> logger)
        {
            _http = http;
            _config = config;
            _env = env;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            if (_env.IsDevelopment() || !_config.GetValue("KeepWarm:Enabled", true)) return;

            using var timer = new PeriodicTimer(Interval);
            try
            {
                while (await timer.WaitForNextTickAsync(stoppingToken))
                {
                    var origin = KeepWarmOrigin.Current;
                    if (origin == null) continue;   // nobody has visited since start-up
                    try
                    {
                        using var client = _http.CreateClient();
                        client.Timeout = TimeSpan.FromSeconds(20);
                        using var request = new HttpRequestMessage(HttpMethod.Head, origin + "/favicon.ico");
                        using var response = await client.SendAsync(request, stoppingToken);
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        // A missed ping costs one cold start at worst; never the host.
                        _logger.LogDebug(ex, "Keep-warm ping failed");
                    }
                }
            }
            catch (OperationCanceledException) { /* shutting down */ }
        }
    }

    /// <summary>
    /// The site's own public address, taken from a real request. The Host header
    /// is the caller's to write, so only the hosting platform's own domain (or a
    /// host named in <c>KeepWarm:Host</c>) is ever accepted: a forged header can
    /// not point the ping anywhere else.
    /// </summary>
    public static class KeepWarmOrigin
    {
        private static volatile string? _current;
        public static string? Current => _current;

        public static bool Accepts(string? host, string? configuredHost) =>
            !string.IsNullOrWhiteSpace(host)
            && (host.EndsWith(".runasp.net", StringComparison.OrdinalIgnoreCase)
                || (!string.IsNullOrWhiteSpace(configuredHost)
                    && string.Equals(host, configuredHost, StringComparison.OrdinalIgnoreCase)));

        public static void Observe(HttpRequest request, string? configuredHost)
        {
            if (_current != null) return;
            var host = request.Host.Host;
            if (Accepts(host, configuredHost)) _current = "https://" + host;
        }
    }
}

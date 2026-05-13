using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.IdentityModel.Tokens;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using MyApp.Api.Repositories.Implementations;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Services.Interfaces;
using MyApp.Api.Services.Tax;
using Polly;
using Serilog;
using Serilog.Events;

// ── Serilog bootstrap (must precede WebApplication.CreateBuilder) ──
// Captures startup-failure logs that would otherwise be lost. Real config
// is read from appsettings (logger replaced via builder.Host.UseSerilog
// below); this bootstrap logger only catches "the server crashed before
// it could even read config" — rare but devastating without it.
Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .WriteTo.Console()
    .WriteTo.File(
        path: Path.Combine(AppContext.BaseDirectory, "logs", "bootstrap-.log"),
        rollingInterval: RollingInterval.Day,
        retainedFileCountLimit: 7)
    .CreateBootstrapLogger();

try
{
var builder = WebApplication.CreateBuilder(args);

// Serilog as the host logger — config from appsettings.{Environment}.json
// "Serilog" section. Falls back to sensible defaults if config is missing.
// Async sinks aren't strictly necessary at this scale; sticking with
// synchronous file sink to keep diagnostics linear (a 50 ms write is
// fine in exchange for guaranteed line ordering on crash).
builder.Host.UseSerilog((ctx, services, lc) => lc
    .ReadFrom.Configuration(ctx.Configuration)
    .ReadFrom.Services(services)
    .Enrich.FromLogContext()
    .Enrich.WithProperty("Application", "MyApp.Api")
    .Enrich.WithProperty("Environment", ctx.HostingEnvironment.EnvironmentName)
    // Defaults if config doesn't override — durable rolling file in
    // logs/ next to the binary, 30-day retention, 50 MB cap per file.
    .WriteTo.Console(restrictedToMinimumLevel: LogEventLevel.Information)
    .WriteTo.File(
        path: Path.Combine(AppContext.BaseDirectory, "logs", "api-.log"),
        rollingInterval: RollingInterval.Day,
        retainedFileCountLimit: 30,
        fileSizeLimitBytes: 50 * 1024 * 1024,
        rollOnFileSizeLimit: true,
        shared: true,
        // Excluded the noisy framework loggers from the file sink — the
        // Console sink keeps them at Warning so dev can still spot issues.
        restrictedToMinimumLevel: LogEventLevel.Information));

// Add services to the container
builder.Services.AddControllers(); // 👈 Needed for controllers
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection"))
           .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning)));

// Register Swagger generator
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// JWT Authentication — key MUST come from a non-committed source:
//   • env var Jwt__Key  (recommended for prod)
//   • appsettings.{Development,Production,Local}.json  (gitignored)
// We refuse to start with an empty / default key so a misconfigured
// deploy fails loudly rather than running on a forgeable signing key.
var jwtKey = builder.Configuration["Jwt:Key"];
if (string.IsNullOrWhiteSpace(jwtKey) || jwtKey.Length < 32)
{
    throw new InvalidOperationException(
        "Jwt:Key is missing or too short (minimum 32 chars). Set it via " +
        "the Jwt__Key environment variable or appsettings.{Environment}.json. " +
        "Never commit a real signing key to git.");
}

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = builder.Configuration["Jwt:Issuer"],
        ValidAudience = builder.Configuration["Jwt:Audience"],
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
        // Audit H-10 (2026-05-13): default ClockSkew is 5 minutes,
        // which silently extends every token's lifetime. Tight to 30s
        // so a revoked / expired token can't keep authenticating.
        ClockSkew = TimeSpan.FromSeconds(30),
    };

    // Audit C-6 (2026-05-13): server-side token revocation. On every
    // validated token, compare the "stamp" claim to the user's current
    // Users.SecurityStamp column. Mismatch = token was minted before
    // the most recent logout / password change → reject. Cached for
    // 60s per user so the per-request overhead is one in-memory hit.
    options.Events = new JwtBearerEvents
    {
        OnTokenValidated = async context =>
        {
            var principal = context.Principal;
            if (principal == null)
            {
                context.Fail("Token has no principal");
                return;
            }

            var sub = principal.FindFirstValue(JwtRegisteredClaimNames.Sub)
                     ?? principal.FindFirstValue(ClaimTypes.NameIdentifier);
            var stamp = principal.FindFirstValue("stamp");
            if (string.IsNullOrEmpty(sub) || string.IsNullOrEmpty(stamp))
            {
                // Tokens minted before C-6 (no stamp claim) are
                // tolerated for one rotation cycle — they still
                // authenticate but cannot be revoked. Treat absent
                // stamp as "stamp-less legacy token".
                return;
            }

            if (!int.TryParse(sub, out var userId))
            {
                context.Fail("Invalid subject claim");
                return;
            }

            var cache = context.HttpContext.RequestServices
                .GetRequiredService<Microsoft.Extensions.Caching.Memory.IMemoryCache>();
            var cacheKey = $"user-stamp:{userId}";
            if (!cache.TryGetValue<string>(cacheKey, out var currentStamp))
            {
                var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
                currentStamp = await db.Users
                    .Where(u => u.Id == userId)
                    .Select(u => u.SecurityStamp)
                    .FirstOrDefaultAsync();
                if (currentStamp != null)
                {
                    cache.Set(cacheKey, currentStamp, TimeSpan.FromSeconds(60));
                }
            }

            if (currentStamp != null && !string.Equals(currentStamp, stamp, StringComparison.Ordinal))
            {
                context.Fail("Token has been revoked");
            }
        }
    };
});

// Rate limiter — applied selectively to /api/auth/login + the
// expensive endpoints flagged by audit H-6 (2026-05-13). Other
// endpoints stay unrestricted to avoid breaking bulk operations the
// operator runs (Validate All, Submit All, etc.).
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    // Helper: partition by user id when authenticated, else by IP.
    // The login policy uses IP only (no user yet). Other policies
    // partition by user id so a shared NAT doesn't starve everyone.
    static string UserOrIp(HttpContext ctx) =>
        ctx.User?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
        ?? ctx.User?.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value
        ?? ctx.Connection.RemoteIpAddress?.ToString()
        ?? "unknown";

    options.AddPolicy("login", httpContext =>
    {
        var ip = httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(ip, _ => new FixedWindowRateLimiterOptions
        {
            // 10 attempts per IP per minute — generous enough for a typo
            // recovery, tight enough to stop credential stuffing.
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
        });
    });

    // Audit H-6: FBR submit / validate. Each call is one outbound PRAL
    // round-trip — 30/min/user is generous for a busy operator running
    // Validate All and tight enough to stop a buggy script burning
    // through the company's daily quota.
    options.AddPolicy("fbrSubmit", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(UserOrIp(httpContext), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 30,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        }));

    // Audit H-6: file imports (FBR purchase xls, PO PDF parser,
    // challan Excel). Each call can do 25 MB I/O + CPU. 10/min/user
    // is generous for a one-off upload pass, tight enough to stop a
    // confused or malicious script.
    options.AddPolicy("import", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(UserOrIp(httpContext), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        }));

    // Audit H-6: password change. BCrypt verify + hash = ~200 ms CPU
    // each. 5/hour/user is plenty for legitimate change flows.
    options.AddPolicy("passwordChange", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(UserOrIp(httpContext), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 5,
            Window = TimeSpan.FromHours(1),
            QueueLimit = 0,
        }));
});

// Register Repositories
builder.Services.AddScoped<ICompanyRepository, CompanyRepository>();
builder.Services.AddScoped<IDeliveryChallanRepository, DeliveryChallanRepository>();
builder.Services.AddScoped<IClientRepository, ClientRepository>();
builder.Services.AddScoped<ISupplierRepository, SupplierRepository>();
builder.Services.AddScoped<IInvoiceRepository, InvoiceRepository>();
builder.Services.AddScoped<IItemTypeRepository, ItemTypeRepository>();
builder.Services.AddScoped<IPrintTemplateRepository, PrintTemplateRepository>();
builder.Services.AddScoped<IMergeFieldRepository, MergeFieldRepository>();
builder.Services.AddScoped<IAuditLogRepository, AuditLogRepository>();

// Register Services
builder.Services.AddScoped<ICompanyService, CompanyService>();
builder.Services.AddScoped<IDeliveryChallanService, DeliveryChallanService>();
builder.Services.AddScoped<IClientService, ClientService>();
// "Common Clients" grouping — the same legal entity (matched by NTN, then
// fallback to normalised name) shared across multiple companies. Sits
// alongside the per-company ClientService; existing per-company flows
// keep working unchanged.
builder.Services.AddScoped<IClientGroupService, ClientGroupService>();
builder.Services.AddScoped<ISupplierService, SupplierService>();
// "Common Suppliers" grouping — same shape as IClientGroupService for
// the purchase side. Lets the same legal entity (matched by NTN, then
// fallback to normalised name) act as a single supplier across multiple
// tenants. Existing per-company SupplierService flows keep working
// unchanged; this is purely additive.
builder.Services.AddScoped<ISupplierGroupService, SupplierGroupService>();
builder.Services.AddScoped<IPurchaseBillService, PurchaseBillService>();
builder.Services.AddScoped<IGoodsReceiptService, GoodsReceiptService>();
builder.Services.AddScoped<IInvoiceService, InvoiceService>();
builder.Services.AddScoped<IItemTypeService, ItemTypeService>();
builder.Services.AddScoped<IAuditLogService, AuditLogService>();
builder.Services.AddScoped<IFbrService, FbrService>();
builder.Services.AddScoped<IFbrLookupService, FbrLookupService>();
// Inventory accounting: stock movements + on-hand + availability check.
// All write operations are no-ops when Company.InventoryTrackingEnabled
// is false, so existing tenants keep working unchanged.
builder.Services.AddScoped<IStockService, StockService>();
// Tax mapping engine: single source of truth for HS_UOM, SaleTypeToRate
// and scenario rules. Used by ItemType save (auto-pick UOM) and FBR
// pre-validate (combination check before submitting).
builder.Services.AddScoped<ITaxMappingEngine, TaxMappingEngine>();
// FBR Sandbox: backs the per-company FBR test-scenarios tab. Demo bills
// live in their own 900000+ number range and never collide with real
// company bill numbering (see Invoice.IsDemo / DeliveryChallan.IsDemo).
builder.Services.AddScoped<IFbrSandboxService, FbrSandboxService>();
builder.Services.AddSingleton<IPOParserService, POParserService>();
builder.Services.AddSingleton<IPOFormatFingerprintService, POFormatFingerprintService>();
builder.Services.AddScoped<IPOFormatRegistry, POFormatRegistry>();
builder.Services.AddSingleton<IRuleBasedPOParser, RuleBasedPOParser>();
builder.Services.AddScoped<IRegressionService, RegressionService>();

// ── FBR Purchase Import (Annexure-A xls upload, Phase 1: preview) ──
// Parser + filter are stateless / Scoped because they don't hold any
// per-request data; the orchestrator depends on AppDbContext via the
// matcher so it must be Scoped too. No singleton — keeps DB lifetime
// management trivial.
builder.Services.AddScoped<IFbrPurchaseLedgerParser, FbrPurchaseLedgerParser>();
builder.Services.AddScoped<IFbrPurchaseImportFilter, FbrPurchaseImportFilter>();
builder.Services.AddScoped<IFbrPurchaseImportMatcher, FbrPurchaseImportMatcher>();
builder.Services.AddScoped<IFbrPurchaseImportCommitter, FbrPurchaseImportCommitter>();
builder.Services.AddScoped<IFbrPurchaseImportService, FbrPurchaseImportService>();

// Dashboard KPI aggregator. Scoped because it depends on AppDbContext
// and IPermissionService — both Scoped — and the queries use the
// per-request user identity for permission checks.
builder.Services.AddScoped<IDashboardService, DashboardService>();

// Tax-claim helper — drives the in-form HS-stock panel on the
// Invoices-tab edit screen. Scoped (depends on AppDbContext).
builder.Services.AddScoped<ITaxClaimService, TaxClaimService>();

// Historical challan import (reverse Excel template → preview → commit).
// Reverse mapper is a Singleton because it holds an in-memory cache keyed on
// the template file path + lastWriteTime — rebuilds automatically when the
// operator re-uploads a template, and shared safely across requests.
builder.Services.AddSingleton<IExcelTemplateReverseMapper, ExcelTemplateReverseMapper>();
builder.Services.AddScoped<IChallanExcelImporter, ChallanExcelImporter>();
// Sensitive-data redactor — shared by GlobalExceptionMiddleware and
// FbrService for consistent NTN/CNIC masking + credential redaction.
// Singleton because the regexes are stateless and compiled once.
builder.Services.AddSingleton<ISensitiveDataRedactor, SensitiveDataRedactor>();

// FBR communication log — dedicated trail for audit H-3.
builder.Services.AddScoped<IFbrCommunicationLogService, FbrCommunicationLogService>();

// Audit H-8 (2026-05-13): daily purge job. Soft-clears bodies on rows
// past Fbr:LogSoftPurgeDays (default 180), hard-deletes past
// Fbr:LogRetentionDays (default 365).
builder.Services.AddHostedService<MyApp.Api.Services.HostedServices.FbrCommunicationLogPurgeService>();

// HttpContextAccessor — needed by FbrService etc. so they can pull the
// current request's CorrelationId without taking HttpContext directly.
builder.Services.AddHttpContextAccessor();

// FBR HttpClient — see audit H-1 (no retry), H-2 (no timeout).
//   • 30 s timeout per attempt (vs 100 s framework default that was
//     blocking Kestrel threads under FBR brownouts)
//   • Standard resilience handler: retry transient failures, circuit-
//     break after sustained failures, plus per-attempt timeout. The
//     default policy in Microsoft.Extensions.Http.Resilience handles
//     5xx and HttpRequestException with exponential backoff.
builder.Services.AddHttpClient("FBR", client =>
{
    client.Timeout = TimeSpan.FromSeconds(30);
    client.DefaultRequestHeaders.Add("User-Agent", "MyApp.Api/1.0");
})
.AddStandardResilienceHandler(options =>
{
    // Total time across retries — must exceed per-attempt timeout × max
    // attempts or the resilience pipeline trips its own guard.
    options.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(120);
    options.AttemptTimeout.Timeout = TimeSpan.FromSeconds(30);
    options.Retry.MaxRetryAttempts = 3;
    options.Retry.Delay = TimeSpan.FromSeconds(2);
    options.Retry.BackoffType = DelayBackoffType.Exponential;
    // Audit C-13 (2026-05-13): NEVER retry POST. PRAL's submit endpoint
    // is not strictly idempotent — a retried POST after a connection
    // timeout but a successful FBR-side commit issues a second IRN that
    // PersistStatus would then overwrite the first with. Keep retries on
    // GET / catalog lookups; submit/validate stay one-shot. Operator can
    // manually retry through the UI if needed (after checking the
    // monitor for a successful first IRN).
    options.Retry.ShouldHandle = args =>
    {
        if (args.Outcome.Result?.RequestMessage?.Method == HttpMethod.Post)
            return ValueTask.FromResult(false);
        // Default predicate (transient errors): 5xx / HttpRequestException
        // / timeouts on non-POST methods.
        if (args.Outcome.Exception is HttpRequestException) return ValueTask.FromResult(true);
        if (args.Outcome.Exception is TaskCanceledException) return ValueTask.FromResult(true);
        var status = (int?)args.Outcome.Result?.StatusCode ?? 0;
        return ValueTask.FromResult(status >= 500 && status < 600);
    };
    // Open circuit after 5 failures across a 30 s window; half-open
    // after 15 s. Tuned to FBR sandbox behaviour (occasional 30-60 s
    // outages during their nightly maintenance).
    options.CircuitBreaker.SamplingDuration = TimeSpan.FromSeconds(60);
    options.CircuitBreaker.MinimumThroughput = 5;
    options.CircuitBreaker.FailureRatio = 0.5;
    options.CircuitBreaker.BreakDuration = TimeSpan.FromSeconds(15);
});

// Audit C-1 (2026-05-13): ASP.NET Data Protection — keys persisted to
// disk so the encrypted Company.FbrToken column survives restarts. On
// MonsterASP the key ring lives under data/keys (must NOT be in
// wwwroot — that would serve them). The application name is fixed so
// staging keys don't accidentally decrypt prod payloads.
var dataProtectionKeyDir = Path.Combine(AppContext.BaseDirectory, "data", "keys");
Directory.CreateDirectory(dataProtectionKeyDir);
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(dataProtectionKeyDir))
    .SetApplicationName("MyApp.Api");
builder.Services.AddSingleton<MyApp.Api.Helpers.IFbrTokenProtector, MyApp.Api.Helpers.FbrTokenProtector>();

// RBAC: permission service needs an in-process cache for the per-user
// permission-set TTL.
builder.Services.AddMemoryCache();
builder.Services.AddScoped<IPermissionService, PermissionService>();

// Tenant-scope guard — answers "may this user touch this company?"
// in addition to RBAC's "may this user perform this action?". Reads
// the UserCompany table when Company.IsTenantIsolated=true; passes
// through otherwise (preserves Hakimi/Roshan behaviour).
builder.Services.AddScoped<ICompanyAccessGuard, CompanyAccessGuard>();

// CORS — origins read from configuration (Cors:AllowedOrigins, comma-
// separated). Empty / missing collapses to "no cross-origin allowed",
// which is correct when the SPA is served from the same host as the
// API (the standard MonsterASP / Render setup here). Never falls back
// to AllowAnyOrigin; that combined with a stolen JWT was the gap.
var corsOrigins = (builder.Configuration["Cors:AllowedOrigins"] ?? "")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", p =>
    {
        if (corsOrigins.Length > 0)
        {
            p.WithOrigins(corsOrigins)
             .AllowAnyHeader()
             .AllowAnyMethod();
        }
        else
        {
            // No origins configured → effectively "same-origin only".
            // No-op policy; the SPA from wwwroot still works because
            // it never crosses an origin.
        }
    });
});

// Use PORT env variable for Docker/Render deployment; IIS/MonsterASP manages its own port
var port = Environment.GetEnvironmentVariable("PORT");
if (port != null)
{
    builder.WebHost.ConfigureKestrel(options =>
    {
        options.ListenAnyIP(int.Parse(port));
    });
}


var app = builder.Build();

// Auto-apply pending EF Core migrations on startup
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

    // Fix: remove bad migration records that ran as no-ops (Users table was never created).
    // Gated on __EFMigrationsHistory existing — fresh databases don't have it yet
    // and the DELETE would crash before the first Migrate() call could create it.
    db.Database.ExecuteSqlRaw(@"
        IF OBJECT_ID(N'[__EFMigrationsHistory]', N'U') IS NOT NULL
           AND NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Users')
        BEGIN
            DELETE FROM [__EFMigrationsHistory] WHERE [MigrationId] IN (
                '20260403164225_AddUsersTable',
                '20260403181242_AddUserAvatarPath',
                '20260403184710_AddClientCompanyId'
            );
        END
    ");

    // Audit M-11 (2026-05-13): auto-migrate is convenient in dev / on
    // every new feature deploy but it's also a foot-gun in prod — a
    // half-shipped migration set will start applying on first boot
    // without an operator looking. Gate behind config so production
    // can flip it off once the schema is stable.
    var autoMigrate = builder.Configuration.GetValue<bool>("Database:AutoMigrate", true);
    if (autoMigrate)
    {
        db.Database.Migrate();
    }
    else
    {
        Log.Information("Database:AutoMigrate is false — skipping db.Database.Migrate(). Run `dotnet ef database update` manually.");
    }

    // ── Unique indexes on (CompanyId, *Number) for Invoice / PurchaseBill /
    // GoodsReceipt — audit C-8 (2026-05-13). Pre-fix, two concurrent
    // creates could both land MAX(*Number)+1 and silently duplicate.
    // Idempotent: drops the prior NON-UNIQUE composite indexes if present
    // and recreates them UNIQUE. DeliveryChallan stays non-unique by
    // design (Duplicate Challan feature emits same-number rows).
    //
    // If duplicate rows already exist the CREATE UNIQUE INDEX would fail
    // — we log a clear AuditLog row and leave the legacy non-unique
    // index in place. Operators have to dedupe first; the system stays
    // working in the meantime.
    db.Database.ExecuteSqlRaw(@"
        BEGIN TRY
            IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Invoices_CompanyId_InvoiceNumber' AND object_id = OBJECT_ID('Invoices') AND is_unique = 0)
            BEGIN
                DROP INDEX [IX_Invoices_CompanyId_InvoiceNumber] ON [Invoices];
                CREATE UNIQUE INDEX [IX_Invoices_CompanyId_InvoiceNumber] ON [Invoices] ([CompanyId], [InvoiceNumber]);
            END
            ELSE IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Invoices_CompanyId_InvoiceNumber' AND object_id = OBJECT_ID('Invoices'))
            BEGIN
                CREATE UNIQUE INDEX [IX_Invoices_CompanyId_InvoiceNumber] ON [Invoices] ([CompanyId], [InvoiceNumber]);
            END
        END TRY
        BEGIN CATCH
            -- Duplicate data prevents the unique index. Leave the existing
            -- index in place; the service-layer retry on save still helps,
            -- but operators must dedupe before full protection lands.
            INSERT INTO AuditLogs (Timestamp, Level, UserName, HttpMethod, RequestPath, StatusCode, ExceptionType, Message)
            VALUES (SYSUTCDATETIME(), 'Warning', 'system', 'SEED', '/migrations/unique-invoice-number', 500,
                    'INVOICE_UNIQUE_INDEX_BLOCKED',
                    CONCAT('Could not enforce UNIQUE (CompanyId, InvoiceNumber): ', ERROR_MESSAGE()));
        END CATCH;

        BEGIN TRY
            IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseBills_CompanyId_PurchaseBillNumber' AND object_id = OBJECT_ID('PurchaseBills') AND is_unique = 0)
            BEGIN
                DROP INDEX [IX_PurchaseBills_CompanyId_PurchaseBillNumber] ON [PurchaseBills];
                CREATE UNIQUE INDEX [IX_PurchaseBills_CompanyId_PurchaseBillNumber] ON [PurchaseBills] ([CompanyId], [PurchaseBillNumber]);
            END
            ELSE IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseBills_CompanyId_PurchaseBillNumber' AND object_id = OBJECT_ID('PurchaseBills'))
            BEGIN
                CREATE UNIQUE INDEX [IX_PurchaseBills_CompanyId_PurchaseBillNumber] ON [PurchaseBills] ([CompanyId], [PurchaseBillNumber]);
            END
        END TRY
        BEGIN CATCH
            INSERT INTO AuditLogs (Timestamp, Level, UserName, HttpMethod, RequestPath, StatusCode, ExceptionType, Message)
            VALUES (SYSUTCDATETIME(), 'Warning', 'system', 'SEED', '/migrations/unique-purchasebill-number', 500,
                    'PURCHASEBILL_UNIQUE_INDEX_BLOCKED',
                    CONCAT('Could not enforce UNIQUE (CompanyId, PurchaseBillNumber): ', ERROR_MESSAGE()));
        END CATCH;

        BEGIN TRY
            IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GoodsReceipts_CompanyId_GoodsReceiptNumber' AND object_id = OBJECT_ID('GoodsReceipts') AND is_unique = 0)
            BEGIN
                DROP INDEX [IX_GoodsReceipts_CompanyId_GoodsReceiptNumber] ON [GoodsReceipts];
                CREATE UNIQUE INDEX [IX_GoodsReceipts_CompanyId_GoodsReceiptNumber] ON [GoodsReceipts] ([CompanyId], [GoodsReceiptNumber]);
            END
            ELSE IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GoodsReceipts_CompanyId_GoodsReceiptNumber' AND object_id = OBJECT_ID('GoodsReceipts'))
            BEGIN
                CREATE UNIQUE INDEX [IX_GoodsReceipts_CompanyId_GoodsReceiptNumber] ON [GoodsReceipts] ([CompanyId], [GoodsReceiptNumber]);
            END
        END TRY
        BEGIN CATCH
            INSERT INTO AuditLogs (Timestamp, Level, UserName, HttpMethod, RequestPath, StatusCode, ExceptionType, Message)
            VALUES (SYSUTCDATETIME(), 'Warning', 'system', 'SEED', '/migrations/unique-goodsreceipt-number', 500,
                    'GOODSRECEIPT_UNIQUE_INDEX_BLOCKED',
                    CONCAT('Could not enforce UNIQUE (CompanyId, GoodsReceiptNumber): ', ERROR_MESSAGE()));
        END CATCH;
    ");

    // ── SecurityStamp column for token revocation ──────────────────────
    // Audit C-6 (2026-05-13). Adds the Users.SecurityStamp column out-of-
    // band (no formal EF migration) so we don't need to regenerate the
    // snapshot/designer files. The column is idempotently created and
    // every existing user is seeded with a fresh stamp so prior bcrypt
    // hashes still authenticate. Subsequent logouts / password changes
    // rotate the value; the token validator compares the JWT's "stamp"
    // claim to this column on every request — mismatch = 401.
    db.Database.ExecuteSqlRaw(@"
        IF NOT EXISTS (SELECT 1 FROM sys.columns
                       WHERE object_id = OBJECT_ID('Users') AND name = 'SecurityStamp')
        BEGIN
            ALTER TABLE [Users] ADD [SecurityStamp] nvarchar(64) NULL;
        END;
        UPDATE [Users] SET [SecurityStamp] = REPLACE(CONVERT(varchar(36), NEWID()), '-', '')
        WHERE [SecurityStamp] IS NULL;
        IF EXISTS (SELECT 1 FROM sys.columns
                   WHERE object_id = OBJECT_ID('Users') AND name = 'SecurityStamp' AND is_nullable = 1)
        BEGIN
            ALTER TABLE [Users] ALTER COLUMN [SecurityStamp] nvarchar(64) NOT NULL;
        END
    ");

    // One-time tagging: any pre-existing bills whose paymentTerms start
    // with "[SNxxx]" came from the legacy FBR Sandbox seed flow (or the
    // python script). They predate the IsDemo column, so the migration
    // left them with IsDemo=false — meaning they polluted the regular
    // Bills page. Flip them to IsDemo=true once.
    //
    // CRITICAL: this MUST be guarded by an audit-log marker, not by
    // `WHERE IsDemo = 0`. The new StandaloneInvoiceForm flow legitimately
    // tags every bill with "[SNxxx]" so FbrService can route the right
    // scenarioId on Validate / Submit — those are REAL bills, not demos.
    // Without this guard, every non-demo bill with a scenario tag gets
    // hidden from the Bills page on the next backend restart.
    //
    // Marker pattern matches what RbacSeeder / ItemTypeSeeder /
    // CommonClientsBackfill etc. already use elsewhere in this file.
    var sandboxTagBackfillRan = await db.AuditLogs
        .AnyAsync(a => a.ExceptionType == "SANDBOX_SNTAG_BACKFILL_V1");
    if (!sandboxTagBackfillRan)
    {
        db.Database.ExecuteSqlRaw(@"
            UPDATE Invoices
               SET IsDemo = 1
             WHERE IsDemo = 0
               AND PaymentTerms LIKE '[[]SN0%]%';
            UPDATE dc
               SET dc.IsDemo = 1
              FROM DeliveryChallans dc
             WHERE dc.IsDemo = 0
               AND EXISTS (SELECT 1 FROM Invoices i
                            WHERE i.Id = dc.InvoiceId AND i.IsDemo = 1);
        ");
        db.AuditLogs.Add(new MyApp.Api.Models.AuditLog
        {
            Timestamp = DateTime.UtcNow,
            Level = "Info",
            UserName = "system",
            HttpMethod = "SEED",
            RequestPath = "/migrations/sandbox-sntag-backfill",
            StatusCode = 200,
            ExceptionType = "SANDBOX_SNTAG_BACKFILL_V1",
            Message = "One-time backfill: flagged legacy [SNxxx]-tagged bills as IsDemo=true."
        });
        await db.SaveChangesAsync();
    }

    // Seed the starter catalog of FBR-mapped item types (idempotent — skips
    // any HS code / name already present, so it's safe to run on every boot)
    await MyApp.Api.Data.ItemTypeSeeder.SeedAsync(db);

    // ── Units backfill ──────────────────────────────────────────────────
    // The Units table is the canonical store for the AllowsDecimalQuantity
    // flag. Every UOM string that the operator might ever pick — both from
    // FBR's master list AND from data already in the system — needs a row
    // here so the admin grid can configure it.
    //
    // Sources for the union, all deduped against the Units table:
    //   • FBR master UOM list      — hardcoded mirror of /api/fbr/uom (44
    //                                 entries from gw.fbr.gov.pk/pdi/v1/uom).
    //                                 Doesn't require a token; works offline.
    //   • ItemType.UOM             — operator's catalog choice (FBR HS_UOM)
    //   • InvoiceItem.UOM          — what was billed
    //   • DeliveryItem.Unit        — what was delivered
    //
    // Idempotent: only inserts names not already present (case-insensitive
    // match, matching SQL Server's CI collation on the unique index). After
    // the insert pass, re-apply the decimal-default seed so newly-added
    // rows (e.g. "Liter" coming in for the first time from FBR's list)
    // get the flag set correctly.
    db.Database.ExecuteSqlRaw(@"
        ;WITH FbrMaster (Name) AS (
            -- Mirror of the FBR /uom reference list (V1.12 §5.5).
            -- Deduped by description (FBR returns multiple UOM_IDs per name).
            SELECT N'MT'                       UNION ALL
            SELECT N'Bill of lading'           UNION ALL
            SELECT N'SET'                      UNION ALL
            SELECT N'KWH'                      UNION ALL
            SELECT N'40KG'                     UNION ALL
            SELECT N'Liter'                    UNION ALL
            SELECT N'SqY'                      UNION ALL
            SELECT N'Bag'                      UNION ALL
            SELECT N'KG'                       UNION ALL
            SELECT N'MMBTU'                    UNION ALL
            SELECT N'Meter'                    UNION ALL
            SELECT N'Pcs'                      UNION ALL
            SELECT N'Carat'                    UNION ALL
            SELECT N'Cubic Metre'              UNION ALL
            SELECT N'Dozen'                    UNION ALL
            SELECT N'Gram'                     UNION ALL
            SELECT N'Gallon'                   UNION ALL
            SELECT N'Kilogram'                 UNION ALL
            SELECT N'Pound'                    UNION ALL
            SELECT N'Timber Logs'              UNION ALL
            SELECT N'Numbers, pieces, units'   UNION ALL
            SELECT N'Packs'                    UNION ALL
            SELECT N'Pair'                     UNION ALL
            SELECT N'Square Foot'              UNION ALL
            SELECT N'Square Metre'             UNION ALL
            SELECT N'Thousand Unit'            UNION ALL
            SELECT N'Mega Watt'                UNION ALL
            SELECT N'Foot'                     UNION ALL
            SELECT N'Barrels'                  UNION ALL
            SELECT N'NO'                       UNION ALL
            SELECT N'Others'                   UNION ALL
            SELECT N'1000 kWh'
        ),
        AllUoms AS (
            SELECT Name FROM FbrMaster
            UNION
            SELECT DISTINCT LTRIM(RTRIM(UOM))
              FROM ItemTypes
             WHERE UOM IS NOT NULL AND LTRIM(RTRIM(UOM)) <> ''
            UNION
            SELECT DISTINCT LTRIM(RTRIM(UOM))
              FROM InvoiceItems
             WHERE UOM IS NOT NULL AND LTRIM(RTRIM(UOM)) <> ''
            UNION
            SELECT DISTINCT LTRIM(RTRIM(Unit))
              FROM DeliveryItems
             WHERE Unit IS NOT NULL AND LTRIM(RTRIM(Unit)) <> ''
        )
        INSERT INTO Units (Name, AllowsDecimalQuantity)
        SELECT a.Name, 0
          FROM AllUoms a
         WHERE NOT EXISTS (
                 SELECT 1 FROM Units u
                  WHERE LOWER(u.Name) = LOWER(a.Name));

        -- Re-apply the decimal-default seed across the full Units table.
        -- Idempotent: same UPDATE the migration ran, just runs again so
        -- newly-added names are picked up too.
        UPDATE Units SET AllowsDecimalQuantity = 1
         WHERE LOWER(Name) IN (
            'kg', 'kilogram', 'gram', 'pound',
            'liter', 'litre', 'gallon',
            'mt', 'carat',
            'square foot', 'sqft', 'square metre', 'sqm', 'sqy',
            'cubic metre', 'cubicmetre',
            'meter', 'metre', 'mtr', 'foot',
            'mmbtu', 'kwh', '1000 kwh', 'mega watt',
            'barrels'
         );
    ");

    // PO format baseline seeding has been REMOVED. Fresh databases now
    // start with zero PO formats — operators onboard each client layout
    // through Configuration → PO Formats. Existing databases (Hakimi,
    // Roshan, etc.) that ALREADY have the baseline formats keep them
    // untouched: the seeder was idempotent (insert-if-missing only),
    // not destructive, so removing the call doesn't delete anything.
    //
    // The seeder code at Data/POFormatSeeder.cs is preserved as
    // reference for the rule-set JSON shape. Re-enable by un-commenting
    // the two lines below if you ever want the baselines back.
    //   var fp = scope.ServiceProvider.GetRequiredService<IPOFormatFingerprintService>();
    //   await POFormatSeeder.SeedAsync(db, fp);

    // ── One-time perm migration: challans.manage.duplicate carved out of create ──
    // Pre-2026-05-08 the Duplicate button + endpoint were gated by
    // challans.manage.create. We've split it into a dedicated permission so a
    // role can be allowed to duplicate without also being granted
    // create-from-scratch. To preserve existing capability, every role that
    // already has challans.manage.create gets the new perm auto-granted on
    // first run. NOT EXISTS guards keep this idempotent. RbacSeeder will
    // insert the new permission row before this runs (because we INSERT it
    // here defensively in case ordering changes).
    db.Database.ExecuteSqlRaw(@"
        INSERT INTO Permissions ([Key], Module, Page, [Action], Description)
        SELECT 'challans.manage.duplicate', 'Challans', 'Manage', 'Duplicate',
               'Duplicate a delivery challan (clone with the same number for a different PO)'
        WHERE NOT EXISTS (SELECT 1 FROM Permissions WHERE [Key] = 'challans.manage.duplicate');

        DECLARE @createId INT = (SELECT Id FROM Permissions WHERE [Key] = 'challans.manage.create');
        DECLARE @dupId    INT = (SELECT Id FROM Permissions WHERE [Key] = 'challans.manage.duplicate');
        IF @createId IS NOT NULL AND @dupId IS NOT NULL
        BEGIN
            INSERT INTO RolePermissions (RoleId, PermissionId)
            SELECT rp.RoleId, @dupId FROM RolePermissions rp
            WHERE rp.PermissionId = @createId
              AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.RoleId = rp.RoleId AND x.PermissionId = @dupId);
        END
    ");

    // ── One-time perm migration: split invoices.fbr.post → validate + submit ──
    // The legacy single perm has been removed from the catalog and replaced
    // with two narrower ones. RbacSeeder below will purge the old permission
    // row (and cascade-delete its RolePermission rows) — so before that
    // happens, copy each role's old grant into BOTH new perms. After this
    // ran once, subsequent restarts are no-ops because the legacy perm no
    // longer exists.
    db.Database.ExecuteSqlRaw(@"
        DECLARE @oldId INT = (SELECT TOP 1 Id FROM Permissions WHERE [Key] = 'invoices.fbr.post');
        IF @oldId IS NOT NULL
        BEGIN
            -- Make sure the new perms exist (RbacSeeder will populate descriptions
            -- properly in a moment; we just need rows so the FK works).
            INSERT INTO Permissions ([Key], Module, Page, [Action], Description)
            SELECT 'invoices.fbr.validate', 'Invoices', 'FBR', 'Validate',
                   'Dry-run validate an invoice with FBR (no commit, no IRN issued)'
            WHERE NOT EXISTS (SELECT 1 FROM Permissions WHERE [Key] = 'invoices.fbr.validate');

            INSERT INTO Permissions ([Key], Module, Page, [Action], Description)
            SELECT 'invoices.fbr.submit', 'Invoices', 'FBR', 'Submit',
                   'Submit an invoice to FBR digital invoicing (commits, returns IRN)'
            WHERE NOT EXISTS (SELECT 1 FROM Permissions WHERE [Key] = 'invoices.fbr.submit');

            DECLARE @validateId INT = (SELECT Id FROM Permissions WHERE [Key] = 'invoices.fbr.validate');
            DECLARE @submitId   INT = (SELECT Id FROM Permissions WHERE [Key] = 'invoices.fbr.submit');

            -- Translate every existing grant of the old perm into both new ones.
            INSERT INTO RolePermissions (RoleId, PermissionId)
            SELECT rp.RoleId, @validateId FROM RolePermissions rp
            WHERE rp.PermissionId = @oldId
              AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.RoleId = rp.RoleId AND x.PermissionId = @validateId);

            INSERT INTO RolePermissions (RoleId, PermissionId)
            SELECT rp.RoleId, @submitId FROM RolePermissions rp
            WHERE rp.PermissionId = @oldId
              AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.RoleId = rp.RoleId AND x.PermissionId = @submitId);
        END
    ");

    // ── One-time perm migration: invoices.manage.update.itemtype.qty ──
    // Strict superset of invoices.manage.update.itemtype — same narrow
    // flow but allows Quantity edits too. Auto-grant to every role that
    // already holds the broader invoices.manage.update so existing
    // full-edit users keep working without manual configuration. The
    // narrow .itemtype role is intentionally NOT auto-upgraded — that
    // role exists specifically to BLOCK qty edits. Idempotent: NOT
    // EXISTS guards make every restart after the first a no-op.
    db.Database.ExecuteSqlRaw(@"
        INSERT INTO Permissions ([Key], Module, Page, [Action], Description)
        SELECT 'invoices.manage.update.itemtype.qty', 'Invoices', 'Manage', 'Update Item Type + Qty',
               'Edit Item Type and Quantity columns on a bill (no other fields)'
        WHERE NOT EXISTS (SELECT 1 FROM Permissions WHERE [Key] = 'invoices.manage.update.itemtype.qty');

        DECLARE @fullEditId INT = (SELECT Id FROM Permissions WHERE [Key] = 'invoices.manage.update');
        DECLARE @itQtyId    INT = (SELECT Id FROM Permissions WHERE [Key] = 'invoices.manage.update.itemtype.qty');
        IF @fullEditId IS NOT NULL AND @itQtyId IS NOT NULL
        BEGIN
            INSERT INTO RolePermissions (RoleId, PermissionId)
            SELECT rp.RoleId, @itQtyId FROM RolePermissions rp
            WHERE rp.PermissionId = @fullEditId
              AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.RoleId = rp.RoleId AND x.PermissionId = @itQtyId);
        END
    ");

    // ── One-time perm migration: invoices.fbr.exclude carved out of update ──
    // The Exclude/Include FBR toggle used to be gated by invoices.manage.update
    // (the broad bill-edit permission). It now has its own dedicated permission
    // so a role can hold the toggle without holding full edit rights.
    //
    // To preserve existing behaviour for roles that already had the broad
    // edit perm, copy that grant into the new perm on first run. Idempotent —
    // the NOT EXISTS guard makes subsequent restarts no-ops.
    db.Database.ExecuteSqlRaw(@"
        -- Make sure the new perm row exists (RbacSeeder finalises the
        -- Description below; we just need a row so the FK works).
        INSERT INTO Permissions ([Key], Module, Page, [Action], Description)
        SELECT 'invoices.fbr.exclude', 'Invoices', 'FBR', 'Exclude/Include',
               'Mark a bill as excluded from FBR bulk Validate/Submit, or re-include it'
        WHERE NOT EXISTS (SELECT 1 FROM Permissions WHERE [Key] = 'invoices.fbr.exclude');

        DECLARE @updateId  INT = (SELECT Id FROM Permissions WHERE [Key] = 'invoices.manage.update');
        DECLARE @excludeId INT = (SELECT Id FROM Permissions WHERE [Key] = 'invoices.fbr.exclude');
        IF @updateId IS NOT NULL AND @excludeId IS NOT NULL
        BEGIN
            INSERT INTO RolePermissions (RoleId, PermissionId)
            SELECT rp.RoleId, @excludeId FROM RolePermissions rp
            WHERE rp.PermissionId = @updateId
              AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.RoleId = rp.RoleId AND x.PermissionId = @excludeId);
        END
    ");

    // ── One-time perm migration: split invoices.* into bills.* + invoices.* ──
    // Sales is now two screens (Bills + Invoices) with their own permission
    // namespaces. The bookkeeping side moved to bills.*; invoices.* keeps
    // only the FBR-classification & print perms. We:
    //   1. Insert the new bills.* perm rows if they don't exist yet (the
    //      RbacSeeder does this anyway; doing it here so step 2 has IDs).
    //   2. Copy each role's grant of an old invoices.manage.* perm onto its
    //      bills.* equivalent so existing roles keep working.
    //   3. Copy invoices.list.view → bills.list.view (the list endpoint now
    //      requires bills.list.view; invoices.list.view keeps gating only
    //      the Invoices tab visibility).
    //   4. Copy invoices.print.view → bills.print.view (operator who could
    //      print bills before keeps that ability; the surviving
    //      invoices.print.view is narrowed to Tax-Invoice prints only).
    // After this migration runs once, RbacSeeder.UpsertPermissionsAsync
    // removes the now-stale invoices.manage.* keys (no longer in catalog),
    // cascading the old role grants away. Idempotent: NOT EXISTS guards
    // make subsequent restarts no-ops.
    db.Database.ExecuteSqlRaw(@"
        -- Step 1: ensure new bills.* perm rows exist (RbacSeeder upserts
        -- them too, but we need them present BEFORE step 2 can copy grants).
        INSERT INTO Permissions ([Key], Module, Page, [Action], Description)
        SELECT 'bills.list.view', 'Bills', 'List', 'View',
               'View the bills list (powers both Bills and Invoices tabs)'
        WHERE NOT EXISTS (SELECT 1 FROM Permissions WHERE [Key] = 'bills.list.view');

        INSERT INTO Permissions ([Key], Module, Page, [Action], Description)
        SELECT 'bills.manage.create', 'Bills', 'Manage', 'Create',
               'Create a new bill (challan-linked)'
        WHERE NOT EXISTS (SELECT 1 FROM Permissions WHERE [Key] = 'bills.manage.create');

        INSERT INTO Permissions ([Key], Module, Page, [Action], Description)
        SELECT 'bills.manage.create.standalone', 'Bills', 'Manage', 'Create (No Challan)',
               'Create a bill directly without linking a delivery challan'
        WHERE NOT EXISTS (SELECT 1 FROM Permissions WHERE [Key] = 'bills.manage.create.standalone');

        INSERT INTO Permissions ([Key], Module, Page, [Action], Description)
        SELECT 'bills.manage.update', 'Bills', 'Manage', 'Update',
               'Edit a bill (all fields)'
        WHERE NOT EXISTS (SELECT 1 FROM Permissions WHERE [Key] = 'bills.manage.update');

        INSERT INTO Permissions ([Key], Module, Page, [Action], Description)
        SELECT 'bills.manage.update.itemtype', 'Bills', 'Manage', 'Update Item Type',
               'Edit ONLY the Item Type column on a bill (no other fields)'
        WHERE NOT EXISTS (SELECT 1 FROM Permissions WHERE [Key] = 'bills.manage.update.itemtype');

        INSERT INTO Permissions ([Key], Module, Page, [Action], Description)
        SELECT 'bills.manage.update.itemtype.qty', 'Bills', 'Manage', 'Update Item Type + Qty',
               'Edit Item Type and Quantity columns on a bill (no other fields)'
        WHERE NOT EXISTS (SELECT 1 FROM Permissions WHERE [Key] = 'bills.manage.update.itemtype.qty');

        INSERT INTO Permissions ([Key], Module, Page, [Action], Description)
        SELECT 'bills.manage.delete', 'Bills', 'Manage', 'Delete', 'Delete a bill'
        WHERE NOT EXISTS (SELECT 1 FROM Permissions WHERE [Key] = 'bills.manage.delete');

        INSERT INTO Permissions ([Key], Module, Page, [Action], Description)
        SELECT 'bills.print.view', 'Bills', 'Print', 'View',
               'Print or download a Bill (Bill print, Bill PDF, Bill XLS)'
        WHERE NOT EXISTS (SELECT 1 FROM Permissions WHERE [Key] = 'bills.print.view');

        -- Step 2: copy invoices.manage.* grants to bills.manage.*
        DECLARE @oldKey NVARCHAR(200), @newKey NVARCHAR(200);
        DECLARE pairs CURSOR LOCAL FOR
            SELECT 'invoices.manage.create',                  'bills.manage.create' UNION ALL
            SELECT 'invoices.manage.create.standalone',       'bills.manage.create.standalone' UNION ALL
            SELECT 'invoices.manage.update',                  'bills.manage.update' UNION ALL
            SELECT 'invoices.manage.update.itemtype',         'bills.manage.update.itemtype' UNION ALL
            SELECT 'invoices.manage.update.itemtype.qty',     'bills.manage.update.itemtype.qty' UNION ALL
            SELECT 'invoices.manage.delete',                  'bills.manage.delete' UNION ALL
            SELECT 'invoices.list.view',                      'bills.list.view' UNION ALL
            SELECT 'invoices.print.view',                     'bills.print.view';
        OPEN pairs;
        FETCH NEXT FROM pairs INTO @oldKey, @newKey;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            DECLARE @oId INT = (SELECT Id FROM Permissions WHERE [Key] = @oldKey);
            DECLARE @nId INT = (SELECT Id FROM Permissions WHERE [Key] = @newKey);
            IF @oId IS NOT NULL AND @nId IS NOT NULL
            BEGIN
                INSERT INTO RolePermissions (RoleId, PermissionId)
                SELECT rp.RoleId, @nId FROM RolePermissions rp
                WHERE rp.PermissionId = @oId
                  AND NOT EXISTS (SELECT 1 FROM RolePermissions x
                                   WHERE x.RoleId = rp.RoleId AND x.PermissionId = @nId);
            END
            FETCH NEXT FROM pairs INTO @oldKey, @newKey;
        END
        CLOSE pairs;
        DEALLOCATE pairs;
    ");

    // ── One-time backfill: heal bills orphaned by the legacy UpdateChallanAsync bug ──
    // Before the diff/sync refactor of UpdateChallanAsync, the whole-challan
    // PUT replaced dc.Items via RemoveRange, which cascaded SET NULL on
    // InvoiceItem.DeliveryItemId without ever syncing the bill — so any
    // challan edit that touched items left the bill stuck with orphaned
    // InvoiceItems (dlvId IS NULL) and no row for newly-added DeliveryItems.
    //
    // This block does two passes:
    //   1. Re-link orphan InvoiceItems (dlvId IS NULL) to a matching unlinked
    //      DeliveryItem on one of the bill's challans, matched by exact
    //      Description (case-insensitive) AND Quantity.
    //   2. Insert a fresh InvoiceItem (UnitPrice=0) for any DeliveryItem on a
    //      linked challan that still has no matching InvoiceItem — the
    //      operator opens Bill Edit afterwards to set the price.
    //
    // Skips FBR-submitted bills (the IRN is locked at FBR — we don't touch
    // them). Idempotent: NOT EXISTS guards make re-runs no-ops, audit-log
    // marker records what was healed on first run.
    db.Database.ExecuteSqlRaw(@"
        IF NOT EXISTS (SELECT 1 FROM AuditLogs WHERE ExceptionType = 'BILL_CHALLAN_SYNC_BACKFILL_V1')
        BEGIN
            DECLARE @relinked INT = 0, @added INT = 0;

            -- Pass 1: re-link orphan InvoiceItems to unlinked DeliveryItems
            -- on the same bill's challans, matching Description + Quantity.
            DECLARE @iiId INT, @invId INT, @desc NVARCHAR(MAX), @qty DECIMAL(18,4);
            DECLARE orphan_cur CURSOR LOCAL FOR
                SELECT ii.Id, ii.InvoiceId, ii.Description, ii.Quantity
                FROM InvoiceItems ii
                INNER JOIN Invoices i ON i.Id = ii.InvoiceId
                WHERE ii.DeliveryItemId IS NULL
                  AND (i.FbrStatus IS NULL OR i.FbrStatus <> 'Submitted')
                  AND EXISTS (SELECT 1 FROM DeliveryChallans dc WHERE dc.InvoiceId = ii.InvoiceId);

            OPEN orphan_cur;
            FETCH NEXT FROM orphan_cur INTO @iiId, @invId, @desc, @qty;
            WHILE @@FETCH_STATUS = 0
            BEGIN
                DECLARE @diId INT = (
                    SELECT TOP 1 di.Id
                    FROM DeliveryItems di
                    INNER JOIN DeliveryChallans dc ON dc.Id = di.DeliveryChallanId
                    WHERE dc.InvoiceId = @invId
                      AND di.Quantity = @qty
                      AND LOWER(di.Description) = LOWER(@desc)
                      AND NOT EXISTS (SELECT 1 FROM InvoiceItems x WHERE x.DeliveryItemId = di.Id)
                    ORDER BY di.Id
                );
                IF @diId IS NOT NULL
                BEGIN
                    UPDATE InvoiceItems SET DeliveryItemId = @diId WHERE Id = @iiId;
                    SET @relinked = @relinked + 1;
                END
                FETCH NEXT FROM orphan_cur INTO @iiId, @invId, @desc, @qty;
            END
            CLOSE orphan_cur;
            DEALLOCATE orphan_cur;

            -- Pass 2: insert missing InvoiceItems (UnitPrice=0) for any
            -- DeliveryItem on a linked, non-submitted bill that has no
            -- matching InvoiceItem. Matches the SyncInvoiceItemsForChallanEditAsync
            -- new-item shape — operator sets the price via Bill Edit.
            INSERT INTO InvoiceItems (InvoiceId, DeliveryItemId, ItemTypeId, ItemTypeName, Description, Quantity, UOM, UnitPrice, LineTotal)
            SELECT
                dc.InvoiceId,
                di.Id,
                di.ItemTypeId,
                ISNULL(it.Name, N''),
                di.Description,
                di.Quantity,
                di.Unit,
                0,
                0
            FROM DeliveryItems di
            INNER JOIN DeliveryChallans dc ON dc.Id = di.DeliveryChallanId
            INNER JOIN Invoices i ON i.Id = dc.InvoiceId
            LEFT JOIN ItemTypes it ON it.Id = di.ItemTypeId
            WHERE dc.InvoiceId IS NOT NULL
              AND (i.FbrStatus IS NULL OR i.FbrStatus <> 'Submitted')
              AND NOT EXISTS (SELECT 1 FROM InvoiceItems ii2 WHERE ii2.DeliveryItemId = di.Id);
            SET @added = @@ROWCOUNT;

            INSERT INTO AuditLogs (Level, ExceptionType, Message, HttpMethod, RequestPath, StatusCode, [Timestamp])
            VALUES ('Info', 'BILL_CHALLAN_SYNC_BACKFILL_V1',
                    CONCAT('Bill/challan sync backfill: re-linked ', @relinked,
                           ' orphan invoice item(s); added ', @added,
                           ' missing invoice item(s) at UnitPrice=0. Operators must edit affected bills to set prices.'),
                    'STARTUP', '/migrations/bill-challan-sync-backfill', 200, SYSUTCDATETIME());
        END
    ");

    // ── One-time perm migration: move itemtype perms back to Invoices ──
    // The narrow itemtype perms (`bills.manage.update.itemtype` and
    // `bills.manage.update.itemtype.qty`) live under Invoices, not Bills —
    // item-type classification is the Invoices tab's responsibility, so
    // FBR-officer roles need them without holding any other bills.* perm.
    // Copies any existing `bills.*` itemtype grants onto the new
    // `invoices.*` keys; the seeder then auto-removes the stale `bills.*`
    // ones (no longer in catalog), cascading away the old grants. Idempotent
    // via the NOT EXISTS guard.
    db.Database.ExecuteSqlRaw(@"
        INSERT INTO Permissions ([Key], Module, Page, [Action], Description)
        SELECT 'invoices.manage.update.itemtype', 'Invoices', 'Manage', 'Update Item Type',
               'Edit ONLY the Item Type column on a bill from the Invoices tab'
        WHERE NOT EXISTS (SELECT 1 FROM Permissions WHERE [Key] = 'invoices.manage.update.itemtype');

        INSERT INTO Permissions ([Key], Module, Page, [Action], Description)
        SELECT 'invoices.manage.update.itemtype.qty', 'Invoices', 'Manage', 'Update Item Type + Qty',
               'Edit Item Type and Quantity columns on a bill from the Invoices tab'
        WHERE NOT EXISTS (SELECT 1 FROM Permissions WHERE [Key] = 'invoices.manage.update.itemtype.qty');

        DECLARE @oldKey NVARCHAR(200), @newKey NVARCHAR(200);
        DECLARE pairs2 CURSOR LOCAL FOR
            SELECT 'bills.manage.update.itemtype',     'invoices.manage.update.itemtype' UNION ALL
            SELECT 'bills.manage.update.itemtype.qty', 'invoices.manage.update.itemtype.qty';
        OPEN pairs2;
        FETCH NEXT FROM pairs2 INTO @oldKey, @newKey;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            DECLARE @oId INT = (SELECT Id FROM Permissions WHERE [Key] = @oldKey);
            DECLARE @nId INT = (SELECT Id FROM Permissions WHERE [Key] = @newKey);
            IF @oId IS NOT NULL AND @nId IS NOT NULL
            BEGIN
                INSERT INTO RolePermissions (RoleId, PermissionId)
                SELECT rp.RoleId, @nId FROM RolePermissions rp
                WHERE rp.PermissionId = @oId
                  AND NOT EXISTS (SELECT 1 FROM RolePermissions x
                                   WHERE x.RoleId = rp.RoleId AND x.PermissionId = @nId);
            END
            FETCH NEXT FROM pairs2 INTO @oldKey, @newKey;
        END
        CLOSE pairs2;
        DEALLOCATE pairs2;
    ");

    // ── One-time backfill: Common Clients grouping ──
    // Walks every existing Client and assigns it to a ClientGroup based on
    // the same canonical key the runtime EnsureGroupForClientAsync uses
    // (NTN-digits ≥ 7 ⇒ "NTN:..."; otherwise "NAME:lower-trimmed-name").
    // Re-runs are no-ops via the audit-log marker. Existing per-company
    // client rows, controllers and UI are untouched — ClientGroupId is
    // a nullable additive column.
    //
    // Also backfills POFormats.ClientGroupId from POFormats.ClientId so
    // existing format → client links carry over to group → format links
    // automatically. New formats can opt into ClientGroupId at save time.
    db.Database.ExecuteSqlRaw(@"
        IF NOT EXISTS (SELECT 1 FROM AuditLogs WHERE ExceptionType = 'COMMON_CLIENTS_BACKFILL_V1')
        BEGIN
            -- Step 1: build a per-Client view of the canonical key. T-SQL
            -- mirrors ClientGroupService.ComputeGroupKey():
            --   • DigitsOnlyNtn = NTN with every non-digit stripped
            --   • If LEN(DigitsOnlyNtn) >= 7  → ""NTN:"" + digits
            --   • Else                        → ""NAME:"" + lower(trim(name))
            -- Names are lowered via LOWER() and edge-trimmed via LTRIM/RTRIM.
            -- Whitespace collapsing (multiple internal spaces → one) is
            -- omitted in T-SQL because SQL Server has no native regex; the
            -- runtime EnsureGroup path will harmonise on next save if a
            -- collision is ever observed.
            ;WITH Digits(Id, DigitsNtn) AS (
                SELECT c.Id,
                       REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                         ISNULL(c.NTN, ''),
                         ' ',  ''), '-', ''), '/', ''), '.', ''), '(', ''), ')', ''),
                         ',', ''), ':', ''), '\', ''), '''', ''), '""', ''), '+', ''), CHAR(9), '')
                  FROM Clients c
            ),
            Keyed AS (
                SELECT c.Id, c.CompanyId, c.Name, c.NTN, c.CreatedAt,
                       d.DigitsNtn,
                       LOWER(LTRIM(RTRIM(c.Name))) AS NormName,
                       CASE
                         WHEN LEN(d.DigitsNtn) >= 7 THEN N'NTN:'  + d.DigitsNtn
                         ELSE                            N'NAME:' + LOWER(LTRIM(RTRIM(c.Name)))
                       END AS GroupKey
                  FROM Clients c
                  JOIN Digits  d ON d.Id = c.Id
            )
            -- Step 2: insert one ClientGroup row per distinct key. Single-
            -- company keys are also created — the moment a 2nd company
            -- adds the same client, EnsureGroup links them automatically.
            -- Both DisplayName and NormalizedName resolve via TOP-1
            -- earliest-saved member so the row is deterministic; without
            -- that pick we'd hit the IX_ClientGroups_GroupKey unique
            -- index whenever two clients share an NTN but spell the
            -- name slightly differently.
            INSERT INTO ClientGroups (GroupKey, DisplayName, NormalizedNtn, NormalizedName, CreatedAt, UpdatedAt)
            SELECT k.GroupKey,
                   (SELECT TOP 1 k2.Name
                      FROM Keyed k2
                     WHERE k2.GroupKey = k.GroupKey
                     ORDER BY k2.CreatedAt, k2.Id),
                   CASE WHEN LEFT(k.GroupKey, 4) = N'NTN:' THEN SUBSTRING(k.GroupKey, 5, LEN(k.GroupKey)) ELSE NULL END,
                   (SELECT TOP 1 k2.NormName
                      FROM Keyed k2
                     WHERE k2.GroupKey = k.GroupKey
                     ORDER BY k2.CreatedAt, k2.Id),
                   SYSUTCDATETIME(), SYSUTCDATETIME()
              FROM (SELECT DISTINCT GroupKey FROM Keyed) k
             WHERE NOT EXISTS (SELECT 1 FROM ClientGroups g WHERE g.GroupKey = k.GroupKey);

            -- Step 3: stamp Clients.ClientGroupId. Only rows still NULL —
            -- in case the runtime EnsureGroup path raced ahead during
            -- this same boot.
            ;WITH Digits2(Id, DigitsNtn) AS (
                SELECT c.Id,
                       REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                         ISNULL(c.NTN, ''),
                         ' ',  ''), '-', ''), '/', ''), '.', ''), '(', ''), ')', ''),
                         ',', ''), ':', ''), '\', ''), '''', ''), '""', ''), '+', ''), CHAR(9), '')
                  FROM Clients c
            ),
            Keyed2 AS (
                SELECT c.Id,
                       CASE
                         WHEN LEN(d.DigitsNtn) >= 7 THEN N'NTN:'  + d.DigitsNtn
                         ELSE                            N'NAME:' + LOWER(LTRIM(RTRIM(c.Name)))
                       END AS GroupKey
                  FROM Clients c
                  JOIN Digits2 d ON d.Id = c.Id
                 WHERE c.ClientGroupId IS NULL
            )
            UPDATE c
               SET c.ClientGroupId = g.Id
              FROM Clients c
              JOIN Keyed2  k ON k.Id = c.Id
              JOIN ClientGroups g ON g.GroupKey = k.GroupKey
             WHERE c.ClientGroupId IS NULL;

            -- Step 4: backfill POFormats.ClientGroupId from POFormats.ClientId.
            -- A format previously bound to one Client now also points to
            -- that client's group — so the group-aware match path picks it
            -- up automatically. Legacy ClientId is left intact.
            UPDATE pof
               SET pof.ClientGroupId = c.ClientGroupId
              FROM POFormats pof
              JOIN Clients   c ON c.Id = pof.ClientId
             WHERE pof.ClientGroupId IS NULL
               AND c.ClientGroupId IS NOT NULL;

            -- Step 5: write a one-time summary into AuditLogs. Doubles as
            -- the marker that prevents re-runs. Body lists every multi-
            -- company group so the operator can audit at first boot.
            DECLARE @groupCount INT, @clientLinked INT, @poLinked INT;
            SELECT @groupCount   = COUNT(*) FROM ClientGroups;
            SELECT @clientLinked = COUNT(*) FROM Clients   WHERE ClientGroupId IS NOT NULL;
            SELECT @poLinked     = COUNT(*) FROM POFormats WHERE ClientGroupId IS NOT NULL;

            DECLARE @multiNames NVARCHAR(MAX) = (
                SELECT STRING_AGG(g.DisplayName, N'; ')
                  FROM ClientGroups g
                 WHERE (SELECT COUNT(DISTINCT c.CompanyId)
                          FROM Clients c
                         WHERE c.ClientGroupId = g.Id) >= 2
            );

            INSERT INTO AuditLogs (Level, ExceptionType, Message, StackTrace, HttpMethod, RequestPath, StatusCode, [Timestamp])
            VALUES (
                'Info',
                'COMMON_CLIENTS_BACKFILL_V1',
                CONCAT(
                    'Common Clients backfill: created/linked ', @groupCount,
                    ' groups, attached ', @clientLinked, ' clients, ',
                    @poLinked, ' PO formats inherited group linkage.'),
                CASE WHEN @multiNames IS NULL THEN N'No multi-company clients detected yet.'
                     ELSE N'Multi-company groups: ' + @multiNames END,
                'STARTUP', '/seed/clientgroups/backfill', 200, SYSUTCDATETIME());
        END
    ");

    // ── One-time data fix: align seeded ItemType UoMs to FBR HS_UOM ──
    // The v2 seeder labelled six HS codes with UoMs that FBR's published
    // HS_UOM master rejects (error 0099 at validateinvoicedata). Notably
    // "Adhesive Tape" / 3919.1090 → was "Numbers, pieces, units", FBR
    // requires "KG". This block:
    //   1) updates the affected ItemType rows to the correct UoM /
    //      FbrUOMId, but ONLY when the row still carries the old wrong
    //      values — so an operator who already corrected one by hand is
    //      left alone.
    //   2) cascades the correction to InvoiceItem (non-Submitted bills
    //      only) and DeliveryItem (non-Cancelled, not-yet-submitted)
    //      rows that point to those ItemTypes via FK — same boundary
    //      ItemTypeService.PropagateToLinesAsync uses.
    //
    // Gated by an audit-log marker so it runs at most once per database.
    db.Database.ExecuteSqlRaw(@"
        IF NOT EXISTS (SELECT 1 FROM AuditLogs WHERE ExceptionType = 'FBR_HS_UOM_BACKFILL_V1')
        BEGIN
            -- Pairs: (HSCode, OldUOM, NewUOM, NewFbrUOMId). We only rewrite
            -- a row when both the OLD UOM and the HSCode still match the
            -- bad seeder value — operator hand-fixes are preserved.
            DECLARE @fixes TABLE (HSCode NVARCHAR(50), OldUOM NVARCHAR(100), NewUOM NVARCHAR(100), NewFbrUOMId INT);
            INSERT INTO @fixes VALUES
                ('7307.9900', N'Numbers, pieces, units', N'KG',                       13),
                ('7318.1590', N'Numbers, pieces, units', N'KG',                       13),
                ('4009.3130', N'Meter',                  N'Numbers, pieces, units',   69),
                ('7304.9000', N'Meter',                  N'KG',                       13),
                ('3919.1090', N'Numbers, pieces, units', N'KG',                       13),
                ('3506.9110', N'Numbers, pieces, units', N'KG',                       13);

            -- 1) ItemTypes — only rows still on the wrong UoM.
            UPDATE it
               SET it.UOM = f.NewUOM,
                   it.FbrUOMId = f.NewFbrUOMId
              FROM ItemTypes it
              JOIN @fixes    f ON f.HSCode = it.HSCode
             WHERE it.UOM = f.OldUOM;

            -- 2) Cascade to InvoiceItem rows on non-Submitted bills.
            UPDATE ii
               SET ii.UOM = f.NewUOM,
                   ii.FbrUOMId = f.NewFbrUOMId
              FROM InvoiceItems ii
              JOIN Invoices  i ON i.Id = ii.InvoiceId
              JOIN ItemTypes it ON it.Id = ii.ItemTypeId
              JOIN @fixes    f  ON f.HSCode = it.HSCode
             WHERE ISNULL(i.FbrStatus, '') <> 'Submitted'
               AND ii.UOM = f.OldUOM;

            -- 3) Cascade to DeliveryItem rows on live challans (not
            --    cancelled, not on a submitted bill).
            UPDATE di
               SET di.Unit = f.NewUOM
              FROM DeliveryItems di
              JOIN DeliveryChallans dc ON dc.Id = di.DeliveryChallanId
              LEFT JOIN Invoices    i  ON i.Id = dc.InvoiceId
              JOIN ItemTypes        it ON it.Id = di.ItemTypeId
              JOIN @fixes           f  ON f.HSCode = it.HSCode
             WHERE ISNULL(dc.Status, '') <> 'Cancelled'
               AND (i.Id IS NULL OR ISNULL(i.FbrStatus, '') <> 'Submitted')
               AND di.Unit = f.OldUOM;

            -- Marker — its presence prevents re-runs.
            INSERT INTO AuditLogs (Level, ExceptionType, Message, HttpMethod, RequestPath, StatusCode, [Timestamp])
            VALUES ('Info', 'FBR_HS_UOM_BACKFILL_V1',
                    'Aligned 6 seeded ItemType HS_UOM mismatches to FBR HS_UOM master and cascaded to live bill/challan lines.',
                    'STARTUP', '/seed/itemtypes/hsuom-backfill', 200, SYSUTCDATETIME());
        END
    ");

    // ── One-time backfill: Common Suppliers grouping ──
    // Mirrors the Common Clients backfill above. Walks every existing
    // Supplier and assigns it to a SupplierGroup based on the same
    // canonical key the runtime EnsureGroupForSupplierAsync uses
    // (NTN-digits ≥ 7 ⇒ "NTN:..."; otherwise "NAME:lower-trimmed").
    // Idempotent via the audit-log marker. Existing per-company supplier
    // rows, controllers and UI are untouched — SupplierGroupId is a
    // nullable additive column.
    db.Database.ExecuteSqlRaw(@"
        IF NOT EXISTS (SELECT 1 FROM AuditLogs WHERE ExceptionType = 'COMMON_SUPPLIERS_BACKFILL_V1')
        BEGIN
            ;WITH Digits(Id, DigitsNtn) AS (
                SELECT s.Id,
                       REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                         ISNULL(s.NTN, ''),
                         ' ',  ''), '-', ''), '/', ''), '.', ''), '(', ''), ')', ''),
                         ',', ''), ':', ''), '\', ''), '''', ''), '""', ''), '+', ''), CHAR(9), '')
                  FROM Suppliers s
            ),
            Keyed AS (
                SELECT s.Id, s.CompanyId, s.Name, s.NTN, s.CreatedAt,
                       d.DigitsNtn,
                       LOWER(LTRIM(RTRIM(s.Name))) AS NormName,
                       CASE
                         WHEN LEN(d.DigitsNtn) >= 7 THEN N'NTN:'  + d.DigitsNtn
                         ELSE                            N'NAME:' + LOWER(LTRIM(RTRIM(s.Name)))
                       END AS GroupKey
                  FROM Suppliers s
                  JOIN Digits  d ON d.Id = s.Id
            )
            INSERT INTO SupplierGroups (GroupKey, DisplayName, NormalizedNtn, NormalizedName, CreatedAt, UpdatedAt)
            SELECT k.GroupKey,
                   (SELECT TOP 1 k2.Name
                      FROM Keyed k2
                     WHERE k2.GroupKey = k.GroupKey
                     ORDER BY k2.CreatedAt, k2.Id),
                   CASE WHEN LEFT(k.GroupKey, 4) = N'NTN:' THEN SUBSTRING(k.GroupKey, 5, LEN(k.GroupKey)) ELSE NULL END,
                   (SELECT TOP 1 k2.NormName
                      FROM Keyed k2
                     WHERE k2.GroupKey = k.GroupKey
                     ORDER BY k2.CreatedAt, k2.Id),
                   SYSUTCDATETIME(), SYSUTCDATETIME()
              FROM (SELECT DISTINCT GroupKey FROM Keyed) k
             WHERE NOT EXISTS (SELECT 1 FROM SupplierGroups g WHERE g.GroupKey = k.GroupKey);

            ;WITH Digits2(Id, DigitsNtn) AS (
                SELECT s.Id,
                       REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                         ISNULL(s.NTN, ''),
                         ' ',  ''), '-', ''), '/', ''), '.', ''), '(', ''), ')', ''),
                         ',', ''), ':', ''), '\', ''), '''', ''), '""', ''), '+', ''), CHAR(9), '')
                  FROM Suppliers s
            ),
            Keyed2 AS (
                SELECT s.Id,
                       CASE
                         WHEN LEN(d.DigitsNtn) >= 7 THEN N'NTN:'  + d.DigitsNtn
                         ELSE                            N'NAME:' + LOWER(LTRIM(RTRIM(s.Name)))
                       END AS GroupKey
                  FROM Suppliers s
                  JOIN Digits2 d ON d.Id = s.Id
                 WHERE s.SupplierGroupId IS NULL
            )
            UPDATE s
               SET s.SupplierGroupId = g.Id
              FROM Suppliers s
              JOIN Keyed2  k ON k.Id = s.Id
              JOIN SupplierGroups g ON g.GroupKey = k.GroupKey
             WHERE s.SupplierGroupId IS NULL;

            DECLARE @groupCount2 INT, @supplierLinked INT;
            SELECT @groupCount2  = COUNT(*) FROM SupplierGroups;
            SELECT @supplierLinked = COUNT(*) FROM Suppliers WHERE SupplierGroupId IS NOT NULL;

            DECLARE @multiSupplierNames NVARCHAR(MAX) = (
                SELECT STRING_AGG(g.DisplayName, N'; ')
                  FROM SupplierGroups g
                 WHERE (SELECT COUNT(DISTINCT s.CompanyId)
                          FROM Suppliers s
                         WHERE s.SupplierGroupId = g.Id) >= 2
            );

            INSERT INTO AuditLogs (Level, ExceptionType, Message, StackTrace, HttpMethod, RequestPath, StatusCode, [Timestamp])
            VALUES (
                'Info',
                'COMMON_SUPPLIERS_BACKFILL_V1',
                CONCAT(
                    'Common Suppliers backfill: created/linked ', @groupCount2,
                    ' groups, attached ', @supplierLinked, ' suppliers.'),
                CASE WHEN @multiSupplierNames IS NULL THEN N'No multi-company suppliers detected yet.'
                     ELSE N'Multi-company groups: ' + @multiSupplierNames END,
                'STARTUP', '/seed/suppliergroups/backfill', 200, SYSUTCDATETIME());
        END
    ");

    // ── One-time backfill: narrow InvoiceItemAdjustment scope ──
    // 2026-05-12: the dual-book overlay's scope was narrowed to ONLY
    // carry numerical fields (Quantity / UnitPrice / LineTotal). Item
    // Type, UOM, HS Code, Sale Type, and Description are legitimate
    // bill data that belong on InvoiceItem so the printed bill and the
    // Tax Invoice render them correctly.
    //
    // For any overlay row that still carries the deprecated text
    // fields from the brief 2026-05-11 → 2026-05-12 window: copy them
    // onto the underlying InvoiceItem (operator's intent was to
    // change those fields on the bill), then null them on the overlay.
    // Idempotent — guarded by an audit marker.
    var adjScopeBackfillRan = await db.AuditLogs
        .AnyAsync(a => a.ExceptionType == "INVOICEITEMADJ_SCOPE_NARROW_V1");
    if (!adjScopeBackfillRan)
    {
        db.Database.ExecuteSqlRaw(@"
            -- Copy stale text fields from overlay → InvoiceItem when they diverge.
            UPDATE ii
               SET ii.ItemTypeId   = COALESCE(a.AdjustedItemTypeId,   ii.ItemTypeId),
                   ii.ItemTypeName = COALESCE(a.AdjustedItemTypeName, ii.ItemTypeName),
                   ii.UOM          = COALESCE(a.AdjustedUOM,          ii.UOM),
                   ii.FbrUOMId     = COALESCE(a.AdjustedFbrUOMId,     ii.FbrUOMId),
                   ii.HSCode       = COALESCE(a.AdjustedHSCode,       ii.HSCode),
                   ii.SaleType     = COALESCE(a.AdjustedSaleType,     ii.SaleType),
                   ii.Description  = COALESCE(a.AdjustedDescription,  ii.Description)
              FROM InvoiceItems ii
              JOIN InvoiceItemAdjustments a ON a.InvoiceItemId = ii.Id
             WHERE a.AdjustedItemTypeId   IS NOT NULL
                OR a.AdjustedItemTypeName IS NOT NULL
                OR a.AdjustedUOM          IS NOT NULL
                OR a.AdjustedFbrUOMId     IS NOT NULL
                OR a.AdjustedHSCode       IS NOT NULL
                OR a.AdjustedSaleType     IS NOT NULL
                OR a.AdjustedDescription  IS NOT NULL;

            -- Null the deprecated text columns on every overlay row.
            UPDATE InvoiceItemAdjustments
               SET AdjustedItemTypeId   = NULL,
                   AdjustedItemTypeName = NULL,
                   AdjustedUOM          = NULL,
                   AdjustedFbrUOMId     = NULL,
                   AdjustedHSCode       = NULL,
                   AdjustedSaleType     = NULL,
                   AdjustedDescription  = NULL,
                   UpdatedAt            = SYSUTCDATETIME();

            -- Drop any overlay row that has nothing left after the narrowing
            -- (operator only ever changed item-type fields, no qty/price
            -- adjustment is now stored — the bill row already reflects what
            -- they wanted).
            DELETE FROM InvoiceItemAdjustments
             WHERE AdjustedQuantity  IS NULL
               AND AdjustedUnitPrice IS NULL
               AND AdjustedLineTotal IS NULL;
        ");
        db.AuditLogs.Add(new MyApp.Api.Models.AuditLog
        {
            Timestamp = DateTime.UtcNow,
            Level = "Info",
            UserName = "system",
            HttpMethod = "SEED",
            RequestPath = "/migrations/invoiceitemadj-scope-narrow",
            StatusCode = 200,
            ExceptionType = "INVOICEITEMADJ_SCOPE_NARROW_V1",
            Message = "One-time backfill: copied overlay text fields (item type / UOM / HS code / sale type / description) onto InvoiceItem and nulled them on the overlay; dropped overlay rows that had no remaining numerical divergence.",
        });
        await db.SaveChangesAsync();
    }

    // ── One-time backfill: re-sync stock movements for adjusted bills ──
    // 2026-05-12: the stock-out trigger moved from "emit on FBR submit"
    // to "emit on invoice save" AND the quantity source flipped to use
    // the InvoiceItemAdjustment overlay (FBR-facing qty) when present.
    //
    // Bills that already have overlays saved BEFORE this code shipped
    // either (a) have stock movements with the wrong qty (= bill row's
    // real qty rather than overlay) or (b) have none yet. Re-sync each
    // of them so the dashboard / availability check reflect the
    // adjusted qty consistently with what gets reported to FBR.
    //
    // Non-overlay bills are untouched — their stock movements (if any)
    // came from the legacy FBR-submit path and InvoiceItem.Quantity is
    // already authoritative for those.
    //
    // Idempotent: guarded by an audit marker + the per-bill sync
    // itself deletes-and-rewrites cleanly.
    var stockOverlaySyncRan = await db.AuditLogs
        .AnyAsync(a => a.ExceptionType == "STOCKMOVEMENT_OVERLAY_SYNC_V1");
    if (!stockOverlaySyncRan)
    {
        var adjustedInvoiceIds = await db.InvoiceItemAdjustments
            .Where(a => a.AdjustedQuantity != null)
            .Select(a => a.InvoiceId)
            .Distinct()
            .ToListAsync();
        var failedBillIds = new List<int>();
        if (adjustedInvoiceIds.Count > 0)
        {
            var stockSvc = scope.ServiceProvider.GetRequiredService<MyApp.Api.Services.Interfaces.IStockService>();
            var invoiceRepoSvc = scope.ServiceProvider.GetRequiredService<MyApp.Api.Repositories.Interfaces.IInvoiceRepository>();
            foreach (var invId in adjustedInvoiceIds)
            {
                var inv = await invoiceRepoSvc.GetByIdAsync(invId);
                if (inv == null) continue;
                try
                {
                    await stockSvc.SyncInvoiceStockMovementsAsync(inv);
                }
                catch (Exception ex)
                {
                    // Don't let one bad row halt the whole backfill —
                    // the marker only gets written if we make it through.
                    failedBillIds.Add(invId);
                    db.AuditLogs.Add(new MyApp.Api.Models.AuditLog
                    {
                        Timestamp = DateTime.UtcNow,
                        Level = "Warning",
                        UserName = "system",
                        HttpMethod = "SEED",
                        RequestPath = "/migrations/stockmovement-overlay-sync",
                        StatusCode = 500,
                        ExceptionType = "STOCKMOVEMENT_OVERLAY_SYNC_V1_WARN",
                        Message = $"Re-sync failed for invoice {invId}: {ex.Message}",
                    });
                }
            }
        }
        // 2026-05-12 (#10): marker bumps to Warning when any bill failed,
        // so the "show warnings/errors" filter in the AuditLogs page
        // surfaces this run instead of burying it under the per-bill
        // WARN rows. Message lists the failed ids inline for quick
        // triage without needing a second query.
        var anyFailed = failedBillIds.Count > 0;
        db.AuditLogs.Add(new MyApp.Api.Models.AuditLog
        {
            Timestamp = DateTime.UtcNow,
            Level = anyFailed ? "Warning" : "Info",
            UserName = "system",
            HttpMethod = "SEED",
            RequestPath = "/migrations/stockmovement-overlay-sync",
            StatusCode = anyFailed ? 207 : 200, // 207 Multi-Status
            ExceptionType = "STOCKMOVEMENT_OVERLAY_SYNC_V1",
            Message = anyFailed
                ? $"One-time backfill: re-synced StockMovements for {adjustedInvoiceIds.Count - failedBillIds.Count} of {adjustedInvoiceIds.Count} bill(s). FAILED bill ids: [{string.Join(", ", failedBillIds)}]. See per-bill WARN entries with type STOCKMOVEMENT_OVERLAY_SYNC_V1_WARN for details."
                : $"One-time backfill: re-synced StockMovements for {adjustedInvoiceIds.Count} bill(s) carrying tax-claim adjustment overlays. Quantity source = AdjustedQuantity (FBR-facing) when present, InvoiceItem.Quantity otherwise.",
        });
        await db.SaveChangesAsync();
    }

    // RBAC: sync PermissionCatalog into the Permissions table and ensure the
    // built-in "Administrator" system role exists and is wired to the seed
    // admin user. Idempotent — runs every start.
    var seedAdminUserId = builder.Configuration.GetValue<int>("AppSettings:SeedAdminUserId", 1);
    await MyApp.Api.Data.RbacSeeder.SeedAsync(db, seedAdminUserId);

    // ── One-time backfill: UserCompanies for existing non-admin users ──
    //
    // We just flipped to fail-closed semantics in CompanyAccessGuard:
    // a non-admin user with zero UserCompanies rows now sees NOTHING.
    // Without this backfill, every existing non-admin user would go dark
    // on the next boot — anyone created before the Tenant Access UI
    // shipped has zero rows.
    //
    // The fix: for every non-admin user with no rows yet, grant access
    // to every IsTenantIsolated=false company at backfill time. That
    // preserves their legacy access exactly. Isolated companies stay
    // restricted (the operator clearly wanted that). After this runs,
    // the rule is uniform: explicit rows = access; no rows = no access.
    //
    // Idempotent via the audit-log marker — runs once per database.
    db.Database.ExecuteSqlRaw(@"
        IF NOT EXISTS (SELECT 1 FROM AuditLogs WHERE ExceptionType = 'RBAC_USERCOMPANIES_BACKFILL_V1')
        BEGIN
            DECLARE @seedAdminId INT = " + seedAdminUserId + @";

            INSERT INTO UserCompanies (UserId, CompanyId, AssignedAt, AssignedByUserId)
            SELECT u.Id, c.Id, SYSUTCDATETIME(), @seedAdminId
              FROM Users u
              CROSS JOIN Companies c
             WHERE u.Id <> @seedAdminId
               AND c.IsTenantIsolated = 0
               AND NOT EXISTS (SELECT 1 FROM UserCompanies x WHERE x.UserId = u.Id);

            DECLARE @userCount INT = (SELECT COUNT(DISTINCT UserId) FROM UserCompanies);
            DECLARE @rowCount  INT = (SELECT COUNT(*) FROM UserCompanies);

            INSERT INTO AuditLogs (Level, ExceptionType, Message, HttpMethod, RequestPath, StatusCode, [Timestamp])
            VALUES ('Info', 'RBAC_USERCOMPANIES_BACKFILL_V1',
                    CONCAT('Tenant access backfill: ', @userCount,
                           ' user(s) granted access to ', @rowCount,
                           ' (user, company) pairs. Fail-closed semantics now active.'),
                    'STARTUP', '/seed/usercompanies/backfill', 200, SYSUTCDATETIME());
        END
    ");

    // ── One-time perm grant: tenantaccess.manage.* → Administrator role ──
    // The new keys are inserted by RbacSeeder (it walks PermissionCatalog),
    // but RolePermissions is empty for them by default. Grant them to the
    // built-in Administrator role on first run so the seed admin doesn't
    // have to click into the role editor before the new screen works.
    // Idempotent via the NOT EXISTS guard.
    db.Database.ExecuteSqlRaw(@"
        DECLARE @adminRoleId INT = (SELECT TOP 1 Id FROM Roles WHERE [Name] = 'Administrator');
        IF @adminRoleId IS NOT NULL
        BEGIN
            DECLARE @viewId   INT = (SELECT Id FROM Permissions WHERE [Key] = 'tenantaccess.manage.view');
            DECLARE @assignId INT = (SELECT Id FROM Permissions WHERE [Key] = 'tenantaccess.manage.assign');
            IF @viewId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM RolePermissions WHERE RoleId = @adminRoleId AND PermissionId = @viewId)
                INSERT INTO RolePermissions (RoleId, PermissionId) VALUES (@adminRoleId, @viewId);
            IF @assignId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM RolePermissions WHERE RoleId = @adminRoleId AND PermissionId = @assignId)
                INSERT INTO RolePermissions (RoleId, PermissionId) VALUES (@adminRoleId, @assignId);
        END
    ");
}

// Configure the HTTP request pipeline.
// Audit C-9 (2026-05-13): Swagger/OpenAPI used to render in every
// environment, leaking the full route map, [HasPermission] keys, and
// DTO shapes. Gate behind dev OR an explicit opt-in config flag so
// staging can still expose it when needed.
var swaggerEnabled = app.Environment.IsDevelopment()
    || app.Configuration.GetValue<bool>("Swagger:Enabled", false);
if (swaggerEnabled)
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Honour X-Forwarded-Proto / X-Forwarded-For from the reverse proxy
// (Render, MonsterASP, etc.). Audit C-12 (2026-05-13): pre-fix
// KnownProxies / KnownNetworks were at framework defaults (empty) so
// behind a TLS-terminating proxy the rate-limit partition key was the
// proxy's IP instead of the real client — every login attempt shared
// one bucket = effectively no throttle. Now optionally populated via
// config so the operator can restrict which proxies can rewrite these
// headers.
var fwdOptions = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    // Allow more hops than the default 1 — MonsterASP, Cloudflare etc.
    // can stack proxies before the request reaches us.
    ForwardLimit = app.Configuration.GetValue<int?>("ForwardedHeaders:ForwardLimit") ?? 2,
};
var knownProxies = app.Configuration.GetSection("ForwardedHeaders:KnownProxies")
    .Get<string[]>() ?? Array.Empty<string>();
var knownNetworks = app.Configuration.GetSection("ForwardedHeaders:KnownNetworks")
    .Get<string[]>() ?? Array.Empty<string>();
if (knownProxies.Length > 0 || knownNetworks.Length > 0)
{
    fwdOptions.KnownProxies.Clear();
    fwdOptions.KnownNetworks.Clear();
    foreach (var p in knownProxies)
    {
        if (System.Net.IPAddress.TryParse(p, out var ip))
            fwdOptions.KnownProxies.Add(ip);
    }
    foreach (var n in knownNetworks)
    {
        var parts = n.Split('/');
        if (parts.Length == 2
            && System.Net.IPAddress.TryParse(parts[0], out var prefix)
            && int.TryParse(parts[1], out var prefixLen))
        {
            fwdOptions.KnownNetworks.Add(new Microsoft.AspNetCore.HttpOverrides.IPNetwork(prefix, prefixLen));
        }
    }
}
app.UseForwardedHeaders(fwdOptions);

// HSTS in non-dev — tells browsers to never speak plaintext to this
// host once they've seen one HTTPS response. Dev keeps using
// HttpsRedirection only.
if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}

// after app = builder.Build()
app.UseCors("AllowFrontend");

// Enable request body buffering so the exception middleware can read it
app.Use(async (ctx, next) => { ctx.Request.EnableBuffering(); await next(); });

// Correlation ID — must run BEFORE Serilog request logging and the
// global exception middleware so all subsequent log lines for this
// request carry the same CorrelationId property. See audit H-4.
app.UseMiddleware<CorrelationIdMiddleware>();

// Serilog request logging — one structured log line per request with
// method, path, status, duration. Cheap and dramatically improves
// diagnostics. Excluded from health-check / static asset noise via
// the GetLevel callback below (returns Verbose for those, which is
// below default minimum so they're filtered out without touching the
// pipeline cost). Audit-log database writes are still handled by
// GlobalExceptionMiddleware below — Serilog logs are the operational
// trail; AuditLog is the business / security trail.
app.UseSerilogRequestLogging(opts =>
{
    opts.GetLevel = (ctx, elapsed, ex) =>
    {
        if (ex != null) return LogEventLevel.Error;
        if (ctx.Response.StatusCode >= 500) return LogEventLevel.Error;
        if (ctx.Response.StatusCode >= 400) return LogEventLevel.Warning;
        // Static assets / SPA shell — silence at default min level.
        var path = ctx.Request.Path.Value ?? "";
        if (path.StartsWith("/assets/", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith(".js", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith(".css", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith(".svg", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith(".ico", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith(".png", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase)) return LogEventLevel.Verbose;
        return LogEventLevel.Information;
    };
    opts.EnrichDiagnosticContext = (diag, ctx) =>
    {
        diag.Set("UserName", ctx.User.Identity?.Name ?? "anonymous");
        diag.Set("ClientIp", ctx.Connection.RemoteIpAddress?.ToString() ?? "");
    };
});

// Global exception handling — logs to AuditLogs table
app.UseMiddleware<GlobalExceptionMiddleware>();

// Only redirect to HTTPS in production if not behind a reverse proxy (Render handles SSL)
if (app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

app.UseRateLimiter();

app.UseAuthentication();
app.UseAuthorization();

// Serve React frontend static files from wwwroot
app.UseDefaultFiles();
app.UseStaticFiles();

// Serve user-uploaded files (logos, avatars) from persistent data/ folder
var dataPath = Path.Combine(app.Environment.ContentRootPath, "data");
Directory.CreateDirectory(dataPath);
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(dataPath),
    RequestPath = "/data"
});

app.MapControllers(); // 👈 maps your controllers (like CompaniesController)

// SPA fallback: serve index.html for any non-API, non-file routes
app.MapFallbackToFile("index.html");

Log.Information("MyApp.Api starting up — environment={Env}", app.Environment.EnvironmentName);
app.Run();
}
catch (Exception ex) when (ex is not HostAbortedException
                           && ex.GetType().FullName != "Microsoft.EntityFrameworkCore.Design.OperationException")
{
    // HostAbortedException is the OS shutdown signal — not a crash.
    // EF Core's design-time tooling throws OperationException when
    // running migrations; suppressing those keeps `dotnet ef` quiet.
    Log.Fatal(ex, "Host terminated unexpectedly during startup or run");
}
finally
{
    Log.CloseAndFlush();
}

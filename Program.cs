using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using MyApp.Api.Data;
using MyApp.Api.Repositories.Implementations;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Services.Interfaces;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container
builder.Services.AddControllers(); // 👈 Needed for controllers
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection"))
           .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning)));

// Register Swagger generator
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// JWT Authentication
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
        IssuerSigningKey = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"]!))
    };
});

// Register Repositories
builder.Services.AddScoped<ICompanyRepository, CompanyRepository>();
builder.Services.AddScoped<IDeliveryChallanRepository, DeliveryChallanRepository>();
builder.Services.AddScoped<IClientRepository, ClientRepository>();
builder.Services.AddScoped<IInvoiceRepository, InvoiceRepository>();
builder.Services.AddScoped<IItemTypeRepository, ItemTypeRepository>();
builder.Services.AddScoped<IPrintTemplateRepository, PrintTemplateRepository>();
builder.Services.AddScoped<IMergeFieldRepository, MergeFieldRepository>();
builder.Services.AddScoped<IAuditLogRepository, AuditLogRepository>();

// Register Services
builder.Services.AddScoped<ICompanyService, CompanyService>();
builder.Services.AddScoped<IDeliveryChallanService, DeliveryChallanService>();
builder.Services.AddScoped<IClientService, ClientService>();
builder.Services.AddScoped<IInvoiceService, InvoiceService>();
builder.Services.AddScoped<IItemTypeService, ItemTypeService>();
builder.Services.AddScoped<IAuditLogService, AuditLogService>();
builder.Services.AddScoped<IFbrService, FbrService>();
builder.Services.AddScoped<IFbrLookupService, FbrLookupService>();
builder.Services.AddSingleton<IPOParserService, POParserService>();
builder.Services.AddSingleton<IPOFormatFingerprintService, POFormatFingerprintService>();
builder.Services.AddScoped<IPOFormatRegistry, POFormatRegistry>();
builder.Services.AddSingleton<IRuleBasedPOParser, RuleBasedPOParser>();
builder.Services.AddScoped<IRegressionService, RegressionService>();
// Historical challan import (reverse Excel template → preview → commit).
// Reverse mapper is a Singleton because it holds an in-memory cache keyed on
// the template file path + lastWriteTime — rebuilds automatically when the
// operator re-uploads a template, and shared safely across requests.
builder.Services.AddSingleton<IExcelTemplateReverseMapper, ExcelTemplateReverseMapper>();
builder.Services.AddScoped<IChallanExcelImporter, ChallanExcelImporter>();
builder.Services.AddHttpClient("FBR");

// RBAC: permission service needs an in-process cache for the per-user
// permission-set TTL.
builder.Services.AddMemoryCache();
builder.Services.AddScoped<IPermissionService, PermissionService>();

// before builder.Build()
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", p =>
        p.AllowAnyOrigin()    // or .WithOrigins("https://localhost:5173")
         .AllowAnyHeader()
         .AllowAnyMethod());
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

    db.Database.Migrate();

    // Seed the starter catalog of FBR-mapped item types (idempotent — skips
    // any HS code / name already present, so it's safe to run on every boot)
    await MyApp.Api.Data.ItemTypeSeeder.SeedAsync(db);

    // Baseline PO formats (Lotte Kolson, Soorty, Meko) — runs ONCE when the
    // POFormats table is empty. Operator-curated formats added via the
    // Configuration → PO Formats UI are preserved across restarts.
    var fp = scope.ServiceProvider.GetRequiredService<MyApp.Api.Services.Interfaces.IPOFormatFingerprintService>();
    await MyApp.Api.Data.POFormatSeeder.SeedAsync(db, fp);

    // RBAC: sync PermissionCatalog into the Permissions table and ensure the
    // built-in "Administrator" system role exists and is wired to the seed
    // admin user. Idempotent — runs every start.
    var seedAdminUserId = builder.Configuration.GetValue<int>("AppSettings:SeedAdminUserId", 1);
    await MyApp.Api.Data.RbacSeeder.SeedAsync(db, seedAdminUserId);
}

// Configure the HTTP request pipeline
app.UseSwagger();
app.UseSwaggerUI();

// after app = builder.Build()
app.UseCors("AllowFrontend");

// Enable request body buffering so the exception middleware can read it
app.Use(async (ctx, next) => { ctx.Request.EnableBuffering(); await next(); });

// Global exception handling — logs to AuditLogs table
app.UseMiddleware<GlobalExceptionMiddleware>();

// Only redirect to HTTPS in production if not behind a reverse proxy (Render handles SSL)
if (app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

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

app.Run();

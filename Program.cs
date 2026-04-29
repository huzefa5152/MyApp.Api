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
using MyApp.Api.Services.Tax;

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

    // One-time tagging: any pre-existing bills whose paymentTerms start
    // with "[SNxxx]" came from the FBR Sandbox seed flow (or the python
    // script). They predate the IsDemo column, so the migration left
    // them with IsDemo=false — meaning they still pollute the regular
    // Bills page. Flip them to IsDemo=true once.
    // Idempotent: subsequent restarts find zero matching rows because
    // the WHERE clause filters on IsDemo=0.
    // Pattern: literal '[' + 'SN0' + any digits + literal ']' + any rest.
    // The '[[]' escapes '[' so SQL Server treats it literally instead of
    // as a character-set opener.
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

    // Baseline PO formats (Lotte Kolson, Soorty, Meko) — runs ONCE when the
    // POFormats table is empty. Operator-curated formats added via the
    // Configuration → PO Formats UI are preserved across restarts.
    var fp = scope.ServiceProvider.GetRequiredService<MyApp.Api.Services.Interfaces.IPOFormatFingerprintService>();
    await MyApp.Api.Data.POFormatSeeder.SeedAsync(db, fp);

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

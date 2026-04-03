using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using MyApp.Api.Data;
using MyApp.Api.Repositories.Implementations;
using MyApp.Api.Repositories.Interfaces;
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

// Register Services
builder.Services.AddScoped<ICompanyService, CompanyService>();
builder.Services.AddScoped<IDeliveryChallanService, DeliveryChallanService>();
builder.Services.AddScoped<IClientService, ClientService>();

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

    // Fix: remove bad migration records that ran as no-ops (Users table was never created)
    db.Database.ExecuteSqlRaw(@"
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Users')
        BEGIN
            DELETE FROM [__EFMigrationsHistory] WHERE [MigrationId] IN (
                '20260403164225_AddUsersTable',
                '20260403181242_AddUserAvatarPath',
                '20260403184710_AddClientCompanyId'
            );
        END
    ");

    db.Database.Migrate();
}

// Configure the HTTP request pipeline
app.UseSwagger();
app.UseSwaggerUI();

// after app = builder.Build()
app.UseCors("AllowFrontend");

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

app.MapControllers(); // 👈 maps your controllers (like CompaniesController)

// SPA fallback: serve index.html for any non-API, non-file routes
app.MapFallbackToFile("index.html");

app.Run();

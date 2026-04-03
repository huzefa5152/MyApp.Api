using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Repositories.Implementations;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Services.Interfaces;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container
builder.Services.AddControllers(); // 👈 Needed for controllers
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));

// Register Swagger generator
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

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

app.UseAuthorization();

app.MapControllers(); // 👈 maps your controllers (like CompaniesController)

app.Run();

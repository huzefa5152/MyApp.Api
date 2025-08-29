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

// Register Services
builder.Services.AddScoped<ICompanyService, CompanyService>();
builder.Services.AddScoped<IDeliveryChallanService, DeliveryChallanService>();

// before builder.Build()
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", p =>
        p.AllowAnyOrigin()    // or .WithOrigins("https://localhost:5173")
         .AllowAnyHeader()
         .AllowAnyMethod());
});

builder.WebHost.ConfigureKestrel(options =>
{
    options.ListenAnyIP(5000); // HTTP
    options.ListenAnyIP(5001, listenOptions =>
    {
        listenOptions.UseHttps(); // HTTPS
    });
});


var app = builder.Build();

// Configure the HTTP request pipeline
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();             // Generate Swagger JSON
    app.UseSwaggerUI();           // Serve Swagger UI
}

// after app = builder.Build()
app.UseCors("AllowFrontend");

app.UseHttpsRedirection();

app.UseAuthorization();

app.MapControllers(); // 👈 maps your controllers (like CompaniesController)

app.Run();

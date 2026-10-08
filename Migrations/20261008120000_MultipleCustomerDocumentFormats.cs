using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using MyApp.Api.Data;

#nullable disable
namespace MyApp.Api.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20261008120000_MultipleCustomerDocumentFormats")]
public partial class MultipleCustomerDocumentFormats : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>("DocumentKind", "PoImportArchives", type: "nvarchar(32)", maxLength: 32, nullable: true);
        migrationBuilder.AddColumn<int>("DocumentId", "PoImportArchives", type: "int", nullable: true);
        migrationBuilder.DropIndex("IX_POFormats_CompanyId_ClientId", "POFormats");
        migrationBuilder.CreateIndex("IX_POFormats_CompanyId_ClientId", "POFormats", new[] { "CompanyId", "ClientId" });
        migrationBuilder.CreateIndex("IX_POFormats_CompanyId_ClientId_Name", "POFormats", new[] { "CompanyId", "ClientId", "Name" },
            unique: true, filter: "[CompanyId] IS NOT NULL AND [ClientId] IS NOT NULL");
    }
    protected override void Down(MigrationBuilder migrationBuilder) =>
        throw new NotSupportedException("Multiple customer layouts cannot be collapsed safely. Restore the pre-upgrade backup to roll back.");
}

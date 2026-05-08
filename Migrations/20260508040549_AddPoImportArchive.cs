using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPoImportArchive : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PoImportArchives",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CompanyId = table.Column<int>(type: "int", nullable: true),
                    UploadedByUserId = table.Column<int>(type: "int", nullable: true),
                    UploadedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    OriginalFileName = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    StoredPath = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    FileSizeBytes = table.Column<long>(type: "bigint", nullable: false),
                    ContentSha256 = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    ParseOutcome = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    MatchedFormatId = table.Column<int>(type: "int", nullable: true),
                    MatchedFormatVersion = table.Column<int>(type: "int", nullable: true),
                    ItemsExtracted = table.Column<int>(type: "int", nullable: false),
                    ParseDurationMs = table.Column<int>(type: "int", nullable: false),
                    ErrorMessage = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    Notes = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PoImportArchives", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PoImportArchives_CompanyId_UploadedAt",
                table: "PoImportArchives",
                columns: new[] { "CompanyId", "UploadedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_PoImportArchives_ParseOutcome",
                table: "PoImportArchives",
                column: "ParseOutcome");

            migrationBuilder.CreateIndex(
                name: "IX_PoImportArchives_UploadedAt",
                table: "PoImportArchives",
                column: "UploadedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PoImportArchives");
        }
    }
}

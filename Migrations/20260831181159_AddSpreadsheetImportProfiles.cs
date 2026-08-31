using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSpreadsheetImportProfiles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ImportProfiles",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Kind = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    Layout = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    CompanyId = table.Column<int>(type: "int", nullable: true),
                    SignatureHash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    TokenSignature = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    MappingJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    CurrentVersion = table.Column<int>(type: "int", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    Notes = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ImportProfiles", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ImportProfiles_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "ImportRuns",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    ImportProfileId = table.Column<int>(type: "int", nullable: true),
                    ProfileVersion = table.Column<int>(type: "int", nullable: true),
                    FileSha256 = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OriginalFileName = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: false),
                    FileSizeBytes = table.Column<long>(type: "bigint", nullable: false),
                    CountsJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    ImportedByUserId = table.Column<int>(type: "int", nullable: false),
                    ImportedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    IsSuperseded = table.Column<bool>(type: "bit", nullable: false),
                    SupersededAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    SupersededByUserId = table.Column<int>(type: "int", nullable: true),
                    SupersedeReason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ImportRuns", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ImportRuns_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ImportProfileVersions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ImportProfileId = table.Column<int>(type: "int", nullable: false),
                    Version = table.Column<int>(type: "int", nullable: false),
                    MappingJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Layout = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: false),
                    ChangeNote = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    CreatedBy = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ImportProfileVersions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ImportProfileVersions_ImportProfiles_ImportProfileId",
                        column: x => x.ImportProfileId,
                        principalTable: "ImportProfiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ImportProfiles_CompanyId_Kind_IsActive",
                table: "ImportProfiles",
                columns: new[] { "CompanyId", "Kind", "IsActive" });

            migrationBuilder.CreateIndex(
                name: "IX_ImportProfiles_Kind_SignatureHash",
                table: "ImportProfiles",
                columns: new[] { "Kind", "SignatureHash" });

            migrationBuilder.CreateIndex(
                name: "IX_ImportProfileVersions_ImportProfileId_Version",
                table: "ImportProfileVersions",
                columns: new[] { "ImportProfileId", "Version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ImportRuns_CompanyId_ImportedAt",
                table: "ImportRuns",
                columns: new[] { "CompanyId", "ImportedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_ImportRuns_CompanyId_Kind_FileSha256",
                table: "ImportRuns",
                columns: new[] { "CompanyId", "Kind", "FileSha256" },
                unique: true,
                filter: "[IsSuperseded] = 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ImportProfileVersions");

            migrationBuilder.DropTable(
                name: "ImportRuns");

            migrationBuilder.DropTable(
                name: "ImportProfiles");
        }
    }
}

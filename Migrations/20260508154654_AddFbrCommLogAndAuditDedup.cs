using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFbrCommLogAndAuditDedup : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "CompanyId",
                table: "AuditLogs",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CorrelationId",
                table: "AuditLogs",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Fingerprint",
                table: "AuditLogs",
                type: "nvarchar(450)",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "FirstOccurrence",
                table: "AuditLogs",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LastOccurrence",
                table: "AuditLogs",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "OccurrenceCount",
                table: "AuditLogs",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "FbrCommunicationLogs",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Timestamp = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    InvoiceId = table.Column<int>(type: "int", nullable: true),
                    CorrelationId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Action = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Endpoint = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    HttpMethod = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    HttpStatusCode = table.Column<int>(type: "int", nullable: true),
                    Status = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    FbrErrorCode = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    FbrErrorMessage = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    RequestDurationMs = table.Column<int>(type: "int", nullable: false),
                    RetryAttempt = table.Column<int>(type: "int", nullable: false),
                    RequestBodyMasked = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ResponseBodyMasked = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    UserName = table.Column<string>(type: "nvarchar(max)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FbrCommunicationLogs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_CompanyId",
                table: "AuditLogs",
                column: "CompanyId",
                filter: "[CompanyId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_Fingerprint_Timestamp",
                table: "AuditLogs",
                columns: new[] { "Fingerprint", "Timestamp" },
                filter: "[Fingerprint] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_FbrCommunicationLogs_CompanyId_Status",
                table: "FbrCommunicationLogs",
                columns: new[] { "CompanyId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_FbrCommunicationLogs_CompanyId_Timestamp",
                table: "FbrCommunicationLogs",
                columns: new[] { "CompanyId", "Timestamp" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "IX_FbrCommunicationLogs_InvoiceId",
                table: "FbrCommunicationLogs",
                column: "InvoiceId",
                filter: "[InvoiceId] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FbrCommunicationLogs");

            migrationBuilder.DropIndex(
                name: "IX_AuditLogs_CompanyId",
                table: "AuditLogs");

            migrationBuilder.DropIndex(
                name: "IX_AuditLogs_Fingerprint_Timestamp",
                table: "AuditLogs");

            migrationBuilder.DropColumn(
                name: "CompanyId",
                table: "AuditLogs");

            migrationBuilder.DropColumn(
                name: "CorrelationId",
                table: "AuditLogs");

            migrationBuilder.DropColumn(
                name: "Fingerprint",
                table: "AuditLogs");

            migrationBuilder.DropColumn(
                name: "FirstOccurrence",
                table: "AuditLogs");

            migrationBuilder.DropColumn(
                name: "LastOccurrence",
                table: "AuditLogs");

            migrationBuilder.DropColumn(
                name: "OccurrenceCount",
                table: "AuditLogs");
        }
    }
}

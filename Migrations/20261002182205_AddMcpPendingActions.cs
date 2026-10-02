using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddMcpPendingActions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "McpPendingActions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PlanId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    AgentTokenId = table.Column<int>(type: "int", nullable: false),
                    UserId = table.Column<int>(type: "int", nullable: false),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    Payload = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Summary = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                    IdempotencyKey = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CommittedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    ResultRef = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    ResultSummary = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_McpPendingActions", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_McpPendingActions_AgentTokenId_IdempotencyKey",
                table: "McpPendingActions",
                columns: new[] { "AgentTokenId", "IdempotencyKey" },
                unique: true,
                filter: "[IdempotencyKey] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_McpPendingActions_ExpiresAt",
                table: "McpPendingActions",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_McpPendingActions_PlanId",
                table: "McpPendingActions",
                column: "PlanId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "McpPendingActions");
        }
    }
}

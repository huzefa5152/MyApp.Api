using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddMcpAgentTokensAndActivity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "McpActivities",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    At = table.Column<DateTime>(type: "datetime2", nullable: false),
                    AgentTokenId = table.Column<int>(type: "int", nullable: true),
                    AgentName = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    AuthKind = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    UserId = table.Column<int>(type: "int", nullable: false),
                    Username = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Tool = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: false),
                    CompanyId = table.Column<int>(type: "int", nullable: true),
                    Arguments = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    Outcome = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    Detail = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    ResultRef = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    DurationMs = table.Column<int>(type: "int", nullable: false),
                    IpAddress = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CorrelationId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_McpActivities", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "McpAgentTokens",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<int>(type: "int", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    TokenHash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Hint = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    CompanyIds = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: false),
                    Scopes = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    AllowWrites = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CreatedByUserId = table.Column<int>(type: "int", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    LastUsedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    RevokedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    RevokedByUserId = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_McpAgentTokens", x => x.Id);
                    table.ForeignKey(
                        name: "FK_McpAgentTokens_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_McpActivities_AgentTokenId_At",
                table: "McpActivities",
                columns: new[] { "AgentTokenId", "At" });

            migrationBuilder.CreateIndex(
                name: "IX_McpActivities_At",
                table: "McpActivities",
                column: "At");

            migrationBuilder.CreateIndex(
                name: "IX_McpActivities_CompanyId_At",
                table: "McpActivities",
                columns: new[] { "CompanyId", "At" });

            migrationBuilder.CreateIndex(
                name: "IX_McpAgentTokens_TokenHash",
                table: "McpAgentTokens",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_McpAgentTokens_UserId",
                table: "McpAgentTokens",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "McpActivities");

            migrationBuilder.DropTable(
                name: "McpAgentTokens");
        }
    }
}

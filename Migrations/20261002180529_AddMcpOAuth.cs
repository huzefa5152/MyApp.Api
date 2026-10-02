using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddMcpOAuth : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "OAuthClientId",
                table: "McpAgentTokens",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "RefreshExpiresAt",
                table: "McpAgentTokens",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RefreshHash",
                table: "McpAgentTokens",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "McpOAuthClients",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    RedirectUris = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_McpOAuthClients", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "McpOAuthCodes",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CodeHash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ClientId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    UserId = table.Column<int>(type: "int", nullable: false),
                    RedirectUri = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    CodeChallenge = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: false),
                    CompanyIds = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: false),
                    Scopes = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UsedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    IssuedTokenId = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_McpOAuthCodes", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_McpAgentTokens_RefreshHash",
                table: "McpAgentTokens",
                column: "RefreshHash");

            migrationBuilder.CreateIndex(
                name: "IX_McpOAuthCodes_CodeHash",
                table: "McpOAuthCodes",
                column: "CodeHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_McpOAuthCodes_ExpiresAt",
                table: "McpOAuthCodes",
                column: "ExpiresAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "McpOAuthClients");

            migrationBuilder.DropTable(
                name: "McpOAuthCodes");

            migrationBuilder.DropIndex(
                name: "IX_McpAgentTokens_RefreshHash",
                table: "McpAgentTokens");

            migrationBuilder.DropColumn(
                name: "OAuthClientId",
                table: "McpAgentTokens");

            migrationBuilder.DropColumn(
                name: "RefreshExpiresAt",
                table: "McpAgentTokens");

            migrationBuilder.DropColumn(
                name: "RefreshHash",
                table: "McpAgentTokens");
        }
    }
}

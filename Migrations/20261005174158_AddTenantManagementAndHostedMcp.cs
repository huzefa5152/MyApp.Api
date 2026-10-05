using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddTenantManagementAndHostedMcp : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Roles_Name",
                table: "Roles");

            migrationBuilder.AddColumn<int>(
                name: "CreatedByUserId",
                table: "Users",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "TenantAdminUserId",
                table: "Roles",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CreatedByUserId",
                table: "Companies",
                type: "int",
                nullable: true);

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
                    RevokedByUserId = table.Column<int>(type: "int", nullable: true),
                    OAuthClientId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    RefreshHash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    RefreshExpiresAt = table.Column<DateTime>(type: "datetime2", nullable: true)
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

            migrationBuilder.CreateTable(
                name: "McpUserAccessPolicies",
                columns: table => new
                {
                    UserId = table.Column<int>(type: "int", nullable: false),
                    AccessGranted = table.Column<bool>(type: "bit", nullable: false),
                    WritesGranted = table.Column<bool>(type: "bit", nullable: false),
                    GrantedTools = table.Column<string>(type: "nvarchar(max)", maxLength: 8000, nullable: false),
                    AccessEnabled = table.Column<bool>(type: "bit", nullable: false),
                    WritesEnabled = table.Column<bool>(type: "bit", nullable: false),
                    SelectedTools = table.Column<string>(type: "nvarchar(max)", maxLength: 8000, nullable: true),
                    Revision = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedByUserId = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_McpUserAccessPolicies", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_McpUserAccessPolicies_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.UpdateData(
                table: "Users",
                keyColumn: "Id",
                keyValue: 1,
                column: "CreatedByUserId",
                value: null);

            migrationBuilder.CreateIndex(
                name: "IX_Users_CreatedByUserId",
                table: "Users",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Roles_Name",
                table: "Roles",
                column: "Name",
                unique: true,
                filter: "[TenantAdminUserId] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Roles_TenantAdminUserId_Name",
                table: "Roles",
                columns: new[] { "TenantAdminUserId", "Name" },
                unique: true,
                filter: "[TenantAdminUserId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Companies_CreatedByUserId",
                table: "Companies",
                column: "CreatedByUserId");

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
                name: "IX_McpAgentTokens_RefreshHash",
                table: "McpAgentTokens",
                column: "RefreshHash");

            migrationBuilder.CreateIndex(
                name: "IX_McpAgentTokens_TokenHash",
                table: "McpAgentTokens",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_McpAgentTokens_UserId",
                table: "McpAgentTokens",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_McpOAuthCodes_CodeHash",
                table: "McpOAuthCodes",
                column: "CodeHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_McpOAuthCodes_ExpiresAt",
                table: "McpOAuthCodes",
                column: "ExpiresAt");

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

            migrationBuilder.AddForeignKey(
                name: "FK_Companies_Users_CreatedByUserId",
                table: "Companies",
                column: "CreatedByUserId",
                principalTable: "Users",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_Users_Users_CreatedByUserId",
                table: "Users",
                column: "CreatedByUserId",
                principalTable: "Users",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Companies_Users_CreatedByUserId",
                table: "Companies");

            migrationBuilder.DropForeignKey(
                name: "FK_Users_Users_CreatedByUserId",
                table: "Users");

            migrationBuilder.DropTable(
                name: "McpActivities");

            migrationBuilder.DropTable(
                name: "McpAgentTokens");

            migrationBuilder.DropTable(
                name: "McpOAuthClients");

            migrationBuilder.DropTable(
                name: "McpOAuthCodes");

            migrationBuilder.DropTable(
                name: "McpPendingActions");

            migrationBuilder.DropTable(
                name: "McpUserAccessPolicies");

            migrationBuilder.DropIndex(
                name: "IX_Users_CreatedByUserId",
                table: "Users");

            migrationBuilder.DropIndex(
                name: "IX_Roles_Name",
                table: "Roles");

            migrationBuilder.DropIndex(
                name: "IX_Roles_TenantAdminUserId_Name",
                table: "Roles");

            migrationBuilder.DropIndex(
                name: "IX_Companies_CreatedByUserId",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "CreatedByUserId",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "TenantAdminUserId",
                table: "Roles");

            migrationBuilder.DropColumn(
                name: "CreatedByUserId",
                table: "Companies");

            migrationBuilder.CreateIndex(
                name: "IX_Roles_Name",
                table: "Roles",
                column: "Name",
                unique: true);
        }
    }
}

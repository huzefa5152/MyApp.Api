using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddGmailReplyWorkspace : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "UpgradeConnectionId",
                table: "GmailOAuthRequests",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsUnread",
                table: "GmailMessages",
                type: "bit",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LabelsSyncedAt",
                table: "GmailMessages",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "GrantedScopes",
                table: "GmailConnections",
                type: "nvarchar(2000)",
                maxLength: 2000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "EmailReplyAttempts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    UserId = table.Column<int>(type: "int", nullable: false),
                    ConnectionId = table.Column<int>(type: "int", nullable: false),
                    MessageId = table.Column<int>(type: "int", nullable: false),
                    ProtectedPreview = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Status = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    ProviderMessageId = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    SentAt = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailReplyAttempts", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EmailReplyAttempts_CompanyId_UserId_MessageId",
                table: "EmailReplyAttempts",
                columns: new[] { "CompanyId", "UserId", "MessageId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EmailReplyAttempts");

            migrationBuilder.DropColumn(
                name: "UpgradeConnectionId",
                table: "GmailOAuthRequests");

            migrationBuilder.DropColumn(
                name: "IsUnread",
                table: "GmailMessages");

            migrationBuilder.DropColumn(
                name: "LabelsSyncedAt",
                table: "GmailMessages");

            migrationBuilder.DropColumn(
                name: "GrantedScopes",
                table: "GmailConnections");
        }
    }
}

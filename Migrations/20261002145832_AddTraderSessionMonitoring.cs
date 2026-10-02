using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddTraderSessionMonitoring : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "CreatedAt",
                table: "UserSessions",
                type: "datetime2",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<string>(
                name: "IpAddress",
                table: "UserSessions",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "LastSeenAt",
                table: "UserSessions",
                type: "datetime2",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<DateTime>(
                name: "RevokedAt",
                table: "UserSessions",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SecurityStamp",
                table: "UserSessions",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "UserAgent",
                table: "UserSessions",
                type: "nvarchar(512)",
                maxLength: 512,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateIndex(
                name: "IX_UserSessions_LastSeenAt",
                table: "UserSessions",
                column: "LastSeenAt");

            migrationBuilder.CreateIndex(
                name: "IX_UserSessions_UserId_IsRevoked_ExpiresAt",
                table: "UserSessions",
                columns: new[] { "UserId", "IsRevoked", "ExpiresAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_UserSessions_LastSeenAt",
                table: "UserSessions");

            migrationBuilder.DropIndex(
                name: "IX_UserSessions_UserId_IsRevoked_ExpiresAt",
                table: "UserSessions");

            migrationBuilder.DropColumn(
                name: "CreatedAt",
                table: "UserSessions");

            migrationBuilder.DropColumn(
                name: "IpAddress",
                table: "UserSessions");

            migrationBuilder.DropColumn(
                name: "LastSeenAt",
                table: "UserSessions");

            migrationBuilder.DropColumn(
                name: "RevokedAt",
                table: "UserSessions");

            migrationBuilder.DropColumn(
                name: "SecurityStamp",
                table: "UserSessions");

            migrationBuilder.DropColumn(
                name: "UserAgent",
                table: "UserSessions");
        }
    }
}

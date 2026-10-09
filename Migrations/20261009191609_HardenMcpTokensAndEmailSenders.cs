using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class HardenMcpTokensAndEmailSenders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SecurityStamp",
                table: "McpAgentTokens",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "SenderUnverified",
                table: "GmailMessages",
                type: "bit",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SecurityStamp",
                table: "McpAgentTokens");

            migrationBuilder.DropColumn(
                name: "SenderUnverified",
                table: "GmailMessages");
        }
    }
}

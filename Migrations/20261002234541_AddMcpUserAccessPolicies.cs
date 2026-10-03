using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddMcpUserAccessPolicies : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
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
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "McpUserAccessPolicies");
        }
    }
}

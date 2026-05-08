using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSupplierGroups : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SupplierGroupId",
                table: "Suppliers",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "SupplierGroups",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    GroupKey = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    DisplayName = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    NormalizedNtn = table.Column<string>(type: "nvarchar(450)", nullable: true),
                    NormalizedName = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SupplierGroups", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Suppliers_SupplierGroupId",
                table: "Suppliers",
                column: "SupplierGroupId");

            migrationBuilder.CreateIndex(
                name: "IX_SupplierGroups_GroupKey",
                table: "SupplierGroups",
                column: "GroupKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SupplierGroups_NormalizedName",
                table: "SupplierGroups",
                column: "NormalizedName");

            migrationBuilder.CreateIndex(
                name: "IX_SupplierGroups_NormalizedNtn",
                table: "SupplierGroups",
                column: "NormalizedNtn");

            migrationBuilder.AddForeignKey(
                name: "FK_Suppliers_SupplierGroups_SupplierGroupId",
                table: "Suppliers",
                column: "SupplierGroupId",
                principalTable: "SupplierGroups",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Suppliers_SupplierGroups_SupplierGroupId",
                table: "Suppliers");

            migrationBuilder.DropTable(
                name: "SupplierGroups");

            migrationBuilder.DropIndex(
                name: "IX_Suppliers_SupplierGroupId",
                table: "Suppliers");

            migrationBuilder.DropColumn(
                name: "SupplierGroupId",
                table: "Suppliers");
        }
    }
}

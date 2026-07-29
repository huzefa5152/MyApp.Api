using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSalesOrderItemUnitPrice : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // NOTE: `dotnet ef migrations add` also wanted to CreateTable
            // "ParserFeedbacks" — that's pre-existing ModelSnapshot drift (the
            // table was already created by 20260722081305_AddPaymentsAndReceipts
            // and exists in the DB). Re-creating it here would fail. The
            // regenerated snapshot keeps ParserFeedbacks; this migration only
            // adds the new UnitPrice column.
            migrationBuilder.AddColumn<decimal>(
                name: "UnitPrice",
                table: "SalesOrderItems",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "UnitPrice",
                table: "SalesOrderItems");
        }
    }
}

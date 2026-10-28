using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class MarkStockValueCorrections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsValuationCorrection",
                table: "StockMovements",
                type: "bit",
                nullable: false,
                defaultValue: false);

            // Every adjustment and revaluation on file before this release was
            // an onboarding correction: FIFO restatements to the client's stock
            // sheet, "set to client stock sheet", the reversals of temporary
            // adjustments for manually filed FBR sales, item splits and value
            // fixes — none of them goods lost (checked row by row, 2026-10-28).
            // From here on the operator says which it is. The monthly stock
            // relief is reposted once at startup (STOCK_VALUE_CORRECTIONS_REPOST_V1)
            // so those figures move from the expense to equity.
            // EXEC keeps the new column out of this batch's parse.
            migrationBuilder.Sql(
                "EXEC('UPDATE StockMovements SET IsValuationCorrection = 1 WHERE SourceType IN (3, 6)')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsValuationCorrection",
                table: "StockMovements");
        }
    }
}

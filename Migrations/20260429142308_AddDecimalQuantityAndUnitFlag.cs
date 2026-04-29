using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddDecimalQuantityAndUnitFlag : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "AllowsDecimalQuantity",
                table: "Units",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AlterColumn<decimal>(
                name: "Quantity",
                table: "InvoiceItems",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: false,
                oldClrType: typeof(int),
                oldType: "int");

            migrationBuilder.AlterColumn<decimal>(
                name: "Quantity",
                table: "DeliveryItems",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: false,
                oldClrType: typeof(int),
                oldType: "int");

            // Seed sensible defaults — every UOM that obviously carries a
            // fractional quantity (mass / volume / area / energy / linear
            // measure) gets the flag flipped on. Operators can adjust the
            // rest from the Units admin page.
            // Idempotent: only flips rows that currently exist with the
            // matching name. Adding a new unit later defaults to integer-
            // only and admin can flip via the UI.
            migrationBuilder.Sql(@"
                UPDATE Units SET AllowsDecimalQuantity = 1
                WHERE Name IN (
                    'KG', 'Kilogram', 'Gram', 'Pound',
                    'Liter', 'Litre', 'Gallon',
                    'MT', 'Carat',
                    'Square Foot', 'SqFt', 'Square Metre', 'SqM', 'SqY',
                    'Cubic Metre', 'CubicMetre',
                    'Meter', 'Metre', 'Mtr', 'Foot',
                    'MMBTU', 'KWH', '1000 kWh', 'Mega Watt',
                    'Barrels'
                );
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AllowsDecimalQuantity",
                table: "Units");

            migrationBuilder.AlterColumn<int>(
                name: "Quantity",
                table: "InvoiceItems",
                type: "int",
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "decimal(18,4)",
                oldPrecision: 18,
                oldScale: 4);

            migrationBuilder.AlterColumn<int>(
                name: "Quantity",
                table: "DeliveryItems",
                type: "int",
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "decimal(18,4)",
                oldPrecision: 18,
                oldScale: 4);
        }
    }
}

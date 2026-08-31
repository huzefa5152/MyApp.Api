using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPayeeNameAndExpenseAllocationLines : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ContactName",
                table: "Payments",
                type: "nvarchar(150)",
                maxLength: 150,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Kind",
                table: "PaymentAllocations",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<decimal>(
                name: "TaxAmount",
                table: "PaymentAllocations",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "TaxRate",
                table: "PaymentAllocations",
                type: "decimal(9,4)",
                precision: 9,
                scale: 4,
                nullable: true);

            // Backfill Kind for rows that already exist. Everything written before
            // this migration targets an invoice, a bill, or an account; Kind's
            // default of 0 (Document) is already right for the first two, so only
            // the account-targeted rows need moving to 1 (Account). No row can be
            // OnAccount (2) yet — that shape had no way to be recorded.
            //
            // Wrapped in EXEC because a batch that both ALTERs a table and
            // references the new column fails at PARSE time on SQL Server, even
            // when the statement would never run (CLAUDE.md §11).
            migrationBuilder.Sql(@"
EXEC('UPDATE PaymentAllocations
         SET Kind = 1
       WHERE AccountId IS NOT NULL
         AND InvoiceId IS NULL
         AND PurchaseBillId IS NULL');");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ContactName",
                table: "Payments");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "PaymentAllocations");

            migrationBuilder.DropColumn(
                name: "TaxAmount",
                table: "PaymentAllocations");

            migrationBuilder.DropColumn(
                name: "TaxRate",
                table: "PaymentAllocations");
        }
    }
}

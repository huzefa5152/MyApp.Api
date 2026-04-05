using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class MoveInvoiceNumberFromClientToCompany : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Copy invoice number data from clients to companies before dropping columns
            migrationBuilder.Sql(@"
                IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Clients') AND name = 'CurrentInvoiceNumber')
                BEGIN
                    UPDATE Companies
                    SET CurrentInvoiceNumber = ISNULL((
                        SELECT MAX(i.InvoiceNumber)
                        FROM Invoices i
                        WHERE i.CompanyId = Companies.Id
                    ), 0)
                END
            ");

            migrationBuilder.AddColumn<int>(
                name: "StartingInvoiceNumber",
                table: "Companies",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.Sql(@"
                IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Clients') AND name = 'StartingInvoiceNumber')
                BEGIN
                    UPDATE Companies
                    SET StartingInvoiceNumber = ISNULL((
                        SELECT MAX(c.StartingInvoiceNumber)
                        FROM Clients c
                        WHERE c.CompanyId = Companies.Id
                    ), 0)
                END
            ");

            migrationBuilder.Sql(@"
                DECLARE @sql NVARCHAR(MAX) = '';
                SELECT @sql += 'ALTER TABLE Clients DROP CONSTRAINT ' + dc.name + '; '
                FROM sys.default_constraints dc
                JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
                WHERE dc.parent_object_id = OBJECT_ID('Clients')
                  AND c.name IN ('CurrentInvoiceNumber', 'StartingInvoiceNumber');
                EXEC sp_executesql @sql;

                IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Clients') AND name = 'CurrentInvoiceNumber')
                    ALTER TABLE Clients DROP COLUMN CurrentInvoiceNumber;
                IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Clients') AND name = 'StartingInvoiceNumber')
                    ALTER TABLE Clients DROP COLUMN StartingInvoiceNumber;
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "StartingInvoiceNumber",
                table: "Companies");

            migrationBuilder.AddColumn<int>(
                name: "CurrentInvoiceNumber",
                table: "Clients",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "StartingInvoiceNumber",
                table: "Clients",
                type: "int",
                nullable: false,
                defaultValue: 0);
        }
    }
}

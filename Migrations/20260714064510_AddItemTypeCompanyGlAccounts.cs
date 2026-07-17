using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddItemTypeCompanyGlAccounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "AccountId",
                table: "PurchaseItems",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "AccountId",
                table: "InvoiceItems",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DivisionId",
                table: "CompanyItemTypeSettings",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PurchaseAccountId",
                table: "CompanyItemTypeSettings",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SaleAccountId",
                table: "CompanyItemTypeSettings",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DefaultPurchaseAccountId",
                table: "Companies",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DefaultSalesAccountId",
                table: "Companies",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseItems_AccountId",
                table: "PurchaseItems",
                column: "AccountId");

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceItems_AccountId",
                table: "InvoiceItems",
                column: "AccountId");

            migrationBuilder.CreateIndex(
                name: "IX_CompanyItemTypeSettings_DivisionId",
                table: "CompanyItemTypeSettings",
                column: "DivisionId");

            migrationBuilder.CreateIndex(
                name: "IX_CompanyItemTypeSettings_PurchaseAccountId",
                table: "CompanyItemTypeSettings",
                column: "PurchaseAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_CompanyItemTypeSettings_SaleAccountId",
                table: "CompanyItemTypeSettings",
                column: "SaleAccountId");

            migrationBuilder.AddForeignKey(
                name: "FK_CompanyItemTypeSettings_Accounts_PurchaseAccountId",
                table: "CompanyItemTypeSettings",
                column: "PurchaseAccountId",
                principalTable: "Accounts",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_CompanyItemTypeSettings_Accounts_SaleAccountId",
                table: "CompanyItemTypeSettings",
                column: "SaleAccountId",
                principalTable: "Accounts",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_CompanyItemTypeSettings_Divisions_DivisionId",
                table: "CompanyItemTypeSettings",
                column: "DivisionId",
                principalTable: "Divisions",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_InvoiceItems_Accounts_AccountId",
                table: "InvoiceItems",
                column: "AccountId",
                principalTable: "Accounts",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_PurchaseItems_Accounts_AccountId",
                table: "PurchaseItems",
                column: "AccountId",
                principalTable: "Accounts",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_CompanyItemTypeSettings_Accounts_PurchaseAccountId",
                table: "CompanyItemTypeSettings");

            migrationBuilder.DropForeignKey(
                name: "FK_CompanyItemTypeSettings_Accounts_SaleAccountId",
                table: "CompanyItemTypeSettings");

            migrationBuilder.DropForeignKey(
                name: "FK_CompanyItemTypeSettings_Divisions_DivisionId",
                table: "CompanyItemTypeSettings");

            migrationBuilder.DropForeignKey(
                name: "FK_InvoiceItems_Accounts_AccountId",
                table: "InvoiceItems");

            migrationBuilder.DropForeignKey(
                name: "FK_PurchaseItems_Accounts_AccountId",
                table: "PurchaseItems");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseItems_AccountId",
                table: "PurchaseItems");

            migrationBuilder.DropIndex(
                name: "IX_InvoiceItems_AccountId",
                table: "InvoiceItems");

            migrationBuilder.DropIndex(
                name: "IX_CompanyItemTypeSettings_DivisionId",
                table: "CompanyItemTypeSettings");

            migrationBuilder.DropIndex(
                name: "IX_CompanyItemTypeSettings_PurchaseAccountId",
                table: "CompanyItemTypeSettings");

            migrationBuilder.DropIndex(
                name: "IX_CompanyItemTypeSettings_SaleAccountId",
                table: "CompanyItemTypeSettings");

            migrationBuilder.DropColumn(
                name: "AccountId",
                table: "PurchaseItems");

            migrationBuilder.DropColumn(
                name: "AccountId",
                table: "InvoiceItems");

            migrationBuilder.DropColumn(
                name: "DivisionId",
                table: "CompanyItemTypeSettings");

            migrationBuilder.DropColumn(
                name: "PurchaseAccountId",
                table: "CompanyItemTypeSettings");

            migrationBuilder.DropColumn(
                name: "SaleAccountId",
                table: "CompanyItemTypeSettings");

            migrationBuilder.DropColumn(
                name: "DefaultPurchaseAccountId",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "DefaultSalesAccountId",
                table: "Companies");
        }
    }
}

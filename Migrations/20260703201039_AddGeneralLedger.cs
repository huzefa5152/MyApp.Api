using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddGeneralLedger : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "GlLockDate",
                table: "Companies",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "GlPostingEnabled",
                table: "Companies",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "AccountTransfers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    Number = table.Column<int>(type: "int", nullable: false),
                    Date = table.Column<DateTime>(type: "datetime2", nullable: false),
                    FromAccountId = table.Column<int>(type: "int", nullable: false),
                    ToAccountId = table.Column<int>(type: "int", nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    DivisionId = table.Column<int>(type: "int", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AccountTransfers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AccountTransfers_Accounts_FromAccountId",
                        column: x => x.FromAccountId,
                        principalTable: "Accounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_AccountTransfers_Accounts_ToAccountId",
                        column: x => x.ToAccountId,
                        principalTable: "Accounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_AccountTransfers_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "JournalEntries",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    EntryNo = table.Column<int>(type: "int", nullable: false),
                    Date = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Narration = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    SourceDocType = table.Column<int>(type: "int", nullable: false),
                    SourceDocId = table.Column<int>(type: "int", nullable: true),
                    DivisionId = table.Column<int>(type: "int", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_JournalEntries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_JournalEntries_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "JournalLines",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    JournalEntryId = table.Column<int>(type: "int", nullable: false),
                    AccountId = table.Column<int>(type: "int", nullable: false),
                    Debit = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    Credit = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    PartyType = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    PartyId = table.Column<int>(type: "int", nullable: true),
                    InvoiceId = table.Column<int>(type: "int", nullable: true),
                    PurchaseBillId = table.Column<int>(type: "int", nullable: true),
                    Description = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    DivisionId = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_JournalLines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_JournalLines_Accounts_AccountId",
                        column: x => x.AccountId,
                        principalTable: "Accounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_JournalLines_JournalEntries_JournalEntryId",
                        column: x => x.JournalEntryId,
                        principalTable: "JournalEntries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Payments_BankAccountId",
                table: "Payments",
                column: "BankAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentAllocations_AccountId",
                table: "PaymentAllocations",
                column: "AccountId");

            migrationBuilder.CreateIndex(
                name: "IX_AccountTransfers_CompanyId_Number",
                table: "AccountTransfers",
                columns: new[] { "CompanyId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AccountTransfers_FromAccountId",
                table: "AccountTransfers",
                column: "FromAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_AccountTransfers_ToAccountId",
                table: "AccountTransfers",
                column: "ToAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_JournalEntries_CompanyId_Date",
                table: "JournalEntries",
                columns: new[] { "CompanyId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_JournalEntries_CompanyId_EntryNo",
                table: "JournalEntries",
                columns: new[] { "CompanyId", "EntryNo" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_JournalEntries_CompanyId_SourceDocType_SourceDocId",
                table: "JournalEntries",
                columns: new[] { "CompanyId", "SourceDocType", "SourceDocId" },
                unique: true,
                filter: "[SourceDocId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_JournalLines_AccountId",
                table: "JournalLines",
                column: "AccountId");

            migrationBuilder.CreateIndex(
                name: "IX_JournalLines_InvoiceId",
                table: "JournalLines",
                column: "InvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_JournalLines_JournalEntryId",
                table: "JournalLines",
                column: "JournalEntryId");

            migrationBuilder.CreateIndex(
                name: "IX_JournalLines_PurchaseBillId",
                table: "JournalLines",
                column: "PurchaseBillId");

            // ── Data repair BEFORE the FKs land ──────────────────────────────
            // 1. Backfill Payment.BankAccountId from the free-text
            //    BankAccountName: the legacy ETL stored the old GL account code
            //    there, and the imported CoA carries that same code in
            //    Account.Code (unique per company when present). 1,931 of
            //    1,932 payment rows were NULL at analysis time.
            migrationBuilder.Sql(@"
UPDATE p SET p.BankAccountId = a.Id
FROM Payments p
JOIN Accounts a ON a.CompanyId = p.CompanyId AND a.Code = p.BankAccountName
WHERE p.BankAccountId IS NULL AND p.BankAccountName IS NOT NULL;");

            // 2. Defensive: NULL any dangling references so the FKs can't fail
            //    (the columns were soft references until now).
            migrationBuilder.Sql(@"
UPDATE p SET p.BankAccountId = NULL
FROM Payments p
LEFT JOIN Accounts a ON a.Id = p.BankAccountId
WHERE p.BankAccountId IS NOT NULL AND a.Id IS NULL;");
            migrationBuilder.Sql(@"
UPDATE pa SET pa.AccountId = NULL
FROM PaymentAllocations pa
LEFT JOIN Accounts a ON a.Id = pa.AccountId
WHERE pa.AccountId IS NOT NULL AND a.Id IS NULL;");

            migrationBuilder.AddForeignKey(
                name: "FK_PaymentAllocations_Accounts_AccountId",
                table: "PaymentAllocations",
                column: "AccountId",
                principalTable: "Accounts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Payments_Accounts_BankAccountId",
                table: "Payments",
                column: "BankAccountId",
                principalTable: "Accounts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PaymentAllocations_Accounts_AccountId",
                table: "PaymentAllocations");

            migrationBuilder.DropForeignKey(
                name: "FK_Payments_Accounts_BankAccountId",
                table: "Payments");

            migrationBuilder.DropTable(
                name: "AccountTransfers");

            migrationBuilder.DropTable(
                name: "JournalLines");

            migrationBuilder.DropTable(
                name: "JournalEntries");

            migrationBuilder.DropIndex(
                name: "IX_Payments_BankAccountId",
                table: "Payments");

            migrationBuilder.DropIndex(
                name: "IX_PaymentAllocations_AccountId",
                table: "PaymentAllocations");

            migrationBuilder.DropColumn(
                name: "GlLockDate",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "GlPostingEnabled",
                table: "Companies");
        }
    }
}

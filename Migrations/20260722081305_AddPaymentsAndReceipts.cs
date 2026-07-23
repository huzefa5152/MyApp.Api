using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPaymentsAndReceipts : Migration
    {
        // IDEMPOTENT guarded raw SQL (not the generated AddColumn/CreateTable
        // calls). The dev prod-replica DB (db46684) was polluted by an earlier
        // customer-branch run: it already has Invoices/PurchaseBills.AmountPaid +
        // DueDate and the Payments/PaymentAllocations tables (with an extra,
        // unmapped DivisionId and WITHOUT ReconciledDate). A plain AddColumn /
        // CreateTable would throw "column/table already exists" there. These
        // guards no-op what's present and add only what's missing (notably the
        // ReconciledDate column on a pre-existing Payments table), while on a
        // true master/prod DB (hakimitraders — has none of this) they create
        // everything fresh. Mirrors the Phase-2 PrintTemplate idempotent
        // migration + the Program.cs SecurityStamp-backfill split-batch pattern
        // (CLAUDE.md §11): each statement is its own batch so a column-dependent
        // statement is parsed only after the column/table exists.
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ParserFeedbacks CreateTable intentionally stripped — that table is
            // raw-SQL-managed (Data/ParserFeedbackSchema.cs at startup) and kept
            // out of migrations + the model snapshot.

            // ── AR/AP subledger columns on the settled documents ──
            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.Invoices','AmountPaid') IS NULL
    ALTER TABLE dbo.Invoices ADD AmountPaid decimal(18,2) NOT NULL CONSTRAINT DF_Invoices_AmountPaid DEFAULT(0);");
            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.Invoices','DueDate') IS NULL
    ALTER TABLE dbo.Invoices ADD DueDate datetime2 NULL;");
            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.PurchaseBills','AmountPaid') IS NULL
    ALTER TABLE dbo.PurchaseBills ADD AmountPaid decimal(18,2) NOT NULL CONSTRAINT DF_PurchaseBills_AmountPaid DEFAULT(0);");
            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.PurchaseBills','DueDate') IS NULL
    ALTER TABLE dbo.PurchaseBills ADD DueDate datetime2 NULL;");

            // ── Payments header ──
            migrationBuilder.Sql(@"
IF OBJECT_ID('dbo.Payments','U') IS NULL
BEGIN
    CREATE TABLE dbo.Payments (
        Id int IDENTITY(1,1) NOT NULL,
        CompanyId int NOT NULL,
        Direction int NOT NULL,
        Number int NOT NULL,
        Date datetime2 NOT NULL,
        ContactType nvarchar(20) NOT NULL,
        ContactId int NULL,
        BankAccountId int NULL,
        BankAccountName nvarchar(120) NULL,
        Method nvarchar(30) NOT NULL,
        Description nvarchar(max) NULL,
        Amount decimal(18,2) NOT NULL,
        ChequeNumber nvarchar(50) NULL,
        ChequeDate datetime2 NULL,
        ChequeStatus int NOT NULL,
        IsCancelled bit NOT NULL,
        CancelledAt datetime2 NULL,
        CancelReason nvarchar(max) NULL,
        ReconciledDate datetime2 NULL,
        CreatedAt datetime2 NOT NULL,
        CONSTRAINT PK_Payments PRIMARY KEY (Id),
        CONSTRAINT FK_Payments_Companies_CompanyId FOREIGN KEY (CompanyId)
            REFERENCES dbo.Companies (Id) ON DELETE NO ACTION
    );
END");
            // db46684's pre-existing Payments table predates ReconciledDate — add it.
            migrationBuilder.Sql(@"
IF OBJECT_ID('dbo.Payments','U') IS NOT NULL AND COL_LENGTH('dbo.Payments','ReconciledDate') IS NULL
    ALTER TABLE dbo.Payments ADD ReconciledDate datetime2 NULL;");

            // ── Payment allocation lines ──
            migrationBuilder.Sql(@"
IF OBJECT_ID('dbo.PaymentAllocations','U') IS NULL
BEGIN
    CREATE TABLE dbo.PaymentAllocations (
        Id int IDENTITY(1,1) NOT NULL,
        PaymentId int NOT NULL,
        InvoiceId int NULL,
        PurchaseBillId int NULL,
        AccountId int NULL,
        Amount decimal(18,2) NOT NULL,
        CONSTRAINT PK_PaymentAllocations PRIMARY KEY (Id),
        CONSTRAINT FK_PaymentAllocations_Payments_PaymentId FOREIGN KEY (PaymentId)
            REFERENCES dbo.Payments (Id) ON DELETE CASCADE,
        CONSTRAINT FK_PaymentAllocations_Invoices_InvoiceId FOREIGN KEY (InvoiceId)
            REFERENCES dbo.Invoices (Id) ON DELETE NO ACTION,
        CONSTRAINT FK_PaymentAllocations_PurchaseBills_PurchaseBillId FOREIGN KEY (PurchaseBillId)
            REFERENCES dbo.PurchaseBills (Id) ON DELETE NO ACTION
    );
END");

            // ── Indexes (guarded; tables now exist) ──
            migrationBuilder.Sql(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_PaymentAllocations_InvoiceId' AND object_id=OBJECT_ID('dbo.PaymentAllocations'))
    CREATE INDEX IX_PaymentAllocations_InvoiceId ON dbo.PaymentAllocations (InvoiceId);");
            migrationBuilder.Sql(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_PaymentAllocations_PaymentId' AND object_id=OBJECT_ID('dbo.PaymentAllocations'))
    CREATE INDEX IX_PaymentAllocations_PaymentId ON dbo.PaymentAllocations (PaymentId);");
            migrationBuilder.Sql(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_PaymentAllocations_PurchaseBillId' AND object_id=OBJECT_ID('dbo.PaymentAllocations'))
    CREATE INDEX IX_PaymentAllocations_PurchaseBillId ON dbo.PaymentAllocations (PurchaseBillId);");
            migrationBuilder.Sql(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Payments_CompanyId_Direction_Number' AND object_id=OBJECT_ID('dbo.Payments'))
    CREATE UNIQUE INDEX IX_Payments_CompanyId_Direction_Number ON dbo.Payments (CompanyId, Direction, Number);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // ParserFeedbacks DropTable intentionally stripped (see Up). Guarded
            // drops so Down is safe regardless of what actually got created.
            migrationBuilder.Sql("IF OBJECT_ID('dbo.PaymentAllocations','U') IS NOT NULL DROP TABLE dbo.PaymentAllocations;");
            migrationBuilder.Sql("IF OBJECT_ID('dbo.Payments','U') IS NOT NULL DROP TABLE dbo.Payments;");
            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.PurchaseBills','AmountPaid') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name='DF_PurchaseBills_AmountPaid')
        ALTER TABLE dbo.PurchaseBills DROP CONSTRAINT DF_PurchaseBills_AmountPaid;
    ALTER TABLE dbo.PurchaseBills DROP COLUMN AmountPaid;
END");
            migrationBuilder.Sql("IF COL_LENGTH('dbo.PurchaseBills','DueDate') IS NOT NULL ALTER TABLE dbo.PurchaseBills DROP COLUMN DueDate;");
            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.Invoices','AmountPaid') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name='DF_Invoices_AmountPaid')
        ALTER TABLE dbo.Invoices DROP CONSTRAINT DF_Invoices_AmountPaid;
    ALTER TABLE dbo.Invoices DROP COLUMN AmountPaid;
END");
            migrationBuilder.Sql("IF COL_LENGTH('dbo.Invoices','DueDate') IS NOT NULL ALTER TABLE dbo.Invoices DROP COLUMN DueDate;");
        }
    }
}

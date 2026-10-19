using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddImportSettlementAdjustment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "ImportSettlementAdjustment",
                table: "PurchaseBills",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "ImportSettlementAdjustment",
                table: "Invoices",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            // One-time backfill for documents imported from Manager (ExternalRef
            // "mgr-…"). Their AmountPaid was anchored to Manager's balance due,
            // so part of it has no allocation here; recording that part makes
            // AmountPaid = Σ allocations + ImportSettlementAdjustment, which every
            // recompute and the as-of aging then respect. Signed both ways, like
            // the party ledger's "Settled before migration" row. Allocations are
            // counted as PaymentService.RecomputeInvoiceAsync counts them: cash +
            // adjustment on non-cancelled payments. Run in EXEC so the new column
            // is resolved at execution, not when the batch is parsed.
            migrationBuilder.Sql(@"EXEC('
UPDATE i SET ImportSettlementAdjustment = i.AmountPaid - ISNULL(a.Settled, 0)
FROM Invoices i
OUTER APPLY (SELECT SUM(pa.Amount + pa.AdjustmentAmount) AS Settled
             FROM PaymentAllocations pa JOIN Payments p ON p.Id = pa.PaymentId
             WHERE pa.InvoiceId = i.Id AND p.IsCancelled = 0) a
WHERE i.ExternalRef LIKE ''mgr-%'' AND i.ImportSettlementAdjustment IS NULL
  AND ABS(i.AmountPaid - ISNULL(a.Settled, 0)) > 0.005;
UPDATE b SET ImportSettlementAdjustment = b.AmountPaid - ISNULL(a.Settled, 0)
FROM PurchaseBills b
OUTER APPLY (SELECT SUM(pa.Amount + pa.AdjustmentAmount) AS Settled
             FROM PaymentAllocations pa JOIN Payments p ON p.Id = pa.PaymentId
             WHERE pa.PurchaseBillId = b.Id AND p.IsCancelled = 0) a
WHERE b.ExternalRef LIKE ''mgr-%'' AND b.ImportSettlementAdjustment IS NULL
  AND ABS(b.AmountPaid - ISNULL(a.Settled, 0)) > 0.005;
')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ImportSettlementAdjustment",
                table: "PurchaseBills");

            migrationBuilder.DropColumn(
                name: "ImportSettlementAdjustment",
                table: "Invoices");
        }
    }
}

using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using MyApp.Api.Data;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <summary>
    /// Supplier purchases raised from challan or bill costs through the old
    /// preview become automatic: they now follow those costs while unpaid.
    /// Only bills whose every line points at ONE source document convert;
    /// anything mixed stays a manual (fixed) purchase. Data only — no schema.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261019100000_MarkCostDrivenPurchasesAutomatic")]
    public partial class MarkCostDrivenPurchasesAutomatic : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Raised from a challan's lines by the challan preview.
            migrationBuilder.Sql(@"
UPDATE PurchaseBills SET Source = 'auto-cost'
WHERE Source = 'challan-supplier' AND SourceDeliveryChallanId IS NOT NULL;");

            // Raised by the costing dialog: one challan's lines...
            migrationBuilder.Sql(@"
UPDATE p SET Source = 'auto-cost', SourceDeliveryChallanId = x.ChallanId
FROM PurchaseBills p
CROSS APPLY (
    SELECT MIN(d.DeliveryChallanId) AS ChallanId,
           COUNT(DISTINCT d.DeliveryChallanId) AS Challans,
           SUM(CASE WHEN i.LocalDeliveryItemId IS NULL THEN 1 ELSE 0 END) AS Other
    FROM PurchaseItems i
    LEFT JOIN DeliveryItems d ON d.Id = i.LocalDeliveryItemId
    WHERE i.PurchaseBillId = p.Id) x
WHERE p.Source = 'local-direct' AND p.Notes LIKE 'Local purchase from %'
  AND x.Challans = 1 AND x.Other = 0;");

            // ...or one standalone bill's own lines.
            migrationBuilder.Sql(@"
UPDATE p SET Source = 'auto-cost', SourceInvoiceId = x.InvoiceId
FROM PurchaseBills p
CROSS APPLY (
    SELECT MIN(ii.InvoiceId) AS InvoiceId,
           COUNT(DISTINCT ii.InvoiceId) AS Bills,
           SUM(CASE WHEN i.LocalInvoiceItemId IS NULL THEN 1 ELSE 0 END) AS Other
    FROM PurchaseItems i
    LEFT JOIN InvoiceItems ii ON ii.Id = i.LocalInvoiceItemId
    WHERE i.PurchaseBillId = p.Id) x
WHERE p.Source = 'local-direct' AND p.Notes LIKE 'Local purchase from %'
  AND x.Bills = 1 AND x.Other = 0;");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("UPDATE PurchaseBills SET Source = 'local-direct' WHERE Source = 'auto-cost';");
        }
    }
}

using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class PrivateCompanyCatalogs : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Units_Name",
                table: "Units");

            migrationBuilder.DropIndex(
                name: "IX_ItemTypes_Name_HSCode",
                table: "ItemTypes");

            migrationBuilder.DropIndex(
                name: "IX_ItemDescriptions_Name",
                table: "ItemDescriptions");

            migrationBuilder.AddColumn<int>(
                name: "CompanyId",
                table: "Units",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CompanyId",
                table: "ItemTypes",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CompanyId",
                table: "ItemDescriptions",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Units_CompanyId_Name",
                table: "Units",
                columns: new[] { "CompanyId", "Name" },
                unique: true,
                filter: "[CompanyId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ItemTypes_CompanyId_Name_HSCode",
                table: "ItemTypes",
                columns: new[] { "CompanyId", "Name", "HSCode" },
                unique: true,
                filter: "[IsDeleted] = 0");

            migrationBuilder.CreateIndex(
                name: "IX_ItemDescriptions_CompanyId_Name",
                table: "ItemDescriptions",
                columns: new[] { "CompanyId", "Name" },
                unique: true,
                filter: "[CompanyId] IS NOT NULL");

            migrationBuilder.AddForeignKey(
                name: "FK_ItemDescriptions_Companies_CompanyId",
                table: "ItemDescriptions",
                column: "CompanyId",
                principalTable: "Companies",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_ItemTypes_Companies_CompanyId",
                table: "ItemTypes",
                column: "CompanyId",
                principalTable: "Companies",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Units_Companies_CompanyId",
                table: "Units",
                column: "CompanyId",
                principalTable: "Companies",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
            migrationBuilder.Sql("""
                -- Preserve unowned originals for recovery; never expose them to tenants.
                -- Clone only where document/stock history proves company usage.
                SELECT DISTINCT OldId,CompanyId INTO #CatalogUsage FROM (
                SELECT l.ItemTypeId OldId, p.CompanyId FROM InvoiceItems l JOIN Invoices p ON p.Id=l.InvoiceId WHERE l.ItemTypeId IS NOT NULL
                UNION
                SELECT l.ItemTypeId OldId, p.CompanyId FROM DeliveryItems l JOIN DeliveryChallans p ON p.Id=l.DeliveryChallanId WHERE l.ItemTypeId IS NOT NULL
                UNION
                SELECT l.ItemTypeId OldId, p.CompanyId FROM PurchaseItems l JOIN PurchaseBills p ON p.Id=l.PurchaseBillId WHERE l.ItemTypeId IS NOT NULL
                UNION
                SELECT l.ItemTypeId OldId, p.CompanyId FROM GoodsReceiptItems l JOIN GoodsReceipts p ON p.Id=l.GoodsReceiptId WHERE l.ItemTypeId IS NOT NULL
                UNION
                SELECT l.ItemTypeId OldId, p.CompanyId FROM SalesOrderItems l JOIN SalesOrders p ON p.Id=l.SalesOrderId WHERE l.ItemTypeId IS NOT NULL
                UNION
                SELECT l.ItemTypeId OldId, p.CompanyId FROM SalesQuoteItems l JOIN SalesQuotes p ON p.Id=l.SalesQuoteId WHERE l.ItemTypeId IS NOT NULL
                UNION
                SELECT ItemTypeId, CompanyId FROM StockMovements
                UNION
                SELECT ItemTypeId, CompanyId FROM OpeningStockBalances
                UNION
                SELECT a.AdjustedItemTypeId, i.CompanyId FROM InvoiceItemAdjustments a JOIN InvoiceItems l ON l.Id=a.InvoiceItemId JOIN Invoices i ON i.Id=l.InvoiceId WHERE a.AdjustedItemTypeId IS NOT NULL) usage;
                CREATE TABLE #CatalogMap (OldId int NOT NULL, CompanyId int NOT NULL, NewId int NOT NULL, PRIMARY KEY(OldId,CompanyId));
                MERGE ItemTypes AS target
                USING (SELECT u.OldId,u.CompanyId,it.Name,it.CreatedAt,it.HSCode,it.UOM,it.FbrUOMId,it.SaleType,it.FbrDescription,it.IsFavorite,it.UsageCount,it.LastUsedAt,it.IsHsCodePartial,it.IsDeleted FROM #CatalogUsage u JOIN ItemTypes it ON it.Id=u.OldId) AS source ON 1=0
                WHEN NOT MATCHED THEN INSERT (CompanyId,Name,CreatedAt,HSCode,UOM,FbrUOMId,SaleType,FbrDescription,IsFavorite,UsageCount,LastUsedAt,IsHsCodePartial,IsDeleted) VALUES (source.CompanyId,source.Name,source.CreatedAt,source.HSCode,source.UOM,source.FbrUOMId,source.SaleType,source.FbrDescription,source.IsFavorite,0,NULL,source.IsHsCodePartial,source.IsDeleted)
                OUTPUT source.OldId,source.CompanyId,inserted.Id INTO #CatalogMap;
                UPDATE l SET ItemTypeId=m.NewId FROM InvoiceItems l JOIN Invoices p ON p.Id=l.InvoiceId JOIN #CatalogMap m ON m.OldId=l.ItemTypeId AND m.CompanyId=p.CompanyId;
                UPDATE l SET ItemTypeId=m.NewId FROM DeliveryItems l JOIN DeliveryChallans p ON p.Id=l.DeliveryChallanId JOIN #CatalogMap m ON m.OldId=l.ItemTypeId AND m.CompanyId=p.CompanyId;
                UPDATE l SET ItemTypeId=m.NewId FROM PurchaseItems l JOIN PurchaseBills p ON p.Id=l.PurchaseBillId JOIN #CatalogMap m ON m.OldId=l.ItemTypeId AND m.CompanyId=p.CompanyId;
                UPDATE l SET ItemTypeId=m.NewId FROM GoodsReceiptItems l JOIN GoodsReceipts p ON p.Id=l.GoodsReceiptId JOIN #CatalogMap m ON m.OldId=l.ItemTypeId AND m.CompanyId=p.CompanyId;
                UPDATE l SET ItemTypeId=m.NewId FROM SalesOrderItems l JOIN SalesOrders p ON p.Id=l.SalesOrderId JOIN #CatalogMap m ON m.OldId=l.ItemTypeId AND m.CompanyId=p.CompanyId;
                UPDATE l SET ItemTypeId=m.NewId FROM SalesQuoteItems l JOIN SalesQuotes p ON p.Id=l.SalesQuoteId JOIN #CatalogMap m ON m.OldId=l.ItemTypeId AND m.CompanyId=p.CompanyId;
                UPDATE l SET ItemTypeId=m.NewId FROM StockMovements l JOIN #CatalogMap m ON m.OldId=l.ItemTypeId AND m.CompanyId=l.CompanyId;
                UPDATE l SET ItemTypeId=m.NewId FROM OpeningStockBalances l JOIN #CatalogMap m ON m.OldId=l.ItemTypeId AND m.CompanyId=l.CompanyId;
                UPDATE a SET AdjustedItemTypeId=m.NewId FROM InvoiceItemAdjustments a JOIN InvoiceItems l ON l.Id=a.InvoiceItemId JOIN Invoices i ON i.Id=l.InvoiceId JOIN #CatalogMap m ON m.OldId=a.AdjustedItemTypeId AND m.CompanyId=i.CompanyId;
                SELECT DISTINCT CompanyId,Description,UnitName INTO #CatalogNames FROM (SELECT p.CompanyId,l.Description,l.UOM UnitName FROM InvoiceItems l JOIN Invoices p ON p.Id=l.InvoiceId
                UNION
                SELECT p.CompanyId,l.Description,l.Unit UnitName FROM DeliveryItems l JOIN DeliveryChallans p ON p.Id=l.DeliveryChallanId
                UNION
                SELECT p.CompanyId,l.Description,l.UOM UnitName FROM PurchaseItems l JOIN PurchaseBills p ON p.Id=l.PurchaseBillId
                UNION
                SELECT p.CompanyId,l.Description,l.Unit UnitName FROM GoodsReceiptItems l JOIN GoodsReceipts p ON p.Id=l.GoodsReceiptId
                UNION
                SELECT p.CompanyId,l.Description,l.Unit UnitName FROM SalesOrderItems l JOIN SalesOrders p ON p.Id=l.SalesOrderId
                UNION
                SELECT p.CompanyId,l.Description,l.Unit UnitName FROM SalesQuoteItems l JOIN SalesQuotes p ON p.Id=l.SalesQuoteId
                UNION
                SELECT i.CompanyId,a.AdjustedDescription,a.AdjustedUOM FROM InvoiceItemAdjustments a JOIN InvoiceItems l ON l.Id=a.InvoiceItemId JOIN Invoices i ON i.Id=l.InvoiceId) n;
                INSERT ItemDescriptions (CompanyId,Name,HSCode,SaleType,FbrUOMId,UOM,IsFavorite,UsageCount,LastUsedAt)
                SELECT DISTINCT n.CompanyId,d.Name,d.HSCode,d.SaleType,d.FbrUOMId,d.UOM,d.IsFavorite,0,NULL
                FROM #CatalogNames n JOIN ItemDescriptions d ON d.Name=n.Description AND d.CompanyId IS NULL;
                INSERT Units (CompanyId,Name,AllowsDecimalQuantity)
                SELECT DISTINCT n.CompanyId,u.Name,u.AllowsDecimalQuantity
                FROM (SELECT CompanyId,UnitName FROM #CatalogNames UNION SELECT CompanyId,UOM FROM ItemTypes WHERE CompanyId IS NOT NULL) n
                JOIN Units u ON u.Name=n.UnitName AND u.CompanyId IS NULL;
                DROP TABLE #CatalogNames; DROP TABLE #CatalogMap; DROP TABLE #CatalogUsage;
                """);

        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException("Private catalogs cannot be merged safely by a downgrade. Restore a verified pre-upgrade backup instead.");
        }
    }
}

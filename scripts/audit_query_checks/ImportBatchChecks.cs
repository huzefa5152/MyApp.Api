using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Services.Implementations;

public static class ImportBatchChecks
{
    public static async Task RunAsync(DbContextOptions<AppDbContext> options, QueryCounter counter)
    {
        await using var db = new AppDbContext(options);
        var hs = "AUDIT" + Guid.NewGuid().ToString("N")[..8];
        var type = new ItemType { Name = hs, HSCode = hs };
        db.ItemTypes.Add(type); await db.SaveChangesAsync();
        foreach (var tracking in new[] { true, false })
        {
            var before = await RunOne(false, tracking);
            var after = await RunOne(true, tracking);
            if (before != after) throw new Exception("FBR import batch differs from master: " + before + " / " + after);
            Console.WriteLine($"PASS: FBR import rows, fractional stock, filters and counts match master; tracking={tracking}.");
        }
        var failedBefore = await RunOne(false, true, true);
        var failedAfter = await RunOne(true, true, true);
        if(failedBefore != failedAfter)throw new Exception("Import rollback differs from master");
        Console.WriteLine("PASS: injected stock-write failure rolls back all invoice rows in both paths.");
        async Task<string> RunOne(bool batch, bool tracking, bool fail = false)
        {
            var company = new Company { Name = "Audit import sample", InventoryTrackingEnabled = tracking };
            var supplier = new Supplier { Name = "Sample import supplier", Company = company };
            db.AddRange(company, supplier); await db.SaveChangesAsync();
            var invoice = new FbrImportPreviewInvoiceDto {
                FbrInvoiceRefNo = "SAMPLE-" + Guid.NewGuid().ToString("N"),
                InvoiceNo = "SAMPLE", InvoiceDate = new DateTime(2000,1,1),
                SupplierName = supplier.Name, MatchedSupplierId = supplier.Id,
                Lines = new[] { 2.5m, 3.25m, 0m, 1m, 99m }.Select((qty,index) => new FbrImportPreviewLineDto {
                    SourceRowNumber=index+2, HsCode=index==3?"":hs, Description="Sample line " + index,
                    Quantity=qty, Uom="KG", ValueExclTax=qty*10m, GstRate=18m,GstAmount=qty*1.8m,
                    Decision=index==4?ImportDecision.SkipCancelled:ImportDecision.WillImport
                }).ToList()
            };
            var counts = new FbrImportCommitCounts();
            var stock = new StockService(db, NullLogger<StockService>.Instance);
            counter.FailStockWrite = fail;
            var result = batch
                ? await new FbrPurchaseImportCommitter(db,null!,stock,NullLogger<FbrPurchaseImportCommitter>.Instance).CommitOneInvoiceAsync(company.Id,null,invoice,counts)
                : await new AuditChecks.LegacyFbrPurchaseImportCommitter(db,null!,stock,NullLogger<AuditChecks.LegacyFbrPurchaseImportCommitter>.Instance).CommitOneInvoiceAsync(company.Id,null,invoice,counts);
            counter.FailStockWrite = false;
            if(fail) {
                db.ChangeTracker.Clear();
                if(result.Outcome != "failed" || await db.PurchaseBills.AnyAsync(b=>b.CompanyId==company.Id) || await db.StockMovements.AnyAsync(m=>m.CompanyId==company.Id))throw new Exception("Failed import did not fully roll back");
                return result.Outcome;
            }
            if(result.Outcome!="imported")throw new Exception("Import failed: " + result.ErrorMessage);
            var bill = await db.PurchaseBills.AsNoTracking().SingleAsync(b=>b.Id==result.CreatedPurchaseBillId);
            var lines = await db.PurchaseItems.AsNoTracking().Where(i=>i.PurchaseBillId==bill.Id).OrderBy(i=>i.Id).Select(i=>new {i.Quantity,i.UnitPrice,i.LineTotal,i.HSCode}).ToListAsync();
            var moves = await db.StockMovements.AsNoTracking().Where(m=>m.CompanyId==company.Id).OrderBy(m=>m.Id).ToListAsync();
            if(lines.Count!=4 || moves.Count!=(tracking?2:0) || counts.StockMovementsRecorded!=2)throw new Exception("Import filter/count mismatch");
            if(moves.Any(m=>m.SourceId!=bill.Id || m.ItemTypeId!=type.Id || m.Direction!=StockMovementDirection.In))throw new Exception("Movement source mismatch");
            return JsonSerializer.Serialize(new {bill.Subtotal,bill.GSTAmount,bill.GrandTotal,lines,
                moves=moves.Select(m=>new {m.Quantity,m.Direction,m.SourceType,m.MovementDate,m.Notes}),
                counts.LinesImported,counts.StockMovementsRecorded});
        }
    }
}

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Services.Implementations;
public static class FbrCatalogScopeChecks
{
 public static async Task RunAsync(DbContextOptions<AppDbContext> options)
 {
  await using var db=new AppDbContext(options);
  var a=new Company{Name="Audit catalog owner A"};var b=new Company{Name="Audit catalog owner B",InventoryTrackingEnabled=true};db.AddRange(a,b);await db.SaveChangesAsync();
  var prefix="AUDIT"+Guid.NewGuid().ToString("N")[..8];
  var foreign=new ItemType{Name="Sample foreign HS",CompanyId=a.Id,HSCode=prefix};db.Add(foreign);await db.SaveChangesAsync();
  var own=new ItemType{Name="Sample own HS",CompanyId=b.Id,HSCode=prefix};var supplier=new Supplier{Name="Sample scoped supplier",CompanyId=b.Id};var foreignSupplier=new Supplier{Name="Sample foreign supplier",CompanyId=a.Id};db.AddRange(own,supplier,foreignSupplier);await db.SaveChangesAsync();
  var stock=new StockService(db,NullLogger<StockService>.Instance);
  var committer=new FbrPurchaseImportCommitter(db,null!,stock,NullLogger<FbrPurchaseImportCommitter>.Instance);
  FbrImportPreviewInvoiceDto Invoice(string hs,int supplierId)=>new() {InvoiceNo="SAMPLE-"+Guid.NewGuid().ToString("N"),FbrInvoiceRefNo="SAMPLE-"+Guid.NewGuid().ToString("N"),MatchedSupplierId=supplierId,SupplierName=supplier.Name,InvoiceDate=new DateTime(2000,1,1),Lines=[new FbrImportPreviewLineDto {SourceRowNumber=2,HsCode=hs,Description="Sample imported item",Quantity=2.5m,ValueExclTax=25,GstRate=18,GstAmount=4.5m,Decision=ImportDecision.WillImport}]};
  try {
   var invoice=Invoice(prefix,supplier.Id);
   var oldResult=await new AuditChecks.LegacyFbrPurchaseImportCommitter(db,null!,stock,NullLogger<AuditChecks.LegacyFbrPurchaseImportCommitter>.Instance).CommitOneInvoiceAsync(b.Id,null,invoice,new());
   if(oldResult.Outcome!="failed")throw new Exception("Baseline bug was not reproduced");
   db.ChangeTracker.Clear();
   var result=await committer.CommitOneInvoiceAsync(b.Id,null,invoice,new());
   await AssertImported(result,own.Id);
   Console.WriteLine("PASS: baseline foreign HS bug reproduced; fixed import uses only the company's existing item and stock.");
   var twin=new ItemType{Name="Sample newer twin",CompanyId=b.Id,HSCode=prefix};db.Add(twin);await db.SaveChangesAsync();
   await AssertImported(await committer.CommitOneInvoiceAsync(b.Id,null,Invoice(prefix,supplier.Id),new()),own.Id);
   foreign=await db.ItemTypes.SingleAsync(t=>t.Id==foreign.Id);foreign.HSCode=prefix+"NEW";await db.SaveChangesAsync();
   var counts=new FbrImportCommitCounts();
   var created=await committer.CommitOneInvoiceAsync(b.Id,null,Invoice(prefix+"NEW",supplier.Id),counts);
   var newType=await db.ItemTypes.AsNoTracking().SingleAsync(t=>t.CompanyId==b.Id&&t.HSCode==prefix+"NEW");
   if(counts.ItemTypesCreated!=1)throw new Exception("Company-owned catalog creation count differs");
   await AssertImported(created,newType.Id);
   Console.WriteLine("PASS: foreign-only HS creates a private item; same-company twins preserve oldest-item selection.");
   var before=await db.PurchaseBills.CountAsync(x=>x.CompanyId==b.Id);
   var denied=await committer.CommitOneInvoiceAsync(b.Id,null,Invoice(prefix,foreignSupplier.Id),new());db.ChangeTracker.Clear();
   if(denied.Outcome!="failed"||await db.PurchaseBills.CountAsync(x=>x.CompanyId==b.Id)!=before)throw new Exception("Foreign supplier was not refused atomically");
   Console.WriteLine("PASS: foreign supplier reference rejected without creating a bill.");
  } finally { db.ChangeTracker.Clear();await db.ItemTypes.Where(t=>t.HSCode!=null&&t.HSCode.StartsWith(prefix)).ExecuteUpdateAsync(s=>s.SetProperty(t=>t.HSCode,(string?)null)); }
  async Task AssertImported(FbrImportCommitInvoiceResult result,int typeId) {
   if(result.Outcome!="imported")throw new Exception("Scoped import failed: "+result.ErrorMessage);
   var items=await db.PurchaseItems.AsNoTracking().Where(i=>i.PurchaseBillId==result.CreatedPurchaseBillId).ToListAsync();
   var moves=await db.StockMovements.AsNoTracking().Where(m=>m.CompanyId==b.Id&&m.SourceId==result.CreatedPurchaseBillId).ToListAsync();
   if(items.Count!=1||items[0].ItemTypeId!=typeId||moves.Count!=1||moves[0].ItemTypeId!=typeId||moves[0].Quantity!=2.5m)throw new Exception("Imported item/stock provenance differs");
  }
 }
}


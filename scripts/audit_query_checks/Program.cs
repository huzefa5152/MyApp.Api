using System.Data.Common;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Services.Queries;

var counter = new QueryCounter();
var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseSqlServer("Server=.\\MSSQLSERVER02;Database=MyApp_Audit_20260930;Trusted_Connection=True;TrustServerCertificate=True")
    .AddInterceptors(counter).Options;
await using var db = new AppDbContext(options);
await using var tx = await db.Database.BeginTransactionAsync();
var company = new Company { Name = "Audit query sample" };
var other = new Company { Name = "Audit query other" };
var buyer = new Client { Name = "Sample buyer", Company = company };
var otherBuyer = new Client { Name = "Sample other buyer", Company = other };
var type = new ItemType { Name = "Audit query item" + Guid.NewGuid().ToString("N"), HSCode = null };
var unknown = new ItemType { Name = "Audit query unused" + Guid.NewGuid().ToString("N"), HSCode = null };
db.AddRange(company, other, buyer, otherBuyer, type, unknown);
await db.SaveChangesAsync();
void Bill(Company c, Client client, int number, DateTime date, decimal price, string desc, int documentType=1, bool demo=false, bool cancelled=false) =>
 db.Invoices.Add(new Invoice { CompanyId=c.Id,ClientId=client.Id,InvoiceNumber=number,Date=date,DocumentType=documentType,IsDemo=demo,IsCancelled=cancelled,
 Items=[new InvoiceItem { ItemTypeId=type.Id,Description=desc,Quantity=1,UnitPrice=price,LineTotal=price }] });
Bill(company,buyer,1,new(2000,1,1),1m,"prior");
Bill(company,buyer,2,new(2000,2,1),14.123456789012m,"fallback");
Bill(company,buyer,3,new(2001,1,1),900m,"fallback",demo:true);
Bill(company,buyer,4,new(2001,2,1),901m,"fallback",cancelled:true);
Bill(company,buyer,5,new(2001,3,1),902m,"fallback",documentType:9);
Bill(company,buyer,6,new(2001,4,1),903m,"fallback",documentType:10);
Bill(other,otherBuyer,1,new(2002,1,1),904m,"fallback");
var challan = new DeliveryChallan { CompanyId=company.Id,ClientId=buyer.Id,ChallanNumber=1,Items=Enumerable.Range(0,100).Select(_=>new DeliveryItem { ItemTypeId=type.Id,Description="fallback",Quantity=1,Unit="PCS" }).ToList() };
db.Add(challan); await db.SaveChangesAsync();
var cid=company.Id;var oid=other.Id;var tid=type.Id;var uid=unknown.Id;var dcid=challan.Id;
db.ChangeTracker.Clear();counter.Count=0;
var before=await LegacyLastRateQuery.ExecuteAsync(db,cid,dcid);var beforeCount=counter.Count;
db.ChangeTracker.Clear();counter.Count=0;
var after=await ChallanLastRateQuery.ExecuteAsync(db,cid,dcid);var afterCount=counter.Count;
void Check(bool ok,string message) { if(!ok)throw new Exception(message); }
Check(JsonSerializer.Serialize(before)==JsonSerializer.Serialize(after),"Repeated-type results differ from master");
Check(beforeCount==101 && afterCount==2,"Expected 101 -> 2 SELECT commands");
Check(after.All(r=>r.LastUnitPrice==14.123456789012m && r.MatchedBy=="ItemType"),"Scope, ordering, or excluded-document behavior changed");
Check(db.ChangeTracker.Entries().Count()==0,"Read query must not track an entity graph");
Console.WriteLine($"PASS: 100 repeated lines, identical output; SQL commands {beforeCount} -> {afterCount}.");
foreach(var row in await db.DeliveryItems.Where(i=>i.DeliveryChallanId==dcid).ToListAsync()) { row.ItemTypeId=row.Id%2==0?uid:null; row.Description=row.Id%3==0?"missing":row.Id%3==1?"FALLBACK":"fallback"; }
await db.SaveChangesAsync();db.ChangeTracker.Clear();counter.Count=0;
before=await LegacyLastRateQuery.ExecuteAsync(db,cid,dcid);beforeCount=counter.Count;db.ChangeTracker.Clear();counter.Count=0;
after=await ChallanLastRateQuery.ExecuteAsync(db,cid,dcid);afterCount=counter.Count;
Check(JsonSerializer.Serialize(before)==JsonSerializer.Serialize(after),"Description fallback or missing results differ");
Check(afterCount==4,"One challan, one missing type, two distinct normalized descriptions");
Check((await ChallanLastRateQuery.ExecuteAsync(db,oid,dcid)).Count==0,"Cross-company challan returned data");
Check((await ChallanLastRateQuery.ExecuteAsync(db,cid,-1)).Count==0,"Missing challan changed");
Console.WriteLine($"PASS: mixed fallback/misses, decimal prices, notes/demo/cancelled and tenant filters; SQL commands {beforeCount} -> {afterCount}.");
await tx.RollbackAsync();
await tx.DisposeAsync();
db.ChangeTracker.Clear();
await ImportBatchChecks.RunAsync(options, counter);
public class QueryCounter : DbCommandInterceptor {
 public int Count;
 public bool FailStockWrite;
 public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,CommandEventData eventData,InterceptionResult<DbDataReader> result,CancellationToken ct=default) { Count++; if(FailStockWrite && command.CommandText.Contains("[StockMovements]") && (command.CommandText.Contains("INSERT") || command.CommandText.Contains("MERGE"))) throw new InvalidOperationException("Synthetic stock-write failure"); return ValueTask.FromResult(result); }
}

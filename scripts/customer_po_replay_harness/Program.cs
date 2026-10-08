using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Services.Implementations;

if(args.Length<2) throw new Exception("Usage: replay <private archive directory> <local SQL connection>");
var connection = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(args[1]);
if(connection.DataSource != @".\MSSQLSERVER02" && connection.DataSource != "localhost") throw new Exception("Local SQL only");
var json = new JsonSerializerOptions { PropertyNameCaseInsensitive=true };
var formats=JsonSerializer.Deserialize<List<POFormat>>(File.ReadAllText(Path.Combine(args[0],"formats.json")),json)!;
var archives=JsonSerializer.Deserialize<List<Archive>>(File.ReadAllText(Path.Combine(args[0],"archives.json")),json)!;
using var db=new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(args[1]).Options);
var parser=new RuleBasedPOParser(NullLogger<RuleBasedPOParser>.Instance);
var fingerprint=new POFormatFingerprintService();
var registry=new POFormatRegistry(db,fingerprint,new RegressionService(db,parser,fingerprint,NullLogger<RegressionService>.Instance),NullLogger<POFormatRegistry>.Instance);
var extractor=new POParserService();
var results=new List<object>(); int success=0,missing=0,nonPdf=0,regressions=0,known=0;var covered=new HashSet<int>();
foreach(var archive in archives)
{
 var file=Path.Combine(args[0],archive.Id+Path.GetExtension(archive.OriginalFileName).ToLowerInvariant());
 if(!File.Exists(file)){missing++;continue;}
 if(Path.GetExtension(file)!=".pdf"){nonPdf++;continue;}
 try {
  using var stream=File.OpenRead(file);var text=extractor.ExtractTextFromPdf(stream);
  var oldMatch=await registry.FindMatchAsync(text,archive.CompanyId);
  var client=formats.FirstOrDefault(f=>f.Id==archive.MatchedFormatId)?.ClientId;
  var match=await registry.FindCustomerMatchAsync(text,archive.CompanyId,client);
  var oldItems=oldMatch==null?null:parser.Parse(text,oldMatch.Format).Items;
  var newItems=match==null?null:parser.Parse(text,match.Format).Items;
  var changed=JsonSerializer.Serialize(oldItems)!=JsonSerializer.Serialize(newItems);
  if(changed && archive.ParseOutcome=="ok")regressions++;
  if(archive.ParseOutcome=="ok" && (newItems?.Count??0)>=archive.ItemsExtracted){success++;if(match!=null)covered.Add(match.Format.Id);}
  else if(archive.ParseOutcome=="ok") known++;
  results.Add(new { archive.Id,archive.CompanyId,archive.ParseOutcome,archive.ItemsExtracted,expectedFormat=archive.MatchedFormatId,format=match?.Format.Id,count=newItems?.Count??0,changed });
 }catch(Exception ex){results.Add(new {archive.Id,error=ex.GetType().Name});if(archive.ParseOutcome=="ok")regressions++;}
}
int retained=0, smoke=0;
foreach(var format in formats)
{
 var stored=await db.POFormats.AsNoTracking().SingleAsync(f=>f.Id==format.Id);
 if(stored.RuleSetJson!=format.RuleSetJson || stored.SignatureHash!=format.SignatureHash) throw new Exception("Local format differs from downloaded production format: "+format.Id);
 retained++;
 if(!covered.Contains(format.Id))
 {
  var rules=JsonDocument.Parse(format.RuleSetJson).RootElement;
  string Header(string key)=>rules.TryGetProperty(key,out var p)?p.GetString()??"":"";
  var sample=Header("descriptionHeader").PadRight(40)+Header("quantityHeader").PadRight(15)+Header("unitHeader")+"\n"+"Sample fitting".PadRight(40)+"12".PadRight(15)+"Nos";
  var lines=parser.Parse(sample,format).Items;
  if(lines.Count!=1 || lines[0].Quantity!=12) throw new Exception("Unused saved format smoke failed: "+format.Id);
  smoke++;
 }
}
Console.WriteLine($"Production formats unchanged {retained}/{formats.Count}; formats without historical examples smoke-tested {smoke}");
File.WriteAllText(Path.Combine(args[0],"replay-results.json"),JsonSerializer.Serialize(results));
Console.WriteLine($"Archives {archives.Count}; successful historical replays {success}; existing historical mismatches {known}; missing {missing}; images {nonPdf}; changed extraction {regressions}; formats exercised {covered.Count}/{formats.Count}");
return regressions==0?0:1;
record Archive(int Id,int CompanyId,string OriginalFileName,string ParseOutcome,int? MatchedFormatId,int ItemsExtracted);

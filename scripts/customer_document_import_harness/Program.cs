using ClosedXML.Excel;
using MyApp.Api.Helpers;

int count = 0;
void Check(bool value, string name) { if (!value) throw new Exception(name); count++; }
void Refuses(Action action, string name) { try { action(); } catch (InvalidOperationException) { count++; return; } throw new Exception(name); }
using var workbook = new XLWorkbook();
var sheet = workbook.AddWorksheet("Demand");
sheet.Cell(1, 1).Value = "Customer demand";
string[] headings = ["Code", "Description", "Quantity", "UOM", "Rate", "Remarks"];
for (int c = 0; c < headings.Length; c++) sheet.Cell(3, c + 1).Value = headings[c];
sheet.Cell(4, 1).Value = "0001"; sheet.Cell(4, 2).Value = "Fitting 1/2 inch"; sheet.Cell(4, 3).Value = 12.5;
sheet.Cell(4, 4).Value = "KG"; sheet.Cell(4, 5).Value = 23.45; sheet.Cell(4, 6).Value = "Urgent";
sheet.Cell(5, 2).Value = "Pipe"; sheet.Cell(5, 3).Value = 100; sheet.Cell(5, 4).Value = "Mtr";
var map = new CustomerWorkbookMapping { Sheet = "Demand", HeaderRow = 3, DescriptionColumn = 2, QuantityColumn = 3, UnitColumn = 4, RateColumn = 5, RemarksColumn = 6, ItemCodeColumn = 1, Headers = headings };
var result = CustomerWorkbookReader.Parse(workbook, map);
Check(result.Items.Count == 2, "row count"); Check(result.Items[0].Description == "Fitting 1/2 inch", "numbers stay in description");
Check(result.Items[0].Quantity == 12.5m, "decimal quantity"); Check(result.Items[0].Unit == "KG", "source unit");
Check(result.Items[0].UnitPrice == 23.45m, "source price"); Check(result.Items[1].UnitPrice == null, "unpriced remains pending");
Check(result.Items[0].Remarks == "Urgent", "remarks"); Check(result.Items[0].ItemCode == "0001", "item code preserves leading zeroes"); Check(result.Warnings.Count == 0, "clean input");
sheet.Cell(6,2).Value = "Missing quantity";
sheet.Cell(7,2).Value = "Negative"; sheet.Cell(7,3).Value = -1;
sheet.Cell(8,3).Value = 5;
sheet.Cell(9,2).Value = "Invalid rate"; sheet.Cell(9,3).Value = 2; sheet.Cell(9,5).Value = "unknown";
result = CustomerWorkbookReader.Parse(workbook,map);
Check(result.Items.Count == 3, "invalid rows excluded with warning"); Check(result.Warnings.Count == 4, "every rejected row warned");
Check(result.Warnings[0].Contains("6"), "source row identified"); Check(result.Items[2].UnitPrice == null, "invalid price not invented");
map.QuantityColumn = 2; Refuses(()=>CustomerWorkbookReader.Parse(workbook,map), "duplicate mappings"); map.QuantityColumn = 3;
sheet.Cell(3,2).Value = "Changed heading"; Refuses(()=>CustomerWorkbookReader.Parse(workbook,map), "saved layout mismatch"); sheet.Cell(3,2).Value = "Description";
map.Sheet="Missing"; Refuses(()=>CustomerWorkbookReader.Parse(workbook,map), "missing sheet");map.Sheet="Demand";
map.HeaderRow=0; Refuses(()=>CustomerWorkbookReader.Parse(workbook,map), "invalid header");map.HeaderRow=3;
map.DescriptionColumn=101; Refuses(()=>CustomerWorkbookReader.Parse(workbook,map), "column cap");map.DescriptionColumn=2;
using var stream = new MemoryStream();workbook.SaveAs(stream); stream.Position=0;
using var reopened=CustomerWorkbookReader.Open(stream); Check(reopened.Worksheets.Count==1,"real xlsx read");
if(args.Length>0) {
 using var sampleStream=File.OpenRead(args[0]);using var sample=CustomerWorkbookReader.Open(sampleStream);
 var demand=CustomerWorkbookReader.Parse(sample,new CustomerWorkbookMapping{Sheet="Sheet1",HeaderRow=3,DescriptionColumn=2,QuantityColumn=3,UnitColumn=4,RemarksColumn=5});
 Check(demand.Items.Count==33,"real demand 33 items");Check(demand.Items.Count(i=>i.Quantity==12)==22,"real demand quantities");Check(demand.Items.Count(i=>i.Unit=="Mtr")==1,"real demand metre unit");
}

var emailTable = CustomerEmailTextReader.Parse("Dear Vendor\nSR #\tPR #\tItem Description\tUOM\tQty\n1\t900001\tBolt M20 x 70 mm\tNOS\t50\n2\t900001\tSeal 50X72X8\tNOS\t12\nRegards\nSample Buyer");
Check(emailTable.Items.Count==2,"email tabular rows");Check(emailTable.Items[0].Quantity==50,"email quantity not size");Check(emailTable.Items[1].Description=="Seal 50X72X8","email dimensions preserved");Check(emailTable.PONumber=="900001","email reference");Check(emailTable.Items.All(i=>i.UnitPrice==null),"email missing prices pending");
var vertical=CustomerEmailTextReader.Parse("Particular\nQty\n1\nPipe Length 16 ft\n22 no\n2\nJ Bolt 16 mm x 160 mm\n300 no\nProcurement Officer\nTel: 123456");
Check(vertical.Items.Count==2,"vertical email rows");Check(vertical.Items[1].Quantity==300,"vertical quantity");
var list=CustomerEmailTextReader.Parse("Dear Sir\nPlease quote\n1. Valve 3 inch - 4 Pcs\n2. Cable\nRegards\nProcurement Officer");
Check(list.Items.Count==2,"email list ignores signature");Check(list.Items[0].Quantity==4,"email list explicit quantity");Check(list.Items[1].Quantity==0,"email missing quantity never guessed");
Check(CustomerEmailTextReader.Parse("Dear Sir\nPlease share your rates\nRegards\nSample Buyer\nPhone 123456").Items.Count==0,"prose never imported as items");
var blankSerial=CustomerEmailTextReader.Parse("\tParticular\tQty\n1\tPipe 16 ft\t22 no\n2\tBolt 16 mm\t300 no");
Check(blankSerial.Items.Count==2 && blankSerial.Items[1].Quantity==300,"blank serial header clipboard");
var priced=CustomerEmailTextReader.Parse("Item\tQty\tUnit\tBrand\tRate\nValve 3 inch\t4\tPcs\tSample Make\t1,200.50");
Check(priced.Items.Single().UnitPrice==1200.50m,"email supplied price");Check(priced.Items.Single().Remarks?.Contains("Sample Make")==true,"brand retained");
var badQty=CustomerEmailTextReader.Parse("Item\tQty\tUnit\nValve\tunknown\tPcs");
Check(badQty.Items.Single().Quantity==0 && badQty.Warnings.Count>1,"invalid table quantity blocks creation");

foreach(var columns in new[]{new[]{"Item Name","Required Qty","Unit of Measure"},new[]{"Qty","Material Description","UOM"},new[]{"Unit","Quantity","Product"}}) {
 var values=columns.Select(h=>h is "Item Name" or "Material Description" or "Product" ? "Valve 3 inch 2026 model" : h is "Required Qty" or "Qty" or "Quantity" ? "12.5" : "KG");
 var generic=CustomerEmailTextReader.Parse(string.Join("\t",columns)+"\n"+string.Join("\t",values));
 Check(generic.Items.Count==1 && generic.Items[0].Quantity==12.5m && generic.Items[0].Unit=="KG","generic reordered aliases");
 Check(generic.Items[0].Description=="Valve 3 inch 2026 model","generic dimensions preserved");
}
var wrapped=CustomerEmailTextReader.Parse("SR #\nDescription\nUOM\nQty\n1\nIndustrial valve\nwith flange 3 inch\nNos\n4\nRegards");
Check(wrapped.Items.Single().Description=="Industrial valve with flange 3 inch" && wrapped.Items[0].Quantity==4,"wrapped vertical description");
Check(CustomerEmailTextReader.Parse("1. Pipe Length 16 ft").Items.Single().Quantity==0,"dimension-only list does not invent quantity");
var starred=CustomerEmailTextReader.Parse("* Nut M20 - 10 Pcs\n* Bolt M20 - 5 Nos\nRegards");
Check(starred.Items.Count==2 && starred.Items[0].Quantity==10,"generic star bullets");
if(args.Length>1) {
 var counts=new[]{14,5,9};
 var quantities=new[]{new decimal[]{60,4,14,6,100,12,12,12,12,12,200,10,2,12},new decimal[]{23,27,8,5,5},new decimal[]{22,300,80,50,6,12,12,12,4}};
 for(int i=0;i<3;i++) {
  var email=CustomerEmailTextReader.Parse(File.ReadAllText(Path.Combine(args[1],$"email-{i}.txt")));
  Check(email.Items.Select(x=>x.Quantity).SequenceEqual(quantities[i]),$"private email {i+1} every quantity");
  Check(email.Items.Count==counts[i],$"private email {i+1} count");
  Check(email.Items.All(x=>x.Quantity>0 && x.UnitPrice==null),$"private email {i+1} quantities and pending prices");
  if(i==0) Check(email.Items[0].Quantity==60 && email.Items[12].Unit=="FEET","private PR quantities and units");
  if(i==1) Check(email.PONumber?.Split(", ").Length==2 && email.Items[1].Quantity==27,"private multiple indents");
  if(i==2) Check(email.Items[0].Quantity==22 && email.Items[8].Quantity==4,"private requirement quantities");
 }
}
Console.WriteLine($"{count}/{count} checks passed");

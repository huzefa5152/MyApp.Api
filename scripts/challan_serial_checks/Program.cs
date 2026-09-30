using System.Reflection;
using System.Text.Json;
using ClosedXML.Excel;
using Microsoft.Extensions.Logging.Abstractions;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Helpers;

var repo = DispatchProxy.Create<IDeliveryChallanRepository, ChallanProxy>();
var proxy = (ChallanProxy)(object)repo;
var service = new DeliveryChallanService(repo, null!, null!, null!, NullLogger<DeliveryChallanService>.Instance);
var checks = 0;
void Check(bool ok, string message) { checks++; if (!ok) throw new Exception(message); }
foreach (var count in new[] { 0, 1, 5, 100 }) {
    proxy.Challan = new DeliveryChallan { Items = Enumerable.Range(1, count).Select(n => new DeliveryItem { Id = count - n + 1, Description = $"Line {n}", Quantity = n + 0.5m, Unit = "KG" }).ToList() };
    var dto = (await service.GetPrintDataAsync(1))!;
    Check(dto.Items.Select(i => i.SerialNo).SequenceEqual(Enumerable.Range(1, count)), "One-based contiguous serial numbers, including long documents.");
    Check(dto.Items.Select(i => i.Description).SequenceEqual(proxy.Challan.Items.Select(i => i.Description)), "Preserve existing print order.");
    Check(dto.Items.Sum(i => i.Quantity) == proxy.Challan.Items.Sum(i => i.Quantity), "Never change quantities.");
    using var json = JsonDocument.Parse(JsonSerializer.Serialize(dto, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
    Check(json.RootElement.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("serialNo").GetInt32()).SequenceEqual(Enumerable.Range(1,count)), "Actual JSON serialNo casing.");
    var data = ExcelTemplateEngine.ChallanToDict(dto);
    var rows = (List<Dictionary<string,object?>>)data["items"]!;
    Check(rows.Select(i => (int)i["serialNo"]!).SequenceEqual(Enumerable.Range(1,count)), "Excel serials match print payload.");
    if(count==5) {
        using var book = new XLWorkbook(); var sheet = book.AddWorksheet("Challan");
        sheet.Cell("A1").Value = "{{#each items}}"; sheet.Cell("A2").Value = "{{this.serialNo}}"; sheet.Cell("B2").Value = "{{this.description}}"; sheet.Cell("A3").Value = "{{/each}}";
        ExcelTemplateEngine.Process(book,data);
        Check(sheet.Column(1).CellsUsed().Select(c=>c.GetString()).SequenceEqual(new[]{"1","2","3","4","5"}), "Excel loop renders 1 through 5.");
    }
}
proxy.Challan = null;
Check(await service.GetPrintDataAsync(1) == null, "Missing challan remains missing.");
Console.WriteLine($"PASS: {checks} challan serial-number checks.");
public class ChallanProxy : DispatchProxy {
    public DeliveryChallan? Challan { get; set; }
    protected override object? Invoke(MethodInfo? method, object?[]? args) => method?.Name == "GetByIdAsync" ? Task.FromResult(Challan) : throw new NotSupportedException(method?.Name);
}

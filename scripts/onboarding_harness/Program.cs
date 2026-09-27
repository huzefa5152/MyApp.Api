// Offline harness for the onboarding import helpers: the row rules, the
// reader, and the sample / fix-list workbooks read back through the real
// reader. No database, no server.
//
//   cd scripts/onboarding_harness && dotnet run -c Release
using ClosedXML.Excel;
using MyApp.Api.Helpers.ExcelImport;
using MyApp.Api.Helpers.Onboarding;

var passed = 0;
var failed = new List<string>();
void Check(string label, bool ok, string detail = "")
{
    if (ok) passed++;
    else { failed.Add($"{label} {detail}"); Console.WriteLine($"  FAIL {label} {detail}"); }
}

var ctx = new RuleContext(
    new Dictionary<string, int> { ["Punjab"] = 7, ["Sindh"] = 8, ["Islamabad"] = 11 },
    new[] { "Registered", "Unregistered", "FTN", "CNIC" });

ParsedRow Row(params (string k, string v)[] cells) =>
    new(3, cells.ToDictionary(c => c.k, c => c.v));

List<RowIssue> Rules(string sheet, params (string k, string v)[] cells) =>
    OnboardingRowRules.Check(sheet, Row(cells), ctx);

bool HasError(List<RowIssue> issues, string column, string fragment) =>
    issues.Any(i => i.IsError && i.Column == column && i.Message.Contains(fragment, StringComparison.OrdinalIgnoreCase));

bool HasWarning(List<RowIssue> issues, string column, string fragment) =>
    issues.Any(i => !i.IsError && i.Column == column && i.Message.Contains(fragment, StringComparison.OrdinalIgnoreCase));

Console.WriteLine("Rules — customers");
var good = Rules(OnboardingSheets.Customers, ("name", "Acme"), ("registrationType", "registered"),
    ("ntn", "1234567-8"), ("province", "sindh"), ("address", "Karachi"));
Check("valid Registered customer has no issues", good.Count == 0, string.Join("; ", good.Select(i => i.Message)));
Check("empty name is required", HasError(Rules(OnboardingSheets.Customers, ("registrationType", "Unregistered"), ("province", "Sindh"), ("address", "x")), "Name", "required"));
Check("Registered without NTN errors", HasError(Rules(OnboardingSheets.Customers, ("name", "A"), ("registrationType", "Registered"), ("province", "Sindh"), ("address", "x")), "NTN", "required for a Registered customer"));
Check("FTN without NTN errors", HasError(Rules(OnboardingSheets.Customers, ("name", "A"), ("registrationType", "FTN"), ("province", "Sindh"), ("address", "x")), "NTN", "required"));
Check("Unregistered without NTN is fine", !Rules(OnboardingSheets.Customers, ("name", "A"), ("registrationType", "Unregistered"), ("province", "Sindh"), ("address", "x")).Any(i => i.IsError));
Check("6-digit NTN errors", HasError(Rules(OnboardingSheets.Customers, ("name", "A"), ("registrationType", "Registered"), ("ntn", "123456"), ("province", "Sindh")), "NTN", "7 digits"));
Check("13-digit NTN says it is a CNIC", HasError(Rules(OnboardingSheets.Customers, ("name", "A"), ("registrationType", "Registered"), ("ntn", "4210112345671"), ("province", "Sindh")), "NTN", "CNIC column"));
Check("CNIC type without CNIC errors", HasError(Rules(OnboardingSheets.Customers, ("name", "A"), ("registrationType", "CNIC"), ("province", "Sindh")), "CNIC", "required for a CNIC customer"));
Check("12-digit CNIC errors", HasError(Rules(OnboardingSheets.Customers, ("name", "A"), ("registrationType", "Unregistered"), ("cnic", "42101-123456-1"), ("province", "Sindh")), "CNIC", "13 digits"));
Check("dashed 13-digit CNIC is fine", !Rules(OnboardingSheets.Customers, ("name", "A"), ("registrationType", "CNIC"), ("cnic", "42101-1234567-1"), ("province", "Sindh"), ("address", "x")).Any());
Check("unknown registration type errors", HasError(Rules(OnboardingSheets.Customers, ("name", "A"), ("registrationType", "Company"), ("province", "Sindh")), "Registration Type", "not one of"));
Check("unknown province errors", HasError(Rules(OnboardingSheets.Customers, ("name", "A"), ("registrationType", "Unregistered"), ("province", "Karachi")), "Province", "not one of"));
Check("customer province is required", HasError(Rules(OnboardingSheets.Customers, ("name", "A"), ("registrationType", "Unregistered")), "Province", "required"));
Check("STRN on Unregistered warns", HasWarning(Rules(OnboardingSheets.Customers, ("name", "A"), ("registrationType", "Unregistered"), ("strn", "1234567890123"), ("province", "Sindh"), ("address", "x")), "STRN", "not be stored"));
Check("empty address warns", HasWarning(Rules(OnboardingSheets.Customers, ("name", "A"), ("registrationType", "Unregistered"), ("province", "Sindh")), "Address", "empty"));

Console.WriteLine("Rules — suppliers");
Check("supplier province is optional", !Rules(OnboardingSheets.Suppliers, ("name", "S"), ("registrationType", "Unregistered")).Any(i => i.IsError));
Check("supplier empty address does not warn", !Rules(OnboardingSheets.Suppliers, ("name", "S"), ("registrationType", "Unregistered")).Any());
Check("supplier Registered without NTN errors", HasError(Rules(OnboardingSheets.Suppliers, ("name", "S"), ("registrationType", "Registered")), "NTN", "required for a Registered supplier"));

Console.WriteLine("Rules — items");
Check("item with HS code is fine", !Rules(OnboardingSheets.Items, ("name", "Valve"), ("hsCode", "8481.8090")).Any());
Check("item without HS code warns", HasWarning(Rules(OnboardingSheets.Items, ("name", "Valve")), "HS Code", "cannot be filed"));
Check("malformed HS code errors", HasError(Rules(OnboardingSheets.Items, ("name", "Valve"), ("hsCode", "84-81")), "HS Code", "8481.8090"));
Check("unknown sale type errors", HasError(Rules(OnboardingSheets.Items, ("name", "Valve"), ("hsCode", "8481.8090"), ("saleType", "Standard")), "Sale Type", "not a sale type"));
Check("sale type is case-insensitive", !Rules(OnboardingSheets.Items, ("name", "Valve"), ("hsCode", "8481.8090"), ("saleType", "exempt goods")).Any());
Check("HS 84818090 normalises", OnboardingRowRules.NormaliseHsCode("84818090") == "8481.8090");
Check("HS 8481.809 (number lost its zero) normalises", OnboardingRowRules.NormaliseHsCode("8481.809") == "8481.8090");
Check("HS 8481.8090 unchanged", OnboardingRowRules.NormaliseHsCode(" 8481.8090 ") == "8481.8090");
Check("blank sale type resolves to the default", OnboardingRowRules.ResolveSaleType("") == OnboardingSchema.DefaultSaleType);

Console.WriteLine("Rules — opening stock");
Check("valid opening row", !Rules(OnboardingSheets.OpeningStock, ("itemName", "Valve"), ("quantity", "10"), ("asOfDate", "2026-07-01")).Any());
Check("zero quantity errors", HasError(Rules(OnboardingSheets.OpeningStock, ("itemName", "Valve"), ("quantity", "0"), ("asOfDate", "2026-07-01")), "Quantity", "more than 0"));
Check("text quantity errors", HasError(Rules(OnboardingSheets.OpeningStock, ("itemName", "Valve"), ("quantity", "ten"), ("asOfDate", "2026-07-01")), "Quantity", "not a number"));
Check("bad date errors", HasError(Rules(OnboardingSheets.OpeningStock, ("itemName", "Valve"), ("quantity", "1"), ("asOfDate", "yesterday")), "As Of Date", "not a date"));
Check("dd-MM-yyyy date parses", OnboardingRowRules.ParseDate("01-07-2026") == new DateTime(2026, 7, 1));

Console.WriteLine("NTN normalisation");
Check("7 digits kept", OnboardingRowRules.NormaliseNtn("1234567") == "1234567");
Check("check digit dropped", OnboardingRowRules.NormaliseNtn("1234567-8") == "1234567");
Check("13 digits refused", OnboardingRowRules.NormaliseNtn("4210112345671") == null);

Console.WriteLine("Sample workbook round trip");
var lists = new SampleLists(new[] { "Punjab", "Sindh" }, new[] { "Registered", "Unregistered", "FTN", "CNIC" }, new[] { "Pcs", "KG" });
var all = OnboardingSheets.ImportOrder;
var bytes = OnboardingSampleWorkbook.BuildSample(all, lists, "Test Traders");
using (var xl = new XLWorkbook(new MemoryStream(bytes)))
{
    Check("Start Here is first", xl.Worksheet(1).Name == "Start Here");
    Check("Lists sheet is hidden", xl.Worksheet("Lists").Visibility == XLWorksheetVisibility.Hidden);
    foreach (var s in OnboardingSchema.Sheets)
    {
        Check($"{s.Title} sheet present", xl.Worksheets.Contains(s.Title));
        var ws = xl.Worksheet(s.Title);
        Check($"{s.Title} rows 1-2 frozen", ws.SheetView.SplitRow == 2);
        var listCols = s.Columns.Select((c, i) => (c, i)).Where(x => x.c.List != ListSource.None).ToList();
        foreach (var (c, i) in listCols)
        {
            var cell = ws.Cell(OnboardingSchema.FirstDataRow, i + 1);
            Check($"{s.Title}.{c.Heading} has a dropdown", cell.HasDataValidation);
        }
        var idCols = s.Columns.Select((c, i) => (c, i)).Where(x => x.c.Kind == ColumnKind.Identifier);
        foreach (var (c, i) in idCols)
            Check($"{s.Title}.{c.Heading} is text-formatted", ws.Cell(OnboardingSchema.FirstDataRow, i + 1).Style.NumberFormat.Format == "@");
        var req = s.Columns.First(c => c.Requirement == Requirement.Required);
        Check($"{s.Title} required heading carries *", ws.Cell(1, s.Columns.ToList().IndexOf(req) + 1).GetString().EndsWith("*"));
    }
}
using (var wb = new ClosedXmlImportedWorkbook(new MemoryStream(bytes)))
{
    var parsed = OnboardingWorkbookReader.Read(wb, all);
    foreach (var s in OnboardingSchema.Sheets)
    {
        var p = parsed[s.Key];
        Check($"{s.Title} read: present", p.Present);
        Check($"{s.Title} read: every heading found", p.MissingHeadings.Count == 0, string.Join(",", p.MissingHeadings));
        Check($"{s.Title} read: help row is not data", p.Rows.Count == 0, $"got {p.Rows.Count}");
    }
}

var onlyCustomers = OnboardingSampleWorkbook.BuildSample(new[] { OnboardingSheets.Customers }, lists);
using (var xl = new XLWorkbook(new MemoryStream(onlyCustomers)))
{
    Check("only the chosen sheet", xl.Worksheets.Contains("Customers") && !xl.Worksheets.Contains("Items") && !xl.Worksheets.Contains("Suppliers"));
}

Console.WriteLine("Reader on a filled workbook");
using (var xl = new XLWorkbook(new MemoryStream(bytes)))
{
    var ws = xl.Worksheet("Customers");
    // Swap two columns' headings to prove columns are found by heading.
    var nameCol = 1; var phoneCol = OnboardingSchema.Find("customers")!.Columns.ToList().FindIndex(c => c.Key == "phone") + 1;
    ws.Cell(1, nameCol).SetValue("Phone");
    ws.Cell(1, phoneCol).SetValue("  customer NAME ");
    ws.Cell(3, nameCol).SetValue("021-111");
    ws.Cell(3, phoneCol).SetValue("Moved Co");
    ws.Cell(3, 2).SetValue("CNIC");
    ws.Cell(3, 4).Style.NumberFormat.Format = "General";
    ws.Cell(3, 4).SetValue(4210112345671d);
    ws.Cell(5, phoneCol).SetValue("After a blank row");
    var st = xl.Worksheet("Opening Stock");
    st.Cell(3, 1).SetValue("Valve");
    st.Cell(3, 3).SetValue(12.5);
    st.Cell(3, 4).SetValue(new DateTime(2026, 7, 1));
    var ms = new MemoryStream(); xl.SaveAs(ms); ms.Position = 0;
    using var wb = new ClosedXmlImportedWorkbook(ms);
    var parsed = OnboardingWorkbookReader.Read(wb, all);
    var cust = parsed["customers"];
    Check("two rows read, blank row skipped", cust.Rows.Count == 2, $"got {cust.Rows.Count}");
    Check("name found under a moved, re-cased heading", cust.Rows[0].Get("name") == "Moved Co", cust.Rows[0].Get("name"));
    Check("phone found where name used to be", cust.Rows[0].Get("phone") == "021-111");
    Check("row number is the sheet row", cust.Rows[1].RowNumber == 5);
    Check("CNIC typed as a number reads as digits", cust.Rows[0].Get("cnic") == "4210112345671", cust.Rows[0].Get("cnic"));
    var os = parsed["openingStock"];
    Check("quantity reads as a number", os.Rows[0].Get("quantity") == "12.5", os.Rows[0].Get("quantity"));
    Check("date reads as yyyy-MM-dd", os.Rows[0].Get("asOfDate") == "2026-07-01", os.Rows[0].Get("asOfDate"));
    Check("empty sheet has no rows", parsed["items"].Rows.Count == 0);
}

Console.WriteLine("Missing heading");
using (var xl = new XLWorkbook(new MemoryStream(bytes)))
{
    xl.Worksheet("Items").Cell(1, 1).SetValue("Something else");
    xl.Worksheet("Items").Cell(3, 2).SetValue("8481.8090");
    var ms = new MemoryStream(); xl.SaveAs(ms); ms.Position = 0;
    using var wb = new ClosedXmlImportedWorkbook(ms);
    var p = OnboardingWorkbookReader.Read(wb, new[] { "items" })["items"];
    Check("missing required heading reported", p.MissingHeadings.Contains("Item Name"));
    Check("missing heading produces a sheet warning", p.Warnings.Any(w => w.Contains("Item Name")));
}

Console.WriteLine("Absent sheet");
using (var wb = new ClosedXmlImportedWorkbook(new MemoryStream(onlyCustomers)))
{
    var p = OnboardingWorkbookReader.Read(wb, all);
    Check("items not present in a customers-only file", !p["items"].Present);
}

Console.WriteLine("Fix list round trip");
var fix = OnboardingSampleWorkbook.BuildFixList(new[]
{
    new FixListSheet("customers", new[]
    {
        new FixListRow(new Dictionary<string, string> { ["name"] = "=HYPERLINK(\"x\")", ["registrationType"] = "Registered", ["province"] = "Sindh" }, "NTN: required"),
        new FixListRow(new Dictionary<string, string> { ["name"] = "Second", ["registrationType"] = "CNIC" }, "CNIC: required"),
    }),
});
using (var xl = new XLWorkbook(new MemoryStream(fix)))
{
    var ws = xl.Worksheet("Customers");
    // ClosedXML stores the guard's leading apostrophe as Excel's quote prefix:
    // the cell is text, never a formula.
    Check("formula neutralised in the fix list", !ws.Cell(3, 1).HasFormula && ws.Cell(3, 1).Style.IncludeQuotePrefix,
        $"{ws.Cell(3, 1).DataType} formula={ws.Cell(3, 1).HasFormula}");
    var errCol = OnboardingSchema.Find("customers")!.Columns.Count + 1;
    Check("error column carries the reason", ws.Cell(3, errCol).GetString() == "NTN: required");
}
using (var wb = new ClosedXmlImportedWorkbook(new MemoryStream(fix)))
{
    var p = OnboardingWorkbookReader.Read(wb, new[] { "customers" })["customers"];
    Check("fix list reads back its rows", p.Rows.Count == 2, $"got {p.Rows.Count}");
    Check("fix list has every heading", p.MissingHeadings.Count == 0);
}

Console.WriteLine("Sheet list parsing");
Check("null means every sheet", OnboardingSchema.ParseSheetList(null).SequenceEqual(OnboardingSheets.ImportOrder));
Check("order follows import order", OnboardingSchema.ParseSheetList("openingStock,customers,items").SequenceEqual(new[] { "items", "customers", "openingStock" }));
Check("unknown keys dropped", OnboardingSchema.ParseSheetList("customers,bogus").SequenceEqual(new[] { "customers" }));

Console.WriteLine();
Console.WriteLine($"{passed + failed.Count} checks, {failed.Count} failed");
return failed.Count == 0 ? 0 : 1;

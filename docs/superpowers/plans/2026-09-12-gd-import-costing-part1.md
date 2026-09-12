# GD Import Costing — Part 1: actual cost, loaded and maintainable

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load the actual landed cost of every existing stock position from the
clients' GD costing workbooks, and make that cost editable on the Opening
Balances screen.

**Architecture:** A pure costing calculator decodes the sheet's arithmetic; a
new `GdCosting` import layout reads the workbook through the existing
`ImportProfile` machinery; the commit writes `ActualCostExcludingTax` onto
existing `OpeningStockBalance` rows without moving any stock. A GD header
entity is created so later parts have a document to post against.

**Tech Stack:** .NET 9, EF Core 9, SQL Server, React 19 + Vite. Offline harness
is a standalone `net9.0` console linking the real helpers; the live suite is
Python against a running backend.

**Spec:** `docs/superpowers/specs/2026-09-12-gd-import-costing-design.md`
(commit `9fd3b8c`). This plan covers spec phases 1–3 only. Phases 4–5 (second
valuation pool, dashboard, adjustment dialog) and 6–7 (post stock, GL) get their
own plans.

## Global Constraints

- **Branch `feat/importer-ledger-receipts` only.** Never merge or port to
  `master`, `customize-solution-for-other` or `TraderFbrInvoicingSystem`.
- **Local database is `MyApp_Importer_Local`**, chosen by the branch. Never edit
  a connection string.
- **Never name a production database, SQL host, FTP host, login or token** in
  any tracked file. `python scripts/verify_no_production_identifiers.py` enforces it.
- **Never commit the client workbooks.** They are client data. The harness uses
  synthetic rows; a real file is passed by path at run time.
- Every controller action carries `[HasPermission("module.page.action")]`.
- Every endpoint taking a `companyId` calls `await _access.AssertAccessAsync(CurrentUserId, companyId)`.
- Every new permission Module is mapped in
  `myapp-frontend/src/config/permissionSections.js` in the same change;
  `python scripts/verify_permission_sections.py` enforces it.
- Money is `decimal(18,2)`; quantities `decimal(18,4)`; a per-unit cost `decimal(18,6)`.
- Tax rates are stored as a **PERCENTAGE** (18.00, 3.00, 6.00), matching
  `OpeningStockBalance.SalesTaxRate` and `Invoice.GSTRate`.
- Never return `ex.Message` to a client. Log it, return a generic message.
- Ask before every commit and every push. Never auto-restart the backend.
- Append a dated entry to `README.md`'s `## Changelog` before the final commit.

---

### Task 1: `ImportCostingCalculator` — the costing chain

The whole feature rests on this arithmetic. Pure, no database, no I/O — the same
shape as `Helpers/FurtherTaxCalculator.cs`.

**Files:**
- Create: `Helpers/ImportCostingCalculator.cs`
- Create: `scripts/gd_costing_harness/gd_costing_harness.csproj`
- Create: `scripts/gd_costing_harness/Program.cs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `readonly record struct ImportCostingInput(decimal AssessedValue, decimal CustomsDuty, decimal Acd, decimal RegulatoryDuty, decimal Others, decimal SalesTaxRate, decimal AstRate, decimal IncomeTaxRate, decimal AddOnProfit)` — all rates as percentages.
  - `readonly record struct ImportCosting(decimal Cost, decimal SalesTax, decimal Ast, decimal Subtotal, decimal IncomeTax, decimal InputTax, decimal SellingValue)`
  - `static ImportCosting ImportCostingCalculator.Compute(ImportCostingInput input)`

- [ ] **Step 1: Create the harness project**

`scripts/gd_costing_harness/gd_costing_harness.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <LangVersion>latest</LangVersion>
    <AssemblyName>gd_costing_harness</AssemblyName>
    <!-- Standalone offline harness — never part of the app build
         (MyApp.Api.csproj removes scripts/**/*.cs). -->
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="ClosedXML" Version="0.104.2" />
  </ItemGroup>
  <ItemGroup>
    <!-- Link the REAL calculator and mapping so the harness exercises the code
         that ships, not a copy. A ProjectReference is deliberately avoided: it
         would rebuild MyApp.Api and fail while the dev backend holds a lock on
         its apphost. -->
    <Compile Include="..\..\Helpers\ImportCostingCalculator.cs" />
  </ItemGroup>
</Project>
```

- [ ] **Step 2: Write the failing test**

`scripts/gd_costing_harness/Program.cs`:

```csharp
using MyApp.Api.Helpers;

var failures = new List<string>();
var checks = 0;

void Check(string name, decimal actual, decimal expected, decimal tolerance = 0.005m)
{
    checks++;
    if (Math.Abs(actual - expected) > tolerance)
        failures.Add($"{name}: expected {expected}, got {actual}");
}

// Alpha Traders GD KAPW-HC-8876 row 3 — SCREW DRIVER, the reference case.
// Every figure below is read off the client's own workbook.
{
    var r = ImportCostingCalculator.Compute(new ImportCostingInput(
        AssessedValue: 62490m, CustomsDuty: 0m, Acd: 0m, RegulatoryDuty: 0m,
        Others: 0m, SalesTaxRate: 18m, AstRate: 3m, IncomeTaxRate: 6m,
        AddOnProfit: 0m));

    Check("alpha.cost", r.Cost, 62490m);
    Check("alpha.salesTax", r.SalesTax, 11248.20m);
    Check("alpha.ast", r.Ast, 1874.70m);
    Check("alpha.subtotal", r.Subtotal, 75612.90m);
    Check("alpha.incomeTax", r.IncomeTax, 4536.77m);
    Check("alpha.inputTax", r.InputTax, 13122.90m);
    Check("alpha.sellingValue", r.SellingValue, 72905.00m);
}

// A line carrying every duty — Alpha row 9, so the Cost sum is exercised.
{
    var r = ImportCostingCalculator.Compute(new ImportCostingInput(
        105665m, 14085m, 2113m, 6340m, 0m, 18m, 3m, 6m, 0m));
    Check("duties.cost", r.Cost, 128203m);
    Check("duties.sellingValue", r.SellingValue, 149570.17m);
}

// Selling value is cost x (1 + ast/st). At 18/3 that is exactly 7/6.
{
    var r = ImportCostingCalculator.Compute(new ImportCostingInput(
        600000m, 0m, 0m, 0m, 0m, 18m, 3m, 6m, 0m));
    Check("ratio.sellingValue", r.SellingValue, 700000m);
}

// Add-on profit lands on top of the derived value, never inside it.
{
    var r = ImportCostingCalculator.Compute(new ImportCostingInput(
        600000m, 0m, 0m, 0m, 0m, 18m, 3m, 6m, 50000m));
    Check("addon.sellingValue", r.SellingValue, 750000m);
}

// Others enters the subtotal (and so income tax) but never the selling value:
// selling value derives from input tax, which derives from Cost alone.
{
    var r = ImportCostingCalculator.Compute(new ImportCostingInput(
        100000m, 0m, 0m, 0m, 5000m, 18m, 3m, 6m, 0m));
    Check("others.subtotal", r.Subtotal, 126000m);
    Check("others.incomeTax", r.IncomeTax, 7560.00m);
    Check("others.sellingValue", r.SellingValue, 116666.67m);
}

// A zero sales-tax rate cannot divide. Selling value falls back to cost plus
// add-on rather than throwing or returning zero.
{
    var r = ImportCostingCalculator.Compute(new ImportCostingInput(
        100000m, 0m, 0m, 0m, 0m, 0m, 0m, 6m, 2500m));
    Check("zerorate.salesTax", r.SalesTax, 0m);
    Check("zerorate.sellingValue", r.SellingValue, 102500m);
}

// No AST means no uplift: selling value is cost plus add-on.
{
    var r = ImportCostingCalculator.Compute(new ImportCostingInput(
        100000m, 0m, 0m, 0m, 0m, 18m, 0m, 6m, 0m));
    Check("noast.sellingValue", r.SellingValue, 100000m);
}

// A 25% line — PAK carries these, and the uplift must follow the rate.
{
    var r = ImportCostingCalculator.Compute(new ImportCostingInput(
        100000m, 0m, 0m, 0m, 0m, 25m, 3m, 6m, 0m));
    Check("rate25.sellingValue", r.SellingValue, 112000m);
}

Console.WriteLine($"{checks} checks, {failures.Count} failed");
foreach (var f in failures) Console.WriteLine("  FAIL " + f);
if (failures.Count > 0) return 1;
Console.WriteLine("GD COSTING HARNESS PASSED");
return 0;
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd scripts/gd_costing_harness && dotnet run -c Release
```

Expected: build error — `ImportCostingCalculator` does not exist.

- [ ] **Step 4: Write the calculator**

`Helpers/ImportCostingCalculator.cs`:

```csharp
namespace MyApp.Api.Helpers
{
    /// <summary>
    /// What a customs consignment line costs, and what it therefore has to sell
    /// for. The ONE place the GD costing chain is computed — pure, so it can be
    /// exercised offline by scripts/gd_costing_harness with no database.
    ///
    /// Read off the clients' own workbooks, whose formulas are the spec:
    ///
    ///     Cost      = AssessedValue + C.Duty + ACD + RD
    ///     SalesTax  = Cost x STRate
    ///     AST       = Cost x ASTRate
    ///     Subtotal  = Cost + SalesTax + AST + Others
    ///     IncomeTax = Subtotal x ITRate
    ///     InputTax  = SalesTax + AST
    ///     Selling   = InputTax / STRate + AddOnProfit
    ///
    /// The last line is the point of the whole exercise and is not an arbitrary
    /// markup: it reduces to Cost x (1 + ASTRate/STRate), which is the value at
    /// which the output sales tax on the eventual sale exactly absorbs the input
    /// tax paid at import. At the usual 18% / 3% that is a fixed x7/6.
    ///
    /// COST EXCLUDES all three taxes. Sales tax and AST are recoverable input
    /// tax; income tax at import is adjustable against the year's liability.
    /// The clients' own sheets confirm it — they compute Profit = Selling - Cost,
    /// with no tax term.
    ///
    /// Rates are PERCENTAGES (18.00, 3.00, 6.00), matching
    /// <see cref="Models.OpeningStockBalance.SalesTaxRate"/>. The workbooks write
    /// them three different ways; normalising that is the reader's job, not this
    /// one's.
    /// </summary>
    public static class ImportCostingCalculator
    {
        public readonly record struct ImportCostingInput(
            decimal AssessedValue,
            decimal CustomsDuty,
            decimal Acd,
            decimal RegulatoryDuty,
            decimal Others,
            decimal SalesTaxRate,
            decimal AstRate,
            decimal IncomeTaxRate,
            decimal AddOnProfit);

        public readonly record struct ImportCosting(
            decimal Cost,
            decimal SalesTax,
            decimal Ast,
            decimal Subtotal,
            decimal IncomeTax,
            decimal InputTax,
            decimal SellingValue);

        private static decimal Money(decimal v) =>
            Math.Round(v, 2, MidpointRounding.AwayFromZero);

        public static ImportCosting Compute(ImportCostingInput input)
        {
            var cost = Money(input.AssessedValue + input.CustomsDuty
                           + input.Acd + input.RegulatoryDuty);

            var st = Math.Max(0m, input.SalesTaxRate);
            var ast = Math.Max(0m, input.AstRate);
            var it = Math.Max(0m, input.IncomeTaxRate);

            var salesTax = Money(cost * st / 100m);
            var astAmount = Money(cost * ast / 100m);
            var subtotal = Money(cost + salesTax + astAmount + input.Others);
            var incomeTax = Money(subtotal * it / 100m);
            var inputTax = Money(salesTax + astAmount);

            // A zero sales-tax rate has nothing to divide by. Falling back to
            // cost is right rather than merely safe: with no output tax to
            // absorb, there is no tax-driven uplift, so the floor IS the cost.
            var sellingValue = st > 0m
                ? Money(inputTax * 100m / st) + Money(input.AddOnProfit)
                : cost + Money(input.AddOnProfit);

            return new ImportCosting(
                cost, salesTax, astAmount, subtotal, incomeTax, inputTax, sellingValue);
        }
    }
}
```

Note the `using MyApp.Api.Helpers;` in `Program.cs` reaches the nested record
structs because they are declared inside the static class — reference them as
`ImportCostingInput` after adding
`using static MyApp.Api.Helpers.ImportCostingCalculator;` at the top of
`Program.cs`.

- [ ] **Step 5: Add that using and run again**

Add to the top of `scripts/gd_costing_harness/Program.cs`:

```csharp
using static MyApp.Api.Helpers.ImportCostingCalculator;
```

```bash
cd scripts/gd_costing_harness && dotnet run -c Release
```

Expected: `GD COSTING HARNESS PASSED`, 15 checks, 0 failed.

- [ ] **Step 6: Confirm the app still builds**

```bash
dotnet build MyApp.Api.csproj
```

Expected: `0 Error(s)`. The harness must NOT appear in the app build.

- [ ] **Step 7: Commit**

```bash
git add Helpers/ImportCostingCalculator.cs scripts/gd_costing_harness
git commit -m "Add the GD import costing calculator" -- Helpers/ImportCostingCalculator.cs scripts/gd_costing_harness
```

---

### Task 2: `PercentRate` — one rate, written three ways

The three workbooks write the same rate as `0.18`, `3%` and `6`. Getting this
wrong is the §5b-3b trap that once understated tax by 115,270.18.

**Files:**
- Create: `Helpers/ExcelImport/PercentRate.cs`
- Modify: `scripts/gd_costing_harness/gd_costing_harness.csproj` (link it)
- Modify: `scripts/gd_costing_harness/Program.cs` (tests)

**Interfaces:**
- Consumes: `MyApp.Api.Helpers.ExcelImport.CellNumber.Parse(string?)`.
- Produces: `static decimal? PercentRate.ToPercent(decimal? numeric, string? text)`
  — returns a percentage (18.00), or null when neither input is a number.

- [ ] **Step 1: Write the failing tests**

Append to `Program.cs` before the summary block:

```csharp
void CheckRate(string name, decimal? actual, decimal? expected)
{
    checks++;
    if (actual is null != expected is null
        || (actual is not null && Math.Abs(actual.Value - expected!.Value) > 0.0001m))
        failures.Add($"{name}: expected {expected?.ToString() ?? "null"}, got {actual?.ToString() ?? "null"}");
}

// PAK writes the rate as a fraction in a numeric cell.
CheckRate("rate.fraction", PercentRate.ToPercent(0.18m, "0.18"), 18m);
CheckRate("rate.fractionAst", PercentRate.ToPercent(0.03m, "0.03"), 3m);

// Alpha and AY write AST as the literal text "3%". CellNumber reads that as
// 0.03, i.e. already a fraction.
CheckRate("rate.percentText", PercentRate.ToPercent(null, "3%"), 3m);
CheckRate("rate.percentText18", PercentRate.ToPercent(null, "18%"), 18m);

// AY writes the income tax rate as the whole number 6, meaning 6%.
CheckRate("rate.whole", PercentRate.ToPercent(6m, "6"), 6m);
CheckRate("rate.whole25", PercentRate.ToPercent(25m, "25"), 25m);

// Zero is a real rate, not a missing one.
CheckRate("rate.zero", PercentRate.ToPercent(0m, "0"), 0m);

// A blank or non-numeric cell has no rate at all.
CheckRate("rate.blank", PercentRate.ToPercent(null, ""), null);
CheckRate("rate.text", PercentRate.ToPercent(null, "n/a"), null);

// Exactly 1 is ambiguous - 1% or 100%. Treated as the fraction, because every
// rate these sheets carry is written as a fraction or a whole number above 1,
// and 100% is a rate that exists while 1% is not one any of them use.
CheckRate("rate.one", PercentRate.ToPercent(1m, "1"), 100m);
```

- [ ] **Step 2: Link the new files into the harness**

In `gd_costing_harness.csproj`, add inside the existing `<ItemGroup>` of
`<Compile>` entries:

```xml
    <Compile Include="..\..\Helpers\ExcelImport\CellNumber.cs" />
    <Compile Include="..\..\Helpers\ExcelImport\PercentRate.cs" />
```

And add to the top of `Program.cs`:

```csharp
using MyApp.Api.Helpers.ExcelImport;
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd scripts/gd_costing_harness && dotnet run -c Release
```

Expected: build error — `PercentRate` does not exist.

- [ ] **Step 4: Write it**

`Helpers/ExcelImport/PercentRate.cs`:

```csharp
namespace MyApp.Api.Helpers.ExcelImport
{
    /// <summary>
    /// Turns a rate cell into a PERCENTAGE, whichever of the three ways a real
    /// accountant wrote it.
    ///
    /// The three GD costing workbooks disagree with each other on every rate
    /// column: PAK stores the sales-tax rate as numeric 0.18, Alpha and AY store
    /// the AST rate as the literal text "3%", and AY stores the income-tax rate
    /// as the whole number 6 (its formula reads "=R4*T4%", so the cell means
    /// six percent). All three mean the same thing.
    ///
    /// This matters more than it looks. A rate silently read as zero values a
    /// whole consignment at no tax, and the resulting selling value is a
    /// plausible wrong number rather than a crash - which is exactly how the
    /// opening-stock import once understated tax by 115,270.18 on two rows out
    /// of 120 (CLAUDE.md 5b-3b).
    ///
    /// A value at or below 1 is read as a FRACTION and multiplied up; anything
    /// above 1 is already a percentage. Exactly 1 is ambiguous and is treated as
    /// the fraction: 100% is a rate that exists, and none of these sheets writes
    /// a rate of 1%.
    /// </summary>
    public static class PercentRate
    {
        public static decimal? ToPercent(decimal? numeric, string? text)
        {
            // CellNumber already turns a trailing "%" into the fraction the
            // numeric cells in the same column carry, so the text form and the
            // numeric form arrive in the same shape and one rule serves both.
            var raw = numeric ?? CellNumber.Parse(text);
            if (raw is null) return null;

            var v = raw.Value;
            if (v < 0m) return null;

            return v <= 1m
                ? decimal.Round(v * 100m, 4, MidpointRounding.AwayFromZero)
                : decimal.Round(v, 4, MidpointRounding.AwayFromZero);
        }
    }
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
cd scripts/gd_costing_harness && dotnet run -c Release
```

Expected: `GD COSTING HARNESS PASSED`, 25 checks, 0 failed.

Careful: `PercentRate.ToPercent(0.18m, "0.18")` must give 18, not 0.18 — if a
test reports 0.18 the `<= 1m` branch is inverted.

- [ ] **Step 6: Commit**

```bash
git add Helpers/ExcelImport/PercentRate.cs scripts/gd_costing_harness
git commit -m "Read a rate cell written as a fraction, a percent string or a whole number" -- Helpers/ExcelImport/PercentRate.cs scripts/gd_costing_harness
```

---

### Task 3: `GdCostingMapping` — the layout, its aliases and its traps

Mirrors `Helpers/ExcelImport/LotRowsMapping.cs`. Column numbers are the
contract; `headerAliases` corrects them against the sheet's own headings, so ONE
layout reads all three clients' variants. Read `LotRowsMapping.cs` before
starting — this class deliberately copies its alias algorithm.

**Files:**
- Create: `Helpers/ExcelImport/GdCostingMapping.cs`
- Modify: `scripts/gd_costing_harness/gd_costing_harness.csproj`
- Modify: `scripts/gd_costing_harness/Program.cs`

**Interfaces:**
- Consumes: `IImportedWorkbook`, `SheetSelector`, `PercentRate`, `CellNumber`.
- Produces:
  - `GdCostingMapping.Parse(string? mappingJson) → GdCostingMapping` (throws `InvalidOperationException` with an operator-facing message)
  - `GdCostingMapping.Columns` of type `GdCostingColumns` with 1-based int properties: `GdNumber`, `GdDate`, `Description`, `Quantity`, `Unit`, `HsCode`, `AssessedValue`, `CustomsDuty`, `Acd`, `RegulatoryDuty`, `Others`, `SalesTaxRate`, `AstRate`, `IncomeTaxRate`, `AddOnProfit`, `SellingValue` (all `int`, the last seven `int?`)
  - `GdCostingColumns Resolve(IImportedWorkbook wb, int sheet, List<string> notes)`
  - `static string CleanHsCode(string? raw)`
  - `static bool LooksLikeTotalsRow(string? description, decimal? sellingValue)`

- [ ] **Step 1: Write the failing tests**

Append to `Program.cs`:

```csharp
void CheckStr(string name, string actual, string expected)
{
    checks++;
    if (actual != expected) failures.Add($"{name}: expected \"{expected}\", got \"{actual}\"");
}
void CheckBool(string name, bool actual, bool expected)
{
    checks++;
    if (actual != expected) failures.Add($"{name}: expected {expected}, got {actual}");
}

// HS codes arrive decorated. Alpha writes "8205.4000:-".
CheckStr("hs.suffix", GdCostingMapping.CleanHsCode("8205.4000:-"), "8205.4000");
CheckStr("hs.plain", GdCostingMapping.CleanHsCode("7018.1000"), "7018.1000");
CheckStr("hs.spaces", GdCostingMapping.CleanHsCode("  9405.1110 "), "9405.1110");
CheckStr("hs.trailingDot", GdCostingMapping.CleanHsCode("8481.1000."), "8481.1000");
CheckStr("hs.null", GdCostingMapping.CleanHsCode(null), "");

// A TOTALS row carries a GD number and a summed cost but no description and no
// selling value. Alpha row 30 holds 18,816,870 - the sum of the 26 lines above
// it - and importing it would double the consignment.
CheckBool("totals.alphaRow30", GdCostingMapping.LooksLikeTotalsRow("", 0m), true);
CheckBool("totals.nullBoth", GdCostingMapping.LooksLikeTotalsRow(null, null), true);

// A real line always has a description. Both halves of the test are required:
// a genuine zero-value line must still import.
CheckBool("totals.zeroValueLine", GdCostingMapping.LooksLikeTotalsRow("SCREW DRIVER", 0m), false);
CheckBool("totals.realLine", GdCostingMapping.LooksLikeTotalsRow("SCREW DRIVER", 72905m), false);
CheckBool("totals.descOnly", GdCostingMapping.LooksLikeTotalsRow("Total", 0m), false);

// A mapping with no GD number column cannot drive an import.
{
    checks++;
    try
    {
        GdCostingMapping.Parse("{\"columns\":{\"description\":3,\"quantity\":4}}");
        failures.Add("parse.noGd: expected a rejection, got none");
    }
    catch (InvalidOperationException) { /* expected */ }
}

// Valid JSON round-trips.
{
    var m = GdCostingMapping.Parse(
        "{\"headerRow\":1,\"firstDataRow\":3,\"columns\":{\"gdNumber\":1,\"gdDate\":2," +
        "\"description\":3,\"quantity\":4,\"unit\":5,\"hsCode\":6,\"assessedValue\":7," +
        "\"customsDuty\":8,\"acd\":9,\"regulatoryDuty\":10,\"salesTaxRate\":12," +
        "\"astRate\":14,\"others\":16,\"incomeTaxRate\":19,\"addOnProfit\":22,\"sellingValue\":23}}");
    Check("parse.firstDataRow", m.FirstDataRow, 3m);
    Check("parse.sellingValue", m.Columns.SellingValue ?? 0, 23m);
}
```

- [ ] **Step 2: Link and run to verify it fails**

Add to the csproj `<ItemGroup>`:

```xml
    <Compile Include="..\..\Helpers\ExcelImport\IImportedWorkbook.cs" />
    <Compile Include="..\..\Helpers\ExcelImport\SheetSelector.cs" />
    <Compile Include="..\..\Helpers\ExcelImport\GdCostingMapping.cs" />
```

```bash
cd scripts/gd_costing_harness && dotnet run -c Release
```

Expected: build error — `GdCostingMapping` does not exist.

- [ ] **Step 3: Write the mapping**

`Helpers/ExcelImport/GdCostingMapping.cs`. Copy the alias algorithm from
`LotRowsMapping.Resolve` verbatim in structure — resolve every alias against the
heading row FIRST, then apply them together, because applying one at a time
cannot express a swap. Key members:

```csharp
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MyApp.Api.Helpers.ExcelImport
{
    /// <summary>
    /// Mapping for the <c>GdRows</c> layout: a customs GD costing sheet, one row
    /// per consignment line, with the GD number repeated on every row of the
    /// consignment.
    ///
    /// Column numbers are 1-based and are the contract;
    /// <see cref="HeaderAliases"/> corrects them against the sheet's own heading
    /// row. Three real client workbooks share this layout and disagree about
    /// three things: AY inserts a "PNL/FIN" column that shifts everything from
    /// Subtotal rightwards by one, PAK titles the cost column "Cost Valve" where
    /// the others say "Value", and PAK titles the input-tax column "S.Tax" where
    /// the others say "Total Tax Amt For Selling Value". Aliases absorb all
    /// three, so there is ONE built-in layout and no operator mapping.
    /// </summary>
    public class GdCostingMapping
    {
        [JsonPropertyName("sheetSelect")] public SheetSelector SheetSelect { get; set; } = new();
        [JsonPropertyName("headerRow")] public int HeaderRow { get; set; } = 1;
        [JsonPropertyName("firstDataRow")] public int FirstDataRow { get; set; } = 3;
        [JsonPropertyName("columns")] public GdCostingColumns Columns { get; set; } = new();
        [JsonPropertyName("blankRowsEndData")] public int BlankRowsEndData { get; set; } = 15;
        [JsonPropertyName("headerAliases")]
        public Dictionary<string, List<string>> HeaderAliases { get; set; } = new();

        public class GdCostingColumns
        {
            [JsonPropertyName("gdNumber")] public int GdNumber { get; set; }
            [JsonPropertyName("gdDate")] public int? GdDate { get; set; }
            [JsonPropertyName("description")] public int Description { get; set; }
            [JsonPropertyName("quantity")] public int Quantity { get; set; }
            [JsonPropertyName("unit")] public int? Unit { get; set; }
            [JsonPropertyName("hsCode")] public int HsCode { get; set; }
            [JsonPropertyName("assessedValue")] public int AssessedValue { get; set; }
            [JsonPropertyName("customsDuty")] public int? CustomsDuty { get; set; }
            [JsonPropertyName("acd")] public int? Acd { get; set; }
            [JsonPropertyName("regulatoryDuty")] public int? RegulatoryDuty { get; set; }
            [JsonPropertyName("others")] public int? Others { get; set; }
            [JsonPropertyName("salesTaxRate")] public int? SalesTaxRate { get; set; }
            [JsonPropertyName("astRate")] public int? AstRate { get; set; }
            [JsonPropertyName("incomeTaxRate")] public int? IncomeTaxRate { get; set; }
            [JsonPropertyName("addOnProfit")] public int? AddOnProfit { get; set; }

            /// <summary>
            /// The sheet's own Selling Value. Read so a MANUAL OVERRIDE survives:
            /// nine of PAK's 83 lines carry a typed selling value that the
            /// formula does not produce (ratios of 1.39, 1.33 and 1.56 against a
            /// computed 1.1667). The sheet wins, and the preview says so.
            /// </summary>
            [JsonPropertyName("sellingValue")] public int? SellingValue { get; set; }
        }
```

Then, in the same class:

```csharp
        private static readonly JsonSerializerOptions JsonOptions = new()
        {
            PropertyNameCaseInsensitive = true,
        };

        public static GdCostingMapping Parse(string? mappingJson)
        {
            GdCostingMapping? mapping;
            try
            {
                mapping = JsonSerializer.Deserialize<GdCostingMapping>(
                    string.IsNullOrWhiteSpace(mappingJson) ? "{}" : mappingJson, JsonOptions);
            }
            catch (JsonException)
            {
                throw new InvalidOperationException("The column mapping for this layout is not valid JSON.");
            }

            mapping ??= new GdCostingMapping();

            if (mapping.Columns.GdNumber <= 0)
                throw new InvalidOperationException("The mapping does not say which column holds the GD number.");
            if (mapping.Columns.Description <= 0)
                throw new InvalidOperationException("The mapping does not say which column holds the description.");
            if (mapping.Columns.Quantity <= 0)
                throw new InvalidOperationException("The mapping does not say which column holds the quantity.");
            if (mapping.Columns.HsCode <= 0)
                throw new InvalidOperationException("The mapping does not say which column holds the HS code.");
            if (mapping.Columns.AssessedValue <= 0)
                throw new InvalidOperationException("The mapping does not say which column holds the assessed value.");
            if (mapping.FirstDataRow <= 0)
                throw new InvalidOperationException("The mapping does not say which row the data starts on.");

            return mapping;
        }

        /// <summary>
        /// Strips a code down to digits and dots. Real sheets decorate them —
        /// every code in all three workbooks reads "8205.4000:-" — and a code
        /// that keeps its decoration matches nothing in the tariff master.
        /// </summary>
        public static string CleanHsCode(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return "";
            var kept = new string(raw.Where(c => char.IsDigit(c) || c == '.').ToArray());
            return kept.Trim('.');
        }

        /// <summary>
        /// True for a row that sums the consignment rather than describing a
        /// line of it.
        ///
        /// BOTH halves are required. Alpha's row 30 carries the GD number and a
        /// cost of 18,816,870 — the sum of the 26 lines above it — with no
        /// description and no selling value; imported as a line it doubles the
        /// consignment. Testing the value alone would drop a genuine zero-value
        /// line, and testing the description alone would keep a totals row that
        /// happened to be labelled.
        /// </summary>
        public static bool LooksLikeTotalsRow(string? description, decimal? sellingValue)
            => string.IsNullOrWhiteSpace(description) && !(sellingValue > 0m);
```

Then `Resolve`, whose body is `LotRowsMapping.Resolve`'s algorithm with this
class's field names. Reuse its exact rules and keep its notes:

- scan `HeaderRow` for headings, normalised (lower-cased, whitespace collapsed)
- collect every alias hit into a `found` dictionary before applying any
- an alias matching zero columns, or more than one, leaves the mapped number
  alone and adds a note
- two fields naming one column drops both and adds a note
- every relocation adds a note naming the old and new column

- [ ] **Step 4: Run to verify it passes**

```bash
cd scripts/gd_costing_harness && dotnet run -c Release
```

Expected: `GD COSTING HARNESS PASSED`, 37 checks, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add Helpers/ExcelImport/GdCostingMapping.cs scripts/gd_costing_harness
git commit -m "Add the GD costing sheet layout, its aliases and its totals-row guard" -- Helpers/ExcelImport/GdCostingMapping.cs scripts/gd_costing_harness
```

---

### Task 4: Read a workbook end to end, against the real files

The harness so far tests units. This task proves the layout reads all three
client workbooks with no operator mapping — the claim the whole feature rests
on. The files are client data and are NOT committed; they are passed by path.

**Files:**
- Create: `Helpers/ExcelImport/GdCostingSheetReader.cs`
- Create: `Helpers/ExcelImport/GdCostingLayout.cs`
- Modify: `scripts/gd_costing_harness/Program.cs`
- Modify: `scripts/gd_costing_harness/gd_costing_harness.csproj`

**Interfaces:**
- Consumes: `GdCostingMapping`, `PercentRate`, `ImportCostingCalculator`, `IImportedWorkbook`,
  `WorkbookReaderFactory.Open(Stream stream, string extension)`.
- Produces:
  - `static class GdCostingLayout` with `const string MappingJson` — the built-in
    layout as JSON. It lives beside the mapping rather than in
    `Helpers/DefaultImportLayouts.cs` so the offline harness can link it without
    dragging `AppDbContext` and EF Core into a console project. Task 5's seeder
    references this constant.
  - `record GdCostingSheetRow(int SourceRow, string GdNumber, DateTime? GdDate, string Description, string HsCode, decimal Quantity, string? Unit, ImportCostingInput Input, ImportCosting Computed, decimal? SheetSellingValue)`
  - `record GdCostingSheetResult(List<GdCostingSheetRow> Rows, List<string> Warnings)`
  - `static GdCostingSheetResult GdCostingSheetReader.Read(IImportedWorkbook wb, int sheet, GdCostingMapping mapping)`

- [ ] **Step 0: Create `GdCostingLayout` with the built-in mapping**

`Helpers/ExcelImport/GdCostingLayout.cs` — a static class holding one `const
string MappingJson`, whose content is the JSON given in **Task 5, Step 2**. Write
that JSON here now; Task 5 only wires it into the seeder.

- [ ] **Step 1: Write the reader**

`Helpers/ExcelImport/GdCostingSheetReader.cs`. Rules it must keep:

```csharp
// For each row from max(FirstDataRow, HeaderRow + 1) — the heading row is never
// data, whatever firstDataRow says (CLAUDE.md 5b-3b) — until BlankRowsEndData
// consecutive blank rows:
//
//   1. read the GD number; a blank one continues (the row belongs to no GD)
//   2. read description and the sheet's selling value
//   3. if GdCostingMapping.LooksLikeTotalsRow(description, sellingValue),
//      SKIP and add a warning naming the row and the GD:
//        $"Row {r}: a totals row for {gd} was skipped (no description, no selling value)."
//   4. rates through PercentRate.ToPercent(wb.GetDecimal(...), wb.GetString(...))
//   5. compute through ImportCostingCalculator.Compute
//   6. when the sheet states a selling value that differs from the computed one
//      by more than 0.01, keep the SHEET's and warn:
//        $"Row {r}: the sheet states a selling value of {sheet:N2} where the costing gives {computed:N2}. The sheet's figure was kept."
```

A warning per relocation and per skip is deliberate: a silently relocated column
or a silently dropped row is how a wrong import becomes a confident one.

- [ ] **Step 2: Add the real-file mode to the harness**

Append to `Program.cs`, after the unit checks:

```csharp
// Optional: run a REAL client workbook through the shipped layout.
//   dotnet run -c Release -- --file "C:\path\Alpha Trader Costing.xlsx" --expect-lines 26 --expect-cost 18816870 --expect-selling 21940496.99
// The workbooks are client data and are never committed. Without --file the
// harness runs its synthetic cases only, which is what CI does.
var fileArg = Array.IndexOf(args, "--file");
if (fileArg >= 0 && fileArg + 1 < args.Length)
{
    var path = args[fileArg + 1];
    decimal Expect(string flag)
    {
        var i = Array.IndexOf(args, flag);
        return i >= 0 && i + 1 < args.Length ? decimal.Parse(args[i + 1]) : -1m;
    }

    using var stream = File.OpenRead(path);
    using var wb = WorkbookReaderFactory.Open(stream, Path.GetExtension(path));
    var mapping = GdCostingMapping.Parse(GdCostingLayout.MappingJson);
    var result = GdCostingSheetReader.Read(wb, 0, mapping);

    Console.WriteLine($"  {Path.GetFileName(path)}: {result.Rows.Count} lines, {result.Warnings.Count} warnings");
    foreach (var w in result.Warnings.Take(10)) Console.WriteLine("    " + w);

    var expLines = Expect("--expect-lines");
    if (expLines >= 0) Check("file.lines", result.Rows.Count, expLines);

    var expCost = Expect("--expect-cost");
    if (expCost >= 0) Check("file.cost", result.Rows.Sum(r => r.Computed.Cost), expCost, 1m);

    var expSelling = Expect("--expect-selling");
    if (expSelling >= 0)
        Check("file.selling", result.Rows.Sum(r => r.SheetSellingValue ?? r.Computed.SellingValue), expSelling, 1m);
}
```

Add to the csproj:

```xml
    <Compile Include="..\..\Helpers\ExcelImport\ClosedXmlImportedWorkbook.cs" />
    <Compile Include="..\..\Helpers\ExcelImport\NpoiImportedWorkbook.cs" />
    <Compile Include="..\..\Helpers\ExcelImport\WorkbookReaderFactory.cs" />
    <Compile Include="..\..\Helpers\ExcelImport\DateParser.cs" />
    <Compile Include="..\..\Helpers\ExcelImport\GdCostingLayout.cs" />
    <Compile Include="..\..\Helpers\ExcelImport\GdCostingSheetReader.cs" />
```

and the NPOI package, pinned to the version the app uses
(`MyApp.Api.csproj:58`):

```xml
    <PackageReference Include="NPOI" Version="2.7.1" />
```

- [ ] **Step 3: Run against all three real workbooks**

```bash
cd scripts/gd_costing_harness && dotnet run -c Release -- --file "C:\Users\hussahuz\Downloads\Alpha Trader Costing.xlsx" --expect-lines 26 --expect-cost 18816870 --expect-selling 21940496.99
```

Expected: 26 lines, 1 warning (the row-30 totals row), all checks pass.

```bash
cd scripts/gd_costing_harness && dotnet run -c Release -- --file "C:\Users\hussahuz\Downloads\Ay trader Costing.xlsx" --expect-lines 51 --expect-cost 39750726 --expect-selling 46154294.45
```

Expected: 51 lines, 2 totals rows skipped.

```bash
cd scripts/gd_costing_harness && dotnet run -c Release -- --file "C:\Users\hussahuz\Downloads\Pak Trade Co Costing.xlsx" --expect-lines 83 --expect-cost 37808581 --expect-selling 44337680.16
```

Expected: 83 lines, 6 totals rows skipped, and **9 selling-value override
warnings** — PAK's manually typed lines. Those nine warnings are the correct
outcome, not a failure.

If a run reports a line count one higher than expected, a totals row got
through. If the cost is roughly double, several did.

- [ ] **Step 4: Commit**

```bash
git add Helpers/ExcelImport/GdCostingSheetReader.cs scripts/gd_costing_harness
git commit -m "Read a GD costing sheet, skipping totals rows and keeping stated overrides" -- Helpers/ExcelImport/GdCostingSheetReader.cs scripts/gd_costing_harness
```

---

### Task 5: The built-in layout

**Files:**
- Modify: `Models/ImportProfile.cs` (add `ImportKinds.GdCosting`, `ImportLayouts.GdRows`, wire `ByKind`)
- Modify: `Helpers/DefaultImportLayouts.cs`

**Interfaces:**
- Produces: `ImportKinds.GdCosting = "GdCosting"`, `ImportLayouts.GdRows = "GdRows"`,
  `DefaultImportLayouts.GdCostingName`, `DefaultImportLayouts.GdCostingMappingJson`.

- [ ] **Step 1: Add the kind and layout constants**

In `Models/ImportProfile.cs`:

```csharp
        public const string GdCosting = "GdCosting";
        public static readonly string[] All = { OpeningStock, CustomerLedger, GdCosting };
```

and in `ImportLayouts`:

```csharp
        public const string GdRows = "GdRows";
        // ... inside ByKind:
                [ImportKinds.GdCosting] = new[] { GdRows },
```

- [ ] **Step 2: The built-in mapping**

This JSON is written in **Task 4, Step 0** as
`Helpers/ExcelImport/GdCostingLayout.MappingJson`. It is reproduced here because
it is the layout's definition and Task 5 is where it gets a name and a seeder.
In `Helpers/DefaultImportLayouts.cs` add only the name, following the existing
`StockName` pattern:

```csharp
        public const string GdCostingName = "Standard GD costing sheet (built-in)";
```

Column numbers are the **Alpha / PAK** order (they agree); AY's extra `PNL/FIN`
column is absorbed by aliases:

```csharp
        public const string MappingJson = """
        {
          "headerRow": 1,
          "firstDataRow": 3,
          "columns": {
            "gdNumber": 1, "gdDate": 2, "description": 3, "quantity": 4,
            "unit": 5, "hsCode": 6, "assessedValue": 7, "customsDuty": 8,
            "acd": 9, "regulatoryDuty": 10, "salesTaxRate": 12, "astRate": 14,
            "others": 16, "incomeTaxRate": 19, "addOnProfit": 22,
            "sellingValue": 23
          },
          "headerAliases": {
            "gdNumber":      ["GD Num", "GD Number", "GDs No"],
            "gdDate":        ["GD Date"],
            "description":   ["Description", "Items"],
            "quantity":      ["Qty"],
            "unit":          ["Unit"],
            "hsCode":        ["HS Code"],
            "assessedValue": ["Assessed Value"],
            "customsDuty":   ["C.Duty"],
            "acd":           ["ACD"],
            "regulatoryDuty":["RD"],
            "others":        ["Others"],
            "salesTaxRate":  ["Assessement", "ST Rate", "S.T Rate"],
            "astRate":       ["AST Rate"],
            "incomeTaxRate": ["I.tax Rate"],
            "addOnProfit":   ["Add On Profit if Need"],
            "sellingValue":  ["Selling Value"]
          }
        }
        """;
```

Do **not** alias `salesTaxRate` to bare "Rate" — the sheets carry several rate
columns and a multi-hit alias correctly declines, which would silently keep a
wrong number.

Do **not** alias the derived columns (`Total`, `Subtotal`, `Value`,
`Cost Valve`, `Total Tax Amt For Selling Value`, `Tax`, `Profit`,
`Profit Rate`). They are recomputed by `ImportCostingCalculator`, so PAK's
"Cost Valve" naming needs no alias at all — that variant simply does not matter.

- [ ] **Step 3: Seed it**

Extend `DefaultImportLayouts.SeedAsync` with a `GdCosting` profile alongside the
stock and ledger ones, using `GdCostingName` and
`GdCostingLayout.MappingJson`. Keep the existing rule: a built-in whose **current
version was written by `"system"`** is upgraded in place; one an operator has
edited keeps their mapping for ever. Test `changed` across every field the
seeder owns (mapping, name, notes) — testing the mapping alone silently skips a
release that changed only the name.

Leave `SignatureHash` and `TokenSignature` empty for this layout for now: there
is no published GD template to fingerprint, and an empty signature still offers
the layout, it merely does not auto-select it. Add a code comment saying so, so
the gap reads as a decision.

- [ ] **Step 4: Build and start the backend once to confirm the seeder runs**

```bash
dotnet build MyApp.Api.csproj
```

Expected: `0 Error(s)`.

Then start the backend yourself (never auto-restart it) and confirm the startup
log shows no seeder exception, and:

```bash
sqlcmd -S ".\MSSQLSERVER02" -d "MyApp_Importer_Local" -E -I -W -Q "SELECT Kind, Layout, Name, CurrentVersion FROM ImportProfiles WHERE Kind='GdCosting';"
```

Expected: one row, `GdRows`, `CurrentVersion 1`.

- [ ] **Step 5: Commit**

```bash
git add Models/ImportProfile.cs Helpers/DefaultImportLayouts.cs
git commit -m "Ship a built-in layout for the GD costing sheet" -- Models/ImportProfile.cs Helpers/DefaultImportLayouts.cs
```

---

### Task 6: Entities and migration

**Files:**
- Create: `Models/ImportConsignment.cs`
- Create: `Models/ImportConsignmentLine.cs`
- Modify: `Models/OpeningStockBalance.cs`
- Modify: `Data/AppDbContext.cs`
- Create: `Migrations/<timestamp>_AddImportConsignmentAndActualCost.cs` (generated)

**Interfaces:**
- Produces: `ImportConsignment`, `ImportConsignmentLine`,
  `OpeningStockBalance.ActualCostExcludingTax` (`decimal`, default 0),
  `GdCostingDisposition` enum (`CostOnly = 0`, `StockPosted = 1`, `Skipped = 2`, `Ambiguous = 3`).

- [ ] **Step 1: Add `OpeningStockBalance.ActualCostExcludingTax`**

In `Models/OpeningStockBalance.cs`, directly after `ValueExcludingTax`:

```csharp
        /// <summary>
        /// What that opening quantity actually COST, excluding sales tax —
        /// assessed customs value plus duties, from the GD costing sheet.
        ///
        /// Deliberately separate from <see cref="ValueExcludingTax"/>, which on
        /// these installations is the SELLING value: the stock sheet's "Balance
        /// Excl" is the costing sheet's "Selling Value", verified to the paisa
        /// against the client's own workbook. The two differ by the tax-driven
        /// uplift, so one column cannot serve both.
        ///
        /// Internal only. Nothing prices, files or posts from this figure — it
        /// exists so margin is answerable. Zero means "not known", which is what
        /// every row held before the costing import existed.
        /// </summary>
        public decimal ActualCostExcludingTax { get; set; }
```

- [ ] **Step 2: Create the entities**

`Models/ImportConsignment.cs`:

```csharp
public int Id { get; set; }
public int CompanyId { get; set; }
public string GdNumber { get; set; } = "";
public DateTime GdDate { get; set; }
public decimal TotalCostExcludingTax { get; set; }
public decimal TotalInputTax { get; set; }
public decimal TotalIncomeTax { get; set; }
public decimal TotalSellingValue { get; set; }
public int? ImportRunId { get; set; }
public string? Notes { get; set; }
public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
public Company Company { get; set; } = null!;
public ICollection<ImportConsignmentLine> Lines { get; set; } = new List<ImportConsignmentLine>();
```

`Models/ImportConsignmentLine.cs`:

```csharp
public enum GdCostingDisposition
{
    /// <summary>Matched existing stock; only the actual cost was written.</summary>
    CostOnly = 0,
    /// <summary>Booked as new stock. Not reachable until a later release.</summary>
    StockPosted = 1,
    /// <summary>Read and recorded, but nothing was written. Carries a reason.</summary>
    Skipped = 2,
    /// <summary>Matched more than one balance, so no guess was made.</summary>
    Ambiguous = 3,
}

public int Id { get; set; }
public int ImportConsignmentId { get; set; }
public int SourceRow { get; set; }
public string DescriptionOnSheet { get; set; } = "";
public string? HsCode { get; set; }
public decimal Quantity { get; set; }
public string? Unit { get; set; }

// Cost inputs, exactly as the sheet stated them.
public decimal AssessedValue { get; set; }
public decimal CustomsDuty { get; set; }
public decimal Acd { get; set; }
public decimal RegulatoryDuty { get; set; }
public decimal Others { get; set; }

// Rates RESOLVED at import time and stored, so the line keeps the rate it was
// costed at when the published rates change - the rule 5b-5 and 5b-10 record.
// Percentages (18.00), never fractions.
public decimal SalesTaxRate { get; set; }
public decimal AstRate { get; set; }
public decimal IncomeTaxRate { get; set; }
public decimal AddOnProfit { get; set; }

// Resolved outcomes. Stored rather than derived on read because a line may
// carry the sheet's own override, and because a later GL entry must reproduce
// exactly what was posted.
public decimal CostExcludingTax { get; set; }
public decimal SellingValueExcludingTax { get; set; }

public GdCostingDisposition Disposition { get; set; }
public string? DispositionNote { get; set; }
public int? ItemTypeId { get; set; }
public int? OpeningStockBalanceId { get; set; }
public int? StockMovementId { get; set; }
public int? ImportRunId { get; set; }
public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

public ImportConsignment ImportConsignment { get; set; } = null!;
public OpeningStockBalance? OpeningStockBalance { get; set; }
```

Carry the spec's reasoning into XML doc comments — in particular, on
`GdNumber`:

```csharp
        /// <summary>
        /// The customs GD number, UNIQUE per company. Externally issued, so
        /// MyApp.Api.Helpers.NumberAllocationRetry deliberately does NOT apply:
        /// a collision here is a duplicate import and must be reported as one,
        /// not retried into a second number.
        /// </summary>
        public string GdNumber { get; set; } = "";
```

- [ ] **Step 3: Configure in `AppDbContext`**

```csharp
modelBuilder.Entity<ImportConsignment>(e =>
{
    e.HasIndex(c => new { c.CompanyId, c.GdNumber }).IsUnique();
    e.Property(c => c.GdNumber).HasMaxLength(64);
    e.Property(c => c.TotalCostExcludingTax).HasPrecision(18, 2);
    e.Property(c => c.TotalInputTax).HasPrecision(18, 2);
    e.Property(c => c.TotalIncomeTax).HasPrecision(18, 2);
    e.Property(c => c.TotalSellingValue).HasPrecision(18, 2);
    e.HasOne(c => c.Company).WithMany().HasForeignKey(c => c.CompanyId)
        .OnDelete(DeleteBehavior.Restrict);
});

modelBuilder.Entity<ImportConsignmentLine>(e =>
{
    e.Property(l => l.Quantity).HasPrecision(18, 4);
    e.Property(l => l.AssessedValue).HasPrecision(18, 2);
    // ... every money column 18,2; every rate 18,4
    e.HasOne(l => l.ImportConsignment).WithMany(c => c.Lines)
        .HasForeignKey(l => l.ImportConsignmentId)
        .OnDelete(DeleteBehavior.Cascade);
    // Restrict, NOT Cascade: a line pointing at an opening balance must not
    // delete it, and Company already restricts on both sides — two cascade
    // paths to one table is what SQL Server refuses.
    e.HasOne(l => l.OpeningStockBalance).WithMany()
        .HasForeignKey(l => l.OpeningStockBalanceId)
        .OnDelete(DeleteBehavior.Restrict);
});
```

`StockMovementId` and `ImportRunId` stay **plain nullable columns with no FK** —
the same choice `Invoice.CopiedFromId` and `OpeningStockLot.ImportRunId` already
make. A third cascade path into `StockMovements` is exactly what SQL Server
refuses, and neither pointer needs referential enforcement.

`ImportConsignment.CompanyId` is `Restrict`, so `CompanyService.DeleteAsync`
must delete a company's consignments before the company — the same trap
`CompanyItemTypeSettings` and `DeliveryItems.InvoiceItemId` already had. Add
that deletion in the same change.

- [ ] **Step 4: Generate and read the migration**

```bash
dotnet ef migrations add AddImportConsignmentAndActualCost
```

Read the generated file before running it. `ActualCostExcludingTax` must be
`nullable: false, defaultValue: 0m` so existing rows get a real zero rather than
a null the walk would have to handle.

- [ ] **Step 5: Apply and verify**

Start the backend (auto-migrate is on) and confirm:

```bash
sqlcmd -S ".\MSSQLSERVER02" -d "MyApp_Importer_Local" -E -I -W -Q "SELECT COUNT(*) AS WithCost FROM OpeningStockBalances WHERE ActualCostExcludingTax <> 0; SELECT COUNT(*) AS Rows_ FROM OpeningStockBalances;"
```

Expected: `WithCost 0`, `Rows_ 174` (39 + 78 + 57). Every existing row keeps its
selling value and gains a zero cost.

- [ ] **Step 6: Commit**

```bash
git add Models/ImportConsignment.cs Models/ImportConsignmentLine.cs Models/OpeningStockBalance.cs Data/AppDbContext.cs Services/Implementations/CompanyService.cs Migrations
git commit -m "Add consignment entities and actual cost on the opening balance" -- Models Data/AppDbContext.cs Services/Implementations/CompanyService.cs Migrations
```

---

### Task 7: Opening balance — read and write the actual cost

Do this BEFORE the import, so the import has a surface to be checked against and
the operator can correct whatever it writes.

**Files:**
- Modify: `DTOs/StockDtos.cs:98-140` (`OpeningStockBalanceDto`, `UpsertOpeningBalanceDto`)
- Modify: `Controllers/StockController.cs:551-640`

**Interfaces:**
- Produces: `OpeningStockBalanceDto.ActualCostExcludingTax`, `.Margin`,
  `.MarginPercent`; `UpsertOpeningBalanceDto.ActualCostExcludingTax` (`decimal?`).

- [ ] **Step 1: Extend the DTOs**

```csharp
    // in OpeningStockBalanceDto
        /// <summary>What the opening quantity cost, excluding sales tax.
        /// Zero means not known.</summary>
        public decimal ActualCostExcludingTax { get; set; }

        /// <summary>Selling value less actual cost. Negative is a real state —
        /// stock whose selling value has fallen below what it cost — and must
        /// render as such, never clamped.</summary>
        public decimal Margin => ValueExcludingTax - ActualCostExcludingTax;

        public decimal MarginPercent => ValueExcludingTax > 0m
            ? Math.Round(Margin * 100m / ValueExcludingTax, 2, MidpointRounding.AwayFromZero)
            : 0m;
```

```csharp
    // in UpsertOpeningBalanceDto
        /// <summary>
        /// What the quantity cost, excluding sales tax.
        ///
        /// NULLABLE, and null means "the caller did not mention it" — the row
        /// keeps the cost it had. Only a supplied value sets it, and 0 clears
        /// it. Same distinction UpdateInvoiceDto.AdvanceTaxSection draws, for
        /// the same reason: the sheet importer, the UI and any API client all
        /// post here, and a caller editing only the quantity must not silently
        /// erase a cost that took an import to establish.
        ///
        /// ValueExcludingTax deliberately keeps its non-nullable overwrite
        /// behaviour — changing that would alter how every current caller
        /// behaves.
        /// </summary>
        public decimal? ActualCostExcludingTax { get; set; }
```

- [ ] **Step 2: Wire the controller**

In `GetOpeningBalances`, add to the projection:

```csharp
                    ActualCostExcludingTax = o.ActualCostExcludingTax,
```

In `UpsertOpeningBalance`, on the create branch:

```csharp
                    ActualCostExcludingTax = dto.ActualCostExcludingTax ?? 0m,
```

and on the update branch — note this is an `if`, not an unconditional assign:

```csharp
                if (dto.ActualCostExcludingTax is decimal actual)
                    existing.ActualCostExcludingTax = actual;
```

Add the same field to the response object built at the end of the method.

- [ ] **Step 3: Verify by hand**

Start the backend. Then, against a real opening row:

```bash
sqlcmd -S ".\MSSQLSERVER02" -d "MyApp_Importer_Local" -E -I -W -Q "SELECT TOP 3 Id, ItemTypeId, Quantity, ValueExcludingTax, ActualCostExcludingTax FROM OpeningStockBalances WHERE CompanyId = 4 ORDER BY Id;"
```

POST an upsert carrying `actualCostExcludingTax`, re-query and confirm it
landed. Then POST the same body with the field **omitted** and confirm the cost
is unchanged. Then POST it as `0` and confirm it clears. That three-step check
is the whole point of the nullable — automate it in Task 11.

- [ ] **Step 4: Commit**

```bash
git add DTOs/StockDtos.cs Controllers/StockController.cs
git commit -m "Carry actual cost on the opening balance API" -- DTOs/StockDtos.cs Controllers/StockController.cs
```

---

### Task 8: Opening Balances tab — enter and edit the cost

**Files:**
- Modify: `myapp-frontend/src/Pages/StockDashboardPage.jsx` — `openingDraft`
  state (line ~94), `startEditOpening` (~264), `startAddOpening` (~277),
  `submitOpening` (~283), `openingValuePreview` (~435), and the Opening
  Balances tab body (~974)
- Modify: `myapp-frontend/src/api/…` — whichever module exports the opening
  upsert call (find it with `grep -rn "opening" myapp-frontend/src/api/`)

- [ ] **Step 1: Add the field to the draft**

```jsx
  const [openingDraft, setOpeningDraft] = useState({
    itemTypeId: "", quantity: 0, valueExcludingTax: "", actualCostExcludingTax: "",
    salesTaxRate: "", asOfDate: todayYmd(), notes: "",
  });
```

Mirror it in `startEditOpening` (seed from `o.actualCostExcludingTax`, rendering
0 as `""` so the box reads empty rather than a misleading zero) and in
`startAddOpening` (reset to `""`).

- [ ] **Step 2: Send it only when the operator typed something**

In `submitOpening`, build the payload so an untouched box sends nothing — this
is the client half of the nullable contract:

```jsx
    const actual = openingDraft.actualCostExcludingTax;
    const payload = {
      companyId: selectedCompany.id,
      itemTypeId: Number(openingDraft.itemTypeId),
      quantity: Number(openingDraft.quantity) || 0,
      valueExcludingTax: Number(openingDraft.valueExcludingTax) || 0,
      salesTaxRate: Number(openingDraft.salesTaxRate) || 0,
      asOfDate: openingDraft.asOfDate,
      notes: openingDraft.notes || null,
      // Omitted entirely when the box is blank: the server then keeps whatever
      // cost the import established. Sending 0 would erase it.
      ...(actual === "" || actual === null || actual === undefined
        ? {}
        : { actualCostExcludingTax: Number(actual) || 0 }),
    };
```

- [ ] **Step 3: Render the input and a margin preview**

Add an "Actual cost (excl. tax)" number input beside the existing selling-value
input, and extend `openingValuePreview` to show margin alongside the tax
preview:

```jsx
  const openingMarginPreview = (() => {
    const sell = parseFloat(openingDraft.valueExcludingTax);
    const cost = parseFloat(openingDraft.actualCostExcludingTax);
    if (!isFinite(sell) || !isFinite(cost) || cost <= 0) return null;
    const margin = sell - cost;
    const pct = sell > 0 ? (margin * 100) / sell : 0;
    return { margin, pct };
  })();
```

Show it as `Margin 3,123,627 (14.24%)`, and in the negative colour from
`colors` when `margin < 0` — a cost above the selling value is a real state the
operator needs to see, not hide.

Follow the mobile-first rules: the form grid stays
`repeat(auto-fit, minmax(min(220px, 100%), 1fr))`, tap targets ≥ 44 px, and item
names use `-webkit-line-clamp`, never `nowrap` + `ellipsis`.

- [ ] **Step 4: Add the column to the Opening Balances table**

Add **Actual cost** and **Margin** columns to the tab's table and to its mobile
card layout. Gate both on `has("stock.actualcost.view")` (added in Task 9) — an
operator who prices and sells does not necessarily see margin.

- [ ] **Step 5: Rebuild the frontend and verify it renders**

```bash
cd myapp-frontend && npm run build
```

Then copy `myapp-frontend/dist/*` into `wwwroot/` and reload the page. A green
build is not visual proof (CLAUDE.md) — open the Opening Balances tab, confirm
the new input and the margin line render, and confirm at 375 px the form still
collapses to one column.

- [ ] **Step 6: Commit**

```bash
git add myapp-frontend/src
git commit -m "Enter and edit an opening balance's actual cost" -- myapp-frontend/src
```

---

### Task 9: Permissions and navigation

**Files:**
- Modify: `Helpers/PermissionCatalog.cs`
- Modify: `myapp-frontend/src/config/permissionSections.js`
- Modify: `myapp-frontend/src/layouts/DashboardLayout.jsx`
- Modify: `myapp-frontend/src/App.jsx` (route)

- [ ] **Step 1: Add the keys**

In `Helpers/PermissionCatalog.cs`, beside the existing `stock.*` block:

```csharp
            new("stock.actualcost.view",     "Inventory",    "Actual Cost", "View", "See the actual landed cost of stock and its margin"),
            new("importcosting.sheet.run",   "ImportCosting", "GD Costing Sheet", "Run", "Import a GD costing workbook and load actual cost onto stock"),
            new("importcosting.consignments.view", "ImportCosting", "Consignments", "View", "View imported consignments and their lines"),
```

- [ ] **Step 2: Map the module**

In `myapp-frontend/src/config/permissionSections.js`, map `ImportCosting` to the
**Purchases** section — the same section the nav link goes in. `Inventory` is
already mapped.

- [ ] **Step 3: Verify the mapping**

```bash
python scripts/verify_permission_sections.py
```

Expected: `All permission modules are mapped`.

- [ ] **Step 4: Add the nav link and route**

In `DashboardLayout.jsx`, add `"importcosting.sheet.run"` to the Purchases
section's key list, and the link inside that `NavGroup`:

```jsx
              <Can permission="importcosting.sheet.run">
                <NavLink to="/imports/costing" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdInventory2 className="dl-subitem__icon" aria-hidden="true" />
                  <span>Import Costing</span>
                </NavLink>
              </Can>
```

Import the icon from `react-icons/md` alongside the others already imported
there, and register the `/imports/costing` route in `App.jsx` next to the other
guarded routes, following whatever guard component the neighbouring routes use.

- [ ] **Step 5: Build and confirm the link renders**

```bash
cd myapp-frontend && npm run build
```

Copy to `wwwroot/`, reload, and confirm the link appears under Purchases for the
seed admin, and that the icon actually renders (DOM-measure the `svg` width > 0
— screenshots are broken on this machine).

- [ ] **Step 6: Commit**

```bash
git add Helpers/PermissionCatalog.cs myapp-frontend/src
git commit -m "Add import costing permissions and its nav entry" -- Helpers/PermissionCatalog.cs myapp-frontend/src
```

---

### Task 10: Preview and commit — the cost-only import

**Files:**
- Create: `DTOs/GdCostingImportDtos.cs`
- Create: `Services/Interfaces/IGdCostingImportService.cs`
- Create: `Services/Implementations/GdCostingImportService.cs`
- Modify: `Controllers/SpreadsheetImportController.cs`
- Modify: `Program.cs` (DI registration)

**Interfaces:**
- Consumes: `GdCostingSheetReader.Read`, `GdCostingMapping.CleanHsCode`,
  `ImportCostingCalculator.Compute`, `ICompanyAccessGuard`.
- Produces:
  - `POST api/spreadsheet-import/gd-costing/preview` → `GdCostingPreviewDto`
  - `POST api/spreadsheet-import/gd-costing/commit` → `GdCostingCommitResultDto`
  - `GdCostingLineDto { int SourceRow; string GdNumber; DateTime? GdDate; string Description; string HsCode; decimal Quantity; string? Unit; decimal Cost; decimal SalesTax; decimal Ast; decimal IncomeTax; decimal SellingValue; string Disposition; int? OpeningStockBalanceId; int? ItemTypeId; string? ItemTypeName; decimal MatchedBalanceQuantity; decimal DerivedActualCost; string? MatchNote; }`

- [ ] **Step 1: Matching, in memory**

Load the company's `OpeningStockBalances` (with `ItemType`) and its
`OpeningStockLots` once — 174 balances and 237 lots across all three companies,
so this is small — and match in C#, not SQL. HS cleaning in SQL is string
gymnastics for no gain.

```csharp
// 1. Where the company has lots, GD number + cleaned HS code is exact, and it
//    covers AY and PAK, whose every costing GD is already in OpeningStockLots.
// 2. Otherwise fall back to an OpeningStockBalance whose ItemType.HSCode
//    matches — that is Alpha, which has no lots at all.
// 3. More than one distinct balance is AMBIGUOUS: reported, defaulting to no
//    action. A guess here writes a wrong cost onto the wrong item, which is
//    exactly the failure mode this feature exists to prevent.
```

- [ ] **Step 2: Derive the cost the balance should carry**

A matched balance often holds MORE than this GD — Alpha's HS 4010.1200 has 3,450
on the books against 2,030 on the sheet. Setting the GD's cost alone would
understate it. So scale by unit cost:

```csharp
// Weighted-average unit cost across every line of this sheet matching the
// balance, applied to the balance's OWN quantity:
//
//     unitCost     = SUM(line.Cost) / SUM(line.Quantity)
//     derivedCost  = Money(unitCost * balance.Quantity)
//
// The unit cost is the trustworthy figure from the GD; the quantity is the
// trustworthy figure from the books. It is also idempotent: re-importing the
// same sheet sets the same number, which a running total never would.
// A balance quantity of zero derives a cost of zero.
```

The preview's `MatchNote` must state this in words when the quantities differ:
`"This GD covers 2,030 of the 3,450 on the books; its unit cost was applied to the whole balance."`

- [ ] **Step 3: Preview endpoint**

Multipart file upload, mirroring `PreviewOpeningStock` at
`Controllers/SpreadsheetImportController.cs:138`. Gate with
`[HasPermission("importcosting.sheet.run")]` and assert company access. Preview
takes the FILE; it does not write.

Return per line, plus totals per GD, plus the reader's warnings, plus a count of
each disposition so the operator sees "71 matched, 12 unmatched, 0 ambiguous"
before committing anything.

- [ ] **Step 4: Commit endpoint**

Takes the REVIEWED ROWS, never re-reads the file — so what the operator approved
is what lands. In one transaction:

1. create the `ImportRun` (`Kind = ImportKinds.GdCosting`), which is where the
   existing filtered unique index on `(CompanyId, Kind, FileSha256)` refuses
   identical bytes
2. create one `ImportConsignment` per GD, one `ImportConsignmentLine` per row
3. for each `CostOnly` line group, SET
   `OpeningStockBalance.ActualCostExcludingTax = derivedCost`
4. stamp `ImportConsignmentLine.ImportRunId` after the run is inserted, inside
   the same transaction, so a line never carries a null pointing at nothing

**No stock movement and no GL entry in this part.** `StockPosted` lines are
accepted in the DTO and recorded as `Skipped` with the reason
`"Posting new stock arrives in a later release."` — so the operator is told,
rather than the lines silently vanishing.

Do **not** set `Company.GlLockDate`: nothing here changes a quantity or posts to
the ledger, so the opening import's reason for setting it does not apply.

- [ ] **Step 5: Register in `Program.cs`**

```csharp
builder.Services.AddScoped<IGdCostingImportService, GdCostingImportService>();
```

- [ ] **Step 6: Build**

```bash
dotnet build MyApp.Api.csproj
```

Expected: `0 Error(s)`.

- [ ] **Step 7: Commit**

```bash
git add DTOs/GdCostingImportDtos.cs Services Controllers/SpreadsheetImportController.cs Program.cs
git commit -m "Preview and commit a GD costing sheet as a cost-only backfill" -- DTOs/GdCostingImportDtos.cs Services Controllers/SpreadsheetImportController.cs Program.cs
```

---

### Task 11: The live suite

**Files:**
- Create: `scripts/test_gd_import_costing.py`

Follow `scripts/test_spreadsheet_import.py` for the harness shape: log in, create
throwaway companies, assert, clean up after itself (memory: suites must leave the
local DB at one company).

- [ ] **Step 1: Write the suite**

Sections, each printing its own pass count:

1. **Costing chain** — POST a synthetic one-GD workbook built in-memory with
   `openpyxl`, assert every computed figure against the values in Task 1.
2. **Rate variants** — three workbooks identical but for the rate cells written
   `0.18` / `18%` / `18`; all three must produce the same selling value. This is
   the check that would have caught the 115,270.18 understatement.
3. **Totals row** — a sheet whose last row carries a GD number, a summed cost
   and no description imports one fewer line, and the preview names the skip.
4. **Header aliases** — a sheet with a `PNL/FIN` column inserted (AY's shape)
   reads the same figures as one without, with a relocation note per moved
   column.
5. **Stated override wins** — a line whose sheet selling value is 1.39x cost
   keeps 1.39, not the computed 1.1667, and the preview says so.
6. **Disposition** — build a company with opening balances shaped like Alpha's:
   one HS matching exactly, one where the balance holds more, one where it holds
   less, one absent. Assert 3 `CostOnly` and 1 unmatched, and that the "holds
   more" case derives `unitCost x balanceQuantity`, not the GD's raw cost.
7. **Cost-only writes no movement** — `StockMovements` count is unchanged across
   the commit, and `ValueExcludingTax` is unchanged; only
   `ActualCostExcludingTax` moves.
8. **Idempotence** — committing the same reviewed rows twice leaves the same
   cost, and identical bytes are refused by the run index.
9. **Opening balance nullable contract** — upsert with the cost, then without it
   (unchanged), then with `0` (cleared). Three asserts.
10. **New item** — an opening balance created for an item type that has never
    held stock carries both figures and the item becomes visible in that
    company's `GET /api/itemtypes?companyId=` result.
11. **Tenant isolation** — both new endpoints return 403 for a user with no
    access to the company, and the preview of company A's sheet never matches
    company B's balances.

- [ ] **Step 2: Run it**

```bash
python scripts/test_gd_import_costing.py
```

Expected: `all PASS`, zero failures, and the local database left with the same
three companies it started with.

- [ ] **Step 3: Add the isolation cases to the shared suite**

Add the two new endpoints to `scripts/test_tenant_isolation.py`, as CLAUDE.md
requires for any endpoint taking a `companyId`.

- [ ] **Step 4: Run the full required battery**

```bash
dotnet build MyApp.Api.csproj
```

```bash
python scripts/verify_audit_2026_05_13_security.py
```

```bash
python scripts/test_basic_flows.py
```

```bash
python scripts/test_tenant_isolation.py
```

```bash
python scripts/test_spreadsheet_import.py
```

```bash
python scripts/test_stock_valuation_flow.py
```

```bash
python scripts/verify_permission_sections.py
```

```bash
python scripts/verify_no_production_identifiers.py
```

```bash
cd scripts/gd_costing_harness && dotnet run -c Release
```

Every one must show the count CLAUDE.md's table states. `test_spreadsheet_import`
and `test_stock_valuation_flow` are the two most likely to move — if either
does, the change was not as contained as intended; find out why before going on.

- [ ] **Step 5: Commit**

```bash
git add scripts/test_gd_import_costing.py scripts/test_tenant_isolation.py
git commit -m "Pin the GD costing import and the opening balance cost contract" -- scripts/test_gd_import_costing.py scripts/test_tenant_isolation.py
```

---

### Task 12: The import screen

**Files:**
- Create: `myapp-frontend/src/Pages/GdCostingImportPage.jsx`
- Modify: `myapp-frontend/src/api/` (the spreadsheet-import module)

- [ ] **Step 1: Build the page**

Three steps, following the existing spreadsheet-import screen's shape: choose
company and file → preview → commit.

The preview table is the whole value of this screen. Per line show GD, HS code,
description, quantity, cost, selling value, **disposition** and the match note.
Group by GD with its totals. Above the table, a summary bar reading
`71 will have their cost set · 12 not matched · 0 ambiguous`, and the reader's
warnings in a list — the nine PAK override notes and every totals-row skip
belong in front of the operator, not in a log.

An unmatched line renders greyed with `Not matched — no stock on the books for
this GD and HS code`, and is not committed in this release.

- [ ] **Step 2: Build and verify against a real file**

```bash
cd myapp-frontend && npm run build
```

Copy to `wwwroot/`, reload, and run all three real workbooks through the preview
against companies 4, 5 and 6. Expected, from the reconciliation already done:

- Alpha (company 4): 26 lines, 1 totals row skipped, 17 HS groups matched
- AY (company 5): 51 lines, 2 skipped, 46 of 48 GD+HS groups matched
- PAK (company 6): 83 lines, 6 skipped, 9 override warnings, 71 of 83 matched

**Do not commit** from the screen until those counts are what you see. They are
the numbers the design was verified against; a different count means the reader
or the matcher is wrong.

- [ ] **Step 3: Commit the real import for all three companies**

Only once the counts match. Then verify:

```bash
sqlcmd -S ".\MSSQLSERVER02" -d "MyApp_Importer_Local" -E -I -W -s "|" -Q "SELECT CompanyId, COUNT(*) AS Rows_, SUM(ValueExcludingTax) AS Selling, SUM(ActualCostExcludingTax) AS Cost FROM OpeningStockBalances GROUP BY CompanyId ORDER BY CompanyId;"
```

Expected: the Selling column **unchanged** from the figures in the spec's §1
(20,612,012.50 / 72,736,594.04 / 67,230,068.14) and the Cost column now
non-zero. A moved selling figure means the commit wrote the wrong column — stop
and fix it before anything else.

- [ ] **Step 4: Commit the code**

```bash
git add myapp-frontend/src
git commit -m "Add the GD costing import screen" -- myapp-frontend/src
```

---

### Task 13: Changelog and close-out

- [ ] **Step 1: Append to the README changelog**

Newest first, under a `### 2026-09-12` heading (add bullets if the heading
exists — do not rewrite history). User-facing and honest; no database names, no
company ids.

```markdown
### 2026-09-12

- **GD import costing.** A customs GD costing workbook can now be imported to
  load the actual landed cost of stock. Cost is assessed customs value plus
  duties; the selling value the sheet derives from it is the point at which
  output sales tax absorbs the input tax paid at import. Sales tax, additional
  sales tax and income tax at import are computed and shown but excluded from
  cost.
- Opening balances now carry an **actual cost** beside the selling value, with
  margin shown on the form and in the list.
- One built-in layout reads all three of the workbook variants in use, correcting
  column positions from the sheet's own headings. Totals rows are skipped and
  named, rates written as a fraction, a percentage or a whole number are all
  read correctly, and a manually typed selling value is kept over the computed
  one.
```

- [ ] **Step 2: Re-run the battery from Task 11 Step 4**

All green.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Record the GD import costing work in the changelog" -- README.md
```

- [ ] **Step 4: Ask before pushing**

Do not push. Report what landed and let the maintainer decide.

---

## What this plan deliberately leaves out

Tracked in the spec's §11 as phases 4–7, each getting its own plan:

- **The second valuation pool.** `StockMovement.ActualUnitCostExcludingTax` and
  `ActualValueAdjustmentExcludingTax`, `StockValuation` walking two pools,
  `CurrentPositionAsync`, the dashboard's on-hand actual cost and margin, the
  movements drill-down, the Excel export. Until this lands, actual cost is
  visible on the **opening balance** but not on the **on-hand** position — only
  the walk knows what is left.
- **The adjustment surface.** Both modes, both pools, the mirrored prediction
  step, the three invariants, the no-stock case.
- **Posting new stock** for unmatched lines.
- **GL posting**, `ControlType.ImportClearing` and
  `ControlType.AdvanceIncomeTaxOnImports`, and their seeder.

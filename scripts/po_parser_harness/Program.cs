using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging.Abstractions;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Services.Implementations;

// ─────────────────────────────────────────────────────────────────────────────
// PO parser regression harness.
//
// Runs the REAL RuleBasedPOParser (linked from ../../Services) against JSON
// corpora of PO layouts and asserts, per case, that it extracts the right
// (description, quantity) line items — the only fields the import flow requires.
//
//   dotnet run -c Release                 # runs every corpus/*.json
//   dotnet run -c Release -- path.json    # runs one corpus file
//   dotnet run -c Release -- -v           # verbose (print every failure detail)
//
// Exit code is non-zero if any expected-to-pass case fails, so this can gate a
// change to the parser or import logic. See PO_IMPORT_PARSER_GUIDE.md.
//
// A corpus is a JSON array of cases:
//   { id, category, descHeader, qtyHeader, unitHeader|null, rawText,
//     expectedItems: [ { description, quantity, unit|null } ],
//     allowedFailures?: bool }   // known-ambiguous cases can be tolerated
// ─────────────────────────────────────────────────────────────────────────────

bool verbose = args.Contains("-v");
var explicitFiles = args.Where(a => a.EndsWith(".json", StringComparison.OrdinalIgnoreCase)).ToList();

string harnessDir = AppContext.BaseDirectory;
// Walk up to the project dir (where corpus/ lives) — bin/<cfg>/net9.0.
string projDir = harnessDir;
for (int i = 0; i < 4 && !Directory.Exists(Path.Combine(projDir, "corpus")); i++)
    projDir = Path.GetFullPath(Path.Combine(projDir, ".."));

var files = explicitFiles.Count > 0
    ? explicitFiles
    : Directory.Exists(Path.Combine(projDir, "corpus"))
        ? Directory.GetFiles(Path.Combine(projDir, "corpus"), "*.json").OrderBy(f => f).ToList()
        : new List<string>();

if (files.Count == 0)
{
    Console.Error.WriteLine("No corpus files found. Pass a path or add corpus/*.json.");
    return 2;
}

var parser = new RuleBasedPOParser(NullLogger<RuleBasedPOParser>.Instance);
int grandFail = 0;

foreach (var file in files)
{
    var cases = JsonSerializer.Deserialize<List<Case>>(File.ReadAllText(file),
        new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();

    int pass = 0, tolerated = 0;
    var failures = new List<string>();

    foreach (var c in cases)
    {
        var ruleSet = JsonSerializer.Serialize(new
        {
            version = 1,
            engine = "simple-headers-v1",
            descriptionHeader = c.DescHeader ?? "",
            quantityHeader = c.QtyHeader ?? "",
            unitHeader = c.UnitHeader ?? "",
        });
        var raw = WebUtility.HtmlDecode(c.RawText ?? "");
        var result = parser.Parse(raw, new POFormat { Id = 1, Name = c.Id ?? "", RuleSetJson = ruleSet });

        var got = result.Items.Select(i => (desc: i.Description, qty: i.Quantity)).ToList();
        var exp = (c.ExpectedItems ?? new()).Select(e => (desc: e.Description ?? "", qty: e.Quantity)).ToList();

        bool ok = got.Count == exp.Count;
        if (ok)
        {
            var pool = new List<(string desc, decimal qty)>(got);
            foreach (var e in exp)
            {
                int idx = pool.FindIndex(g => g.qty == e.qty && Strip(g.desc) == Strip(e.desc));
                if (idx < 0) { ok = false; break; }
                pool.RemoveAt(idx);
            }
        }

        if (ok) pass++;
        else if (c.AllowedFailures) tolerated++;
        else
            failures.Add($"  FAIL [{c.Category}] {c.Id}\n" +
                         $"      expected ({exp.Count}): {string.Join(" | ", exp.Select(e => $"{e.desc}#{e.qty}"))}\n" +
                         $"      got      ({got.Count}): {string.Join(" | ", result.Items.Select(i => $"{i.Description}#{i.Quantity}({i.Unit})"))}");
    }

    string name = Path.GetFileName(file);
    string tol = tolerated > 0 ? $", {tolerated} tolerated" : "";
    Console.WriteLine($"{(failures.Count == 0 ? "PASS" : "FAIL")}  {name,-26} {pass}/{cases.Count} passed{tol}, {failures.Count} failed");
    if (verbose) foreach (var f in failures) Console.WriteLine(f);
    grandFail += failures.Count;
}

Console.WriteLine(grandFail == 0 ? "\nALL REGRESSION CORPORA PASSED" : $"\n{grandFail} REGRESSION FAILURE(S) — run with -v for detail");
return grandFail == 0 ? 0 : 1;

// Content match: ignore case, spaces and punctuation; compare the alphanumerics.
static string Strip(string s) => Regex.Replace((s ?? "").ToLowerInvariant(), "[^a-z0-9]", "");

record Case(string? Id, string? Category, string? DescHeader, string? QtyHeader, string? UnitHeader,
            string? RawText, List<Exp>? ExpectedItems, bool AllowedFailures = false);
record Exp(string? Description, decimal Quantity, string? Unit);

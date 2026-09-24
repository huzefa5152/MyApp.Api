# GD Costing Entry Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every GD line (uploaded or typed) is complete before its stock comes up;
problems are shown per line and fixed in the review; the screen reads like the
bill screens.

**Architecture:** One pure rules file (`Helpers/GdLineRules.cs`) defines a
complete line; `GdCostingImportService` adds the context rules (unit vs item,
tariff master, new-item unit agreement), per-line leave-out, a chosen item for
ambiguous lines and a name tie-break, and returns problems per line instead of
throwing. The re-check reuses the manual-lines endpoint with an optional source
identity. The page is rebuilt on `Components/bill/BillStep` + `BillChecklist`,
with a shared line editor and a pure `utils/gdCostingEntry.js`.

**Tech Stack:** .NET 9 / EF Core 9, React 19 + Vite, python live suites, node
test scripts, the offline `scripts/gd_costing_harness`.

Spec: `docs/superpowers/specs/2026-09-25-gd-costing-entry-design.md`.

## Global Constraints

- Required on every line: GD number, GD date, description, HS code, quantity > 0, unit, assessed value > 0.
- A line's unit must match its item's unit through `FbrUomAliases.SameUnit` — no second spelling rule.
- A new item's HS code must be in `HsCodes` (skip the check while the master is empty).
- Never trust the client: commit re-runs every rule on every included line and refuses, naming rows.
- A missing `mode` on the API still means Backfill; the screen sends one explicitly and opens on New arrivals.
- Costing chain, lot-then-HS precedence, SET/ADD maths, GL posting, Inventory opening, `ImportRun` and both duplicate guards are unchanged.
- Mobile-first: `repeat(auto-fit, minmax(min(220px, 100%), 1fr))` grids, 44 px tap targets, 2-line clamp on user text (CLAUDE.md §3).
- Commits: one change each, explicit paths, no AI attribution, author huzefa5152 (repo-local config). Never push.
- A test assertion that encodes the OLD optional-field contract moves in its own commit whose body names each assertion and cites the maintainer's 2026-09-25 decision.

---

## File map

| File | Responsibility |
|---|---|
| `Helpers/GdLineRules.cs` (new) | pure rules: `Check(Line, todayUtc) -> List<Problem>`; field keys |
| `DTOs/GdCostingImportDtos.cs` | `Problems`, `LeaveOut`, `ChosenOpeningStockBalanceId`, `Candidates`, `MatchedItemUnit`, `NewItemResolution/Name/Unit` on the line; `SourceRow/LeaveOut/Chosen...` on the manual line; `Source` on the entry; `ProblemLineCount` |
| `Services/Implementations/GdCostingImportService.cs` | problems per line; choices; name tie-break; chosen candidate; leave-out; commit validation |
| `Services/Interfaces/IGdCostingImportService.cs` | `PreviewManualAsync` gains `GdCostingSourceDto? source` |
| `Controllers/...` (manual preview route) | pass `Source` through |
| `scripts/gd_costing_harness/*` | link `GdLineRules.cs` + `FbrUomAliases.cs`; rule cases |
| `scripts/test_gd_import_costing.py` | new cases; old-contract cases moved |
| `myapp-frontend/src/utils/gdCostingEntry.js` (new) | rules mirror, live costing, line outcome, checklist, summary |
| `scripts/test_gd_costing_entry.mjs` (new) | node tests for the util |
| `myapp-frontend/src/Components/costing/GdLineEditor.jsx` (new) | the line form (typing + Fix) |
| `myapp-frontend/src/Components/costing/GdReviewLines.jsx` (new) | per-GD cards, per-line outcome + actions |
| `myapp-frontend/src/pages/GdCostingImportPage.jsx` | rebuilt on the step pieces |
| `myapp-frontend/src/api/spreadsheetImportApi.js` | `previewGdCostingManual` takes `source` |
| docs | README changelog, CLAUDE.md §5b-15, `GD_IMPORT_COSTING_GUIDE.md`, in-app guide wording |

## Tasks

### Task 1 — `GdLineRules` (pure) + harness cases
- [ ] Link `Helpers/GdLineRules.cs` and `Helpers/FbrUomAliases.cs` into `scripts/gd_costing_harness/gd_costing_harness.csproj`.
- [ ] Add harness checks first (they fail to compile until the file exists): each required field blank -> exactly that field's problem; GD date before 2000 / after tomorrow; quantity 0 / -1; assessed 0; negative duty; rate 100 and -1 refused, 99.99 and 0 accepted; a complete line -> no problems; HS code "  8413.2000 " cleans and passes.
- [ ] Write `GdLineRules.cs`:

```csharp
namespace MyApp.Api.Helpers
{
    public static class GdLineRules
    {
        public static class Fields
        {
            public const string GdNumber = "gdNumber", GdDate = "gdDate", Description = "description",
                HsCode = "hsCode", Quantity = "quantity", Unit = "unit", AssessedValue = "assessedValue",
                Amounts = "amounts", Rates = "rates", SellingValue = "sellingValue", Item = "item";
        }
        public sealed record Problem(string Field, string Message);
        public sealed record Line(string? GdNumber, DateTime? GdDate, string? Description, string? HsCode,
            decimal Quantity, string? Unit, decimal AssessedValue, decimal CustomsDuty, decimal Acd,
            decimal RegulatoryDuty, decimal Others, decimal AddOnProfit, decimal SalesTaxRate,
            decimal AstRate, decimal IncomeTaxRate, decimal? SellingValue);
        public static readonly DateTime EarliestGdDate = new(2000, 1, 1);
        public static List<Problem> Check(Line line, DateTime todayUtc) { /* table in the spec */ }
    }
}
```
- [ ] `cd scripts/gd_costing_harness && dotnet run -c Release` -> all checks pass.
- [ ] Commit: `Define what a complete GD costing line is`.

### Task 2 — service: problems per line, choices, tie-break, leave-out, commit validation
- [ ] DTO additions (additive; see file map).
- [ ] `BuildPreviewAsync(rows, warnings, ..., mode, choices)`: `choices[i]` = (`bool? LeaveOut`, `int? ChosenBalanceId`); default leave-out = Backfill && no match.
- [ ] `Match` returns the candidate ids; when several remain and exactly one has the line's own name (normalised as `NormalizeItemName`), that one wins. `MatchAll` also narrows to a valid chosen candidate and skips left-out rows when pooling. Notes: "Matched by name among N items under HS code X." / "You chose X among N items under HS code X."
- [ ] `LineProblemsAsync(...)`: `GdLineRules.Check` + unit vs matched item + new-item tariff check + catalog-item unit + same-new-item unit agreement. Fills `Problems`, `MatchedItemUnit`, `NewItemResolution/Name/Unit`, `Candidates`.
- [ ] `PreviewManualAsync(lines, companyId, mode, source)`: no throw per line; `SourceRow ?? i+1`; identity from `source` when given; the "no HS code" warning goes (it is a problem now).
- [ ] `CommitAsync`: `LeaveOut` -> Skipped "Left out when importing."; included lines re-checked with the same function -> refuse with rows; ambiguous with a valid chosen candidate -> CostOnly on it; the old "arrives in a later release" note becomes "No stock on the books for this line, and new stock was not asked for."
- [ ] Controller passes `Source`.
- [ ] `dotnet build` 0 errors.
- [ ] Commit: `Check every GD line before its stock comes in`.

### Task 3 — live suite
- [ ] New cases (spec "Tests").
- [ ] Old-contract cases moved in their own commit.
- [ ] Run the suite and the tenant-isolation suite.

### Task 4 — `utils/gdCostingEntry.js` + node test
- [ ] Mirror of `GdLineRules` (same messages), `computeCosting`, `lineOutcome`, `entryChecklist`, `commitSummary`, `toLinePayload`.
- [ ] `node scripts/test_gd_costing_entry.mjs` green.
- [ ] Commit: `Add the costing screen's line rules and summaries`.

### Task 5 — screen
- [ ] `GdLineEditor`, `GdReviewLines`, page on `BillStep`/`BillChecklist`; API `source`.
- [ ] `npm run build`, copy to `wwwroot`.
- [ ] Browser, as the operator, throwaway company: upload the sample sheet; type a 3-line GD; fix a line in review; leave out a line; choose an item; commit; check stock and the consignment; delete the consignment and the company.
- [ ] Commit: `Rebuild Import Costing on the bill screens' steps`.

### Task 6 — docs
- [ ] README changelog, CLAUDE.md §5b-15, runbook sections 3/4/11/12/13, in-app guide wording; delete spec + plan once verified.
- [ ] Commit: `Record the costing entry rules in the changelog and agent rules`.

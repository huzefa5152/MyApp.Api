# GD Import Costing part 1 — where we stopped, and what is left

Stopped 2026-09-12 after Task 7, at the maintainer's request. Resume at Task 8.

Plan: `docs/superpowers/plans/2026-09-12-gd-import-costing-part1.md`
Spec: `docs/superpowers/specs/2026-09-12-gd-import-costing-design.md`
Ledger (git-ignored, survives compaction):
`.superpowers/sdd/2026-09-12-gd-import-costing-part1/progress.md`

**Nothing has been pushed.** Every commit below is local on
`feat/importer-ledger-receipts`.

---

## Done — 7 of 13 tasks, 9 commits

| Task | Commit | What landed |
|---|---|---|
| 1 | `21afdce` | `Helpers/ImportCostingCalculator.cs` — the pure costing chain |
| 2 | `ac91acb` | `Helpers/ExcelImport/PercentRate.cs` — one rate, three spellings |
| 3 | `956b320` | `GdCostingMapping` — layout, header aliases, totals guard (+ its own tests) |
| 4 | `06539e7` | `GdCostingSheetReader` + `GdCostingLayout` — verified on all three real workbooks |
| 5 | `a4fb922` | `GdCosting`/`GdRows` registered and seeded as a built-in layout |
| 6 | `ef2f4ab` | `ImportConsignment` + `ImportConsignmentLine` entities, migration applied |
| 7 | `f484fe2` | Actual cost on the opening-balance API, with margin |

Two of those needed a fix round (`ac91acb`, `956b320` → `06539e7`, `f484fe2`);
all findings were closed before the task was marked complete.

### Verified, not just built

- **Offline harness:** `cd scripts/gd_costing_harness && dotnet run -c Release`
  → **75 checks, 0 failed**. Add `--file "<path>"` to run a real workbook: 78.
- **The three client workbooks read correctly with no operator mapping:**

  | File | Lines | Totals rows skipped | Other warnings |
  |---|---|---|---|
  | Alpha Trader Costing.xlsx | 26 | 1 | — |
  | Ay trader Costing.xlsx | 51 | 2 | 3 column relocations, 1 override |
  | Pak Trade Co Costing.xlsx | 83 | 6 | 9 selling-value overrides |

- **Migration applied** to `MyApp_Importer_Local`. 174 opening rows, 0 with a
  cost yet, `SUM(ValueExcludingTax)` **160,578,674.68 — unchanged**. FK delete
  rules confirmed in `sys.foreign_keys`: Companies `NO_ACTION`, lines→consignment
  `CASCADE`, lines→balance `NO_ACTION`.
- **Layout seeded:** `ImportProfiles` holds `GdCosting` / `GdRows` /
  "Standard GD costing sheet (built-in)" v1, active, default.

### Two plan defects the work exposed, both already fixed

1. **Totals rows are labelled `"Total"`, not blank.** The plan's
   `LooksLikeTotalsRow` required a blank description, so it never fired — Alpha
   read 27 lines instead of 26. Replaced with a normalised totals VOCABULARY on
   `GdCostingMapping`, mirroring `LotRowsMapping.LooksLikeHeadingText`. Task 3's
   `totals.descOnly` test encoded the wrong assumption and was deliberately
   flipped, with a companion check that a product genuinely named "Total" *with*
   a selling value is still kept.
2. **`MarginPercent` reported 0% for a costed-but-unpriced row** while `Margin`
   reported the full negative on the same row. Now `decimal?`, null when there
   is no selling value.

---

## Left — 6 tasks

Briefs are already generated at
`.superpowers/sdd/2026-09-12-gd-import-costing-part1/task-<N>-brief.md`.

| Task | Size | Needs a running backend |
|---|---|---|
| 8 — Opening Balances tab: enter/edit actual cost, margin preview | small | to see it render |
| 9 — Permissions + nav (`importcosting.*`, `stock.actualcost.view`) | small | no |
| 10 — Preview + commit service, the cost-only import | **large** | yes |
| 11 — `scripts/test_gd_import_costing.py` | **large** | yes |
| 12 — The import screen, run the three real files | medium | yes |
| 13 — README changelog | small | no |

### Task 10 is the one to be careful with

It is where matching and the cost-only write live. Two decisions already made
and recorded in the spec:

- **Match per LINE, not per file or per GD.** Alpha's single GD needs both
  dispositions at once: 9 HS groups match its opening balance exactly, 6 where
  the balance holds more, 2 where it holds less, 8 absent entirely.
- **A matched balance often holds more than the GD covers**, so the commit
  applies the GD's *unit* cost to the *balance's* quantity
  (`unitCost × balanceQuantity`), not the GD's raw cost. Trustworthy figure from
  each side, and idempotent on re-import. The preview must say so in words.

### Six things Task 11's suite MUST cover

These came out of the Task 6 review and are the reason this list exists rather
than living only in a subagent's report:

1. **The company-delete trap, exercised for real.** `CompanyService.DeleteAsync`
   gained a consignment cleanup that nothing currently exercises. Create a
   company, give it a consignment with a line pointing at a real
   `OpeningStockBalance`, delete the company, assert success. This exact class of
   bug has produced a 500 twice in this codebase (`CompanyItemTypeSettings`,
   `DeliveryItems.InvoiceItemId`).
2. **Duplicate `GdNumber`** surfaces as a duplicate, and is NOT swallowed by
   `NumberAllocationRetry.IsUniqueViolation` — that predicate matches 2601/2627
   from *any* index and has misdiagnosed a collision before.
3. **Cross-tenant:** a line must never match another company's balance. Also add
   both new endpoints to `scripts/test_tenant_isolation.py`.
4. **Cost-only** writes `ActualCostExcludingTax` and leaves `ValueExcludingTax`
   untouched.
5. **Skipped / Ambiguous** populate `DispositionNote` and leave the pointers unset.
6. **Rounding fidelity** — the `(18,2)` columns must agree with the calculator's
   `Money()` (`AwayFromZero`, 2dp).

Plus the opening-balance nullable contract, in three steps: set a cost; post
again omitting the field (**unchanged**); post `0` (**cleared**). Step two is the
only one that proves the conditional assignment does anything.

---

## Before resuming — read this

**Another Claude session is editing this working tree.** At the point we stopped
it held roughly 1,034 uncommitted lines across `Controllers/StockController.cs`,
`DTOs/StockDtos.cs`, `Helpers/StockExcelBuilder.cs` and
`scripts/stock_export_harness/Program.cs`, adding `LotRef`/`LotDate` to the stock
export. That is not part of this plan.

- Commit `f484fe2` was checked and touched only `DTOs/StockDtos.cs` (13+/2−) —
  none of that work was swept up.
- **Two of those files are shared with this plan** (`StockDtos.cs`,
  `StockController.cs`). Tasks 8 and 10 both touch them.
- Every commit must stage explicit paths. Never `git add -A`.
- To verify a build without their in-progress work skewing it, build the commit
  in a detached worktree, as was done for Task 7.

**Backend:** stopped. Start it with the command in `CLAUDE.md`; it picks
`MyApp_Importer_Local` from the branch automatically. It holds a file lock on the
apphost, so either stop it before `dotnet ef migrations add` or build to a side
output directory.

**Commit trailers are inconsistent.** Some read `Claude Sonnet 5`, some
`Claude Opus 5`, one `Claude Haiku 4.5` — subagents followed their own session
attribution. Separately, this conflicts with the global `CLAUDE.md` rule
forbidding AI attribution entirely. One rebase can strip or standardise them all
whenever you decide which you want.

## Deferred minors, none blocking

- `ImportCostingCalculator` clamps rates at ≥ 0 but not `AssessedValue`,
  `Others` or `AddOnProfit`. No real file exercises a negative.
- `PercentRate`'s negative-rate guard is untested.
- The zero-hits `Resolve` test returns at the `headings.Count == 0` outer guard,
  so it passes without reaching the branch it is named for.
- The skip-reason wording keys off raw description length, not the normalised
  one, so a punctuation-only description would report the wrong reason.
- `DefaultImportLayouts.SeedAsync` has no automated test for any of its three
  profiles — pre-existing, not a regression.
- `ImportConsignmentLine.ItemTypeId`'s doc comment overstates its precedent;
  `InvoiceItem.ItemTypeId` does carry a real FK.

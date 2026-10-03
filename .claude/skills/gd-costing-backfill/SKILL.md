---
name: gd-costing-backfill
description: Use when an importer company needs GD costing work the Import Costing screen no longer offers or cannot undo - "backfill landed cost", "price the opening stock from the GD sheets", "onboard an importer's GD history", "re-import a wrong GD", "delete / fix a GD consignment", "a GD went onto the wrong item". Drives the app's own API (preview, review with the maintainer, commit) on a local rehearsal copy first and then on production with the operator's own login. Never writes production SQL; SQL is read-only, for checking.
---

# GD costing: backfill and repairs

Project-local to **MyApp.Api**, branch `feat/importer-ledger-receipts` (the
importer installation). Read `CLAUDE.md` sections 5b-15 and 5b-17 first.

The Import Costing screen only does **New goods arrived** (2026-10-03). Backfill —
setting the landed cost of stock that was ALREADY on the books when a company came
on board — and repairs to past imports are done with this skill.

## Non-negotiable rules

1. **Never write production SQL.** A GD import is not one table: it writes
   balances, stock movements, journal entries, the monthly COGS relief, the FIFO
   GD pools and the audit trail in one transaction. Rows written by hand skip the
   ledger and the stock walk and produce numbers that look right and disagree with
   the books. SQL against production is `SELECT` only, with `-K ReadOnly`.
2. **Every write goes through the app's API**, as a logged-in user, so the same
   guards, postings and audit rows apply as on the screen.
3. **Rehearse on a local copy of today's production backup first**, show the
   maintainer the result line by line, and only then repeat on production. Every
   production write needs the maintainer's explicit yes for THAT run.
4. **Never type a production password.** The operator logs in to the importer
   site in the built-in browser; you call the API from that page with the
   session's own token (`localStorage.getItem("token")`).
5. **Never print or commit credentials or production identifiers.**
   `production.databases.json` (gitignored) holds the read-only connection; read
   it inside a script, never echo it. Placeholders only in anything tracked.

## When Backfill is the right tool — and when it is not

| Situation | Tool |
|---|---|
| A NEW GD's goods arrived | The screen (New goods arrived). Not this skill. |
| Company onboarding: stock is on the books (opening-stock import), GD sheets exist for it, margins need real landed cost | **Backfill** (below) |
| The client's month-end stock sheet disagrees with the books | Stock Dashboard → Reconcile to sheet (restatement) |
| A GD was imported against the wrong company / wrong item / twice | Delete the consignment, re-import (below) |
| One line's figures were typed wrong | `PUT /api/import-consignments/{id}/lines/{lineId}` |
| One item holds several products | Stock Dashboard → Split |

Backfill **SETS** a matched balance's actual cost to the GD's unit cost x the
quantity on the books. It moves no quantity and posts **no** journal entry. Never
backfill a GD whose goods are not yet on the books — they would never appear.

## Step 1 — Local rehearsal copy

1. Download today's production backup to `C:/Users/Public/SqlRestoreStaging/`.
2. Restore it under a scratch name (never over a branch database):
   `RESTORE FILELISTONLY` gives the logical names; `RESTORE DATABASE <scratch> ...
   WITH REPLACE, MOVE ...`.
3. Put a GENERATED password on `Users.Id = 1` of the scratch copy only (bcrypt),
   saved in the session scratchpad, never in the repo.
4. Build to a scratch folder (`dotnet build -o <scratch>/buildout`; the user's
   running backend locks `bin/`) and run it on a free port (5135 is usually
   taken) with `ASPNETCORE_ENVIRONMENT=Development`,
   `ConnectionStrings__DefaultConnection=<scratch db>`,
   `Database__AutoMigrate=false`, `ASPNETCORE_WEBROOT=<repo>/wwwroot`.
5. Login is rate-limited to 10/min: reuse one token.

## Step 2 — Preview (rehearsal)

```
POST /api/spreadsheet-import/gd-costing/preview?companyId=<id>&profileId=<GdCosting profile>&mode=backfill
multipart: file=<the GD costing workbook>
```

The profile id comes from `GET /api/import-profiles?kind=GdCosting&companyId=<id>`
(the default one). Read back, per line: `disposition` (`cost-only` = prices a
balance, `stock-posted` = nothing on the books, `ambiguous` = several items share
the code, `skipped`), `itemTypeName`, `derivedActualCost`, `overwriteWarning`,
`costPlausibilityWarning`, `rateWarning`, `problems`; and the preview's
`blockingErrors` / `warnings`.

Backfill decisions are the maintainer's, line by line:

- **ambiguous** — choose with `chosenOpeningStockBalanceId` (one of `candidates`)
  or leave out. Backfill never guesses.
- **stock-posted** — goods not on the books. Normally leave out (`leaveOut: true`);
  create stock only if the maintainer confirms the goods really are held
  (`confirmNewStock: true` and commit with `createMissingStock: true`).
- **overwriteWarning** — an earlier GD already priced this balance; backfill
  REPLACES it. Confirm.
- **costPlausibilityWarning** — the GD's unit cost does not fit the stock it lands
  on (a cheap part priced across a whole bin). Leave out unless explained.

Apply the decisions by re-checking the same lines:

```
POST /api/spreadsheet-import/gd-costing/preview-manual?companyId=<id>&mode=backfill
{ "lines": [ previewLineToPayload(line, { leaveOut, chosenOpeningStockBalanceId, confirmNewStock }) ... ],
  "source": { fileName, fileSha256, fileSizeBytes, importProfileId, profileVersion } }
```

Passing `source` keeps the run recorded against the file, so the same file cannot
be imported twice. Present the result to the maintainer as a table: row, GD line,
item, quantity on the books, cost before, cost after.

## Step 3 — Commit (rehearsal), then verify

```
POST /api/spreadsheet-import/gd-costing/commit
{ companyId, importProfileId, profileVersion, fileSha256, fileName, fileSizeBytes,
  lines: <the re-checked preview's lines, unchanged>, createMissingStock: <bool>, mode: "backfill" }
```

Verify on the rehearsal copy:

- `GET /api/stock/company/<id>/onhand` — quantities unchanged; `actualCostExcludingTax`
  moved only on the chosen items.
- Run `scripts/stock_fifo_prod_check` against the scratch copy if the company is
  FIFO, and compare the Stock Dashboard Excel before and after.
- Run `scripts/test_gd_import_costing.py` against the rehearsal API if code changed.

## Step 4 — Production

Only after the maintainer approves the rehearsal result:

1. The operator opens the importer site in the built-in browser and logs in.
2. Call the same three endpoints from the page with `fetch`, the session token
   and the SAME decisions. Send the preview-manual lines (JSON) — the browser
   cannot pick a local file, and preview-manual with `source` keeps the file's
   identity.
3. Compare the production preview with the rehearsal table. Any difference (a new
   item, a new GD since the backup) stops the run; report it.
4. Commit only on the maintainer's explicit yes.
5. Verify with SELECT-only SQL: the new `ImportRuns` / `ImportConsignments` rows
   (`Mode = 'backfill'`), and that no journal entry was written for them.

## Repairs

**Delete a consignment** (wrong company, wrong items, duplicate):
`DELETE /api/import-consignments/{id}`. A New Arrivals consignment's stock
movements and journal entry go with it; it is refused once its goods have been
sold or it has been settled — then the fix is a correcting import or a stock
adjustment, decided with the maintainer, never a SQL delete. After deleting,
re-import the GD through the screen (New Arrivals) or Step 2 (Backfill).

**Fix one line's figures:** `PUT /api/import-consignments/{id}/lines/{lineId}`;
a New Arrivals line's stock movement follows.

**Wrong item on a New Arrivals line (already committed):** delete the consignment
and re-import with the right item / New item chosen, if nothing has been sold
from it; otherwise use Stock Dashboard → Split to move that GD line to the right
item.

## Report back

State what ran where (rehearsal / production), every line's outcome, the
verification figures, and anything left out and why. Never claim a production
change that the SELECT check did not confirm.

# GD Import Costing — entry, validation and review (design)

Date: 2026-09-25. Branch: `feat/importer-ledger-receipts`. Screen: **Purchases ▸
Import Costing** (`/imports/costing`). Builds on
`docs/superpowers/specs/2026-09-12-gd-import-costing-design.md` and
`GD_IMPORT_COSTING_GUIDE.md`; the costing chain, matching precedence, SET/ADD
arithmetic, GL posting and duplicate guards described there do not change.

## Why

The screen works, but it lets stock come up wrong without saying so:

- A line may arrive with no HS code, no unit, no GD date or a zero assessed
  value. Each is accepted. The stock that results cannot be billed to FBR (no
  code, no unit), lands in the wrong month (import date stands in for the GD
  date) or carries no cost.
- On a monthly GD, lines that match nothing on the books are **skipped** unless
  one checkbox is ticked. Alpha's first GD had 9 such lines of 26.
- A line that matches two items under one HS code is **ambiguous** and nothing
  is written. Every item this import creates is keyed by (HS code, name), so
  the second product under a code makes every later GD line for that code
  ambiguous, and those goods never come in.
- The hand-entry form refuses the whole preview on the first bad line; an
  uploaded sheet can only be corrected in Excel and re-uploaded.
- It opens on Backfill, the one-off history load, although every monthly GD is
  New Arrivals.

## Decisions (maintainer, 2026-09-25)

1. Upload and hand entry matter equally, and share one set of rules.
2. Every line, whichever path, must have: **GD number, GD date, description, HS
   code, quantity > 0, unit, assessed value > 0**. A line's unit must match the
   unit of the item it adds to. A line that creates a new item must carry an HS
   code from the tariff master.
3. The screen opens on **New arrivals**. Backfill stays available as a clearly
   labelled one-off, never side by side with the monthly choice.
4. On New arrivals, a line that matches nothing **is created as a new item by
   default**, with a per-line **Leave out**. (On Backfill such a line is left
   out by default and may be included, as PAK's first run did.)
5. Problems are **fixed in the review**: a Fix button opens the same line
   editor hand entry uses; the server re-checks the edited set and keeps the
   uploaded file's name and fingerprint.

## Rules — one place, checked twice

`Helpers/GdLineRules.cs` is the only definition of "a complete line". Pure (no
database), linked into the offline harness.

| Field | Rule | Message (operator's words) |
|---|---|---|
| GD number | not blank | Enter the GD number. |
| GD date | present; not before 2000; not after tomorrow (UTC — Pakistan runs 5 hours ahead) | Enter the GD date. / The GD date is in the future. |
| Description | not blank | Enter what the goods are (the item name). |
| HS code | not blank after cleaning | Enter the HS code. |
| Quantity | > 0 | Enter a quantity above zero. |
| Unit | not blank | Enter the unit (Pcs, Kg, ...). |
| Assessed value | > 0 | Enter the assessed value from the GD. |
| Duties, others, add-on profit | ≥ 0 | ... cannot be negative. |
| Rates | 0 ≤ r < 100 | ... must be a percentage from 0 to 100. |
| Stated selling value | ≥ 0 when given | ... cannot be negative. |

Context rules, in `GdCostingImportService` (they need the books):

- **Unit vs item**: a line that adds to (or sets the cost of) an item whose
  unit is known must name the same unit (`FbrUomAliases.SameUnit`, the one
  spelling rule). "This GD says Kg; ITEM is kept in Pcs."
- **New item's HS code** must exist in `HsCodes` (skipped while the master is
  empty, as the item-type form does).
- **Two lines creating the same new item** (same HS code and name) must agree
  on the unit.
- **Ambiguous** (several items under the HS code): if exactly one of them has
  the line's own name, it is matched and the note says so. Otherwise the line
  needs the operator to **choose the item** from the candidates, or be left
  out. A choice is verified against the candidates at preview AND commit.

The preview reports problems **per line** (`GdCostingLineDto.Problems`, each
`{ field, message }`); nothing throws for a bad line any more. Commit re-runs
every rule on every line not left out and refuses, naming the rows, if any
fails — the screen is never the control.

A line **left out** is still recorded on the consignment as `Skipped` with
"Left out when importing", so the GD record stays complete; nothing is written
to stock for it.

## Wire changes (additive)

- `GdCostingLineDto`: `Problems`, `LeaveOut`, `ChosenOpeningStockBalanceId`,
  `Candidates` (ambiguous only: balance id, item name, unit, quantity),
  `MatchedItemUnit`, `NewItemResolution` (`create` | `reuse` | `adopt`, with
  the catalog item's name/unit when reused).
- `GdCostingManualLineDto`: `SourceRow`, `LeaveOut`,
  `ChosenOpeningStockBalanceId` — so a reviewed line survives a re-check.
- `GdCostingManualEntryDto.Source` (optional: file name, SHA-256, size,
  profile id/version). When present the re-check keeps that identity, so an
  edited upload is still recorded against its file.
- `GdCostingPreviewDto.ProblemLineCount`.
- A missing `mode` still means Backfill on the API (existing callers keep their
  behaviour); the screen always sends one.

## The screen

Built from the shared step pieces the bill screens use (`Components/bill/
BillStep`, `BillChecklist`, `billTheme`), so it reads like New Bill:

1. **Company & what arrived** — company; "New goods arrived on this GD" (default)
   or, behind "One-off: price stock already on the books", Backfill with its
   warning.
2. **The GD** — Upload the costing sheet, or Type it in. Typing uses
   `Components/costing/GdLineEditor` (Identity, Cost, Rates, Selling), with the
   GD header carried from line to line and a red message under any field that
   breaks a rule as it is typed.
3. **Check the lines** — one card per GD with its totals, then every line with
   what will happen to stock: *Adds 50 Pcs to X*, *Sets the cost of X*, *New
   item: X (8413.2000, Pcs)*, *Uses catalog item X*, *Choose the item*, *Needs
   fixing: ...*, *Left out*. Row actions: **Fix** (the same editor, in a
   dialog), **Leave out / Include**, **Choose item** (ambiguous only). The sheet's
   own notes (totals rows skipped, columns relocated) stay listed above.
4. **Bring it in** — plain summary: items getting more stock and how many
   units, new items, lines left out (and that their goods will NOT come in),
   total cost and selling value; then **Bring N lines into stock**. The footer
   checklist says what is left ("Line 7: enter the unit") and jumps to it.

After commit: what happened, with links to **Consignments** and **Stock on
hand**, and "Import another GD".

`utils/gdCostingEntry.js` holds the screen's decisions (field problems mirror,
live costing figures, line status, checklist, summary) — pure, tested by
`node scripts/test_gd_costing_entry.mjs`. The server's answer always wins.

## Unchanged

`ImportCostingCalculator`; lot-then-HS matching; SET vs ADD; the GL entry per
New Arrivals GD; Inventory opening for created stock; `ImportRun` and the two
duplicate guards; permissions (`importcosting.sheet.run`); the Consignments
screen; the workbook layout and its reader.

## Tests

- Offline harness: `GdLineRules` cases (every rule, both sides of each bound).
- Live `scripts/test_gd_import_costing.py`: problems per line on both paths;
  commit refused for an included problem line, accepted once left out; unit
  mismatch; unknown HS code on a new item; two new lines disagreeing on unit;
  name narrows an ambiguous match; a chosen candidate commits, a forged one
  does not; re-check with `Source` keeps the file identity; leave-out writes a
  Skipped line and no stock. Cases that asserted the old optional-field
  behaviour move in their own commit, each named, with the maintainer's
  decision as the reason.
- Node: `scripts/test_gd_costing_entry.mjs`.
- Browser, as the operator, on a throwaway company that is deleted afterwards.

## Not in this round

Near-match suggestions for a new item's name; reusing these rules on the
Consignments line correction; unit conversion between families.

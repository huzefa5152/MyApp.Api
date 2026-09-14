---
name: demo-walkthrough
description: Use when preparing to SHOW this product - "make a demo walkthrough", "capture demo screenshots", "build the pitch deck", "what do I click during the demo", "regenerate the runbook", "rehearse the demo". Drives the local app as the Demo Administrator, screenshots every screen of a three-act story, and writes a presenter runbook and a pitch deck around them. Local only. Read-only against the demo data.
---

# Build the demo walkthrough

Project-local to **MyApp.Api**. Produces two documents from one pass over the
running app:

| | |
|---|---|
| `docs/demo/runbook.html` | For the person driving. Every screen, its route, and what to say while it is up. |
| `docs/demo/deck.html` | For the person who was not in the room. Same screenshots, one claim per slide. Print to PDF to send. |

Both are gitignored — 9 MB of screenshots does not belong in a public repo when
one command rebuilds them.

## Run it

```bash
python scripts/setup_demo_environment.py --reset --demo-password "<pw>"   # if not already built
node scripts/capture_demo_walkthrough.mjs --password "<pw>"
```

First time only:

```bash
cd myapp-frontend && npm install --no-save playwright && npx playwright install chromium
```

`--no-save` is deliberate. The `playwright` package's postinstall downloads
browser binaries, and every one of the four CI deploy pipelines runs an
install — paying that everywhere to support a local demo tool is the wrong
trade. The capture script resolves it out of the frontend's `node_modules`.

## The story is in the script, not here

`ACTS` in `scripts/capture_demo_walkthrough.mjs` is the source of truth: three
acts, one per demo company, because that is also how the product is sold.

1. **Nova Industrial Supplies** — the importer's problem. A GD arrives, it has
   to be costed, the stock has to carry a value, and it has to be filed.
2. **Vertex Engineering** — the everyday trader. Quote → order → challan → bill,
   receipts spread oldest first, the customer ledger.
3. **Prime Wholesale** — the books. Chart of accounts, journals nobody typed,
   and a trial balance that balances.

`say` is written to be **read aloud**, not to describe the screenshot. If you
edit it, keep it that way — a runbook whose narration explains the picture is
useless to someone looking at the real screen.

## Two things that will bite you

**An empty screen is worse than a missing one.** It gets presented. The capture
prints `! looks EMPTY` for any screen whose text matches "No … yet/found", and
you must chase every one down — either the demo data is missing that document
type (fix `scripts/setup_demo_environment.py`) or the screen opens on a filter
that hides it (fix the step's `before`). Six were empty the first time this ran,
including the entire quote → order → challan chain, which is Act 2's centrepiece.

**A screen can be non-empty and still show nothing.** Trial Balance opens on
"This Month" and every demo transaction is older, so it rendered a full page of
0.00 and the detector was happy. Look at the shots; do not just read the log.

`before` handles both cases — `{ uncheck }`, `{ click }`, `{ select, label }`
applied after navigation and before the shot. Prefer a positional selector
(`select >> nth=1`) over the first match when a page has more than one control
of a kind: the FIRST `<select>` on every page is the company picker, and
switching that mid-capture is a different bug.

## Presenting

Sign in in a **private window**, or clear `localStorage` first. Two things are
cached in the browser and both mislead:

- The **company list** — a tab last used by an administrator shows the demo
  account companies it cannot actually open, which looks like a security hole in
  front of an audience and is not one.
- The **permission set**, captured at sign-in. A tab held open across a
  `setup_demo_environment.py` run answers "your role doesn't have permission to
  view the dashboard" while a fresh sign-in works perfectly. Re-running the
  setup re-saves the role; the open tab does not know.

The runbook's own "Before you start" section says this too, because the person
presenting may not be the person who read this file.

## Do not

- Do not point the capture at anything but a local server. It signs in and
  navigates as a real user; the demo password should never leave this machine.
- Do not add steps that WRITE. The capture is read-only so it can be run against
  a demo environment minutes before presenting it. If a step needs to create
  something, seed it in `setup_demo_environment.py` instead.
- Do not commit `docs/demo/`. Regenerate.

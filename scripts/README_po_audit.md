# Daily PO Import Audit

Read-only daily check that surfaces PDFs the parser failed on, so the team can
onboard new vendor formats and fix stale rules incrementally.

## Why API, not FTP

The codebase already records the parser's verdict on every upload in the
`PoImportArchive` table (`ParseOutcome` ∈ ok / no-format / rules-empty /
unreadable / error, plus `ItemsExtracted`, `MatchedFormatId`, `ErrorMessage`)
and exposes it via `GET /api/poimport/archives` gated by the
`poformats.import.viewArchive` permission. Querying the API gives
authoritative parser-outcome data without needing production FTP credentials
or filesystem access.

## One-time setup

```bash
cp scripts/.env.example scripts/.env
# Edit scripts/.env with the real password.
# .env is gitignored — never commit it.
```

Required env vars (or pass via CLI flags):

| Var | Default | Purpose |
|---|---|---|
| `POAUDIT_API_BASE` | `http://localhost:5134` | Production: `https://hakimitraders.runasp.net` |
| `POAUDIT_USERNAME` | `admin` | Any user with `poformats.import.viewArchive` |
| `POAUDIT_PASSWORD` | — | required |
| `POAUDIT_DAYS` | `1` | window |
| `POAUDIT_PAGE_SIZE` | `200` | clamped to 200 server-side |

## Manual runs

```bash
# Last 24h (text report)
python scripts/audit_po_imports.py

# Last 7 days
python scripts/audit_po_imports.py --days 7

# Just the failures we don't have a format for yet
python scripts/audit_po_imports.py --outcome no-format

# Machine-readable for piping into other tools (e.g. the subagent)
python scripts/audit_po_imports.py --json > /tmp/po-audit.json

# Deep-inspect one archive (downloads PDF + extracts tables via pdfplumber)
python scripts/audit_po_imports.py --drill 4

# Drill EVERY recent archive — auto-skips ones we've validated before
python scripts/audit_po_imports.py --days 30 --drill-all
```

Exit code: `0` = all uploads parsed cleanly; `1` = at least one failure or
partial in the window; `2` = script-level error (auth, network).

## Stateful validation (don't re-check old PDFs)

Each successful drill writes the archive id + its `contentSha256` to
`data/po-audit/validated.json`. Subsequent runs skip ids that are already
there, so a daily cron only spends time on NEW uploads.

| Flag | Effect |
|---|---|
| _(default)_ | Skip already-validated ids in `--drill` / `--drill-all`. |
| `--force` | Re-drill even cached ids (use after a parser change). |
| `--show-validated` | Print the current state (id, when, parser/heuristic counts, outcome). |
| `--reset-validated` | Delete `validated.json` so next run re-drills everything. |

The `contentSha256` guard means a re-uploaded PDF (new archive row, same
content) won't be marked as validated by a stale cache entry — different
sha invalidates the cache automatically.

## Via Claude — the `po-import-auditor` subagent

The subagent definition lives at `.claude/agents/po-import-auditor.md`. When
you ask Claude to "audit PO imports" or "check today's PO failures", it
invokes this script and ranks the failures by impact (highest-leverage =
`no-format` onboarding wins).

## Daily schedule

Two options, pick whichever fits your operations:

**Option A — cron / Task Scheduler on a build agent or your laptop.**
```bash
# Every day at 09:00 local
0 9 * * * cd /path/to/repo && python scripts/audit_po_imports.py >> ~/po-audit.log 2>&1
```

**Option B — Claude `/schedule` skill (one-line setup once).** Ask Claude:
> `/schedule` po-import-auditor every weekday at 09:00 Karachi time

That registers a recurring routine which spins up the subagent on cadence and
sends the report to your usual notification path.

## What it surfaces

The report buckets uploads by `ParseOutcome` plus a synthetic `partial-ok`
bucket (status was `ok` but `ItemsExtracted = 0` — silent failure). Per
row it shows: archive Id, company id, uploaded-by user id, timestamp,
matched format id, items extracted, original filename, and the error message
(if any). To inspect a specific PDF, hit:

```
GET /api/poimport/archives/{id}/file
```

with the same auth — the endpoint returns the original PDF bytes.

## Security

- `scripts/.env` is gitignored (added 2026-05-14 to `.gitignore`).
- The audit user only needs the read-only `poformats.import.viewArchive`
  permission — do not use the seed admin's credentials in production.
- The script never logs the password and never echoes it on failure.
- All operations are GETs; the script makes no mutating calls.

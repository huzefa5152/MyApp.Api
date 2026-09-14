---
name: new-trader-company
description: >-
  Create a new company on the LOCAL TraderFbrInvoicingSystem database
  (MyApp_Trader_Local) with the standard FBR sandbox profile (Business Activity
  = Wholesaler, Sector = Wholesale / Retails, Environment = sandbox), then seed
  and test its FBR digital-invoicing scenarios against the FBR sandbox. Use this
  whenever the user asks to "create a new company" / "add a company" / "set up a
  tenant" on the Trader branch for local testing, or to seed/test/verify FBR
  sandbox scenarios for a new or existing Trader company — even if they only give
  a company name and a CNIC/NTN and don't say "skill". Local dev only; never
  touches a production server.
---

# New Trader company + FBR scenario test (local)

Stand up a fresh company on the local Trader database, configured the way every
sandbox-test company here is configured, then seed and run its FBR scenarios.
The whole thing is local: the branch picks the database, and
`Helpers/DevelopmentSqlGuard.cs` refuses to start a Development process against
anything but this machine.

**Why the fixed profile.** Every test company uses **Business Activity =
Wholesaler** and **Sector = Wholesale / Retails**. That `(Activity × Sector)`
pair is the one the repo's FBR tooling is built around — it maps to FBR's six
wholesaler scenarios **SN001, SN002, SN008, SN026, SN027, SN028**, which
`scripts/seed_fbr_scenarios.py` seeds with hand-tuned, FBR-valid recipes and
`scripts/verify_fbr_scenarios.py` validates and submits. So a company on this
profile tests cleanly end-to-end. (A different Activity/Sector widens the
scenario set but needs per-scenario data the tuned recipes don't carry — out of
scope here.)

## Prerequisites — check these first

1. **Be on the Trader branch.** `git rev-parse --abbrev-ref HEAD` must print
   `TraderFbrInvoicingSystem`. Checking out the branch is the whole database
   switch — `Helpers/LocalDevDatabase.cs` reads `.git/HEAD` and maps it to
   `MyApp_Trader_Local`. If you're not on it: `git checkout TraderFbrInvoicingSystem`.
2. **A local Trader backend must be running**, and its startup line must name
   `MyApp_Trader_Local`. The operator's own backend on :5134 is a *different
   checkout* — do not assume it. Start this repo's backend on a free port:
   ```bash
   ASPNETCORE_ENVIRONMENT=Development nohup dotnet run --no-launch-profile \
       --urls "http://localhost:5136" > /tmp/trader-run.log 2>&1 &
   ```
   Wait for `Now listening`, then confirm the log shows
   `Local database selected from branch TraderFbrInvoicingSystem: .\MSSQLSERVER02 / MyApp_Trader_Local`.
   Use `http://localhost:5136` as `--base-url` everywhere below. Kill it with
   PowerShell `Stop-Process` when done (git-bash mangles `taskkill /F` into `F:/`).
3. **NTN + STRN + a sandbox token make the company "FBR-ready".** A challan is
   only billable once its seller AND buyer are FBR-ready
   (`DeliveryChallanService.IsFbrReady`); until then it parks in **"Setup
   Required"** and the seeder's bill create returns *"not in a billable status"*.
   For the seller (this company) FBR-ready needs a non-empty **NTN**, **STRN**,
   province, activity, sector, environment AND **FbrToken**. So to seed and test,
   pass `--ntn` and `--strn` along with `--token` — and the **NTN must be the one
   the sandbox token is bound to at PRAL**, or FBR rejects the submit. (The
   seeder's own buyers already carry NTN/STRN, so only the company side needs
   filling.) Creating the bare company needs none of this; seeding/testing does.

## Steps

Substitute the real values for `<...>`. Company name and CNIC/NTN come from the
user; the port is whatever the backend is on.

### 1. Create the company

```bash
python .claude/skills/new-trader-company/scripts/create_company.py \
    --base-url http://localhost:5136 \
    --name "<Company Name>" --cnic <CNIC> \
    [--ntn <NTN>] [--strn <STRN>] [--token <FBR_TOKEN>]
```

Pass `--ntn --strn --token` when you intend to seed + test (see prerequisite 3);
name + CNIC alone is enough to just create the company. Re-running with the same
name reuses the company and refreshes whichever of NTN/STRN/token you pass.

It logs in as `admin/admin123`, creates the company with the fixed profile
(numbering all start at 1, inventory tracking off), sets the token if given, and
prints the applicable scenarios and `COMPANY_ID=<n>`. Re-running with the same
name reuses that company (and refreshes its token) instead of duplicating it.

### 2. Seed the FBR scenario bills

```bash
python scripts/seed_fbr_scenarios.py --base-url http://localhost:5136 --company-id <COMPANY_ID>
```

Creates one `[SNxxx]`-tagged bill per applicable scenario (idempotent — skips any
already seeded).

### 3. Validate + submit against the FBR sandbox

Only with the company's own sandbox token set and its IP whitelisted at PRAL:

```bash
python scripts/verify_fbr_scenarios.py --base-url http://localhost:5136 --company-name "<Company Name>"
```

It validates then submits each of the six scenarios and prints a per-scenario
pass/fail table with the IRN. All six should reach **Valid → IRN issued** once
PRAL has bound the token to this company's number and whitelisted the IP. A
`[0205]`/token-binding rejection means the token isn't bound to this company —
get the right token, `create_company.py … --token <new>` to refresh it, and
re-run. Use `--dry-run` to validate without submitting.

## Notes

- **Read-only on production.** Everything here targets the local backend +
  `MyApp_Trader_Local`. Never point these at a `*.runasp.net` host.
- **Never log the token.** It is a bearer secret — pass it as an argument, don't
  echo it back or write it into any tracked file.
- The FBR reference API (`SaleTypeToRate`, etc.) wants dates as **dd-MMM-yyyy**
  and 500s on ISO — relevant only if you extend testing beyond the six tuned
  scenarios.

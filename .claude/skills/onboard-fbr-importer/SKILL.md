---
name: onboard-fbr-importer
description: Use when creating and FBR-validating a new importer company in this repo - "onboard a new importer", "create FBR company", "set up <name> with NTN/CNIC", "run the FBR sandbox scenarios for <company>". Creates the company locally, configures FBR integration, decides NTN vs CNIC for sellerNTNCNIC, seeds and runs the applicable sandbox scenarios, and reports each scenario's real FBR verdict. Sandbox/local only - production onboarding requires an explicit production token AND an explicit instruction.
---

# Onboard an FBR importer company

Project-local to **MyApp.Api**. Everything below runs against LOCAL and the FBR
**sandbox**. Production is a separate, explicitly-gated step at the end.

## What you need before starting

| | |
|---|---|
| Company name | e.g. `R & R Engineering (Private) Limited` |
| NTN and/or CNIC | NTN as IRIS issues it (`5326972-8`, letter prefixes like `A113680-1` are real) |
| **Which one FBR files under** | The decisive input — see step 3 |
| Business activity | `Importer`, `Exporter`, … (drives the scenario list) |
| Sector | `All Other Sectors`, `Steel`, `FMCG`, … |
| Province + address | FBR sends both as the seller block |
| Sandbox token | From the client's IRIS profile |

Never write a token into a tracked file. Pass it through the API or the UI.

## 1. Confirm the branch and the database

The branch picks the database (`Helpers/LocalDevDatabase.cs`). Check the startup
line says the database you expect before touching anything.

## 2. Create the company

Use the existing UI or `POST /api/companies`. Copy the shape of a known-good
importer (province, environment, inventory flow) rather than inventing settings.
**Never modify the template company.**

## 3. Decide NTN vs CNIC — the one thing that actually matters

FBR's `sellerNTNCNIC` takes **either** a 7-character NTN **or** a 13-digit CNIC.
Which one a business uses is decided by how it is registered in IRIS, and it is
**not derivable** — a company can hold both and log in with either.

- Ask. Do not guess.
- Enter the full legal number on **General** (print templates use it).
- Enter the exact filed value on **FBR Integration → Seller NTN / CNIC for FBR**.
  Required whenever FBR is on; `Helpers/FbrSellerIdentity` is the single
  resolver, and `CompanyService` refuses a save without it.
- The NTN files **without** its check digit: `5326972-8` → `5326972`. A letter
  is kept: `A113680-1` → `A113680`.

Proven against the sandbox 2026-09-14: NTN `5326972`, CNIC empty, answered
`Validated`. A CNIC is **not** required.

## 4. Configure FBR integration

Province, environment `sandbox`, business activity, sector, token. All are
required when FBR is on and the form routes each error to its own tab.

## 5. Find the applicable scenarios

```
GET /api/fbr/scenarios/applicable/{companyId}
```

Returns the activity/sector pairing from `Services/Tax/TaxScenarios.cs` with each
scenario's own `saleType`, `defaultRate`, `buyerRegistrationType` and SRO
reference. **Use those values — never hardcode a rate.** Importer / All Other
Sectors gives 11: SN001, SN002, SN005, SN006, SN007, SN015, SN016, SN017, SN021,
SN022, SN024.

## 6. Seed and validate

```
POST /api/fbr/sandbox/{companyId}/seed
POST /api/fbr/sandbox/{companyId}/validate-all
```

Or **Settings → FBR Sandbox** in the UI. That screen has its **own** company
picker, separate from the global one — set it, or you will validate the wrong
company (CLAUDE.md §10c).

The seeder builds one bill per scenario with a commodity, sale type and UoM
matched to that scenario (`FbrSandboxService.ScenarioHsCodes`).

## 7. Read the results honestly

`validate-all` returns a row per scenario with FBR's own message. HTTP 200 is
not a pass — `success` and the error code are.

Classify every failure:

| Symptom | Cause | Whose |
|---|---|---|
| `UoM 'X' is not allowed for HS Code Y. FBR accepts: Z` | Item's UoM wrong for its HS code | **Ours** — resolve via `TaxMappingEngine.GetValidUomsForHsCodeAsync`, the one resolver |
| `[0052] HS Code does not match with provided sale type` | The commodity is not what the scenario is about | **Ours** — pick a commodity that genuinely carries that treatment |
| `[0204] Sale type not match with provided scenario` | The **item type's** sale type, not just the line's | **Ours** — each scenario needs its own item type |
| `[0046] Provided Rate is not correct` | Rate not the one FBR publishes | **Ours** — resolve from `saletyperates`, never guess (§10) |
| `[0078] Valid Item Sr. No. is mandatory` | SRO schedule set without a valid serial | **Ours** — resolve via `SROItem` |
| `[0090] Fixed/Notified Value mandatory` on a non-3rd-Schedule line | Sandbox noise | **FBR** — retry before believing it |
| `An unexpected error occurred before the request reached FBR` | Polly circuit breaker (5 failures / 60s, 15s break) | **Ours, transient** — pace the run, retry |

**The sandbox does not always repeat itself** (CLAUDE.md §10b). SN005, SN006,
SN007, SN015 and SN024 have each been accepted once and refused later on a
byte-identical payload. Never conclude from a single run: re-run before calling
a scenario broken, and never ship a catalog value on one green result.

## 8. Definition of done

Every applicable scenario passes, **or** each remaining failure is written down
with its FBR code and the reason it is FBR-side. Record the outcome in the
company's onboarding notes so the next person does not re-investigate.

## 9. Production — explicitly gated

**Do not create or modify anything in production as part of onboarding.**

Only when the user supplies a **production** token *and* explicitly asks:

1. Re-verify the same NTN/CNIC decision — IRIS registration can differ.
2. Create the company in production with the same activity/sector/province.
3. Set environment `production` and the production token.
4. Do **not** seed demo bills in production. Sandbox scenario evidence carries
   over; the seeder is for sandbox only.
5. Verify read-only afterwards: migrations applied, control accounts present,
   the seller identity is what you expect.

Production databases are otherwise read-only (CLAUDE.md).

## Known-good reference

`R & R Engineering (Private) Limited`, NTN `5326972-8`, files as `5326972`,
Importer / All Other Sectors, province Sindh (8), sandbox. 11 scenarios apply;
7–8 pass per run. Open: SN017 (needs a commodity that carries FED in ST mode),
SN021 and SN022 (need the rate resolved from `saletyperates` rather than the
catalog default).

# FBR Sandbox Scenario Testing — Runbook

**Purpose.** This is the reproducible procedure to verify Hakimi Traders' FBR
Digital Invoicing integration end-to-end against the PRAL sandbox. Run through
this **every time** any of these change:
- PRAL token is replaced or rotated
- Server outbound IP changes (hosting migration, NAT gateway update)
- Any change to `FbrService.cs`, `FbrDtos.cs`, or `InvoiceService.cs`
- Before requesting production token promotion from PRAL

## 0. The 6 scenarios that PRAL requires for Hakimi (Wholesaler + Wholesale/Retails)

Per FBR V1.12 Technical Doc §10 (Applicable Scenarios based on Business Activity),
the Wholesaler × Wholesale/Retails row requires **SN001, SN002, SN026, SN027, SN028, SN008**.
Each must produce at least one successful submit in sandbox for production promotion.

| SN | What it tests | Key fields |
|----|---------------|------------|
| **SN001** | Goods at Standard Rate to Registered buyer (B2B wholesale) | `buyerRegistrationType: Registered`, `rate: 18%`, `saleType: Goods at Standard Rate (default)` |
| **SN002** | Goods at Standard Rate to Unregistered buyer | same + **`furtherTax: lineTotal × 4%`** |
| **SN008** | Sale of 3rd Schedule Goods | `saleType: 3rd Schedule Goods`, **`fixedNotifiedValueOrRetailPrice: MRP × qty`**, `salesTax = retail × rate / (1+rate)` |
| **SN026** | End-Consumer Retail, Standard Rate (walk-in POS) | `buyerRegistrationType: Unregistered`, `furtherTax: 0` (exempt) |
| **SN027** | End-Consumer Retail, 3rd Schedule | same as SN008 but end-consumer exemption applies |
| **SN028** | End-Consumer Retail, Reduced Rate | `rate: 5%`, `saleType: Goods at Reduced Rate`, possibly `sroScheduleNo` |

## 1. Pre-flight checklist — before calling FBR

The dots below are **already seeded** in the database (`Company 7: Hakimi Traders FBR Sandbox`)
via `scripts/seed_fbr_scenarios.py`. Re-run that seed if you've nuked the DB.

- [ ] Company 7 has a real `FbrToken` set (not `SANDBOX_PLACEHOLDER_REPLACE_ME`). Check via: `GET /api/companies/7` → `hasFbrToken: true`
- [ ] Company 7 `FbrEnvironment = "sandbox"` (sends to `validateinvoicedata_sb` / `postinvoicedata_sb`)
- [ ] Company 7 `FbrProvinceCode = 8` (Sindh) — resolved via `FbrLookups` table, no live FBR call needed
- [ ] PRAL has confirmed IP whitelisting for `188.40.211.9` (and any secondary outbound IP from MonsterASP)
- [ ] PRAL has confirmed token-to-NTN binding for `NTN 4228937`
- [ ] The 6 SN-tagged bills exist in Company 7 (check via `GET /api/invoices/company/7`; each should have `paymentTerms` starting with `[SN00x]`)

If any of the last three aren't confirmed, the runbook below will fail with
`errorCode: 0401` and the message *"Unauthorized access: …the authorized token
does not exist against seller registration number"*. That's the **signal to
contact PRAL support**, not a bug in our code.

## 2. Run the verification script

### First pass — dry-run (validate only, no commitments)

```bash
python scripts/verify_fbr_scenarios.py --dry-run
```

Expected output when token+IP+NTN are all sorted:
```
SN     Bill #    VALIDATE    SUBMIT      IRN                           ERROR
----------------------------------------------------------------------------------
SN001  90012     PASS        skipped
SN002  90013     PASS        skipped
SN008  90014     PASS        skipped
SN026  90015     PASS        skipped
SN027  90016     PASS        skipped
SN028  90017     PASS        skipped

  Summary: 6/6 scenarios passed, 0 failed
```

If any `FAIL`, check the ERROR column and cross-reference §3 below. Fix the
underlying issue before the second pass.

### Second pass — full submit (commits to FBR, IRN permanently recorded)

```bash
python scripts/verify_fbr_scenarios.py
```

Expected:
```
SN001  90012  PASS  PASS  7000007DI1747119701593
SN002  90013  PASS  PASS  7000007DI1747119701594
... etc.
```

Each IRN is a 22-character identifier. Screenshot the result + the FBR sandbox
portal's scenario-status page (it should flip each SN to "Complete" after the
first successful submit). That screenshot is what PRAL asks for when requesting
production-token promotion.

### Verify idempotency (re-submit protection)

```bash
python scripts/verify_fbr_scenarios.py --submit-only
```

Expected: all 6 return `SUBMIT: PASS` again but with the **same IRN** as before
(our code short-circuits on `invoice.FbrIRN != null` in `PostInvoiceAsync`). No
duplicate submission to FBR.

## 3. Known error codes and what each means

Pulled from FBR Tech Doc V1.12 §8 (Error Codes List) + what our system has seen.

| FBR errorCode | Meaning | Likely cause | Where fixed |
|---------------|---------|--------------|-------------|
| **0000** / "Valid" | Success — IRN issued | — | — |
| **0401** | Unauthorized / token ≠ NTN | PRAL hasn't bound token to your NTN (open support ticket) | PRAL side |
| **0001** | Seller NTN/CNIC required | Company 7 `NTN` is blank | Company Settings |
| **0002** | Buyer NTN/CNIC must be 7 or 13 digits | Our `SanitizeNtn` handles corporate `NN-NN-NNNNNNN-C` | `FbrService.SanitizeNtn` |
| **0008** | Invoice number alphanumeric required | Our `FbrInvoiceNumber` uses prefix + number | `InvoiceService.CreateAsync` |
| **0009** | Buyer NTN/CNIC required for Registered | Client record missing NTN | Client edit |
| **0013** | Sale type not allowed for business activity | Wrong `saleType` for the sector + scenario | Bill item edit |
| **0019** | HS Code required | Item line has no HSCode | Bill item edit |
| **0043** | Invoice date can't be future | Check system clock / invoice date | — |
| **0046** | Rate required | Rate string empty | Bill GSTRate |
| **0058** | Self-invoicing blocked (buyer=seller) | Buyer NTN = Seller NTN | Client list |
| **0073** | Seller Province required | Company `FbrProvinceCode` blank | Company Settings |
| **0074** | Buyer Province required | Client `FbrProvinceCode` blank | Client edit |
| **0090** | Fixed/notified value or Retail Price required | 3rd Schedule item needs `fixedNotifiedValueOrRetailPrice > 0` | Bill item edit (SN008/SN027) |
| **0098** | Quantity required > 0 | Item line qty ≤ 0 | Bill item edit |
| **0102** | Calculated tax mismatch (3rd schedule / further tax) | `ComputeFbrTaxes` applies correct math | `FbrService.ComputeFbrTaxes` |
| **0104** | Percentage tax mismatch | `salesTaxApplicable` rounding error | `FbrService.ComputeFbrTaxes` |
| **0108** | NTN must be 7 digits / CNIC 13 | Same as 0002 | `FbrService.SanitizeNtn` |

### Non-FBR errors our code has also seen

| Symptom | Cause | Fix |
|---------|-------|-----|
| `{"Code":"03","error":"Requested JSON in Malformed"}` | FBR's parser rejects `\uXXXX` escapes and plain `\"` inside string values | `FbrService.JsonOptions` uses `UnsafeRelaxedJsonEscaping`; `SanitizeForFbr` strips `"` / non-ASCII (fix shipped) |
| HTTP 500 without JSON body | FBR internal server error (rare, transient) | Retry once; if persistent, ticket PRAL |
| HTTP 401 `fault.code: 900901` (no FBR wrapper) | Token string wrong / not in WSO2 token store | Re-paste token from IRIS portal |
| `Could not resolve province code` | Code is outside 1..8 range | Check `FbrLookups` has the right row |

## 4. When things have changed — regression discipline

Treat the 6-scenario sweep as the **regression gate** for any FBR-touching
change. Workflow:

1. Make the change (code, config, or data)
2. Build + deploy + restart backend
3. Run `python scripts/verify_fbr_scenarios.py --dry-run`
4. If all 6 still pass → ship. If any regress → investigate, do **not** ship
   to production.

This mirrors the regression-gate pattern we already use for the PO parser
(`POGoldenSamples` + `/api/poformats/{id}/rules` gate).

## 5. Handy commands

```bash
# Re-seed the 6 bills (idempotent; skips any SN already present)
python scripts/seed_fbr_scenarios.py

# Dry-run verify (validate only, no IRN commitment)
python scripts/verify_fbr_scenarios.py --dry-run

# Full verify (validate → submit → IRN captured)
python scripts/verify_fbr_scenarios.py

# Submit-only (use when Validate All was already clicked via the UI)
python scripts/verify_fbr_scenarios.py --submit-only

# Point at a different environment (e.g. staging)
python scripts/verify_fbr_scenarios.py --base-url https://hakimitraders.runasp.net
```

## 6. Known good payloads (reference)

Every bill in Company 7 is pre-configured with exactly the fields FBR expects
per scenario, so the script passes directly once token/IP are sorted. The
seeded payloads are documented inline in `scripts/seed_fbr_scenarios.py`
(search for the `SCENARIOS = [` block). For the full JSON FBR actually receives
on validate, inspect the audit log:

```bash
curl -s "http://localhost:5134/api/auditlogs?take=30" \
  -H "Authorization: Bearer $TOKEN" \
  | python -c "import sys,json; es=json.load(sys.stdin); es=es.get('items',es) if isinstance(es,dict) else es; [print(e['requestBody']) for e in es if (e.get('exceptionType') or '').startswith('FBR_Validate')]"
```

## 7. After production promotion

Once PRAL issues the production token:
1. Update `Company 7 → FbrEnvironment = "production"` and paste the prod token
2. Run `python scripts/verify_fbr_scenarios.py --dry-run` once — should return 6/6 Valid
3. Do **NOT** run full submit in production for these sandbox bills — they're
   demo data. Create a fresh set of real sales bills and submit those.
4. Archive this file's output (the passing dry-run) as compliance evidence.

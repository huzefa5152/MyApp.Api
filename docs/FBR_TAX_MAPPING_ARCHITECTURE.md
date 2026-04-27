# FBR Tax-Mapping Architecture

This document captures the **as-built** design after the 2026-04-27 refactor that
introduced `ITaxMappingEngine`. It is intended for two audiences:

1. New engineers joining the project — read this once, then go straight to the
   four files it points at.
2. Future Huzefa, six months from now, debugging a 0052 / 0077 / 0102 from PRAL.

## 1. The problem

FBR's Digital Invoicing API validates four interlocking facts on every line:

```
HSCode ─┬─→ valid UOM           (HS_UOM)
        └─→ valid Sale Type     (implicit, via business activity)

TransactionType ─→ Sale Type ─→ Rate     (SaleTypeToRate)

Scenario (SN001..SN028) ─→ fixes (Sale Type, Rate, end-consumer flag, 3rd-schedule flag)

Rate ≠ 18 % ─→ SRO Schedule + Item required (FBR rule 0077)
```

A wrong combination on any of these returns `0052 invalid combination` (or one
of its cousins: 0077 missing SRO, 0090 missing retail price, 0102 tax mismatch).

Before this refactor, the four facts were chosen in **three different places**
and could drift:

- `ItemType.SaleType` — set by the operator on the catalog form
- `InvoiceItem.SaleType` — copied from `ItemType` at bill time, but editable
- `FbrService.PostInvoiceAsync` — applied a hard-coded fallback when the line
  was missing a sale type (`"Goods at standard rate (default)"`)

That hard-coded fallback bit us when a 3rd-schedule item flowed through with
no explicit sale type — submission picked the wrong one and FBR rejected with
0052.

## 2. The solution

A single `ITaxMappingEngine` decides the four facts in one place. Three
upstream services consult it instead of inlining their own logic:

```
┌────────────────────┐
│ ItemTypeService    │  on save (companyId optional) → engine.SuggestDefaultUomAsync
│  Create / Update   │     fills FbrUOMId + UOM from FBR HS_UOM if blank
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ ITaxMappingEngine  │
│  ─────────────────│
│  ResolveAsync()    │  picks Scenario, Sale Type, Rate, SRO refs
│  ValidateCombo()   │  pre-flight check before FBR submit
│  GetValidUoms()    │  HS_UOM lookup, cached
│  SuggestDefaultUom │  picks first valid UOM for an HS code
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ FbrService         │  before each Validate / Submit, runs combination
│  PreValidate       │  check via the engine and stops with a clear error
│                    │  before paying for an FBR round-trip
└────────────────────┘
```

The engine itself reads from three sources of truth:

1. **`TaxScenarios.All`** — the canonical SN001..SN028 catalog (sale type,
   default rate, end-consumer flag, 3rd-schedule flag, default SRO). Strings
   are character-exact to **FBR V1.12 §9** so a single drift won't trigger
   error 0013/0093 from PRAL.

2. **`TaxScenarios.Matrix`** — the **(Activity × Sector) → string[] of SNs**
   mapping copied verbatim from **FBR V1.12 §10** (95 rows covering 8
   activities × 13 sectors). `GetApplicable(activities, sectors)` reverse-
   derives applicability from this matrix — proof that a multi-select
   profile (e.g. "Manufacturer + Importer × Steel + Pharma") gets the
   correct UNION of SNs without any scenario-by-scenario hand-coding.

3. **FBR reference APIs** (HS_UOM, SaleTypeToRate) — live data, cached in
   process memory keyed by `(companyId, hsCode)` and `(companyId, txType,
   province, date)`. Cache TTL is process lifetime; a redeploy invalidates
   everything, matching weekly deploy cadence.

## 3. File map

| File | Role |
|------|------|
| `Services/Tax/TaxScenarios.cs` | Static catalog of SN001..SN028 rules |
| `Services/Tax/ITaxMappingEngine.cs` | Engine interface + I/O records |
| `Services/Tax/TaxMappingEngine.cs` | Default implementation, with cache |
| `Services/Implementations/FbrService.cs` | Existing FBR client; calls `engine.ValidateCombinationAsync` from inside `PreValidate` |
| `Services/Implementations/ItemTypeService.cs` | Calls `engine.SuggestDefaultUomAsync` on Create / Update when a `?companyId=` query param is supplied |
| `Controllers/ItemTypesController.cs` | Exposes `GET /api/itemtypes/uoms-for-hs?companyId=&hsCode=` for UI-side narrowing of the UOM picker |
| `Helpers/NumberToWordsConverter.cs` | Rounds amount UP to whole rupees, drops paisa |
| `DTOs/InvoiceDto.cs` (UpdateInvoiceDto) | `Date?` field — operator can correct bill date during edit |

## 4. Database schema (existing — recap, nothing changed here)

```
ItemType
  Id            int           PK
  Name          nvarchar      unique
  HSCode        nvarchar?
  UOM           nvarchar?     human description (matches FBR UOM list)
  FbrUOMId      int?          FK to /pdi/v1/uom
  SaleType      nvarchar?     FBR sale-type label
  FbrDescription nvarchar?
  IsFavorite    bit
  UsageCount    int
  LastUsedAt    datetime?

Invoice (header)
  Id, InvoiceNumber, Date, CompanyId, ClientId, Subtotal, GSTRate, GSTAmount,
  GrandTotal, AmountInWords, PaymentTerms,
  DocumentType (4=Sale, 9=Debit, 10=Credit), PaymentMode,
  FbrInvoiceNumber, FbrIRN, FbrStatus, FbrSubmittedAt, FbrErrorMessage,
  IsFbrExcluded

InvoiceItem (line)
  Id, InvoiceId, DeliveryItemId, ItemTypeId, ItemTypeName, Description,
  Quantity, UOM, UnitPrice, LineTotal,
  HSCode, FbrUOMId, SaleType, RateId,
  FixedNotifiedValueOrRetailPrice (3rd schedule MRP × qty),
  SroScheduleNo, SroItemSerialNo
```

No migration was needed for the engine — it reads existing fields and decides
canonical values. The two operator-facing changes (editable bill date,
amount-in-words ceil) also need no schema change.

## 5. Worked example — Add product → Create invoice

### Add product
```
POST /api/itemtypes?companyId=7
{ "name": "Steel pipe 1\"", "hsCode": "7306.30.0000" }
```
1. `ItemTypeService.CreateAsync` is called with `enrichWithCompanyId = 7`.
2. UOM is blank, HSCode is set → calls `engine.SuggestDefaultUomAsync(7, "7306.30.0000")`.
3. Engine's HS_UOM cache misses → calls FBR `/pdi/v2/HS_UOM?hs_code=7306.30.0000&annexure_id=3`.
4. FBR returns `[ { UOM_ID: 12, Description: "Tonne" } ]`.
5. Engine caches the list and returns the first entry.
6. Service writes `FbrUOMId=12, UOM="Tonne"` into the row.
7. Operator can override later if FBR returned multiple UOMs.

### Create invoice
```
POST /api/invoices  (CreateInvoiceDto)
```
1. `InvoiceService` builds the bill from the linked challan + catalog values.
2. Each line inherits `HSCode + UOM + SaleType + FbrUOMId` from its `ItemType`.
3. Bill saved with no FBR call yet.

### Validate (before FBR)
```
POST /api/fbr/{id}/validate
```
1. `FbrService.ValidateInvoiceAsync` → `PostInvoiceAsync(isSubmit:false)`.
2. `PreValidate` runs — original NTN/province checks, then for each line:
   - Builds `TaxResolutionInput` from the bill + scenario tag in `paymentTerms`.
   - Calls `engine.ValidateCombinationAsync` → returns 0..N error strings.
   - Errors aggregate, surface as a single `Pre-validation failed` response.
3. If clean, the FBR HTTP call goes through. Errors there surface item-level
   per FBR's response shape.

## 6. Caching strategy — why and what

| Cache | Key | TTL | Why |
|-------|-----|-----|-----|
| Province name | `companyId` → `Dict<int, string>` | process lifetime | 8 rows; PRAL endpoint billed |
| FBR UOM list | `companyId` → `Dict<int, string>` | process lifetime | ~80 rows; never changes |
| HS_UOM (engine) | `companyId:hsCode` → `List<FbrUOMDto>` | process lifetime | Per-HS-code; 11 000+ HS codes — cache only what we touch |
| SaleTypeToRate (engine) | `companyId:txType:province:date` → list | process lifetime | Date-bucketed because rates change with budget |

Hot path on a typical bill submit: zero FBR reference calls (everything hot
after the first bill of the day).

## 7. Extensibility — adding a new sector or scenario

### New scenario (e.g. SN029 export goods at zero-rate)
1. Add a row to `TaxScenarios.All` with the SaleType from FBR §9:
   ```csharp
   new("SN029", "Export goods at zero-rate", "Goods at zero-rate", 0m, "Registered",
       IsThirdSchedule:false, IsEndConsumerRetail:false,
       RequiresSroReference:true, DefaultSroScheduleNo:"FIFTH SCHEDULE");
   ```
2. Add applicability rows to `TaxScenarios.Matrix` per FBR §10 — e.g.
   ```csharp
   [(ActExporter, SecAllOther)] = new[] { ..., "SN029" }
   ```
3. The Python seeder picks it up automatically through `/api/fbr/scenarios/applicable/{id}`.

No code change in `FbrService` or `TaxMappingEngine`.

### New (Activity × Sector) row PRAL adds later
Just add one entry to `TaxScenarios.Matrix` with the SN list from §10.
`GetApplicable` and the applicable-scenarios endpoint pick it up
automatically — no schema change, no UI change.

### New sector with different transaction type
Currently the engine hard-codes `DefaultTransactionTypeId = 18` (goods sale).
For services or exports, the engine's `TaxResolutionInput.TransactionTypeId`
already accepts an override — wire it through `FbrService.PostInvoiceAsync`
and surface on the bill UI.

### Company profile (multi-select Activity × Sector)
`Company.FbrBusinessActivity` and `Company.FbrSector` now accept a comma-
separated list (the existing single-string columns work without migration).
The Company form's `MultiSelectChips` writes the CSV; `TaxScenarios.SplitCsv`
reads it tolerantly. The applicable-scenarios endpoint takes the **union**
of SNs across every (activity, sector) cross-product — so a Manufacturer who
also wholesales gets both halves of the matrix at once.

## 8. Failure modes and runbook

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Pre-validation failed: Item N: Rate 5% requires SRO Schedule reference` | Bill is at reduced rate but operator didn't set `SroScheduleNo` on the line | Edit bill → add SRO schedule + serial; or pick a scenario that supplies one (SN028) |
| `Pre-validation failed: Item N: 3rd Schedule items require Fixed/Notified Value or Retail Price` | SaleType is "3rd Schedule Goods" but `FixedNotifiedValueOrRetailPrice` is 0 | Edit bill item → set `FixedNotifiedValueOrRetailPrice = MRP × qty` |
| FBR returns 0052 anyway | FBR added a new combination rule we don't know about yet | Re-read [FBR Tech Doc V1.12 §10](https://gw.fbr.gov.pk/) and add a new TaxScenarios row |
| HS_UOM cache returns stale UOM after FBR catalog update | Process cache TTL = lifetime | Restart the API; or hit `/api/itemtypes/uoms-for-hs?companyId=&hsCode=` and resave |

## 9. References

- FBR Technical Documentation V1.12 (`Downloads/20257301172130815TechnicalDocumentationforDIAPIV1.12.pdf`)
- `FBR_SCENARIO_TESTING.md` — runbook for the 6-scenario verification sweep
- `scripts/verify_fbr_scenarios.py` — automation gate
- Eyecon Consultant scenario testing guide — useful for sector × scenario matrix

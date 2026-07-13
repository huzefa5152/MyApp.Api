# FEATURE — Manager.io bank/cash accounts → MyApp CoA (Path A)

**Status:** ✅ IMPLEMENTED 2026-07-13 (uncommitted). The reusable importer now
splits Manager's rolled-up cash line into the individual bank/cash accounts
automatically. See "As built" below. The Al-Qahera **test company (id 2178)** was
already fixed via the equivalent SQL data op (see "Reference fix"); it stays as-is
(the importer produces the identical result — verified by dry-run).

## As built

- `IManagerImportService.ImportTrialBalanceAsync` gained an optional
  `IReadOnlyDictionary<string,JsonDocument>? summaryDocs` param.
- `ManagerImportService.ImportTrialBalanceAsync`: reads `bank-and-cash-accounts`
  (key/name/`actualBalance`) from the summary docs; **identifies the TB cash
  roll-up line by amount** (Σ bank balances == a single Assets row; name-match
  `Cash & cash equivalents`/… as fallback), **skips** it, and creates a
  **"Bank & Cash Accounts"** group (child of Assets) + one `ControlType.BankCash`
  account per bank with `actualBalance` as opening balance. If the roll-up can't
  be identified it creates them at **zero** balance (keeps the TB line — never
  double-counts) and adds a warning note. Report gains `bankCashAccounts`.
- `ManagerImportController` passes the parsed `summary` dict to the TB import;
  dry-run adds an informational note with the bank/cash count.
- `tools/ManagerImport/Program.cs` (TB mode) loads the summary from the export
  dir and passes it, so the split works from the console too.
- Frontend needs nothing — `ManagerImportPage` renders `report.created` +
  `report.notes` generically.
- **Verified:** Release build 0 err (backend + console); dry-run TB import against
  2178 → `bankCashAccounts +13`, `coaAccounts +54`, note "replacing the rolled-up
  cash line … total assets unchanged", balance sheet Assets 191,140,689.53 =
  Liab 26,845,333.61 + Equity 164,295,355.92 (diff 0.00), rolled back.

---

## Problem

MyApp's receipt/payment **"Received in / Paid from (bank/cash)"** is a dropdown
(`BankCashSelect`) sourced from `GET /accounts/company/{id}/bank-cash` →
`AccountService.GetBankCashAccountsAsync`, which returns only accounts that are

```
IsActive  AND  AccountType == Asset  AND  (ControlType == BankCash  OR  group name contains "bank"/"cash")
```

When that list is empty the form silently falls back to a **free-text box**
("Add Bank & Cash accounts in Chart of Accounts to pick from a list").

The trial-balance import (`ManagerImportService.ImportTrialBalanceAsync`) produced
an **empty** list for Al-Qahera, for two reasons:

1. **The TB collapses all bank/cash into one line.** Manager keeps 13 first-class
   *Bank and Cash Accounts*; the Summary/Trial Balance rolls them into a single
   **"Cash & cash equivalents"** asset line (110,214,210.49). So the individual
   banks (DIB, HBL, TTC-ASKARI, …) never existed in MyApp.
2. **Nothing was flagged.** Even that one account was created with
   `ControlType = None` under a group literally named "Assets" — so it matched
   neither arm of the bank/cash filter.

Manager's dropdown is full because it has those 13 accounts as real entities.

---

## Path A — the importer fix

Import Manager's **`bank-and-cash-accounts`** as MyApp CoA accounts flagged
`ControlType = BankCash`, under a dedicated **"Bank & Cash Accounts"** group, each
with its own opening balance — and **do not** create the collapsed
"Cash & cash equivalents" TB line (its total is now distributed across the 13, so
creating both would double-count assets).

### Data source (Manager local API, Manager Desktop must be open)

`GET /api2/bank-and-cash-accounts` → `bankAndCashAccounts[]`, each:

```jsonc
{ "key": "b9568e9f-…", "name": "AQT - DIB 2024",
  "actualBalance": { "value": 3517780.34, "currency": "PKR" } }
```

`actualBalance.value` is the balance as at the migration date. For Al-Qahera the
13 values sum to **exactly** the TB "Cash & cash equivalents" (110,214,210.49) —
that identity is what keeps the balance sheet reconciled after the swap.

### Where it goes in the ETL

Add a masters-phase step in `ManagerImportService.RunAsync` (before or with the
CoA/TB step), and thread the file through the export + endpoint:

- `scripts/manager_export.py` already pulls summary lists — ensure
  `bank-and-cash-accounts.json` is in the export set.
- New method:

```csharp
// ManagerImportService
public async Task<int> ImportBankCashAccountsAsync(int companyId, JsonElement bankCashList, bool dryRun)
{
    // 1. Ensure an Assets-child group "Bank & Cash Accounts"
    //    (ExternalRef "mgr-bankcash-group", Statement = BalanceSheet, ParentGroupId = Assets group).
    // 2. For each account: upsert by ExternalRef "mgr-bankcash:{key}" →
    //    Account { AccountType = Asset, ControlType = BankCash, IsActive = true,
    //              OpeningBalance = |value|, OpeningBalanceIsDebit = value >= 0 }.
    //    (Asset is debit-normal: positive balance ⇒ IsDebit = true; the one
    //     overdrawn "Cash" account (-10,306,052.29) ⇒ IsDebit = false.)
    // 3. Return count created.
}
```

- In `ImportTrialBalanceAsync` (or the CoA seeding): **skip** any TB asset row that
  is the bank/cash roll-up. Match Manager's rolled-up name(s) — for Al-Qahera the
  line is exactly **"Cash & cash equivalents"**. Make it a small skip-set
  (config/const) since the rolled-up label can differ per business, and log a Note
  when a row is skipped so it's visible in the import report.
- Ordering: import bank/cash accounts **before** the TB step so the skip logic can
  assert the 13 already exist; if the TB runs first, reconcile by deleting the
  roll-up after the 13 are in (as the reference fix does).

### Idempotency & reconciliation guard

- Upsert on `ExternalRef = "mgr-bankcash:{key}"` (group on `"mgr-bankcash-group"`).
- After import, assert `Σ(signed opening balance of the 13) == TB roll-up value`;
  if it drifts, emit a Note (don't hard-fail — a business may have post-date
  movements). This is the "assets total unchanged" invariant.

### FBR / stock

Bank/cash accounts are CoA-only; they never touch stock or FBR. No interaction
with the Non-Inventory Items feature (`FEATURE_NON_INVENTORY_ITEMS.md`) — separate
concern, can ship independently.

---

## Reference fix (already applied to Al-Qahera, id 2178)

Done as a one-off idempotent SQL op (scratchpad `fix_alqahera_bankcash.sql`) —
the concrete shape Path A automates:

1. Created group **"Bank & Cash Accounts"** (ExternalRef `mgr-bankcash-group`) under Assets.
2. Inserted the **13** accounts: `AccountType = Asset`, `ControlType = BankCash`,
   `IsActive`, `OpeningBalance = |actualBalance|`, `OpeningBalanceIsDebit = value>=0`,
   `ExternalRef = mgr-bankcash:{key}`.
3. Deleted the lumped **"Cash & cash equivalents"** (id 1462) — nothing referenced
   it (all 2,062 payments had `BankAccountId = NULL`, zero journal lines).

**Verified:**
- `ASSETS TOTAL` before == after == **191,140,689.53** (reconciliation to the rupee).
- 13 accounts' signed opening balances sum to **110,214,210.49** (= old roll-up).
- Live `GET /api/accounts/company/2178/bank-cash` (admin JWT) returns all **13** with
  correct balances and `controlType = BankCash` → the receipt/payment dropdown now
  populates instead of showing the free-text fallback.

> Note: the SQL fix set the 13 as opening balances only; it did **not** re-point the
> 2,062 imported receipts/payments at a specific bank account (they were imported with
> `BankAccountId = NULL`). Path A could optionally map each Manager receipt/payment to
> its `bank-and-cash-account` by key so historical rows carry the right account — a
> nice-to-have, not required for the dropdown or reconciliation.

---

## Handoff command (paste into the next session)

> Read `FEATURE_MANAGER_BANKCASH_IMPORT.md` and implement **Path A** in the Manager
> importer: pull `bank-and-cash-accounts`, create them as CoA accounts flagged
> `ControlType = BankCash` under an Assets-child "Bank & Cash Accounts" group with
> opening balances = `actualBalance`, and skip the rolled-up cash line in the trial
> balance so assets don't double-count. Idempotent on `ExternalRef = mgr-bankcash:{key}`;
> assert the 13 sum to the roll-up. Al-Qahera (id 2178) is already fixed as the
> reference. Branch `feat/sales-quote-order`, DB `DeliveryChallanDb`; verify build +
> the `/accounts/company/{id}/bank-cash` endpoint; ask before commit and push.

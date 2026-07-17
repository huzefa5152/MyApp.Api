# Manager.io → MyApp Migration Guide (Claude-session runbook)

**Audience:** a fresh Claude session handed a Manager.io `.db` backup and asked to
migrate that business into MyApp and prove it matches Manager (every document +
the trial balance / Summary, to the paisa).

**Read this whole file first.** It is the single source of truth for the migration.
It encodes what was learned building the Al-Qahera migration — don't re-derive it.

---

## 0. TL;DR

1. User installs **Manager Desktop**, imports the `.db`, gives you an **API token**.
2. Export the business: `python scripts/manager_export.py --key <token>` → a `.zip`
   (summary lists + `detail/`). Also export the **Trial Balance** from Manager
   Desktop (Reports → Trial Balance → Copy → save as `.txt`), and pull the
   **perpetual reference data** (CoA, starting balances, tax codes, non-inv items).
3. Stage all of it in a **durable folder** (NOT the session scratchpad — it vanishes).
4. Run the **perpetual GL import** (console `--build-perpetual`) into a fresh company.
5. **Verify** on an ephemeral new-code instance (`:5199`): balance sheet + P&L +
   every account == Manager to the paisa; document counts, journals, transfers,
   bank ledgers all match.
6. Report; commit your work only (isolate from other sessions).

There are **two import modes** — pick perpetual unless told otherwise:

| Mode | What it produces | Use when |
|---|---|---|
| **Perpetual GL** (recommended) | Full company: documents + a journal entry per document + inter-account transfers + manual journals; CoA trued to the TB **to the paisa**; bank/account ledgers show transactions | You want a faithful replica that matches Manager exactly, screen-for-screen |
| **Snapshot** | Documents + the trial balance loaded as **opening balances** (no per-transaction GL); balance sheet matches, but account ledgers are empty | Quick summary-only migration; the UI "Manager.io Import" page does this |

---

## 1. Background — the data model

- A Manager `.db` is **SQLite + protobuf** with **no public schema**. You cannot
  read it directly. It is only readable through **Manager Desktop's local API**
  (`http://127.0.0.1:55667/api2`, header `X-API-KEY: <token>`), which requires
  Manager Desktop running with the business open.
- **Reports (Trial Balance / Balance Sheet / P&L) are HTML-rendered and NOT in the
  API.** The user must export the Trial Balance manually (it's the reconciliation
  target). Everything else is queryable.
- List endpoints (`/sales-invoices`) are **lossy** (display strings, no GUID FKs).
  **Full fidelity = the detail endpoints** `GET /api2/{entity}-form/{key}` — these
  return the raw object with GUID references, line items, tax codes, withholding, etc.
- Key entities: `customers`, `suppliers`, `divisions`, `chart-of-accounts`,
  `tax-codes`, `non-inventory-items`, `bank-and-cash-accounts`, `sales-quotes`,
  `sales-orders`, `sales-invoices`, `delivery-notes`, `purchase-invoices`,
  `credit-notes`, `debit-notes`, `receipts`, `payments`,
  `inter-account-transfers`, `journal-entries`, `withholding-tax-receipts`.

---

## 2. Environment & standing rules

- Branch **`feat/sales-quote-order`**; local DB **`DeliveryChallanDb`** on
  `CRKRL-HUSSAHUZ1\MSSQLSERVER2` (SQL auth = Windows/Trusted). Conn string:
  `Server=CRKRL-HUSSAHUZ1\MSSQLSERVER2;Database=DeliveryChallanDb;Trusted_Connection=True;TrustServerCertificate=True`
- **The user's `:5134` runs OLD compiled code.** Never restart it; never assume it
  reflects your source changes. Verify on an **ephemeral `:5199`** instance you
  build in Release (below).
- **Never auto-commit or auto-push.** Both need a fresh explicit OK each time.
- **Never disturb other sessions' uncommitted work** — the tree often has a parallel
  feature in progress (e.g. bank reconciliation). Commit only your own files.
- Build in **Release** (`-c Release`) so you don't fight `:5134`'s Debug bin lock.
- Frontend build needs **Node 20**: `export PATH="/c/Users/hussahuz/AppData/Roaming/nvm/v20.20.2:$PATH"`.
- **Manager API token — reuse it, don't re-create it.** The user's token is kept in a
  **local file outside the repo** (so sessions reuse it without minting a new one, and
  it never enters git):
  `C:\Users\hussahuz\Downloads\alqahera-perpetual\manager-token.txt`. Load it with:
  ```bash
  export MGR_KEY="$(cat 'C:/Users/hussahuz/Downloads/alqahera-perpetual/manager-token.txt' | tr -d '\r\n')"
  ```
  It works only while **Manager Desktop is running** with the business open (localhost-only).
  If a call returns 401, the token was revoked/expired — ask the user to create a new one
  in Manager (Settings → API) and overwrite that file. **SECURITY: never paste the token
  value into this guide or any committed/repo file, or into a web form — keep it only in
  that local file.**

---

## 3. Step 1 — get the data out of Manager

The user does the Manager-side steps (you can't run Manager). Give them these:

1. Install **Manager Desktop** (free), open it, **Add Business → Import** the `.db`.
2. **Settings → API → create an Access Token.** Copy the token (the `X-API-KEY`).
3. **Reports → Trial Balance** → set the "as at" date → **Copy to clipboard** →
   paste into a text file `Downloads/<business>-trial-balance.txt` (tab-separated).

Then you export (Manager Desktop must stay open):

```bash
export MGR_KEY="$(cat 'C:/Users/hussahuz/Downloads/alqahera-perpetual/manager-token.txt' | tr -d '\r\n')"
# a) documents (summary lists + detail/) → <business>.zip + a folder
python scripts/manager_export.py --key "$MGR_KEY"        # writes summary + detail/ + zip
```

**b) perpetual reference data** (needed for the perpetual build). Pull these into a
`perpetual/` folder (each saved as the raw JSON array / object):
- `chart-of-accounts` (66-ish accounts: key/code/name)
- `bank-and-cash-accounts` (each has `actualBalance` = the reconciliation target)
- `bank-or-cash-account-starting-balance-list` + `balance-sheet-account-starting-balance-list`
- `tax-code-form/{key}` for every tax code used → `{name, rate, account}` → save as
  `taxcodes-resolved.json` (map `guid → {rate, account}`)
- `non-inventory-item-form/{key}` for every non-inv item used → `{name, sale, purchase}`
  → save as `noninv-resolved.json` (map `guid → {sale, purchase}`)

(See the reference Python at the end. The Al-Qahera pull scripts live in the durable
folder `C:\Users\hussahuz\Downloads\alqahera-perpetual\` as a worked example.)

---

## 4. Step 2 — stage durably

**The session scratchpad is per-session and disappears.** Copy everything to a stable
path, e.g. `C:\Users\hussahuz\Downloads\<business>-perpetual\`:
```
<business>-perpetual/
  <business>-export/           # summary *.json at root + detail/*.json  (from manager_export.py)
    detail/
  perpetual/                   # chart-of-accounts, bank/bs-starting-balances,
                               # taxcodes-resolved, noninv-resolved
  <business>-trial-balance.txt # (or keep in Downloads/)
```

---

## 5. Step 3 — run the perpetual import

```bash
BASE="C:/Users/hussahuz/Downloads/<business>-perpetual"
CONN="Server=CRKRL-HUSSAHUZ1\\MSSQLSERVER2;Database=DeliveryChallanDb;Trusted_Connection=True;TrustServerCertificate=True"
dotnet build tools/ManagerImport/ManagerImport.csproj -c Release --nologo   # 0 errors
dotnet run --project tools/ManagerImport -c Release --no-build -- \
  "$BASE/<business>-export" "$CONN" \
  --build-perpetual --ref "$BASE/perpetual" \
  --trial-balance "C:/Users/hussahuz/Downloads/<business>-trial-balance.txt" \
  --company-name "<Business Name>"
```

What `--build-perpetual` does (code: `Services/Implementations/ManagerImportService.PerpetualGl.cs`
+ `RunAsync` in `ManagerImportService.cs`):
1. **RunAsync** creates the company + all documents (clients, suppliers, divisions,
   quotes, orders, delivery challans, invoices, bills, receipts+payments, notes, WHT).
2. **BuildPerpetualGlAsync**:
   - Wipes the company's CoA + GL, then **creates every CoA account keyed by Manager
     GUID** (`ExternalRef = mgr-acct:{guid}`) + the individual **bank/cash accounts**
     (`mgr-bankcash:{guid}`, flagged `BankCash`). Account **type** comes from the TB
     section; **control types** by name (AR/AP/tax/suspense); accounts listed
     **alphabetically**. The **cash roll-up** account (the asset line whose balance ==
     Σ bank balances) is **auto-detected and skipped** (the banks replace it).
   - **Posts every document as a balanced journal entry** — sales invoices/notes
     (`Dr AR (+WHT recv) / Cr income + Cr output tax`), purchase bills (mirror),
     receipts/payments (`Dr/Cr the specific bank / other leg = the line's account`),
     inter-account transfers, and manual journals (verbatim, incl. empty ones).
     Documents post with their **native `SourceDocType`** (so they don't clutter the
     manual-journal screen); only Manager journals are `ManualJournal`.
   - Creates first-class **`AccountTransfer`** rows so the Transfers screen populates.
   - **Migration true-up:** sets each account's **opening balance** so
     `opening + Σ postings == Manager's target` (TB balance / bank actualBalance,
     Retained-earnings un-baked). This absorbs rounding + advance-timing so the CoA
     matches Manager **to the paisa without an extra journal**. Σ targets == 0, and any
     residual is dumped to **Suspense** (a visible, loud safety net).
   - Sets `GlPostingEnabled = true` and `GlLockDate = latest migrated doc date` (the
     **cutover**: migrated history is frozen; only new documents post going forward).

---

## 6. Step 4 — VERIFY (do not skip)

Spin up a new-code instance without touching `:5134`:
```bash
export ASPNETCORE_ENVIRONMENT=Development Database__AutoMigrate=false
nohup dotnet run --project MyApp.Api.csproj -c Release --no-build --no-launch-profile \
  --urls "http://localhost:5199" > /tmp/eph.log 2>&1 &
# wait for "Application started" in /tmp/eph.log
```
Login: `POST /api/auth/login {"username":"admin","password":"admin123"}` → Bearer token.

**Verification checklist (all must pass):**

1. **Balance sheet + P&L to the paisa** — `GET /api/accounts/company/{id}/tree`:
   Assets, Liabilities, Equity, Income, Expenses each `diff 0.00` vs the Manager
   Summary. (Equity is `Retained earnings (starting) + a computed "Current-Year
   Earnings" line`; the total must equal Manager's — the split is expected.)
2. **Individual accounts** — AR, AP, each bank, the tax account, each income/expense
   account match the Manager Summary line.
3. **Document counts** (SQL or the paged endpoints) vs Manager's left-nav counts:
   invoices (+notes), purchase bills, receipts+payments (= Payments rows),
   sales quotes, delivery challans, clients, suppliers, divisions.
4. **Journal Entries** — `/journal-entries/company/{id}/paged?manualOnly=true`
   `totalCount` == Manager's Journal Entries tab count.
5. **Inter-Account Transfers** — `/account-transfers/company/{id}/paged` == Manager.
6. **Bank ledgers** — `/accounts/{bankId}/ledger` returns the receipts/payments with a
   running balance; `closingBalance` == Manager's bank balance.
7. **AR/AP outstanding** reconcile to Manager's aged receivables/payables.

Stop the ephemeral instance when done (`taskkill` the PID on `:5199`).

Al-Qahera reference numbers (the worked example): Assets 191,140,689.53 / Liab
26,845,333.61 / Equity 164,295,355.92 / Income 193,857,817.18 / Expenses
42,050,725.96; 131 journals; 72 transfers; 2307 invoices + 41 notes; 1146 bills; 2062
receipts+payments; 2900 quotes.

---

## 7. The recipe (per-document GL) — reference

- **Line net** = `Qty × UnitPrice` (Qty defaults 1). A line's account = its
  `Account` GUID, or for a non-inventory `Item`, that item's sale/purchase account.
- **Tax is EXCLUSIVE**: `lineTax = net × rate` (rate from the tax code). Verified:
  a line 35 × 3900 = 136,500 × 1.18 = 161,070 = the invoice total.
- **Withholding**: invoice header `WithholdingTax` + `WithholdingTaxPercentage` →
  `Dr Withholding tax receivable`, reduces AR.
- **Sales invoice:** `Dr AR (net+tax−wht) + Dr WHT-recv (wht) / Cr income (per line) + Cr output tax`.
- **Purchase bill:** mirror — `Dr expense/inventory + Dr input tax / Cr AP (net+tax−wht) + Cr WHT-payable`.
- **Receipt:** `Dr bank (ReceivedIn) / Cr each line's Account (AR for allocations)`.
- **Payment:** `Cr bank (PaidFrom) / Dr each line's Account (AP / expense)`.
- **Transfer:** `Cr PaidFrom bank / Dr ReceivedIn bank` (+ an `AccountTransfer` row).
- **Journal:** post its lines verbatim.
- **Starting balances:** banks from `bank-or-cash-account-starting-balance-list`;
  Retained earnings from `balance-sheet-account-starting-balance-list`; the true-up
  overrides these anyway so the accounts land on Manager's figures.

---

## 8. Assumptions & generalization notes (what's robust vs best-effort)

**The true-up guarantees the SUMMARY reconciles for any Manager business** (it forces
every account to the TB; unmapped residual → Suspense = loud failure). Robust:
- **Cash roll-up** is auto-detected by amount (not a hardcoded name).
- Document → JE recipe reads Manager's standard model (general).

**Best-effort (fail loudly via Suspense, or affect only detail — not the summary):**
- **Control-account flags** (AR/AP/tax) are matched by name (`"Accounts receivable"`,
  `"Accounts payable"`, the tax-code account, `"Suspense"`). Manager built-ins are
  consistent in English; a renamed/other-language tax account just won't be flagged →
  affects only the receipt dropdown + future posting, **not** the migration summary.
- **`"Retained earnings"`** by name for the equity un-bake. If renamed, equity is off
  by net profit → shows as a Suspense spike (loud, not silent).
- **Tax assumed exclusive** — a tax-inclusive business would mis-split income vs tax
  per line, but the true-up still fixes the account totals.

**Not yet done:** the perpetual build is **console-only** (not wired into the UI
"Manager.io Import" page, which still does the snapshot). Tested on **one** business —
run a second/third before calling the import section production-safe for any file.

---

## 9. Gotchas (hard-won)

- **`invoiceAmount` is a SUMMARY field, absent from detail forms** — reconcile income
  accounts, not "line-sum vs invoiceAmount", when eyeballing.
- **Two accounts differing only by case** (`Discount`/`DISCOUNT`) — target lookup must
  be **case-sensitive** or one double-counts.
- **Cross-session shared models**: a parallel session may add fields (e.g. bank-rec
  added `ReconciledDate` to `Payment`/`AccountTransfer`) without a migration applied to
  `DeliveryChallanDb` → EF fails "Invalid column name". Fix by `ALTER TABLE … ADD <col>`
  (additive, nullable). Do NOT commit the other session's model change.
- **`ChangeTracker.Clear()` detaches entities** — re-load an entity before mutating it
  after a batch flush.
- **Manager `.db` truncation on download** — verify the file size (a partial download
  is a valid-but-empty 8 KB SQLite). Keep a known-good copy.
- Encoding: Manager text has `→`/non-ASCII; set `PYTHONIOENCODING=utf-8` +
  `sys.stdout.reconfigure(encoding="utf-8")` or the script crashes on Windows cp1252.

---

## 10. File & command reference

| Thing | Where |
|---|---|
| Perpetual GL builder | `Services/Implementations/ManagerImportService.PerpetualGl.cs` |
| Document importer (RunAsync) + snapshot TB import | `Services/Implementations/ManagerImportService.cs` |
| Console runner | `tools/ManagerImport/Program.cs` (`--build-perpetual`, `--trial-balance`, `--fresh`, `--dry-run`, `--company-name`, `--ref`) |
| Balance-sheet current-earnings line | `Services/Implementations/AccountService.cs` (`GetTreeAsync`) |
| GL rebuild cutover | `Services/Implementations/GeneralLedgerService.cs` (`RebuildAsync`, honours `Company.GlLockDate`) |
| Exporter | `scripts/manager_export.py` (+ legacy `techvologix_export.py`, `pull_details.py`) |
| Worked example (data + prototype) | `C:\Users\hussahuz\Downloads\alqahera-perpetual\` (incl. `perp_recon.py` reconciliation prototype) |
| Design/decisions | `the perpetual-GL migration design`, `the Manager bank/cash import design` |

**Committed:** `a27262c` on `feat/sales-quote-order` ("Add full-fidelity Manager.io
perpetual-GL migration").

---

## 11. Reference: pull perpetual reference data (Python)

```python
import os, sys, json, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
B = "http://127.0.0.1:55667/api2"; KEY = os.environ["MGR_KEY"]; OUT = r"<perpetual dir>"
def get(p): return json.load(urllib.request.urlopen(urllib.request.Request(B+p, headers={"X-API-KEY": KEY}), timeout=60))
def rows(d):
    if isinstance(d, list): return d
    return next((v for v in d.values() if isinstance(v, list)), [])
def save(n, o): json.dump(o, open(f"{OUT}/{n}.json","w",encoding="utf-8"), ensure_ascii=False)
save("chart-of-accounts", rows(get("/chart-of-accounts?pageSize=1000")))
save("bank-starting-balances", rows(get("/bank-or-cash-account-starting-balance-list?pageSize=500")))
save("bs-starting-balances", rows(get("/balance-sheet-account-starting-balance-list?pageSize=500")))
# resolve tax codes + non-inv items actually used in the documents:
det = r"<export>/detail"
def d(n): 
    p=os.path.join(det,n+".json"); return json.load(open(p,encoding="utf-8")) if os.path.exists(p) else []
tg, ig = set(), set()
for e in ("sales-invoices","purchase-invoices","credit-notes","debit-notes"):
    for x in d(e):
        for ln in x.get("Lines",[]):
            if ln.get("TaxCode"): tg.add(ln["TaxCode"])
            if ln.get("Item"): ig.add(ln["Item"])
tax = {g: (lambda f: {"name": f.get("Name"), "rate": f.get("Rate"), "account": f.get("Account")})(get(f"/tax-code-form/{g}")) for g in tg}
ni  = {g: (lambda f: {"name": f.get("ItemName") or f.get("Name"), "sale": f.get("SaleItemAccount"), "purchase": f.get("PurchaseItemAccount")})(get(f"/non-inventory-item-form/{g}")) for g in ig}
save("taxcodes-resolved", tax); save("noninv-resolved", ni)
```

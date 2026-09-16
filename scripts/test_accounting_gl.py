#!/usr/bin/env python3
"""
General ledger core (2026-09-16) — the second phase of the accounting module.

Everything that posts later depends on these holding, so they are pinned here
rather than discovered by a report:

  1. an entry is refused unless debits equal credits, every line carries an
     amount on exactly ONE side, and there are at least two of them — a ledger
     that accepts one bad entry is wrong from then on, silently;
  2. the accounts on an entry belong to the entry's company, and are active;
  3. bank and cash accounts are NOT reachable from a manual journal — money
     moves through receipts, payments and transfers so the bank subledger stays
     reconcilable against a statement;
  4. a closed period is closed in BOTH directions: nothing can be added, edited,
     deleted, re-dated INTO it, or re-dated OUT of it;
  5. GL posting is on for every new company and there is no route that turns it
     off;
  6. the read primitives agree with each other — the account ledger's closing
     balance, the chart's balance, and the trial balance are three views of one
     number, and the trial balance foots; and
  7. an account with ledger history can no longer be deleted.

System-posted entries (the read-only half of the Journal Entries screen) are
covered by the posting suite, because nothing here can create one — that is the
point of the guard.

Local only. Creates its own throwaway companies, users and roles, and deletes
all of them at the end.

    python scripts/test_accounting_gl.py --base http://localhost:5104
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal

PASS = 0
FAIL = 0
FAILURES: list[str] = []
PW = "Passw0rd!23"


def check(suite: str, name: str, ok: bool, detail: str = "") -> bool:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        FAILURES.append(f"{suite} :: {name} :: {detail}")
        print(f"  [FAIL] {name}  -- {detail}")
    return ok


def http(method: str, path: str, base: str, token: str | None = None,
         body: dict | list | None = None, timeout: int = 120):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(base.rstrip("/") + path, data=data,
                                 method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except Exception as e:  # noqa: BLE001
        return 0, str(e)


def err_text(payload) -> str:
    if isinstance(payload, dict):
        return str(payload.get("error") or payload.get("message") or payload)
    return str(payload)


def walk_accounts(nodes):
    for n in nodes or []:
        for a in n.get("accounts") or []:
            yield a
        yield from walk_accounts(n.get("children"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5104")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    args = ap.parse_args()
    base = args.base

    print("=" * 78)
    print("  GENERAL LEDGER CORE")
    print("=" * 78)

    status, d = http("POST", "/api/auth/login", base,
                     body={"username": args.user, "password": args.password})
    if status != 200:
        print(f"[!] login failed: HTTP {status} {d}")
        return 2
    seed = d["token"]

    co_a = co_b = None
    role_view = role_full = None
    user_view = user_full = None

    today = datetime.now(timezone.utc).date()
    d_today = today.isoformat()
    d_old = (today - timedelta(days=40)).isoformat()
    d_mid = (today - timedelta(days=20)).isoformat()

    def company_payload(name: str, isolated: bool = False) -> dict:
        return {
            "name": name, "brandName": name, "fullAddress": f"{name} HQ",
            "phone": "+92-21-00000000", "ntn": "1234567", "cnic": "1234567890123",
            "strn": "1234567890123", "fbrSellerRegistrationNo": "1234567",
            "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
            "fbrEnvironment": "sandbox", "fbrProvinceCode": 8,
            "inventoryTrackingEnabled": False, "isTenantIsolated": isolated,
        }

    try:
        # ── 0. setup ─────────────────────────────────────────────────────────
        print("\n=== 0. Setup ===")
        status, co_a = http("POST", "/api/companies", base, token=seed,
                            body=company_payload("[TEMP] GL Suite A"))
        if not check("0", "company A created", status in (200, 201), f"{status} {err_text(co_a)}"):
            return 1
        status, co_b = http("POST", "/api/companies", base, token=seed,
                            body=company_payload("[TEMP] GL Suite B"))
        if not check("0", "company B created", status in (200, 201), f"{status} {err_text(co_b)}"):
            return 1
        a_id, b_id = co_a["id"], co_b["id"]

        for c in (co_a, co_b):
            status, _ = http("PUT", f"/api/companies/{c['id']}", base, token=seed,
                             body=company_payload(c["name"], isolated=True))
            check("0", f"company {c['name'][-1]} marked tenant-isolated", status == 200, f"got {status}")

        for cid, label in ((a_id, "A"), (b_id, "B")):
            status, r = http("POST", f"/api/accounts/company/{cid}/seed-wholesale", base, token=seed)
            check("0", f"company {label} chart seeded", status == 200, f"{status} {err_text(r)}")

        status, flat_a = http("GET", f"/api/accounts/company/{a_id}/flat", base, token=seed)
        status, flat_b = http("GET", f"/api/accounts/company/{b_id}/flat", base, token=seed)
        if not check("0", "account lists readable", status == 200, f"got {status}"):
            return 1

        def pick(flat, **kw):
            for a in flat:
                if all(a.get(k) == v for k, v in kw.items()):
                    return a
            return None

        rent_a = pick(flat_a, name="Rent")
        salaries_a = pick(flat_a, name="Salaries")
        sales_a = pick(flat_a, name="Sales")
        bank_a = pick(flat_a, controlType="BankCash")
        ar_a = pick(flat_a, controlType="AccountsReceivable")
        rent_b = pick(flat_b, name="Rent")
        if not check("0", "handles resolved on both charts",
                     all([rent_a, salaries_a, sales_a, bank_a, ar_a, rent_b]), "a preset account is missing"):
            return 1

        status, role_view = http("POST", "/api/roles", base, token=seed, body={
            "name": "[TEMP] GL Viewer", "description": "temp",
            "permissionKeys": ["accounting.coa.view", "accounting.gl.view", "accounting.journal.view"]})
        check("0", "view-only role created", status in (200, 201), f"{status} {err_text(role_view)}")
        status, role_full = http("POST", "/api/roles", base, token=seed, body={
            "name": "[TEMP] GL Bookkeeper", "description": "temp",
            "permissionKeys": ["accounting.coa.view", "accounting.gl.view", "accounting.gl.manage",
                               "accounting.journal.view", "accounting.journal.create",
                               "accounting.journal.update", "accounting.journal.delete"]})
        check("0", "bookkeeper role created", status in (200, 201), f"{status} {err_text(role_full)}")

        def make_user(username: str, role: dict, companies: list[int]) -> dict | None:
            s, u = http("POST", "/api/users", base, token=seed, body={
                "username": username, "fullName": username, "password": PW, "role": "User"})
            if not check("0", f"{username} created", s in (200, 201), f"{s} {err_text(u)}"):
                return None
            http("PUT", f"/api/users/{u['id']}/roles", base, token=seed, body={"roleIds": [role["id"]]})
            http("PUT", f"/api/usercompanies/user/{u['id']}", base, token=seed, body={"companyIds": companies})
            return u

        user_view = make_user("tempGlViewer", role_view, [a_id])
        user_full = make_user("tempGlBookkeeper", role_full, [a_id])
        if not (user_view and user_full):
            return 1

        def login(username: str) -> str | None:
            s, dd = http("POST", "/api/auth/login", base, body={"username": username, "password": PW})
            if not check("0", f"{username} logged in", s == 200, f"{s} {err_text(dd)}"):
                return None
            return dd["token"]

        t_view = login("tempGlViewer")
        t_full = login("tempGlBookkeeper")
        if not (t_view and t_full):
            return 1

        # ── 1. GL is on, and nothing turns it off ────────────────────────────
        print("\n=== 1. The ledger is on for every company, and stays on ===")
        status, gl = http("GET", f"/api/accounting/gl/company/{a_id}/status", base, token=seed)
        if not check("1", "ledger status readable", status == 200, f"{status} {err_text(gl)}"):
            return 1
        check("1", "a new company posts from day one", gl.get("enabled") is True, f"got {gl.get('enabled')}")
        check("1", "it has a chart", gl.get("hasCoa") is True, f"got {gl.get('hasCoa')}")
        check("1", "an empty ledger balances", gl.get("isBalanced") is True, f"{gl.get('totalDebit')} vs {gl.get('totalCredit')}")
        check("1", "no period is closed yet", gl.get("lockDate") in (None, ""), f"got {gl.get('lockDate')}")

        # There must be no route that disables posting. These are the shapes an
        # operator (or a future session) would reach for first.
        for method, path in [("POST", f"/api/accounting/gl/company/{a_id}/disable"),
                             ("PUT", f"/api/accounting/gl/company/{a_id}/enabled"),
                             ("POST", f"/api/accounting/gl/company/{a_id}/enable")]:
            status, _ = http(method, path, base, token=seed, body={} if method != "GET" else None)
            check("1", f"no {method} {path.rsplit('/', 1)[-1]} route exists",
                  status in (404, 405), f"got {status}")

        # A company update can't smuggle the flag in either.
        status, _ = http("PUT", f"/api/companies/{a_id}", base, token=seed,
                         body={**company_payload(co_a["name"], isolated=True), "glPostingEnabled": False})
        status2, gl2 = http("GET", f"/api/accounting/gl/company/{a_id}/status", base, token=seed)
        check("1", "a company edit can't switch posting off",
              gl2.get("enabled") is True, f"update->{status}, enabled={gl2.get('enabled')}")

        # ── 2. The balanced-entry invariant ──────────────────────────────────
        print("\n=== 2. An entry that isn't a legal entry is refused ===")

        def je(lines, date=d_today, narration="[TEMP] suite"):
            return {"date": date, "narration": narration, "lines": lines}

        def line(acct, dr=0, cr=0, desc=None):
            return {"accountId": acct["id"], "debit": dr, "credit": cr, "description": desc}

        bad_cases = [
            ("debits don't equal credits",
             je([line(rent_a, dr=100), line(sales_a, cr=90)])),
            ("a line with both sides filled",
             je([line(rent_a, dr=100, cr=100), line(sales_a, cr=100)])),
            ("a line with neither side filled",
             je([line(rent_a), line(sales_a, cr=100)])),
            ("a negative amount",
             je([line(rent_a, dr=-100), line(sales_a, cr=-100)])),
            ("only one line",
             je([line(rent_a, dr=100)])),
            ("a zero-value entry",
             je([line(rent_a, dr=0), line(sales_a, cr=0)])),
            ("an account from another company",
             je([line(rent_b, dr=100), line(sales_a, cr=100)])),
            ("a bank account",
             je([line(bank_a, dr=100), line(sales_a, cr=100)])),
        ]
        for label, body in bad_cases:
            status, r = http("POST", f"/api/journal-entries/company/{a_id}", base, token=seed, body=body)
            check("2", f"refused: {label}", status == 400, f"got {status} {err_text(r)}")

        status, gl = http("GET", f"/api/accounting/gl/company/{a_id}/status", base, token=seed)
        check("2", "not one of them reached the ledger", gl.get("entryCount") == 0, f"got {gl.get('entryCount')}")

        # ── 3. A good entry, and the numbering ───────────────────────────────
        print("\n=== 3. A legal entry posts, and the numbering is per company ===")
        status, e1 = http("POST", f"/api/journal-entries/company/{a_id}", base, token=seed,
                          body=je([line(rent_a, dr=15000, desc="Office rent"),
                                   line(salaries_a, cr=15000)], date=d_old,
                                  narration="[TEMP] rent accrual"))
        if not check("3", "a balanced entry is accepted", status == 200, f"{status} {err_text(e1)}"):
            return 1
        check("3", "it is numbered JE-0001", e1.get("reference") == "JE-0001", f"got {e1.get('reference')}")
        check("3", "it is marked manual", e1.get("isManual") is True, f"got {e1.get('isManual')}")
        check("3", "it reports balanced totals",
              Decimal(str(e1["totalDebit"])) == Decimal(str(e1["totalCredit"])) == Decimal("15000"),
              f"{e1['totalDebit']} / {e1['totalCredit']}")

        status, e2 = http("POST", f"/api/journal-entries/company/{a_id}", base, token=seed,
                          body=je([line(rent_a, dr=2500), line(sales_a, cr=2500)], date=d_mid))
        check("3", "the next entry is JE-0002", status == 200 and e2.get("reference") == "JE-0002",
              f"{status} {e2.get('reference') if isinstance(e2, dict) else e2}")

        status, eb = http("POST", f"/api/journal-entries/company/{b_id}", base, token=seed,
                          body=je([line(rent_b, dr=700),
                                   {"accountId": [x for x in flat_b if x["name"] == "Sales"][0]["id"],
                                    "debit": 0, "credit": 700}]))
        check("3", "company B starts its own sequence at JE-0001",
              status == 200 and eb.get("reference") == "JE-0001",
              f"{status} {eb.get('reference') if isinstance(eb, dict) else eb}")

        # ── 4. The read primitives agree ─────────────────────────────────────
        print("\n=== 4. Chart, ledger and trial balance are one number, three views ===")
        status, tree = http("GET", f"/api/accounts/company/{a_id}/tree", base, token=seed)
        tree_accounts = {a["id"]: a for a in
                         list(walk_accounts(tree["balanceSheet"])) + list(walk_accounts(tree["profitAndLoss"]))}
        check("4", "the chart shows the rent movement",
              Decimal(str(tree_accounts[rent_a["id"]]["balance"])) == Decimal("17500"),
              f"got {tree_accounts[rent_a['id']]['balance']}")
        check("4", "and the salaries credit",
              Decimal(str(tree_accounts[salaries_a["id"]]["balance"])) == Decimal("-15000"),
              f"got {tree_accounts[salaries_a['id']]['balance']}")
        check("4", "an untouched account stays at zero",
              Decimal(str(tree_accounts[ar_a["id"]]["balance"])) == Decimal("0"),
              f"got {tree_accounts[ar_a['id']]['balance']}")

        status, led = http("GET", f"/api/accounts/{rent_a['id']}/ledger", base, token=seed)
        if check("4", "the account ledger reads", status == 200, f"{status} {err_text(led)}"):
            check("4", "it shows both movements", led.get("totalCount") == 2, f"got {led.get('totalCount')}")
            check("4", "its closing ties to the chart",
                  Decimal(str(led["closingBalance"])) == Decimal(str(tree_accounts[rent_a["id"]]["balance"])),
                  f"{led['closingBalance']} vs {tree_accounts[rent_a['id']]['balance']}")
            check("4", "the running balance ends at the closing balance",
                  Decimal(str(led["items"][-1]["runningBalance"])) == Decimal(str(led["closingBalance"])),
                  f"{led['items'][-1]['runningBalance']} vs {led['closingBalance']}")
            check("4", "it is ordered oldest first",
                  led["items"][0]["date"] <= led["items"][-1]["date"],
                  f"{led['items'][0]['date']} then {led['items'][-1]['date']}")

        # A window starting after the first entry must roll that entry into the
        # opening figure, not drop it.
        status, led2 = http("GET", f"/api/accounts/{rent_a['id']}/ledger?from={d_mid}", base, token=seed)
        if check("4", "a windowed ledger reads", status == 200, f"got {status}"):
            check("4", "movement before the window rolls into the opening",
                  Decimal(str(led2["openingBalance"])) == Decimal("15000"),
                  f"got {led2['openingBalance']}")
            check("4", "and the closing is unchanged",
                  Decimal(str(led2["closingBalance"])) == Decimal("17500"),
                  f"got {led2['closingBalance']}")

        status, tb = http("GET", f"/api/accounting/reports/company/{a_id}/trial-balance", base, token=seed)
        if check("4", "the trial balance reads", status == 200, f"{status} {err_text(tb)}"):
            check("4", "it foots — debits equal credits",
                  Decimal(str(tb["totalDebit"])) == Decimal(str(tb["totalCredit"])) == Decimal("17500"),
                  f"{tb['totalDebit']} vs {tb['totalCredit']}")
            tb_rows = {r["accountId"]: r for r in tb["rows"]}
            check("4", "each account's closing matches the chart",
                  all(Decimal(str(r["closing"])) == Decimal(str(tree_accounts[r["accountId"]]["balance"]))
                      for r in tb["rows"] if r["accountId"] in tree_accounts),
                  "a trial-balance closing disagrees with the chart")
            check("4", "zero-movement accounts are left out",
                  ar_a["id"] not in tb_rows, "an all-zero row was listed")

        status, gl = http("GET", f"/api/accounting/gl/company/{a_id}/status", base, token=seed)
        check("4", "the ledger as a whole balances", gl.get("isBalanced") is True,
              f"{gl.get('totalDebit')} vs {gl.get('totalCredit')}")
        check("4", "company B's entry stayed in company B", gl.get("entryCount") == 2,
              f"got {gl.get('entryCount')}")

        # ── 5. Edit and delete a manual entry ────────────────────────────────
        print("\n=== 5. A manual entry can be corrected ===")
        status, e2u = http("PUT", f"/api/journal-entries/{e2['id']}", base, token=seed,
                           body=je([line(rent_a, dr=3000), line(sales_a, cr=3000)], date=d_mid,
                                   narration="[TEMP] corrected"))
        if check("5", "an edit is accepted", status == 200, f"{status} {err_text(e2u)}"):
            check("5", "it keeps its number", e2u.get("reference") == "JE-0002", f"got {e2u.get('reference')}")
            check("5", "and carries the new amount",
                  Decimal(str(e2u["totalDebit"])) == Decimal("3000"), f"got {e2u['totalDebit']}")
        status, led3 = http("GET", f"/api/accounts/{rent_a['id']}/ledger", base, token=seed)
        check("5", "the ledger reflects the edit, not both versions",
              led3.get("totalCount") == 2 and Decimal(str(led3["closingBalance"])) == Decimal("18000"),
              f"count={led3.get('totalCount')} closing={led3.get('closingBalance')}")

        status, bad = http("PUT", f"/api/journal-entries/{e2['id']}", base, token=seed,
                           body=je([line(rent_a, dr=3000), line(sales_a, cr=2999)], date=d_mid))
        check("5", "an edit that unbalances is refused", status == 400, f"got {status} {err_text(bad)}")
        status, led4 = http("GET", f"/api/accounts/{rent_a['id']}/ledger", base, token=seed)
        check("5", "and changed nothing",
              Decimal(str(led4["closingBalance"])) == Decimal("18000"), f"got {led4['closingBalance']}")

        # ── 6. Period close ──────────────────────────────────────────────────
        print("\n=== 6. A closed period is closed in both directions ===")
        status, gl = http("PUT", f"/api/accounting/gl/company/{a_id}/lock-date", base, token=seed,
                          body={"lockDate": d_mid})
        if not check("6", "the period closes", status == 200 and gl.get("lockDate"),
                     f"{status} {err_text(gl)}"):
            return 1

        status, r = http("POST", f"/api/journal-entries/company/{a_id}", base, token=seed,
                         body=je([line(rent_a, dr=10), line(sales_a, cr=10)], date=d_mid))
        check("6", "posting INTO the closed period is refused", status == 400, f"got {status} {err_text(r)}")
        status, r = http("POST", f"/api/journal-entries/company/{a_id}", base, token=seed,
                         body=je([line(rent_a, dr=10), line(sales_a, cr=10)], date=d_old))
        check("6", "posting BEFORE it is refused too", status == 400, f"got {status} {err_text(r)}")
        status, r = http("PUT", f"/api/journal-entries/{e1['id']}", base, token=seed,
                         body=je([line(rent_a, dr=16000), line(salaries_a, cr=16000)], date=d_old))
        check("6", "editing a locked entry is refused", status == 400, f"got {status} {err_text(r)}")
        status, r = http("PUT", f"/api/journal-entries/{e1['id']}", base, token=seed,
                         body=je([line(rent_a, dr=15000), line(salaries_a, cr=15000)], date=d_today))
        check("6", "re-dating a locked entry OUT of the period is refused", status == 400, f"got {status} {err_text(r)}")
        status, r = http("DELETE", f"/api/journal-entries/{e1['id']}", base, token=seed)
        check("6", "deleting a locked entry is refused", status == 400, f"got {status} {err_text(r)}")

        status, ok_after = http("POST", f"/api/journal-entries/company/{a_id}", base, token=seed,
                                body=je([line(rent_a, dr=500), line(sales_a, cr=500)], date=d_today))
        check("6", "but an open date still posts", status == 200, f"{status} {err_text(ok_after)}")

        status, r = http("PUT", f"/api/journal-entries/{ok_after['id']}", base, token=seed,
                         body=je([line(rent_a, dr=500), line(sales_a, cr=500)], date=d_mid))
        check("6", "re-dating an open entry INTO the period is refused", status == 400, f"got {status} {err_text(r)}")

        status, gl = http("GET", f"/api/accounting/gl/company/{a_id}/status", base, token=seed)
        check("6", "the ledger still balances after all that", gl.get("isBalanced") is True,
              f"{gl.get('totalDebit')} vs {gl.get('totalCredit')}")

        status, listed = http("GET", f"/api/journal-entries/company/{a_id}/paged?pageSize=50", base, token=seed)
        locked = [x for x in listed["items"] if x["id"] == e1["id"]]
        check("6", "the locked entry is flagged for the UI",
              len(locked) == 1 and locked[0]["isLocked"] is True,
              f"got {locked[0]['isLocked'] if locked else 'not listed'}")

        status, _ = http("PUT", f"/api/accounting/gl/company/{a_id}/lock-date", base, token=seed,
                         body={"lockDate": None})
        check("6", "the period reopens", status == 200, f"got {status}")
        status, r = http("DELETE", f"/api/journal-entries/{ok_after['id']}", base, token=seed)
        check("6", "and the entry deletes once it is open", status in (200, 204), f"got {status}")

        # ── 7. An account with history can't be deleted ──────────────────────
        print("\n=== 7. Ledger history protects its account ===")
        status, r = http("DELETE", f"/api/accounts/{rent_a['id']}", base, token=seed)
        check("7", "an account with journal lines is refused", status == 400, f"got {status} {err_text(r)}")
        check("7", "and the refusal points at deactivating instead",
              "deactivate" in err_text(r).lower(), f"said: {err_text(r)}")

        status, fresh = http("POST", f"/api/accounts/company/{a_id}", base, token=seed, body={
            "name": "[TEMP] Never Posted", "accountGroupId": rent_a["accountGroupId"],
            "accountType": "Expense"})
        check("7", "an account with no history still deletes",
              status == 200 and http("DELETE", f"/api/accounts/{fresh['id']}", base, token=seed)[0] in (200, 204),
              f"create={status}")

        # ── 8. Permissions and tenant scope ──────────────────────────────────
        print("\n=== 8. Permission gates and the tenant guard ===")
        status, _ = http("GET", f"/api/journal-entries/company/{a_id}/paged", base, token=t_view)
        check("8", "journal.view can list entries", status == 200, f"got {status}")
        status, _ = http("GET", f"/api/accounting/reports/company/{a_id}/trial-balance", base, token=t_view)
        check("8", "gl.view can read the trial balance", status == 200, f"got {status}")

        status, _ = http("POST", f"/api/journal-entries/company/{a_id}", base, token=t_view,
                         body=je([line(rent_a, dr=1), line(sales_a, cr=1)]))
        check("8", "without journal.create, writing is refused", status == 403, f"got {status}")
        status, _ = http("PUT", f"/api/journal-entries/{e2['id']}", base, token=t_view,
                         body=je([line(rent_a, dr=1), line(sales_a, cr=1)]))
        check("8", "without journal.update, editing is refused", status == 403, f"got {status}")
        status, _ = http("DELETE", f"/api/journal-entries/{e2['id']}", base, token=t_view)
        check("8", "without journal.delete, deleting is refused", status == 403, f"got {status}")
        status, _ = http("PUT", f"/api/accounting/gl/company/{a_id}/lock-date", base, token=t_view,
                         body={"lockDate": d_old})
        check("8", "without gl.manage, closing a period is refused", status == 403, f"got {status}")

        status, _ = http("PUT", f"/api/accounting/gl/company/{a_id}/lock-date", base, token=t_full,
                         body={"lockDate": None})
        check("8", "gl.manage can change the period", status == 200, f"got {status}")

        # The tenant guard, both shapes: companyId on the route, and an ENTRY id
        # whose company the caller cannot reach.
        status, _ = http("GET", f"/api/journal-entries/company/{b_id}/paged", base, token=t_full)
        check("8", "company B's entries are refused", status == 403, f"got {status}")
        status, _ = http("GET", f"/api/accounting/gl/company/{b_id}/status", base, token=t_full)
        check("8", "company B's ledger status is refused", status == 403, f"got {status}")
        status, _ = http("GET", f"/api/accounting/reports/company/{b_id}/trial-balance", base, token=t_full)
        check("8", "company B's trial balance is refused", status == 403, f"got {status}")
        status, _ = http("GET", f"/api/journal-entries/{eb['id']}", base, token=t_full)
        check("8", "reading company B's entry by id is refused", status == 403, f"got {status}")
        status, _ = http("PUT", f"/api/journal-entries/{eb['id']}", base, token=t_full,
                         body=je([line(rent_b, dr=1), line(rent_b, cr=1)]))
        check("8", "editing company B's entry by id is refused", status == 403, f"got {status}")
        status, _ = http("DELETE", f"/api/journal-entries/{eb['id']}", base, token=t_full)
        check("8", "deleting company B's entry by id is refused", status == 403, f"got {status}")
        status, _ = http("GET", f"/api/accounts/{rent_b['id']}/ledger", base, token=t_full)
        check("8", "company B's account ledger is refused", status == 403, f"got {status}")

        status, after_b = http("GET", f"/api/journal-entries/company/{b_id}/paged", base, token=seed)
        check("8", "company B's entry survived every attempt",
              after_b["totalCount"] == 1 and after_b["items"][0]["reference"] == "JE-0001",
              f"got {after_b['totalCount']} entries")

    finally:
        print("\n=== Cleanup ===")
        for u in (user_view, user_full):
            if u:
                http("DELETE", f"/api/users/{u['id']}", base, token=seed)
        for r in (role_view, role_full):
            if r:
                http("DELETE", f"/api/roles/{r['id']}", base, token=seed)
        for c in (co_a, co_b):
            if c:
                status, _ = http("DELETE", f"/api/companies/{c['id']}", base, token=seed)
                check("cleanup", f"{c['name']} deleted", status in (200, 204), f"got {status}")

    print()
    print("=" * 78)
    if FAIL:
        print(f"  {PASS} passed, {FAIL} FAILED")
        for f in FAILURES:
            print(f"   - {f}")
        print("=" * 78)
        return 1
    print(f"  GENERAL LEDGER SUITE PASSED - {PASS}/{PASS} checks")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())

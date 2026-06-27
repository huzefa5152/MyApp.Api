#!/usr/bin/env python3
"""Phase-2 probe: import a slice of the legacy Data_2021 Chart of Accounts into
our new AccountGroup/Account schema, to prove real client data flows through and
renders as expected.

What it does (read-only on Data_2021; writes only to a throwaway test company):
  • reads ChartOfAccounts (cost centre 1) via sqlcmd,
  • maps AccountType A/L/E/R/C -> Asset/Liability/Expense/Income/Equity and the
    ControlAccountCode chain -> our nested AccountGroup tree,
  • root control accounts (no parent) -> statement groups,
  • every other control account -> a nested group (ExternalRef = legacy code),
  • leaf accounts -> Accounts in their parent group, with opening balances
    (capped per group so the probe stays light),
  • then GETs the tree back and reconciles counts + opening-balance total.

NOTE: the huge party groups (201 Accounts Payable = 605, 303 Accounts Receivable
= 215) are LEDGER PARTIES that map to the Supplier/Client subledger in the real
Phase-3 migration; here we import only a small sample of each, clearly capped.
This probe deliberately models legacy control accounts as GROUPS — the faithful
control-account/subledger mapping is Phase 3.

Usage: python scripts/import_legacy_coa.py [--base URL] [--cap N] [--keep]
By default it KEEPS the test company so you can open it in the UI.
"""
import argparse, json, subprocess, sys, urllib.request, urllib.error
from datetime import datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SQLCMD = r"C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\sqlcmd.exe"
SRV = r"CRKRL-HUSSAHUZ1\MSSQLSERVER2"
LEGACY_DB = "Data_2021"

TYPE_MAP = {  # legacy AccountType -> (our AccountType, statement)
    "A": ("Asset", "BalanceSheet"),
    "L": ("Liability", "BalanceSheet"),
    "C": ("Equity", "BalanceSheet"),
    "R": ("Income", "ProfitAndLoss"),
    "E": ("Expense", "ProfitAndLoss"),
}


def http(method, path, base, token=None, body=None):
    url = base + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def read_legacy():
    q = ("SET NOCOUNT ON; SELECT AccountCode, ISNULL(ControlAccountCode,''), "
         "REPLACE(Description,'|',' '), AccountType, IsControlAccount, "
         "OpeningDebit, OpeningCredit FROM ChartOfAccounts WHERE FKCostCentreID=1 "
         "ORDER BY LEN(AccountCode), AccountCode;")
    out = subprocess.run([SQLCMD, "-S", SRV, "-d", LEGACY_DB, "-E", "-C", "-h", "-1",
                          "-W", "-s", "|", "-Q", q], capture_output=True, text=True)
    if out.returncode != 0:
        print("sqlcmd failed:\n", out.stdout, out.stderr); sys.exit(2)
    rows = []
    for line in out.stdout.splitlines():
        parts = [p.strip() for p in line.split("|")]
        if len(parts) != 7 or not parts[0] or parts[0].startswith("("):
            continue
        code, parent, desc, atype, isctrl, odeb, ocred = parts
        if atype not in TYPE_MAP:
            continue
        rows.append({
            "code": code, "parent": parent or None, "desc": desc or code,
            "atype": atype, "isctrl": isctrl in ("1", "True"),
            "odeb": float(odeb or 0), "ocred": float(ocred or 0),
        })
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--pw", default="admin123")
    ap.add_argument("--cap", type=int, default=8, help="max leaf accounts per group")
    ap.add_argument("--keep", action="store_true", default=True)
    ap.add_argument("--teardown", dest="keep", action="store_false")
    args = ap.parse_args()
    base = args.base

    st, data = http("POST", "/api/auth/login", base, body={"username": args.user, "password": args.pw})
    if st != 200:
        print(f"FATAL: login failed ({st} {data})"); sys.exit(2)
    token = data["token"]

    rows = read_legacy()
    print(f"Read {len(rows)} legacy CoA rows (cost centre 1).")

    suffix = datetime.now().strftime("%Y%m%d%H%M%S")
    st, company = http("POST", "/api/companies", base, token=token, body={
        "name": f"_legacy_coa {suffix}", "fullAddress": "Imported from Data_2021",
        "ntn": "9999999", "fbrProvinceCode": 8, "fbrBusinessActivity": "Manufacturer",
        "fbrSector": "All Other Sectors",
    })
    if st not in (200, 201):
        print(f"FATAL: create company failed ({st} {company})"); sys.exit(2)
    cid = company["id"]
    print(f"Test company id={cid} name={company['name']}")

    controls = [r for r in rows if r["isctrl"]]
    leaves = [r for r in rows if not r["isctrl"]]

    # 1) Create groups for every control account, parents before children.
    group_id_by_code = {}          # legacy code -> our group id
    pending = list(controls)
    created_groups = 0
    guard = 0
    while pending and guard < 50:
        guard += 1
        progressed = False
        still = []
        for r in pending:
            if r["parent"] is None:  # statement root
                _, stmt = TYPE_MAP[r["atype"]]
                st, g = http("POST", f"/api/accounts/company/{cid}/groups", base, token=token,
                             body={"name": r["desc"], "statement": stmt, "externalRef": r["code"]})
            elif r["parent"] in group_id_by_code:
                st, g = http("POST", f"/api/accounts/company/{cid}/groups", base, token=token,
                             body={"name": r["desc"], "parentGroupId": group_id_by_code[r["parent"]],
                                   "externalRef": r["code"]})
            else:
                still.append(r); continue
            if st in (200, 201):
                group_id_by_code[r["code"]] = g["id"]; created_groups += 1; progressed = True
            else:
                print(f"  group {r['code']} failed: {st} {g}")
        pending = still
        if not progressed:
            break

    # 2) Leaf accounts -> their parent group, capped per group. Opening balance
    #    from OpeningDebit/Credit. Leaves whose parent wasn't imported are skipped.
    per_group_count = {}
    created_accounts = 0
    imported_ob = 0.0
    for r in leaves:
        gid = group_id_by_code.get(r["parent"])
        if not gid:
            continue
        n = per_group_count.get(gid, 0)
        if n >= args.cap:
            continue
        per_group_count[gid] = n + 1
        atype, _ = TYPE_MAP[r["atype"]]
        is_debit = r["odeb"] >= r["ocred"]
        amount = r["odeb"] if is_debit else r["ocred"]
        st, a = http("POST", f"/api/accounts/company/{cid}", base, token=token, body={
            "name": r["desc"], "code": r["code"], "accountGroupId": gid, "accountType": atype,
            "openingBalance": amount, "openingBalanceIsDebit": is_debit, "externalRef": r["code"],
        })
        if st in (200, 201):
            created_accounts += 1
            imported_ob += amount if is_debit else -amount
        else:
            print(f"  account {r['code']} failed: {st} {a}")

    print(f"\nImported: {created_groups} groups, {created_accounts} accounts "
          f"(leaf cap {args.cap}/group). Net opening balance imported (Dr-Cr): {imported_ob:,.2f}")

    # 3) Read the tree back and reconcile.
    st, tree = http("GET", f"/api/accounts/company/{cid}/tree", base, token=token)
    ok = st == 200
    bs = tree.get("balanceSheet", []) if ok else []
    pl = tree.get("profitAndLoss", []) if ok else []

    def count_nodes(nodes):
        g = a = 0
        ob = 0.0
        for n in nodes:
            g += 1
            a += len(n["accounts"])
            for acc in n["accounts"]:
                ob += acc["openingBalance"] if acc["openingBalanceIsDebit"] else -acc["openingBalance"]
            cg, ca, cob = count_nodes(n["children"])
            g += cg; a += ca; ob += cob
        return g, a, ob

    gbs, abs_, obbs = count_nodes(bs)
    gpl, apl, obpl = count_nodes(pl)
    tree_groups, tree_accounts, tree_ob = gbs + gpl, abs_ + apl, obbs + obpl

    print("\n=== Tree read back ===")
    print(f"  Balance Sheet : {len(bs)} root groups, {gbs} groups, {abs_} accounts")
    print(f"  Profit & Loss : {len(pl)} root groups, {gpl} groups, {apl} accounts")
    for col, label in ((bs, "BALANCE SHEET"), (pl, "PROFIT & LOSS")):
        print(f"\n  {label}")
        def show(nodes, d=1):
            for n in nodes:
                print(f"  {'  '*d}• {n['name']}  [{len(n['accounts'])} acct, total {n['openingBalanceTotal']:,.0f}]")
                show(n["children"], d + 1)
        show(col)

    checks = [
        ("tree fetched", ok),
        ("groups round-trip", tree_groups == created_groups),
        ("accounts round-trip", tree_accounts == created_accounts),
        ("opening balance reconciles", abs(tree_ob - imported_ob) < 0.01),
        ("both statements populated", len(bs) > 0 and len(pl) > 0),
    ]
    print("\n=== Checks ===")
    allok = True
    for name, passed in checks:
        allok = allok and passed
        print(f"  [{'PASS' if passed else 'FAIL'}] {name}")

    if not args.keep:
        http("DELETE", f"/api/companies/{cid}", base, token=token)
        print(f"\nTorn down company id={cid}.")
    else:
        print(f"\nKept company id={cid} ('{company['name']}') — open it in the UI → Accounting → Chart of Accounts.")

    return 0 if allok else 1


if __name__ == "__main__":
    sys.exit(main())

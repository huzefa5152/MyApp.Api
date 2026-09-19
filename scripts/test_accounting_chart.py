#!/usr/bin/env python3
"""
Chart of Accounts (2026-09-16) - the first phase of the accounting module.

The chart is the dimension every future posting lands on, so the things that
have to be true before anything posts are pinned here:

  1. the Wholesale preset gives a brand-new company a usable chart, and running
     it twice adds nothing - a seeder that duplicates leaves two "Accounts
     receivable" rows and the posting engine picks one at random;
  2. each posting ROLE (control type) resolves to exactly one account, and the
     roles this line does not implement are absent entirely - a stamped-but-dead
     control type is how a chart silently mis-routes a tax;
  3. a control account cannot be deleted or deactivated, because the posting
     engine resolves it by role and would read "inactive" as "missing" and fall
     back to Suspense;
  4. an opening-balance correction moves the equal-and-opposite delta onto
     Retained earnings, so the opening balance sheet still balances;
  5. the permission gates hold - coa.view reads, coa.manage writes; and
  6. the tenant guard holds on BOTH shapes: the companyId in the route, and an
     ACCOUNT id in the route whose company the caller cannot reach.

Local only. Creates its own throwaway companies, users and role, and deletes
all of them at the end.

    python scripts/test_accounting_chart.py --base http://localhost:5104
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from decimal import Decimal

PASS = 0
FAIL = 0
FAILURES: list[str] = []

# The control roles the Trader line implements. Anything the preset stamps that
# is not in here, or that appears twice, is a bug.
EXPECTED_CONTROL_TYPES = {
    "AccountsReceivable", "AccountsPayable", "Inventory", "BankCash",
    "Capital", "RetainedEarnings", "OutputTax", "InputTax",
    "WithholdingReceivable", "WithholdingPayable", "FurtherTaxPayable",
    "DiscountAllowed", "DiscountReceived", "BadDebtWriteOff", "WriteBackIncome",
}

# Roles that belong to other production lines or to a superseded design. None of
# them may ever appear on a Trader chart: their enum numbers are reserved, not
# free, so a row stamped with one would mean something different on each line.
FORBIDDEN_CONTROL_TYPES = {
    "ImportClearing", "AdvanceIncomeTaxOnImports", "CustomerAdvances",
    "ProductionWip", "EmployeeClearing",
}

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
    """Every account in a CoA tree, in no particular order."""
    for n in nodes or []:
        for a in n.get("accounts") or []:
            yield a
        yield from walk_accounts(n.get("children"))


def walk_groups(nodes):
    for n in nodes or []:
        yield n
        yield from walk_groups(n.get("children"))


def signed_opening(a) -> Decimal:
    amt = Decimal(str(a.get("openingBalance") or 0))
    return amt if a.get("openingBalanceIsDebit") else -amt


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5104")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    args = ap.parse_args()
    base = args.base

    print("=" * 78)
    print("  CHART OF ACCOUNTS")
    print("=" * 78)

    status, d = http("POST", "/api/auth/login", base,
                     body={"username": args.user, "password": args.password})
    if status != 200:
        print(f"[!] login failed: HTTP {status} {d}")
        return 2
    seed = d["token"]

    co_a = co_b = None
    role_view = role_manage = None
    user_none = user_view = user_manage = None

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
        # ── setup ────────────────────────────────────────────────────────────
        print("\n=== 0. Setup ===")
        status, co_a = http("POST", "/api/companies", base, token=seed,
                            body=company_payload("[TEMP] CoA Suite A"))
        if not check("0", "company A created", status in (200, 201), f"{status} {err_text(co_a)}"):
            return 1
        status, co_b = http("POST", "/api/companies", base, token=seed,
                            body=company_payload("[TEMP] CoA Suite B"))
        if not check("0", "company B created", status in (200, 201), f"{status} {err_text(co_b)}"):
            return 1
        a_id, b_id = co_a["id"], co_b["id"]

        # Both isolated, so reaching them needs an explicit UserCompany grant -
        # otherwise every authenticated user can see every company and the
        # tenant checks below would pass for the wrong reason.
        for c in (co_a, co_b):
            status, _ = http("PUT", f"/api/companies/{c['id']}", base, token=seed,
                             body={**company_payload(c["name"], isolated=True)})
            check("0", f"company {c['name'][-1]} marked tenant-isolated", status == 200, f"got {status}")

        status, role_view = http("POST", "/api/roles", base, token=seed, body={
            "name": "[TEMP] CoA Viewer", "description": "temp",
            "permissionKeys": ["accounting.coa.view"]})
        if not check("0", "view-only role created", status in (200, 201), f"{status} {err_text(role_view)}"):
            return 1
        status, role_manage = http("POST", "/api/roles", base, token=seed, body={
            "name": "[TEMP] CoA Manager", "description": "temp",
            "permissionKeys": ["accounting.coa.view", "accounting.coa.manage"]})
        if not check("0", "manage role created", status in (200, 201), f"{status} {err_text(role_manage)}"):
            return 1

        def make_user(username: str, role: dict | None, companies: list[int]) -> dict | None:
            s, u = http("POST", "/api/users", base, token=seed, body={
                "username": username, "fullName": username, "password": PW, "role": "User"})
            if not check("0", f"{username} created", s in (200, 201), f"{s} {err_text(u)}"):
                return None
            if role:
                s2, d2 = http("PUT", f"/api/users/{u['id']}/roles", base, token=seed,
                              body={"roleIds": [role["id"]]})
                check("0", f"{username} got its role", s2 == 200, f"{s2} {err_text(d2)}")
            s3, d3 = http("PUT", f"/api/usercompanies/user/{u['id']}", base, token=seed,
                          body={"companyIds": companies})
            check("0", f"{username} granted company access", s3 == 200, f"{s3} {err_text(d3)}")
            return u

        # None: no accounting permission at all. View: reads only. Manage: reads
        # and writes - but on company A ONLY, which is what makes the IDOR
        # checks in suite 6 meaningful.
        user_none = make_user("tempCoaNone", None, [a_id])
        user_view = make_user("tempCoaViewer", role_view, [a_id])
        user_manage = make_user("tempCoaManager", role_manage, [a_id])
        if not (user_none and user_view and user_manage):
            return 1

        def login(username: str) -> str | None:
            s, dd = http("POST", "/api/auth/login", base, body={"username": username, "password": PW})
            if not check("0", f"{username} logged in", s == 200, f"{s} {err_text(dd)}"):
                return None
            return dd["token"]

        t_none = login("tempCoaNone")
        t_view = login("tempCoaViewer")
        t_manage = login("tempCoaManager")
        if not (t_none and t_view and t_manage):
            return 1

        # ── 1. the preset ────────────────────────────────────────────────────
        print("\n=== 1. The Wholesale preset seeds a usable chart ===")
        status, seeded = http("POST", f"/api/accounts/company/{a_id}/seed-wholesale", base, token=seed)
        if not check("1", "preset seeded", status == 200, f"{status} {err_text(seeded)}"):
            return 1
        first_created = seeded.get("created", 0)
        check("1", "preset created rows", first_created > 0, f"created={first_created}")

        status, tree = http("GET", f"/api/accounts/company/{a_id}/tree", base, token=seed)
        if not check("1", "tree readable", status == 200, f"{status} {err_text(tree)}"):
            return 1
        accounts = list(walk_accounts(tree["balanceSheet"])) + list(walk_accounts(tree["profitAndLoss"]))
        groups = list(walk_groups(tree["balanceSheet"])) + list(walk_groups(tree["profitAndLoss"]))
        check("1", "balance sheet has groups", len(tree["balanceSheet"]) > 0, f"got {len(tree['balanceSheet'])}")
        check("1", "P&L has groups", len(tree["profitAndLoss"]) > 0, f"got {len(tree['profitAndLoss'])}")

        # Re-run: the whole point of the seed:* external refs.
        status, again = http("POST", f"/api/accounts/company/{a_id}/seed-wholesale", base, token=seed)
        check("1", "re-seeding creates nothing", status == 200 and again.get("created") == 0,
              f"{status} created={again.get('created') if isinstance(again, dict) else again}")
        status, tree2 = http("GET", f"/api/accounts/company/{a_id}/tree", base, token=seed)
        accounts2 = list(walk_accounts(tree2["balanceSheet"])) + list(walk_accounts(tree2["profitAndLoss"]))
        check("1", "re-seeding did not duplicate any account",
              len(accounts2) == len(accounts), f"{len(accounts)} then {len(accounts2)}")

        names = [a["name"] for a in accounts]
        check("1", "no duplicate account names in the preset",
              len(set(names)) == len(names),
              f"dupes={sorted({n for n in names if names.count(n) > 1})}")

        # ── 2. control types ─────────────────────────────────────────────────
        print("\n=== 2. Every posting role resolves to exactly one account ===")
        by_control: dict[str, list[str]] = {}
        for a in accounts:
            ct = a.get("controlType") or "None"
            if ct != "None":
                by_control.setdefault(ct, []).append(a["name"])

        for ct in sorted(EXPECTED_CONTROL_TYPES):
            check("2", f"{ct} exists exactly once",
                  len(by_control.get(ct, [])) == 1, f"got {by_control.get(ct, [])}")
        for ct in sorted(FORBIDDEN_CONTROL_TYPES):
            check("2", f"{ct} is absent (reserved for another line)",
                  ct not in by_control, f"found {by_control.get(ct)}")
        check("2", "no Suspense account is pre-seeded",
              "Suspense" not in by_control, f"found {by_control.get('Suspense')}")
        check("2", "IsControlAccount agrees with ControlType on every row",
              all(a["isControlAccount"] == (a.get("controlType", "None") != "None") for a in accounts),
              "a row has one set without the other")
        check("2", "further tax has its OWN account, not Output Tax",
              by_control.get("FurtherTaxPayable") != by_control.get("OutputTax"),
              f"both resolve to {by_control.get('OutputTax')}")

        sys_groups = [g for g in groups if g["isSystem"]]
        check("2", "statement-level groups are system groups", len(sys_groups) >= 5, f"got {len(sys_groups)}")

        status, bank = http("GET", f"/api/accounts/company/{a_id}/bank-cash", base, token=seed)
        check("2", "bank/cash picker returns the seeded Bank & Cash account",
              status == 200 and any(x["controlType"] == "BankCash" for x in (bank or [])),
              f"{status} {bank if status != 200 else [x['name'] for x in bank]}")

        # Handles used by later suites.
        ar = next(a for a in accounts if a["controlType"] == "AccountsReceivable")
        bank_acct = next(a for a in accounts if a["controlType"] == "BankCash")
        retained = next(a for a in accounts if a["controlType"] == "RetainedEarnings")
        plain = next(a for a in accounts if a["controlType"] == "None" and a["accountType"] == "Expense")
        assets_group = next(g for g in walk_groups(tree["balanceSheet"]) if g["isSystem"])

        # ── 3. guards ────────────────────────────────────────────────────────
        print("\n=== 3. The chart refuses what would break posting ===")
        status, d3 = http("PUT", f"/api/accounts/groups/{assets_group['id']}", base, token=seed,
                          body={"name": "Renamed Assets"})
        check("3", "a system group can't be renamed", status == 400, f"got {status} {err_text(d3)}")

        status, d3 = http("DELETE", f"/api/accounts/groups/{assets_group['id']}", base, token=seed)
        check("3", "a system group can't be deleted", status == 400, f"got {status} {err_text(d3)}")

        status, d3 = http("DELETE", f"/api/accounts/{ar['id']}", base, token=seed)
        check("3", "a control account can't be deleted", status == 400, f"got {status} {err_text(d3)}")

        status, d3 = http("PUT", f"/api/accounts/{ar['id']}", base, token=seed,
                          body={"name": ar["name"], "isActive": False})
        check("3", "a control account can't be deactivated", status == 400, f"got {status} {err_text(d3)}")

        # Bank & Cash is the deliberate exception: it is chosen per document,
        # not resolved by role, so one bank account retiring breaks nothing.
        status, d3 = http("PUT", f"/api/accounts/{bank_acct['id']}", base, token=seed,
                          body={"name": bank_acct["name"], "isActive": False})
        check("3", "a Bank & Cash account CAN be deactivated", status == 200, f"got {status} {err_text(d3)}")
        status, picker = http("GET", f"/api/accounts/company/{a_id}/bank-cash", base, token=seed)
        check("3", "a deactivated bank account leaves the picker",
              status == 200 and all(x["id"] != bank_acct["id"] for x in (picker or [])),
              f"{status} still listed")
        status, picker = http("GET", f"/api/accounts/company/{a_id}/bank-cash?includeInactive=true",
                              base, token=seed)
        check("3", "but the management list still shows it",
              status == 200 and any(x["id"] == bank_acct["id"] for x in (picker or [])), f"got {status}")
        http("PUT", f"/api/accounts/{bank_acct['id']}", base, token=seed,
             body={"name": bank_acct["name"], "isActive": True})

        # A new account, then a second one claiming its code.
        status, made = http("POST", f"/api/accounts/company/{a_id}", base, token=seed, body={
            "name": "[TEMP] Coded Account", "code": "T-9001",
            "accountGroupId": assets_group["id"], "accountType": "Asset"})
        check("3", "an account with a code can be created", status == 200, f"{status} {err_text(made)}")
        status, dup = http("POST", f"/api/accounts/company/{a_id}", base, token=seed, body={
            "name": "[TEMP] Clashing Account", "code": "T-9001",
            "accountGroupId": assets_group["id"], "accountType": "Asset"})
        check("3", "a duplicate code is refused", status == 400, f"got {status} {err_text(dup)}")

        # A numeric control type must NOT resolve: Enum.TryParse would accept
        # "19" and stamp FurtherTaxPayable, and a reserved number like "21"
        # would stamp a member that does not exist on this line at all.
        status, numeric = http("POST", f"/api/accounts/company/{a_id}", base, token=seed, body={
            "name": "[TEMP] Numeric Control", "accountGroupId": assets_group["id"],
            "accountType": "Asset", "controlType": "21"})
        check("3", "a numeric control type is ignored, not honoured",
              status == 200 and numeric.get("controlType") == "None" and numeric.get("isControlAccount") is False,
              f"{status} got controlType={numeric.get('controlType') if isinstance(numeric, dict) else numeric}")
        if isinstance(numeric, dict) and numeric.get("id"):
            http("DELETE", f"/api/accounts/{numeric['id']}", base, token=seed)

        # A group in the OTHER company can't host this company's account.
        status, other_grp = http("POST", f"/api/accounts/company/{b_id}/groups", base, token=seed,
                                 body={"name": "[TEMP] B group", "statement": "BalanceSheet"})
        check("3", "a group can be created in company B", status == 200, f"{status} {err_text(other_grp)}")
        status, cross = http("POST", f"/api/accounts/company/{a_id}", base, token=seed, body={
            "name": "[TEMP] Cross Company", "accountGroupId": other_grp["id"], "accountType": "Asset"})
        check("3", "an account can't be filed under another company's group",
              status == 400, f"got {status} {err_text(cross)}")

        # A group holding an account can't be deleted; an empty one can.
        status, holder = http("POST", f"/api/accounts/company/{a_id}/groups", base, token=seed,
                              body={"name": "[TEMP] Holder", "statement": "BalanceSheet"})
        check("3", "a plain group can be created", status == 200, f"{status} {err_text(holder)}")
        status, child = http("POST", f"/api/accounts/company/{a_id}", base, token=seed, body={
            "name": "[TEMP] Held Account", "accountGroupId": holder["id"], "accountType": "Asset"})
        check("3", "an account can be filed in it", status == 200, f"{status} {err_text(child)}")
        status, d3 = http("DELETE", f"/api/accounts/groups/{holder['id']}", base, token=seed)
        check("3", "a group holding accounts can't be deleted", status == 400, f"got {status} {err_text(d3)}")
        status, _ = http("DELETE", f"/api/accounts/{child['id']}", base, token=seed)
        check("3", "a plain account with no history CAN be deleted", status in (200, 204), f"got {status}")
        status, _ = http("DELETE", f"/api/accounts/groups/{holder['id']}", base, token=seed)
        check("3", "the now-empty group deletes", status in (200, 204), f"got {status}")

        # A cycle would make the tree builder recurse forever.
        status, g1 = http("POST", f"/api/accounts/company/{a_id}/groups", base, token=seed,
                          body={"name": "[TEMP] Cycle Parent", "statement": "BalanceSheet"})
        status, g2 = http("POST", f"/api/accounts/company/{a_id}/groups", base, token=seed,
                          body={"name": "[TEMP] Cycle Child", "statement": "BalanceSheet",
                                "parentGroupId": g1["id"]})
        check("3", "a nested group can be created", status == 200, f"{status} {err_text(g2)}")
        status, d3 = http("PUT", f"/api/accounts/groups/{g1['id']}", base, token=seed,
                          body={"name": g1["name"], "parentGroupId": g2["id"]})
        check("3", "a parent can't be moved under its own child", status == 400, f"got {status} {err_text(d3)}")
        status, d3 = http("PUT", f"/api/accounts/groups/{g1['id']}", base, token=seed,
                          body={"name": g1["name"], "parentGroupId": g1["id"]})
        check("3", "a group can't be its own parent", status == 400, f"got {status} {err_text(d3)}")
        http("DELETE", f"/api/accounts/groups/{g2['id']}", base, token=seed)
        http("DELETE", f"/api/accounts/groups/{g1['id']}", base, token=seed)

        # ── 4. opening balances ──────────────────────────────────────────────
        print("\n=== 4. An opening-balance correction keeps the sheet balanced ===")
        status, flat_before = http("GET", f"/api/accounts/company/{a_id}/flat", base, token=seed)
        check("4", "flat list readable", status == 200, f"got {status}")
        sum_before = sum(signed_opening(a) for a in (flat_before or []))
        retained_before = next(a for a in flat_before if a["id"] == retained["id"])

        status, adj = http("POST", f"/api/accounts/{bank_acct['id']}/adjust-opening-balance",
                           base, token=seed,
                           body={"openingBalance": 250000, "openingBalanceIsDebit": True})
        check("4", "opening balance accepted", status == 200, f"{status} {err_text(adj)}")

        status, flat_after = http("GET", f"/api/accounts/company/{a_id}/flat", base, token=seed)
        sum_after = sum(signed_opening(a) for a in (flat_after or []))
        bank_after = next(a for a in flat_after if a["id"] == bank_acct["id"])
        retained_after = next(a for a in flat_after if a["id"] == retained["id"])

        check("4", "the bank account carries the new opening",
              signed_opening(bank_after) == Decimal("250000"), f"got {signed_opening(bank_after)}")
        check("4", "retained earnings took the opposite delta",
              signed_opening(retained_after) - signed_opening(retained_before) == Decimal("-250000"),
              f"moved {signed_opening(retained_after) - signed_opening(retained_before)}")
        check("4", "the sum of signed openings is unchanged",
              sum_after == sum_before, f"{sum_before} then {sum_after}")
        check("4", "balance mirrors the signed opening while nothing has posted",
              Decimal(str(bank_after["balance"])) == signed_opening(bank_after),
              f"balance={bank_after['balance']} opening={signed_opening(bank_after)}")

        status, again = http("POST", f"/api/accounts/{bank_acct['id']}/adjust-opening-balance",
                             base, token=seed,
                             body={"openingBalance": 250000, "openingBalanceIsDebit": True})
        status, flat_noop = http("GET", f"/api/accounts/company/{a_id}/flat", base, token=seed)
        check("4", "re-stating the same opening changes nothing",
              sum(signed_opening(a) for a in (flat_noop or [])) == sum_after,
              "a no-op correction moved retained earnings")

        # ── 5. tree arithmetic ───────────────────────────────────────────────
        print("\n=== 5. The tree's subtotals are the sum of what is under them ===")
        status, tree3 = http("GET", f"/api/accounts/company/{a_id}/tree", base, token=seed)

        def node_ok(n) -> bool:
            own = sum(Decimal(str(a["balance"])) for a in n.get("accounts") or [])
            kids = sum(Decimal(str(c["balanceTotal"])) for c in n.get("children") or [])
            return Decimal(str(n["balanceTotal"])) == own + kids

        all_nodes = list(walk_groups(tree3["balanceSheet"])) + list(walk_groups(tree3["profitAndLoss"]))
        check("5", "every group's total is its accounts plus its children",
              all(node_ok(n) for n in all_nodes),
              f"first bad node: {next((n['name'] for n in all_nodes if not node_ok(n)), None)}")

        # Give the P&L an opening balance, so the synthetic Current-Year
        # Earnings line has to appear in Equity and carry the same figure.
        status, _ = http("POST", f"/api/accounts/{plain['id']}/adjust-opening-balance", base, token=seed,
                         body={"openingBalance": 1000, "openingBalanceIsDebit": True})
        status, tree4 = http("GET", f"/api/accounts/company/{a_id}/tree", base, token=seed)
        cye = [a for a in walk_accounts(tree4["balanceSheet"]) if a["name"] == "Current-Year Earnings"]
        check("5", "Current-Year Earnings appears once the P&L is non-zero",
              len(cye) == 1, f"found {len(cye)}")
        if len(cye) == 1:
            pl_total = sum(Decimal(str(n["balanceTotal"])) for n in tree4["profitAndLoss"])
            check("5", "it carries the P&L's own net figure",
                  Decimal(str(cye[0]["balance"])) == pl_total,
                  f"{cye[0]['balance']} vs {pl_total}")
            check("5", "it is synthetic (id 0), so the UI offers no actions on it",
                  cye[0]["id"] == 0, f"id={cye[0]['id']}")
        # Balance sheet still foots: assets - liabilities - equity == 0 once the
        # P&L is rolled in. Signed debit-positive, so a balanced sheet sums to 0.
        bs_total = sum(Decimal(str(n["balanceTotal"])) for n in tree4["balanceSheet"])
        check("5", "the balance sheet foots to zero with earnings rolled in",
              bs_total == Decimal(0), f"got {bs_total}")

        # ── 6. permissions and tenant scope ──────────────────────────────────
        print("\n=== 6. Permission gates and the tenant guard ===")
        for label, path in [("tree", f"/api/accounts/company/{a_id}/tree"),
                            ("flat list", f"/api/accounts/company/{a_id}/flat"),
                            ("bank/cash", f"/api/accounts/company/{a_id}/bank-cash")]:
            status, _ = http("GET", path, base, token=t_none)
            check("6", f"no accounting permission -> 403 on the {label}", status == 403, f"got {status}")

        status, _ = http("GET", f"/api/accounts/company/{a_id}/tree", base, token=t_view)
        check("6", "coa.view reads the tree", status == 200, f"got {status}")
        status, _ = http("GET", f"/api/accounts/company/{a_id}/flat", base, token=t_view)
        check("6", "coa.view reads the flat list", status == 200, f"got {status}")
        status, _ = http("GET", f"/api/accounts/company/{a_id}/bank-cash", base, token=t_view)
        check("6", "coa.view reads the bank/cash list", status == 200, f"got {status}")

        status, _ = http("POST", f"/api/accounts/company/{a_id}", base, token=t_view, body={
            "name": "[TEMP] Should Not Exist", "accountGroupId": assets_group["id"], "accountType": "Asset"})
        check("6", "coa.view cannot create an account", status == 403, f"got {status}")
        status, _ = http("PUT", f"/api/accounts/{plain['id']}", base, token=t_view, body={"name": "hijacked"})
        check("6", "coa.view cannot edit an account", status == 403, f"got {status}")
        status, _ = http("DELETE", f"/api/accounts/{plain['id']}", base, token=t_view)
        check("6", "coa.view cannot delete an account", status == 403, f"got {status}")
        status, _ = http("POST", f"/api/accounts/company/{a_id}/seed-wholesale", base, token=t_view)
        check("6", "coa.view cannot seed the preset", status == 403, f"got {status}")

        status, _ = http("POST", f"/api/accounts/company/{a_id}/groups", base, token=t_manage,
                         body={"name": "[TEMP] Manager Group", "statement": "BalanceSheet"})
        check("6", "coa.manage can create a group", status == 200, f"got {status}")

        # The tenant guard, both shapes. First the companyId in the route.
        status, _ = http("GET", f"/api/accounts/company/{b_id}/tree", base, token=t_manage)
        check("6", "company B's tree is refused to a user granted only A", status == 403, f"got {status}")
        status, _ = http("POST", f"/api/accounts/company/{b_id}", base, token=t_manage, body={
            "name": "[TEMP] Into B", "accountGroupId": other_grp["id"], "accountType": "Asset"})
        check("6", "creating into company B is refused", status == 403, f"got {status}")

        # Then the harder shape: the route carries an ACCOUNT id, and nothing in
        # the URL says which company it belongs to. The guard has to load the
        # row and assert against its STORED CompanyId.
        status, b_acct = http("POST", f"/api/accounts/company/{b_id}", base, token=seed, body={
            "name": "[TEMP] B Account", "accountGroupId": other_grp["id"], "accountType": "Asset"})
        check("6", "company B has an account to aim at", status == 200, f"{status} {err_text(b_acct)}")
        status, _ = http("PUT", f"/api/accounts/{b_acct['id']}", base, token=t_manage, body={"name": "hijacked"})
        check("6", "editing company B's account by id is refused", status == 403, f"got {status}")
        status, _ = http("DELETE", f"/api/accounts/{b_acct['id']}", base, token=t_manage)
        check("6", "deleting company B's account by id is refused", status == 403, f"got {status}")
        status, _ = http("POST", f"/api/accounts/{b_acct['id']}/adjust-opening-balance", base,
                         token=t_manage, body={"openingBalance": 1, "openingBalanceIsDebit": True})
        check("6", "correcting company B's opening balance by id is refused", status == 403, f"got {status}")
        status, _ = http("PUT", f"/api/accounts/groups/{other_grp['id']}", base, token=t_manage,
                         body={"name": "hijacked"})
        check("6", "editing company B's group by id is refused", status == 403, f"got {status}")

        status, after = http("GET", f"/api/accounts/company/{b_id}/tree", base, token=seed)
        b_names = [a["name"] for a in walk_accounts(after["balanceSheet"])]
        check("6", "company B's account survived every attempt untouched",
              "[TEMP] B Account" in b_names and "hijacked" not in b_names, f"names={b_names}")

    finally:
        print("\n=== Cleanup ===")
        for u in (user_none, user_view, user_manage):
            if u:
                http("DELETE", f"/api/users/{u['id']}", base, token=seed)
        for r in (role_view, role_manage):
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
    print(f"  CHART OF ACCOUNTS SUITE PASSED - {PASS}/{PASS} checks")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())

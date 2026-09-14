"""Hunt for cross-tree data leaks by reading RESPONSE BODIES, not status codes.

    python scripts/test_admin_scope_leak_hunt.py

Companion to test_admin_scope_isolation.py, and deliberately a different kind of
test. That suite asks "does this endpoint refuse?" -- which only proves the
endpoints someone thought to list behave. This one builds two Administrator
trees with DELIBERATELY DISTINCTIVE strings in every field it can reach, then
sweeps every list / get / search / export / dropdown endpoint as Administrator A
and greps the raw bytes for any of B's markers.

A 200 that quietly contains "ZZLEAKB" is a leak however correct the status code
looks, and that is the failure mode a status-code suite cannot see.
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://localhost:5134"
SEED_USER, SEED_PW = "admin", "admin123"
PW = "ScopeLeak!2026"

# Markers are chosen to be impossible anywhere else in the database, so a hit is
# never a coincidence. Every one belongs to Administrator B's tree.
MARK = "ZZLEAKB"

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f"  -- {detail}"))


def call(method, path, token=None, body=None, raw=False):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            payload = r.read()
            return r.status, (payload if raw else _json(payload))
    except urllib.error.HTTPError as e:
        payload = e.read()
        return e.code, (payload if raw else _json(payload))
    except Exception as e:  # noqa: BLE001
        return 0, str(e)


def _json(payload):
    try:
        return json.loads(payload.decode() or "null")
    except Exception:  # noqa: BLE001
        return payload.decode(errors="replace")[:400]


def login(u, p):
    s, d = call("POST", "/api/auth/login", body={"username": u, "password": p})
    assert s == 200, f"login {u}: {s} {d}"
    return d["token"]


def main():
    seed = login(SEED_USER, SEED_PW)
    stamp = str(int(time.time()))[-6:]
    names = {
        "adminA": f"scope_leak_a_{stamp}",
        "adminB": f"scope_leak_b_{stamp}",
        "coA": f"Leak A Co {stamp}",
        "coB": f"{MARK} Company {stamp}",
        "userB": f"{MARK.lower()}_user_{stamp}",
        "clientB": f"{MARK} Client {stamp}",
        "supplierB": f"{MARK} Supplier {stamp}",
        "roleB": f"{MARK} Role {stamp}",
    }
    made = {"users": [], "companies": [], "roles": []}

    def mkuser(username, token):
        s, d = call("POST", "/api/users", token,
                    {"username": username, "password": PW, "fullName": username, "role": "User"})
        assert s in (200, 201), f"create {username}: {s} {d}"
        made["users"].append(d["id"])
        return d["id"]

    def mkcompany(name, token):
        s, d = call("POST", "/api/companies", token, {
            "name": name, "fullAddress": "x", "phone": "1", "ntn": "0009999",
            "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1})
        assert s in (200, 201), f"create company {name}: {s} {d}"
        made["companies"].append(d["id"])
        return d

    print("=== building two Administrator trees ===")
    aId = mkuser(names["adminA"], seed)
    bId = mkuser(names["adminB"], seed)
    # Both need the permissions an Administrator has; reuse the built-in role.
    s, roles = call("GET", "/api/roles", seed)
    admin_role = next((r["id"] for r in roles if r["name"] == "Administrator"), None)
    assert admin_role, "Administrator role not found"
    for uid in (aId, bId):
        s, _ = call("PUT", f"/api/users/{uid}/roles", seed, {"roleIds": [admin_role]})
        assert s == 200, f"assign role to {uid}: {s}"

    tA, tB = login(names["adminA"], PW), login(names["adminB"], PW)
    coA = mkcompany(names["coA"], tA)
    coB = mkcompany(names["coB"], tB)
    userB = mkuser(names["userB"], tB)

    # B fills its tree with marked records.
    call("POST", "/api/clients", tB, {
        "name": names["clientB"], "address": MARK + " address", "phone": "1", "email": "",
        "ntn": "0009998", "registrationType": "Registered", "fbrProvinceCode": 8,
        "companyId": coB["id"]})
    call("POST", "/api/suppliers", tB, {
        "name": names["supplierB"], "address": MARK + " address", "phone": "1",
        "ntn": "0009997", "registrationType": "Registered", "fbrProvinceCode": 8,
        "companyId": coB["id"]})
    s, roleB = call("POST", "/api/roles", tB,
                    {"name": names["roleB"], "description": MARK, "permissionKeys": []})
    if s in (200, 201) and isinstance(roleB, dict) and roleB.get("id"):
        made["roles"].append(roleB["id"])
    print(f"  A={aId} coA={coA['id']}   B={bId} coB={coB['id']} userB={userB}")

    # ── the sweep ─────────────────────────────────────────────────────
    # Every surface an Administrator can reach that returns users, companies,
    # clients, suppliers, roles or grants -- as A, looking for B's markers.
    print("\n=== sweeping every list / get / search / export as Administrator A ===")
    paths = [
        "/api/users", "/api/companies", "/api/roles", "/api/usercompanies",
        "/api/administrators",
        f"/api/users/{bId}", f"/api/users/{userB}", f"/api/companies/{coB['id']}",
        f"/api/usercompanies/user/{bId}", f"/api/usercompanies/user/{userB}",
        f"/api/users/{bId}/roles", f"/api/users/{userB}/roles",
        f"/api/clients/company/{coB['id']}", f"/api/suppliers/company/{coB['id']}",
        f"/api/clients/company/{coB['id']}?search={MARK}",
        f"/api/suppliers/company/{coB['id']}?search={MARK}",
        f"/api/clients/common?companyId={coB['id']}",
        f"/api/clients/common?companyId={coA['id']}",
        "/api/clients/groups", "/api/suppliers/groups",
        f"/api/itemtypes?companyId={coB['id']}",
        f"/api/itemtypes/paged?companyId={coB['id']}&page=1&pageSize=50",
        f"/api/dashboard/kpis?companyId={coB['id']}&period=all-time",
        f"/api/stock/company/{coB['id']}/onhand",
        f"/api/invoices/company/{coB['id']}",
        f"/api/purchasebills/company/{coB['id']}/paged",
        f"/api/deliverychallans/company/{coB['id']}",
        f"/api/accounts/company/{coB['id']}/tree",
        f"/api/customer-ledger/company/{coB['id']}",
        f"/api/reports/company/{coB['id']}/sales/excel",
        f"/api/stock/company/{coB['id']}/onhand/excel",
        f"/api/printtemplates/company/{coB['id']}",
        f"/api/divisions/company/{coB['id']}",
        f"/api/fbr/scenarios/applicable/{coB['id']}",
        f"/api/spreadsheet-import/runs?companyId={coB['id']}",
        "/api/poimport/archives?page=1&pageSize=50",
    ]
    markers = [MARK, MARK.lower(), names["coB"], names["userB"], names["clientB"],
               names["supplierB"], names["roleB"], names["adminB"]]

    leaks = 0
    for path in paths:
        status, body = call("GET", path, tA, raw=True)
        text = body.decode(errors="replace") if isinstance(body, bytes) else str(body)
        # An unmatched /api path falls through to the SPA shell; that is not data.
        if text.lstrip().startswith("<!doctype") or text.lstrip().startswith("<html"):
            check(f"{path} (no such route - skipped)", True)
            continue
        hit = [m for m in markers if m and m in text]
        if hit:
            leaks += 1
        check(f"A reads {path} -> {status}, no B markers", not hit,
              f"LEAKED {hit} in {text[:200]}")

    # The same sweep as B, to prove the isolation is mutual and not just
    # "A happens to see nothing".
    print("\n=== the mirror: B must not see A's company either ===")
    for path in (f"/api/companies/{coA['id']}", f"/api/users/{aId}",
                 f"/api/dashboard/kpis?companyId={coA['id']}&period=all-time"):
        status, body = call("GET", path, tB, raw=True)
        text = body.decode(errors="replace") if isinstance(body, bytes) else str(body)
        check(f"B reads {path} -> {status}, no A markers", names["coA"] not in text,
              text[:160])

    # ── writes ────────────────────────────────────────────────────────
    print("\n=== A must not WRITE into B's tree ===")
    s, _ = call("PUT", f"/api/users/{userB}", tA, {"fullName": "hijacked"})
    check("A renames B's user", s in (401, 403, 404), str(s))
    s, _ = call("DELETE", f"/api/users/{userB}", tA)
    check("A deletes B's user", s in (401, 403, 404), str(s))
    s, _ = call("PUT", f"/api/usercompanies/user/{userB}", tA, {"companyIds": [coA["id"]]})
    check("A grants its own company to B's user", s in (401, 403, 404), str(s))
    s, _ = call("PUT", f"/api/usercompanies/user/{bId}", tA, {"companyIds": []})
    check("A strips B's own grants", s in (401, 403, 404), str(s))
    if made["roles"]:
        s, _ = call("PUT", f"/api/roles/{made['roles'][0]}", tA,
                    {"name": "hijacked", "description": "", "permissionKeys": []})
        check("A edits B's custom role", s in (401, 403, 404), str(s))

    # ── cleanup ───────────────────────────────────────────────────────
    print("\n=== cleanup ===")
    for rid in made["roles"]:
        call("DELETE", f"/api/roles/{rid}", seed)
    for uid in made["users"]:
        call("DELETE", f"/api/users/{uid}", seed)
    for cid in made["companies"]:
        call("DELETE", f"/api/companies/{cid}", seed)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n=== {passed}/{len(results)} checks passed ===")
    bad = [r for r in results if not r[1]]
    if bad:
        print("FAILURES:")
        for n, _, d in bad:
            print(f"  - {n}  -- {d}")
        sys.exit(1)
    print("no cross-tree markers found in any response body")


if __name__ == "__main__":
    main()

"""Print-template multi-doc benchmark (2026-07-09).

Pins the enhancement that opened the print-template system to the four newer
document types (CreditNote, DebitNote, PurchaseBill, GoodsReceipt) and added
the per-screen template selector:

  1. Merge fields are runtime-seeded for all four new types (own fields +
     the Division block).
  2. Template CRUD accepts the new types (and still rejects unknown ones).
  3. The new print-data endpoints return the documented merge contract:
       GET /api/purchasebills/{id}/print
       GET /api/goodsreceipts/{id}/print
     including the GRN <-> PB linkage both ways.
  4. Tenant isolation on the new id-based print endpoints: a user without
     access to the owning company gets 403 (guard asserts against the
     STORED CompanyId), and unauthenticated calls get 401.

Run:
  python scripts/test_print_templates_multidoc.py [--base http://localhost:5134] [--keep]

Requires a running backend. Creates ephemeral companies/users prefixed
"Test PrintTpl" and deletes them at the end (unless --keep).
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import date
from typing import Any

TODAY = date.today().isoformat()
PASS_COUNT = 0
FAIL_COUNT = 0


def http(method: str, path: str, base: str, token: str | None = None,
         body: Any = None) -> tuple[int, Any]:
    url = base.rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw) if raw else None
        except json.JSONDecodeError:
            return e.code, raw
    except urllib.error.URLError as e:
        print(f"  !! cannot reach backend at {base}: {e.reason}")
        sys.exit(2)


def check(suite: str, label: str, ok: bool, detail: str = "") -> None:
    global PASS_COUNT, FAIL_COUNT
    mark = "PASS" if ok else "FAIL"
    if ok:
        PASS_COUNT += 1
    else:
        FAIL_COUNT += 1
    extra = "" if ok else f"  <- {detail}"
    print(f"  [{mark}] {label}{extra}")


def login(base: str, username: str, password: str) -> str:
    st, data = http("POST", "/api/auth/login", base, body={"username": username, "password": password})
    assert st == 200 and data and data.get("token"), f"login {username}: {st} {data}"
    return data["token"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--keep", action="store_true", help="keep the test rows")
    args = ap.parse_args()
    base = args.base

    print("=== Logging in as admin ===")
    admin = login(base, "admin", "admin123")

    print("\n=== Cleaning leftovers from a prior run ===")
    _, companies_pre = http("GET", "/api/companies", base, token=admin)
    for c in companies_pre or []:
        if c["name"].startswith("Test PrintTpl"):
            s, _ = http("DELETE", f"/api/companies/{c['id']}", base, token=admin)
            print(f"  removed leftover company id={c['id']} ({s})")
    _, users_pre = http("GET", "/api/users", base, token=admin)
    for u in users_pre or []:
        if u["username"] == "printtpl_pat":
            http("DELETE", f"/api/users/{u['id']}", base, token=admin)

    # ── Fixtures: one open company (pat's), one isolated company ──────
    print("\n=== Creating fixtures ===")
    made = []
    for name in ("Test PrintTpl Co.", "Test PrintTpl Iso Co."):
        st, c = http("POST", "/api/companies", base, token=admin, body={
            "name": name, "fullAddress": f"{name} HQ", "phone": "+92-21-1111111",
            "ntn": "7654321", "cnic": "1234567890123", "strn": "3210987654321",
            "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
            "fbrEnvironment": "sandbox", "fbrProvinceCode": 8,
        })
        assert st in (200, 201), f"create company: {st} {c}"
        made.append(c)
    open_co, iso_co = made
    st, _ = http("PUT", f"/api/companies/{iso_co['id']}", base, token=admin, body={
        "name": iso_co["name"], "fullAddress": iso_co.get("fullAddress"),
        "phone": iso_co.get("phone"), "ntn": iso_co.get("ntn"),
        "cnic": iso_co.get("cnic"), "strn": iso_co.get("strn"),
        "startingChallanNumber": 1, "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
        "fbrEnvironment": iso_co.get("fbrEnvironment"),
        "fbrProvinceCode": iso_co.get("fbrProvinceCode"),
        "inventoryTrackingEnabled": False, "isTenantIsolated": True,
    })
    assert st == 200, f"isolate company: {st}"

    def make_fixture_docs(cid: int) -> dict:
        st, sup = http("POST", "/api/suppliers", base, token=admin, body={
            "name": "PrintTpl Supplier", "companyId": cid,
            "address": "Vendor Market, Karachi", "phone": "0321-5556677",
            "ntn": "1112223", "strn": "9998887776665",
        })
        assert st in (200, 201), f"create supplier: {st} {sup}"
        st, pb = http("POST", "/api/purchasebills", base, token=admin, body={
            "date": TODAY, "companyId": cid, "supplierId": sup["id"],
            "supplierBillNumber": "VINV-777", "gstRate": 18,
            "items": [
                {"description": "PrintTpl Widget A", "quantity": 4, "uom": "Pcs", "unitPrice": 250},
                {"description": "PrintTpl Widget B", "quantity": 2, "uom": "Pcs", "unitPrice": 500},
            ]})
        assert st in (200, 201), f"create purchase bill: {st} {pb}"
        st, gr = http("POST", "/api/goodsreceipts", base, token=admin, body={
            "receiptDate": TODAY, "companyId": cid, "supplierId": sup["id"],
            "purchaseBillId": pb["id"], "supplierChallanNumber": "VDC-42",
            "site": "Main Store",
            "items": [{"description": "PrintTpl Widget A", "quantity": 4, "unit": "Pcs"}],
        })
        assert st in (200, 201), f"create goods receipt: {st} {gr}"
        return {"supplier": sup, "pb": pb, "gr": gr}

    open_docs = make_fixture_docs(open_co["id"])
    iso_docs = make_fixture_docs(iso_co["id"])

    # Restricted user: Administrator RBAC (so only tenancy blocks), granted
    # the OPEN company only — explicit grants override the open fleet.
    st, roles = http("GET", "/api/roles", base, token=admin)
    admin_role_id = next(r["id"] for r in roles if r["name"] == "Administrator")
    st, pat = http("POST", "/api/users", base, token=admin, body={
        "username": "printtpl_pat", "password": "test1234",
        "fullName": "Pat PrintTpl", "role": "Administrator",
    })
    assert st in (200, 201), f"create user: {st} {pat}"
    http("PUT", f"/api/users/{pat['id']}/roles", base, token=admin, body={"roleIds": [admin_role_id]})
    st, _ = http("PUT", f"/api/usercompanies/user/{pat['id']}", base, token=admin,
                 body={"companyIds": [open_co["id"]]})
    assert st == 200, "grant pat -> open company"
    pat_tok = login(base, "printtpl_pat", "test1234")

    NEW_TYPES = ["CreditNote", "DebitNote", "PurchaseBill", "GoodsReceipt"]

    # ── Suite 1: merge fields seeded ───────────────────────────────
    s = "1. Merge fields seeded for new types"
    print(f"\n=== {s} ===")
    for t in NEW_TYPES:
        st, fields = http("GET", f"/api/mergefields/{t}", base, token=admin)
        check(s, f"1.x GET /mergefields/{t} -> 200", st == 200, f"got {st}")
        fields = fields or []
        check(s, f"1.x {t} has own fields (>=20)", len(fields) >= 20, f"got {len(fields)}")
        div = [f for f in fields if (f.get("category") or "") == "Division"]
        check(s, f"1.x {t} has the Division block (8)", len(div) == 8, f"got {len(div)}")
    st, cn_fields = http("GET", "/api/mergefields/CreditNote", base, token=admin)
    note_exprs = {f["fieldExpression"] for f in (cn_fields or [])}
    for expr in ("{{originalInvoiceNumber}}", "{{noteReason}}", "{{noteKindLabel}}"):
        check(s, f"1.x CreditNote seeds {expr}", expr in note_exprs, "missing")

    # ── Suite 2: template CRUD accepts the new types ───────────────
    s = "2. Template CRUD for new types"
    print(f"\n=== {s} ===")
    cid = open_co["id"]
    created_tpl = {}
    for t in NEW_TYPES:
        st, tpl = http("POST", f"/api/printtemplates/company/{cid}", base, token=admin, body={
            "templateType": t, "name": f"Smoke {t}",
            "htmlContent": "<!DOCTYPE html><html><body>{{companyBrandName}}{{supplierName}}</body></html>",
        })
        check(s, f"2.x create {t} template -> 200", st == 200, f"got {st} {tpl}")
        if st == 200:
            created_tpl[t] = tpl
            check(s, f"2.x first {t} template is scope default", tpl.get("isDefault") is True,
                  f"got {tpl.get('isDefault')}")
    st, got = http("GET", f"/api/printtemplates/company/{cid}/PurchaseBill", base, token=admin)
    check(s, "2.x GET company default for PurchaseBill resolves", st == 200 and got and got.get("name") == "Smoke PurchaseBill",
          f"got {st} name={got and got.get('name')}")
    st, err = http("POST", f"/api/printtemplates/company/{cid}", base, token=admin, body={
        "templateType": "BogusType", "name": "nope", "htmlContent": "<html></html>"})
    check(s, "2.x unknown type still rejected (400)", st == 400, f"got {st}")

    # ── Suite 3: print-data endpoints ──────────────────────────────
    s = "3. Print-data endpoints"
    print(f"\n=== {s} ===")
    pb, gr, sup = open_docs["pb"], open_docs["gr"], open_docs["supplier"]
    st, d = http("GET", f"/api/purchasebills/{pb['id']}/print", base, token=admin)
    check(s, "3.1 GET /purchasebills/{id}/print -> 200", st == 200, f"got {st} {d}")
    if st == 200:
        check(s, "3.1 purchaseBillNumber matches", d.get("purchaseBillNumber") == pb["purchaseBillNumber"],
              f"got {d.get('purchaseBillNumber')}")
        check(s, "3.1 supplier party mapped", d.get("supplierName") == "PrintTpl Supplier"
              and d.get("supplierNTN") == "1112223", f"got {d.get('supplierName')}/{d.get('supplierNTN')}")
        check(s, "3.1 company (buyer) branding present", bool(d.get("companyBrandName")), "empty")
        check(s, "3.1 supplier's own invoice ref carried", d.get("supplierBillNumber") == "VINV-777",
              f"got {d.get('supplierBillNumber')}")
        items = d.get("items") or []
        check(s, "3.1 two lines with sNo/uom keys", len(items) == 2 and items[0].get("sNo") == 1
              and "uom" in items[0], f"got {items}")
        check(s, "3.1 amountInWords recomputed", bool(d.get("amountInWords")), "empty")
        check(s, "3.1 GRN linkage on bill print", gr["goodsReceiptNumber"] in (d.get("goodsReceiptNumbers") or []),
              f"got {d.get('goodsReceiptNumbers')}")
        expected_total = round((4 * 250 + 2 * 500) * 1.18)
        check(s, "3.1 grandTotal display-rounded", d.get("grandTotal") == expected_total,
              f"expected {expected_total}, got {d.get('grandTotal')}")
    st, d = http("GET", f"/api/goodsreceipts/{gr['id']}/print", base, token=admin)
    check(s, "3.2 GET /goodsreceipts/{id}/print -> 200", st == 200, f"got {st} {d}")
    if st == 200:
        check(s, "3.2 goodsReceiptNumber matches", d.get("goodsReceiptNumber") == gr["goodsReceiptNumber"],
              f"got {d.get('goodsReceiptNumber')}")
        check(s, "3.2 vendor DC + PB linkage", d.get("supplierChallanNumber") == "VDC-42"
              and d.get("purchaseBillNumber") == pb["purchaseBillNumber"],
              f"got {d.get('supplierChallanNumber')}/{d.get('purchaseBillNumber')}")
        items = d.get("items") or []
        check(s, "3.2 items use challan-style 'unit' key", len(items) == 1 and items[0].get("unit") == "Pcs",
              f"got {items}")
        check(s, "3.2 status carried", d.get("status") == "Pending", f"got {d.get('status')}")
        check(s, "3.2 quantity-only (no money keys)", "grandTotal" not in d, "money leaked onto GRN")

    # ── Suite 4: tenant isolation on the new endpoints ─────────────
    s = "4. Tenant isolation on print endpoints"
    print(f"\n=== {s} ===")
    iso_pb, iso_gr = iso_docs["pb"], iso_docs["gr"]
    st, _ = http("GET", f"/api/purchasebills/{iso_pb['id']}/print", base, token=pat_tok)
    check(s, "4.1 pat -> other tenant's PB print = 403", st == 403, f"got {st}")
    st, _ = http("GET", f"/api/goodsreceipts/{iso_gr['id']}/print", base, token=pat_tok)
    check(s, "4.2 pat -> other tenant's GR print = 403", st == 403, f"got {st}")
    st, _ = http("GET", f"/api/purchasebills/{open_docs['pb']['id']}/print", base, token=pat_tok)
    check(s, "4.3 pat -> own company's PB print = 200", st == 200, f"got {st}")
    st, _ = http("GET", f"/api/purchasebills/{iso_pb['id']}/print", base)
    check(s, "4.4 unauthenticated PB print = 401", st == 401, f"got {st}")
    st, _ = http("GET", f"/api/goodsreceipts/{iso_gr['id']}/print", base)
    check(s, "4.5 unauthenticated GR print = 401", st == 401, f"got {st}")

    # ── Teardown ───────────────────────────────────────────────────
    if not args.keep:
        print("\n=== Teardown ===")
        for docs in (open_docs, iso_docs):
            http("DELETE", f"/api/goodsreceipts/{docs['gr']['id']}", base, token=admin)
            http("DELETE", f"/api/purchasebills/{docs['pb']['id']}", base, token=admin)
        for tpl in created_tpl.values():
            http("DELETE", f"/api/printtemplates/{tpl['id']}", base, token=admin)
        http("DELETE", f"/api/users/{pat['id']}", base, token=admin)
        for c in (open_co, iso_co):
            st, _ = http("DELETE", f"/api/companies/{c['id']}", base, token=admin)
            print(f"  deleted company {c['id']} ({st})")

    print("\n" + "=" * 60)
    total = PASS_COUNT + FAIL_COUNT
    print(f"=== {PASS_COUNT}/{total} checks passed ===")
    return 0 if FAIL_COUNT == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

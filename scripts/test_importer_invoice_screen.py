"""
The importer's one Invoices screen, end to end against a running backend.

Each run makes its own throwaway company, buyer and items, so no existing
company's data is read or changed. Never files with FBR: the FBR checks use
the read-only payload preview.

Suites
  D6  a line is never saved without a description; FBR gets it blank
      (plan cases 48, 55, 56)

Run:  python scripts/test_importer_invoice_screen.py --base http://localhost:5195
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

PASSED = 0
FAILED = 0


def check(label: str, ok: bool, detail: str = "") -> bool:
    global PASSED, FAILED
    if ok:
        PASSED += 1
        print(f"  PASS  {label}")
    else:
        FAILED += 1
        print(f"  FAIL  {label}  {detail}")
    return ok


def http(method, path, base, token=None, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(base + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode() if e.fp else ""
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except Exception as e:  # noqa: BLE001
        return 0, str(e)


TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
SUFFIX = datetime.now().strftime("%Y%m%d%H%M%S")


def login(base, user, pw):
    st, data = http("POST", "/api/auth/login", base, body={"username": user, "password": pw})
    if st != 200:
        sys.exit(f"FATAL: login failed ({st} {data})")
    return data["token"]


def make_company(base, token, name):
    st, co = http("POST", "/api/companies", base, token=token, body={
        "name": name, "fullAddress": "Test HQ", "phone": "+92-21-00000000",
        "ntn": "9999999", "startingChallanNumber": 1, "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
        "fbrEnvironment": "sandbox", "fbrProvinceCode": 8,
        "fbrBusinessActivity": "Wholesaler", "fbrSector": "Wholesale / Retails",
        # Lets the read-only payload preview run. Never sent to PRAL: these
        # suites only preview, they never validate or submit.
        "fbrToken": "test-token-not-used-for-real-pral-calls",
    })
    if st not in (200, 201):
        sys.exit(f"FATAL: create company failed ({st} {co})")
    return co


def make_client(base, token, company_id):
    st, cl = http("POST", "/api/clients", base, token=token, body={
        "name": f"Test Buyer {SUFFIX}", "address": "1 Test Road", "phone": "021-1234567",
        "companyId": company_id, "ntn": "1234567", "fbrProvinceCode": 8,
        "registrationType": "Registered",
    })
    if st not in (200, 201):
        sys.exit(f"FATAL: create client failed ({st} {cl})")
    return cl


def make_item(base, token, company_id, name):
    # No HS code: a draft item moves no stock, so these cases never meet the
    # stock guard. The guard has its own suite.
    st, it = http("POST", f"/api/itemtypes?companyId={company_id}", base, token=token, body={
        "name": name, "uom": "Pcs", "isFavorite": True,
    })
    if st not in (200, 201):
        sys.exit(f"FATAL: create item type failed ({st} {it})")
    return it


def standalone(base, token, company, client, lines):
    return http("POST", "/api/invoices/standalone", base, token=token, body={
        "date": TODAY, "companyId": company["id"], "clientId": client["id"],
        "gstRate": 18, "items": lines,
    })


def suite_d6(base, token):
    print("\n=== D6: line descriptions ===")
    co = make_company(base, token, f"_test_invscreen {SUFFIX}")
    cl = make_client(base, token, co["id"])
    item = make_item(base, token, co["id"], f"Test Valve {SUFFIX}")

    st, inv = standalone(base, token, co, cl, [
        {"itemTypeId": item["id"], "description": "", "quantity": 2, "uom": "Pcs", "unitPrice": 100},
        {"itemTypeId": item["id"], "description": "Typed by the operator", "quantity": 1, "uom": "Pcs", "unitPrice": 50},
    ])
    if not check("create with a blank description saves", st in (200, 201), f"{st} {inv}"):
        return
    st, full = http("GET", f"/api/invoices/{inv['id']}", base, token=token)
    descs = [i.get("description") for i in (full or {}).get("items", [])]
    check("55: blank description + item type -> stored as the item name",
          item["name"] in descs, f"got {descs}")
    check("55: a typed description is stored as typed",
          "Typed by the operator" in descs, f"got {descs}")

    items_in = [{"id": i["id"], "itemTypeId": i.get("itemTypeId"), "description": "",
                 "quantity": float(i["quantity"]), "uom": i.get("uom") or "Pcs",
                 "unitPrice": float(i["unitPrice"])} for i in full["items"]]
    st, upd = http("PUT", f"/api/invoices/{inv['id']}", base, token=token,
                   body={"gstRate": 18, "items": items_in})
    check("56: update with blank descriptions saves", st == 200, f"{st} {upd}")
    st, full = http("GET", f"/api/invoices/{inv['id']}", base, token=token)
    descs = [i.get("description") for i in (full or {}).get("items", [])]
    check("56: update never leaves a line blank",
          all((d or "").strip() for d in descs) and item["name"] in descs, f"got {descs}")

    # FBR preview needs a classified line: an item of this company with a real
    # tariff code (HS validation is master-first, so the code must exist).
    st, hs_item = http("POST", f"/api/itemtypes?companyId={co['id']}", base, token=token, body={
        "name": f"Test Check Valve {SUFFIX}", "hsCode": "8481.2000",
        "uom": "Numbers, pieces, units", "isFavorite": True,
    })
    if not check("a classified item can be created", st in (200, 201), f"{st} {hs_item}"):
        return
    st, inv2 = standalone(base, token, co, cl, [
        {"itemTypeId": hs_item["id"], "description": "Shown on the invoice, not filed",
         "hsCode": hs_item["hsCode"], "saleType": hs_item.get("saleType"),
         "quantity": 1, "uom": hs_item.get("uom") or "Numbers, pieces, units", "unitPrice": 100},
    ])
    check("create a classified invoice", st in (200, 201), f"{st} {inv2}")
    st, prev = http("GET", f"/api/fbr/{(inv2 or {}).get('id')}/preview-payload", base, token=token)
    raw = ((prev or {}).get("preview") or {}).get("json") if isinstance(prev, dict) else None
    try:
        payload = json.loads(raw) if raw else {}
    except Exception:
        payload = {}
    lines = payload.get("items") or payload.get("Items") or []
    check("48: FBR preview has lines", st == 200 and len(lines) > 0, f"{st} {str(prev)[:300]}")
    check("48: every FBR line's productDescription is blank",
          lines and all((l.get("productDescription", l.get("ProductDescription", "x")) or "") == "" for l in lines),
          f"{[l.get('productDescription') for l in lines]}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="http://localhost:5195")
    p.add_argument("--admin-user", default="admin")
    p.add_argument("--admin-pw", default="admin123")
    a = p.parse_args()
    token = login(a.base, a.admin_user, a.admin_pw)
    suite_d6(a.base, token)
    print(f"\n{PASSED}/{PASSED + FAILED} importer invoice screen checks passed")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()

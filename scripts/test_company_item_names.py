"""
Live test: a company's own name for a shared catalog item (2026-09-28).

ItemType is ONE catalog shared by every company, so renaming a row to follow
one company's stock sheet renamed another company's item on its dashboard,
invoices and prints. A company can instead record its own name
(CompanyItemTypeSetting.DisplayName). This proves:

  1. the company sees its own name, the other company still sees the catalog's;
  2. the picker search finds the item by the company's own name, only there;
  3. saving the item back from that company's screen does not rename the
     shared catalog row;
  4. the stock screens (on-hand, opening balances) use the company's name;
  5. clearing the name goes back to the catalog's.

  python scripts/test_company_item_names.py --base http://localhost:5136
"""
import argparse
import sys
import uuid

import requests

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"  [PASS] {name}")
    else:
        failed += 1
        print(f"  [FAIL] {name} — {detail}")


def make_company(api, h, name):
    r = requests.post(f"{api}/companies", headers=h, timeout=60, json={
        "name": name, "brandName": "CIN", "fullAddress": "1 Test Street",
        "phone": "021-0000000", "ntn": "1234567-8",
        "startingChallanNumber": 1, "startingInvoiceNumber": 1,
        "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
    })
    if r.status_code not in (200, 201):
        raise RuntimeError(f"company create failed: http {r.status_code} {r.text[:200]}")
    return r.json()["id"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--username", default="admin")
    ap.add_argument("--password", default="admin123")
    args = ap.parse_args()
    api = args.base.rstrip("/") + "/api"
    tok = requests.post(f"{api}/auth/login", timeout=30,
                        json={"username": args.username, "password": args.password}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    tag = uuid.uuid4().hex[:6].upper()
    a = make_company(api, h, f"Item Names A {tag}")
    b = make_company(api, h, f"Item Names B {tag}")
    catalog = f"CATALOG WIDGET {tag}"
    own = f"PLASTIC WIDGET {tag}"

    r = requests.post(f"{api}/itemtypes", headers=h, params={"companyId": a}, timeout=60,
                      json={"name": catalog, "hsCode": None, "uom": "Pcs", "isFavorite": True})
    check("an item is created", r.status_code in (200, 201), f"http {r.status_code} {r.text[:200]}")
    item = r.json()
    iid = item["id"]
    # Company B uses the same catalog row.
    requests.put(f"{api}/itemtypes/{iid}", headers=h, params={"companyId": b}, timeout=60,
                 json=dict(item, writeCompanyOverlay=True))

    print("\n  Suite 1 — each company sees its own name")
    cur = requests.get(f"{api}/itemtypes/{iid}", headers=h, params={"companyId": a}, timeout=30).json()
    r = requests.put(f"{api}/itemtypes/{iid}", headers=h, params={"companyId": a}, timeout=60,
                     json=dict(cur, writeCompanyOverlay=True, companyDisplayName=own))
    check("company A records its own name", r.ok, f"http {r.status_code} {r.text[:200]}")
    in_a = requests.get(f"{api}/itemtypes/{iid}", headers=h, params={"companyId": a}, timeout=30).json()
    in_b = requests.get(f"{api}/itemtypes/{iid}", headers=h, params={"companyId": b}, timeout=30).json()
    check("A sees its own name", in_a.get("name") == own and in_a.get("catalogName") == catalog,
          f"name={in_a.get('name')} catalog={in_a.get('catalogName')}")
    check("B still sees the catalog name", in_b.get("name") == catalog and not in_b.get("companyDisplayName"),
          f"name={in_b.get('name')}")

    print("\n  Suite 2 — the picker search finds the company's own name, only there")
    found_a = requests.get(f"{api}/itemtypes", headers=h, params={"companyId": a, "search": own}, timeout=60).json()
    found_b = requests.get(f"{api}/itemtypes", headers=h, params={"companyId": b, "search": own}, timeout=60).json()
    check("A's search finds it by A's name", any(x["id"] == iid for x in found_a), str([x["id"] for x in found_a])[:120])
    check("B's search does not", not any(x["id"] == iid for x in found_b), str([x["id"] for x in found_b])[:120])

    print("\n  Suite 3 — saving from A's screen does not rename the shared item")
    r = requests.put(f"{api}/itemtypes/{iid}", headers=h, params={"companyId": a}, timeout=60,
                     json=dict(in_a, writeCompanyOverlay=True))
    in_b = requests.get(f"{api}/itemtypes/{iid}", headers=h, params={"companyId": b}, timeout=30).json()
    check("a save that echoes A's name back keeps the catalog name",
          r.ok and in_b.get("name") == catalog, f"http {r.status_code} B sees {in_b.get('name')}")

    print("\n  Suite 4 — the stock screens use the company's name")
    r = requests.post(f"{api}/stock/opening", headers=h, timeout=60, json={
        "companyId": a, "itemTypeId": iid, "quantity": 5, "valueExcludingTax": 500,
        "salesTaxRate": 18, "asOfDate": "2026-07-01"})
    check("an opening balance is recorded", r.ok, f"http {r.status_code} {r.text[:200]}")
    oh = requests.get(f"{api}/stock/company/{a}/onhand", headers=h, timeout=60).json()
    op = requests.get(f"{api}/stock/company/{a}/opening", headers=h, timeout=60).json()
    check("the on-hand grid shows A's name",
          any(x["itemTypeId"] == iid and x["itemTypeName"] == own for x in oh), str([x for x in oh if x["itemTypeId"] == iid])[:160])
    check("the opening balances show A's name",
          any(x["itemTypeId"] == iid and x["itemTypeName"] == own for x in op), str([x for x in op if x["itemTypeId"] == iid])[:160])

    print("\n  Suite 5 — clearing the name goes back to the catalog's")
    cur = requests.get(f"{api}/itemtypes/{iid}", headers=h, params={"companyId": a}, timeout=30).json()
    r = requests.put(f"{api}/itemtypes/{iid}", headers=h, params={"companyId": a}, timeout=60,
                     json=dict(cur, name=cur.get("catalogName") or cur["name"], writeCompanyOverlay=True, companyDisplayName=""))
    back = requests.get(f"{api}/itemtypes/{iid}", headers=h, params={"companyId": a}, timeout=30).json()
    check("a blank name clears it", r.ok and back.get("name") == catalog and not back.get("companyDisplayName"),
          f"http {r.status_code} name={back.get('name')}")

    print(f"\n=== {passed}/{passed + failed} checks passed ===")
    for c in (a, b):
        requests.delete(f"{api}/companies/{c}", headers=h, timeout=300)
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()

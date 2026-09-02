"""
Item Type lifecycle: create, import, edit, and — the part that actually bites —
whether an item can be REACHED in the pickers that matter.

Written after three symptoms reported from production on 2026-09-02, which
turned out to be two causes:

  * picking an HS code stopped filling the unit, because the Item Type form read
    units down a path that only tried the COMPANY's FBR token. A company with
    FBR off got nothing, even when the HS master already held the unit and the
    dedicated HS endpoint returned it happily.
  * that also made the form unsaveable: Update is gated on a non-empty unit.
  * imported HS placeholders were unreachable in every document picker, because
    pickers receive the short curated list and filter it client-side, so a code
    the server never sent could not be found by typing.

The picker cases therefore do not stop at "is it in a list" — they create a
stock adjustment, an invoice and a purchase bill against an imported item,
because being listed and being usable are different claims.

    python scripts/test_item_type_lifecycle.py --base http://localhost:5134

Creates its own throwaway company and item types, and cleans up unless --keep.
"""

import argparse
import sys
import uuid
from datetime import date

import requests

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

PASS, FAIL, SKIP = "PASS", "FAIL", "SKIP"
results = []


def check(name, ok, detail=""):
    results.append((PASS if ok else FAIL, name, detail))
    print(f"[{PASS if ok else FAIL}] {name}" + (f" — {detail}" if detail else ""))
    return ok


def skip(name, why):
    results.append((SKIP, name, why))
    print(f"[{SKIP}] {name} — {why}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--username", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    api = args.base.rstrip("/") + "/api"
    S = requests.Session()
    tok = S.post(f"{api}/auth/login",
                 json={"username": args.username, "password": args.password}, timeout=60)
    tok.raise_for_status()
    h = {"Authorization": "Bearer " + tok.json()["token"]}

    def get(p, **q):
        return S.get(f"{api}/{p}", headers=h, params=q or None, timeout=180)

    def post(p, body=None, **q):
        return S.post(f"{api}/{p}", headers=h, json=body, params=q or None, timeout=300)

    def put(p, body=None, **q):
        return S.put(f"{api}/{p}", headers=h, json=body, params=q or None, timeout=300)

    tag = uuid.uuid4().hex[:6].upper()
    company = S.post(f"{api}/companies", headers=h, timeout=60, json={
        "name": f"ItemType Suite {tag}", "brandName": "ITS", "fullAddress": "Karachi",
        "phone": "021-0000000", "ntn": "1234567-8", "startingChallanNumber": 1,
        "startingInvoiceNumber": 1, "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
    }).json()["id"]
    created_ids = []

    try:
        post(f"accounts/company/{company}/seed-wholesale")

        master_count = get("hscodes/count").json().get("count", 0)
        if master_count == 0:
            skip("every HS-dependent case", "HS master is empty — load it first")
            return report()

        # A real code to work with, and one that certainly is not in the master.
        sample = get("hscodes", take=1).json()[0]
        real_code = sample["code"]
        bogus_code = "9999.9999"

        # ── 1. Creation ─────────────────────────────────────────────────
        r = post("itemtypes", {
            "name": f"Plain Item {tag}", "uom": "Pcs", "isFavorite": True,
        }, companyId=company)
        plain = r.json() if r.status_code in (200, 201) else {}
        if plain.get("id"):
            created_ids.append(plain["id"])
        check("an item with no HS code can be created", r.status_code in (200, 201),
              f"http {r.status_code}: {r.text[:140]}")

        r = post("itemtypes", {
            "name": f"Coded Item {tag}", "hsCode": real_code, "uom": "Pcs", "isFavorite": True,
        }, companyId=company)
        coded = r.json() if r.status_code in (200, 201) else {}
        if coded.get("id"):
            created_ids.append(coded["id"])
        check("an item with a real HS code can be created", r.status_code in (200, 201),
              f"http {r.status_code}: {r.text[:140]}")
        check("the HS code is stored as given", coded.get("hsCode") == real_code,
              f"stored={coded.get('hsCode')}")

        r = post("itemtypes", {
            "name": f"Bogus Item {tag}", "hsCode": bogus_code, "uom": "Pcs",
        }, companyId=company)
        check("an HS code absent from the master is refused", r.status_code == 400,
              f"http {r.status_code}")

        # Same name AND same code is the catalog's unique key.
        r = post("itemtypes", {
            "name": f"Coded Item {tag}", "hsCode": real_code, "uom": "Pcs",
        }, companyId=company)
        check("a duplicate name+code is refused rather than silently doubled",
              r.status_code == 400, f"http {r.status_code}")

        # SQL Server's default collation is case- and trailing-space-insensitive,
        # so these are the SAME key and must be treated as a duplicate, not a
        # second row the unique index would then reject.
        r = post("itemtypes", {
            "name": f"coded item {tag}  ", "hsCode": real_code, "uom": "Pcs",
        }, companyId=company)
        check("a differently-cased duplicate is caught too, not left to the index",
              r.status_code == 400, f"http {r.status_code}")

        # ── 2. Units come from the master, with FBR off ─────────────────
        comp = get(f"companies/{company}").json()
        check("the throwaway company has FBR off, as a new company should",
              comp.get("fbrEnabled") is not True, f"fbrEnabled={comp.get('fbrEnabled')}")

        uoms = get(f"hscodes/{real_code}/uoms", companyId=company)
        master_has_uom = uoms.ok and len(uoms.json()) > 0

        hints = get("itemtypes/fbr-hints", companyId=company, hsCode=real_code)
        hj = hints.json() if hints.ok else {}
        check("the form's hint endpoint answers for an FBR-off company", hints.ok,
              f"http {hints.status_code}")

        if master_has_uom:
            # THE regression: these two must agree. They did not, and the form
            # reads the second one.
            check("the form's unit matches the HS screen's unit",
                  (hj.get("defaultUom") or {}).get("description") == uoms.json()[0]["description"],
                  f"form={(hj.get('defaultUom') or {}).get('description')} hs={uoms.json()[0]['description']}")
            check("a unit the master knows means the form can save",
                  bool((hj.get("defaultUom") or {}).get("description")),
                  "empty unit is what disabled Update")
        else:
            skip("the form's unit matches the HS screen's unit",
                 f"master holds no unit for {real_code} — run Fill missing units")
            check("no unit is reported honestly rather than as a restriction",
                  hj.get("uomLookupRan") is False or not hj.get("uoms"),
                  f"uomLookupRan={hj.get('uomLookupRan')}")

        check("a rate is still suggested with FBR off", hj.get("defaultRate") is not None,
              f"rate={hj.get('defaultRate')}")
        check("no FBR setup nagging reaches an FBR-off company",
              not any("province" in n.lower() for n in (hj.get("notes") or [])),
              f"notes={hj.get('notes')}")

        # ── 3. Editing ──────────────────────────────────────────────────
        target = get(f"itemtypes/{coded['id']}").json()
        target["name"] = f"Renamed Item {tag}"
        target["uom"] = "KG"
        r = put(f"itemtypes/{coded['id']}", target, companyId=company)
        check("an item can be renamed and its unit changed", r.ok,
              f"http {r.status_code}: {r.text[:140]}")
        after = get(f"itemtypes/{coded['id']}").json()
        check("the rename stuck", after.get("name") == f"Renamed Item {tag}",
              f"name={after.get('name')}")
        check("editing did not drop the HS code", after.get("hsCode") == real_code,
              f"hsCode={after.get('hsCode')}")

        bad = dict(after, hsCode=bogus_code)
        r = put(f"itemtypes/{coded['id']}", bad, companyId=company)
        check("an edit cannot move an item onto an unknown HS code",
              r.status_code == 400, f"http {r.status_code}")

        # ── 4. Imported placeholders ────────────────────────────────────
        curated = get("itemtypes", companyId=company).json()
        withauto = get("itemtypes", companyId=company, includeAutoGenerated="true").json()
        placeholders = [x for x in withauto if (x.get("name") or "").startswith("HS Code ")]
        if not placeholders:
            skip("placeholder cases", "no HS-code placeholders exist — import with createItemTypes")
        else:
            ph = placeholders[0]
            check("placeholders stay out of the default list",
                  not any((x.get("name") or "").startswith("HS Code ") for x in curated),
                  f"{sum(1 for x in curated if (x.get('name') or '').startswith('HS Code '))} leaked in")

            # The reported bug: unreachable by typing, because the picker filters
            # a list the server never sent.
            found = get("itemtypes", companyId=company,
                        includeAutoGenerated="true", search=ph["hsCode"], take=50).json()
            check("a placeholder is reachable by searching its HS code",
                  any(x["id"] == ph["id"] for x in found),
                  f"search {ph['hsCode']!r} -> {len(found)} rows")

            full = get(f"itemtypes/{ph['id']}").json()
            full["name"] = f"Adopted {tag}"
            full["uom"] = "Pcs"
            full["isFavorite"] = True
            r = put(f"itemtypes/{ph['id']}", full, companyId=company)
            check("a placeholder can be adopted — renamed, given a unit, favourited", r.ok,
                  f"http {r.status_code}: {r.text[:140]}")

            curated2 = get("itemtypes", companyId=company).json()
            check("an adopted placeholder then appears in the plain list",
                  any(x["id"] == ph["id"] for x in curated2),
                  "this is what puts it in every document picker")

        # ── 5. Reachable where it is actually used ──────────────────────
        # Being listed and being usable are different claims, so these create
        # real documents against the item.
        usable = get(f"itemtypes/{coded['id']}").json()

        r = post("stock/adjust", {
            "companyId": company, "itemTypeId": usable["id"], "delta": 7,
            "movementDate": date.today().isoformat(), "notes": "lifecycle suite",
        })
        check("the item can be used for a stock adjustment", r.ok,
              f"http {r.status_code}: {r.text[:140]}")

        onhand = get(f"stock/company/{company}/onhand").json()
        row = next((x for x in onhand if x.get("itemTypeId") == usable["id"]), None)
        check("the adjustment shows on the stock dashboard",
              row is not None and abs((row or {}).get("onHand", 0) - 7) < 0.001,
              f"onHand={(row or {}).get('onHand')}")

        client = S.post(f"{api}/clients", headers=h, timeout=60, json={
            "companyId": company, "name": f"Suite Client {tag}", "phone": "0300-0000000",
        }).json()
        r = post("invoices/standalone", {
            "companyId": company, "clientId": client["id"], "date": date.today().isoformat(),
            "gstRate": 18,
            "items": [{"description": usable["name"], "quantity": 2, "uom": usable.get("uom") or "Pcs",
                       "unitPrice": 1000, "itemTypeId": usable["id"]}],
        })
        check("the item can be billed on an invoice", r.status_code in (200, 201),
              f"http {r.status_code}: {r.text[:160]}")

        supplier = S.post(f"{api}/suppliers", headers=h, timeout=60, json={
            "companyId": company, "name": f"Suite Supplier {tag}", "phone": "0300-0000000",
        }).json()
        r = post("purchasebills", {
            "companyId": company, "supplierId": supplier["id"], "date": date.today().isoformat(),
            "gstRate": 18,
            "items": [{"description": usable["name"], "quantity": 3, "uom": usable.get("uom") or "Pcs",
                       "unitPrice": 500, "itemTypeId": usable["id"]}],
        })
        check("the item can be received on a purchase bill", r.status_code in (200, 201),
              f"http {r.status_code}: {r.text[:160]}")

    finally:
        if not args.keep:
            S.delete(f"{api}/companies/{company}", headers=h, timeout=600)
            for i in created_ids:
                S.delete(f"{api}/itemtypes/{i}", headers=h, timeout=120)

    return report()


def report():
    failed = [r for r in results if r[0] == FAIL]
    skipped = [r for r in results if r[0] == SKIP]
    print(f"\n{len(results) - len(failed) - len(skipped)} passed, "
          f"{len(failed)} failed, {len(skipped)} skipped")
    if failed:
        print("FAILURES:")
        for _, name, detail in failed:
            print(f"  - {name}: {detail}")
        return 1
    print("all PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""A standalone bill and its delivery challan — regression test.

Covers two things that ship together:

1. **Giving a standalone bill a delivery challan.** A bill raised without one
   can either attach an existing unbilled challan of the SAME buyer
   (`POST /api/invoices/{id}/link-challan/{challanId}`) or raise a new challan
   from its own lines (`POST /api/invoices/{id}/create-challan`). Every refusal
   is asserted too — another company, another buyer, an already-billed challan,
   a bill that already has one, a cancelled bill — because the guard is the
   whole feature: a bill joined to the wrong buyer's challan claims goods went
   somewhere they did not.

2. **A billed quantity smaller than the delivery is REVERSIBLE.** The bill form
   lets one item delivered several times be billed as a single edited quantity,
   and the delivery line is corrected to match. That correction used to destroy
   the delivered amount: deleting or voiding the bill handed the challan back to
   the billable pool carrying the REDUCED quantity, and the remainder — 48 of 50
   units in the case that found this — could never be billed by anyone.
   `DeliveryItem.DeliveredQuantity` keeps it and both release paths put it back.

Creates its own throwaway company, clients and documents, and deletes them
again. Run against a local backend (never production).

Usage:
  python scripts/test_standalone_bill_challan.py [--base URL] [--user U] [--pass P]
"""
from __future__ import annotations
import argparse, json, sys, urllib.request, urllib.error
from datetime import datetime, timezone


def http(method: str, path: str, base: str, token: str | None = None, body=None):
    url = base.rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode() if e.fp else ""
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except urllib.error.URLError as e:
        return 0, str(e)


PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((PASS if ok else FAIL, name, detail))
    print(f"  [{PASS if ok else FAIL}] {name}" + (f"  ({detail})" if detail else ""))


def today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")


def err_of(resp) -> str:
    if isinstance(resp, dict):
        return str(resp.get("error") or resp.get("message") or resp)
    return str(resp)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--pass", dest="pw", default="admin123")
    args = ap.parse_args()
    base = args.base

    st, data = http("POST", "/api/auth/login", base, body={"username": args.user, "password": args.pw})
    if st != 200 or not isinstance(data, dict) or "token" not in data:
        print(f"FATAL: admin login failed ({st} {data})")
        return 2
    tok = data["token"]

    def api(method, path, body=None):
        return http(method, path, base, tok, body)

    stamp = datetime.now().strftime("%H%M%S")
    created_companies: list[int] = []

    try:
        # ── Fixtures ────────────────────────────────────────────────────────
        # Numbering has to be seeded or the first document is refused.
        NUMBERING = {"startingChallanNumber": 1, "startingInvoiceNumber": 1,
                     "startingCreditNoteNumber": 1, "startingDebitNoteNumber": 1}
        st, co = api("POST", "/api/companies", {"name": f"ZZ Standalone Test {stamp}", **NUMBERING})
        if st not in (200, 201):
            print(f"FATAL: could not create company ({st} {co})")
            return 2
        cid = co["id"]
        created_companies.append(cid)

        st, co2 = api("POST", "/api/companies", {"name": f"ZZ Standalone Other {stamp}", **NUMBERING})
        if st not in (200, 201):
            print(f"FATAL: could not create second company ({st} {co2})")
            return 2
        cid2 = co2["id"]
        created_companies.append(cid2)

        def mk_client(company_id, name):
            s, c = api("POST", "/api/clients", {"companyId": company_id, "name": name})
            assert s in (200, 201), f"client create failed {s} {c}"
            return c["id"]

        buyer = mk_client(cid, f"ZZ Buyer A {stamp}")
        buyer_b = mk_client(cid, f"ZZ Buyer B {stamp}")
        buyer_other_co = mk_client(cid2, f"ZZ Buyer Other {stamp}")

        ITEM = f"ZZ Widget {stamp}"

        # New companies default to Inventory V2, where every bill line must name
        # an item type — so the fixtures carry one.
        st, it = api("POST", f"/api/itemtypes?companyId={cid}", {
            "name": f"ZZ Type {stamp}", "hsCode": "8481.1000", "uom": "PCS",
            "saleType": "Goods at standard rate (default)",
        })
        if st not in (200, 201):
            print(f"FATAL: could not create item type ({st} {it})")
            return 2
        item_type_id = it["id"]

        def mk_challan(company_id, client_id, qty, desc=ITEM):
            s, ch = api("POST", f"/api/deliverychallans/company/{company_id}", {
                "companyId": company_id, "clientId": client_id,
                "deliveryDate": today(), "poNumber": f"PO-{stamp}",
                "items": [{"description": desc, "quantity": qty, "unit": "PCS",
                           "itemTypeId": item_type_id}],
            })
            assert s in (200, 201), f"challan create failed {s} {ch}"
            return ch

        def mk_standalone_bill(company_id, client_id, qty=3, desc=ITEM):
            s, inv = api("POST", "/api/invoices/standalone", {
                "companyId": company_id, "clientId": client_id,
                "date": today(), "gstRate": 18,
                "items": [{"description": desc, "quantity": qty, "unitPrice": 100,
                           "UOM": "PCS", "itemTypeId": item_type_id}],
            })
            assert s in (200, 201), f"standalone bill create failed {s} {inv}"
            return inv

        # ══ Suite 1 — attach an existing challan ════════════════════════════
        print("\n-- Suite 1: attach an existing delivery challan --")
        bill = mk_standalone_bill(cid, buyer)
        check("a standalone bill starts with no challan", not bill.get("challanNumbers"),
              f"challanNumbers={bill.get('challanNumbers')}")

        dc = mk_challan(cid, buyer, 10)
        st, linked = api("POST", f"/api/invoices/{bill['id']}/link-challan/{dc['id']}")
        check("attaching this buyer's unbilled challan succeeds", st == 200,
              str(st) if st == 200 else f"{st} {err_of(linked)}")
        check("the bill now carries the challan number",
              isinstance(linked, dict) and dc["challanNumber"] in (linked.get("challanNumbers") or []),
              str(linked.get("challanNumbers") if isinstance(linked, dict) else linked))

        st, dc_after = api("GET", f"/api/deliverychallans/{dc['id']}")
        check("the challan is marked Invoiced", st == 200 and dc_after.get("status") == "Invoiced",
              str(dc_after.get("status") if st == 200 else st))
        check("the challan points back at the bill",
              st == 200 and dc_after.get("invoiceId") == bill["id"],
              str(dc_after.get("invoiceId") if st == 200 else st))

        # ── Refusals ────────────────────────────────────────────────────────
        print("\n-- Suite 2: what may not be attached --")
        dc2 = mk_challan(cid, buyer, 5)
        st, resp = api("POST", f"/api/invoices/{bill['id']}/link-challan/{dc2['id']}")
        check("a bill that already has a challan is refused", st == 400, f"{st} {err_of(resp)}")
        check("...and says so", "already raised from a delivery challan" in err_of(resp).lower()
              or "already" in err_of(resp).lower(), err_of(resp))

        bill2 = mk_standalone_bill(cid, buyer)
        st, resp = api("POST", f"/api/invoices/{bill2['id']}/link-challan/{dc['id']}")
        check("an already-billed challan is refused", st == 400, f"{st} {err_of(resp)}")
        check("...and names it", "already billed" in err_of(resp).lower(), err_of(resp))

        dc_other_buyer = mk_challan(cid, buyer_b, 4)
        st, resp = api("POST", f"/api/invoices/{bill2['id']}/link-challan/{dc_other_buyer['id']}")
        check("another buyer's challan is refused", st == 400, f"{st} {err_of(resp)}")
        check("...and says the buyer differs", "buyer" in err_of(resp).lower(), err_of(resp))

        dc_other_co = mk_challan(cid2, buyer_other_co, 4)
        st, resp = api("POST", f"/api/invoices/{bill2['id']}/link-challan/{dc_other_co['id']}")
        check("another COMPANY's challan is refused", st == 400, f"{st} {err_of(resp)}")
        check("...and says the company differs", "company" in err_of(resp).lower(), err_of(resp))

        st, resp = api("POST", f"/api/invoices/{bill2['id']}/link-challan/99999999")
        check("an unknown challan is 404", st == 404, f"{st} {err_of(resp)}")

        # A cancelled bill cannot take one.
        bill_void = mk_standalone_bill(cid, buyer)
        st, _ = api("POST", f"/api/invoices/{bill_void['id']}/cancel", {"reason": "test"})
        if st == 200:
            st, resp = api("POST", f"/api/invoices/{bill_void['id']}/link-challan/{dc2['id']}")
            check("a cancelled bill is refused", st == 400, f"{st} {err_of(resp)}")
            check("...and says it is cancelled", "cancelled" in err_of(resp).lower(), err_of(resp))
        else:
            check("a cancelled bill is refused", False, f"could not void the bill: {st}")
            check("...and says it is cancelled", False, "skipped")

        # ══ Suite 3 — raise a challan FROM a standalone bill ═════════════════
        print("\n-- Suite 3: raise a challan from a standalone bill --")
        bill3 = mk_standalone_bill(cid, buyer, qty=7)
        st, made = api("POST", f"/api/invoices/{bill3['id']}/create-challan")
        check("raising a challan from a standalone bill succeeds", st == 200,
              str(st) if st == 200 else f"{st} {err_of(made)}")
        nums = (made.get("challanNumbers") or []) if isinstance(made, dict) else []
        check("the bill now carries exactly one challan", len(nums) == 1, str(nums))

        if nums:
            st, listed = api("GET", f"/api/deliverychallans/company/{cid}")
            rows = listed if isinstance(listed, list) else (listed or {}).get("items", [])
            new_dc = next((c for c in rows if c.get("invoiceId") == bill3["id"]), None)
            check("the new challan exists and is linked to the bill", new_dc is not None)
            if new_dc:
                check("it is marked Invoiced — it is not billable again",
                      new_dc.get("status") == "Invoiced", str(new_dc.get("status")))
                st, full = api("GET", f"/api/deliverychallans/{new_dc['id']}")
                items = (full or {}).get("items", []) if st == 200 else []
                check("its lines mirror the bill's", len(items) == 1, f"{len(items)} line(s)")
                if items:
                    check("...including the quantity", float(items[0].get("quantity", 0)) == 7.0,
                          str(items[0].get("quantity")))
                    check("...and the description", items[0].get("description") == ITEM,
                          str(items[0].get("description")))
                # The bill's line is joined to the delivery line, as it would be
                # had the bill been raised from the challan in the first place.
                st, reread = api("GET", f"/api/invoices/{bill3['id']}")
                bill_items = (reread or {}).get("items", []) if st == 200 else []
                check("the bill's line points at the delivery line it came from",
                      len(bill_items) == 1 and bill_items[0].get("deliveryItemId") is not None,
                      str(bill_items[0].get("deliveryItemId") if bill_items else None))

        st, resp = api("POST", f"/api/invoices/{bill3['id']}/create-challan")
        check("a bill that already has a challan cannot raise another", st == 400, f"{st} {err_of(resp)}")

        # ══ Suite 4 — a smaller billed quantity is reversible ════════════════
        print("\n-- Suite 4: billing less than was delivered, then deleting --")
        DELIVERED, BILLED = 50.0, 2.0
        dc_big = mk_challan(cid, buyer, DELIVERED)
        del_item_id = dc_big["items"][0]["id"]

        st, billed = api("POST", "/api/invoices", {
            "companyId": cid, "clientId": buyer, "date": today(), "gstRate": 18,
            "challanIds": [dc_big["id"]],
            "items": [{"deliveryItemId": del_item_id, "quantity": BILLED,
                       "unitPrice": 100, "description": ITEM, "itemTypeId": item_type_id}],
        })
        check("a bill can be raised for less than was delivered", st in (200, 201),
              str(st) if st in (200, 201) else f"{st} {err_of(billed)}")

        if st in (200, 201):
            st, dcv = api("GET", f"/api/deliverychallans/{dc_big['id']}")
            qty_now = float((dcv.get("items") or [{}])[0].get("quantity", -1)) if st == 200 else -1
            check("the delivery line follows the bill", qty_now == BILLED, f"qty={qty_now}")

            st, _ = api("DELETE", f"/api/invoices/{billed['id']}")
            check("the bill deletes", st == 200, str(st))

            st, dcv = api("GET", f"/api/deliverychallans/{dc_big['id']}")
            qty_back = float((dcv.get("items") or [{}])[0].get("quantity", -1)) if st == 200 else -1
            # THE point of this suite. Before DeliveredQuantity existed this came
            # back as 2.0 and 48 units were gone for good.
            check("deleting the bill puts the DELIVERED quantity back",
                  qty_back == DELIVERED, f"qty={qty_back} (expected {DELIVERED})")
            check("the challan is billable again",
                  st == 200 and dcv.get("invoiceId") is None
                  and dcv.get("status") in ("Pending", "Imported", "No PO"),
                  f"status={dcv.get('status')} invoiceId={dcv.get('invoiceId')}")

            # It must be billable for the FULL delivery, not just look billable.
            st, rebill = api("POST", "/api/invoices", {
                "companyId": cid, "clientId": buyer, "date": today(), "gstRate": 18,
                "challanIds": [dc_big["id"]],
                "items": [{"deliveryItemId": del_item_id, "quantity": DELIVERED,
                           "unitPrice": 100, "description": ITEM, "itemTypeId": item_type_id}],
            })
            check("the whole delivery can be billed afterwards", st in (200, 201),
                  str(st) if st in (200, 201) else f"{st} {err_of(rebill)}")
            if st in (200, 201):
                api("DELETE", f"/api/invoices/{rebill['id']}")

        print("\n-- Suite 5: the same, via Void --")
        dc_void = mk_challan(cid, buyer, DELIVERED)
        dv_item = dc_void["items"][0]["id"]
        st, vbill = api("POST", "/api/invoices", {
            "companyId": cid, "clientId": buyer, "date": today(), "gstRate": 18,
            "challanIds": [dc_void["id"]],
            "items": [{"deliveryItemId": dv_item, "quantity": BILLED,
                       "unitPrice": 100, "description": ITEM, "itemTypeId": item_type_id}],
        })
        if st in (200, 201):
            st, _ = api("POST", f"/api/invoices/{vbill['id']}/cancel", {"reason": "test"})
            check("the bill voids", st == 200, str(st))
            st, dcv = api("GET", f"/api/deliverychallans/{dc_void['id']}")
            qty_back = float((dcv.get("items") or [{}])[0].get("quantity", -1)) if st == 200 else -1
            check("voiding the bill puts the DELIVERED quantity back",
                  qty_back == DELIVERED, f"qty={qty_back} (expected {DELIVERED})")
        else:
            check("the bill voids", False, f"could not create it: {st} {err_of(vbill)}")
            check("voiding the bill puts the DELIVERED quantity back", False, "skipped")

        # ══ Suite 7 — detaching a challan attached by mistake ═══════════════
        print("\n-- Suite 7: detach a challan attached to the wrong bill --")
        wrong_bill = mk_standalone_bill(cid, buyer, qty=2)
        dc_wrong = mk_challan(cid, buyer, 9)
        st, _ = api("POST", f"/api/invoices/{wrong_bill['id']}/link-challan/{dc_wrong['id']}")
        check("a challan can be attached to the wrong bill", st == 200, str(st))

        st, after = api("POST", f"/api/invoices/{wrong_bill['id']}/unlink-challan/{dc_wrong['id']}")
        check("detaching it succeeds", st == 200,
              str(st) if st == 200 else f"{st} {err_of(after)}")
        check("the bill carries no challan again",
              isinstance(after, dict) and not after.get("challanNumbers"),
              str(after.get("challanNumbers") if isinstance(after, dict) else after))

        st, dcv = api("GET", f"/api/deliverychallans/{dc_wrong['id']}")
        check("the challan is billable again",
              st == 200 and dcv.get("invoiceId") is None
              and dcv.get("status") in ("Pending", "Imported", "No PO"),
              f"status={dcv.get('status')} invoiceId={dcv.get('invoiceId')}")
        check("its delivery quantity is untouched",
              st == 200 and float((dcv.get("items") or [{}])[0].get("quantity", -1)) == 9.0,
              str((dcv.get("items") or [{}])[0].get("quantity")))

        st, reread = api("GET", f"/api/invoices/{wrong_bill['id']}")
        check("the bill itself is unchanged",
              st == 200 and len(reread.get("items") or []) == 1
              and float((reread["items"][0]).get("quantity", 0)) == 2.0,
              f"{len(reread.get('items') or [])} line(s)")

        # It really is free — it can now go onto the right bill.
        right_bill = mk_standalone_bill(cid, buyer, qty=1)
        st, _ = api("POST", f"/api/invoices/{right_bill['id']}/link-challan/{dc_wrong['id']}")
        check("the freed challan attaches to the right bill", st == 200, str(st))
        api("POST", f"/api/invoices/{right_bill['id']}/unlink-challan/{dc_wrong['id']}")

        print("\n-- Suite 8: what may not be detached --")
        # A bill RAISED FROM a challan references its delivery lines, so cutting
        # the link would leave the bill billing goods the challan is free to be
        # sold again. Refused — the bill is voided or deleted instead.
        dc_src = mk_challan(cid, buyer, 6)
        st, from_challan = api("POST", "/api/invoices", {
            "companyId": cid, "clientId": buyer, "date": today(), "gstRate": 18,
            "challanIds": [dc_src["id"]],
            "items": [{"deliveryItemId": dc_src["items"][0]["id"], "unitPrice": 100,
                       "description": ITEM, "itemTypeId": item_type_id}],
        })
        check("a bill can be raised from a challan", st in (200, 201),
              str(st) if st in (200, 201) else f"{st} {err_of(from_challan)}")
        if st in (200, 201):
            st, resp = api("POST", f"/api/invoices/{from_challan['id']}/unlink-challan/{dc_src['id']}")
            check("a bill raised FROM the challan refuses to detach it", st == 400,
                  f"{st} {err_of(resp)}")
            check("...and points at delete or void",
                  "delete" in err_of(resp).lower() or "void" in err_of(resp).lower(),
                  err_of(resp))
            api("DELETE", f"/api/invoices/{from_challan['id']}")

        lone = mk_standalone_bill(cid, buyer)
        dc_elsewhere = mk_challan(cid, buyer, 3)
        st, resp = api("POST", f"/api/invoices/{lone['id']}/unlink-challan/{dc_elsewhere['id']}")
        check("detaching a challan that is not on the bill is 404", st == 404,
              f"{st} {err_of(resp)}")

        # The read DTO must carry the challan ids, because that is what the UI
        # needs to detach one — a ChallanNumber is deliberately not unique.
        idbill = mk_standalone_bill(cid, buyer)
        dc_id = mk_challan(cid, buyer, 4)
        st, linked_dto = api("POST", f"/api/invoices/{idbill['id']}/link-challan/{dc_id['id']}")
        check("the bill exposes the linked challan's id", st == 200
              and (linked_dto.get("challanIds") or []) == [dc_id["id"]],
              str(linked_dto.get("challanIds") if st == 200 else st))
        check("ids and numbers line up", st == 200
              and len(linked_dto.get("challanIds") or []) == len(linked_dto.get("challanNumbers") or []),
              f"ids={linked_dto.get('challanIds')} numbers={linked_dto.get('challanNumbers')}")
        api("POST", f"/api/invoices/{idbill['id']}/unlink-challan/{dc_id['id']}")


        print("\n-- Suite 6: an untouched delivery is left alone --")
        dc_plain = mk_challan(cid, buyer, 8)
        dp_item = dc_plain["items"][0]["id"]
        st, pbill = api("POST", "/api/invoices", {
            "companyId": cid, "clientId": buyer, "date": today(), "gstRate": 18,
            "challanIds": [dc_plain["id"]],
            "items": [{"deliveryItemId": dp_item, "unitPrice": 100, "description": ITEM,
                       "itemTypeId": item_type_id}],
        })
        check("a bill with no quantity given bills what was delivered", st in (200, 201),
              str(st) if st in (200, 201) else f"{st} {err_of(pbill)}")
        if st in (200, 201):
            line = (pbill.get("items") or [{}])[0]
            check("...at the delivered quantity", float(line.get("quantity", -1)) == 8.0,
                  str(line.get("quantity")))
            api("DELETE", f"/api/invoices/{pbill['id']}")
            st, dcv = api("GET", f"/api/deliverychallans/{dc_plain['id']}")
            qty_back = float((dcv.get("items") or [{}])[0].get("quantity", -1)) if st == 200 else -1
            check("and its delivery line is unchanged through delete", qty_back == 8.0,
                  f"qty={qty_back}")

    finally:
        for company_id in created_companies:
            http("DELETE", f"/api/companies/{company_id}", base, tok)

    failed = [r for r in results if r[0] == FAIL]
    print(f"\n=== {len(results) - len(failed)}/{len(results)} checks passed ===")
    if failed:
        print("\nFAILURES:")
        for _, name, detail in failed:
            print(f"  - {name}  ({detail})")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

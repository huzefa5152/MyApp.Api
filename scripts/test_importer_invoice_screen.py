"""
The importer's one Invoices screen, end to end against a running backend.

Each run makes its own throwaway company, buyer and items, so no existing
company's data is read or changed. Never files with FBR: the FBR checks use
the read-only payload preview.

Suites
  D6  a line is never saved without a description; FBR gets it blank
      (plan cases 48, 55, 56)
  D7  an FBR HS code becomes the company's item when the invoice is saved,
      inside the invoice's transaction, with the catalog's own rules and the
      itemtypes.manage.create right re-checked (cases 14, 32-40)
  D8  the stock guard still refuses a sale of a brand-new item on a
      hard-block company, and nothing is left behind (cases 41, 41c)
  MCP the hosted MCP follows the screen: prepare_bill's newItemType, and the
      retired Bill print type refused with a pointer to TaxInvoice

Run:  python scripts/test_importer_invoice_screen.py --base http://localhost:5195
"""
import argparse
import json
import sys
import urllib.error
import urllib.parse
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


def make_company(base, token, name, hard_block=False):
    st, co = http("POST", "/api/companies", base, token=token, body={
        "inventoryTrackingEnabled": True, "stockGuardHardBlock": hard_block,
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


def find_items(base, token, company_id, term):
    q = urllib.parse.quote(term)
    st, rows = http("GET", f"/api/itemtypes?companyId={company_id}&includeAutoGenerated=true&search={q}&take=50",
                    base, token=token)
    return rows if isinstance(rows, list) else []


def placeholder_for(base, token, company_id):
    """A shared tariff row (HS import placeholder) the company does not hold."""
    for term in ("8481", "8413", "8501", "3926"):
        for r in find_items(base, token, company_id, term):
            if r.get("isAutoGenerated") and not r.get("isFavorite") and r.get("hsCode"):
                return r
    return None


def new_line(n, qty=1, price=100):
    return {"description": "", "quantity": qty, "uom": "Numbers, pieces, units",
            "unitPrice": price, "newItemType": n}


def line_ids(inv):
    return [i.get("itemTypeId") for i in inv.get("items", [])] if isinstance(inv, dict) else []


UNIT = "Numbers, pieces, units"


def suite_d7_d8(base, token):
    print("\n=== D7 / D8: new items made on save ===")
    soft = make_company(base, token, f"_test_newitem_soft {SUFFIX}")
    hard = make_company(base, token, f"_test_newitem_hard {SUFFIX}", hard_block=True)
    other = make_company(base, token, f"_test_newitem_other {SUFFIX}")
    soft_cl = make_client(base, token, soft["id"])
    hard_cl = make_client(base, token, hard["id"])
    ph = placeholder_for(base, token, soft["id"])
    if not check("a shared tariff placeholder is available", ph is not None):
        return
    hs = ph["hsCode"]
    print(f"  placeholder id={ph['id']} hs={hs}")

    # 32/34 unchanged name -> the placeholder itself, registered, never adopted
    st, inv = standalone(base, token, soft, soft_cl, [
        new_line({"placeholderId": ph["id"], "name": ph["name"], "hsCode": hs, "uom": UNIT})])
    check("34: invoice with an unchanged FBR pick saves", st in (200, 201), f"{st} {inv}")
    check("34: the line points at the tariff row", line_ids(inv) == [ph["id"]], f"got {line_ids(inv)}")
    st, row = http("GET", f"/api/itemtypes/{ph['id']}", base, token=token)
    check("34: the shared row's isFavorite is untouched",
          isinstance(row, dict) and not row.get("isFavorite"), str(row)[:200])
    check("34: the company now lists the item",
          any(r["id"] == ph["id"] for r in find_items(base, token, soft["id"], hs)))

    # 34/35 edited name -> the company's own new item, once for two lines
    own = f"Own Valve {SUFFIX}"
    pick = {"placeholderId": ph["id"], "name": own, "hsCode": hs, "uom": UNIT}
    st, inv = standalone(base, token, soft, soft_cl, [new_line(pick), new_line(dict(pick), qty=2)])
    check("34: invoice with an edited name saves", st in (200, 201), f"{st} {inv}")
    ids = set(line_ids(inv))
    made = [r for r in find_items(base, token, soft["id"], own) if r["name"] == own]
    check("35: the same new code on two lines makes ONE item", len(made) == 1 and len(ids) == 1, f"{made} {ids}")
    own_id = made[0]["id"] if made else 0
    if made:
        m = made[0]
        check("34: new item has the HS code, unit and isFavorite",
              m.get("hsCode") == hs and m.get("isFavorite") and m.get("uom") == UNIT, str(m)[:200])
        check("34: the lines point at it", ids == {own_id}, f"{ids}")
        check("40: another company does not see it",
              not any(r["id"] == own_id for r in find_items(base, token, other["id"], own)))

    # 37/38 an item of that name already exists -> reused; case and outer spaces ignored
    st, inv = standalone(base, token, soft, soft_cl, [new_line({"name": f"  {own.upper()}  ", "hsCode": hs, "uom": UNIT})])
    check("37/38: an existing item (other case, outer spaces) is reused, no error",
          st in (200, 201) and set(line_ids(inv)) == {own_id}, f"{st} {line_ids(inv)} {str(inv)[:200]}")
    check("38: still one item of that name",
          len([r for r in find_items(base, token, soft["id"], own) if r["name"].strip().lower() == own.lower()]) == 1)
    reuse_inv = inv

    # 36 the invoice fails -> no item left behind
    ghost = f"Ghost Item {SUFFIX}"
    st, body = http("POST", "/api/invoices/standalone", base, token=token, body={
        "date": TODAY, "companyId": soft["id"], "clientId": 999999999, "gstRate": 18,
        "items": [new_line({"name": ghost, "hsCode": hs, "uom": UNIT})]})
    check("36: an invoice with a bad buyer is refused", st in (400, 404), f"{st} {body}")
    check("36: and no item was made", not find_items(base, token, soft["id"], ghost))

    # 39 edit an invoice and add a line with a new code
    edit_name = f"Edit Added {SUFFIX}"
    inv_id = reuse_inv.get("id") if isinstance(reuse_inv, dict) else 0
    st, full = http("GET", f"/api/invoices/{inv_id}", base, token=token)
    items_in = [{"id": i["id"], "itemTypeId": i.get("itemTypeId"), "description": i.get("description"),
                 "quantity": float(i["quantity"]), "uom": i.get("uom"), "unitPrice": float(i["unitPrice"])}
                for i in (full or {}).get("items", [])] if isinstance(full, dict) else []
    items_in.append({"id": 0, "description": "", "quantity": 1, "uom": UNIT, "unitPrice": 10,
                     "newItemType": {"name": edit_name, "hsCode": hs, "uom": UNIT}})
    st, upd = http("PUT", f"/api/invoices/{inv_id}", base, token=token, body={"gstRate": 18, "items": items_in})
    added = [r for r in find_items(base, token, soft["id"], edit_name) if r["name"] == edit_name]
    check("39: an edit can add a line with a new FBR code", st == 200 and len(added) == 1, f"{st} {str(upd)[:200]}")

    # 41 hard-block company: a new item has no stock -> refused, rolled back
    hb_name = f"Hard Block Item {SUFFIX}"
    st, body = standalone(base, token, hard, hard_cl, [new_line({"name": hb_name, "hsCode": hs, "uom": UNIT})])
    check("41: hard-block company refuses selling a brand-new item (409)", st == 409, f"{st} {body}")
    check("41: and the item was not made", not find_items(base, token, hard["id"], hb_name))

    # 41c a catalog item with too little stock on a hard-block company -> refused as today
    st, it = http("POST", f"/api/itemtypes?companyId={hard['id']}", base, token=token, body={
        "name": f"Hard Catalog {SUFFIX}", "hsCode": hs, "uom": UNIT, "isFavorite": True})
    if check("41c: catalog item created", st in (200, 201), f"{st} {it}"):
        st, body = standalone(base, token, hard, hard_cl, [
            {"itemTypeId": it["id"], "description": "x", "quantity": 5, "uom": UNIT, "unitPrice": 10}])
        check("41c: oversell of a catalog item still refused (409)", st == 409, f"{st} {body}")

    # 14 / 40 a user without the catalog right, and a company never given
    role_name = f"InvScreen NoCatalog {SUFFIX}"
    st, role = http("POST", "/api/roles", base, token=token, body={
        "name": role_name, "description": "invoice screen test",
        "permissionKeys": ["bills.list.view", "bills.manage.create.standalone", "bills.manage.update"]})
    if not check("test role created", st in (200, 201), f"{st} {role}"):
        return
    uname = f"invscr_{SUFFIX}"
    st, user = http("POST", "/api/users", base, token=token, body={
        "username": uname, "password": "test1234", "fullName": "Invoice Screen Test",
        "role": role_name, "roleIds": [role["id"]], "companyIds": [soft["id"]]})
    if not check("test user created", st in (200, 201), f"{st} {user}"):
        return
    ut = login(base, uname, "test1234")
    denied = f"Denied Item {SUFFIX}"
    st, body = standalone(base, ut, soft, soft_cl, [new_line({"name": denied, "hsCode": hs, "uom": UNIT})])
    check("14: newItemType without itemtypes.manage.create -> 403", st == 403, f"{st} {body}")
    check("14: and nothing was made", not find_items(base, token, soft["id"], denied))
    st, body = standalone(base, ut, soft, soft_cl, [
        {"itemTypeId": own_id, "description": "ok", "quantity": 1, "uom": UNIT, "unitPrice": 10}])
    check("14: the same user still saves with a catalog item", st in (200, 201), f"{st} {body}")
    other_name = f"Other Co Item {SUFFIX}"
    st, body = http("POST", "/api/invoices/standalone", base, token=ut, body={
        "date": TODAY, "companyId": other["id"], "clientId": soft_cl["id"], "gstRate": 18,
        "items": [new_line({"name": other_name, "hsCode": hs, "uom": UNIT})]})
    check("40: newItemType for an unassigned company -> 403", st == 403, f"{st} {body}")
    check("40: and no item anywhere",
          not find_items(base, token, other["id"], other_name) and not find_items(base, token, soft["id"], other_name))


def suite_mcp(base, token):
    """The hosted MCP follows the screen: prepare_bill makes a new item on commit (with the
    catalog right, in the bill's transaction), and the retired Bill print type is refused."""
    print("\n=== MCP: prepare_bill new items, retired Bill print type ===")
    sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
    import mcp_importer_fixture as fx
    fx.set_base(base)
    admin = fx.login("admin", "admin123")
    A, B = fx.companies(admin)
    fx.remove_users(admin, "invscr_mcp_")
    sysr = fx.system_roles(admin)
    staff, mcpa, mcpw = fx.staff_role(admin), sysr["MCP Access"], sysr["MCP Write"]
    _, jw = fx.make_user(admin, "invscr_mcp_writer", [A], [staff, mcpa, mcpw])
    T = fx.token_for(jw, [A])
    st, clients = http("GET", f"/api/clients/company/{A}", base, token=token)
    client = clients[0]["id"] if isinstance(clients, list) and clients else None
    if not check("MCP fixture company has a customer", client is not None, str(clients)[:200]):
        return
    name = f"MCP New Item {SUFFIX}"
    args = {"companyId": A, "clientId": client, "items": [{"description": "", "quantity": "1", "unit": UNIT, "unitPrice": "100",
            "newItemType": {"name": name, "hsCode": "8481.8090"}}]}
    refused, text = fx.call(T, "prepare_bill", args)
    if refused and "description" in text.lower():   # descriptions are required on MCP lines
        args["items"][0]["description"] = "Valve"
        refused, text = fx.call(T, "prepare_bill", args)
    plan = None if refused else json.loads(text)
    check("prepare_bill takes a newItemType line", plan is not None and "newItem" in text, text[:300])
    check("prepare saves no item", not [r for r in find_items(base, token, A, name) if r["name"] == name])
    if plan:
        refused, text = fx.call(T, "commit_action", {"planId": plan["planId"]})
        made = [r for r in find_items(base, token, A, name) if r["name"] == name]
        if refused:
            check("commit refused only for stock (hard-block company), and no item left behind",
                  "stock" in text.lower() and not made, text[:300])
        else:
            check("commit makes the item in the bill's company", len(made) == 1, text[:300])
            check("...and not in another company", not [r for r in find_items(base, token, B, name) if r["name"] == name])
    # a writer without the catalog right
    keys = [p["key"] for p in http("GET", "/api/permissions", base, token=admin)[1]
            if not p["key"].startswith(fx.ADMIN_PREFIXES) and not p["key"].startswith("itemtypes.manage.c")]
    nocat = fx.role_with(admin, "InvScreen MCP no catalog create", keys)
    _, jn = fx.make_user(admin, "invscr_mcp_nocat", [A], [nocat, mcpa, mcpw])
    Tn = fx.token_for(jn, [A])
    args["items"][0]["newItemType"]["name"] = f"MCP Denied {SUFFIX}"
    args["items"][0]["description"] = "Valve"
    refused, text = fx.call(Tn, "prepare_bill", args)
    check("prepare_bill with newItemType needs itemtypes.manage.create", refused and "itemtypes.manage.create" in text, text[:300])
    # the retired Bill print document
    refused, text = fx.call(T, "get_print_contract", {"documentType": "Bill"})
    check("get_print_contract refuses Bill and names TaxInvoice", refused and "TaxInvoice" in text, text[:200])
    refused, text = fx.call(T, "list_print_templates", {"companyId": A})
    check("list_print_templates lists no Bill designs", not refused and '"documentType": "Bill"' not in text and '"documentType":"Bill"' not in text, text[:200])
    refused, text = fx.call(T, "prepare_print_template", {"companyId": A, "action": "create", "templateType": "Bill", "name": "x", "htmlContent": "<p>x</p>"})
    check("prepare_print_template refuses a new Bill design", refused and "TaxInvoice" in text, text[:200])


def suite_filed_manually(base, token):
    """Recording an invoice as filed by hand on FBR's portal (case 53): never sent, keeps the
    portal number, leaves stock as the save left it, stays editable, and MCP can record it."""
    print("\n=== Filed manually on FBR's portal ===")
    co = make_company(base, token, f"_test_manual {SUFFIX}")
    cl = make_client(base, token, co["id"])
    st, it = http("POST", f"/api/itemtypes?companyId={co['id']}", base, token=token, body={
        "name": f"Manual Valve {SUFFIX}", "hsCode": "8481.8090", "uom": UNIT, "isFavorite": True})
    if not check("an HS item for the stock check", st in (200, 201), f"{st} {it}"):
        return
    st, inv = standalone(base, token, co, cl, [
        {"itemTypeId": it["id"], "description": "Valve", "quantity": 2, "uom": UNIT, "unitPrice": 100}])
    if not check("an unfiled invoice", st in (200, 201), f"{st} {inv}"):
        return

    def on_hand():
        s, rows = http("GET", f"/api/itemtypes?companyId={co['id']}&search={urllib.parse.quote(it['name'])}", base, token=token)
        row = next((r for r in (rows or []) if r.get("id") == it["id"]), {}) if isinstance(rows, list) else {}
        return row.get("availableQty")

    before = on_hand()
    st, body = http("POST", f"/api/fbr/{inv['id']}/reset-submission", base, token=token, body={"mode": "recordManual", "reason": "test"})
    check("a portal number is required", st == 400, f"{st} {body}")
    st, body = http("POST", f"/api/fbr/{inv['id']}/reset-submission", base, token=token,
                    body={"mode": "recordManual", "manualFbrInvoiceNumber": "PORTAL-7", "reason": "filed by hand in a test"})
    check("53: recorded as filed manually", st == 200, f"{st} {body}")
    st, full = http("GET", f"/api/invoices/{inv['id']}", base, token=token)
    check("53: marked filed, no IRN, the portal's number kept",
          full.get("fbrStatus") == "Submitted" and full.get("fbrFiledManually") and not full.get("fbrIRN")
          and full.get("fbrInvoiceNumber") == "PORTAL-7", {k: full.get(k) for k in ("fbrStatus", "fbrFiledManually", "fbrIRN", "fbrInvoiceNumber")})
    check("recording it changes no stock (the save already took the goods out)", on_hand() == before, (before, on_hand()))
    items_in = [{"id": i["id"], "itemTypeId": i.get("itemTypeId"), "description": "Valve, corrected",
                 "quantity": float(i["quantity"]), "uom": i.get("uom"), "unitPrice": float(i["unitPrice"])} for i in full["items"]]
    st, upd = http("PUT", f"/api/invoices/{inv['id']}", base, token=token, body={"gstRate": 18, "items": items_in})
    check("a manually filed invoice can still be edited", st == 200, f"{st} {str(upd)[:200]}")
    st, body = http("POST", f"/api/fbr/{inv['id']}/reset-submission", base, token=token,
                    body={"mode": "recordManual", "manualFbrInvoiceNumber": "PORTAL-8", "reason": "again"})
    check("it cannot be recorded twice", st == 400, f"{st} {body}")

    # The operator chooses, per HS code, whether a hand-filed invoice's goods leave stock.
    st, it2 = http("POST", f"/api/itemtypes?companyId={co['id']}", base, token=token, body={
        "name": f"Manual Elbow {SUFFIX}", "hsCode": "7307.1190", "uom": UNIT, "isFavorite": True})
    if not check("a second HS item", st in (200, 201), f"{st} {it2}"):
        return

    def qty(item):
        s, rows = http("GET", f"/api/itemtypes?companyId={co['id']}&search={urllib.parse.quote(item['name'])}", base, token=token)
        row = next((r for r in (rows or []) if r.get("id") == item["id"]), {}) if isinstance(rows, list) else {}
        return row.get("availableQty")

    v0, e0 = qty(it), qty(it2)
    st, inv3 = standalone(base, token, co, cl, [
        {"itemTypeId": it["id"], "description": "Valve", "quantity": 3, "uom": UNIT, "unitPrice": 100},
        {"itemTypeId": it2["id"], "description": "Elbow", "quantity": 5, "uom": UNIT, "unitPrice": 50}])
    if not check("an unfiled invoice with two HS codes", st in (200, 201), f"{st} {inv3}"):
        return
    v1, e1 = qty(it), qty(it2)
    check("saving it took both HS codes out of stock", v1 == v0 - 3 and e1 == e0 - 5, (v0, v1, e0, e1))
    st, body = http("POST", f"/api/fbr/{inv3['id']}/reset-submission", base, token=token, body={
        "mode": "recordManual", "manualFbrInvoiceNumber": "PORTAL-10", "keepInStockHsCodes": ["0101.0000"], "reason": "t"})
    check("an HS code not on the invoice is refused", st == 400 and "not on this invoice" in str(body), f"{st} {body}")
    st, body = http("POST", f"/api/fbr/{inv3['id']}/reset-submission", base, token=token, body={
        "mode": "retry", "keepInStockHsCodes": ["7307.1190"], "reason": "t"})
    check("only a hand-filed recording can keep goods in stock", st == 400, f"{st} {body}")
    st, body = http("POST", f"/api/fbr/{inv3['id']}/reset-submission", base, token=token, body={
        "mode": "recordManual", "manualFbrInvoiceNumber": "PORTAL-10", "keepInStockHsCodes": ["7307.1190"], "reason": "elbows were samples"})
    check("recorded as filed, keeping HS 7307.1190 in stock", st == 200 and "7307.1190" in str(body), f"{st} {body}")
    check("the kept HS code's goods are back in stock, the other's stay out",
          qty(it) == v1 and qty(it2) == e0, (qty(it), v1, qty(it2), e0))
    st, full3 = http("GET", f"/api/invoices/{inv3['id']}", base, token=token)
    kept = {i.get("hsCode"): i.get("keepInStock") for i in full3.get("items", [])}
    check("the lines say which HS code was kept", kept == {"8481.8090": False, "7307.1190": True}, kept)
    items3 = [{"id": i["id"], "itemTypeId": i.get("itemTypeId"), "description": i["description"] + " (edited)",
               "quantity": float(i["quantity"]), "uom": i.get("uom"), "unitPrice": float(i["unitPrice"])} for i in full3["items"]]
    st, upd = http("PUT", f"/api/invoices/{inv3['id']}", base, token=token, body={"gstRate": 18, "items": items3})
    check("an edit keeps the choice: kept goods stay in stock", st == 200 and qty(it2) == e0 and qty(it) == v1, (st, qty(it2), e0))
    st, body = http("POST", f"/api/fbr/{inv3['id']}/reset-submission", base, token=token, body={"mode": "retry", "reason": "undo the record"})
    check("undoing the filing takes the kept goods out again", st == 200 and qty(it2) == e1 and qty(it) == v1, (st, qty(it2), e1))

    # MCP: prepare_fbr_reset takes recordManual
    sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
    import mcp_importer_fixture as fx
    fx.set_base(base)
    admin = fx.login("admin", "admin123")
    A, _ = fx.companies(admin)
    fx.remove_users(admin, "invscr_mcpm_")
    sysr = fx.system_roles(admin)
    _, jw = fx.make_user(admin, "invscr_mcpm_writer", [A], [fx.staff_role(admin), sysr["MCP Access"], sysr["MCP Write"]])
    T = fx.token_for(jw, [A])
    st, clients = http("GET", f"/api/clients/company/{A}", base, token=token)
    st, inv2 = http("POST", "/api/invoices/standalone", base, token=token, body={
        "date": TODAY, "companyId": A, "clientId": clients[0]["id"], "gstRate": 18,
        "items": [{"description": "x", "quantity": 1, "uom": UNIT, "unitPrice": 10,
                   "newItemType": {"name": f"MCP Manual {SUFFIX}", "hsCode": "8481.8090", "uom": UNIT}}]})
    if not check("an unfiled invoice in the MCP fixture company", st in (200, 201), f"{st} {str(inv2)[:200]}"):
        return
    refused, text = fx.call(T, "prepare_fbr_reset", {"companyId": A, "invoiceId": inv2["id"], "mode": "recordManual", "reason": "t"})
    check("MCP recordManual without the portal number is refused", refused and "manualFbrInvoiceNumber" in text, text[:200])
    refused, text = fx.call(T, "prepare_fbr_reset", {"companyId": A, "invoiceId": inv2["id"], "mode": "recordManual",
                                                     "manualFbrInvoiceNumber": "PORTAL-9", "keepInStockHsCodes": ["8481.8090"], "reason": "filed by hand"})
    plan = None if refused else json.loads(text)
    if check("MCP prepare_fbr_reset accepts recordManual and shows the kept HS codes",
             plan is not None and "8481.8090" in text, text[:300]):
        refused, text = fx.call(T, "commit_action", {"planId": plan["planId"]})
        st, f2 = http("GET", f"/api/invoices/{inv2['id']}", base, token=token)
        check("MCP commit records it as filed manually", not refused and f2.get("fbrFiledManually") and f2.get("fbrInvoiceNumber") == "PORTAL-9", text[:200])
        check("MCP commit keeps the chosen HS code in stock", all(i.get("keepInStock") for i in f2.get("items", [])), f2.get("items"))


def suite_filed_at_create(base, token):
    """'Already filed on FBR's portal' chosen on the New invoice forms (2026-10-29): the invoice is
    saved and recorded as filed in one request, on both create paths, with a per-HS stock choice."""
    print("\n=== Filed on FBR's portal, chosen while creating ===")
    hard = make_company(base, token, f"_test_fileatcreate_hard {SUFFIX}", hard_block=True)
    soft = make_company(base, token, f"_test_fileatcreate_soft {SUFFIX}")
    items = {}
    for co in (hard, soft):
        for key, hs in (("valve", "8481.8090"), ("elbow", "7307.1190")):
            st, it = http("POST", f"/api/itemtypes?companyId={co['id']}", base, token=token, body={
                "name": f"FC {key} {co['id']} {SUFFIX}", "hsCode": hs, "uom": UNIT, "isFavorite": True})
            if not check(f"item {key} in company {co['id']}", st in (200, 201), f"{st} {it}"):
                return
            items[(co["id"], key)] = it
    hard_cl, soft_cl = make_client(base, token, hard["id"]), make_client(base, token, soft["id"])

    def lines(co, qv, qe):
        return [{"itemTypeId": items[(co["id"], "valve")]["id"], "description": "Valve", "quantity": qv, "uom": UNIT, "unitPrice": 100},
                {"itemTypeId": items[(co["id"], "elbow")]["id"], "description": "Elbow", "quantity": qe, "uom": UNIT, "unitPrice": 50}]

    def count(co):
        st, rows = http("GET", f"/api/invoices/company/{co['id']}", base, token=token)
        return len(rows) if isinstance(rows, list) else -1

    def qty(co, key):
        it = items[(co["id"], key)]
        st, rows = http("GET", f"/api/itemtypes?companyId={co['id']}&search={urllib.parse.quote(it['name'])}", base, token=token)
        row = next((r for r in (rows or []) if r.get("id") == it["id"]), {}) if isinstance(rows, list) else {}
        return row.get("availableQty")

    def create(co, cl, ls, filing, tok=token):
        return http("POST", "/api/invoices/standalone", base, token=tok, body={
            "date": TODAY, "companyId": co["id"], "clientId": cl["id"], "gstRate": 18, "items": ls,
            "manualFbrFiling": filing})

    n0 = count(hard)
    st, body = create(hard, hard_cl, lines(hard, 2, 3), {"portalInvoiceNumber": " ", "keepInStockHsCodes": []})
    check("a portal number is required", st == 400, f"{st} {body}")
    st, body = create(hard, hard_cl, lines(hard, 2, 3), {"portalInvoiceNumber": "FC-1", "keepInStockHsCodes": ["0101.0000"]})
    check("an HS code not on the invoice is refused", st == 400 and "not on this invoice" in str(body), f"{st} {body}")
    check("...and the invoice was rolled back, not left unfiled", count(hard) == n0, (n0, count(hard)))
    st, body = create(hard, hard_cl, lines(hard, 2, 3), {"portalInvoiceNumber": "FC-1", "keepInStockHsCodes": ["7307.1190"]})
    check("hard block: a deducted code with no stock is still refused (409)", st == 409, f"{st} {body}")
    st, inv = create(hard, hard_cl, lines(hard, 2, 3), {"portalInvoiceNumber": "FC-1", "keepInStockHsCodes": ["8481.8090", "7307.1190"]})
    check("hard block: kept goods need no stock, so it saves", st in (200, 201), f"{st} {str(inv)[:300]}")
    if st in (200, 201):
        check("saved already filed, with the portal number and no IRN",
              inv.get("fbrStatus") == "Submitted" and inv.get("fbrFiledManually") and inv.get("fbrInvoiceNumber") == "FC-1" and not inv.get("fbrIRN"),
              {k: inv.get(k) for k in ("fbrStatus", "fbrFiledManually", "fbrInvoiceNumber", "fbrIRN")})
        check("every line kept in stock", all(i.get("keepInStock") for i in inv.get("items", [])), inv.get("items"))
        check("no stock moved", qty(hard, "valve") == 0 and qty(hard, "elbow") == 0, (qty(hard, "valve"), qty(hard, "elbow")))

    # From a challan, on a company that sells below zero: keep the elbows only.
    challan_items = [{"description": "Valve", "quantity": 4, "unit": UNIT, "itemTypeId": items[(soft["id"], "valve")]["id"]},
                     {"description": "Elbow", "quantity": 6, "unit": UNIT, "itemTypeId": items[(soft["id"], "elbow")]["id"]}]
    st, dc = http("POST", f"/api/deliverychallans/company/{soft['id']}", base, token=token, body={
        "companyId": soft["id"], "clientId": soft_cl["id"], "poNumber": f"PO-FC-{SUFFIX}", "poDate": TODAY,
        "deliveryDate": TODAY, "items": challan_items})
    if check("a billable challan", st in (200, 201), f"{st} {dc}"):
        v0, e0 = qty(soft, "valve"), qty(soft, "elbow")
        st, inv2 = http("POST", "/api/invoices", base, token=token, body={
            "date": TODAY, "companyId": soft["id"], "clientId": soft_cl["id"], "gstRate": 18, "challanIds": [dc["id"]],
            "items": [{"deliveryItemId": d["id"], "unitPrice": 100, "description": d["description"]} for d in dc["items"]],
            "manualFbrFiling": {"portalInvoiceNumber": "FC-2", "keepInStockHsCodes": ["7307.1190"]}})
        check("from a challan: saved already filed", st in (200, 201) and inv2.get("fbrFiledManually") and inv2.get("fbrInvoiceNumber") == "FC-2",
              f"{st} {str(inv2)[:300]}")
        check("from a challan: valves left stock, elbows stayed", qty(soft, "valve") == v0 - 4 and qty(soft, "elbow") == e0,
              (v0, qty(soft, "valve"), e0, qty(soft, "elbow")))

    # Without invoices.fbr.reset the choice is refused and nothing is saved.
    role_name = f"FileAtCreate NoReset {SUFFIX}"
    st, role = http("POST", "/api/roles", base, token=token, body={
        "name": role_name, "description": "file at create test",
        "permissionKeys": ["bills.list.view", "bills.manage.create.standalone"]})
    if not check("role without the FBR reset right", st in (200, 201), f"{st} {role}"):
        return
    uname = f"fileatcreate_{SUFFIX}"
    st, user = http("POST", "/api/users", base, token=token, body={
        "username": uname, "password": "test1234", "fullName": "File At Create Test",
        "role": role_name, "roleIds": [role["id"]], "companyIds": [soft["id"]]})
    if not check("user created", st in (200, 201), f"{st} {user}"):
        return
    ut = login(base, uname, "test1234")
    n1 = count(soft)
    st, body = create(soft, soft_cl, lines(soft, 1, 1), {"portalInvoiceNumber": "FC-3", "keepInStockHsCodes": []}, tok=ut)
    check("without invoices.fbr.reset -> 403", st == 403, f"{st} {body}")
    check("...and no invoice was saved", count(soft) == n1, (n1, count(soft)))
    st, body = create(soft, soft_cl, lines(soft, 1, 1), None, tok=ut)
    check("the same user still saves an ordinary invoice", st in (200, 201), f"{st} {str(body)[:200]}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="http://localhost:5195")
    p.add_argument("--admin-user", default="admin")
    p.add_argument("--admin-pw", default="admin123")
    a = p.parse_args()
    token = login(a.base, a.admin_user, a.admin_pw)
    suite_d6(a.base, token)
    suite_d7_d8(a.base, token)
    suite_mcp(a.base, token)
    suite_filed_manually(a.base, token)
    suite_filed_at_create(a.base, token)
    print(f"\n{PASSED}/{PASSED + FAILED} importer invoice screen checks passed")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()

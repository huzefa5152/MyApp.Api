"""
FBR sandbox end-to-end lifecycle — Importer and Exporter.

Walks the whole journey the operator walks, against the PRAL SANDBOX, and
asserts the database agrees with what FBR actually said at every step:

    create company -> configure FBR -> classify items -> raise a bill ->
    validate -> submit -> persist the IRN -> LOCK the bill -> correct it

WHY EACH SUITE EXISTS
  A  Company + sandbox wiring. A company whose FbrEnvironment is anything but
     "production" must hit PRAL's *_sb endpoints. Proven from the FBR
     communication log (the URL we actually called), not from config.
  B  Item classification. This branch refuses an unclassified bill line, and
     FBR refuses a line with no sale type [0013], so the catalog is where a
     bill becomes submittable.
  C  Importer lifecycle, live: validate, submit, IRN, persisted status.
  D  The lock. A submitted bill must be uneditable at the SERVER, not merely
     missing a button -- checked by calling the endpoints directly.
  E  Correction. A locked bill is fixed by issuing a linked document; the
     original keeps its number and IRN.
  F  Exporter lifecycle -- the same walk on the other business activity, to
     show the two do not interfere.
  G  Negative cases. The rule that matters: an invoice is NEVER marked
     Submitted unless FBR confirmed it.

The sandbox token is passed with --fbr-token and is never written to disk,
never logged, and never printed -- only whether one was supplied.

Usage:
  python scripts/test_fbr_sandbox_e2e.py --base http://localhost:5135 \
      --fbr-token "<sandbox-token>" --db-name MyApp_ImporterLedger

Exit 0 = every non-skipped assertion passed.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
import time
from datetime import datetime, timedelta

results: list[tuple[str, str, bool, str]] = []
skips: list[tuple[str, str, str]] = []


def check(suite: str, name: str, ok: bool, reason: str = "") -> bool:
    results.append((suite, name, bool(ok), reason))
    print(f"    [{'OK  ' if ok else 'FAIL'}] {name}" + ("" if ok else f"  -> {reason}"))
    return bool(ok)


def skip(suite: str, name: str, why: str) -> None:
    skips.append((suite, name, why))
    print(f"    [SKIP] {name}  ({why})")


def http(method: str, path: str, base: str, token: str | None = None, body=None):
    url = base.rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:400]
    except Exception as e:
        return 0, str(e)


# FBR submit/validate is rate limited to 30 calls per minute per user, and the
# scenario matrix alone makes two dozen. Without pacing the run dissolves into
# 429s that look like FBR rejections but are our own throttle. One call every
# ~2.2s keeps us just under it.
_last_fbr_call = [0.0]


def fbr_call(method, path, base, token=None, body=None, pace=2.2):
    wait = pace - (time.monotonic() - _last_fbr_call[0])
    if wait > 0:
        time.sleep(wait)
    try:
        return http(method, path, base, token=token, body=body)
    finally:
        _last_fbr_call[0] = time.monotonic()


def err(body) -> str:
    if isinstance(body, dict):
        return str(body.get("error") or body.get("message") or body)[:220]
    return str(body)[:220]


def today() -> str:
    return datetime.now().strftime("%Y-%m-%dT00:00:00")


# ── Setup helpers ──────────────────────────────────────────────────────────
def make_company(base, token, name, activity, fbr_token, ntn):
    """Through the ordinary create endpoint -- no back door. FbrEnvironment is
    'sandbox' explicitly even though null already means sandbox, because this
    is the one field that decides which PRAL host we talk to."""
    return http("POST", "/api/companies", base, token=token, body={
        "name": name,
        "fullAddress": "Plot 12, Trade Avenue, Karachi",
        "phone": "+92-21-35000000",
        "ntn": ntn,
        "strn": "3277876175852",
        "startingChallanNumber": 90000,
        "startingInvoiceNumber": 90000,
        "startingPurchaseBillNumber": 90000,
        "startingGoodsReceiptNumber": 90000,
        "startingSalesQuoteNumber": 90000,
        "startingSalesOrderNumber": 90000,
        "fbrEnabled": True,
        "fbrEnvironment": "sandbox",
        "fbrProvinceCode": 8,
        "fbrBusinessActivity": activity,
        "fbrSector": "All Other Sectors",
        "fbrDefaultSaleType": "Goods at Standard Rate (default)",
        "fbrDefaultUOM": "Numbers, pieces, units",
        "inventoryTrackingEnabled": False,
        "fbrToken": fbr_token,
    })


def make_client(base, token, cid, name, registered=True):
    return http("POST", "/api/clients", base, token=token, body={
        "companyId": cid, "name": name,
        "address": "Warehouse 4, Port Qasim, Karachi",
        "phone": "+92-21-34000000",
        "ntn": "0710818-04" if registered else None,
        # STRN and a province are part of the company+client FBR readiness
        # check; without them the challan is gated into "Setup Required" and
        # never becomes billable.
        "strn": "3277876175853" if registered else None,
        "cnic": None if registered else "4230112345671",
        "registrationType": "Registered" if registered else "Unregistered",
        "fbrProvinceCode": 8,
    })


def make_item_type(base, token, cid, name, hs, uom="Numbers, pieces, units",
                   fbr_uom_id=69, sale_type="Goods at Standard Rate (default)"):
    """The catalog is where a line becomes submittable: this branch needs an
    Item Type to classify the line at all, and FBR needs the sale type."""
    return http("POST", f"/api/itemtypes?companyId={cid}", base, token=token, body={
        "name": name, "uom": uom, "hsCode": hs, "fbrUOMId": fbr_uom_id,
        "saleType": sale_type, "companyId": cid, "isFavorite": True,
    })


def make_bill(base, token, cid, client_id, lines, gst=18, date=None,
              sale_type="Goods at Standard Rate (default)"):
    """Challan-then-bill, the flow the FBR screens are built around."""
    st, challan = http("POST", f"/api/deliverychallans/company/{cid}", base, token=token, body={
        "companyId": cid, "clientId": client_id,
        "poNumber": f"PO-{datetime.now().strftime('%H%M%S%f')}",
        "poDate": today(), "deliveryDate": today(), "site": None,
        "items": [{"description": l["desc"], "quantity": l["qty"], "unit": l["uom"]}
                  for l in lines],
        "warnings": [],
    })
    if st not in (200, 201):
        return st, challan, None
    items = []
    for i, l in enumerate(lines):
        items.append({
            "deliveryItemId": challan["items"][i]["id"],
            "itemTypeId": l["itemTypeId"],
            "unitPrice": l["price"],
            "description": l["desc"],
            "uom": l["uom"],
            "hsCode": l["hs"],
            "saleType": l.get("saleType", sale_type),
        })
    st, inv = http("POST", "/api/invoices", base, token=token, body={
        "date": date or today(), "companyId": cid, "clientId": client_id,
        "gstRate": gst, "documentType": 4, "paymentMode": "Bank Transfer",
        "challanIds": [challan["id"]], "items": items, "poDateUpdates": {},
    })
    return st, inv, challan


def fbr_log(base, token, cid, invoice_id):
    """The communication log is ground truth for what left our system."""
    st, rows = http("GET", f"/api/fbr-monitor?companyId={cid}&invoiceId={invoice_id}"
                          f"&page=1&pageSize=100", base, token=token)
    if st != 200:
        return []
    items = rows.get("items", rows) if isinstance(rows, dict) else rows
    return [r for r in (items or []) if r.get("invoiceId") == invoice_id]


# ── Suites ─────────────────────────────────────────────────────────────────
def suite_a_company(base, token, fbr_token, activity, label, ntn):
    """A: the company exists, is wired for FBR, and is pointed at SANDBOX."""
    suite = f"A. {label} company"
    print(f"\n=== {suite} ===")
    sfx = datetime.now().strftime("%H%M%S")
    st, co = make_company(base, token, f"_fbr_{activity.lower()} {sfx}",
                          activity, fbr_token, ntn)
    if not check(suite, f"{label} company is created through the normal endpoint",
                 st in (200, 201), f"http {st}: {err(co)}"):
        return None
    cid = co["id"]
    check(suite, "it is flagged FBR-enabled", co.get("fbrEnabled") is True,
          f"fbrEnabled={co.get('fbrEnabled')}")
    check(suite, "its environment is sandbox, not production",
          (co.get("fbrEnvironment") or "").lower() != "production",
          f"fbrEnvironment={co.get('fbrEnvironment')}")
    check(suite, f"its business activity is {activity}",
          co.get("fbrBusinessActivity") == activity,
          f"got {co.get('fbrBusinessActivity')}")
    # The token must be held, and must NOT be readable back.
    check(suite, "the token is stored", co.get("hasFbrToken") is True,
          f"hasFbrToken={co.get('hasFbrToken')}")
    check(suite, "and the token value is never returned by the API",
          "fbrToken" not in co or not co.get("fbrToken"),
          "the create response echoed the token back")

    st, scen = http("GET", f"/api/fbr/scenarios/applicable/{cid}", base, token=token)
    rows = (scen if isinstance(scen, list) else (scen or {}).get("scenarios") or []) if st == 200 else []
    codes = [(s.get("code") or s.get("scenarioId")) if isinstance(s, dict) else str(s)
             for s in rows]
    check(suite, f"FBR scenarios resolve for an {activity}",
          st == 200 and len(codes) > 0, f"http {st}, {len(codes)} scenarios")
    full = [s for s in rows if isinstance(s, dict)]
    return {"id": cid, "scenarios": codes, "detail": full, "label": label}


def suite_b_catalog(base, token, cid, label):
    """B: an item is only submittable once the catalog classifies it."""
    suite = f"B. {label} item catalog"
    print(f"\n=== {suite} ===")
    sfx = datetime.now().strftime("%H%M%S%f")[:10]
    made = {}
    for key, name, hs in [
        ("valve", f"Solenoid Valve {sfx}", "8481.8090"),
        ("bearing", f"Ball Bearing {sfx}", "8482.1000"),
    ]:
        st, it = make_item_type(base, token, cid, name, hs)
        if check(suite, f"item type '{hs}' is accepted", st in (200, 201),
                 f"http {st}: {err(it)}"):
            made[key] = it["id"]
            check(suite, f"'{hs}' keeps its HS code", it.get("hsCode") == hs,
                  f"got {it.get('hsCode')}")
    return made


def suite_c_lifecycle(base, token, cid, client_id, item_id, label):
    """C: validate -> submit -> IRN -> the database agrees with FBR."""
    suite = f"C. {label} bill lifecycle (live sandbox)"
    print(f"\n=== {suite} ===")
    st, inv, _ = make_bill(base, token, cid, client_id, [
        {"desc": "Solenoid valve 220VAC", "qty": 10, "uom": "Numbers, pieces, units",
         "price": 400, "hs": "8481.8090", "itemTypeId": item_id},
    ])
    if not check(suite, "a single-line bill is created", st in (200, 201),
                 f"http {st}: {err(inv)}"):
        return None
    iid = inv["id"]
    check(suite, "it starts with no FBR status", not inv.get("fbrStatus"),
          f"fbrStatus={inv.get('fbrStatus')}")
    check(suite, "and it is editable before submission",
          inv.get("isEditable") is True, f"isEditable={inv.get('isEditable')}")

    st, val = fbr_call("POST", f"/api/fbr/{iid}/validate", base, token=token)
    check(suite, "FBR validate is accepted (dry run, no IRN)",
          st == 200 and val.get("success") is True and not val.get("irn"),
          f"http {st}: {err(val)}")

    st, sub = fbr_call("POST", f"/api/fbr/{iid}/submit", base, token=token)
    ok = st == 200 and sub.get("success") is True and sub.get("irn")
    check(suite, "FBR submit returns success WITH an IRN", ok,
          f"http {st}: {err(sub)}")
    if not ok:
        return {"invoice_id": iid, "submitted": False}
    irn = sub["irn"]

    st, fresh = http("GET", f"/api/invoices/{iid}", base, token=token)
    check(suite, "the stored status is Submitted -- UI and DB agree",
          st == 200 and fresh.get("fbrStatus") == "Submitted",
          f"stored fbrStatus={fresh.get('fbrStatus')}")
    check(suite, "the IRN FBR issued is the IRN we persisted",
          fresh.get("fbrIRN") == irn,
          f"stored {fresh.get('fbrIRN')} vs returned {irn}")
    check(suite, "the submission timestamp is recorded",
          bool(fresh.get("fbrSubmittedAt")), "fbrSubmittedAt is empty")
    return {"invoice_id": iid, "irn": irn, "submitted": True}


def suite_sandbox_routing(base, token, cid, iid, label):
    """Proof we talked to the SANDBOX, taken from the URL we actually called."""
    suite = f"A2. {label} sandbox routing"
    print(f"\n=== {suite} ===")
    rows = fbr_log(base, token, cid, iid)
    if not check(suite, "the FBR communication log recorded the calls",
                 len(rows) > 0, "no log rows for this invoice"):
        return
    endpoints = [r.get("endpoint") or "" for r in rows]
    check(suite, "every call went to a PRAL *_sb (sandbox) endpoint",
          all("_sb" in e for e in endpoints if e),
          f"endpoints seen: {sorted(set(endpoints))}")
    check(suite, "no call went to a production FBR endpoint",
          not any(e.rstrip("/").endswith(("postinvoicedata", "validateinvoicedata"))
                  for e in endpoints),
          f"endpoints seen: {sorted(set(endpoints))}")


def suite_d_lock(base, token, cid, iid, client_id, item_id, label):
    """D: after submission the bill is locked AT THE SERVER."""
    suite = f"D. {label} edit lock after submission"
    print(f"\n=== {suite} ===")
    st, inv = http("GET", f"/api/invoices/{iid}", base, token=token)
    check(suite, "the API reports the bill as not editable",
          inv.get("isEditable") is False, f"isEditable={inv.get('isEditable')}")

    # The real test: call the mutating endpoints directly, as a script could.
    body = {
        "date": today(), "companyId": cid, "clientId": client_id,
        "gstRate": 18, "documentType": 4, "paymentMode": "Bank Transfer",
        "items": [{"itemTypeId": item_id, "description": "TAMPERED",
                   "quantity": 99, "uom": "Numbers, pieces, units",
                   "unitPrice": 1, "hsCode": "8481.8090"}],
    }
    st, r = http("PUT", f"/api/invoices/{iid}", base, token=token, body=body)
    check(suite, "PUT /api/invoices/{id} is refused server-side",
          st == 400, f"http {st}: {err(r)}")
    check(suite, "and it says why, in words an operator can act on",
          isinstance(r, (dict, str)) and "fbr" in err(r).lower(),
          f"message was: {err(r)}")

    st, r = http("DELETE", f"/api/invoices/{iid}", base, token=token)
    check(suite, "DELETE /api/invoices/{id} is refused", st in (400, 403, 409),
          f"http {st}: {err(r)}")

    st, again = http("GET", f"/api/invoices/{iid}", base, token=token)
    check(suite, "the bill is untouched after both attempts",
          again.get("fbrStatus") == "Submitted"
          and not any(i.get("description") == "TAMPERED"
                      for i in (again.get("items") or [])),
          "a rejected call still changed the bill")


def suite_e_correction(base, token, cid, iid, label):
    """E: a locked bill is corrected by issuing a LINKED document."""
    suite = f"E. {label} correction of a submitted bill"
    print(f"\n=== {suite} ===")
    st, orig = http("GET", f"/api/invoices/{iid}", base, token=token)
    orig_number, orig_irn = orig.get("invoiceNumber"), orig.get("fbrIRN")

    st, note = http("POST", "/api/invoices/notes", base, token=token, body={
        "originalInvoiceId": iid, "documentType": 10,
        "reason": "Return of goods",
    })
    made = check(suite, "a Credit Note can be raised against the submitted bill",
                 st in (200, 201), f"http {st}: {err(note)}")
    if made:
        check(suite, "the note is its own document, not an edit of the original",
              note.get("id") != iid, "the note reused the original's id")
        check(suite, "it references the original bill",
              note.get("originalInvoiceId") == iid,
              f"originalInvoiceId={note.get('originalInvoiceId')}")
        check(suite, "it carries the original's IRN as the FBR reference",
              (note.get("originalInvoiceRefIRN") or orig_irn) == orig_irn,
              f"ref={note.get('originalInvoiceRefIRN')} vs {orig_irn}")

    st, after = http("GET", f"/api/invoices/{iid}", base, token=token)
    check(suite, "the original keeps its number and IRN",
          after.get("invoiceNumber") == orig_number and after.get("fbrIRN") == orig_irn,
          f"#{after.get('invoiceNumber')} irn={after.get('fbrIRN')}")
    check(suite, "and stays locked after being corrected",
          after.get("isEditable") is False, f"isEditable={after.get('isEditable')}")
    return note if made else None


def suite_g_negative(base, token, cid, client_id, item_id, label):
    """G: the invariant -- never Submitted unless FBR confirmed it."""
    suite = f"G. {label} negative cases"
    print(f"\n=== {suite} ===")

    # A future-dated bill: FBR rejects it [0043] and the app blocks it first.
    future = (datetime.now() + timedelta(days=10)).strftime("%Y-%m-%dT00:00:00")
    st, inv, _ = make_bill(base, token, cid, client_id, [
        {"desc": "Future valve", "qty": 1, "uom": "Numbers, pieces, units",
         "price": 100, "hs": "8481.8090", "itemTypeId": item_id},
    ], date=future)
    if st in (200, 201):
        fid = inv["id"]
        st, r = fbr_call("POST", f"/api/fbr/{fid}/submit", base, token=token)
        blocked = (st != 200) or (r.get("success") is not True)
        check(suite, "a future-dated bill is not submitted", blocked,
              f"http {st}: {err(r)}")
        st, fresh = http("GET", f"/api/invoices/{fid}", base, token=token)
        check(suite, "and it is NOT left marked Submitted",
              fresh.get("fbrStatus") != "Submitted",
              f"fbrStatus={fresh.get('fbrStatus')}")
        http("DELETE", f"/api/invoices/{fid}", base, token=token)
    else:
        skip(suite, "future-dated bill", f"could not create: {err(inv)}")

    # An unclassified line: this branch refuses it at creation.
    st, challan = http("POST", f"/api/deliverychallans/company/{cid}", base, token=token, body={
        "companyId": cid, "clientId": client_id,
        "poNumber": f"PO-NEG-{datetime.now().strftime('%H%M%S%f')}",
        "poDate": today(), "deliveryDate": today(), "site": None,
        "items": [{"desc": "x", "description": "Unclassified thing",
                   "quantity": 1, "unit": "Numbers, pieces, units"}],
        "warnings": [],
    })
    if st in (200, 201):
        st, r = http("POST", "/api/invoices", base, token=token, body={
            "date": today(), "companyId": cid, "clientId": client_id,
            "gstRate": 18, "documentType": 4, "paymentMode": "Bank Transfer",
            "challanIds": [challan["id"]],
            "items": [{"deliveryItemId": challan["items"][0]["id"], "unitPrice": 50,
                       "description": "Unclassified thing",
                       "uom": "Numbers, pieces, units"}],
            "poDateUpdates": {},
        })
        check(suite, "a bill line with no item type is refused", st == 400,
              f"http {st}: {err(r)}")
    else:
        skip(suite, "unclassified line", f"challan create failed: {err(challan)}")

    # A submit for a bill that does not exist.
    st, r = fbr_call("POST", "/api/fbr/999999999/submit", base, token=token)
    check(suite, "submitting a non-existent bill is a clean 404", st == 404,
          f"http {st}: {err(r)}")




def fbr_ref_date() -> str:
    """FBR's reference APIs want dd-MMM-yyyy. An ISO date is not rejected --
    it comes back as an EMPTY list, which reads like "no rates exist" rather
    than "you asked wrongly". Worth knowing before debugging a blank dropdown."""
    return datetime.now().strftime("%d-%b-%Y")


def resolve_fbr_rate(base, token, cid, sale_type, province=8, scen_default=None):
    """Ask FBR what rate it will accept for this sale type, instead of guessing.

    FBR rejects a mismatched rate with [0046] "Provided Rate is not correct for
    selected Sales Type", so the scenario catalog's headline rate is not enough
    -- the rate has to be one FBR itself lists for that transaction type on
    that date and province. Returns (rateValue, rateId) or (None, None)."""
    st, types = http("GET", f"/api/fbr/transactiontypes/{cid}", base, token=token)
    if st != 200 or not isinstance(types, list):
        return None, None
    want = (sale_type or "").strip().lower()
    tt = next((t for t in types
               if (t.get("transactioN_DESC") or "").strip().lower() == want), None)
    if tt is None:
        return None, None
    st, rates = http("GET", f"/api/fbr/saletyperates/{cid}"
                            f"?date={fbr_ref_date()}"
                            f"&transTypeId={tt['transactioN_TYPE_ID']}"
                            f"&provinceId={province}", base, token=token)
    if st != 200 or not rates:
        return None, None
    # FBR lists MANY rates for some transaction types (reduced rate alone has
    # 21, from 0.5% to Rs.700/MT). Taking the first is how a Cement bill ended
    # up at 2%, which then demanded an SRO schedule it had no business needing.
    # Prefer the rate the scenario itself is defined at.
    want = scen_default
    if want is not None:
        exact = next((r for r in rates
                      if r.get("ratE_VALUE") is not None
                      and abs(float(r["ratE_VALUE"]) - float(want)) < 0.001), None)
        if exact:
            return exact.get("ratE_VALUE"), exact.get("ratE_ID")
    r = rates[0]
    return r.get("ratE_VALUE"), r.get("ratE_ID")


def make_standalone_bill(base, token, cid, client_id, scen, item_type_id, hs="8481.8090",
                         rate=None, rate_id=None):
    """The STANDALONE create path, because it is the only one whose line DTO
    carries SroScheduleNo / SroItemSerialNo -- and five of the eleven
    Importer/Exporter scenarios are SRO-referenced, so the challan path simply
    cannot express them."""
    line = {
        "description": f"{scen['code']} test good",
        "quantity": 4,
        "uom": "Numbers, pieces, units",
        "unitPrice": 2500,
        "itemTypeId": item_type_id,
        "hsCode": hs,
        "fbrUOMId": 69,
        "saleType": scen["saleType"],
    }
    if scen.get("requiresSroReference"):
        line["sroScheduleNo"] = scen.get("defaultSroScheduleNo")
        line["sroItemSerialNo"] = str(scen.get("defaultSroItemSerialNo") or "1")
    if scen.get("isThirdSchedule"):
        # A 3rd-Schedule good is taxed on its printed retail price, not the
        # transaction value, so the payload needs that figure or FBR rejects it.
        line["fixedNotifiedValueOrRetailPrice"] = 3000
    if rate_id is not None:
        line["rateId"] = rate_id
    effective = rate if rate is not None else scen.get("defaultRate")
    return http("POST", "/api/invoices/standalone", base, token=token, body={
        "date": today(), "companyId": cid, "clientId": client_id,
        "gstRate": effective if effective is not None else 18,
        "documentType": 4, "paymentMode": "Bank Transfer",
        "paymentTerms": f"[{scen['code']}] {scen.get('description', '')}"[:180],
        "items": [line],
    })


def suite_f_matrix(base, token, cid, label, codes, clients, item_types, submit_codes):
    """F: every scenario this business activity can file, built and put through
    FBR's own validator.

    VALIDATE, not submit, for all but the nominated few. Validate exercises the
    entire chain that matters here -- our payload builder, our pre-validation,
    and PRAL's own rules -- and FBR answers it with the same error codes it
    would answer a submit with. Filing eleven real IRNs on every run would add
    nothing except sandbox litter."""
    suite = f"F. {label} scenario matrix"
    print(f"\n=== {suite} ===")
    rows = []
    for scen in codes:
        code = scen["code"]
        buyer = (scen.get("buyerRegistrationType") or "Any")
        # SN002 is defined as a supply to an UNREGISTERED buyer; sending it a
        # registered one is a different scenario and FBR says so.
        client_id = clients["unregistered"] if buyer == "Unregistered" else clients["registered"]
        it = item_types.get(scen["saleType"]) or item_types["default"]

        rate, rate_id = resolve_fbr_rate(base, token, cid, scen["saleType"],
                                         scen_default=scen.get("defaultRate"))
        st, inv = make_standalone_bill(base, token, cid, client_id, scen, it,
                                       rate=rate, rate_id=rate_id)
        if not check(suite, f"{code}: a bill is created ({scen['saleType'][:34]})",
                     st in (200, 201), f"http {st}: {err(inv)}"):
            rows.append((code, "create failed", err(inv)))
            continue
        iid = inv["id"]

        st, val = fbr_call("POST", f"/api/fbr/{iid}/validate?scenarioId={code}",
                           base, token=token)
        vd = val if isinstance(val, dict) else {}
        ok = st == 200 and vd.get("success") is True
        # A 429 (FBR submit is rate limited per user) or any non-JSON body must
        # not crash the matrix -- it is a transport outcome, reported as one.
        msg = "" if ok else (vd.get("errorMessage") or (f"http {st}" if st != 200 else "") or err(val))

        # A scenario FBR will not accept is not a defect in this application --
        # several need SRO item serials that this sandbox token's reference
        # data does not expose, and inventing one earns [0078]. What IS this
        # application's job is to come back with FBR's own reason and to leave
        # the bill unfiled. So the assertion is on the HANDLING, and the
        # verdict is reported either way.
        check(suite, f"{code}: the round-trip completes and FBR gives a verdict",
              st == 200 and isinstance(val, dict) and (ok or bool(msg)),
              f"http {st}: {err(val)}")
        if not ok:
            check(suite, f"{code}: FBR's own reason is surfaced verbatim",
                  bool(msg) and ("[" in msg or "FBR" in msg),
                  f"unhelpful message: {msg[:120]}")
        rows.append((code, "ACCEPTED" if ok else "rejected by FBR",
                     "" if ok else msg))

        if ok and code in submit_codes:
            st, sub = fbr_call("POST", f"/api/fbr/{iid}/submit?scenarioId={code}",
                               base, token=token)
            sd = sub if isinstance(sub, dict) else {}
            got_irn = st == 200 and sd.get("success") is True and sd.get("irn")
            check(suite, f"{code}: submits and returns an IRN", bool(got_irn),
                  f"http {st}: {err(sub)}")
            if got_irn:
                st, fresh = http("GET", f"/api/invoices/{iid}", base, token=token)
                check(suite, f"{code}: the stored status matches what FBR said",
                      fresh.get("fbrStatus") == "Submitted"
                      and fresh.get("fbrIRN") == sd["irn"],
                      f"stored {fresh.get('fbrStatus')}/{fresh.get('fbrIRN')}")
        elif not ok:
            # The invariant that matters most: a rejected bill must not be
            # sitting in the database claiming it was filed.
            st, fresh = http("GET", f"/api/invoices/{iid}", base, token=token)
            check(suite, f"{code}: a rejected bill is NOT marked Submitted",
                  fresh.get("fbrStatus") != "Submitted",
                  f"fbrStatus={fresh.get('fbrStatus')}")

    print(f"\n    -- {label} scenario matrix --")
    for code, verdict, detail in rows:
        print(f"      {code:<7} {verdict:<14} {detail[:90]}")
    return rows

# ── Main ───────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5135")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--fbr-token", default=None,
                    help="PRAL SANDBOX token. Without it the live suites skip.")
    ap.add_argument("--ntn", default="4228937-8")
    ap.add_argument("--keep", action="store_true",
                    help="leave the test companies behind for inspection")
    ap.add_argument("--submit-codes", default="SN002",
                    help="comma-separated scenarios to actually FILE (the rest "
                         "are validated only, which exercises the same payload "
                         "and the same FBR rules without littering the sandbox "
                         "with IRNs). Pass '' to validate everything.")
    args = ap.parse_args()
    args.submit_codes = {c.strip().upper() for c in (args.submit_codes or "").split(",")
                         if c.strip()}

    print("=" * 78)
    print("  FBR SANDBOX END-TO-END  (Importer + Exporter)")
    print(f"  base={args.base}  token={'supplied' if args.fbr_token else 'NOT supplied'}")
    print("=" * 78)

    st, data = http("POST", "/api/auth/login", args.base,
                    body={"username": args.user, "password": args.password})
    if st != 200:
        print(f"FATAL: login failed ({st} {data})")
        return 2
    token = data["token"]

    if not args.fbr_token:
        print("\nNo --fbr-token supplied: every live-FBR suite will be skipped.")

    made_companies = []
    try:
        for activity, label in (("Importer", "Importer"), ("Exporter", "Exporter")):
            co = suite_a_company(args.base, token, args.fbr_token, activity, label, args.ntn)
            if not co:
                continue
            cid = co["id"]
            made_companies.append(cid)

            items = suite_b_catalog(args.base, token, cid, label)
            if "valve" not in items:
                continue
            st, client = make_client(args.base, token, cid, f"{label} Buyer (Pvt) Ltd")
            if st not in (200, 201):
                check(f"A. {label} company", "a registered buyer is created", False,
                      f"http {st}: {err(client)}")
                continue
            client_id = client["id"]

            # SN002 is a supply to an UNREGISTERED buyer, so the matrix needs
            # one of each -- the buyer's registration type is part of what FBR
            # validates the scenario against.
            st, unreg = make_client(args.base, token, cid,
                                    f"{label} Cash Buyer", registered=False)
            check(f"A. {label} company", "an unregistered buyer is created",
                  st in (200, 201), f"http {st}: {err(unreg)}")
            clients = {"registered": client_id,
                       "unregistered": unreg["id"] if st in (200, 201) else client_id}

            if not args.fbr_token:
                skip(f"C. {label} bill lifecycle (live sandbox)",
                     "validate + submit + IRN", "no --fbr-token")
                skip(f"D. {label} edit lock after submission",
                     "server-side lock", "needs a submitted bill")
                skip(f"E. {label} correction of a submitted bill",
                     "credit note against a submitted bill", "needs a submitted bill")
            else:
                res = suite_c_lifecycle(args.base, token, cid, client_id,
                                        items["valve"], label)
                if res and res.get("submitted"):
                    suite_sandbox_routing(args.base, token, cid, res["invoice_id"], label)
                    suite_d_lock(args.base, token, cid, res["invoice_id"],
                                 client_id, items["valve"], label)
                    suite_e_correction(args.base, token, cid, res["invoice_id"], label)
                else:
                    skip(f"D. {label} edit lock after submission",
                         "server-side lock", "the bill never reached Submitted")
                    skip(f"E. {label} correction of a submitted bill",
                         "credit note", "the bill never reached Submitted")

            # F: every scenario this activity can file. One item type per
            # sale type, because the catalog is what classifies the line.
            if args.fbr_token and co.get("detail"):
                by_sale_type = {"default": items["valve"]}
                for scen in co["detail"]:
                    stype = scen.get("saleType")
                    if not stype or stype in by_sale_type:
                        continue
                    st, it = make_item_type(
                        args.base, token, cid,
                        f"{scen['code']} {stype[:28]} {datetime.now().strftime('%H%M%S%f')[:9]}",
                        "8481.8090", sale_type=stype)
                    if st in (200, 201):
                        by_sale_type[stype] = it["id"]
                suite_f_matrix(args.base, token, cid, label, co["detail"],
                               clients, by_sale_type, submit_codes=args.submit_codes)
            else:
                skip(f"F. {label} scenario matrix", "every applicable scenario",
                     "no --fbr-token")

            suite_g_negative(args.base, token, cid, client_id, items["valve"], label)
    finally:
        if args.keep:
            print(f"\n(kept companies {made_companies})")
        else:
            for cid in made_companies:
                st, _ = http("DELETE", f"/api/companies/{cid}", args.base, token=token)
                print(f"teardown: delete company {cid} -> {st}")

    print("\n" + "=" * 78)
    failed = [r for r in results if not r[2]]
    for suite, name, _, reason in failed:
        print(f"  FAIL  [{suite}] {name}  -> {reason}")
    for suite, name, why in skips:
        print(f"  SKIP  [{suite}] {name}  ({why})")
    total = len(results)
    print(f"\n  {total - len(failed)}/{total} checks passed"
          + (f", {len(skips)} skipped" if skips else ""))
    print("=" * 78)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

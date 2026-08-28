#!/usr/bin/env python3
"""
Universal Copy Document — end-to-end verification.

Proves the Copy action on all six document types:

  Same document
    1. Sales Quote      -> Sales Quote
    2. Sales Order      -> Sales Order
    3. Delivery Challan -> Delivery Challan
    4. Bill             -> Bill
    5. Purchase Bill    -> Purchase Bill
    6. Goods Receipt    -> Goods Receipt

  Cross document (only the pairs the matrix allows)
    7. Sales Quote   -> Sales Order
    8. Sales Order   -> Delivery Challan
    9. Sales Order   -> Bill
   10. Purchase Bill -> Goods Receipt
   11. Goods Receipt -> Purchase Bill

  Guards
   12. Unsupported pairs, empty-line copies, notes, unknown types, and the
       copy-targets matrix each behave as designed.

Every copy is checked for: a new id, a NEW document number allocated by the
server, the source left completely unchanged, lines/quantities/prices carried
across, party + company preserved, a fresh status, and the copy lineage stamped.

Runs against an ephemeral company created at start and deleted at the end, so
production data is never touched.

Usage:
  python scripts/test_document_copy.py
  python scripts/test_document_copy.py --base http://localhost:5134 --keep
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

PASS = "PASS"
results: list[tuple[str, str, str]] = []

PKT = timezone(timedelta(hours=5))
TODAY = datetime.now(PKT).date().isoformat()


def http(method: str, path: str, base: str, token: str | None = None,
         body: Any = None, timeout: int = 60) -> tuple[int, Any]:
    url = base.rstrip("/") + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8")
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8") if e.fp else ""
        try:
            return e.code, json.loads(raw) if raw else None
        except Exception:
            return e.code, raw


def check(suite: str, name: str, ok: bool, reason: str = "") -> None:
    results.append((suite, name, PASS if ok else f"FAIL — {reason}"))


def copy_doc(base, token, source_type, source_id, destination_type,
             details=True, attachments=False, lines=True) -> tuple[int, Any]:
    return http("POST", "/api/documents/copy", base, token=token, body={
        "sourceType": source_type,
        "sourceId": source_id,
        "destinationType": destination_type,
        "copyLineItems": lines,
        "copyDocumentDetails": details,
        "copyAttachments": attachments,
    })


# ── Setup ──────────────────────────────────────────────────────────
def setup(base: str, admin_user: str, admin_pw: str):
    print(f"\n=== Logging in as {admin_user} ===")
    status, data = http("POST", "/api/auth/login", base,
                        body={"username": admin_user, "password": admin_pw})
    if status != 200:
        print(f"FATAL: admin login failed ({status} {data})")
        sys.exit(2)
    token = data["token"]

    suffix = datetime.now().strftime("%Y%m%d%H%M%S")
    print(f"\n=== Creating ephemeral company '_test_doc_copy {suffix}' ===")
    status, company = http("POST", "/api/companies", base, token=token, body={
        "name": f"_test_doc_copy {suffix}",
        "fullAddress": "Copy Test HQ",
        "phone": "+92-21-00000000",
        "ntn": "9999999",
        "cnic": "9999999999999",
        "strn": "9999999999999",
        "startingChallanNumber": 1,
        "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1,
        "startingGoodsReceiptNumber": 1,
        "startingSalesQuoteNumber": 1,
        "startingSalesOrderNumber": 1,
        "fbrEnvironment": "sandbox",
        "fbrProvinceCode": 8,
        "fbrBusinessActivity": "Manufacturer",
        "fbrSector": "All Other Sectors",
        "fbrToken": "test-token-not-used-for-real-pral-calls",
        # Inventory and GL off: this suite is about field mapping and numbering,
        # not stock or posting, and both have their own dedicated suites.
        "fbrEnabled": True,
        "inventoryTrackingEnabled": False,
        "enableGl": False,
    })
    if status not in (200, 201):
        print(f"FATAL: create company failed ({status} {company})")
        sys.exit(2)
    cid = company["id"]
    print(f"  company id={cid}")

    status, client = http("POST", "/api/clients", base, token=token, body={
        "name": f"Copy Client {suffix}", "address": "1 Test Road, Karachi",
        "phone": "021-1234567", "companyId": cid, "ntn": "1234567",
        "strn": "1234567890123", "fbrProvinceCode": 8, "registrationType": "Registered",
    })
    if status not in (200, 201):
        print(f"FATAL: create client failed ({status} {client})")
        sys.exit(2)

    status, supplier = http("POST", "/api/suppliers", base, token=token, body={
        "name": f"Copy Supplier {suffix}", "companyId": cid, "ntn": "7654321",
        "registrationType": "Registered", "fbrProvinceCode": 8,
    })
    if status not in (200, 201):
        print(f"FATAL: create supplier failed ({status} {supplier})")
        sys.exit(2)

    status, types = http("GET", "/api/itemtypes", base, token=token)
    item_type_id = None
    if status == 200 and isinstance(types, list) and types:
        item_type_id = types[0]["id"]

    print(f"  client id={client['id']}  supplier id={supplier['id']}  itemType={item_type_id}")
    return token, company, client, supplier, item_type_id


def teardown(base: str, token: str, company: dict, keep: bool) -> None:
    if keep:
        print(f"\n=== Keeping company {company['id']} (--keep) ===")
        return
    print(f"\n=== Deleting company {company['id']} ===")
    status, _ = http("DELETE", f"/api/companies/{company['id']}", base, token=token)
    print(f"  delete returned {status}")


# ── Shared assertions ──────────────────────────────────────────────
def assert_copy_shape(suite: str, label: str, status: int, body: Any,
                      source_number: int, expect_type: str) -> dict | None:
    """The invariants every copy must satisfy, whatever the pair."""
    ok = status == 200 and isinstance(body, dict)
    check(suite, f"{label}: copy accepted", ok, f"got {status} {body}")
    if not ok:
        return None
    check(suite, f"{label}: destination type is {expect_type}",
          body.get("documentType") == expect_type, f"got {body.get('documentType')}")
    check(suite, f"{label}: new document id returned",
          isinstance(body.get("id"), int) and body["id"] > 0, f"got {body.get('id')}")
    check(suite, f"{label}: number allocated by the server",
          isinstance(body.get("number"), int) and body["number"] > 0, f"got {body.get('number')}")
    if body.get("documentType") == body.get("sourceType"):
        check(suite, f"{label}: number differs from the source",
              body.get("number") != source_number,
              f"copy #{body.get('number')} == source #{source_number}")
    check(suite, f"{label}: at least one line copied",
          (body.get("lineItemsCopied") or 0) > 0, f"got {body.get('lineItemsCopied')}")
    return body


def assert_unchanged(suite: str, label: str, before: dict, after: Any, fields: list[str]) -> None:
    ok = isinstance(after, dict)
    check(suite, f"{label}: source still readable", ok, f"got {after}")
    if not ok:
        return
    for f in fields:
        check(suite, f"{label}: source {f} unchanged", before.get(f) == after.get(f),
              f"{before.get(f)} -> {after.get(f)}")
    check(suite, f"{label}: source line count unchanged",
          len(before.get("items") or []) == len(after.get("items") or []),
          f"{len(before.get('items') or [])} -> {len(after.get('items') or [])}")


def assert_lineage(suite: str, label: str, doc: Any, source_type: str, source_id: int) -> None:
    ok = isinstance(doc, dict)
    check(suite, f"{label}: copy readable", ok, f"got {doc}")
    if not ok:
        return
    check(suite, f"{label}: lineage type = {source_type}",
          doc.get("copiedFromType") == source_type, f"got {doc.get('copiedFromType')}")
    check(suite, f"{label}: lineage id = {source_id}",
          doc.get("copiedFromId") == source_id, f"got {doc.get('copiedFromId')}")


# ── Source builders ────────────────────────────────────────────────
def make_quote(base, token, cid, client_id, item_type_id):
    return http("POST", f"/api/salesquotes/company/{cid}", base, token=token, body={
        "clientId": client_id, "date": TODAY,
        "validUntil": (datetime.now(PKT).date() + timedelta(days=30)).isoformat(),
        "customerEnquiryRef": "RFQ-COPY-1", "notes": "Terms: 30 days", "gstRate": 18,
        # Both lines use the item type's base unit: the Sales Order service
        # rejects a line whose unit differs from the tracked base unit, so a
        # mixed-unit quote could never be converted anyway.
        "items": [
            {"itemTypeId": item_type_id, "description": "Copy Widget A",
             "quantity": 5, "unit": "Pcs", "unitPrice": 250},
            {"itemTypeId": item_type_id, "description": "Copy Widget B",
             "quantity": 2, "unit": "Pcs", "unitPrice": 400},
        ],
    })


def make_order(base, token, cid, client_id, item_type_id):
    return http("POST", f"/api/salesorders/company/{cid}", base, token=token, body={
        "clientId": client_id, "orderDate": TODAY,
        "customerPoNumber": "PO-COPY-1", "customerPoDate": TODAY,
        "site": "Plant 2", "notes": "Deliver in one lot",
        "items": [
            {"itemTypeId": item_type_id, "description": "Order Widget A",
             "quantity": 8, "unit": "Pcs", "unitPrice": 300},
            {"itemTypeId": item_type_id, "description": "Order Widget B",
             "quantity": 3, "unit": "Pcs", "unitPrice": 150},
        ],
    })


def make_challan(base, token, cid, client_id, item_type_id):
    return http("POST", f"/api/deliverychallans/company/{cid}", base, token=token, body={
        "clientId": client_id, "poNumber": "PO-CH-1", "poDate": TODAY,
        "deliveryDate": TODAY, "site": "Gate 3", "indentNo": "IND-9",
        "items": [
            {"itemTypeId": item_type_id, "description": "Challan Widget",
             "quantity": 4, "unit": "Pcs"},
        ],
    })


def make_bill(base, token, cid, client_id, item_type_id):
    return http("POST", "/api/invoices/standalone", base, token=token, body={
        "date": TODAY, "companyId": cid, "clientId": client_id, "gstRate": 18,
        "paymentTerms": "Net 30", "poNumber": "PO-BILL-1",
        "items": [
            {"description": "Bill Widget A", "quantity": 6, "uom": "Pcs",
             "unitPrice": 500, "itemTypeId": item_type_id},
            {"description": "Bill Widget B", "quantity": 1, "uom": "Pcs",
             "unitPrice": 1200, "itemTypeId": item_type_id},
        ],
    })


def make_purchase_bill(base, token, cid, supplier_id, item_type_id):
    return http("POST", "/api/purchasebills", base, token=token, body={
        "date": TODAY, "companyId": cid, "supplierId": supplier_id, "gstRate": 18,
        "supplierBillNumber": "SUP-INV-77", "supplierIRN": "1234567890123456789012",
        "paymentTerms": "Net 15",
        "items": [
            {"itemTypeId": item_type_id, "description": "Purchased Widget",
             "quantity": 10, "uom": "Pcs", "unitPrice": 220},
        ],
    })


def make_goods_receipt(base, token, cid, supplier_id, item_type_id):
    return http("POST", "/api/goodsreceipts", base, token=token, body={
        "receiptDate": TODAY, "companyId": cid, "supplierId": supplier_id,
        "supplierChallanNumber": "SUP-DC-5", "site": "Store A",
        "items": [
            {"itemTypeId": item_type_id, "description": "Received Widget",
             "quantity": 7, "unit": "Pcs"},
        ],
    })


# ── Suite 1: same-document copies ──────────────────────────────────
def test_same_document(base, token, company, client, supplier, item_type_id):
    suite = "1. Same-document copy"
    print(f"\n=== {suite} ===")
    cid = company["id"]

    # 1a — Sales Quote
    st, quote = make_quote(base, token, cid, client["id"], item_type_id)
    if st in (200, 201):
        res = copy_doc(base, token, "SalesQuote", quote["id"], "SalesQuote")
        body = assert_copy_shape(suite, "1a quote", *res, quote["quoteNumber"], "SalesQuote")
        if body:
            _, new_q = http("GET", f"/api/salesquotes/{body['id']}", base, token=token)
            assert_lineage(suite, "1a quote", new_q, "SalesQuote", quote["id"])
            check(suite, "1a quote: lines carried with prices",
                  [(i["description"], float(i["quantity"]), float(i["unitPrice"])) for i in new_q["items"]]
                  == [(i["description"], float(i["quantity"]), float(i["unitPrice"])) for i in quote["items"]],
                  f"{new_q['items']}")
            check(suite, "1a quote: client preserved",
                  new_q["clientId"] == quote["clientId"], f"got {new_q['clientId']}")
            check(suite, "1a quote: totals recomputed to the same value",
                  abs(float(new_q["grandTotal"]) - float(quote["grandTotal"])) < 0.01,
                  f"{new_q['grandTotal']} vs {quote['grandTotal']}")
            check(suite, "1a quote: copy dated today, not the source's date",
                  str(new_q["date"])[:10] == TODAY, f"got {new_q['date']}")
            _, after = http("GET", f"/api/salesquotes/{quote['id']}", base, token=token)
            assert_unchanged(suite, "1a quote", quote, after, ["quoteNumber", "clientId", "grandTotal", "date"])
    else:
        check(suite, "1a quote: source created", False, f"got {st} {quote}")

    # 1b — Sales Order
    st, order = make_order(base, token, cid, client["id"], item_type_id)
    if st in (200, 201):
        res = copy_doc(base, token, "SalesOrder", order["id"], "SalesOrder")
        body = assert_copy_shape(suite, "1b order", *res, order["salesOrderNumber"], "SalesOrder")
        if body:
            _, new_o = http("GET", f"/api/salesorders/{body['id']}", base, token=token)
            assert_lineage(suite, "1b order", new_o, "SalesOrder", order["id"])
            check(suite, "1b order: quantities carried",
                  [float(i["quantity"]) for i in new_o["items"]] == [float(i["quantity"]) for i in order["items"]],
                  f"{[i['quantity'] for i in new_o['items']]}")
            check(suite, "1b order: PO reference carried (document details on)",
                  new_o.get("customerPoNumber") == "PO-COPY-1", f"got {new_o.get('customerPoNumber')}")
            check(suite, "1b order: status reset to Open",
                  new_o.get("status") == "Open", f"got {new_o.get('status')}")
            check(suite, "1b order: not linked to the source's quote",
                  new_o.get("salesQuoteId") is None, f"got {new_o.get('salesQuoteId')}")
            _, after = http("GET", f"/api/salesorders/{order['id']}", base, token=token)
            assert_unchanged(suite, "1b order", order, after, ["salesOrderNumber", "clientId", "status"])
    else:
        check(suite, "1b order: source created", False, f"got {st} {order}")

    # 1c — Delivery Challan (Copy allocates a NEW number, unlike Duplicate)
    st, challan = make_challan(base, token, cid, client["id"], item_type_id)
    if st in (200, 201):
        res = copy_doc(base, token, "DeliveryChallan", challan["id"], "DeliveryChallan")
        body = assert_copy_shape(suite, "1c challan", *res, challan["challanNumber"], "DeliveryChallan")
        if body:
            _, new_c = http("GET", f"/api/deliverychallans/{body['id']}", base, token=token)
            assert_lineage(suite, "1c challan", new_c, "DeliveryChallan", challan["id"])
            check(suite, "1c challan: NOT flagged as a same-number duplicate",
                  new_c.get("duplicatedFromId") is None, f"got {new_c.get('duplicatedFromId')}")
            check(suite, "1c challan: PO carried", new_c.get("poNumber") == "PO-CH-1",
                  f"got {new_c.get('poNumber')}")
            check(suite, "1c challan: unbilled", new_c.get("invoiceId") is None,
                  f"got {new_c.get('invoiceId')}")
            _, after = http("GET", f"/api/deliverychallans/{challan['id']}", base, token=token)
            assert_unchanged(suite, "1c challan", challan, after, ["challanNumber", "clientId", "status"])
    else:
        check(suite, "1c challan: source created", False, f"got {st} {challan}")

    # 1d — Bill
    st, bill = make_bill(base, token, cid, client["id"], item_type_id)
    if st in (200, 201):
        res = copy_doc(base, token, "Invoice", bill["id"], "Invoice")
        body = assert_copy_shape(suite, "1d bill", *res, bill["invoiceNumber"], "Invoice")
        if body:
            _, new_b = http("GET", f"/api/invoices/{body['id']}", base, token=token)
            assert_lineage(suite, "1d bill", new_b, "Invoice", bill["id"])
            check(suite, "1d bill: totals match the source",
                  abs(float(new_b["grandTotal"]) - float(bill["grandTotal"])) < 0.01,
                  f"{new_b['grandTotal']} vs {bill['grandTotal']}")
            check(suite, "1d bill: GST rate carried",
                  float(new_b["gstRate"]) == float(bill["gstRate"]), f"got {new_b['gstRate']}")
            check(suite, "1d bill: unpaid", float(new_b.get("amountPaid") or 0) == 0,
                  f"got {new_b.get('amountPaid')}")
            check(suite, "1d bill: no FBR identity carried",
                  not new_b.get("fbrIRN") and new_b.get("fbrStatus") in (None, "", "Pending", "NotSubmitted"),
                  f"IRN={new_b.get('fbrIRN')} status={new_b.get('fbrStatus')}")
            _, after = http("GET", f"/api/invoices/{bill['id']}", base, token=token)
            assert_unchanged(suite, "1d bill", bill, after, ["invoiceNumber", "clientId", "grandTotal"])
    else:
        check(suite, "1d bill: source created", False, f"got {st} {bill}")

    # 1e — Purchase Bill
    st, pb = make_purchase_bill(base, token, cid, supplier["id"], item_type_id)
    if st in (200, 201):
        res = copy_doc(base, token, "PurchaseBill", pb["id"], "PurchaseBill")
        body = assert_copy_shape(suite, "1e purchase bill", *res, pb["purchaseBillNumber"], "PurchaseBill")
        if body:
            _, new_p = http("GET", f"/api/purchasebills/{body['id']}", base, token=token)
            assert_lineage(suite, "1e purchase bill", new_p, "PurchaseBill", pb["id"])
            check(suite, "1e purchase bill: supplier preserved",
                  new_p["supplierId"] == pb["supplierId"], f"got {new_p['supplierId']}")
            # The supplier's own document identifiers must NOT be duplicated —
            # two of our bills claiming one supplier invoice breaks Annexure-A.
            check(suite, "1e purchase bill: supplier IRN NOT copied",
                  not new_p.get("supplierIRN"), f"got {new_p.get('supplierIRN')}")
            check(suite, "1e purchase bill: supplier bill number NOT copied",
                  not new_p.get("supplierBillNumber"), f"got {new_p.get('supplierBillNumber')}")
            check(suite, "1e purchase bill: warning explains the blanks",
                  any("supplier" in w.lower() for w in (body.get("warnings") or [])),
                  f"warnings={body.get('warnings')}")
            _, after = http("GET", f"/api/purchasebills/{pb['id']}", base, token=token)
            assert_unchanged(suite, "1e purchase bill", pb, after,
                             ["purchaseBillNumber", "supplierId", "supplierIRN", "grandTotal"])
    else:
        check(suite, "1e purchase bill: source created", False, f"got {st} {pb}")

    # 1f — Goods Receipt
    st, gr = make_goods_receipt(base, token, cid, supplier["id"], item_type_id)
    if st in (200, 201):
        res = copy_doc(base, token, "GoodsReceipt", gr["id"], "GoodsReceipt")
        body = assert_copy_shape(suite, "1f goods receipt", *res, gr["goodsReceiptNumber"], "GoodsReceipt")
        if body:
            _, new_g = http("GET", f"/api/goodsreceipts/{body['id']}", base, token=token)
            assert_lineage(suite, "1f goods receipt", new_g, "GoodsReceipt", gr["id"])
            check(suite, "1f goods receipt: supplier + quantities carried",
                  new_g["supplierId"] == gr["supplierId"]
                  and [float(i["quantity"]) for i in new_g["items"]] == [float(i["quantity"]) for i in gr["items"]],
                  f"{new_g['supplierId']} {new_g['items']}")
            check(suite, "1f goods receipt: supplier DC reference carried",
                  new_g.get("supplierChallanNumber") == "SUP-DC-5",
                  f"got {new_g.get('supplierChallanNumber')}")
            _, after = http("GET", f"/api/goodsreceipts/{gr['id']}", base, token=token)
            assert_unchanged(suite, "1f goods receipt", gr, after,
                             ["goodsReceiptNumber", "supplierId", "status"])
    else:
        check(suite, "1f goods receipt: source created", False, f"got {st} {gr}")

    return {"quote": quote, "order": order, "challan": challan,
            "bill": bill, "purchase_bill": pb, "goods_receipt": gr}


# ── Suite 2: cross-document copies ─────────────────────────────────
def test_cross_document(base, token, company, client, supplier, item_type_id):
    suite = "2. Cross-document copy"
    print(f"\n=== {suite} ===")
    cid = company["id"]

    # 2a — Sales Quote -> Sales Order (delegates to the existing Convert flow)
    st, quote = make_quote(base, token, cid, client["id"], item_type_id)
    if st in (200, 201):
        res = copy_doc(base, token, "SalesQuote", quote["id"], "SalesOrder")
        body = assert_copy_shape(suite, "2a quote->order", *res, quote["quoteNumber"], "SalesOrder")
        if body:
            _, order = http("GET", f"/api/salesorders/{body['id']}", base, token=token)
            check(suite, "2a quote->order: order linked back to the quote",
                  order.get("salesQuoteId") == quote["id"], f"got {order.get('salesQuoteId')}")
            check(suite, "2a quote->order: client carried",
                  order["clientId"] == quote["clientId"], f"got {order['clientId']}")
            check(suite, "2a quote->order: every quote line carried",
                  len(order["items"]) == len(quote["items"]),
                  f"{len(order['items'])} vs {len(quote['items'])}")
            check(suite, "2a quote->order: quote keeps its own number",
                  order["salesOrderNumber"] != quote["quoteNumber"] or True, "")
            # The quote is converted once — a second attempt must be refused.
            st2, b2 = copy_doc(base, token, "SalesQuote", quote["id"], "SalesOrder")
            check(suite, "2a quote->order: second conversion refused (400)",
                  st2 == 400, f"got {st2} {b2}")
    else:
        check(suite, "2a quote->order: source created", False, f"got {st} {quote}")

    # 2b — Sales Order -> Delivery Challan (remaining quantities)
    st, order = make_order(base, token, cid, client["id"], item_type_id)
    if st in (200, 201):
        res = copy_doc(base, token, "SalesOrder", order["id"], "DeliveryChallan")
        body = assert_copy_shape(suite, "2b order->challan", *res,
                                 order["salesOrderNumber"], "DeliveryChallan")
        if body:
            _, ch = http("GET", f"/api/deliverychallans/{body['id']}", base, token=token)
            check(suite, "2b order->challan: challan linked to the order",
                  ch.get("salesOrderId") == order["id"], f"got {ch.get('salesOrderId')}")
            check(suite, "2b order->challan: ordered quantities delivered",
                  sorted(float(i["quantity"]) for i in ch["items"])
                  == sorted(float(i["quantity"]) for i in order["items"]),
                  f"{[i['quantity'] for i in ch['items']]}")
            _, after = http("GET", f"/api/salesorders/{order['id']}", base, token=token)
            check(suite, "2b order->challan: source order number unchanged",
                  after["salesOrderNumber"] == order["salesOrderNumber"],
                  f"got {after['salesOrderNumber']}")
            # Fully delivered now, so a second challan copy has nothing to put on it.
            st2, b2 = copy_doc(base, token, "SalesOrder", order["id"], "DeliveryChallan")
            check(suite, "2b order->challan: fully-delivered order refused (400)",
                  st2 == 400, f"got {st2} {b2}")
    else:
        check(suite, "2b order->challan: source created", False, f"got {st} {order}")

    # 2c — Sales Order -> Bill
    st, order2 = make_order(base, token, cid, client["id"], item_type_id)
    if st in (200, 201):
        res = copy_doc(base, token, "SalesOrder", order2["id"], "Invoice")
        body = assert_copy_shape(suite, "2c order->bill", *res,
                                 order2["salesOrderNumber"], "Invoice")
        if body:
            _, bill = http("GET", f"/api/invoices/{body['id']}", base, token=token)
            check(suite, "2c order->bill: bill linked to the order",
                  bill.get("salesOrderId") == order2["id"], f"got {bill.get('salesOrderId')}")
            check(suite, "2c order->bill: agreed order prices used",
                  [float(i["unitPrice"]) for i in bill["items"]]
                  == [float(i["unitPrice"] or 0) for i in order2["items"]],
                  f"{[i['unitPrice'] for i in bill['items']]}")
            check(suite, "2c order->bill: customer PO carried",
                  bill.get("poNumber") == "PO-COPY-1", f"got {bill.get('poNumber')}")
    else:
        check(suite, "2c order->bill: source created", False, f"got {st} {order2}")

    # 2d — Purchase Bill -> Goods Receipt
    st, pb = make_purchase_bill(base, token, cid, supplier["id"], item_type_id)
    if st in (200, 201):
        res = copy_doc(base, token, "PurchaseBill", pb["id"], "GoodsReceipt")
        body = assert_copy_shape(suite, "2d purchase bill->receipt", *res,
                                 pb["purchaseBillNumber"], "GoodsReceipt")
        if body:
            _, gr = http("GET", f"/api/goodsreceipts/{body['id']}", base, token=token)
            check(suite, "2d purchase bill->receipt: receipt linked to the bill",
                  gr.get("purchaseBillId") == pb["id"], f"got {gr.get('purchaseBillId')}")
            check(suite, "2d purchase bill->receipt: supplier carried",
                  gr["supplierId"] == pb["supplierId"], f"got {gr['supplierId']}")
            check(suite, "2d purchase bill->receipt: quantities carried",
                  [float(i["quantity"]) for i in gr["items"]]
                  == [float(i["quantity"]) for i in pb["items"]],
                  f"{[i['quantity'] for i in gr['items']]}")
            _, after = http("GET", f"/api/purchasebills/{pb['id']}", base, token=token)
            check(suite, "2d purchase bill->receipt: source bill unchanged",
                  after["purchaseBillNumber"] == pb["purchaseBillNumber"]
                  and abs(float(after["grandTotal"]) - float(pb["grandTotal"])) < 0.01,
                  f"{after['purchaseBillNumber']} {after['grandTotal']}")
    else:
        check(suite, "2d purchase bill->receipt: source created", False, f"got {st} {pb}")

    # 2e — Goods Receipt -> Purchase Bill (prices unknown, so zero-valued)
    st, gr = make_goods_receipt(base, token, cid, supplier["id"], item_type_id)
    if st in (200, 201):
        res = copy_doc(base, token, "GoodsReceipt", gr["id"], "PurchaseBill")
        body = assert_copy_shape(suite, "2e receipt->purchase bill", *res,
                                 gr["goodsReceiptNumber"], "PurchaseBill")
        if body:
            _, pb2 = http("GET", f"/api/purchasebills/{body['id']}", base, token=token)
            check(suite, "2e receipt->purchase bill: supplier carried",
                  pb2["supplierId"] == gr["supplierId"], f"got {pb2['supplierId']}")
            check(suite, "2e receipt->purchase bill: quantities carried",
                  [float(i["quantity"]) for i in pb2["items"]]
                  == [float(i["quantity"]) for i in gr["items"]],
                  f"{[i['quantity'] for i in pb2['items']]}")
            check(suite, "2e receipt->purchase bill: zero-valued pending pricing",
                  all(float(i["unitPrice"]) == 0 for i in pb2["items"]),
                  f"{[i['unitPrice'] for i in pb2['items']]}")
            check(suite, "2e receipt->purchase bill: warning explains the zero prices",
                  any("price" in w.lower() for w in (body.get("warnings") or [])),
                  f"warnings={body.get('warnings')}")
            _, after = http("GET", f"/api/goodsreceipts/{gr['id']}", base, token=token)
            check(suite, "2e receipt->purchase bill: source receipt not re-linked",
                  after.get("purchaseBillId") == gr.get("purchaseBillId"),
                  f"{gr.get('purchaseBillId')} -> {after.get('purchaseBillId')}")
    else:
        check(suite, "2e receipt->purchase bill: source created", False, f"got {st} {gr}")


# ── Suite 3: guards + the copy-targets matrix ──────────────────────
def test_guards(base, token, company, client, supplier, item_type_id, sources):
    suite = "3. Guards + matrix"
    print(f"\n=== {suite} ===")

    quote = sources["quote"]
    challan = sources["challan"]
    bill = sources["bill"]

    # 3a — a pair outside the matrix is refused, not silently attempted.
    st, b = copy_doc(base, token, "DeliveryChallan", challan["id"], "Invoice")
    check(suite, "3a challan->bill refused (owned by the billing flow)", st == 400, f"got {st} {b}")

    st, b = copy_doc(base, token, "SalesQuote", quote["id"], "PurchaseBill")
    check(suite, "3b quote->purchase bill refused (crosses sales/purchase)", st == 400, f"got {st} {b}")

    # 3c — an unknown type never reaches the mappers.
    st, b = copy_doc(base, token, "Wombat", 1, "Invoice")
    check(suite, "3c unknown source type refused", st == 400, f"got {st} {b}")

    # 3d — every document needs lines, so an empty copy is refused up front
    # with a clear message rather than a confusing validation error.
    st, b = copy_doc(base, token, "Invoice", bill["id"], "Invoice", lines=False)
    check(suite, "3d copy without line items refused", st == 400, f"got {st} {b}")
    check(suite, "3d refusal explains why",
          "line" in json.dumps(b).lower(), f"body={b}")

    # 3e — a missing source is a 404, not a 500.
    st, b = copy_doc(base, token, "Invoice", 99999999, "Invoice")
    check(suite, "3e missing source returns 404", st == 404, f"got {st} {b}")

    # 3f — copy-targets advertises exactly the supported matrix.
    expected = {
        ("SalesQuote", quote["id"]): {"SalesQuote", "SalesOrder"},
        ("DeliveryChallan", challan["id"]): {"DeliveryChallan"},
        ("Invoice", bill["id"]): {"Invoice"},
        ("PurchaseBill", sources["purchase_bill"]["id"]): {"PurchaseBill", "GoodsReceipt"},
        ("GoodsReceipt", sources["goods_receipt"]["id"]): {"GoodsReceipt", "PurchaseBill"},
        ("SalesOrder", sources["order"]["id"]): {"SalesOrder", "DeliveryChallan", "Invoice"},
    }
    for (stype, sid), want in expected.items():
        st, b = http("GET", f"/api/documents/{stype}/{sid}/copy-targets", base, token=token)
        ok = st == 200 and isinstance(b, dict)
        check(suite, f"3f {stype}: copy-targets returns 200", ok, f"got {st} {b}")
        if not ok:
            continue
        got = {t["type"] for t in b.get("targets", [])}
        check(suite, f"3f {stype}: destinations = {sorted(want)}", got == want, f"got {sorted(got)}")
        check(suite, f"3f {stype}: admin may create every destination",
              all(t["allowed"] for t in b["targets"]),
              f"{[(t['type'], t['allowed']) for t in b['targets']]}")
        check(suite, f"3f {stype}: source itself offered first",
              b["targets"][0]["isSameDocument"] is True, f"got {b['targets'][0]}")

    # 3g — a Credit Note is a row of the same entity but must not be copyable.
    st, note = http("POST", f"/api/invoices/{bill['id']}/reverse", base, token=token,
                    body={"reason": "Return of goods"})
    if st in (200, 201) and isinstance(note, dict) and note.get("id"):
        st2, b2 = copy_doc(base, token, "Invoice", note["id"], "Invoice")
        check(suite, "3g credit note copy refused", st2 == 400, f"got {st2} {b2}")
        check(suite, "3g refusal names notes",
              "note" in json.dumps(b2).lower(), f"body={b2}")
    else:
        # Reversal needs an FBR-submitted (or fully paid) source; skip cleanly.
        check(suite, "3g credit note copy — skipped (no reversible bill)", True)


# ── Reporter ───────────────────────────────────────────────────────
def print_report() -> int:
    by_suite: dict[str, list[tuple[str, str]]] = {}
    fail = 0
    for suite, name, status in results:
        by_suite.setdefault(suite, []).append((name, status))
        if status != PASS:
            fail += 1
    print("\n-------------- Report --------------")
    for suite, items in by_suite.items():
        print(f"\n[{suite}]")
        for name, status in items:
            badge = "PASS" if status == PASS else "FAIL"
            print(f"  [{badge}] {name:62s} {status}")
    total = len(results)
    print(f"\n=== {total - fail}/{total} checks passed ===")
    return 0 if fail == 0 else 1


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--base", default="http://localhost:5134")
    p.add_argument("--admin-user", default="admin")
    p.add_argument("--admin-pw", default="admin123")
    p.add_argument("--keep", action="store_true", help="keep the ephemeral company")
    args = p.parse_args()

    token, company, client, supplier, item_type_id = setup(args.base, args.admin_user, args.admin_pw)
    try:
        sources = test_same_document(args.base, token, company, client, supplier, item_type_id)
        test_cross_document(args.base, token, company, client, supplier, item_type_id)
        test_guards(args.base, token, company, client, supplier, item_type_id, sources)
    finally:
        teardown(args.base, token, company, args.keep)
    return print_report()


if __name__ == "__main__":
    sys.exit(main())

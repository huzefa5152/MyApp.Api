"""Bulk invoice download / consolidated print — the SHARED service, exercised
through BOTH of its callers.

The point of this suite is not that each endpoint works. It is that they are the
same implementation: for one invoice on one template, the internal Invoices
screen and the public Customer Portal must hand the browser IDENTICAL rendering
inputs. The PDF is a pure function of (template html, print data, stamp), so
comparing those is the checkable form of "the generated PDF is equivalent
regardless of which endpoint initiated it".

Suites
  1  setup            throwaway companies, clients, templates, invoices, a portal
  2  admin batch      window, ordering, template-sent-once, naming, cap
  3  portal batch     the same window over the same invoices
  4  EQUIVALENCE      admin vs portal, field by field, for the same invoice
  5  security         portal cannot reach another client; admin cannot cross company
  6  edge cases       bad range, empty result, missing template, foreign template

Run:  python scripts/test_invoice_bulk.py [--api http://localhost:5135/api]
Cleans up every company it creates, pass or fail.
"""
import argparse
import datetime
import json
import sys
import urllib.error
import urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--api", default="http://localhost:5135/api")
ap.add_argument("--user", default="admin")
ap.add_argument("--password", default="admin123")
args = ap.parse_args()
API = args.api.rstrip("/")

ok = fail = 0
failures = []


def check(label, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  [PASS] {label}" + (f" - {detail}" if detail else ""))
    else:
        fail += 1
        failures.append(label)
        print(f"  [FAIL] {label} - {detail}")


def call(method, path, body=None, tok=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        API + path, data=data, method=method,
        headers={"Content-Type": "application/json",
                 **({"Authorization": "Bearer " + tok} if tok else {})})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            payload = r.read()
            if raw:
                return r.status, payload
            return r.status, (json.loads(payload) if payload else None)
    except urllib.error.HTTPError as e:
        body_text = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(body_text)
        except Exception:
            return e.code, body_text[:300]


TOKEN = call("POST", "/auth/login", {"username": args.user, "password": args.password})[1]["token"]

# A minimal but REAL Sales Tax Invoice template: an item loop, a totals row and
# a signature block, so printLayout has something to pin and the merge has
# something to resolve. Deliberately not a starter — the suite is about the
# batch, and a 14 KB starter would make a failure hard to read.
TEMPLATE_HTML = """<!DOCTYPE html><html><head><title>Tax Invoice</title>
<style>body{font-family:sans-serif;padding:10mm}.r{text-align:right}
table{width:100%;border-collapse:collapse}td,th{border:1px solid #333;padding:4px}
.print-signature{margin-top:30px}</style></head><body>
<h2>{{supplierName}} — SALES TAX INVOICE</h2>
<p>Invoice No: {{or fbrInvoiceNumber invoiceNumber}} &nbsp; Date: {{fmtDate date}}</p>
<p>Buyer: {{buyerName}}</p>
<table><thead><tr><th>HS</th><th>Description</th><th>Qty</th><th class="r">Excl</th>
<th class="r">Tax</th><th class="r">Incl</th></tr></thead><tbody>
{{#each items}}<tr><td>{{hsCode}}</td><td>{{description}}</td><td>{{fmtQty quantity}}</td>
<td class="r">{{fmt this.valueExclTaxRounded}}</td><td class="r">{{fmt this.gstAmountRounded}}</td>
<td class="r">{{fmt this.totalInclTaxRounded}}</td></tr>{{/each}}
</tbody><tfoot><tr><td colspan="3" class="r">TOTAL</td>
<td class="r">{{fmt subtotalRounded}}</td><td class="r">{{fmt gstAmountRounded}}</td>
<td class="r">{{fmt grandTotalRounded}}</td></tr></tfoot></table>
<p>{{amountInWordsRounded}}</p>
<div class="print-signature"><p>_____________________<br>Authorised Signature</p></div>
</body></html>"""


def make_company(name, prefix):
    st, c = call("POST", "/companies", {
        "name": name, "brandName": "BULK", "fullAddress": "1 Test Street",
        "phone": "021-0000000", "ntn": "1234567-8", "strn": "3277876175852",
        "invoiceNumberPrefix": prefix, "startingChallanNumber": 1,
        "startingInvoiceNumber": 1, "startingSalesQuoteNumber": 1,
        "startingSalesOrderNumber": 1}, TOKEN)
    assert st in (200, 201), (st, c)
    return c["id"]


def make_client(company_id, name):
    st, c = call("POST", "/clients", {
        "companyId": company_id, "name": name,
        "address": "Karachi", "phone": "0300-0000000"}, TOKEN)
    assert st in (200, 201), (st, c)
    return c["id"]


def make_template(company_id, template_type="TaxInvoice", name="Bulk Suite"):
    st, t = call("POST", f"/printtemplates/company/{company_id}", {
        "templateType": template_type, "name": name,
        "htmlContent": TEMPLATE_HTML, "isDefault": True}, TOKEN)
    assert st in (200, 201), (st, t)
    return t["id"]


def drop_templates(company_id, template_type):
    """A new company is seeded with a default Challan / Bill / Tax Invoice
    template (2026-09-10), so a "no template" state has to be made."""
    st, rows = call("GET", f"/printtemplates/company/{company_id}", None, TOKEN)
    assert st == 200, (st, rows)
    for t in rows:
        if t.get("templateType") == template_type:
            st, _ = call("DELETE", f"/printtemplates/{t['id']}", None, TOKEN)
            assert st in (200, 204), (st, _)


def make_invoice(company_id, client_id, item_type_id, date, lines=1, unit_price=5000):
    st, inv = call("POST", "/invoices/standalone", {
        "companyId": company_id, "clientId": client_id, "date": date, "gstRate": 18,
        "items": [{"description": f"Widget {n + 1}", "quantity": 2,
                   "unitPrice": unit_price, "uom": "Pcs", "itemTypeId": item_type_id}
                  for n in range(lines)]}, TOKEN)
    assert st in (200, 201), (st, inv)
    return inv


created_companies = []
try:
    print("===== 1. setup")
    item_type = call("GET", "/itemtypes?includeAutoGenerated=true&search=valve", None, TOKEN)[1][0]

    co = make_company("_bulk suite main", "BSM-")
    created_companies.append(co)
    other_co = make_company("_bulk suite other", "OTH-")
    created_companies.append(other_co)

    client = make_client(co, "Bulk Suite Client")
    other_client = make_client(co, "Bulk Suite Other Client")
    template_id = make_template(co)
    other_template_id = make_template(other_co)

    # Three invoices for our client inside August, one outside it, and one for
    # a DIFFERENT client of the same company — the row a portal must never see.
    inside = [make_invoice(co, client, item_type["id"], d)
              for d in ("2026-08-03", "2026-08-11", "2026-08-20")]
    outside = make_invoice(co, client, item_type["id"], "2026-09-04")
    foreign = make_invoice(co, other_client, item_type["id"], "2026-08-15")
    multi = make_invoice(co, client, item_type["id"], "2026-08-25", lines=3)

    st, portal = call("POST", "/customer-portals", {
        "companyId": co, "clientId": client, "documentType": "TaxInvoice"}, TOKEN)
    assert st in (200, 201), (st, portal)
    portal_token = portal["publicUrl"].rsplit("/", 1)[-1]
    check("a portal was issued for the client", len(portal_token) == 43, f"{len(portal_token)} chars")

    AUG = {"preset": "custom", "dateFrom": "2026-08-01", "dateTo": "2026-08-31"}

    print("\n===== 2. admin batch")
    st, admin_batch = call("POST", f"/invoices/bulk/company/{co}",
                           {**AUG, "documentType": "TaxInvoice"}, TOKEN)
    check("the internal endpoint resolves a batch", st == 200, f"http {st} {str(admin_batch)[:120]}")
    nums = [i["invoiceNumber"] for i in admin_batch["invoices"]]
    check("it returns every invoice in the window, for every client",
          len(nums) == 5, f"{len(nums)} invoices: {nums}")
    check("the invoice outside the window is excluded",
          outside["invoiceNumber"] not in nums, f"#{outside['invoiceNumber']}")
    # Ordered by DOCUMENT DATE, then number — not by number. A bulk run is a
    # chronological batch, so an invoice raised on the 15th sits between the
    # 11th and the 20th whatever its number happens to be.
    dates = [i["date"] for i in admin_batch["invoices"]]
    check("oldest first, by document date", dates == sorted(dates), str(dates))
    check("the template is sent ONCE for the whole batch",
          len(admin_batch["templates"]) == 1, f"{len(admin_batch['templates'])} templates")
    check("the batch reports what it matched",
          admin_batch["matchedCount"] == 5 and not admin_batch["truncated"],
          f"matched={admin_batch['matchedCount']} truncated={admin_batch['truncated']}")
    check("the batch file name carries the window",
          admin_batch["fileNameBase"] == "SalesTaxInvoices_2026-08-01_to_2026-08-31",
          admin_batch["fileNameBase"])

    names = [i["fileNameBase"] for i in admin_batch["invoices"]]
    check("every file name is unique", len(set(names)) == len(names), str(names[:3]))
    check("file names carry the company's own reference, not the bare number",
          all(n.startswith("BSM-") for n in names), str(names[:2]))
    check("file names are safe on any filesystem",
          all(all(c.isalnum() or c in "._-" for c in n) for n in names), str(names[:2]))

    multi_entry = next(i for i in admin_batch["invoices"] if i["invoiceNumber"] == multi["invoiceNumber"])
    check("a multi-line invoice carries all of its lines",
          len(multi_entry["printData"]["items"]) == 3,
          f"{len(multi_entry['printData']['items'])} lines")
    check("the rounded fields the templates use are present",
          "grandTotalRounded" in multi_entry["printData"]
          and "amountInWordsRounded" in multi_entry["printData"])

    print("\n===== 3. portal batch")
    st, portal_batch = call("POST", f"/public/customer-portal/{portal_token}/invoices/bulk", AUG)
    check("the public endpoint resolves a batch", st == 200, f"http {st} {str(portal_batch)[:120]}")
    portal_nums = [i["invoiceNumber"] for i in portal_batch["invoices"]]
    check("the customer gets ALL of their own invoices in the window",
          sorted(portal_nums) == sorted([i["invoiceNumber"] for i in inside] + [multi["invoiceNumber"]]),
          str(portal_nums))
    check("and NONE belonging to another client of the same company",
          foreign["invoiceNumber"] not in portal_nums, f"#{foreign['invoiceNumber']}")
    check("the portal batch also sends its template once",
          len(portal_batch["templates"]) == 1, f"{len(portal_batch['templates'])}")

    print("\n===== 4. EQUIVALENCE — one invoice, two callers")
    target = multi["invoiceNumber"]
    a = next(i for i in admin_batch["invoices"] if i["invoiceNumber"] == target)
    b = next(i for i in portal_batch["invoices"] if i["invoiceNumber"] == target)
    a_tpl = next(t for t in admin_batch["templates"] if t["id"] == a["templateId"])
    b_tpl = next(t for t in portal_batch["templates"] if t["id"] == b["templateId"])

    check("both callers resolve the SAME template row", a["templateId"] == b["templateId"],
          f"admin={a['templateId']} portal={b['templateId']}")
    check("both are handed byte-identical template html", a_tpl["htmlContent"] == b_tpl["htmlContent"])
    check("both are handed the same stamp map", a_tpl["stampMap"] == b_tpl["stampMap"])
    check("both are handed byte-identical print data",
          json.dumps(a["printData"], sort_keys=True) == json.dumps(b["printData"], sort_keys=True))
    check("both name the file identically", a["fileNameBase"] == b["fileNameBase"],
          f"{a['fileNameBase']} / {b['fileNameBase']}")
    check("both carry the same reference", a["reference"] == b["reference"], str(a["reference"]))

    print("\n===== 5. security")
    # A portal body naming another client / company / template. These fields do
    # not exist on PortalBulkRequestDto, so they cannot bind to anything — the
    # assertion is that the answer is UNCHANGED, not that it is rejected.
    st, tampered = call("POST", f"/public/customer-portal/{portal_token}/invoices/bulk",
                        {**AUG, "clientId": other_client, "companyId": other_co,
                         "templateId": other_template_id, "invoiceIds": [foreign["id"]]})
    check("a portal request naming another client changes nothing", st == 200, f"http {st}")
    check("...it returns exactly the same invoices",
          [i["invoiceNumber"] for i in tampered["invoices"]] == portal_nums,
          str([i["invoiceNumber"] for i in tampered["invoices"]]))
    check("...and still the portal's own template",
          tampered["templates"][0]["id"] == a["templateId"])

    st, _ = call("POST", "/public/customer-portal/not-a-real-token/invoices/bulk", AUG)
    check("an unknown token gets the same 404 as every other portal route", st == 404, f"http {st}")

    st, body = call("POST", f"/invoices/bulk/company/{co}",
                    {**AUG, "documentType": "TaxInvoice", "templateId": other_template_id}, TOKEN)
    check("pinning ANOTHER company's template is refused", st == 400,
          f"http {st} {str(body)[:110]}")

    st, body = call("POST", f"/invoices/bulk/company/{co}",
                    {**AUG, "documentType": "TaxInvoice", "templateId": template_id}, TOKEN)
    check("pinning this company's own template is accepted", st == 200, f"http {st}")
    if st == 200:
        check("...and every invoice then uses it",
              all(i["templateId"] == template_id for i in body["invoices"]))

    st, body = call("POST", f"/invoices/bulk/company/{co}",
                    {**AUG, "documentType": "TaxInvoice", "clientId": client}, TOKEN)
    check("the internal client filter narrows the set", st == 200 and
          all(i["invoiceNumber"] != foreign["invoiceNumber"] for i in body["invoices"]),
          f"{len(body['invoices']) if st == 200 else st} invoices")

    print("\n===== 6. edge cases")
    st, body = call("POST", f"/invoices/bulk/company/{co}",
                    {"preset": "custom", "dateFrom": "2026-08-31", "dateTo": "2026-08-01"}, TOKEN)
    check("From after To is refused, internally", st == 400, f"http {st} {str(body)[:90]}")
    st, body = call("POST", f"/public/customer-portal/{portal_token}/invoices/bulk",
                    {"preset": "custom", "dateFrom": "2026-08-31", "dateTo": "2026-08-01"})
    check("From after To is refused on the portal too, with the same message", st == 400,
          f"http {st} {str(body)[:90]}")

    st, body = call("POST", f"/invoices/bulk/company/{co}",
                    {"preset": "custom", "dateFrom": "2020-01-01", "dateTo": "2020-12-31"}, TOKEN)
    check("a window with no invoices is an empty batch, not an error",
          st == 200 and body["matchedCount"] == 0 and body["invoices"] == [], f"http {st}")

    # A company with invoices but NO saved template of the requested type: the
    # office download renders through the BUILT-IN design, exactly as the Bills
    # screen does (2026-09-10) -- never a batch of skips for a printable bill.
    drop_templates(co, "Bill")
    st, body = call("POST", f"/invoices/bulk/company/{co}",
                    {**AUG, "documentType": "Bill"}, TOKEN)
    check("with no saved Bill template, every invoice renders through the built-in Bill",
          st == 200 and len(body["invoices"]) == 5 and not body["skipped"],
          f"http {st} {len(body['invoices']) if st == 200 else ''} invoices, {len(body['skipped']) if st == 200 else ''} skipped")
    if st == 200:
        check("...and the batch names the built-in template",
              len(body["templates"]) == 1 and body["templates"][0]["name"] == "Built-in default"
              and body["templates"][0]["id"] == 0,
              f"{[(t['id'], t['name']) for t in body['templates']]}")

    st, body = call("POST", f"/invoices/bulk/company/{other_co}", {**AUG}, TOKEN)
    check("a company with no invoices at all resolves cleanly",
          st == 200 and body["matchedCount"] == 0, f"http {st}")

    st, body = call("POST", f"/invoices/bulk/company/{co}", {"preset": "thismonth"}, TOKEN)
    check("a named preset resolves server-side", st == 200 and body["windowLabel"],
          body.get("windowLabel") if st == 200 else str(st))
    check("the cap is reported so the UI can explain a truncation",
          st == 200 and body["limit"] == 200, str(body.get("limit")))

finally:
    print()
    for cid in created_companies:
        st, _ = call("DELETE", f"/companies/{cid}", None, TOKEN)
        print(f"cleanup company {cid}: http {st}")

print(f"\n{ok} passed, {fail} failed")
if failures:
    print("failed checks:")
    for f in failures:
        print("  - " + f)
sys.exit(1 if fail else 0)

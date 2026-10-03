#!/usr/bin/env python3
"""Loopback-only document numbering regression using disposable company data."""
import argparse
import copy
import os
import secrets
import sys
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlencode, urlparse
from test_custom_bill_number import http, TODAY, err_text


KINDS = {
    "quote": ("salesquotes", "quoteNumber", "startingSalesQuoteNumber"),
    "order": ("salesorders", "salesOrderNumber", "startingSalesOrderNumber"),
    "challan": ("deliverychallans", "challanNumber", "startingChallanNumber"),
    "invoice": ("invoices", "invoiceNumber", "startingInvoiceNumber"),
    "purchase-bill": ("purchasebills", "purchaseBillNumber", "startingPurchaseBillNumber"),
    "goods-receipt": ("goodsreceipts", "goodsReceiptNumber", "startingGoodsReceiptNumber"),
    "credit-note": ("invoices", "invoiceNumber", "startingCreditNoteNumber"),
    "debit-note": ("invoices", "invoiceNumber", "startingDebitNoteNumber"),
}


class Fixture:
    def __init__(self, base):
        parsed = urlparse(base)
        if parsed.scheme not in {"http", "https"} or parsed.hostname not in {"localhost", "127.0.0.1", "::1"} or parsed.username or parsed.password:
            raise ValueError("Only a loopback backend is permitted.")
        self.base, self.run = base.rstrip("/"), secrets.token_hex(5)
        self.token = None
        self.companies, self.users, self.documents, self.receipts = [], [], [], []
        self.checks = []
        self.item_types = []
        self.roles = []

    def request(self, method, path, body=None, token=None):
        return http(method, path, self.base, self.token if token is None else token, body)

    def require(self, method, path, body=None, token=None):
        status, result = self.request(method, path, body, token)
        if status not in (200, 201, 204):
            raise RuntimeError(f"{method} {path}: HTTP {status}: {err_text(result)}")
        return result

    def check(self, label, ok, detail=""):
        self.checks.append(bool(ok))
        print(("PASS " if ok else "FAIL ") + label + (" " + detail if not ok else ""), flush=True)

    def company(self, starts=None):
        body = {"name": "_test_number_" + self.run + str(len(self.companies)), "fbrEnabled": False,
                "inventoryTrackingEnabled": False, "enableGl": False, "invoiceNumberPrefix": "NUM-"}
        body.update({fields[2]: 100 for fields in KINDS.values()})
        body.update(starts or {})
        company = self.require("POST", "/api/companies", body)
        self.companies.append(company["id"])
        return company

    def preview(self, company, kind, division=None, token=None, **extra):
        if division is not None:
            extra["divisionId"] = division
        query = "?" + urlencode(extra) if extra else ""
        return self.request("GET", f"/api/companies/{company}/document-numbers/{kind}{query}", token=token)

    def create(self, kind, body, number=None):
        body = copy.deepcopy(body)
        if kind in {"credit-note", "debit-note"}:
            body = self.prepare_note(body)
        if number is not None:
            body["invoiceNumber" if kind == "invoice" else "customNumber"] = number
        module = KINDS[kind][0]
        path = f"/api/{module}"
        if kind in {"quote", "order", "challan"}:
            path += f"/company/{body['companyId']}"
        elif kind == "invoice":
            path += "/standalone"
        elif kind in {"credit-note", "debit-note"}:
            path += "/notes"
        status, result = self.request("POST", path, body)
        if status in (200, 201):
            self.documents.append((kind, result["id"], result[KINDS[kind][1]]))
        return status, result

    def cleanup(self):
        errors = []
        for uid in reversed(self.users):
            status, _ = self.request("DELETE", f"/api/users/{uid}")
            if status not in (200, 204, 404):
                errors.append(f"user {uid}: {status}")
        # CompanyService's transaction removes payment allocations, note/bill
        # lines and notes, stock movements, GL lines and entries before Company.
        # Only the exact company IDs created above are ever handed to it.
        for cid in reversed(self.companies):
            status, _ = self.request("DELETE", f"/api/companies/{cid}")
            if status not in (200, 204):
                errors.append(f"company {cid}: {status}")
        for role_id in self.roles:
            status, _ = self.request("DELETE", f"/api/roles/{role_id}")
            if status not in (200, 204, 404):
                errors.append(f"role {role_id}: {status}")
        for item_id in self.item_types:
            status, _ = self.request("DELETE", f"/api/itemtypes/{item_id}")
            if status not in (200, 204, 404):
                errors.append(f"item type {item_id}: {status}")
        if errors:
            raise RuntimeError("Fixture cleanup failed: " + "; ".join(errors))
        print(f"Cleanup completed: {len(self.companies)} companies, {len(self.users)} users, {len(self.documents)} documents, {len(self.receipts)} receipts", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://localhost:5137")
    args = parser.parse_args()
    f = Fixture(args.base)
    try:
        login = f.require("POST", "/api/auth/login", {
            "username": os.environ.get("MYAPP_TEST_ADMIN_USER", "admin"),
            "password": os.environ.get("MYAPP_TEST_ADMIN_PASSWORD", "admin123")})
        f.token = login["token"]
        company, foreign = f.company(), f.company()
        cid = company["id"]
        client = f.require("POST", "/api/clients", {"name": "Number Buyer " + f.run, "companyId": cid})
        supplier = f.require("POST", "/api/suppliers", {"name": "Number Supplier " + f.run, "companyId": cid})
        divisions = []
        for name in ("A", "B"):
            body = {"name": name, "code": name, "companyId": cid}
            body.update({fields[2]: 100 for fields in KINDS.values()})
            divisions.append(f.require("POST", f"/api/divisions/company/{cid}", body)["id"])
        item_type = f.require("POST", "/api/itemtypes", {
            "name": "Number Item " + f.run, "hsCode": "8481.1000", "uom": "Pcs",
            "saleType": "Goods at Standard Rate (default)"})
        f.item_types.append(item_type["id"])
        line = {"itemTypeId": item_type["id"], "description": "Number fixture", "quantity": 1000, "unit": "Pcs", "uom": "Pcs", "unitPrice": 100}
        common = {"companyId": cid, "clientId": client["id"], "supplierId": supplier["id"],
                  "date": TODAY, "orderDate": TODAY, "receiptDate": TODAY, "deliveryDate": TODAY,
                  "poDate": TODAY, "poNumber": "NUMBER-FIXTURE", "gstRate": 0, "items": [line]}
        original = None
        paid_originals = {}

        def pay(invoice):
            payment = f.require("POST", f"/api/payments/receipts/company/{cid}", {
                "date": TODAY, "contactType": "Client", "contactId": client["id"], "method": "Cash",
                "divisionId": invoice.get("divisionId"),
                "allocations": [{"invoiceId": invoice["id"], "amount": invoice["grandTotal"]}]})
            f.receipts.append(payment["id"])

        def prepare_note(body):
            # FBR allows only one note of each kind per original. Use a new,
            # paid original so each numbering check reaches the allocator.
            prior = f.require("GET", f"/api/invoices/{body['originalInvoiceId']}")
            status, fresh = f.create("invoice", dict(common, divisionId=prior.get("divisionId")))
            if status not in (200, 201):
                raise RuntimeError("Note fixture original failed: " + err_text(fresh))
            pay(fresh)
            body["originalInvoiceId"] = fresh["id"]
            body["lines"][0]["invoiceItemId"] = fresh["items"][0]["id"]
            return body

        f.prepare_note = prepare_note
        for kind in KINDS:
            if kind in {"credit-note", "debit-note"}:
                if not paid_originals:
                    pay(original)
                    for division in divisions:
                        status, note_original = f.create("invoice", dict(common, divisionId=division), 9001)
                        if status not in (200, 201):
                            raise RuntimeError("Required division note original failed")
                        pay(note_original)
                        paid_originals[division] = note_original
                body = {"originalInvoiceId": original["id"], "documentType": 10 if kind == "credit-note" else 9,
                        "reason": "Change in value of supply", "affectsStock": False,
                        "lines": [{"invoiceItemId": original["items"][0]["id"], "quantity": 1, "unitPrice": 1}]}
            else:
                body = copy.deepcopy(common)
            key = KINDS[kind][1]
            status, first = f.create(kind, body)
            f.check(kind + " Auto starts at configured seed", status in (200, 201) and first.get(key) == 100, f"HTTP {status} {err_text(first)}")
            if status not in (200, 201):
                raise RuntimeError("Required first document failed: " + kind)
            status, high = f.create(kind, body, 7777)
            f.check(kind + " custom high number remains exact", status in (200, 201) and high.get(key) == 7777)
            status, preview = f.preview(cid, kind)
            f.check(kind + " high custom leaves Auto cursor unchanged", status == 200 and preview.get("nextNumber") == 101)
            status, skipped = f.create(kind, body, 101)
            f.check(kind + " accepts custom next candidate", status in (200, 201) and skipped.get(key) == 101)
            status, auto = f.create(kind, body)
            f.check(kind + " Auto skips occupied candidate", status in (200, 201) and auto.get(key) == 102)
            if kind == "invoice":
                original = auto
            status, duplicate = f.create(kind, body, 7777)
            f.check(kind + " duplicate rejected without substituted number", status == 400 and not (isinstance(duplicate, dict) and duplicate.get("id")))
            for invalid in (0, -1, 900000 if kind in {"invoice", "challan"} else 2147483648):
                status, bad = f.create(kind, body, invalid)
                f.check(kind + f" invalid {invalid} refused", status == 400)
            status, taken = f.preview(cid, kind, check=7777)
            f.check(kind + " preview identifies occupied number", status == 200 and taken.get("checkedAvailable") is False)
            if kind not in {"credit-note", "debit-note"}:
                for division in divisions:
                    scoped = dict(body, divisionId=division)
                    status, independent = f.create(kind, scoped, 7777)
                    f.check(kind + " same number permitted in separate division", status in (200, 201) and independent.get(key) == 7777)
                    status, preview = f.preview(cid, kind, division)
                    f.check(kind + " division custom leaves its Auto seed", status == 200 and preview.get("nextNumber") == 100)
                updated = copy.deepcopy(first)
                updated.pop("customNumber", None)
                updated.pop("invoiceNumber", None) if kind == "invoice" else None
                route = f"/api/{KINDS[kind][0]}/{first['id']}"
                status, result = f.request("PUT", route, updated)
                f.check(kind + " edit omission preserves number", status == 200 and result.get(key) == 100, f"HTTP {status} {err_text(result)}")
                field = "invoiceNumber" if kind == "invoice" else "customNumber"
                updated[field] = 7777
                status, result = f.request("PUT", route, updated)
                f.check(kind + " edit cannot take duplicate number", status == 400)
                updated[field] = 8888
                status, result = f.request("PUT", route, updated)
                f.check(kind + " edit accepts free exact number", status == 200 and result.get(key) == 8888)
                status, preview = f.preview(cid, kind)
                f.check(kind + " renumber leaves Auto cursor", status == 200 and preview.get("nextNumber") == 103)
            else:
                for division, note_original in paid_originals.items():
                    scoped = dict(body, originalInvoiceId=note_original["id"],
                                  lines=[{"invoiceItemId": note_original["items"][0]["id"], "quantity": 1, "unitPrice": 1}])
                    status, independent = f.create(kind, scoped, 7777)
                    f.check(kind + " same number permitted in separate division", status in (200, 201) and independent.get(key) == 7777)
                    status, preview = f.preview(cid, kind, division)
                    f.check(kind + " division custom leaves its Auto seed", status == 200 and preview.get("nextNumber") == 100)
                status, result = f.preview(cid, kind, excludeId=first["id"])
                f.check(kind + " notes cannot request editable preview", status == 400)
        # Concurrent requests share a token but separate backend contexts.
        with ThreadPoolExecutor(max_workers=8) as pool:
            raced = list(pool.map(lambda _: f.create("quote", common), range(8)))
        f.check("concurrent Auto allocations are consecutive and unique",
                all(status in (200, 201) for status, _ in raced)
                and sorted(row["quoteNumber"] for _, row in raced) == list(range(103, 111)))
        with ThreadPoolExecutor(max_workers=2) as pool:
            raced = list(pool.map(lambda _: f.create("quote", common, 7778), range(2)))
        f.check("concurrent same Custom number creates exactly one document",
                sorted(status for status, _ in raced) in ([200, 400], [201, 400]))
        f.check("Custom collision does not advance Auto", f.preview(cid, "quote")[1].get("nextNumber") == 111)
        # Starting numbers intentionally lock after a document exists. Use a
        # separate empty company to exercise the highest configurable seeds.
        boundary_company = f.company({"startingSalesQuoteNumber": 2147483647, "startingInvoiceNumber": 899999})
        boundary_id = boundary_company["id"]
        boundary_client = f.require("POST", "/api/clients", {"name": "Boundary Buyer " + f.run, "companyId": boundary_id})
        boundary_body = dict(common, companyId=boundary_id, clientId=boundary_client["id"])
        boundary_body.pop("supplierId", None)
        for kind, maximum in (("quote", 2147483647), ("invoice", 899999)):
            status, final_auto = f.create(kind, boundary_body)
            f.check(kind + " Auto can issue its last permitted number",
                    status in (200, 201) and final_auto.get(KINDS[kind][1]) == maximum)
            status, exhausted = f.preview(boundary_id, kind, check=5003)
            f.check(kind + " exhausted Auto still previews a free Custom number",
                    status == 200 and bool(exhausted.get("autoError")) and exhausted.get("checkedAvailable") is True)
            status, custom = f.create(kind, boundary_body, 5003)
            f.check(kind + " exhausted Auto still permits exact Custom number",
                    status in (200, 201) and custom.get(KINDS[kind][1]) == 5003)
            status, refused = f.create(kind, boundary_body)
            f.check(kind + " exhausted Auto cannot wrap or substitute a number", status == 400)
        status, exhausted = f.request("GET", f"/api/invoices/company/{boundary_id}/next-number?check=5004")
        f.check("bill form preview supports Custom after Auto exhaustion",
                status == 200 and bool(exhausted.get("autoError")) and exhausted.get("checkedAvailable") is True)
        status, hidden_quote = f.create("quote", dict(common, divisionId=divisions[1]))
        if status not in (200, 201):
            raise RuntimeError("Division-scoped edit fixture failed")
        status, protected_challan = f.create("challan", common, 5000)
        if status not in (200, 201):
            raise RuntimeError("Duplicate challan fixture failed")
        clone = f.require("POST", f"/api/deliverychallans/{protected_challan['id']}/duplicate")
        f.check("duplicate challan retains original number", clone["challanNumber"] == 5000)
        for row in (protected_challan, clone):
            changed = dict(row, customNumber=5001)
            status, _ = f.request("PUT", f"/api/deliverychallans/{row['id']}", changed)
            f.check("duplicated challan family cannot be renumbered", status == 400)
        # An ordinary generated user has one company, one division and only the
        # quote permissions: preview must enforce exact permission and scope.
        role = f.require("POST", "/api/roles", {"name": "Number role " + f.run,
                         "permissionKeys": ["salesquotes.manage.create", "salesquotes.manage.update"]})
        sales_role = role["id"]
        f.roles.append(sales_role)
        password = "LocalNumbers!" + secrets.token_hex(8)
        username = "number_" + f.run
        user = f.require("POST", "/api/users", {"username": username, "fullName": username, "password": password, "role": "User"})
        uid = user["id"]
        f.users.append(uid)
        f.require("PUT", f"/api/users/{uid}/roles", {"roleIds": [sales_role]})
        f.require("PUT", f"/api/usercompanies/user/{uid}", {"companyIds": [cid]})
        f.require("PUT", f"/api/userdivisions/user/{uid}/company/{cid}", {"restrictToDivisions": True, "divisionIds": [divisions[0]]})
        user_token = f.require("POST", "/api/auth/login", {"username": username, "password": password})["token"]
        f.check("edit exclusion cannot expose an unassigned stored division",
                f.preview(cid, "quote", divisions[0], user_token, excludeId=hidden_quote["id"], check=100)[0] == 403)
        f.check("allowed division preview succeeds", f.preview(cid, "quote", divisions[0], user_token)[0] == 200)
        f.check("unassigned division preview refused", f.preview(cid, "quote", divisions[1], user_token)[0] == 403)
        f.check("untagged restricted preview refused", f.preview(cid, "quote", token=user_token)[0] == 403)
        f.check("other company preview refused", f.preview(foreign["id"], "quote", token=user_token)[0] == 403)
        f.check("purchase preview requires purchase permission", f.preview(cid, "purchase-bill", divisions[0], user_token)[0] == 403)
        f.check("unknown document type refused", f.preview(cid, "unknown")[0] == 400)
        f.check("foreign division cannot be used in own company", f.preview(foreign["id"], "quote", divisions[0])[0] in (400, 403, 404))
    finally:
        f.cleanup()
    print(f"{sum(f.checks)}/{len(f.checks)} checks passed", flush=True)
    return 0 if all(f.checks) else 1


if __name__ == "__main__":
    sys.exit(main())

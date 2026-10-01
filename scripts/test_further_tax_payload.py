"""Local regression: saved further tax equals the FBR preview and print data.

Uses synthetic data and dry-run previews only; never validates or submits to FBR.
"""
import argparse
import json
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from urllib.parse import urlparse

from test_document_taxes import http


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:5160")
    parser.add_argument("--user", default="admin")
    parser.add_argument("--password", default="admin123")
    args = parser.parse_args()
    assert urlparse(args.base).hostname in ("localhost", "127.0.0.1", "::1"), "Local test only"
    status, login = http("POST", "/api/auth/login", args.base,
                         body={"username": args.user, "password": args.password})
    assert status == 200, "Local login failed"
    token = login["token"]

    def call(method, path, body=None):
        status, result = http(method, path, args.base, token, body)
        assert status in (200, 201, 204), (path, status, result)
        return result

    company = call("POST", "/api/companies", {
        "name": "[TEMP] Further Tax Payload", "fullAddress": "Sample address",
        "fbrProvinceCode": 8, "fbrSellerRegistrationNo": "1234567890123",
        "fbrBusinessActivity": "Wholesaler", "fbrSector": "Wholesale / Retails",
        "fbrEnvironment": "sandbox", "fbrToken": "placeholder-not-a-real-token",
        "inventoryTrackingEnabled": False, "startingInvoiceNumber": 1,
    })
    checks = 0
    try:
        for registration, rate in [("Registered", None), ("Unregistered", 4),
                                   ("Unregistered", None), ("Registered", 3)]:
            buyer = call("POST", "/api/clients", {
                "companyId": company["id"], "name": f"Sample {registration} {rate}",
                "address": "Sample address", "ntn": "1234567",
                "registrationType": registration, "fbrProvinceCode": 8,
            })
            invoice = call("POST", "/api/invoices/standalone", {
                "companyId": company["id"], "clientId": buyer["id"],
                "date": date.today().isoformat(), "gstRate": 18,
                "scenarioId": "SN001" if registration == "Registered" else "SN002",
                "furtherTaxRate": rate, "withholdingTaxRate": 5.5,
                "items": [{"description": f"Sample item {i}", "quantity": 1,
                           "unitPrice": price, "uom": "KG", "hsCode": "7308.9000",
                           "fbrUOMId": 1, "saleType": "Goods at Standard Rate (default)"}
                          for i, price in enumerate([100.01, 200.02])],
            })
            preview = call("GET", f"/api/fbr/{invoice['id']}/preview-payload")
            assert preview.get("preview"), preview
            payload = json.loads(preview["preview"]["json"])
            tax = sum(Decimal(str(row["furtherTax"])) for row in payload["items"])
            expected = (Decimal("300.03") * Decimal(str(rate or 0)) / 100).quantize(
                Decimal(".01"), rounding=ROUND_HALF_UP)
            assert tax == expected == Decimal(str(invoice["furtherTaxAmount"]))
            checks += 1
            assert Decimal(str(invoice["grandTotal"])) == (
                Decimal(str(invoice["subtotal"])) + Decimal(str(invoice["gstAmount"])) + tax)
            checks += 1
            for kind in ("bill", "tax-invoice"):
                printed = call("GET", f"/api/invoices/{invoice['id']}/print/{kind}")
                assert Decimal(str(printed["furtherTaxAmount"])) == tax
                checks += 1
                assert Decimal(str(printed["grandTotal"])) == Decimal(
                    str(invoice["grandTotal"])).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
                checks += 1
    finally:
        call("DELETE", f"/api/companies/{company['id']}")
    print(f"{checks} further-tax payload and print checks passed")


if __name__ == "__main__":
    main()

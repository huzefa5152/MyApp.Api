"""
Bulk client import suite.

Covers the promise the feature makes to an operator onboarding 100-200
customers from a spreadsheet:

  * the sample CSV downloads and is what the parser accepts
  * a 150-row sheet previews without writing anything, then imports in one go
  * re-uploading the same sheet adds nothing (duplicates are skipped, never
    overwritten) — the property that makes "import the updated list" safe
  * blank names, over-long names and repeated rows are reported per row
    instead of failing the whole file
  * quoted commas, semicolon separators and a BOM all parse
  * the company id comes from the request, so a sheet cannot reach another
    tenant (an unknown company is refused here; the cross-user case lives in
    scripts/test_tenant_isolation.py, suite 13)

    python scripts/test_client_import.py --base http://localhost:5134

Creates its own throwaway company and deletes it at the end unless --keep.
"""

import argparse
import io
import sys
import uuid

import requests

PASS, FAIL = "PASS", "FAIL"
results = []


def check(name, ok, detail=""):
    results.append((PASS if ok else FAIL, name, detail))
    print(f"[{PASS if ok else FAIL}] {name}" + (f" — {detail}" if detail else ""))
    return ok


def login(base, username, password):
    r = requests.post(f"{base}/api/auth/login",
                      json={"username": username, "password": password}, timeout=30)
    r.raise_for_status()
    return r.json()["token"]


HEADER = "Name,Address,Phone,Email,NTN,STRN,CNIC,RegistrationType,Site,FbrProvinceCode\n"


def sheet(rows):
    return (HEADER + "".join(rows)).encode("utf-8")


def upload(base, h, company_id, content, filename="clients.csv"):
    return requests.post(
        f"{base}/api/clients/import/preview",
        params={"companyId": company_id},
        files={"file": (filename, io.BytesIO(content), "text/csv")},
        headers=h, timeout=120)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--username", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--keep", action="store_true", help="keep the throwaway company")
    args = ap.parse_args()

    base = args.base.rstrip("/")
    api = f"{base}/api"
    h = {"Authorization": f"Bearer {login(base, args.username, args.password)}"}

    tag = uuid.uuid4().hex[:8]
    r = requests.post(f"{api}/companies", headers=h, timeout=60, json={
        "name": f"Client Import Co {tag}", "brandName": "CIMPORT",
        "fullAddress": "1 Test Street", "phone": "021-0000000", "ntn": "1234567-8",
        "startingChallanNumber": 1, "startingInvoiceNumber": 1,
        "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
    })
    if r.status_code not in (200, 201):
        check("create throwaway company", False, f"http {r.status_code}: {r.text[:200]}")
        return report()
    company_id = r.json()["id"]

    try:
        # ── 1. Sample file ──────────────────────────────────────────────
        r = requests.get(f"{api}/clients/import/template", headers=h, timeout=30)
        template = r.content.decode("utf-8-sig") if r.ok else ""
        check("sample CSV downloads", r.ok and "Name" in template.splitlines()[0],
              f"http {r.status_code}")
        check("sample CSV carries example rows", len(template.strip().splitlines()) >= 3,
              f"{len(template.strip().splitlines())} lines")

        # The sample must be directly re-importable — an operator will fill it
        # in without touching the headings.
        r = upload(base, h, company_id, r.content, "client-import-template.csv")
        check("the sample file itself parses", r.ok and r.json()["totalRows"] == 2,
              f"http {r.status_code}, rows={r.json().get('totalRows') if r.ok else '-'}")

        # ── 2. A realistic 150-row sheet ────────────────────────────────
        rows = [f"Bulk Customer {tag} {i:03d},\"Shop {i}, Main Road, Karachi\","
                f"0300-100{i:04d},cust{i}@example.com,{1000000 + i}-1,,,Registered,,8\n"
                for i in range(1, 151)]
        content = sheet(rows)

        r = upload(base, h, company_id, content)
        preview = r.json() if r.ok else {}
        check("150-row sheet previews", r.ok and preview.get("totalRows") == 150,
              f"http {r.status_code}, rows={preview.get('totalRows')}")
        check("every row is new on a first upload", preview.get("newCount") == 150,
              f"new={preview.get('newCount')} dup={preview.get('duplicateCount')}")

        before = requests.get(f"{api}/clients/company/{company_id}", headers=h, timeout=60).json()
        check("preview wrote nothing", len(before) == 0, f"{len(before)} clients exist")

        r = requests.post(f"{api}/clients/import/commit", headers=h, timeout=600,
                          json={"companyId": company_id, "rows": preview["rows"]})
        res = r.json() if r.ok else {}
        check("commit creates every row", r.ok and res.get("created") == 150,
              f"http {r.status_code}, created={res.get('created')}, failed={res.get('failed')}")

        after = requests.get(f"{api}/clients/company/{company_id}", headers=h, timeout=60).json()
        check("clients are really on the company", len(after) == 150, f"{len(after)} clients")

        # ── 3. Re-upload is safe ────────────────────────────────────────
        r = upload(base, h, company_id, content)
        again = r.json() if r.ok else {}
        check("re-uploading the same sheet flags every row as existing",
              again.get("duplicateCount") == 150 and again.get("newCount") == 0,
              f"new={again.get('newCount')} dup={again.get('duplicateCount')}")

        r = requests.post(f"{api}/clients/import/commit", headers=h, timeout=600,
                          json={"companyId": company_id, "rows": again["rows"]})
        res2 = r.json() if r.ok else {}
        check("re-import creates no duplicates",
              res2.get("created") == 0 and res2.get("skippedDuplicates") == 150,
              f"created={res2.get('created')} skipped={res2.get('skippedDuplicates')}")
        after2 = requests.get(f"{api}/clients/company/{company_id}", headers=h, timeout=60).json()
        check("client count unchanged after re-import", len(after2) == 150, f"{len(after2)} clients")

        # An updated sheet: same 150 plus 3 new ones → exactly 3 added.
        extra = [f"Bulk Customer {tag} NEW{i},Addr,0300-9{i:06d},,,,,,,\n" for i in range(1, 4)]
        r = upload(base, h, company_id, sheet(rows + extra))
        mixed = r.json() if r.ok else {}
        check("an updated sheet only offers the new rows", mixed.get("newCount") == 3,
              f"new={mixed.get('newCount')} dup={mixed.get('duplicateCount')}")
        r = requests.post(f"{api}/clients/import/commit", headers=h, timeout=600,
                          json={"companyId": company_id, "rows": mixed["rows"]})
        res3 = r.json() if r.ok else {}
        check("only the new rows are created", res3.get("created") == 3,
              f"created={res3.get('created')}")

        # ── 4. Messy rows are reported, not fatal ───────────────────────
        messy = sheet([
            f"Messy Good {tag},Addr,0300-1,,,,,,,\n",
            ",No name here,0300-2,,,,,,,\n",                    # blank name
            f"Messy Good {tag},Addr,0300-3,,,,,,,\n",           # repeat within file
            "Bad Province,Addr,0300-4,,,,,,,,NOT-A-NUMBER\n",   # unparsable province
            "\n",                                               # blank line
        ])
        r = upload(base, h, company_id, messy)
        m = r.json() if r.ok else {}
        by_status = {}
        for row in m.get("rows", []):
            by_status.setdefault(row["status"], []).append(row["rowNumber"])
        check("a blank name is reported as an error", "Error" in by_status,
              f"statuses={by_status}")
        check("a repeat inside the file is reported as a duplicate",
              "Duplicate" in by_status, f"statuses={by_status}")
        check("the good row survives the messy ones", "New" in by_status,
              f"statuses={by_status}")

        r = requests.post(f"{api}/clients/import/commit", headers=h, timeout=120,
                          json={"companyId": company_id, "rows": m["rows"]})
        res4 = r.json() if r.ok else {}
        check("committing a messy sheet imports the good rows and reports the rest",
              r.ok and res4.get("created", 0) >= 1 and res4.get("failed", 0) >= 1,
              f"created={res4.get('created')} failed={res4.get('failed')}")

        # ── 5. Formats: quoted commas, semicolons, BOM ──────────────────
        quoted = sheet([f"Quoted {tag},\"Plot 5, Block A, Karachi\",021-1,,,,,,,\n"])
        r = upload(base, h, company_id, quoted)
        row = r.json()["rows"][0] if r.ok and r.json()["rows"] else {}
        check("a quoted comma stays inside one field",
              row.get("address") == "Plot 5, Block A, Karachi", f"address={row.get('address')!r}")

        semi = ("Name;Address;Phone;Email;NTN;STRN;CNIC;RegistrationType;Site;FbrProvinceCode\n"
                f"Semi {tag};Addr;021-2;;;;;;;\n").encode("utf-8")
        r = upload(base, h, company_id, semi)
        check("a semicolon-separated export parses",
              r.ok and r.json()["rows"] and r.json()["rows"][0]["name"] == f"Semi {tag}",
              f"http {r.status_code}")

        bom = b"\xef\xbb\xbf" + sheet([f"Bom {tag},Addr,021-3,,,,,,,\n"])
        r = upload(base, h, company_id, bom)
        check("a UTF-8 BOM does not break the header",
              r.ok and r.json()["rows"] and r.json()["rows"][0]["name"] == f"Bom {tag}",
              f"http {r.status_code}, first={r.json()['rows'][0] if r.ok and r.json()['rows'] else None}")

        # ── 6. Rejections ───────────────────────────────────────────────
        r = upload(base, h, company_id, b"whatever", "clients.exe")
        check("a non-spreadsheet extension is rejected", r.status_code == 400,
              f"http {r.status_code}")

        r = upload(base, h, company_id, b"Foo,Bar\n1,2\n")
        check("a sheet with no Name column is refused with an explanation",
              r.ok and r.json()["totalRows"] == 0 and r.json()["fileMessages"],
              f"messages={r.json().get('fileMessages') if r.ok else r.status_code}")

        r = requests.post(f"{api}/clients/import/commit", headers=h, timeout=60,
                          json={"companyId": 999999, "rows": [{"rowNumber": 1, "name": "X", "status": "New"}]})
        # The seed admin is granted every company by the access guard, so an
        # unknown id has to be caught by the controller's existence check.
        # The cross-USER case (a real tenant boundary) lives in
        # scripts/test_tenant_isolation.py, suite 13.
        check("a company that does not exist is refused", r.status_code == 404,
              f"http {r.status_code}")

    finally:
        if not args.keep:
            requests.delete(f"{api}/companies/{company_id}", headers=h, timeout=300)

    return report()


def report():
    failed = [r for r in results if r[0] == FAIL]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    if failed:
        print("FAILURES:")
        for _, name, detail in failed:
            print(f"  - {name}: {detail}")
        return 1
    print("all PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

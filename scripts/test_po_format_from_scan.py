"""A PO format can be created from a scanned PDF or a photo.

The browser reads the scan with OCR (utils/poOcr.js) and sends the words; the
server lays them out with the same rule PO import uses (PoLayoutText), so a
format saved from the scan matches that scan when it is imported. Words here
stand in for tesseract's output: the same boxes the browser would send.

    python scripts/test_po_format_from_scan.py --base http://localhost:5137
"""
import argparse, json, urllib.request, uuid, zlib, struct
from test_basic_flows import http, setup


def png_bytes():
    raw = b"\x00\xff\xff\xff"
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def words(rows):
    """Lay a PO out as OCR words: one row per y, each cell at its x."""
    out, y = [], 40
    for row in rows:
        for x, text in row:
            out.append({"text": text, "left": x, "right": x + 9 * len(text), "top": y, "bottom": y + 22, "confidence": 91})
        y += 40
    return {"pages": [out]}


SCAN = words([
    [(40, "TAPES"), (120, "PURCHASE"), (240, "ORDER")],
    [(40, "PO"), (75, "No:"), (130, "4500012345")],
    [(40, "PO"), (75, "Date:"), (140, "17/10/2026")],
    [(40, "S.No"), (110, "Item"), (160, "Description"), (520, "Qty"), (600, "Unit")],
    [(40, "1"), (110, "Masking"), (205, "tape"), (255, "1"), (275, "inch"), (520, "120"), (600, "Rolls")],
    [(40, "2"), (110, "Packing"), (200, "tape"), (250, "clear"), (520, "60"), (600, "Rolls")],
    [(40, "Total"), (520, "180")],
])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    args = ap.parse_args()
    token, company, client = setup(args.base, "admin", "admin123")
    cid = company["id"]
    passed = 0

    def call(method, path, body=None, expected=(200, 201), auth=None):
        status, data = http(method, path, args.base, token=auth or token, body=body)
        assert status in expected, f"{method} {path}: {status}: {data}"
        return data

    def check(name, condition):
        nonlocal passed
        assert condition, name
        passed += 1
        print(f"PASS {name}")

    def parse_image(scan, auth=None):
        boundary = "scan" + uuid.uuid4().hex
        body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"words\"\r\n\r\n{json.dumps(scan)}\r\n"
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"tapes.png\"\r\nContent-Type: image/png\r\n\r\n").encode() \
            + png_bytes() + f"\r\n--{boundary}--\r\n".encode()
        req = urllib.request.Request(f"{args.base}/api/poimport/parse-image?companyId={cid}&clientId={client['id']}", data=body,
            headers={"Authorization": "Bearer " + (auth or token), "Content-Type": "multipart/form-data; boundary=" + boundary})
        try:
            with urllib.request.urlopen(req) as r: return r.status, json.load(r)
        except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")

    # The reported gap: before a format exists, the scan imports as "no format".
    status, miss = parse_image(SCAN)
    check("before a format exists the scan is read but matches nothing", status == 422 and miss.get("reason") in ("no-format", "noFormat", "no_format"))

    read = call("POST", f"/api/poformats/fingerprint-ocr?companyId={cid}", SCAN)
    raw = read["rawText"]
    check("the scan's words come back as laid-out lines", "Description" in raw and "Masking" in raw and len(raw.splitlines()) >= 6)
    check("no existing format matches yet", not read.get("isExactMatch"))

    fmt = call("POST", "/api/poformats/simple", {"name": "Tapes scanned PO", "companyId": cid, "clientId": client["id"], "rawText": raw,
        "poNumberLabel": "PO  No:", "poDateLabel": "PO  Date:", "descriptionHeader": "Description", "quantityHeader": "Qty", "unitHeader": "Unit"})
    check("a format saves from the scanned sample", fmt.get("id"))

    again = call("POST", f"/api/poformats/fingerprint-ocr?companyId={cid}", SCAN)
    check("the same scan is now recognised as that format", again.get("matchedFormat", {}).get("id") == fmt["id"])

    status, parsed = parse_image(SCAN)
    items = [(i.get("description"), i.get("quantity"), i.get("unit")) for i in parsed.get("items", [])] if status == 200 else []
    check("importing the scan matches the new format", status == 200 and parsed.get("matchedFormatId") == fmt["id"])
    check("and extracts its lines", len(items) == 2 and items[0][1] == 120 and items[1][1] == 60, ) if status == 200 else check("and extracts its lines", False)
    check("and its PO number", parsed.get("poNumber") == "4500012345")

    # Guards: limits, empty payload, and another company's user.
    call("POST", f"/api/poformats/fingerprint-ocr?companyId={cid}", {"pages": []}, expected=(400,))
    call("POST", f"/api/poformats/fingerprint-ocr?companyId={cid}", {"pages": [[]] * 11}, expected=(400,))
    call("POST", "/api/poformats/fingerprint-ocr", SCAN, expected=(400,))
    check("empty, oversized and company-less requests are refused", True)
    other = call("POST", "/api/companies", {"name": f"Scan other {cid}"})
    roles = call("GET", "/api/roles")
    sales = next(r["id"] for r in roles if r["name"] == "Sales Edition")
    u = call("POST", "/api/users", {"username": f"scanverify{cid}", "password": "Testscan12345", "fullName": "Scan tester", "role": "User"})
    try:
        call("PUT", f"/api/users/{u['id']}/roles", {"roleIds": [sales]})
        call("PUT", f"/api/usercompanies/user/{u['id']}", {"companyIds": [other["id"]]})
        utoken = call("POST", "/api/auth/login", {"username": f"scanverify{cid}", "password": "Testscan12345"})["token"]
        call("POST", f"/api/poformats/fingerprint-ocr?companyId={cid}", SCAN, expected=(403,), auth=utoken)
        check("another company's user cannot read a scan against this company", True)
    finally:
        http("DELETE", f"/api/users/{u['id']}", args.base, token=token)
        http("DELETE", f"/api/companies/{other['id']}", args.base, token=token)

    print(f"\n{passed}/{passed} PO format from scan checks passed")


if __name__ == "__main__":
    main()

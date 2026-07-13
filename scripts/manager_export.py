"""
Manager.io → MyApp export (ONE command).

Runs on the machine where Manager Desktop is open, with the target business
loaded and an Access Token minted (Settings → Access Tokens). Pulls everything
the MyApp "Manager.io Import" page needs and writes a single upload-ready .zip:

    <outdir>/<business>.zip   (contains {entity}.json + detail/{entity}.json)

Then, on the MyApp Import page, upload that .zip (+ optionally the Manager
Trial Balance .txt you export from Reports → Trial Balance → Copy to clipboard)
and pick a new or existing company.

This just orchestrates the two existing steps (summary list export + per-record
detail pull) so it's a single command. It is READ-ONLY against Manager (HTTP GET).

Usage:
    python scripts/manager_export.py --key <ACCESS_TOKEN> [--base http://127.0.0.1:55667/api2] [--outdir data/manager-export]

Notes:
  - The API cannot produce the Trial Balance (it's a computed report) — export
    that separately from Manager's UI if you want the chart-of-accounts / balance
    sheet to match.
  - Requires Manager Desktop running with the business open (the token is
    per-business). Nothing here touches production.
"""
from __future__ import annotations
import argparse, json, os, sys, time, zipfile, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

DEFAULT_BASE = "http://127.0.0.1:55667/api2"

# List endpoints to pull (header/summary rows). Their per-record detail is pulled
# via <entity-singular>-form/{key}. Empty entities are skipped automatically.
LIST_ENTITIES = [
    "divisions", "tax-codes", "chart-of-accounts", "bank-and-cash-accounts",
    "capital-accounts", "non-inventory-items", "folders", "customers", "suppliers",
    "sales-quotes", "sales-orders", "delivery-notes", "sales-invoices", "credit-notes",
    "purchase-invoices", "debit-notes", "receipts", "payments",
    "inter-account-transfers", "withholding-tax-receipts", "journal-entries",
    # Custom-field DEFINITIONS (name/placement per guid). Needed so the importer
    # can resolve which per-document CustomFields guid holds the PO number, etc.
    "classic-custom-fields",
]
# entity -> its detail (-form) endpoint. Only these get a per-record detail pull.
DETAIL_FORM = {
    "customers": "customer-form", "suppliers": "supplier-form",
    "sales-quotes": "sales-quote-form", "sales-orders": "sales-order-form",
    "delivery-notes": "delivery-note-form", "sales-invoices": "sales-invoice-form",
    "credit-notes": "credit-note-form", "purchase-invoices": "purchase-invoice-form",
    "debit-notes": "debit-note-form", "receipts": "receipt-form", "payments": "payment-form",
    "inter-account-transfers": "inter-account-transfer-form",
    "withholding-tax-receipts": "withholding-tax-receipt-form", "journal-entries": "journal-entry-form",
}


def main(argv):
    # Windows consoles default to cp1252 and choke on non-ASCII (business names,
    # arrows). Force UTF-8 output so progress/summary lines never crash the run.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    ap = argparse.ArgumentParser(description="Export a Manager.io business to an upload-ready zip.")
    ap.add_argument("--key", required=True, help="Manager Access Token (X-API-KEY)")
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--outdir", default="data/manager-export")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args(argv)
    base, key = args.base.rstrip("/"), args.key

    def get(path, tries=4):
        last = None
        for t in range(tries):
            try:
                req = urllib.request.Request(f"{base}/{path}")
                req.add_header("X-API-KEY", key)
                with urllib.request.urlopen(req, timeout=60) as r:
                    return json.loads(r.read())
            except Exception as e:  # noqa
                last = e; time.sleep(0.25 * (t + 1))
        raise last

    def rows(payload):
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict):
            lists = [v for k, v in payload.items() if isinstance(v, list)]
            return max(lists, key=len) if lists else []
        return []

    # business name (for the zip filename)
    try:
        biz = get("divisions?pageSize=1").get("business", {}).get("name") or "manager-export"
    except urllib.error.HTTPError as e:
        print(f"AUTH/CONNECT failed ({e.code}). Is Manager Desktop open with the business + a valid token?", file=sys.stderr)
        return 1
    safe_biz = "".join(c if c.isalnum() or c in " -_" else "_" for c in biz).strip() or "manager-export"

    outdir = os.path.abspath(args.outdir)
    detaildir = os.path.join(outdir, "detail")
    os.makedirs(detaildir, exist_ok=True)
    print(f"business: {biz}\noutput:   {outdir}")

    def page_all(entity):
        out, skip = [], 0
        while True:
            chunk = rows(get(f"{entity}?skip={skip}&pageSize=1000"))
            out.extend(chunk)
            if len(chunk) < 1000:
                break
            skip += 1000
            time.sleep(0.1)
        return out

    # 1) summary lists
    summary = {}
    for e in LIST_ENTITIES:
        try:
            summary[e] = page_all(e)
        except urllib.error.HTTPError as ex:
            print(f"  {e}: HTTP {ex.code} (skipped)"); summary[e] = []
        json.dump(summary[e], open(os.path.join(outdir, e + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"  list {e:26} {len(summary[e])}")

    # 2) per-record detail (parallel), for entities that have a -form endpoint
    for e, form in DETAIL_FORM.items():
        keys = [r["key"] for r in summary.get(e, []) if isinstance(r, dict) and r.get("key")]
        if not keys:
            json.dump([], open(os.path.join(detaildir, e + ".json"), "w", encoding="utf-8")); continue
        results, done, t0 = {}, 0, time.time()
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = {ex.submit(get, f"{form}/{k}"): k for k in keys}
            for fut in as_completed(futs):
                results[futs[fut]] = fut.result(); done += 1
                if done % 500 == 0:
                    print(f"    detail {e}: {done}/{len(keys)} ({done/max(0.1,time.time()-t0):.0f}/s)")
        ordered = [results[k] for k in keys if k in results]
        json.dump(ordered, open(os.path.join(detaildir, e + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"  detail {e:26} {len(ordered)}")

    # 3) zip it up (upload-ready)
    zpath = os.path.join(outdir, safe_biz + ".zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(outdir):
            for f in files:
                if f.endswith(".json"):
                    full = os.path.join(root, f)
                    z.write(full, os.path.relpath(full, outdir))
    print(f"\nDONE -> upload this on the MyApp 'Manager.io Import' page:\n  {zpath}")
    print("  (optionally also export Reports → Trial Balance → Copy to clipboard → save as .txt for the chart of accounts)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

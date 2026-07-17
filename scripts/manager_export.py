"""
Manager.io → MyApp export (ONE command).

Runs on the machine where Manager Desktop is open, with the target business
loaded and an Access Token minted (Settings → Access Tokens). Pulls everything
the MyApp "Manager.io Import" page needs and writes a single upload-ready .zip:

    <outdir>/<business>.zip   (contains {entity}.json + detail/{entity}.json +
                               perpetual/ reference data for the Full-GL import)

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
    ap.add_argument("--no-perpetual", action="store_true",
                    help="Skip the perpetual-GL reference data (starting balances + resolved "
                         "tax codes / non-inventory items). Without it the zip supports only "
                         "the snapshot import, not the 'Full General Ledger' option.")
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
    detail_data = {}   # entity -> [detail objects]  (kept for the perpetual ref pull)
    for e, form in DETAIL_FORM.items():
        keys = [r["key"] for r in summary.get(e, []) if isinstance(r, dict) and r.get("key")]
        if not keys:
            json.dump([], open(os.path.join(detaildir, e + ".json"), "w", encoding="utf-8")); detail_data[e] = []; continue
        results, done, t0 = {}, 0, time.time()
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = {ex.submit(get, f"{form}/{k}"): k for k in keys}
            for fut in as_completed(futs):
                results[futs[fut]] = fut.result(); done += 1
                if done % 500 == 0:
                    print(f"    detail {e}: {done}/{len(keys)} ({done/max(0.1,time.time()-t0):.0f}/s)")
        ordered = [results[k] for k in keys if k in results]
        json.dump(ordered, open(os.path.join(detaildir, e + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        detail_data[e] = ordered
        print(f"  detail {e:26} {len(ordered)}")

    # 2.5) perpetual-GL reference data → perpetual/  (makes the zip full-GL-ready,
    #      so the Import page's "Full General Ledger" option can match Manager with
    #      GL posting enabled). Small: starting balances + the tax codes / non-inv
    #      items actually used in the documents, resolved to their rate + accounts.
    #      Skip with --no-perpetual. See MANAGER_IO_MIGRATION_GUIDE.md §11.
    if not args.no_perpetual:
        perpdir = os.path.join(outdir, "perpetual")
        os.makedirs(perpdir, exist_ok=True)
        def savep(name, obj):
            json.dump(obj, open(os.path.join(perpdir, name + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        # chart of accounts — copy the summary list so the ref folder is self-contained
        savep("chart-of-accounts", summary.get("chart-of-accounts", []))
        # starting balances (bank/cash + balance-sheet)
        for name, ep in (("bank-starting-balances", "bank-or-cash-account-starting-balance-list"),
                         ("bs-starting-balances", "balance-sheet-account-starting-balance-list")):
            try:
                savep(name, rows(get(f"{ep}?pageSize=1000")))
            except Exception as ex:  # noqa
                savep(name, []); print(f"  perpetual {name}: failed ({ex})")
        # resolve tax codes + non-inventory items USED on document lines
        tax_guids, item_guids = set(), set()
        for e in ("sales-invoices", "purchase-invoices", "credit-notes", "debit-notes"):
            for doc in detail_data.get(e, []):
                for ln in (doc.get("Lines", []) if isinstance(doc, dict) else []):
                    if ln.get("TaxCode"): tax_guids.add(ln["TaxCode"])
                    if ln.get("Item"): item_guids.add(ln["Item"])
        tax = {}
        for g in tax_guids:
            try:
                f = get(f"tax-code-form/{g}")
                tax[g] = {"name": f.get("Name"), "rate": f.get("Rate"), "account": f.get("Account")}
            except Exception:  # noqa
                pass
        ni = {}
        for g in item_guids:
            try:
                f = get(f"non-inventory-item-form/{g}")
                ni[g] = {"name": f.get("ItemName") or f.get("Name"), "sale": f.get("SaleItemAccount"), "purchase": f.get("PurchaseItemAccount")}
            except Exception:  # noqa
                pass
        savep("taxcodes-resolved", tax)
        savep("noninv-resolved", ni)
        print(f"  perpetual ref: {len(tax)} tax code(s), {len(ni)} non-inv item(s), starting balances")

    # 2.5) document attachments (best-effort). Manager stores attachments as
    #      objects; the exact form fields aren't in the OpenAPI, so extraction is
    #      DEFENSIVE and dumps a raw sample (_attachment-form-sample.json) for
    #      verifying/adjusting the field names against a real attachment-bearing
    #      business. Writes blobs to attachments/ + an attachments.json manifest
    #      [{ownerType, ownerKey, fileName, contentType, file}] that the MyApp
    #      importer files onto the matching document. No-op when there are none
    #      (Al-Qahera had zero — the per-doc 'attachment' flag was false for all).
    import base64
    owner_type_by_key = {}
    for e in ("sales-quotes", "sales-orders", "delivery-notes", "sales-invoices", "purchase-invoices"):
        for r in summary.get(e, []):
            if isinstance(r, dict) and r.get("key"):
                owner_type_by_key[r["key"]] = e
    try:
        att_list = page_all("attachments")
    except Exception as ex:  # noqa
        att_list = []; print(f"  attachments: list failed ({ex})")
    manifest = []
    if att_list:
        attdir = os.path.join(outdir, "attachments")
        os.makedirs(attdir, exist_ok=True)
        made = skipped = 0
        dumped = False

        def pick(d, *names):
            for n in names:
                if isinstance(d, dict) and d.get(n) not in (None, ""):
                    return d.get(n)
            return None

        for a in att_list:
            akey = a.get("key") if isinstance(a, dict) else None
            if not akey:
                skipped += 1; continue
            try:
                form = get(f"attachment-form/{akey}")
            except Exception:  # noqa
                skipped += 1; continue
            if not dumped:  # keep ONE raw sample to verify the field mapping below
                json.dump(form, open(os.path.join(outdir, "_attachment-form-sample.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
                dumped = True
            owner = pick(form, "Owner", "OwnerKey", "Object", "Document", "Parent", "Reference")
            fname = pick(form, "FileName", "Name", "fileName") or str(akey)
            ctype = pick(form, "ContentType", "MimeType", "contentType") or "application/octet-stream"
            b64 = pick(form, "Content", "Data", "FileContent", "Bytes", "content")
            otype = owner_type_by_key.get(owner) if isinstance(owner, str) else None
            if not otype or not b64:
                skipped += 1; continue
            try:
                raw = base64.b64decode(b64)
            except Exception:  # noqa
                skipped += 1; continue
            ext = os.path.splitext(fname)[1] or ""
            blobname = f"{akey}{ext}"
            with open(os.path.join(attdir, blobname), "wb") as fh:
                fh.write(raw)
            manifest.append({"ownerType": otype, "ownerKey": owner, "fileName": fname, "contentType": ctype, "file": blobname})
            made += 1
        json.dump(manifest, open(os.path.join(outdir, "attachments.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"  attachments: {made} filed, {skipped} skipped ({len(att_list)} listed)")
        if made == 0:
            print("    NOTE: attachments listed but none extracted — inspect outdir/_attachment-form-sample.json and adjust the owner/fileName/content field names in manager_export.py.")

    # 3) zip it up (upload-ready): all *.json (incl the attachments manifest) + the
    #    attachment blob files under attachments/. Skips the debug sample + any zip.
    zpath = os.path.join(outdir, safe_biz + ".zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(outdir):
            for f in files:
                full = os.path.join(root, f)
                rel = os.path.relpath(full, outdir).replace("\\", "/")
                if f == "_attachment-form-sample.json" or f.endswith(".zip"):
                    continue
                if f.endswith(".json") or rel.startswith("attachments/"):
                    z.write(full, rel)
    print(f"\nDONE -> upload this on the MyApp 'Manager.io Import' page:\n  {zpath}")
    print("  (optionally also export Reports → Trial Balance → Copy to clipboard → save as .txt for the chart of accounts)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

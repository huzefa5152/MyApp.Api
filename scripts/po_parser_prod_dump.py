#!/usr/bin/env python3
"""
Production PO-import FULL DUMP — real uploaded PDFs, read-only against prod.

Extends scripts/po_parser_prod_regression.py. The regression script only
compares ITEM COUNTS (prod archive stores a count, not the items), so it can
flag dropped/extra items but NOT "same count, wrong description/quantity".

This script downloads every archived PO PDF from PRODUCTION (read-only) and
re-parses each against one or two LOCAL backends, dumping the FULL per-item
output (description + quantity + unit + matched format) so wrong-desc / wrong-qty
can be reviewed by eye and diffed programmatically:

  --local  http://localhost:5134   the NEW parser (master, column-primary)   [required]
  --old    http://localhost:5135   the OLD parser (prod-current, adjacency)   [optional]

When --old is given, every PDF is parsed against both and the per-item diff is
recorded, so you can see exactly which historical imports the new commit FIXED
and which it REGRESSED.

Outputs (to --outdir, default scripts/_prod_dump_out):
  pdfs/<id>.pdf            cached original PDFs (downloaded once)
  dump.json               machine-readable: every archive + new (+old) items + diff
  report.txt              human-readable, grouped by matched format

SAFETY
  PROD is strictly read-only: exactly one POST (/auth/login) + GETs
  (/poimport/archives, /poimport/archives/{id}/file). All re-parsing happens on
  the LOCAL backend(s). Point local at the prod-replica db46684 so format
  matching behaves like production.

USAGE
  set PROD_USER / PROD_PASS  (production read-only credentials)
  set LOCAL_USER / LOCAL_PASS  (defaults admin/admin123)
  python scripts/po_parser_prod_dump.py \
      --prod https://hakimitraders.runasp.net \
      --local http://localhost:5134 [--old http://localhost:5135] \
      --outcome ok,no-format
"""
import argparse, os, sys, json, time, urllib.request, urllib.parse, urllib.error, ssl

def _req(method, url, headers=None, data=None, is_json=True, timeout=90):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            body = r.read()
            return r.status, (json.loads(body) if is_json and body else body)
    except urllib.error.HTTPError as e:
        return e.code, (e.read() or b"")

def login(base, user, pw):
    payload = json.dumps({"username": user, "password": pw}).encode()
    st, body = _req("POST", f"{base}/api/auth/login", {"Content-Type": "application/json"}, payload)
    if st != 200:
        raise SystemExit(f"[setup] login to {base} failed ({st}). Check credentials / that it is running.")
    return body["token"]

def list_archives(base, token, outcome, limit):
    rows, page, page_size = [], 1, 200
    while len(rows) < limit:
        q = urllib.parse.urlencode({"outcome": outcome, "page": page, "pageSize": page_size} if outcome
                                   else {"page": page, "pageSize": page_size})
        st, body = _req("GET", f"{base}/api/poimport/archives?{q}", {"Authorization": f"Bearer {token}"})
        if st != 200:
            raise SystemExit(f"[setup] listing archives failed ({st}).")
        batch = body.get("rows", [])
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        page += 1
    return rows[:limit]

def download_pdf(base, token, archive_id, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    st, body = _req("GET", f"{base}/api/poimport/archives/{archive_id}/file",
                    {"Authorization": f"Bearer {token}"}, is_json=False)
    if st != 200 or not body:
        return None
    with open(dest, "wb") as f:
        f.write(body)
    return dest

def local_parse(base, token, pdf_path, company_id, filename):
    """LOCAL write only — re-parse the PDF with the local backend's parser."""
    boundary = "----poDumpBoundary7f3a"
    with open(pdf_path, "rb") as f:
        pdf = f.read()
    parts = [
        (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
         f"filename=\"{filename or 'po.pdf'}\"\r\nContent-Type: application/pdf\r\n\r\n").encode(),
        pdf,
        f"\r\n--{boundary}--\r\n".encode(),
    ]
    data = b"".join(parts)
    q = f"?companyId={company_id}" if company_id else ""
    # parse-pdf is rate-limited (import policy: 10 req / 1-min fixed window,
    # QueueLimit 0). On 429 the FixedWindow resets on the next clock-minute, so
    # wait out the window and retry — otherwise a bulk run miscounts throttled
    # requests as no-format misses.
    st, body = None, None
    for attempt in range(8):
        st, body = _req("POST", f"{base}/api/poimport/parse-pdf{q}",
                        {"Authorization": f"Bearer {token}",
                         "Content-Type": f"multipart/form-data; boundary={boundary}"}, data, timeout=120)
        if st != 429:
            break
        time.sleep(12)
    if st == 200 and isinstance(body, dict):
        items = [{"description": (it.get("description") or "").strip(),
                  "quantity": it.get("quantity"),
                  "unit": it.get("unit")} for it in (body.get("items") or [])]
        return {"status": st,
                "matchedFormatId": body.get("matchedFormatId"),
                "matchedFormatName": body.get("matchedFormatName"),
                "poNumber": body.get("poNumber"),
                "items": items}
    reason = None
    if isinstance(body, dict):
        reason = body.get("reason")
    elif isinstance(body, (bytes, bytearray)):
        try:
            reason = json.loads(body).get("reason")
        except Exception:
            reason = None
    if st == 429:
        reason = "RATE-LIMITED (retries exhausted — result unreliable)"
    return {"status": st, "matchedFormatId": None, "matchedFormatName": None,
            "poNumber": None, "items": [], "miss": True, "reason": reason}

def items_equal(a, b):
    """Item lists equal when same length AND each desc (case/space-normalised) +
    quantity match in order."""
    if len(a) != len(b):
        return False
    for x, y in zip(a, b):
        dx = " ".join((x["description"] or "").lower().split())
        dy = " ".join((y["description"] or "").lower().split())
        if dx != dy:
            return False
        if str(x["quantity"]) != str(y["quantity"]):
            return False
    return True

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prod", default=os.environ.get("PROD_URL", "https://hakimitraders.runasp.net"))
    ap.add_argument("--local", default=os.environ.get("LOCAL_URL", "http://localhost:5134"))
    ap.add_argument("--old", default=os.environ.get("OLD_URL"), help="optional second backend (prod-current parser)")
    ap.add_argument("--outcome", default="ok,no-format", help="comma list of prod ParseOutcomes to pull")
    ap.add_argument("--limit", type=int, default=1000)
    ap.add_argument("--delay", type=float, default=6.5, help="seconds between PDFs (rate-limit pacing)")
    ap.add_argument("--outdir", default=os.path.join(os.path.dirname(__file__), "_prod_dump_out"))
    args = ap.parse_args()

    prod_user, prod_pass = os.environ.get("PROD_USER"), os.environ.get("PROD_PASS")
    if not prod_user or not prod_pass:
        raise SystemExit("[setup] set PROD_USER and PROD_PASS (production read-only credentials).")
    local_user = os.environ.get("LOCAL_USER", "admin")
    local_pass = os.environ.get("LOCAL_PASS", "admin123")

    outdir = args.outdir
    pdfdir = os.path.join(outdir, "pdfs")
    os.makedirs(pdfdir, exist_ok=True)

    print(f"PROD  (read-only): {args.prod}")
    print(f"LOCAL new        : {args.local}")
    if args.old:
        print(f"LOCAL old        : {args.old}")
    prod_token = login(args.prod, prod_user, prod_pass)
    new_token = login(args.local, local_user, local_pass)
    old_token = login(args.old, local_user, local_pass) if args.old else None

    archives = []
    for oc in [o.strip() for o in args.outcome.split(",") if o.strip()]:
        got = list_archives(args.prod, prod_token, oc, args.limit)
        print(f"  outcome '{oc}': {len(got)} archive(s)")
        archives.extend(got)
    # sort by id ascending for stable reporting
    archives.sort(key=lambda a: a["id"])
    print(f"Total baseline: {len(archives)} archived import(s).\n")

    results = []
    for a in archives:
        aid = a["id"]
        fn = a.get("originalFileName") or f"{aid}.pdf"
        comp = a.get("companyId")
        prod_items = a.get("itemsExtracted") or 0
        prod_outcome = a.get("parseOutcome")
        pdf = download_pdf(args.prod, prod_token, aid, os.path.join(pdfdir, f"{aid}.pdf"))
        if not pdf:
            results.append({"id": aid, "file": fn, "companyId": comp, "prodOutcome": prod_outcome,
                            "prodItems": prod_items, "skipped": "no-file"})
            print(f"  #{aid:>4} {fn[:48]:48}  SKIPPED (file missing on prod disk)")
            continue
        # Pace the loop so each backend stays under the import rate limit
        # (10 req / 1-min fixed window). ~6.5s/iteration => ~9 req/min/backend.
        if results and args.delay > 0:
            time.sleep(args.delay)
        new = local_parse(args.local, new_token, pdf, comp, fn)
        rec = {"id": aid, "file": fn, "companyId": comp, "prodOutcome": prod_outcome,
               "prodItems": prod_items, "new": new}
        line = (f"  #{aid:>4} c{comp} {fn[:42]:42} "
                f"fmt={str(new.get('matchedFormatName'))[:16]:16} "
                f"prod={prod_items:>3} new={len(new['items']):>3}")
        if args.old:
            old = local_parse(args.old, old_token, pdf, comp, fn)
            rec["old"] = old
            same = items_equal(new["items"], old["items"])
            rec["changed"] = not same
            line += f" old={len(old['items']):>3} {'SAME' if same else 'CHANGED'}"
        results.append(rec)
        print(line)

    dump_path = os.path.join(outdir, "dump.json")
    with open(dump_path, "w", encoding="utf-8") as f:
        json.dump({"prod": args.prod, "local": args.local, "old": args.old, "results": results}, f, indent=2, ensure_ascii=False)

    # human-readable report grouped by matched format
    report_path = os.path.join(outdir, "report.txt")
    by_fmt = {}
    for r in results:
        if r.get("skipped"):
            by_fmt.setdefault("(file-missing)", []).append(r)
            continue
        fmt = r["new"].get("matchedFormatName") or (f"(no-format:{r['new'].get('reason')})" if r["new"].get("miss") else "(unknown)")
        by_fmt.setdefault(fmt, []).append(r)

    with open(report_path, "w", encoding="utf-8") as f:
        f.write(f"PO PARSER PRODUCTION DUMP\nprod={args.prod}\nnew={args.local}\nold={args.old}\n")
        f.write(f"archives={len(results)}\n\n")
        for fmt in sorted(by_fmt):
            rows = by_fmt[fmt]
            f.write("=" * 100 + "\n")
            f.write(f"FORMAT: {fmt}   ({len(rows)} PDF(s))\n")
            f.write("=" * 100 + "\n")
            for r in rows:
                if r.get("skipped"):
                    f.write(f"\n  #{r['id']} {r['file']}  SKIPPED: {r['skipped']}\n")
                    continue
                new = r["new"]
                changed = r.get("changed")
                tag = ""
                if "old" in r:
                    tag = "  [CHANGED vs old]" if changed else "  [same as old]"
                f.write(f"\n  #{r['id']}  company={r['companyId']}  {r['file']}\n")
                f.write(f"    prodItems={r['prodItems']}  newItems={len(new['items'])}"
                        + (f"  oldItems={len(r['old']['items'])}" if 'old' in r else "")
                        + tag + "\n")
                f.write(f"    NEW items ({len(new['items'])}):\n")
                for it in new["items"]:
                    f.write(f"       q={str(it['quantity']):>8}  u={str(it['unit'] or ''):<6}  {it['description']}\n")
                if "old" in r and changed:
                    old = r["old"]
                    f.write(f"    OLD items ({len(old['items'])}):\n")
                    for it in old["items"]:
                        f.write(f"       q={str(it['quantity']):>8}  u={str(it['unit'] or ''):<6}  {it['description']}\n")
            f.write("\n")

    # summary
    print("\n" + "=" * 70)
    print("SUMMARY by matched format:")
    for fmt in sorted(by_fmt):
        rows = by_fmt[fmt]
        changed = sum(1 for r in rows if r.get("changed"))
        print(f"  {fmt:28} {len(rows):>3} PDF(s)" + (f"   changed-vs-old={changed}" if args.old else ""))
    print(f"\nWrote:\n  {dump_path}\n  {report_path}\n  {pdfdir}/*.pdf")
    return 0

if __name__ == "__main__":
    sys.exit(main())

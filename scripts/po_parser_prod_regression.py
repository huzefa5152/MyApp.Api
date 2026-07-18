#!/usr/bin/env python3
"""
Production PO-import regression check — real uploaded PDFs, read-only against prod.

WHAT IT DOES
  Every PO PDF an operator ever imported is archived (PoImportArchives) with the
  outcome production recorded at the time (matched format + item count). This
  script:
    1. Logs into PRODUCTION read-only (one POST /auth/login, then only GETs) and
       lists those archives + downloads each original PDF.
    2. Re-parses every PDF against a LOCAL backend running the CURRENT parser
       (POST /poimport/parse-pdf — a local write only; prod is never mutated).
    3. Compares the current parser's extraction to what production recorded and
       flags REGRESSIONS: a PDF that used to import (outcome "ok") but now
       matches no format, or now extracts FEWER line items than before.

  This is the "run it on master against real production PDFs" gate: any change to
  the parser or import logic must keep this clean (0 regressions) in addition to
  the offline corpus harness (scripts/po_parser_harness).

SAFETY
  * PROD is strictly read-only: exactly one POST (/auth/login) + GETs
    (/poimport/archives, /poimport/archives/{id}/file). Never parse/create/update
    against prod. (See the production-readonly rule in CLAUDE.md / team memory.)
  * The LOCAL backend does the re-parsing. Point it at a database that has the
    SAME PO formats as prod (e.g. the prod-replica db46684) so format matching
    behaves like production.

USAGE
  set PROD_USER / PROD_PASS  (production credentials — read-only account is ideal)
  set LOCAL_USER / LOCAL_PASS  (defaults admin/admin123)
  python scripts/po_parser_prod_regression.py \
      --prod https://hakimitraders.runasp.net \
      --local http://localhost:5134 \
      --outcome ok --limit 500

  Exit code 0 = no regressions; 1 = one or more regressions; 2 = setup error.
"""
import argparse, os, sys, json, tempfile, urllib.request, urllib.parse, urllib.error, ssl

def _req(method, url, headers=None, data=None, is_json=True, timeout=60):
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
        raise SystemExit(f"[setup] login to {base} failed ({st}). Check credentials.")
    return body["token"]

def list_archives(base, token, outcome, limit):
    """Read-only: page through /poimport/archives."""
    rows, page, page_size = [], 1, 200
    while len(rows) < limit:
        q = urllib.parse.urlencode({"outcome": outcome, "page": page, "pageSize": page_size} if outcome
                                   else {"page": page, "pageSize": page_size})
        st, body = _req("GET", f"{base}/api/poimport/archives?{q}",
                        {"Authorization": f"Bearer {token}"})
        if st != 200:
            raise SystemExit(f"[setup] listing archives failed ({st}). "
                             f"The account needs the 'poformats.import.viewArchive' permission.")
        batch = body.get("rows", [])
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        page += 1
    return rows[:limit]

def download_pdf(base, token, archive_id, dest):
    st, body = _req("GET", f"{base}/api/poimport/archives/{archive_id}/file",
                    {"Authorization": f"Bearer {token}"}, is_json=False)
    if st != 200:
        return None
    with open(dest, "wb") as f:
        f.write(body)
    return dest

def local_parse(base, token, pdf_path, company_id, filename):
    """LOCAL write only — re-parse the PDF with the current parser."""
    boundary = "----poRegBoundary7f3a"
    with open(pdf_path, "rb") as f:
        pdf = f.read()
    parts = []
    parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
                 f"filename=\"{filename or 'po.pdf'}\"\r\nContent-Type: application/pdf\r\n\r\n".encode())
    parts.append(pdf)
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    data = b"".join(parts)
    q = f"?companyId={company_id}" if company_id else ""
    st, body = _req("POST", f"{base}/api/poimport/parse-pdf{q}",
                    {"Authorization": f"Bearer {token}",
                     "Content-Type": f"multipart/form-data; boundary={boundary}"}, data, timeout=90)
    # 200 = parsed; 422 = miss (no-format / rules-empty / unreadable)
    if st == 200 and isinstance(body, dict):
        return {"matched": body.get("matchedFormatId"), "items": len(body.get("items") or [])}
    return {"matched": None, "items": 0, "miss": True}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prod", default=os.environ.get("PROD_URL", "https://hakimitraders.runasp.net"))
    ap.add_argument("--local", default=os.environ.get("LOCAL_URL", "http://localhost:5134"))
    ap.add_argument("--outcome", default="ok", help="prod ParseOutcome baseline to check (default: ok)")
    ap.add_argument("--limit", type=int, default=500)
    args = ap.parse_args()

    prod_user, prod_pass = os.environ.get("PROD_USER"), os.environ.get("PROD_PASS")
    if not prod_user or not prod_pass:
        raise SystemExit("[setup] set PROD_USER and PROD_PASS (production read-only credentials).")
    local_user = os.environ.get("LOCAL_USER", "admin")
    local_pass = os.environ.get("LOCAL_PASS", "admin123")

    print(f"PROD  (read-only): {args.prod}")
    print(f"LOCAL (re-parse) : {args.local}")
    prod_token = login(args.prod, prod_user, prod_pass)
    local_token = login(args.local, local_user, local_pass)

    archives = list_archives(args.prod, prod_token, args.outcome, args.limit)
    print(f"Baseline: {len(archives)} archived import(s) with outcome '{args.outcome}'.\n")

    regressions, improved, unchanged, skipped = [], 0, 0, 0
    tmp = tempfile.mkdtemp(prefix="po_reg_")
    for a in archives:
        aid, fn, comp = a["id"], a.get("originalFileName") or f"{a['id']}.pdf", a.get("companyId")
        prod_items = a.get("itemsExtracted") or 0
        pdf = download_pdf(args.prod, prod_token, aid, os.path.join(tmp, f"{aid}.pdf"))
        if not pdf:
            skipped += 1
            continue
        cur = local_parse(args.local, local_token, pdf, comp, fn)
        if cur.get("miss") or cur["items"] < prod_items:
            regressions.append((aid, fn, prod_items, cur["items"], "no-format" if cur.get("miss") else "fewer-items"))
            print(f"  REGRESSION  #{aid} {fn}: prod={prod_items} now={cur['items']} ({'no format matched' if cur.get('miss') else 'fewer items'})")
        elif cur["items"] > prod_items:
            improved += 1
        else:
            unchanged += 1

    print(f"\nChecked {len(archives)}  |  unchanged {unchanged}  |  improved {improved}  "
          f"|  skipped(no file) {skipped}  |  REGRESSIONS {len(regressions)}")
    return 1 if regressions else 0

if __name__ == "__main__":
    sys.exit(main())

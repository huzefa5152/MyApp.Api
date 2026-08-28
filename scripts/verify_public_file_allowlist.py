#!/usr/bin/env python3
"""
Public file allowlist — proves what /data does and does not serve.

The app keeps user-uploaded files under data/. Only the folders a BROWSER has to
fetch with a plain <img src> are mounted publicly; everything else must be
unreachable over HTTP.

Before this check existed, the whole data/ tree was mounted and one child was
blocked, which left these readable by anyone:

  * data/po-audit/archive-{1..N}.pdf              customer POs, SEQUENTIAL names
  * data/uploads/excel-templates/company_{id}_{Type}.xlsx   branded workbooks
  * data/uploads/po_imports/**.pdf                uploaded customer POs
  * data/uploads/parser_feedback/**.pdf           POs sent as parser feedback

Run it against a running server. It discovers real files on disk rather than
guessing names, so it can't pass by testing paths that don't exist.

Usage:
  python scripts/verify_public_file_allowlist.py
  python scripts/verify_public_file_allowlist.py --base http://localhost:5134
"""
from __future__ import annotations

import argparse
import os
import sys
import urllib.error
import urllib.request

# Folders under data/ that MUST stay publicly readable, and why.
PUBLIC = {
    "uploads/logos": "company logos in print templates (<img src>)",
    "uploads/stamps": "signature/stamp images in print templates (<img src>)",
    "uploads/quoteitems": "product photos on the printed sales quote",
    "images": "avatars and the FBR logo in the app shell",
}

# Folders under data/ that must NOT be reachable over HTTP at all.
PRIVATE = {
    "po-audit": "archived customer PO documents (sequentially named)",
    "uploads/excel-templates": "the tenant's branded Excel workbooks",
    "uploads/po_imports": "uploaded customer PO documents",
    "uploads/parser_feedback": "customer POs submitted as parser feedback",
    "attachments": "tenant-isolated business documents",
}

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))


def status_of(base: str, url_path: str) -> int:
    req = urllib.request.Request(base.rstrip("/") + url_path, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            # The SPA fallback answers unmatched paths with index.html. That is a
            # miss, not a hit — only a real file body counts as "served".
            ctype = r.headers.get("Content-Type", "")
            if r.status == 200 and ctype.startswith("text/html"):
                return 404
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return -1


def first_file(root: str) -> str | None:
    """A real file under this folder, as a /data-relative URL path."""
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            rel = os.path.relpath(os.path.join(dirpath, f), root)
            return rel.replace(os.sep, "/")
    return None


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--base", default="http://localhost:5134")
    p.add_argument("--data", default="data", help="path to the runtime data/ folder")
    args = p.parse_args()

    if not os.path.isdir(args.data):
        print(f"FATAL: {args.data} not found — run from the repo root.")
        return 2

    print(f"\n=== Public folders must still serve ({args.base}) ===")
    for folder, why in PUBLIC.items():
        root = os.path.join(args.data, *folder.split("/"))
        rel = first_file(root) if os.path.isdir(root) else None
        if not rel:
            check(f"{folder}: no sample file on disk — skipped", True, why)
            print(f"  [skip] /data/{folder} (nothing to test)")
            continue
        url = f"/data/{folder}/{rel}"
        st = status_of(args.base, url)
        check(f"{folder} still served", st == 200, f"{url} -> {st}")
        print(f"  [{'ok ' if st == 200 else 'BAD'}] {url} -> {st}   ({why})")

    print("\n=== Private folders must NOT be reachable ===")
    for folder, why in PRIVATE.items():
        root = os.path.join(args.data, *folder.split("/"))
        rel = first_file(root) if os.path.isdir(root) else None
        if not rel:
            check(f"{folder}: no sample file on disk — skipped", True, why)
            print(f"  [skip] /data/{folder} (nothing to test)")
            continue
        url = f"/data/{folder}/{rel}"
        st = status_of(args.base, url)
        check(f"{folder} blocked", st != 200, f"{url} -> {st}")
        print(f"  [{'ok ' if st != 200 else 'LEAK'}] {url} -> {st}   ({why})")

    # The sequential PO archive is the one an attacker would walk, so probe the
    # counter directly rather than relying on whatever os.walk happened to find.
    print("\n=== Sequential PO archive can't be walked ===")
    walked = [n for n in range(1, 6) if status_of(args.base, f"/data/po-audit/archive-{n}.pdf") == 200]
    check("po-audit/archive-N.pdf not enumerable", not walked, f"reachable: {walked}")
    print(f"  [{'ok ' if not walked else 'LEAK'}] archive-1..5.pdf reachable: {walked or 'none'}")

    failed = [r for r in results if not r[1]]
    print(f"\n=== {len(results) - len(failed)}/{len(results)} checks passed ===")
    for name, _ok, detail in failed:
        print(f"  FAIL {name}: {detail}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())

"""
Pull base64-embedded images out of saved print templates so they can be
re-uploaded as company stamps and referenced as {{stamps.<slug>}}.

Why: before company stamps existed the only way to put a signature on a
document was to paste the image into the template HTML as a data: URI. That
makes every template enormous (a 90KB template that is 90% one signature),
duplicates the same image across every template that needs it, and means
replacing a signature is a hand-edit of raw HTML in each one.

This script is READ-ONLY against the database. It writes the extracted images
to disk and prints exactly what to change; it never modifies a template. The
conversion itself is done through the UI:

  1. run this to get the image files out
  2. Print Templates -> Stamps -> Upload Stamp (one per extracted file)
  3. open each template in the editor and replace the giant
     src="data:image/png;base64,..." with src="{{stamps.<slug>}}"
     (the editor's merge-field sidebar has a one-click insert per stamp)

Usage:
    python scripts/extract_template_stamps.py --conn "<connection string>"
    python scripts/extract_template_stamps.py --conn "..." --out ./stamps_out
"""

import argparse
import base64
import os
import re
import subprocess
import sys

# data:image/<type>;base64,<payload> inside a src="..." or src='...'
DATA_URI = re.compile(
    r"""src\s*=\s*(?P<q>["'])\s*(?P<uri>data:image/(?P<ext>[a-zA-Z0-9.+-]+);base64,(?P<b64>[A-Za-z0-9+/=\s]+?))\s*(?P=q)""",
    re.IGNORECASE,
)


def parse_conn(conn):
    def field(name):
        m = re.search(name + r"\s*=\s*([^;]+)", conn, re.I)
        return m.group(1).strip() if m else None
    return field("Server"), field("Database"), field("User Id"), field("Password")


def sqlcmd(conn, query, raw=False):
    server, db, user, pwd = parse_conn(conn)
    if not server or not db:
        raise SystemExit("could not parse Server/Database from the connection string")
    cmd = ["sqlcmd", "-S", server, "-d", db, "-N", "-C", "-I", "-Q", query]
    if user and pwd:
        cmd[1:1] = []
        cmd += ["-U", user, "-P", pwd]
    else:
        cmd += ["-E"]   # trusted connection
    if raw:
        cmd += ["-y", "0"]
    else:
        cmd += ["-s", "|", "-W"]
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit("sqlcmd failed: " + (out.stderr or out.stdout)[:500])
    return out.stdout


def slugify(name):
    """Mirror of StampsController.Slugify so the printed guidance matches the
    slug the server will actually mint on upload."""
    out, last_us = [], False
    for ch in name.strip().lower():
        if ch.isalnum() and ord(ch) < 128:
            out.append(ch)
            last_us = False
        elif not last_us:
            out.append("_")
            last_us = True
    slug = "".join(out).strip("_") or "stamp"
    if slug[0].isdigit():
        slug = "s_" + slug
    return slug[:50].strip("_")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--conn", required=True, help="SQL Server connection string (read-only use)")
    ap.add_argument("--out", default="stamps_out", help="directory for extracted images")
    args = ap.parse_args()

    rows = sqlcmd(args.conn,
                  "SET NOCOUNT ON; SELECT Id, CompanyId, TemplateType, Name FROM PrintTemplates "
                  "WHERE HtmlContent LIKE '%data:image%' ORDER BY CompanyId, Id;")

    targets = []
    for line in rows.splitlines():
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 4 or not parts[0].isdigit():
            continue
        targets.append({"id": int(parts[0]), "companyId": int(parts[1]),
                        "type": parts[2], "name": parts[3]})

    if not targets:
        print("No templates contain base64 images. Nothing to convert.")
        return

    os.makedirs(args.out, exist_ok=True)
    print("%d template(s) with embedded images\n" % len(targets))

    for t in targets:
        html = sqlcmd(args.conn,
                      "SET NOCOUNT ON; SELECT HtmlContent FROM PrintTemplates WHERE Id=%d;" % t["id"],
                      raw=True)
        matches = list(DATA_URI.finditer(html))
        print("template %d — company %d — %s — \"%s\"  (%d KB, %d embedded image(s))"
              % (t["id"], t["companyId"], t["type"], t["name"], len(html) // 1024, len(matches)))

        for i, m in enumerate(matches, 1):
            ext = m.group("ext").lower()
            if ext == "jpeg":
                ext = "jpg"
            payload = re.sub(r"\s+", "", m.group("b64"))
            try:
                blob = base64.b64decode(payload)
            except Exception as exc:
                print("    ! image %d: could not decode (%s)" % (i, exc))
                continue

            stamp_name = "%s %s" % (t["name"], "" if len(matches) == 1 else str(i))
            stamp_name = " ".join(stamp_name.split())
            fname = "company%d_tpl%d_%d.%s" % (t["companyId"], t["id"], i, ext)
            path = os.path.join(args.out, fname)
            with open(path, "wb") as fh:
                fh.write(blob)

            slug = slugify(stamp_name)
            saved = len(m.group("uri")) - len("{{stamps.%s}}" % slug)
            print("    image %d -> %s  (%d KB)" % (i, path, len(blob) // 1024))
            print("       upload it as stamp name: %r  -> expected slug {{stamps.%s}}" % (stamp_name, slug))
            print("       then replace that src=\"data:image/%s;base64,…\" with src=\"{{stamps.%s}}\""
                  % (m.group("ext"), slug))
            print("       template shrinks by ~%d KB" % (saved // 1024))
        print()

    print("Nothing was modified. Upload the files above under "
          "Print Templates -> Stamps, then edit each template to swap the data: URI "
          "for its {{stamps.<slug>}} token.")


if __name__ == "__main__":
    main()

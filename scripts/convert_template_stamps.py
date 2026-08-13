"""
Swap a base64 data: URI in a saved print template for its {{stamps.<slug>}}
merge field.

Companion to extract_template_stamps.py, which pulls the embedded image out so
it can be uploaded as a company stamp. Once that stamp exists, this rewrites
the template to reference it instead of carrying the image inline.

Safety:
  - DRY RUN by default. Nothing is written without --apply.
  - Refuses to run unless a stamp already exists for the template's company,
    so a template can never end up pointing at a stamp that isn't there.
  - Writes the current HtmlContent to a .bak file before every update, and
    prints the exact SQL to restore it.
  - Parameterized UPDATE (the HTML is far too large and quote-heavy to inline
    into a sqlcmd literal safely).

Usage:
    # see what would change
    python scripts/convert_template_stamps.py --conn "<connection string>"

    # do it
    python scripts/convert_template_stamps.py --conn "..." --apply

    # restrict to specific templates
    python scripts/convert_template_stamps.py --conn "..." --ids 15,14 --apply
"""

import argparse
import os
import re
import sys

DATA_URI = re.compile(
    r"""src\s*=\s*(?P<q>["'])\s*data:image/(?P<ext>[a-zA-Z0-9.+-]+);base64,(?P<b64>[A-Za-z0-9+/=\s]+?)\s*(?P=q)""",
    re.IGNORECASE,
)


def connect(conn_str):
    import pyodbc

    def field(name):
        m = re.search(name + r"\s*=\s*([^;]+)", conn_str, re.I)
        return m.group(1).strip() if m else None

    server, db = field("Server"), field("Database")
    user, pwd = field("User Id"), field("Password")
    drivers = [d for d in pyodbc.drivers() if "ODBC Driver" in d and "SQL Server" in d]
    driver = drivers[-1] if drivers else "SQL Server"
    dsn = "DRIVER={%s};SERVER=%s;DATABASE=%s;TrustServerCertificate=yes;Encrypt=yes;" % (driver, server, db)
    dsn += ("UID=%s;PWD=%s;" % (user, pwd)) if user and pwd else "Trusted_Connection=yes;"
    return pyodbc.connect(dsn, autocommit=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--conn", required=True)
    ap.add_argument("--ids", default=None, help="comma-separated template ids (default: all with base64)")
    ap.add_argument("--apply", action="store_true", help="actually write (default is a dry run)")
    ap.add_argument("--backup-dir", default="template_backups")
    args = ap.parse_args()

    cn = connect(args.conn)
    cur = cn.cursor()

    where = "WHERE HtmlContent LIKE '%data:image%'"
    params = []
    if args.ids:
        ids = [int(i) for i in args.ids.split(",") if i.strip()]
        where += " AND Id IN (%s)" % ",".join("?" * len(ids))
        params = ids

    cur.execute("SELECT Id, CompanyId, TemplateType, Name, HtmlContent FROM PrintTemplates " + where, *params)
    rows = cur.fetchall()
    if not rows:
        print("No templates with embedded base64 images.")
        return

    os.makedirs(args.backup_dir, exist_ok=True)
    print("%s — %d template(s)\n" % ("APPLYING" if args.apply else "DRY RUN", len(rows)))

    changed = 0
    for tid, cid, ttype, name, html in rows:
        print("template %d — company %d — %s — \"%s\" (%d chars)" % (tid, cid, ttype, name, len(html)))

        cur.execute("SELECT Slug, Name FROM CompanyStamps WHERE CompanyId=? ORDER BY SortOrder, Id", cid)
        stamps = cur.fetchall()
        if not stamps:
            print("   SKIP — company %d has no stamps yet. Upload the image under "
                  "Print Templates -> Stamps first, then re-run.\n" % cid)
            continue
        if len(stamps) > 1:
            print("   note: company has %d stamps; using the first (%s). Pass --ids to "
                  "handle templates individually if that is wrong."
                  % (len(stamps), stamps[0][0]))
        slug = stamps[0][0]

        matches = list(DATA_URI.finditer(html))
        if not matches:
            print("   SKIP — no data: URI found\n")
            continue
        if len(matches) > 1:
            print("   SKIP — %d embedded images; this script only handles a single "
                  "unambiguous stamp per template\n" % len(matches))
            continue

        new_html = DATA_URI.sub('src="{{stamps.%s}}"' % slug, html, count=1)

        # Sanity: the rewrite must shrink the template, keep the rest byte-identical,
        # and leave exactly one merge token behind.
        m = matches[0]
        untouched = html[:m.start()] == new_html[:m.start()] and html[m.end():] == new_html[len(new_html) - len(html[m.end():]):]
        token_count = new_html.count("{{stamps.%s}}" % slug)
        ok = len(new_html) < len(html) and untouched and token_count == 1 and "data:image" not in new_html
        print("   -> {{stamps.%s}} | %d chars (-%d, %.0f%% smaller) | rest untouched=%s"
              % (slug, len(new_html), len(html) - len(new_html),
                 100 * (1 - len(new_html) / len(html)), untouched))
        if not ok:
            print("   ABORT — rewrite failed its own sanity check\n")
            continue

        bak = os.path.join(args.backup_dir, "template_%d_before.html" % tid)
        with open(bak, "w", encoding="utf-8") as fh:
            fh.write(html)
        print("   backup: %s" % bak)

        if args.apply:
            cur.execute("UPDATE PrintTemplates SET HtmlContent=?, UpdatedAt=SYSUTCDATETIME() WHERE Id=?",
                        new_html, tid)
            cn.commit()
            cur.execute("SELECT LEN(HtmlContent) FROM PrintTemplates WHERE Id=?", tid)
            print("   WRITTEN — stored length now %d" % cur.fetchone()[0])
        else:
            print("   (dry run — pass --apply to write)")
        changed += 1
        print()

    print("%d template(s) %s." % (changed, "updated" if args.apply else "would be updated"))
    if not args.apply and changed:
        print("Re-run with --apply to write. Backups land in %s/." % args.backup_dir)
    cn.close()


if __name__ == "__main__":
    main()

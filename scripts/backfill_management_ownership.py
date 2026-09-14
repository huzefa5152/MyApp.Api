"""Set CreatedByUserId on existing Users and Companies, by NAME, one pair at a
time -- the backfill for AddManagementOwnership.

    # see what it would do, against the local branch database
    python scripts/backfill_management_ownership.py \
        --user demo.admin=admin --company "Nova Industrial Supplies (Pvt.) Ltd.=demo.admin"

    # do it
    python scripts/backfill_management_ownership.py --apply --user demo.admin=admin

    # print the SQL for a database this script may not touch (production)
    python scripts/backfill_management_ownership.py --sql-only --user taha=admin

WHY THIS IS NOT AUTOMATIC
-------------------------
The migration deliberately leaves every existing row NULL. NULL means
"root-level, managed by the seed admin only", which is the safe reading of an
account whose creator nobody recorded -- and on a small installation it is also
the CORRECT reading. Guessing a parent to make a migration look tidy would
invent an ownership chain that then silently governs who can see whose data.

So ownership is stated here explicitly, by name, and the script refuses
anything it cannot resolve to exactly one row.

PRODUCTION
----------
Production databases are READ-ONLY (CLAUDE.md). This script will not connect to
one: --apply is refused unless the server is local. Use --sql-only and run the
statements yourself, after checking them.
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def local_connection():
    """The branch's own database, resolved the way the app resolves it."""
    path = os.path.join(HERE, "local.databases.json")
    head = os.path.join(HERE, ".git", "HEAD")
    branch = ""
    if os.path.exists(head):
        with open(head) as fh:
            m = re.search(r"refs/heads/(.+)", fh.read().strip())
            branch = m.group(1) if m else ""
    with open(path) as fh:
        cfg = json.load(fh)
    # local.databases.json is { server, branches: { <branch>: "<dbname>" } }.
    server = cfg.get("server") or r".\MSSQLSERVER02"
    entry = (cfg.get("branches") or {}).get(branch)
    if isinstance(entry, dict):
        return entry.get("server", server), entry.get("database")
    if isinstance(entry, str):
        return server, entry
    return None, None


def sqlcmd(server, database, query, apply_it):
    if not apply_it:
        return None
    r = subprocess.run(["sqlcmd", "-S", server, "-d", database, "-E", "-I",
                        "-h", "-1", "-W", "-s", "|", "-Q", query],
                       capture_output=True, text=True, timeout=180)
    return (r.stdout or r.stderr).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", action="append", default=[],
                    metavar="USERNAME=PARENT_USERNAME",
                    help="Set a user's creator. Repeatable.")
    ap.add_argument("--company", action="append", default=[],
                    metavar="COMPANY_NAME=OWNER_USERNAME",
                    help="Set a company's creator. Repeatable.")
    ap.add_argument("--server")
    ap.add_argument("--database")
    ap.add_argument("--apply", action="store_true", help="Actually write (local server only).")
    ap.add_argument("--sql-only", action="store_true", help="Print SQL and exit.")
    a = ap.parse_args()

    if not a.user and not a.company:
        sys.exit("Nothing to do. Pass --user and/or --company.")

    statements = []
    for pair in a.user:
        if "=" not in pair:
            sys.exit(f"--user expects USERNAME=PARENT_USERNAME, got {pair!r}")
        child, parent = (x.strip() for x in pair.split("=", 1))
        statements.append(
            "UPDATE u SET u.CreatedByUserId = p.Id "
            "FROM Users u CROSS JOIN Users p "
            f"WHERE u.Username = '{child.replace(chr(39), chr(39) * 2)}' "
            f"AND p.Username = '{parent.replace(chr(39), chr(39) * 2)}';")
    for pair in a.company:
        if "=" not in pair:
            sys.exit(f"--company expects COMPANY_NAME=OWNER_USERNAME, got {pair!r}")
        company, owner = (x.strip() for x in pair.split("=", 1))
        statements.append(
            "UPDATE c SET c.CreatedByUserId = p.Id "
            "FROM Companies c CROSS JOIN Users p "
            f"WHERE c.Name = '{company.replace(chr(39), chr(39) * 2)}' "
            f"AND p.Username = '{owner.replace(chr(39), chr(39) * 2)}';")

    print("-- Backfill for AddManagementOwnership")
    print("-- Each statement is a no-op unless BOTH names resolve, so a typo")
    print("-- changes nothing rather than assigning the wrong parent.")
    for st in statements:
        print(st)

    if a.sql_only:
        return

    server, database = a.server, a.database
    if not server or not database:
        server, database = local_connection()
    if not server or not database:
        sys.exit("\nCould not resolve the local database; pass --server and --database.")
    print(f"\nTarget: {server} / {database}")

    if not a.apply:
        print("Dry run. Re-run with --apply to write.")
        return

    is_local = server.startswith(".") or "localhost" in server.lower() or server.startswith("(local")
    if not is_local:
        sys.exit("Refusing to write to a non-local server. Production is read-only "
                 "(CLAUDE.md) -- use --sql-only and run the statements yourself.")

    out = sqlcmd(server, database, " ".join(statements), True)
    print(out or "(no output)")

    check = sqlcmd(server, database,
                   "SET NOCOUNT ON; SELECT 'USER', Id, Username, "
                   "ISNULL(CAST(CreatedByUserId AS varchar),'NULL') FROM Users ORDER BY Id;"
                   "SELECT 'COMPANY', Id, LEFT(Name,38), "
                   "ISNULL(CAST(CreatedByUserId AS varchar),'NULL') FROM Companies ORDER BY Id;",
                   True)
    print("\n-- after --")
    print(check)


if __name__ == "__main__":
    main()

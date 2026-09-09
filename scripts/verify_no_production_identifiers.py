#!/usr/bin/env python3
"""Fail if a tracked file names a production host, database, login or secret.

WHY THIS EXISTS
---------------
This repository is PUBLIC. The three production databases sit on a public host
whose subdomain IS the database name, and the SQL username is the database name
too — so writing that name into a comment, a guide or a docstring hands out two
thirds of a working credential. The same goes for the MonsterASP FTP hosts.

On 2026-09-09 that had already happened across 16 files on some branches — audit
notes, feature docs, migration comments and script docstrings, all written in
good faith by people documenting what they had just done. Scrubbing them cleans
the current tip but NOT the pushed history, so the only real fix is to never
write them down. Hence this check.

WHAT TO WRITE INSTEAD
---------------------
    <master-prod-db>  <customize-prod-db>  <importer-prod-db>
    <prod-sql-host>   <prod-ftp-host>

Real values live in the gitignored ``production.databases.json`` and in GitHub
Actions secrets. ``RESTORE FILELISTONLY`` reads the real logical names out of a
backup when one is actually in hand, so a runbook never needs to state them.

USAGE
-----
    python scripts/verify_no_production_identifiers.py

Exit code 0 = clean, 1 = something forbidden is tracked.
"""
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# ── what may never appear in a tracked file ────────────────────────────────
FORBIDDEN = [
    (
        "production database / SQL login name",
        re.compile(r"\bdb\d{5,}\b"),
        "use <master-prod-db> / <customize-prod-db> / <importer-prod-db>",
    ),
    (
        "production SQL host",
        re.compile(r"[\w.-]*\.public\.databaseasp\.net", re.I),
        "use <prod-sql-host>",
    ),
    (
        "MonsterASP FTP host",
        re.compile(r"\bsite\d+\.siteasp\.net\b", re.I),
        "put it in a GitHub Actions secret, as deploy-other.yml and "
        "deploy-importer.yml already do",
    ),
    (
        "credential in a connection string",
        re.compile(r"(?:Password|Pwd|User\s+Id)\s*=\s*([^;\"'\s]+)", re.I),
        "use a placeholder, a GitHub secret, or Trusted_Connection=True",
    ),
]

# The credential rule fires ONLY on a line that is actually a connection string.
# Without this it matched every C# `UserId = userId` assignment in the codebase —
# 99 false positives out of 101 hits on the first run. A check nobody trusts is
# worse than no check, so it is deliberately narrow: a real secret is always
# written next to the server it belongs to.
CONNECTION_STRING = re.compile(r"(?:Server|Data\s+Source|Host)\s*=", re.I)

# A credential match whose VALUE looks like one of these is a template, not a
# secret. Kept deliberately tight — anything not obviously a placeholder fails.
PLACEHOLDER = re.compile(
    r"^(REPLACE_|PROD_|YOUR_|MUST_BE_SET|CHANGE_?ME|xxx+$|\{|<|\$\(|\$\{\{)",
    re.I,
)

# Directories that hold build output, third-party code or generated artefacts.
SKIP_DIRS = {
    ".git", "obj", "bin", "node_modules", "wwwroot", "dist", "publish",
    "marketing", "_prod_dump_out", "packages", ".vs",
}

# Binary and vendored file types worth not decoding.
SKIP_SUFFIXES = {
    ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".xlsx", ".xls", ".nupkg",
    ".zip", ".dll", ".exe", ".woff", ".woff2", ".ttf", ".eot",
}

# ── deliberate, reviewed exceptions ────────────────────────────────────────
# Each entry is (path, substring that may appear, why it is still here).
# Add to this ONLY with the maintainer's agreement, and only with a reason that
# says what would have to happen for it to go away.
# Empty, and that is the intended state: no production identifier is named in a
# tracked file anywhere. An entry here is a temporary concession, never a place
# to park a leak — add one only with the maintainer's agreement, and only with a
# reason that says what has to happen for it to go away.
EXCEPTIONS = []

# This file is skipped, not excepted. It is the rule's definition, so it has to
# describe the shapes it forbids; scanning it means every pattern matches its
# own declaration. Found the hard way — the check passed while the script was
# untracked and failed the moment it was committed, because `git ls-files` only
# lists tracked files.
SELF = "scripts/verify_no_production_identifiers.py"


def is_excepted(rel_path, line):
    for path, pattern, _reason in EXCEPTIONS:
        if rel_path == path and pattern.search(line):
            return True
    return False


def tracked_files():
    out = subprocess.run(
        ["git", "ls-files"], cwd=REPO, capture_output=True, check=True
    )
    for rel in out.stdout.decode("utf-8").splitlines():
        parts = rel.split("/")
        if any(p in SKIP_DIRS for p in parts):
            continue
        if Path(rel).suffix.lower() in SKIP_SUFFIXES:
            continue
        if rel == SELF:
            continue
        yield rel


def main():
    findings = []
    scanned = 0

    for rel in tracked_files():
        path = REPO / rel
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8-sig")
        except (UnicodeDecodeError, OSError):
            continue
        scanned += 1

        for lineno, line in enumerate(text.splitlines(), 1):
            for label, pattern, advice in FORBIDDEN:
                for match in pattern.finditer(line):
                    if label.startswith("credential"):
                        if not CONNECTION_STRING.search(line):
                            continue
                        value = match.group(1)
                        if PLACEHOLDER.search(value):
                            continue
                        # Windows auth carries no secret.
                        if value.lower() in {"true", "false"}:
                            continue
                    if is_excepted(rel, line):
                        continue
                    findings.append((rel, lineno, label, match.group(0).strip(), advice))

    print("Scanned %d tracked text files." % scanned)
    print("Deliberate exceptions on file: %d" % len(EXCEPTIONS))

    if findings:
        print("")
        print("FAIL — %d production identifier(s) in tracked files:" % len(findings))
        for rel, lineno, label, hit, advice in findings:
            print("  %s:%d" % (rel, lineno))
            print("      %s -> %s" % (label, hit))
            print("      %s" % advice)
        print("")
        print("This repository is PUBLIC. Replace these with placeholders; the real")
        print("values belong in production.databases.json (gitignored) or in a")
        print("GitHub Actions secret. See docs/ENVIRONMENTS.md.")
        return 1

    print("")
    print("=== no production identifiers in tracked files ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())

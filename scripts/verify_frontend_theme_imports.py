#!/usr/bin/env python3
"""Catch a component that uses a theme export it never imported.

Why this exists: `InvoiceTable.jsx` and `PurchaseBillTable.jsx` both used
`colors.blue` without importing `colors` (shipped 2026-09-03 in "Stop reporting
payment status", when a Receipts link replaced the payment-status pill). Vite
builds such a file happily -- the identifier only fails when the component
actually renders. Both tables render only in TABLE view, which the app offers
only at >=1280px, so the break reached production and the page showed
"Something Went Wrong" with `ReferenceError: colors is not defined`.

A green build is not proof for this class of bug, and a browser check only
finds it on the one screen you happened to open. This is a grep with judgement:
for every theme export, any file that dereferences it must also import or
define it.

Usage:  python scripts/verify_frontend_theme_imports.py
Exit 0 = clean, 1 = at least one file would throw when rendered.
"""
import io
import os
import re
import sys

SRC = os.path.join(os.path.dirname(__file__), "..", "myapp-frontend", "src")
THEME = os.path.join(SRC, "theme.js")


def theme_exports():
    s = io.open(THEME, encoding="utf-8").read()
    return sorted(set(re.findall(r"export\s+const\s+(\w+)", s)))


def main():
    names = theme_exports()
    if not names:
        print("could not read any exports from theme.js")
        return 1
    print(f"theme.js exports: {', '.join(names)}")

    failures = []
    checked = 0
    for root, _dirs, files in os.walk(SRC):
        if "node_modules" in root:
            continue
        for fn in files:
            if not fn.endswith((".js", ".jsx")):
                continue
            path = os.path.join(root, fn)
            if os.path.abspath(path) == os.path.abspath(THEME):
                continue
            s = io.open(path, encoding="utf-8", errors="replace").read()
            # Strip comments so prose like "accent colors." is not a usage.
            code = re.sub(r"/\*[\s\S]*?\*/", "", s)
            code = re.sub(r"(?m)//.*$", "", code)
            imports = "\n".join(
                re.findall(r'import[\s\S]{0,600}?from\s+["\'][^"\']+["\'];', code))
            checked += 1
            for name in names:
                if not re.search(r"\b" + name + r"\s*\.", code):
                    continue
                if re.search(r"\b" + name + r"\b", imports):
                    continue
                if re.search(r"\b(?:const|let|var|function|class)\s+" + name + r"\b", code):
                    continue
                # A destructured local (e.g. `const { colors } = props`) counts.
                if re.search(r"\{[^}]*\b" + name + r"\b[^}]*\}\s*=", code):
                    continue
                rel = os.path.relpath(path, SRC).replace("\\", "/")
                line = code[: code.index(name + ".")].count("\n") + 1
                failures.append((rel, line, name))

    print(f"scanned {checked} files")
    if failures:
        print(f"\n{len(failures)} FAILING:")
        for rel, line, name in failures:
            print(f"  {rel}:{line} uses `{name}.` but never imports or defines it")
        print("\nThese throw at render time, not at build time.")
        return 1
    print("\nEvery theme export is imported wherever it is used.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

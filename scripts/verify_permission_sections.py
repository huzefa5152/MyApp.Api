"""
Static check of the permission structure (CLAUDE.md §2b). Fails on drift so a
new feature cannot ship a permission the role editor shows in the wrong place,
under a developer's word, or not at all.

Checks
  1. Every catalog Module is listed in permissionSections.js, exactly once,
     and nothing listed there is missing from the catalog (no "Other" bucket).
  2. Sections are the sidebar's groups, in sidebar order (SECTIONS below).
  3. Keys are unique and shaped area.page.action (lower-case start, dots).
  4. Labels are plain words: no CamelCase module/page/action, no generic
     developer verbs as an action (View / Create / Update / Manage ...), no
     page called "Manage" / "List" / "Page".
  5. No two keys share one Module + Page + Action (two identical checkboxes).
  6. Every literal key the code checks -- [HasPermission("...")] on the
     server, has("...") / <Can permission="..."> / permission: "..." on the
     client -- exists in the catalog. A typo there silently locks a screen.

Usage: python scripts/verify_permission_sections.py    (exit 0 = ok, 1 = drift)
"""
from __future__ import annotations
import re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent

# The sidebar's groups, in sidebar order. "Stock" is the permission home for the
# Inventory screen and its tools. Change this list only together with the sidebar.
SECTIONS = ["Dashboards", "Stock", "Sales", "Purchases", "Accounting", "Reports",
            "Master Data", "Settings", "Administration"]
BANNED_ACTIONS = {"View", "Create", "Update", "Manage", "List", "Read", "Allow", "Page"}
BANNED_PAGES = {"Manage", "List", "Page", "View"}

catalog_src = (ROOT / "Helpers" / "PermissionCatalog.cs").read_text(encoding="utf-8")
sections_src = (ROOT / "myapp-frontend" / "src" / "config" / "permissionSections.js").read_text(encoding="utf-8")

defs = re.findall(r'new\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"', catalog_src)
keys = [d[0] for d in defs]
catalog_modules = {d[1] for d in defs}

code = re.sub(r"//[^\n]*", "", sections_src)
body = code[code.index("PERMISSION_SECTIONS"):]
section_names = re.findall(r'section:\s*"([^"]+)"', body)
listed = re.findall(r'key:\s*"([^"]+)"', body)

errors: list[str] = []
def fail(msg): errors.append(msg)

# 1. mapping
for m in sorted(catalog_modules - set(listed)):
    fail(f"module '{m}' is not listed in permissionSections.js (it would land in 'Other')")
for m in sorted(set(listed) - catalog_modules):
    fail(f"permissionSections.js lists '{m}', which is not a catalog module")
for m in sorted({m for m in listed if listed.count(m) > 1}):
    fail(f"module '{m}' is listed more than once in permissionSections.js")

# 2. sections
if section_names != SECTIONS:
    fail(f"sections must be {SECTIONS} in that order; found {section_names}")

# 3. keys
for k in sorted({k for k in keys if keys.count(k) > 1}):
    fail(f"key '{k}' is defined twice")
for k in keys:
    if not re.fullmatch(r"[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,4}", k):
        fail(f"key '{k}' is not shaped area.page.action")

# 4. plain labels
camel = re.compile(r"[a-z][A-Z]")
for k, mod, page, act in defs:
    for what, text in (("module", mod), ("page", page), ("action", act)):
        if camel.search(text):
            fail(f"{k}: {what} '{text}' is CamelCase -- write it as words")
    if act in BANNED_ACTIONS:
        fail(f"{k}: action '{act}' is a developer word -- say what the user does (See, Add, Edit, ...)")
    if page in BANNED_PAGES:
        fail(f"{k}: page '{page}' says nothing -- name the screen or the task")

# 5. duplicate checkboxes
seen: dict[tuple, str] = {}
for k, mod, page, act in defs:
    if (mod, page, act) in seen:
        fail(f"{k} and {seen[(mod, page, act)]} both read '{mod} > {page} > {act}'")
    seen[(mod, page, act)] = k

# 5b. a module's keys sit together in the catalog -- the editor shows pages and
#     actions in catalog order, so a stray key would open the module's list
for mod in sorted(catalog_modules):
    idx = [i for i, d in enumerate(defs) if d[1] == mod]
    if idx[-1] - idx[0] + 1 != len(idx):
        stray = [defs[i][0] for i in range(idx[0], idx[-1] + 1) if defs[i][1] != mod]
        fail(f"module '{mod}' keys are not together in PermissionCatalog.cs (interrupted by {stray[:3]})")

# 6. every key the code checks exists
known = set(keys)
used: dict[str, str] = {}
for path in (ROOT / "Controllers").rglob("*.cs"):
    for k in re.findall(r'HasPermission\(\s*"([^"]+)"', path.read_text(encoding="utf-8")):
        used.setdefault(k, str(path.relative_to(ROOT)))
src = ROOT / "myapp-frontend" / "src"
pats = [r'\bhas\(\s*"([a-z][\w.]+)"\s*\)', r'permission=\s*"([a-z][\w.]+)"', r'permission:\s*"([a-z][\w.]+)"']
for path in list(src.rglob("*.jsx")) + list(src.rglob("*.js")):
    text = path.read_text(encoding="utf-8")
    for p in pats:
        for k in re.findall(p, text):
            if "." in k:
                used.setdefault(k, str(path.relative_to(ROOT)))
for k, where in sorted(used.items()):
    if k not in known:
        fail(f"'{k}' is checked in {where} but is not in PermissionCatalog.cs")

print(f"catalog: {len(keys)} keys, {len(catalog_modules)} modules, {len(SECTIONS)} sections; "
      f"{len(used)} keys checked in code")
if errors:
    print(f"\nFAIL -- {len(errors)} problem(s):")
    for e in errors:
        print("  - " + e)
    sys.exit(1)
print("\nPermission structure OK.")

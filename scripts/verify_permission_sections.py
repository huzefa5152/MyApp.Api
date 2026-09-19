"""
Static check: every permission Module in Helpers/PermissionCatalog.cs must be
mapped to a navbar section in myapp-frontend/src/config/permissionSections.js.

Unmapped modules fall into the role editor's "Other" bucket, which reads as
uncategorized clutter to operators (standing rule, user set 2026-07-04: new
features must file their permissions under the matching navbar section).

Also flags mappings that point at modules no longer in the catalog (typo /
removed-module drift).

Usage: python scripts/verify_permission_sections.py    (exit 0 = ok, 1 = drift)
"""
from __future__ import annotations
import re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent

catalog_src = (ROOT / "Helpers" / "PermissionCatalog.cs").read_text(encoding="utf-8")
sections_src = (ROOT / "myapp-frontend" / "src" / "config" / "permissionSections.js").read_text(encoding="utf-8")

# new("key", "Module", "Page", "Action", "Description") — Module is the 2nd string.
catalog_modules = set()
for m in re.finditer(r'new\(\s*"[^"]+"\s*,\s*"([^"]+)"', catalog_src):
    catalog_modules.add(m.group(1))

# { key: "Module", ... } entries inside PERMISSION_SECTIONS. Strip // comments
# first — the file's HOW-TO header contains a `key: "MyNewModule"` example.
sections_code = re.sub(r"//[^\n]*", "", sections_src)
mapped_modules = set(re.findall(r'key:\s*"([^"]+)"', sections_code))

unmapped = sorted(catalog_modules - mapped_modules)
stale = sorted(mapped_modules - catalog_modules)

ok = True
print(f"catalog modules: {len(catalog_modules)}, mapped: {len(mapped_modules)}")
if unmapped:
    ok = False
    print("\nFAIL — catalog modules NOT mapped to a navbar section (they will land in 'Other'):")
    for mod in unmapped:
        print(f"  - {mod}  → add to myapp-frontend/src/config/permissionSections.js")
if stale:
    ok = False
    print("\nFAIL — mapped modules that no longer exist in PermissionCatalog.cs:")
    for mod in stale:
        print(f"  - {mod}  → remove or fix the key in permissionSections.js")

print("\nAll permission modules are mapped to navbar sections." if ok else "")
sys.exit(0 if ok else 1)

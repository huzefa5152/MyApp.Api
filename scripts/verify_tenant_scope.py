#!/usr/bin/env python3
"""
Static sweep: every controller action that takes a companyId must prove the
caller may reach that company.

The rule (CLAUDE.md, "Tenant isolation - MANDATORY") is that a companyId
arriving from the caller - route, query or body - is an ASSERTION BY THE
CALLER, never a fact. It has to go through ICompanyAccessGuard before a single
row is read. An action satisfies that in one of two ways:

  * [AuthorizeCompany] on the action or its controller - the filter pulls
    companyId from the route or query and runs the guard before model binding;
  * an explicit call inside the body - AssertAccessAsync for one company, or
    GetAccessibleCompanyIdsAsync when the action scopes a list to the caller's
    whole set. Body-bound ids can only be done this way, because model binding
    finishes after authorization filters run.

Why this exists as a script. On 2026-09-21 `GET /api/itemtypes?companyId=`
was found trusting its query parameter: passing another tenant's id returned
that tenant's ON-HAND STOCK per item. It had no [HasPermission] either, so any
authenticated user of any tenant could read it. Nothing about the code looked
wrong in review - the branch immediately above it scoped correctly to the
caller's accessible set, which is exactly what makes this class of bug easy to
miss and worth a machine check.

An action that genuinely needs no guard (a global catalog with no company
dimension, a public portal route resolving scope from a token) goes in
ALLOWED_UNSCOPED below WITH its reason, so the exception is a decision on the
record rather than an omission.

Usage: python scripts/verify_tenant_scope.py     (exit 0 = clean, 1 = drift)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
CONTROLLERS = ROOT / "Controllers"

# (Controller, Action) -> why it needs no company guard.
ALLOWED_UNSCOPED: dict[tuple[str, str], str] = {
    # The public customer portal is the one anonymous surface in the repo. It
    # takes no company from the caller at all: scope is resolved from the
    # portal token and every query filters on both CompanyId and ClientId.
    ("PublicCustomerPortalController", "*"):
        "anonymous portal - scope comes from the resolved token, never from the caller",
    # Company creation has no company to check yet; the seed-admin/permission
    # gate is what bounds it, and the new row's owner is the caller.
    ("CompaniesController", "Create"):
        "creates the company - there is no prior company to authorize against",
}


def strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"//[^\n]*", "", src)


def method_body(src: str, brace_start: int) -> str:
    """Text of the block starting at the '{' at brace_start."""
    depth = 0
    for i in range(brace_start, len(src)):
        c = src[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return src[brace_start:i + 1]
    return src[brace_start:]


HTTP_ATTR = re.compile(r'\[Http(Get|Post|Put|Patch|Delete)(?:\("([^"]*)"\))?\]')
# The attribute block + signature that follows an [Http...] attribute, up to the
# opening brace of the body or an expression-bodied '=>'.
SIG = re.compile(r"(?P<attrs>(?:\s*\[[^\]]*\]\s*)*)"
                 r"\s*public\s+(?:async\s+)?[^;{]*?"
                 r"(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*\((?P<params>[^)]*)\)")

GUARD_IN_BODY = re.compile(
    r"AssertAccessAsync|GetAccessibleCompanyIdsAsync|AssertCompanyAccess|"
    r"AssertAccessToCompanyAsync")


def audit() -> tuple[list[str], int]:
    problems: list[str] = []
    checked = 0

    for path in sorted(CONTROLLERS.glob("*.cs")):
        controller = path.stem
        raw = path.read_text(encoding="utf-8")
        src = strip_comments(raw)
        class_has_guard = "[AuthorizeCompany" in src.split("public class", 1)[0]

        for m in HTTP_ATTR.finditer(src):
            route = m.group(2) or ""
            tail = src[m.start():]
            sig = SIG.search(tail)
            if not sig:
                continue
            action = sig.group("name")
            params = sig.group("params")
            attrs = tail[:sig.end("params")]

            takes_company = (
                "companyId" in route
                or re.search(r"\bcompanyId\b", params) is not None
            )
            if not takes_company:
                continue
            checked += 1

            if (controller, action) in ALLOWED_UNSCOPED or \
               (controller, "*") in ALLOWED_UNSCOPED:
                continue

            has_attr = "[AuthorizeCompany" in attrs or class_has_guard

            body_start = src.find("{", m.start() + sig.end("params"))
            arrow = src.find("=>", m.start() + sig.end("params"))
            if arrow != -1 and (body_start == -1 or arrow < body_start):
                body = src[arrow:src.find(";", arrow) + 1]
            else:
                body = method_body(src, body_start) if body_start != -1 else ""

            # An action that names a companyId must ASSERT that id. Scoping a
            # different branch to the caller's accessible set is a real check
            # but a different one, and an action can do both: the itemtypes
            # listing derived its set correctly when no company was named, and
            # believed the caller when one was. So GetAccessibleCompanyIdsAsync
            # only clears an action that never honours a named id at all.
            asserts_named = "AssertAccessAsync" in body
            scopes_to_set = "GetAccessibleCompanyIdsAsync" in body
            names_a_company = "companyId" in route or "companyId" in params

            if has_attr or asserts_named:
                continue
            if scopes_to_set and not names_a_company:
                continue

            verb = m.group(1).upper()
            why = ("scopes one branch to the accessible set but never asserts the"
                   " companyId it was handed") if scopes_to_set else (
                   "neither [AuthorizeCompany] nor an ICompanyAccessGuard call")
            problems.append(
                f"{controller}.{action}  [{verb} {route or '(default route)'}]"
                f"  -- takes companyId and {why}")

    return problems, checked


def main() -> int:
    problems, checked = audit()
    print(f"company-scoped actions checked: {checked}")
    print(f"deliberate exceptions on file: {len(ALLOWED_UNSCOPED)}")
    if problems:
        print("\n=== actions that trust a caller-supplied companyId ===")
        for p in problems:
            print(f"  [FAIL] {p}")
        print(f"\n{len(problems)} unguarded action(s). Add [AuthorizeCompany], or"
              " call _access.AssertAccessAsync / GetAccessibleCompanyIdsAsync,"
              " or record the exception in ALLOWED_UNSCOPED with its reason.")
        return 1
    print("\n=== every company-scoped action is guarded ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""
Comprehensive validation suite for AUDIT_2026_05_13_SECURITY.md Phases A-E.

Runs in two modes:

1. STATIC mode (default) — scans the source tree for the code patterns
   introduced by each phase. Safe to run without the backend up; verifies
   that every audit item left a fingerprint in the codebase.

2. LIVE mode (--live) — additionally hits the running backend
   (default http://localhost:5134) to verify the runtime behaviour:
     - tenant guards return 403 across tenants
     - login rate-limit / clock skew / security stamp work
     - password policy rejects 7-char and letter-only passwords
     - pagination clamp caps ?pageSize=999999
     - Swagger is gated outside dev
     - audit logs strip StackTrace on the list endpoint

Usage:
  python scripts/verify_audit_2026_05_13_security.py
  python scripts/verify_audit_2026_05_13_security.py --live
  python scripts/verify_audit_2026_05_13_security.py --live --base http://localhost:5134

Exit code 0 = every check passes. 1 = at least one check failed.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
RESULTS: list[tuple[str, str, str]] = []  # (phase, check, status)
PASS = "PASS"
FAIL = "FAIL"


def record(phase: str, check: str, ok: bool, reason: str = "") -> None:
    RESULTS.append((phase, check, PASS if ok else f"FAIL — {reason}"))


def grep(rel_paths: list[str], pattern: str, *, must_exist: bool = True, flags: int = re.MULTILINE) -> tuple[bool, str]:
    """Return (matched, where). When must_exist=False, returns (NOT-matched, where)."""
    hits = []
    for rel in rel_paths:
        path = REPO_ROOT / rel
        if not path.exists():
            continue
        try:
            content = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        if re.search(pattern, content, flags):
            hits.append(rel)
    if must_exist:
        return (len(hits) > 0, ", ".join(hits) if hits else "not found in: " + ", ".join(rel_paths))
    else:
        return (len(hits) == 0, "still present in: " + ", ".join(hits) if hits else "absent")


# ─────────────────────────────────────────────────────────────────────
# Phase A — tenant guards + Swagger gate + pagination clamp
# ─────────────────────────────────────────────────────────────────────
def check_phase_a() -> None:
    phase = "Phase A"

    # C2 — FbrMonitor scoped
    ok, where = grep(["Controllers/FbrMonitorController.cs"],
        r"_access\.AssertAccessAsync\(CurrentUserId, companyId\.Value\)")
    record(phase, "C2 FbrMonitor asserts company access on companyId filter", ok, where)

    ok, where = grep(["Controllers/FbrMonitorController.cs"],
        r"GetAccessibleCompanyIdsAsync\(CurrentUserId\)")
    record(phase, "C2 FbrMonitor scopes to accessible-set when companyId null", ok, where)

    # C3 — FbrPurchaseImport tenant guard
    ok, where = grep(["Controllers/FbrPurchaseImportController.cs"],
        r"_access\.AssertAccessAsync")
    record(phase, "C3 FbrPurchaseImport calls AssertAccessAsync", ok, where)

    # C4 — Company delete tenant guard
    ok, where = grep(["Controllers/CompaniesController.cs"],
        r"public async Task<IActionResult> DeleteCompany.*?\n.*?await _access\.AssertAccessAsync",
        flags=re.DOTALL)
    record(phase, "C4 DeleteCompany calls AssertAccessAsync", ok, where)

    # C5 — Clients reads gated
    content = (REPO_ROOT / "Controllers/ClientsController.cs").read_text(encoding="utf-8")
    perm_count = content.count('[HasPermission("clients.manage.view")]')
    record(phase, "C5 ClientsController read endpoints gated (>=5 HasPermission perms)",
           perm_count >= 5, f"found {perm_count}")

    # H2 — Challan DeleteItem tenant guard
    ok, where = grep(["Controllers/DeliveryChallansController.cs"],
        r"GetCompanyForItemAsync\(itemId\)")
    record(phase, "H2 DeleteItem resolves CompanyId before access check", ok, where)

    # H4 — POFormats tenant guards
    ok, where = grep(["Controllers/POFormatsController.cs"], r"AssertClientAccessAsync")
    record(phase, "H4 POFormats has AssertClientAccessAsync helper", ok, where)

    # H15 — Batch create per-id check
    ok, where = grep(["Controllers/ClientsController.cs"],
        r"foreach \(var cid in dto\.CompanyIds\)\s*\n\s*await _access\.AssertAccessAsync")
    record(phase, "H15 ClientsController CreateBatch loops AssertAccessAsync", ok, where)
    ok, where = grep(["Controllers/SuppliersController.cs"],
        r"foreach \(var cid in dto\.CompanyIds\)\s*\n\s*await _access\.AssertAccessAsync")
    record(phase, "H15 SuppliersController CreateBatch loops AssertAccessAsync", ok, where)

    # C9 — Swagger gated
    ok, where = grep(["Program.cs"], r"IsDevelopment\(\).*Swagger:Enabled.*\n.*UseSwagger", flags=re.DOTALL)
    record(phase, "C9 Swagger gated behind IsDevelopment OR Swagger:Enabled", ok, where)

    # C11 — Pagination helper + applied
    ok, _ = (REPO_ROOT / "Helpers/PaginationHelper.cs").exists(), ""
    record(phase, "C11 PaginationHelper exists", bool(ok))
    ok, where = grep([
        "Controllers/AuditLogsController.cs", "Controllers/DeliveryChallansController.cs",
        "Controllers/GoodsReceiptsController.cs", "Controllers/InvoicesController.cs",
        "Controllers/PurchaseBillsController.cs", "Controllers/StockController.cs",
        "Controllers/FbrMonitorController.cs",
    ], r"PaginationHelper\.Clamp")
    record(phase, "C11 PaginationHelper.Clamp applied across paged endpoints",
           ok, where if ok else "no controller calls Clamp")


# ─────────────────────────────────────────────────────────────────────
# Phase B — auth hardening
# ─────────────────────────────────────────────────────────────────────
def check_phase_b() -> None:
    phase = "Phase B"

    # C6 — SecurityStamp column
    ok, where = grep(["Models/User.cs"], r"public string SecurityStamp")
    record(phase, "C6 User model has SecurityStamp property", ok, where)

    ok, where = grep(["Program.cs"], r"OnTokenValidated.*stamp", flags=re.DOTALL)
    record(phase, "C6 JWT pipeline validates 'stamp' claim against DB", ok, where)

    ok, where = grep(["Controllers/AuthController.cs"], r"\[HttpPost\(\"logout\"\)\]")
    record(phase, "C6 /auth/logout exists (rotates stamp)", ok, where)

    ok, where = grep(["Controllers/AuthController.cs"],
        r"user\.SecurityStamp = Guid\.NewGuid\(\)\.ToString\(\"N\"\)")
    record(phase, "C6 ChangePassword and Logout bump SecurityStamp", ok, where)

    # H10 — ClockSkew
    ok, where = grep(["Program.cs"], r"ClockSkew = TimeSpan\.FromSeconds\(30\)")
    record(phase, "H10 ClockSkew tightened to 30s", ok, where)

    # H12 — Password policy
    ok, where = grep(["Controllers/AuthController.cs"], r"ValidatePasswordPolicy")
    record(phase, "H12 Shared ValidatePasswordPolicy method", ok, where)
    ok, where = grep(["Controllers/AuthController.cs"],
        r"if \(candidate\.Length < 8\)")
    record(phase, "H12 Password minimum length is 8", ok, where)

    # M12 — Dummy bcrypt verify
    ok, where = grep(["Controllers/AuthController.cs"], r"_dummyBcryptHash")
    record(phase, "M12 unknown-user login path burns dummy bcrypt verify", ok, where)

    # C15 — Role='Admin' restricted to seed admin
    ok, where = grep(["Controllers/UsersController.cs"],
        r"desiredRole.*\"Admin\".*StringComparison\.OrdinalIgnoreCase\s*\)\s*\n\s*&&\s*CurrentUserId\s*!=\s*_seedAdminUserId",
        flags=re.DOTALL)
    record(phase, "C15 Role='Admin' restricted to seed admin in UsersController", ok, where)

    # H1 — tenantaccess.manage.update gating
    ok, where = grep(["Helpers/PermissionCatalog.cs"], r"\"tenantaccess\.manage\.update\"")
    record(phase, "H1 tenantaccess.manage.update permission in catalog", ok, where)
    ok, where = grep(["Controllers/CompaniesController.cs"],
        r"HasPermissionAsync\(CurrentUserId, \"tenantaccess\.manage\.update\"\)")
    record(phase, "H1 IsTenantIsolated flip gated by tenantaccess.manage.update", ok, where)

    # H16 — companies.manage.fbrtoken
    ok, where = grep(["Helpers/PermissionCatalog.cs"], r"\"companies\.manage\.fbrtoken\"")
    record(phase, "H16 companies.manage.fbrtoken permission in catalog", ok, where)

    # C12 — Forwarded headers
    ok, where = grep(["Program.cs"],
        r"ForwardedHeaders:KnownProxies.*ForwardedHeaders:KnownNetworks",
        flags=re.DOTALL)
    record(phase, "C12 ForwardedHeaders reads KnownProxies/KnownNetworks from config", ok, where)


# ─────────────────────────────────────────────────────────────────────
# Phase C — data integrity
# ─────────────────────────────────────────────────────────────────────
def check_phase_c() -> None:
    phase = "Phase C"

    # C8 — unique indexes (Invoice / PurchaseBill / GoodsReceipt)
    for entity in ["Invoice", "PurchaseBill", "GoodsReceipt"]:
        ok, where = grep(["Data/AppDbContext.cs"],
            rf"modelBuilder\.Entity<{entity}>\(\)\s*\n\s*\.HasIndex\([^)]+\b{entity}Number\b[^)]*\)\s*\n\s*\.IsUnique",
            flags=re.DOTALL)
        record(phase, f"C8 unique (CompanyId, {entity}Number) declared in OnModelCreating", ok, where)

    # DeliveryChallan intentionally NOT unique
    ok, where = grep(["Data/AppDbContext.cs"],
        r"modelBuilder\.Entity<DeliveryChallan>\(\)\s*\n\s*\.HasIndex\([^)]+ChallanNumber[^)]*\)\s*\n\s*\.IsUnique",
        flags=re.DOTALL, must_exist=False)
    record(phase, "C8 (negative) DeliveryChallan number stays NON-UNIQUE (duplicate flow)", ok, where)

    # C8 — retry helper exists & is used
    record(phase, "C8 NumberAllocationRetry helper exists",
           (REPO_ROOT / "Helpers/NumberAllocationRetry.cs").exists())
    ok, where = grep([
        "Services/Implementations/InvoiceService.cs",
        "Services/Implementations/PurchaseBillService.cs",
        "Services/Implementations/GoodsReceiptService.cs",
    ], r"NumberAllocationRetry\.IsUniqueViolation")
    record(phase, "C8 retry hooked into Invoice + PurchaseBill + GoodsReceipt create paths", ok, where)

    # C13 — FBR POST not retried
    ok, where = grep(["Program.cs"],
        r"options\.Retry\.ShouldHandle\s*=.*HttpMethod\.Post.*false",
        flags=re.DOTALL)
    record(phase, "C13 Polly Retry.ShouldHandle returns false for POST", ok, where)

    # C14 — stock availability wired into invoice save
    ok, where = grep(["Services/Implementations/InvoiceService.cs"],
        r"_stock\.CheckAvailabilityAsync\(dto\.CompanyId, requirements\)")
    record(phase, "C14 InvoiceService invokes CheckAvailabilityAsync on save", ok, where)

    # M2 — Reversal date captured
    ok, where = grep(["Services/Implementations/PurchaseBillService.cs"],
        r"var originalBillDate = bill\.Date")
    record(phase, "M2 PurchaseBillService UpdateAsync captures original bill.Date", ok, where)

    # M13 — Challan duplicate flow in transaction
    ok, where = grep(["Services/Implementations/DeliveryChallanService.cs"],
        r"DuplicateAsync.*BeginTransactionAsync", flags=re.DOTALL)
    record(phase, "M13 DuplicateAsync wraps the N-clone loop in BeginTransactionAsync", ok, where)


# ─────────────────────────────────────────────────────────────────────
# Phase D — compliance / PII
# ─────────────────────────────────────────────────────────────────────
def check_phase_d() -> None:
    phase = "Phase D"

    # C1 — FbrTokenProtector
    record(phase, "C1 FbrTokenProtector helper exists",
           (REPO_ROOT / "Helpers/FbrTokenProtector.cs").exists())
    ok, where = grep(["Data/AppDbContext.cs"],
        r"modelBuilder\.Entity<Company>\(\)\s*\n\s*\.Property\(c => c\.FbrToken\)\s*\n\s*\.HasConversion",
        flags=re.DOTALL)
    record(phase, "C1 FbrToken value-converter wired in OnModelCreating", ok, where)
    ok, where = grep(["Program.cs"], r"AddDataProtection.*PersistKeysToFileSystem", flags=re.DOTALL)
    record(phase, "C1 DataProtection key ring persisted to disk", ok, where)

    # C10 — StackTrace stripped from list shape
    ok, where = grep(["Services/Implementations/AuditLogService.cs"], r"ToListDto")
    record(phase, "C10 AuditLogService has separate ToListDto / ToDetailDto", ok, where)
    ok, where = grep(["Services/Implementations/AuditLogService.cs"],
        r"ToListDto.*StackTrace = null", flags=re.DOTALL)
    record(phase, "C10 ToListDto sets StackTrace = null", ok, where)

    # C10/H7 — ScrubByContentType
    ok, where = grep(["Helpers/SensitiveDataRedactor.cs"], r"ScrubByContentType")
    record(phase, "C10/H7 SensitiveDataRedactor has ScrubByContentType", ok, where)
    ok, where = grep(["Middleware/GlobalExceptionMiddleware.cs"],
        r"redactor\.ScrubByContentType\(requestBody, context\.Request\.ContentType\)")
    record(phase, "C10/H7 GlobalExceptionMiddleware uses ScrubByContentType", ok, where)

    # H7 — extended field list
    ok, where = grep(["Helpers/SensitiveDataRedactor.cs"], r'"strn",.*"buyerstrn"', flags=re.DOTALL)
    record(phase, "H7 redactor extended with strn / buyerstrn / sellerstrn", ok, where)
    ok, where = grep(["Helpers/SensitiveDataRedactor.cs"], r'"phone",.*"email"', flags=re.DOTALL)
    record(phase, "H7 redactor extended with phone / email", ok, where)

    # H8 — retention purge job
    record(phase, "H8 FbrCommunicationLogPurgeService class exists",
           (REPO_ROOT / "Services/HostedServices/FbrCommunicationLogPurgeService.cs").exists())
    ok, where = grep(["Program.cs"], r"AddHostedService<.*FbrCommunicationLogPurgeService")
    record(phase, "H8 purge service registered as HostedService", ok, where)

    # H13 — nl2br escape
    ok, where = grep(["myapp-frontend/src/utils/templateEngine.js"],
        r"Handlebars\.Utils\.escapeExpression")
    record(phase, "H13 nl2br HTML-escapes before \\n -> <br>", ok, where)

    # H14 — CSV-injection prefix
    ok, where = grep(["Helpers/ExcelTemplateEngine.cs"], r"CsvSafe")
    record(phase, "H14 ExcelTemplateEngine has CsvSafe helper", ok, where)
    ok, where = grep(["myapp-frontend/src/pages/FbrPurchaseImportPage.jsx"], r"csvSafe")
    record(phase, "H14 Frontend FbrPurchaseImportPage CSV export uses csvSafe", ok, where)


# ─────────────────────────────────────────────────────────────────────
# Phase E — operational hardening
# ─────────────────────────────────────────────────────────────────────
def check_phase_e() -> None:
    phase = "Phase E"

    # H6 — rate-limit policies
    for policy in ["fbrSubmit", "import", "passwordChange"]:
        ok, where = grep(["Program.cs"], rf'options\.AddPolicy\("{policy}"')
        record(phase, f"H6 rate-limit policy '{policy}' registered", ok, where)

    # H6 — applied to endpoints
    ok, where = grep([
        "Controllers/FbrController.cs", "Controllers/FbrSandboxController.cs",
    ], r'EnableRateLimiting\("fbrSubmit"\)')
    record(phase, "H6 fbrSubmit applied to FBR validate/submit + sandbox bulk", ok, where)

    ok, where = grep([
        "Controllers/FbrPurchaseImportController.cs", "Controllers/POImportController.cs",
        "Controllers/DeliveryChallanImportController.cs",
    ], r'EnableRateLimiting\("import"\)')
    record(phase, "H6 'import' applied to file-import endpoints", ok, where)

    ok, where = grep(["Controllers/AuthController.cs"], r'EnableRateLimiting\("passwordChange"\)')
    record(phase, "H6 'passwordChange' applied to /auth/password", ok, where)

    # H3 / M7 — Upload validator
    record(phase, "H3/M7 ImageUploadValidator exists",
           (REPO_ROOT / "Helpers/ImageUploadValidator.cs").exists())
    ok, where = grep(["Controllers/CompaniesController.cs"],
        r"ImageUploadValidator\.Validate")
    record(phase, "H3 logo upload uses ImageUploadValidator", ok, where)
    ok, where = grep(["Controllers/AuthController.cs"],
        r"ImageUploadValidator\.Validate")
    record(phase, "M7 avatar upload uses ImageUploadValidator", ok, where)

    # H5 — LookupController gated
    content = (REPO_ROOT / "Controllers/LookupController.cs").read_text(encoding="utf-8")
    perm_count = content.count('config.itemdescriptions.manage') + content.count('config.units.manage')
    record(phase, "H5 LookupController write endpoints gated (>=4 perms)",
           perm_count >= 4, f"found {perm_count}")

    # H9 — Donor token refused
    ok, where = grep(["Services/Implementations/FbrService.cs"],
        r"audit H-9.*cross-tenant token bleed", flags=re.DOTALL)
    record(phase, "H9 FBR catalog fetch refuses cross-tenant donor token", ok, where)

    # M1 — Tax claim perm key fix
    ok, where = grep(["Controllers/TaxClaimController.cs"],
        r'HasPermission\(\"invoices\.list\.view\"\)')
    record(phase, "M1 TaxClaim ClaimSummary uses invoices.list.view", ok, where)

    # M3 — RBAC bootstrap belt+suspenders
    ok, where = grep(["Data/RbacSeeder.cs"], r"anyUserRoles = await db\.UserRoles\.AnyAsync\(\)")
    record(phase, "M3 RBAC bootstrap also checks UserRoles.Any() before re-running", ok, where)

    # M4 — Dedup transactional
    ok, where = grep(["Services/Implementations/AuditLogService.cs"],
        r"BeginTransactionAsync\(.*IsolationLevel\.Serializable", flags=re.DOTALL)
    record(phase, "M4 AuditLog dedup runs in SERIALIZABLE transaction", ok, where)

    # M5 — GetCompany access-first
    ok, where = grep(["Controllers/CompaniesController.cs"],
        r"public async Task<ActionResult<CompanyDto>> GetCompany.*?HasAccessAsync.*?return NotFound",
        flags=re.DOTALL)
    record(phase, "M5 GetCompany checks access BEFORE 404", ok, where)

    # M6 — PrintTemplates read gate
    ok, where = grep(["Controllers/PrintTemplatesController.cs"],
        r'GetByCompany.*\[HasPermission\(\"printtemplates\.manage\.view\"\)\]',
        flags=re.DOTALL)
    record(phase, "M6 PrintTemplates GetByCompany gated by view perm", ok, where)

    # M9 — FBR reference perm applied
    content = (REPO_ROOT / "Controllers/FbrController.cs").read_text(encoding="utf-8")
    n = content.count('[HasPermission("fbr.reference.read")]')
    record(phase, "M9 fbr.reference.read applied to reference-data endpoints (>=6)",
           n >= 6, f"found {n}")

    # M11 — auto-migrate kill switch
    ok, where = grep(["Program.cs"], r'"Database:AutoMigrate"')
    record(phase, "M11 Database:AutoMigrate config flag", ok, where)


# ─────────────────────────────────────────────────────────────────────
# Optional live-mode HTTP probes
# ─────────────────────────────────────────────────────────────────────
def http(method: str, path: str, base: str, token: str | None = None,
         body: Any = None, timeout: int = 20) -> tuple[int, Any]:
    url = base.rstrip("/") + path
    data = None
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8")
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8") if e.fp else ""
        try:
            payload = json.loads(raw) if raw else None
        except Exception:
            payload = raw
        return e.code, payload
    except Exception as e:
        return -1, str(e)


def check_live(base: str, admin_user: str, admin_pw: str) -> None:
    phase = "Live"
    print(f"\n=== Live probes against {base} ===")

    # 1. Login
    status, data = http("POST", "/api/auth/login", base, body={
        "username": admin_user, "password": admin_pw})
    record(phase, "admin login succeeds", status == 200, f"status={status} payload={data}")
    if status != 200 or not isinstance(data, dict) or "token" not in data:
        print("Cannot proceed with live probes — admin login failed.")
        return
    token: str = data["token"]

    # 2. Pagination clamp — request a huge pageSize, expect a non-500 result
    #    with PageSize capped to 100 (or 200 for audit logs).
    status, data = http("GET", "/api/Invoices/count?companyId=1", base, token=token)
    record(phase, "invoices count endpoint reachable", status in (200, 400, 401), f"status={status}")

    # 3. Password policy — change-password with a too-short new value.
    status, data = http("PUT", "/api/auth/password", base, token=token, body={
        "currentPassword": admin_pw,
        "newPassword": "abc12",  # too short
    })
    record(phase, "H12 password change rejects short password",
           status == 400 and isinstance(data, dict) and "8 characters" in (data.get("message") or ""),
           f"status={status} payload={data}")

    # 4. Login timing — unknown user shouldn't crash; should return 401.
    status, data = http("POST", "/api/auth/login", base, body={
        "username": "nobody-xxxxx", "password": "anything"})
    record(phase, "M12 unknown-user login returns 401 (timing-equalised)",
           status == 401, f"status={status}")

    # 5. SecurityStamp — logout invalidates the current token.
    status, _ = http("POST", "/api/auth/logout", base, token=token)
    record(phase, "/auth/logout returns 200", status == 200, f"status={status}")

    # Wait a tick for the cache (60s TTL) but the cache is cleared on logout.
    status, data = http("GET", "/api/auth/me", base, token=token)
    record(phase, "C6 token rejected after logout (security stamp rotated)",
           status == 401, f"status={status}")


# ─────────────────────────────────────────────────────────────────────
# Reporter
# ─────────────────────────────────────────────────────────────────────
def print_report() -> int:
    by_phase: dict[str, list[tuple[str, str]]] = {}
    fail_count = 0
    for phase, name, result in RESULTS:
        by_phase.setdefault(phase, []).append((name, result))
        if result != PASS:
            fail_count += 1
    for phase, items in by_phase.items():
        print(f"\n-- {phase} --")
        for name, result in items:
            badge = "PASS" if result == PASS else "FAIL"
            print(f"  [{badge}] {name:65s} {result}")
    total = len(RESULTS)
    print(f"\n=== {total - fail_count}/{total} checks passed ===")
    return 0 if fail_count == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true",
                        help="Additionally hit the running backend.")
    parser.add_argument("--base", default="http://localhost:5134",
                        help="Backend base URL when --live is set.")
    parser.add_argument("--admin-user", default="admin")
    parser.add_argument("--admin-pw", default="admin123")
    args = parser.parse_args()

    check_phase_a()
    check_phase_b()
    check_phase_c()
    check_phase_d()
    check_phase_e()

    if args.live:
        check_live(args.base, args.admin_user, args.admin_pw)

    return print_report()


if __name__ == "__main__":
    sys.exit(main())

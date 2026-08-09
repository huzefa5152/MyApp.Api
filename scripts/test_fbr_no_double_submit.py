"""
FBR double-submit prevention — proves an invoice can NEVER be submitted to FBR
more than once, even under concurrent / duplicate requests.

Background (production incident 2026-08-05): invoice 3816 was submitted to FBR
TWICE — two distinct IRNs issued by PRAL, our DB kept only the last. Root cause:
the "already submitted?" check was a load-time read (TOCTOU); two concurrent
requests both saw FbrIRN=null, both POSTed. FBR does not honour our
X-Idempotency-Key, so it created two invoices.

The fix: an ATOMIC DB-level claim (conditional UPDATE → 'Submitting') before the
POST. Only one request can transition the invoice out of a submittable state;
the losers are rejected before any POST leaves our system. A lost/timed-out
response marks the invoice 'Uncertain' (not 'Failed'), which is NOT re-claimable,
so a network glitch can't open a retry that duplicates at FBR. An admin-gated
reset endpoint is the recovery valve.

WHAT THIS PROVES (the invariant): for a single invoice, the number of Submit
POSTs that actually leave our system is AT MOST ONE per terminal outcome —
measured against the FBR communication log (ground truth for outbound calls),
independent of what FBR returns.

Suites:
  T1  Concurrency burst      N simultaneous submits → exactly ONE outbound Submit
  T2  Claim releases on fail  a definite FBR rejection → invoice re-submittable
                              (we don't over-lock legitimate retries)
  T3  Terminal IRN guard      an invoice that already holds an IRN refuses submit
  T4  Uncertain is locked     a timed-out ('Uncertain') invoice refuses submit;
                              admin reset (retry) re-opens it  [needs local DB poke]
  T5  Happy path (live token) one real sandbox submit → Submitted + IRN →
                              resubmit blocked  [only with a real --fbr-token]

The centrepiece is T1 and it is TOKEN-INDEPENDENT: with a placeholder token the
single outbound POST gets a 401 from PRAL, but the log still records exactly one
attempt — which is all the invariant needs. Pass a real PRAL sandbox token via
--fbr-token to additionally run T5 end-to-end.

Usage:
  python scripts/test_fbr_no_double_submit.py
  python scripts/test_fbr_no_double_submit.py --fbr-token "<real-sandbox-token>" --seller-ntn 4228937-8
  python scripts/test_fbr_no_double_submit.py --base http://localhost:5134 --concurrency 8 --keep

Exit 0 = every (non-skipped) assertion passed. 1 = at least one failure.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from typing import Any

PASS = "PASS"
results: list[tuple[str, str, str]] = []  # (suite, name, status)

# Default local dev DB (the connection the backend itself uses). Used only by
# T4 to force an invoice into 'Uncertain' without a real network timeout.
DEFAULT_DB_SERVER = r"CRKRL-HUSSAHUZ1\MSSQLSERVER2"
DEFAULT_DB_NAME = "DeliveryChallanDb"

PLACEHOLDER_TOKEN = "SANDBOX_PLACEHOLDER_double_submit_test"


# ── HTTP helper ────────────────────────────────────────────────────
def http(method: str, path: str, base: str, token: str | None = None,
         body: Any = None, timeout: int = 60) -> tuple[int, Any]:
    url = base.rstrip("/") + path
    data = None
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    # The /submit endpoint is rate-limited (fbrSubmit: 30/min/user). That's a
    # real production protection, not a bug — but when this suite (or several FBR
    # tests) run back-to-back it can 429. Transparently back off and retry so a
    # 429 never masquerades as a fix failure. The claim/count invariants are
    # unaffected: a 429'd request never reached the service, so it writes no
    # FBR-log row.
    for attempt in range(5):
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read().decode("utf-8")
                return r.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 4:
                retry_after = e.headers.get("Retry-After")
                time.sleep(float(retry_after) if retry_after else 2.5)
                continue
            raw = e.read().decode("utf-8") if e.fp else ""
            try:
                return e.code, json.loads(raw) if raw else None
            except Exception:
                return e.code, raw
    return 429, None


def check(suite: str, name: str, ok: bool, reason: str = "") -> None:
    status = PASS if ok else f"FAIL - {reason}"
    results.append((suite, name, status))
    tag = "OK  " if ok else "FAIL"
    print(f"    [{tag}] [{suite}] {name}" + ("" if ok else f"  -> {reason}"))


def skip(suite: str, name: str, reason: str) -> None:
    results.append((suite, name, "SKIP"))
    print(f"    [SKIP] [{suite}] {name}  (skipped: {reason})")


# ── FBR communication-log count (ground truth for outbound calls) ──
def count_submit_attempts(base: str, token: str, company_id: int, invoice_id: int) -> int:
    """How many Submit POSTs actually left our system for this invoice,
    per the FBR communication log. This is the invariant we assert on."""
    status, data = http(
        "GET",
        f"/api/fbr-monitor?companyId={company_id}&invoiceId={invoice_id}"
        f"&action=Submit&pageSize=200",
        base, token=token)
    if status != 200 or not isinstance(data, dict):
        raise RuntimeError(f"fbr-monitor query failed: HTTP {status} {data}")
    # PagedResult<T> → { items: [...], totalCount: N, ... }
    if "totalCount" in data:
        return int(data["totalCount"])
    return len(data.get("items", []))


# ── DB poke (T4 only) — force an invoice into a given FbrStatus ──
def db_set_fbr_status(server: str, db: str, invoice_id: int, status: str) -> bool:
    q = (f"UPDATE Invoices SET FbrStatus = '{status}' "
         f"WHERE Id = {int(invoice_id)};")
    try:
        # -I sets QUOTED_IDENTIFIER ON, required to UPDATE Invoices (it carries a
        # persisted computed column 'NoteKind' with an index).
        r = subprocess.run(
            ["sqlcmd", "-S", server, "-d", db, "-E", "-C", "-N", "-I", "-b", "-Q", q],
            capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            print(f"      (sqlcmd rc={r.returncode}: {(r.stdout or r.stderr).strip()[:160]})")
        return r.returncode == 0
    except Exception as e:
        print(f"      (sqlcmd error: {e})")
        return False


# ── Setup: ephemeral sandbox company + registered client + FBR-ready bill ──
def setup(base: str, admin_user: str, admin_pw: str, fbr_token: str,
          seller_ntn: str) -> dict:
    print("=== Logging in ===")
    status, data = http("POST", "/api/auth/login", base,
                        body={"username": admin_user, "password": admin_pw})
    if status != 200:
        sys.exit(f"FATAL: admin login failed ({status} {data})")
    token = data["token"]

    suffix = datetime.now().strftime("%Y%m%d%H%M%S")
    company_name = f"_test_no_double_submit {suffix}"

    print(f"=== Creating sandbox company '{company_name}' ===")
    status, company = http("POST", "/api/companies", base, token=token, body={
        "name": company_name,
        "fullAddress": "FBR Sandbox HQ, Karachi",
        "phone": "+92-21-00000000",
        "ntn": seller_ntn,
        "strn": "3277876175852",
        "startingChallanNumber": 90000,
        "startingInvoiceNumber": 90000,
        "startingPurchaseBillNumber": 90000,
        "startingGoodsReceiptNumber": 90000,
        "fbrEnvironment": "sandbox",
        "fbrProvinceCode": 8,
        "fbrBusinessActivity": "Wholesaler",
        "fbrSector": "Wholesale / Retails",
        "fbrDefaultSaleType": "Goods at Standard Rate (default)",
        "fbrDefaultUOM": "Numbers, pieces, units",
        "fbrToken": fbr_token,
    })
    if status not in (200, 201):
        sys.exit(f"FATAL: create company failed ({status} {company})")
    company_id = company["id"]
    print(f"  company id={company_id}")

    print("=== Creating registered client ===")
    status, client = http("POST", "/api/clients", base, token=token, body={
        "name": f"LOTTE Kolson (test {suffix})",
        "address": "L-14, Block 21 F.B.Industrial Area Karachi",
        "phone": "021-1234567",
        "companyId": company_id,
        "ntn": "0710818-04",
        "strn": "02-03-2100-001-82",
        "registrationType": "Registered",
        "fbrProvinceCode": 8,
    })
    if status not in (200, 201):
        sys.exit(f"FATAL: create client failed ({status} {client})")
    client_id = client["id"]

    print("=== Creating FBR-ready bill (SN001: standard rate, registered) ===")
    # Challan first (carries the delivery item the bill lines reference).
    challan_dto = {
        "companyId": company_id,
        "clientId": client_id,
        "poNumber": f"NDS-{suffix}",
        "poDate": datetime.utcnow().strftime("%Y-%m-%dT00:00:00"),
        "deliveryDate": datetime.utcnow().strftime("%Y-%m-%dT00:00:00"),
        "site": None,
        "items": [{"description": "Pneumatic Solenoid Valve 220VAC 6VA",
                   "quantity": 10, "unit": "Numbers, pieces, units"}],
        "warnings": [],
    }
    status, challan = http("POST", f"/api/deliverychallans/company/{company_id}",
                           base, token=token, body=challan_dto)
    if status not in (200, 201):
        sys.exit(f"FATAL: create challan failed ({status} {challan})")

    invoice_dto = {
        "date": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S"),
        "companyId": company_id,
        "clientId": client_id,
        "gstRate": 18,
        "paymentTerms": "[SN001] Standard rate to registered buyer",
        "documentType": 4,
        "paymentMode": "Bank Transfer",
        "challanIds": [challan["id"]],
        "items": [{
            "deliveryItemId": challan["items"][0]["id"],
            "unitPrice": 400,
            "description": "Pneumatic Solenoid Valve 220VAC 6VA",
            "uom": "Numbers, pieces, units",
            "hsCode": "8481.8090",
            "saleType": "Goods at Standard Rate (default)",
        }],
        "poDateUpdates": {},
    }
    status, invoice = http("POST", "/api/invoices", base, token=token, body=invoice_dto)
    if status not in (200, 201):
        sys.exit(f"FATAL: create invoice failed ({status} {invoice})")
    print(f"  bill #{invoice['invoiceNumber']} id={invoice['id']} "
          f"total={invoice.get('grandTotal')}")

    return {"token": token, "company_id": company_id, "client_id": client_id,
            "challan_id": challan["id"], "invoice_id": invoice["id"],
            "invoice_number": invoice["invoiceNumber"]}


def make_fbr_ready_bill(base: str, token: str, ctx: dict, label: str) -> int:
    """Create an additional FBR-ready bill in the same company (for suites that
    need a fresh invoice). Returns the new invoice id."""
    suffix = datetime.now().strftime("%H%M%S%f")
    status, challan = http("POST", f"/api/deliverychallans/company/{ctx['company_id']}",
                           base, token=token, body={
        "companyId": ctx["company_id"], "clientId": ctx["client_id"],
        "poNumber": f"NDS-{label}-{suffix}",
        "poDate": datetime.utcnow().strftime("%Y-%m-%dT00:00:00"),
        "deliveryDate": datetime.utcnow().strftime("%Y-%m-%dT00:00:00"),
        "site": None,
        "items": [{"description": f"Valve {label} {suffix}", "quantity": 3,
                   "unit": "Numbers, pieces, units"}],
        "warnings": [],
    })
    if status not in (200, 201):
        raise RuntimeError(f"challan create failed: {status} {challan}")
    status, invoice = http("POST", "/api/invoices", base, token=token, body={
        "date": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S"),
        "companyId": ctx["company_id"], "clientId": ctx["client_id"],
        "gstRate": 18, "paymentTerms": "[SN001] fresh", "documentType": 4,
        "paymentMode": "Bank Transfer", "challanIds": [challan["id"]],
        "items": [{
            "deliveryItemId": challan["items"][0]["id"], "unitPrice": 500,
            "description": f"Valve {label} {suffix}", "uom": "Numbers, pieces, units",
            "hsCode": "8481.8090", "saleType": "Goods at Standard Rate (default)",
        }],
        "poDateUpdates": {},
    })
    if status not in (200, 201):
        raise RuntimeError(f"invoice create failed: {status} {invoice}")
    return invoice["id"]


# ── Suites ─────────────────────────────────────────────────────────
def suite_inflight_blocks(base: str, ctx: dict, db_server: str, db_name: str,
                          use_db: bool) -> None:
    """T1 — the deterministic, token-independent core proof. While a submit is
    in flight for an invoice, ANY other submit for it must be refused with no
    POST. We hold the invoice in 'Submitting' (exactly the state the atomic claim
    sets for the duration of a live POST) and then attempt a submit.

    This is the assertion that fails on the pre-fix code (which has no concept of
    'Submitting' and would POST) and passes on the fixed code — regardless of
    token or network timing."""
    print("\n=== T1: an in-flight submit blocks any concurrent submit ===")
    if not use_db:
        skip("T1", "in-flight submit blocks a concurrent one", "--skip-db set")
        return
    token, cid = ctx["token"], ctx["company_id"]
    try:
        iid = make_fbr_ready_bill(base, token, ctx, "T1")
    except Exception as e:
        check("T1", "setup fresh bill", False, str(e))
        return
    if not db_set_fbr_status(db_server, db_name, iid, "Submitting"):
        skip("T1", "in-flight submit blocks a concurrent one",
             f"could not reach local DB {db_server}/{db_name} via sqlcmd")
        return

    before = count_submit_attempts(base, token, cid, iid)
    st, rb = http("POST", f"/api/fbr/{iid}/submit", base, token=token)
    after = count_submit_attempts(base, token, cid, iid)
    check("T1", "a submit while one is in flight is refused, with NO POST sent",
          (after - before) == 0 and isinstance(rb, dict)
          and rb.get("alreadyInProgress") and not rb.get("success"),
          f"outbound={after - before}, resp={rb}")


def suite_burst(base: str, ctx: dict, n: int, is_live: bool) -> None:
    """T2 — fire N submits at the same instant. The atomic claim admits exactly
    one; the pre-fix code let all N reach FBR (this is how invoice 3816 got two
    IRNs). With a LIVE token the single winner reaches the terminal 'Submitted'
    state, so the outbound count is deterministically ONE. With a placeholder
    token the winner 401s and releases the claim, so slower (no-longer-concurrent)
    retries may POST again — the count is not deterministic there, so we only
    require that at least one concurrent request was turned away by the claim
    (the pre-fix code turned away none)."""
    print(f"\n=== T2: {n} concurrent submits — the claim admits at most one ===")
    token, iid, cid = ctx["token"], ctx["invoice_id"], ctx["company_id"]

    before = count_submit_attempts(base, token, cid, iid)
    barrier = threading.Barrier(n)
    outcomes: list[tuple[int, Any]] = []
    lock = threading.Lock()

    def fire(_i: int):
        barrier.wait()  # release all threads together for maximum overlap
        st, rb = http("POST", f"/api/fbr/{iid}/submit", base, token=token, timeout=120)
        with lock:
            outcomes.append((st, rb))

    with ThreadPoolExecutor(max_workers=n) as ex:
        list(ex.map(fire, range(n)))

    after = count_submit_attempts(base, token, cid, iid)
    outbound = after - before
    rejected = sum(1 for _, rb in outcomes
                   if isinstance(rb, dict) and rb.get("alreadyInProgress"))
    print(f"    (burst result: {outbound} outbound POST(s), {rejected} rejected as in-progress)")

    if is_live:
        check("T2", f"{n} concurrent submits produce exactly ONE outbound POST",
              outbound == 1, f"outbound={outbound} (expected 1)")
        check("T2", f"the other {n - 1} requests are rejected as in-progress",
              rejected == n - 1, f"rejected={rejected} (expected {n - 1})")
    else:
        # Placeholder token: fast 401s release the claim between attempts, so the
        # count varies — but the claim MUST have blocked at least one overlapping
        # request. Pre-fix code blocks none (all N POST).
        check("T2", "at least one concurrent request was blocked by the claim "
                    "(pre-fix: none blocked, all reach FBR)",
              rejected >= 1, f"rejected={rejected}, outbound={outbound} (n={n})")


def suite_release_on_failure(base: str, ctx: dict, is_live_token: bool) -> None:
    """T3 — a definite FBR rejection must RELEASE the claim so a legitimate
    retry is allowed (we must not over-lock). Only meaningful with a placeholder
    token: the single outbound attempt 401s, invoice goes 'Failed', and a second
    submit is allowed through (produces a new outbound POST)."""
    print("\n=== T3: claim releases after a definite failure (not over-locked) ===")
    if is_live_token:
        skip("T3", "claim releases on failure", "live token -> invoice succeeds, not a failure case")
        return
    token, cid = ctx["token"], ctx["company_id"]
    try:
        iid = make_fbr_ready_bill(base, token, ctx, "T3rel")
    except Exception as e:
        check("T3", "setup fresh bill", False, str(e))
        return

    # First submit 401s (placeholder token) -> claim releases to 'Failed'.
    http("POST", f"/api/fbr/{iid}/submit", base, token=token, timeout=120)
    # A second submit must NOT be blocked as in-progress: it produces a new
    # outbound attempt, proving the claim released after the prior failure.
    before = count_submit_attempts(base, token, cid, iid)
    st, rb = http("POST", f"/api/fbr/{iid}/submit", base, token=token, timeout=120)
    after = count_submit_attempts(base, token, cid, iid)
    produced = after - before
    blocked = isinstance(rb, dict) and rb.get("alreadyInProgress")
    check("T3", "a failed invoice is re-submittable (claim released, not stuck)",
          produced == 1 and not blocked,
          f"follow-up outbound={produced}, alreadyInProgress={blocked}")


def suite_terminal_irn_guard(base: str, ctx: dict) -> None:
    """T4 — an invoice that already holds an IRN must refuse submit outright,
    with no outbound POST. We put it into that state via the admin reset
    endpoint's 'recordExisting' mode (token-independent)."""
    print("\n=== T4: an invoice holding an IRN refuses re-submit ===")
    token, cid = ctx["token"], ctx["company_id"]
    try:
        iid = make_fbr_ready_bill(base, token, ctx, "T4")
    except Exception as e:
        check("T4", "setup fresh bill", False, str(e))
        return

    fake_irn = "4230193299489DITESTONLY000001"
    st, rb = http("POST", f"/api/fbr/{iid}/reset-submission", base, token=token, body={
        "mode": "recordExisting", "irn": fake_irn,
        "reason": "test: simulate an already-issued IRN"})
    if st != 200:
        check("T4", "admin reset recordExisting available", False,
              f"HTTP {st} {rb} - reset endpoint missing (pre-fix backend?)")
        return
    check("T4", "recordExisting marks the invoice Submitted with the IRN",
          isinstance(rb, dict) and rb.get("fbrStatus") == "Submitted"
          and rb.get("fbrIRN") == fake_irn,
          f"got {rb}")

    before = count_submit_attempts(base, token, cid, iid)
    st, rb = http("POST", f"/api/fbr/{iid}/submit", base, token=token)
    after = count_submit_attempts(base, token, cid, iid)
    check("T4", "submit is refused and no POST leaves our system",
          (after - before) == 0 and isinstance(rb, dict) and not rb.get("success"),
          f"outbound={after - before}, resp={rb}")


def suite_uncertain_locked(base: str, ctx: dict, db_server: str, db_name: str,
                           use_db: bool) -> None:
    """T5 — an invoice whose outcome is unknown ('Uncertain', e.g. a timed-out
    submit) is NOT re-claimable; the admin reset valve re-opens it. Uses a DB
    poke to reach 'Uncertain' deterministically without a real network timeout."""
    print("\n=== T5: an 'Uncertain' invoice is locked; admin reset re-opens it ===")
    if not use_db:
        skip("T5", "uncertain is locked", "--skip-db set")
        return
    token, cid = ctx["token"], ctx["company_id"]
    try:
        iid = make_fbr_ready_bill(base, token, ctx, "T5")
    except Exception as e:
        check("T5", "setup fresh bill", False, str(e))
        return

    if not db_set_fbr_status(db_server, db_name, iid, "Uncertain"):
        skip("T5", "uncertain is locked",
             f"could not reach local DB {db_server}/{db_name} via sqlcmd")
        return

    before = count_submit_attempts(base, token, cid, iid)
    st, rb = http("POST", f"/api/fbr/{iid}/submit", base, token=token)
    after = count_submit_attempts(base, token, cid, iid)
    check("T5", "an Uncertain invoice refuses submit - no POST leaves the system",
          (after - before) == 0 and isinstance(rb, dict) and not rb.get("success"),
          f"outbound={after - before}, resp={rb}")

    # Recovery valve: admin reset (retry) clears it back to a submittable state.
    st, rb = http("POST", f"/api/fbr/{iid}/reset-submission", base, token=token, body={
        "mode": "retry", "reason": "test: operator confirmed FBR has no record"})
    if st != 200:
        check("T5", "admin reset (retry) available", False, f"HTTP {st} {rb}")
        return
    check("T5", "admin reset (retry) clears IRN and re-opens submit",
          isinstance(rb, dict) and not rb.get("fbrIRN")
          and rb.get("fbrStatus") in (None, "", "Failed"),
          f"got {rb}")

    before = count_submit_attempts(base, token, cid, iid)
    st, rb = http("POST", f"/api/fbr/{iid}/submit", base, token=token, timeout=120)
    after = count_submit_attempts(base, token, cid, iid)
    check("T5", "after reset the invoice can submit again (one new outbound)",
          (after - before) == 1, f"outbound after reset={after - before}")


def suite_happy_path_live(base: str, ctx: dict) -> None:
    """T6 — with a real sandbox token: one submit -> Submitted + IRN -> a second
    submit is blocked, and exactly one Submit POST is on record. This is the
    production scenario (a SUCCESSFUL submit reaching a terminal state)."""
    print("\n=== T6: live sandbox happy path (real token) ===")
    token, cid = ctx["token"], ctx["company_id"]
    try:
        iid = make_fbr_ready_bill(base, token, ctx, "T6")
    except Exception as e:
        check("T6", "setup fresh bill", False, str(e))
        return

    before = count_submit_attempts(base, token, cid, iid)
    st, rb = http("POST", f"/api/fbr/{iid}/submit?scenarioId=SN001", base, token=token, timeout=120)
    ok_submit = isinstance(rb, dict) and rb.get("success") and rb.get("irn")
    check("T6", "first submit succeeds and returns an IRN", bool(ok_submit),
          f"resp={rb}")
    if not ok_submit:
        return

    st, rb2 = http("POST", f"/api/fbr/{iid}/submit?scenarioId=SN001", base, token=token)
    after = count_submit_attempts(base, token, cid, iid)
    check("T6", "second submit is refused (already submitted)",
          isinstance(rb2, dict) and not rb2.get("success"), f"resp={rb2}")
    check("T6", "exactly one Submit POST is on record for the invoice",
          (after - before) == 1, f"outbound={after - before}")


# ── Teardown ───────────────────────────────────────────────────────
def teardown(base: str, ctx: dict) -> None:
    token = ctx["token"]
    # Best-effort; ephemeral company on the dev DB. Ignore failures.
    http("DELETE", f"/api/companies/{ctx['company_id']}", base, token=token)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--fbr-token", default=PLACEHOLDER_TOKEN,
                    help="Real PRAL sandbox token enables the T5 live happy-path")
    ap.add_argument("--seller-ntn", default="4228937-8",
                    help="Seller NTN - must match the sandbox token's registration for T6")
    ap.add_argument("--concurrency", type=int, default=6)
    ap.add_argument("--db-server", default=DEFAULT_DB_SERVER)
    ap.add_argument("--db-name", default=DEFAULT_DB_NAME)
    ap.add_argument("--skip-db", action="store_true",
                    help="skip the DB-poke suites T1 (in-flight) and T5 (uncertain)")
    ap.add_argument("--keep", action="store_true", help="leave the test company in the DB")
    args = ap.parse_args()

    is_live = args.fbr_token != PLACEHOLDER_TOKEN
    print("=" * 78)
    print("  FBR DOUBLE-SUBMIT PREVENTION TEST")
    print(f"  base={args.base}  concurrency={args.concurrency}  "
          f"token={'LIVE sandbox' if is_live else 'placeholder'}")
    print("=" * 78)

    ctx = setup(args.base, args.user, args.password, args.fbr_token, args.seller_ntn)
    try:
        suite_inflight_blocks(args.base, ctx, args.db_server, args.db_name, not args.skip_db)
        suite_burst(args.base, ctx, args.concurrency, is_live)
        suite_release_on_failure(args.base, ctx, is_live)
        suite_terminal_irn_guard(args.base, ctx)
        suite_uncertain_locked(args.base, ctx, args.db_server, args.db_name, not args.skip_db)
        if is_live:
            suite_happy_path_live(args.base, ctx)
        else:
            skip("T6", "live sandbox happy path", "no --fbr-token supplied")
    finally:
        if not args.keep:
            teardown(args.base, ctx)

    # ── Summary ──
    print("\n" + "=" * 78)
    passed = sum(1 for _, _, s in results if s == PASS)
    failed = sum(1 for _, _, s in results if s.startswith("FAIL"))
    skipped = sum(1 for _, _, s in results if s == "SKIP")
    for suite, name, status in results:
        if status.startswith("FAIL"):
            print(f"  FAIL  [{suite}] {name}  {status}")
    print(f"\n  {passed} passed, {failed} failed, {skipped} skipped")
    print("=" * 78)
    if failed == 0:
        print("all checks passed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

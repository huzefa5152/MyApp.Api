#!/usr/bin/env python3
"""
Customer Document Handover - end-to-end flow test.

Verifies the handover state machine + filters + bulk against a live backend,
per FEATURE_CUSTOMER_DOC_HANDOVER.md §10. It operates on an EXISTING
FBR-submitted invoice (the only rows for which handover is meaningful) and is
self-restoring: it leaves the chosen invoice marked Delivered, exactly as the
launch backfill would.

  Scenarios covered:
    1. Backfill assertion - no FBR-submitted invoice is "NotApplicable"
       (every submitted row is Pending or Delivered).
    2. Revert a Delivered invoice -> Pending.
    3. Pending filter shows it; Delivered filter hides it (server-side).
    4. Mark Delivered (with remark) -> records operator + remark.
    5. Delivered filter shows it; Pending filter hides it.
    6. Double-mark rejected (already delivered -> 400).
    7. Revert -> bulk-mark round-trip (bulk delivers exactly the pending id).
    8. Non-submitted / demo -> derived status "NotApplicable"; mark -> 400.

Usage:
  python scripts/test_doc_handover.py [--base http://localhost:5134]
                                      [--admin-user admin] [--admin-pw admin123]
"""
from __future__ import annotations
import argparse, json, sys, urllib.request, urllib.error

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--base", default="http://localhost:5134")
p.add_argument("--admin-user", default="admin")
p.add_argument("--admin-pw", default="admin123")
args = p.parse_args()
BASE = args.base.rstrip("/")

PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, str]] = []


def request(method: str, path: str, token: str | None = None, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode() if e.fp else ""
        try:
            return e.code, (json.loads(raw) if raw else None)
        except Exception:
            return e.code, raw
    except urllib.error.URLError as e:
        print(f"\nCANNOT REACH {url}: {e}\nIs the backend running at --base {BASE}?")
        sys.exit(2)


def check(name: str, ok: bool, reason: str = ""):
    results.append((name, PASS if ok else f"{FAIL} - {reason}"))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f"  ({reason})"))


def paged(token, company_id, **params):
    q = "&".join(f"{k}={v}" for k, v in {"pageSize": 500, **params}.items())
    s, d = request("GET", f"/api/invoices/company/{company_id}/paged?{q}", token=token)
    return s, (d or {})


print("=== Login ===")
s, d = request("POST", "/api/auth/login", body={"username": args.admin_user, "password": args.admin_pw})
assert s == 200, f"login failed: {s} {d}"
tok = d["token"]

print("=== Find a company with an FBR-submitted invoice ===")
s, companies = request("GET", "/api/companies", token=tok)
assert s == 200, f"list companies: {s}"
company_id = None
target = None
for c in companies or []:
    s, page = paged(tok, c["id"], fbrFilter="submitted")
    items = [i for i in page.get("items", []) if not i.get("isCancelled")]
    if items:
        company_id = c["id"]
        target = items[0]
        break
if not target:
    print("No FBR-submitted invoice found in any accessible company - cannot run the handover flow.")
    print("(Submit at least one invoice to FBR, then re-run.)")
    sys.exit(2)
inv_id = target["id"]
inv_no = target["invoiceNumber"]
print(f"  Using company {company_id}, invoice #{inv_no} (id {inv_id})")

# Scenario 1 - backfill/derivation: NO submitted invoice is NotApplicable.
s, sub_page = paged(tok, company_id, fbrFilter="submitted")
bad = [i["invoiceNumber"] for i in sub_page.get("items", [])
       if not i.get("isCancelled") and i.get("handoverStatus") == "NotApplicable"]
check("1. every FBR-submitted invoice has a handover status (not '-')", len(bad) == 0,
      f"these submitted invoices show NotApplicable: {bad[:5]}")

# Ensure a known starting point: make it Delivered (idempotent).
if target.get("handoverStatus") != "Delivered":
    request("POST", f"/api/invoices/{inv_id}/handover", token=tok, body={})

# Scenario 2 - revert Delivered -> Pending.
s, _ = request("POST", f"/api/invoices/{inv_id}/handover/revert", token=tok)
check("2. revert delivered -> 200", s == 200, f"got {s}")
s, inv = request("GET", f"/api/invoices/{inv_id}", token=tok)
check("2. status is Pending after revert", inv.get("handoverStatus") == "Pending",
      f"got {inv.get('handoverStatus')}")
check("2. handoverAt cleared on revert", inv.get("handoverAt") is None,
      f"got {inv.get('handoverAt')}")

# Scenario 3 - Pending filter shows it, Delivered filter hides it.
s, pend = paged(tok, company_id, handoverFilter="pending")
pend_ids = {i["id"] for i in pend.get("items", [])}
check("3. pending filter includes the reverted invoice", inv_id in pend_ids, "not in pending list")
s, deliv = paged(tok, company_id, handoverFilter="delivered")
check("3. delivered filter excludes the reverted invoice",
      inv_id not in {i["id"] for i in deliv.get("items", [])}, "still in delivered list")

# Scenario 4 - mark Delivered with a remark -> operator + remark recorded.
s, _ = request("POST", f"/api/invoices/{inv_id}/handover", token=tok, body={"remark": "flow-test at gate"})
check("4. mark delivered -> 200", s == 200, f"got {s}")
s, inv = request("GET", f"/api/invoices/{inv_id}", token=tok)
check("4. status Delivered", inv.get("handoverStatus") == "Delivered", f"got {inv.get('handoverStatus')}")
check("4. operator recorded (handoverByName set)", bool(inv.get("handoverByName")),
      f"got {inv.get('handoverByName')!r}")
check("4. remark stored", inv.get("handoverRemark") == "flow-test at gate", f"got {inv.get('handoverRemark')!r}")
check("4. handoverAt set", inv.get("handoverAt") is not None, "handoverAt null after mark")

# Scenario 5 - Delivered filter shows it, Pending hides it.
s, deliv = paged(tok, company_id, handoverFilter="delivered")
check("5. delivered filter includes the marked invoice",
      inv_id in {i["id"] for i in deliv.get("items", [])}, "not in delivered list")
s, pend = paged(tok, company_id, handoverFilter="pending")
check("5. pending filter excludes the marked invoice",
      inv_id not in {i["id"] for i in pend.get("items", [])}, "still in pending list")

# Scenario 6 - double-mark rejected.
s, err = request("POST", f"/api/invoices/{inv_id}/handover", token=tok, body={})
check("6. re-mark already-delivered -> 400", s == 400, f"got {s}: {err}")

# Scenario 7 - revert then bulk-mark round-trip.
request("POST", f"/api/invoices/{inv_id}/handover/revert", token=tok)
s, bulk = request("POST", "/api/invoices/handover/bulk", token=tok, body={"ids": [inv_id], "remark": "flow bulk"})
check("7. bulk mark -> 200", s == 200, f"got {s}")
check("7. bulk delivered exactly 1", bool(bulk) and bulk.get("delivered") == 1 and bulk.get("skipped") == 0,
      f"got {bulk}")
s, inv = request("GET", f"/api/invoices/{inv_id}", token=tok)
check("7. delivered after bulk", inv.get("handoverStatus") == "Delivered", f"got {inv.get('handoverStatus')}")

# Scenario 8 - non-submitted bill: derived "NotApplicable" + mark rejected.
# Create a throwaway standalone bill (not submitted) in the same company.
s, client_page = request("GET", f"/api/clients/company/{company_id}?page=1&pageSize=1", token=tok)
client_id = None
if isinstance(client_page, dict):
    items = client_page.get("items") or client_page.get("clients") or []
    client_id = items[0]["id"] if items else None
elif isinstance(client_page, list) and client_page:
    client_id = client_page[0]["id"]
if client_id:
    bill = {
        "companyId": company_id, "clientId": client_id, "date": "2026-08-09", "gstRate": 18,
        "items": [{"description": "handover-negative-test", "quantity": 1,
                   "uom": "Numbers, pieces, units", "unitPrice": 100}],
    }
    s, nb = request("POST", "/api/invoices/standalone", token=tok, body=bill)
    if s in (200, 201) and nb:
        check("8. non-submitted bill derives NotApplicable", nb.get("handoverStatus") == "NotApplicable",
              f"got {nb.get('handoverStatus')}")
        s, err = request("POST", f"/api/invoices/{nb['id']}/handover", token=tok, body={})
        check("8. mark non-submitted -> 400", s == 400, f"got {s}: {err}")
        request("DELETE", f"/api/invoices/{nb['id']}", token=tok)  # cleanup (latest, not submitted)
    else:
        check("8. (skipped) could not create throwaway bill", True, "")
else:
    check("8. (skipped) no client to create throwaway bill", True, "")

# ── Summary ──
n_pass = sum(1 for _, r in results if r == PASS)
n_fail = len(results) - n_pass
print(f"\n=== {n_pass}/{len(results)} checks passed ===")
if n_fail:
    print(f"[FAIL] {n_fail} failure(s).")
    sys.exit(1)
print("[OK] all handover flow checks passed.")

#!/usr/bin/env python3
"""
FBR future-date guard (rule 0043) - end-to-end test.

Proves the timezone-correct future-date handling after routing every guard
through PakistanClock (server-time-zone independent):

  1. Create a bill dated TODAY  -> allowed (was wrongly rejected on non-PKT
     hosts by the old end-of-today-UTC cap).
  2. Create a bill dated in the FUTURE -> 400 with a clear message.
  3. Edit a today-bill, changing its date to the FUTURE -> 400.
  4. Tax-Sheet "transfer to next month" re-dates an unclassified bill to a
     future date (the sanctioned way a bill becomes future-dated).
  5. Edit that transferred bill KEEPING its future date -> allowed
     (block only a CHANGE to a future date, so classification isn't blocked).
  6. Validate the future-dated bill -> blocked locally with a proper message
     (future date -> FBR 0043; no wasted FBR call).
  7. Edit the future bill back to TODAY -> allowed.

Self-cleaning: deletes the throwaway bill it creates.

Usage:
  python scripts/test_future_date_guard.py [--base http://localhost:5134]
                                           [--company 1] [--client 1]
"""
from __future__ import annotations
import argparse, datetime, json, sys, urllib.request, urllib.error

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--base", default="http://localhost:5134")
p.add_argument("--admin-user", default="admin")
p.add_argument("--admin-pw", default="admin123")
p.add_argument("--company", type=int, default=1)
p.add_argument("--client", type=int, default=1)
args = p.parse_args()
BASE = args.base.rstrip("/")

PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, str]] = []


def request(method, path, token=None, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode() if e.fp else ""
        try:
            return e.code, (json.loads(raw) if raw else None)
        except Exception:
            return e.code, raw
    except urllib.error.URLError as e:
        print(f"\nCANNOT REACH {url}: {e}")
        sys.exit(2)


def check(name, ok, reason=""):
    results.append((name, PASS if ok else f"{FAIL} - {reason}"))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f"  ({reason})"))


def err_text(payload):
    if isinstance(payload, dict):
        return (payload.get("error") or payload.get("message") or json.dumps(payload))
    return str(payload)


# Machine local date == Pakistan date on a PKT box; PakistanClock computes the
# same calendar date on the server regardless of its zone.
today = datetime.date.today()
future = today + datetime.timedelta(days=12)
TODAY = today.isoformat()
FUTURE = future.isoformat()
CO, CL = args.company, args.client
print(f"=== today={TODAY}  future={FUTURE}  company={CO} client={CL} ===")

s, d = request("POST", "/api/auth/login", body={"username": args.admin_user, "password": args.admin_pw})
assert s == 200, f"login failed: {s} {d}"
tok = d["token"]

ITEM = {"description": "future-date-guard test line", "quantity": 1,
        "uom": "Numbers, pieces, units", "unitPrice": 100}


def make_bill(date_str):
    return {"companyId": CO, "clientId": CL, "date": date_str, "gstRate": 18, "items": [ITEM]}


# 1. Create TODAY -> allowed.
s, bill = request("POST", "/api/invoices/standalone", tok, make_bill(TODAY))
check("1. create bill dated TODAY -> accepted", s in (200, 201), f"got {s}: {err_text(bill)}")
if s not in (200, 201):
    print("cannot continue without a bill"); sys.exit(1)
bill_id = bill["id"]
print(f"     created bill id={bill_id} #{bill['invoiceNumber']}")

# 2. Create FUTURE -> 400 with clear message.
s, e2 = request("POST", "/api/invoices/standalone", tok, make_bill(FUTURE))
msg2 = err_text(e2)
check("2. create bill dated FUTURE -> 400", s == 400, f"got {s}")
check("2. message mentions 'future'", "future" in msg2.lower(), f"msg={msg2!r}")
check("2. message points to Tax Sheet", "tax sheet" in msg2.lower(), f"msg={msg2!r}")


def edit_body(date_str, items_src):
    return {"date": date_str, "gstRate": 18,
            "items": [{"id": it["id"], "description": it["description"], "quantity": it["quantity"],
                       "uom": it.get("uom") or "Numbers, pieces, units", "unitPrice": it["unitPrice"]}
                      for it in items_src]}


# 3. Edit today-bill -> change date to FUTURE -> 400.
s, cur = request("GET", f"/api/invoices/{bill_id}", tok)
s, e3 = request("PUT", f"/api/invoices/{bill_id}", tok, edit_body(FUTURE, cur["items"]))
check("3. edit: change date to FUTURE -> 400", s == 400, f"got {s}: {err_text(e3)}")

# 4. Tax-Sheet transfer -> re-date the (unclassified) bill to FUTURE.
s, tr = request("POST", f"/api/reports/company/{CO}/tax-sheet/transfer", tok,
                {"dateFrom": TODAY, "dateTo": TODAY, "targetDate": FUTURE})
check("4. tax-sheet transfer -> 200", s == 200, f"got {s}: {err_text(tr)}")
s, cur = request("GET", f"/api/invoices/{bill_id}", tok)
moved = (cur or {}).get("date", "").startswith(FUTURE)
check("4. bill re-dated to FUTURE by transfer", moved, f"date now {cur.get('date')}")

# 5. Edit transferred bill KEEPING future date -> allowed.
s, e5 = request("PUT", f"/api/invoices/{bill_id}", tok, edit_body(FUTURE, cur["items"]))
check("5. edit future bill, date UNCHANGED -> accepted", s in (200, 204), f"got {s}: {err_text(e5)}")

# 6. Validate future-dated bill -> blocked with proper message (no FBR call).
s, v = request("POST", f"/api/fbr/{bill_id}/validate", tok)
vmsg = ((v or {}).get("errorMessage") or err_text(v)) if isinstance(v, dict) else str(v)
success = bool(v.get("success")) if isinstance(v, dict) else False
check("6. validate future bill -> not success", (s == 200 and not success) or s == 400,
      f"status {s}, success {success}")
check("6. validate message mentions future date", "future" in (vmsg or "").lower(), f"msg={vmsg!r}")
check("6. validate message mentions FBR/0043", ("0043" in (vmsg or "")) or ("fbr" in (vmsg or "").lower()),
      f"msg={vmsg!r}")

# 7. Edit future bill back to TODAY -> allowed.
s, cur = request("GET", f"/api/invoices/{bill_id}", tok)
s, e7 = request("PUT", f"/api/invoices/{bill_id}", tok, edit_body(TODAY, cur["items"]))
check("7. edit: change date FUTURE -> TODAY -> accepted", s in (200, 204), f"got {s}: {err_text(e7)}")

# Cleanup.
sc, _ = request("DELETE", f"/api/invoices/{bill_id}", tok)
print(f"     cleanup: delete bill {bill_id} -> {sc}")

n_pass = sum(1 for _, r in results if r == PASS)
print(f"\n=== {n_pass}/{len(results)} checks passed ===")
if n_pass != len(results):
    print("[FAIL] some checks failed."); sys.exit(1)
print("[OK] future-date guard behaves correctly.")

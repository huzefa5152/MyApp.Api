"""One company never holds two customers, or two suppliers, of one name.

- Simultaneous saves of one name: exactly one is created. The name check used to
  run before the insert with no lock, so a double-click made two identical
  customers 65 ms apart.
- A name differing only by case or outer spaces is refused, on create and rename.
- Names are stored trimmed.

    python scripts/test_party_name_guard.py --base http://localhost:5134
"""
import argparse
import json
import sys
import threading
import urllib.error
import urllib.request
import uuid

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://localhost:5134")
ap.add_argument("--admin-user", default="admin")
ap.add_argument("--admin-pw", default="admin123")
args = ap.parse_args()
BASE = args.base.rstrip("/")
results: list[tuple[str, bool, str]] = []


def call(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f"  -- {detail}"))


s, d = call("POST", "/api/auth/login", body={"username": args.admin_user, "password": args.admin_pw})
assert s == 200, f"login: {s} {d}"
tok = d["token"]
tag = uuid.uuid4().hex[:6].upper()
s, co = call("POST", "/api/companies", tok, {
    "name": f"Party Guard Test {tag}", "fullAddress": "Test HQ", "phone": "+92-21-0000000",
    "ntn": "1234567", "cnic": "1234567890123", "strn": "1234567890123", "fbrSellerRegistrationNo": "1234567",
    "startingChallanNumber": 1, "startingInvoiceNumber": 1, "startingPurchaseBillNumber": 1,
    "startingGoodsReceiptNumber": 1, "fbrEnvironment": "sandbox", "fbrProvinceCode": 8})
assert s in (200, 201), f"create company: {s} {co}"
cid = co["id"]

for kind in ("clients", "suppliers"):
    name = f"Guard {kind[:-1].title()} {tag}"

    # Six simultaneous creates of one name.
    statuses = []
    barrier = threading.Barrier(6)

    def create():
        barrier.wait()
        statuses.append(call("POST", f"/api/{kind}", tok, {"name": name, "companyId": cid})[0])

    threads = [threading.Thread(target=create) for _ in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    s, rows = call("GET", f"/api/{kind}/company/{cid}", tok)
    same = [r for r in (rows or []) if r["name"].strip().lower() == name.lower()]
    check(f"{kind}: six simultaneous saves of one name create exactly one",
          len(same) == 1 and sum(1 for x in statuses if x in (200, 201)) == 1, f"statuses={statuses} rows={len(same)}")

    s, _ = call("POST", f"/api/{kind}", tok, {"name": f"  {name.upper()}  ", "companyId": cid})
    check(f"{kind}: the same name in other case with outer spaces is refused", s in (400, 409), str(s))

    s, padded = call("POST", f"/api/{kind}", tok, {"name": f"  Padded {kind} {tag}  ", "companyId": cid})
    check(f"{kind}: a padded name is stored trimmed",
          s in (200, 201) and padded.get("name") == f"Padded {kind} {tag}", f"{s} {padded}")

    other = {**padded, "name": f" {name.lower()} "}
    s, _ = call("PUT", f"/api/{kind}/{padded['id']}", tok, other)
    check(f"{kind}: renaming another record to that name is refused", s in (400, 409), str(s))

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} party name guard checks passed")
if failed:
    print(f"Test company {cid} kept for inspection.")
    sys.exit(1)
print("all checks passed")

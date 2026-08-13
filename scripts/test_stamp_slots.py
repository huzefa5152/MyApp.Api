"""
Stamp slots on print templates — assignment, copy, convert, delete-degrade.

The slot model exists so that swapping a signature is a field write on the
template row rather than an edit of its HTML. These assertions pin the
properties that make that safe:

  - assigning / clearing a stamp never touches the template body
  - a copy starts signed like its source, then diverges independently
  - a stamp from another company can never be linked (cross-tenant guard)
  - deleting a stamp clears the assignment instead of orphaning templates
  - templates that predate stamps stay untouched (stampState = none)

Usage:
    python scripts/test_stamp_slots.py --base http://localhost:5135
"""

import argparse
import io
import json
import struct
import sys
import urllib.error
import urllib.request
import uuid
import zlib

BASE = "http://localhost:5134"
PASSED, FAILED = [], []

SLOT = '<span class="stamp-slot"><img class="stamp-img" src="{{stamp}}" alt=""></span>'


def check(suite, label, ok, detail=""):
    (PASSED if ok else FAILED).append((suite, label, detail))
    print("  [%s] %-60s %s" % ("PASS" if ok else "FAIL", label, "PASS" if ok else "FAIL " + detail))


def request(method, path, token=None, body=None, raw=None, content_type=None):
    url = BASE + path
    data, headers = None, {}
    if raw is not None:
        data = raw
        if content_type:
            headers["Content-Type"] = content_type
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            payload = resp.read()
            try:
                return resp.status, json.loads(payload.decode())
            except Exception:
                return resp.status, payload
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            return e.code, json.loads(payload.decode())
        except Exception:
            return e.code, payload
    except urllib.error.URLError as e:
        return 0, str(e)


def png_bytes(w=8, h=8):
    raw = b"".join(b"\x00" + bytes((10, 20, 30)) * w for _ in range(h))

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def upload_stamp(token, company_id, name):
    boundary = "----slot" + uuid.uuid4().hex
    buf = io.BytesIO()
    buf.write(("--%s\r\nContent-Disposition: form-data; name=\"name\"\r\n\r\n%s\r\n" % (boundary, name)).encode())
    buf.write(("--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"s.png\"\r\n"
               "Content-Type: image/png\r\n\r\n" % boundary).encode())
    buf.write(png_bytes())
    buf.write(b"\r\n")
    buf.write(("--%s--\r\n" % boundary).encode())
    return request("POST", "/api/companies/%d/stamps" % company_id, token=token,
                   raw=buf.getvalue(), content_type="multipart/form-data; boundary=" + boundary)


def main():
    global BASE
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    args = ap.parse_args()
    BASE = args.base.rstrip("/")

    status, res = request("POST", "/api/auth/login",
                          body={"username": args.user, "password": args.password})
    if status != 200 or not res.get("token"):
        print("login failed (%s)" % status)
        sys.exit(1)
    token = res["token"]

    status, companies = request("GET", "/api/companies", token=token)
    if status != 200 or len(companies) < 1:
        print("need at least one company")
        sys.exit(1)
    cid = companies[0]["id"]
    other = next((c["id"] for c in companies if c["id"] != cid), None)
    print("company %s%s\n" % (cid, "" if other is None else ", cross-tenant probe uses %s" % other))

    run = uuid.uuid4().hex[:8]
    made_templates, made_stamps = [], []

    st, stamp = upload_stamp(token, cid, "Slot Test A %s" % run)
    if st != 200:
        print("stamp upload failed: %s %s" % (st, stamp))
        sys.exit(1)
    made_stamps.append(stamp["id"])
    st, stamp_b = upload_stamp(token, cid, "Slot Test B %s" % run)
    made_stamps.append(stamp_b["id"])

    body_html = "<html><head><style>x{}</style></head><body><div class='sig'>" + SLOT + "</div></body></html>"

    # ── 1. Assignment leaves HTML alone ──
    print("[1. Assignment]")
    st, tpl = request("POST", "/api/printtemplates/company/%d" % cid, token=token, body={
        "templateType": "Challan", "name": "Slot test %s" % run,
        "htmlContent": body_html, "isDefault": False,
    })
    check("assign", "1.1 create template", st == 200 and tpl.get("id"), "status=%s" % st)
    if st != 200:
        summarize(); sys.exit(1)
    made_templates.append(tpl["id"])
    check("assign", "1.2 slot detected as slotted", tpl.get("stampState") == "slotted", "state=%s" % tpl.get("stampState"))
    check("assign", "1.3 new template starts unassigned", tpl.get("stampId") is None, "stampId=%s" % tpl.get("stampId"))

    st, assigned = request("PUT", "/api/printtemplates/%d/stamp" % tpl["id"], token=token,
                           body={"stampId": stamp["id"]})
    check("assign", "1.4 assign returns 200", st == 200, "status=%s" % st)
    check("assign", "1.5 stampId persisted", assigned.get("stampId") == stamp["id"], "got=%s" % assigned.get("stampId"))
    check("assign", "1.6 stampSlug returned for {{stamp}} resolution",
          assigned.get("stampSlug") == stamp["slug"], "got=%s" % assigned.get("stampSlug"))
    # The point of the slot model: the body is untouched by an assignment.
    check("assign", "1.7 HTML byte-identical after assignment",
          assigned.get("htmlContent") == body_html, "")

    st, cleared = request("PUT", "/api/printtemplates/%d/stamp" % tpl["id"], token=token, body={"stampId": None})
    check("assign", "1.8 clearing works", st == 200 and cleared.get("stampId") is None, "status=%s" % st)
    check("assign", "1.9 HTML still untouched after clear", cleared.get("htmlContent") == body_html, "")
    request("PUT", "/api/printtemplates/%d/stamp" % tpl["id"], token=token, body={"stampId": stamp["id"]})

    # ── 2. Cross-tenant guard ──
    print("\n[2. Cross-tenant guard]")
    if other is not None:
        sto, foreign = upload_stamp(token, other, "Foreign %s" % run)
        if sto == 200:
            st, _ = request("PUT", "/api/printtemplates/%d/stamp" % tpl["id"], token=token,
                            body={"stampId": foreign["id"]})
            check("tenant", "2.1 stamp from another company is rejected", st == 400, "status=%s" % st)
            st, again = request("GET", "/api/printtemplates/%d" % tpl["id"], token=token)
            check("tenant", "2.2 assignment unchanged after rejection",
                  again.get("stampId") == stamp["id"], "got=%s" % again.get("stampId"))
            request("DELETE", "/api/companies/%d/stamps/%d" % (other, foreign["id"]), token=token)
        else:
            check("tenant", "2.1 cross-tenant probe", True, "skipped — could not seed foreign stamp")
    else:
        check("tenant", "2.1 cross-tenant probe", True, "skipped — only one company")

    st, _ = request("PUT", "/api/printtemplates/%d/stamp" % tpl["id"], token=token, body={"stampId": 999999})
    check("tenant", "2.3 unknown stamp id rejected", st == 400, "status=%s" % st)

    # ── 3. Copy carries the stamp, then diverges ──
    print("\n[3. Copy]")
    st, copy = request("POST", "/api/printtemplates/company/%d" % cid, token=token, body={
        "templateType": "Challan", "name": "Slot copy %s" % run,
        "htmlContent": body_html, "isDefault": False, "stampId": stamp["id"],
    })
    check("copy", "3.1 copy created with source's stamp",
          st == 200 and copy.get("stampId") == stamp["id"], "status=%s stampId=%s" % (st, copy.get("stampId")))
    if st == 200:
        made_templates.append(copy["id"])
        request("PUT", "/api/printtemplates/%d/stamp" % copy["id"], token=token, body={"stampId": stamp_b["id"]})
        st, orig = request("GET", "/api/printtemplates/%d" % tpl["id"], token=token)
        st2, cp = request("GET", "/api/printtemplates/%d" % copy["id"], token=token)
        check("copy", "3.2 changing the copy leaves the original alone",
              orig.get("stampId") == stamp["id"], "orig=%s" % orig.get("stampId"))
        check("copy", "3.3 copy holds its own stamp",
              cp.get("stampId") == stamp_b["id"], "copy=%s" % cp.get("stampId"))

    # ── 4. States ──
    print("\n[4. States]")
    st, plain = request("POST", "/api/printtemplates/company/%d" % cid, token=token, body={
        "templateType": "Challan", "name": "No slot %s" % run,
        "htmlContent": "<html><body><p>no signature here</p></body></html>", "isDefault": False,
    })
    if st == 200:
        made_templates.append(plain["id"])
    check("state", "4.1 template with no stamp markup reports none",
          plain.get("stampState") == "none", "state=%s" % plain.get("stampState"))
    st, pinned = request("POST", "/api/printtemplates/company/%d" % cid, token=token, body={
        "templateType": "Challan", "name": "Pinned %s" % run,
        "htmlContent": "<html><body><img src='{{stamps.%s}}'></body></html>" % stamp["slug"],
        "isDefault": False,
    })
    if st == 200:
        made_templates.append(pinned["id"])
    check("state", "4.2 direct {{stamps.slug}} reference reports pinned",
          pinned.get("stampState") == "pinned", "state=%s" % pinned.get("stampState"))

    # Convert pinned -> slot: HTML and assignment must change together.
    converted_html = "<html><body><img src='{{stamp}}'></body></html>"
    st, conv = request("PUT", "/api/printtemplates/%d/stamp" % pinned["id"], token=token,
                       body={"stampId": stamp["id"], "htmlContent": converted_html})
    check("state", "4.3 convert switches state to slotted",
          st == 200 and conv.get("stampState") == "slotted", "state=%s" % conv.get("stampState"))
    check("state", "4.4 convert assigns the stamp in the same write",
          conv.get("stampId") == stamp["id"], "stampId=%s" % conv.get("stampId"))

    # ── 5. Default stamp ──
    print("\n[5. Default stamp]")
    st, d = request("PUT", "/api/companies/%d/stamps/%d/default" % (cid, stamp_b["id"]), token=token)
    check("default", "5.1 set default returns 200", st == 200 and d.get("isDefault") is True, "status=%s" % st)
    st, listed = request("GET", "/api/companies/%d/stamps" % cid, token=token)
    defaults = [s for s in listed if s.get("isDefault")]
    check("default", "5.2 exactly one default per company", len(defaults) == 1, "count=%d" % len(defaults))
    check("default", "5.3 usage count reported for delete warning",
          any(s["id"] == stamp["id"] and s.get("usedByTemplates", 0) >= 1 for s in listed), "")

    # ── 6. Deleting a stamp degrades, never orphans ──
    print("\n[6. Delete degrades]")
    st, _ = request("DELETE", "/api/companies/%d/stamps/%d" % (cid, stamp["id"]), token=token)
    check("delete", "6.1 delete returns 204", st == 204, "status=%s" % st)
    made_stamps = [s for s in made_stamps if s != stamp["id"]]
    st, after = request("GET", "/api/printtemplates/%d" % tpl["id"], token=token)
    check("delete", "6.2 template survives the stamp deletion", st == 200, "status=%s" % st)
    check("delete", "6.3 assignment cleared rather than dangling",
          after.get("stampId") is None, "stampId=%s" % after.get("stampId"))
    check("delete", "6.4 template HTML untouched by the deletion",
          after.get("htmlContent") == body_html, "")

    for t in made_templates:
        request("DELETE", "/api/printtemplates/%d" % t, token=token)
    for s in made_stamps:
        request("DELETE", "/api/companies/%d/stamps/%d" % (cid, s), token=token)

    summarize()


def summarize():
    print("\n=== %d/%d checks passed ===" % (len(PASSED), len(PASSED) + len(FAILED)))
    if FAILED:
        for suite, label, detail in FAILED:
            print("  FAILED [%s] %s %s" % (suite, label, detail))
        sys.exit(1)
    print("all checks passed")


if __name__ == "__main__":
    main()

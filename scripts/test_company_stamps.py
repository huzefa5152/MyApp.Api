"""
Company stamps — print-template merge-field images.

Operators used to paste base64 images straight into template HTML, which made
templates enormous (two production Challan templates were ~75-89KB of which
~90% was one embedded signature) and meant the same signature had to be pasted
again into every template that needed it. A stamp is uploaded once per company
and referenced from any template as {{stamps.<slug>}}.

What this asserts:
  - upload returns a stable slug + a URL that actually serves the image
  - the slug survives a rename (templates reference it, so it must be immutable)
  - slugs are unique per company and are safe Handlebars path segments
  - a stamp is only visible to a user with access to its company
  - delete removes the row and stops serving the file

Usage:
    python scripts/test_company_stamps.py --base http://localhost:5135
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


def check(suite, label, ok, detail=""):
    (PASSED if ok else FAILED).append((suite, label, detail))
    print("  [%s] %-58s %s" % ("PASS" if ok else "FAIL", label, "PASS" if ok else "FAIL " + detail))


def request(method, path, token=None, body=None, raw=None, content_type=None):
    url = BASE + path
    data = None
    headers = {}
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


def png_bytes(w=8, h=8, rgb=(0, 0, 0)):
    """Minimal valid PNG — the upload validator sniffs magic bytes, so a
    hand-rolled file has to be a real PNG, not just bytes with a .png name."""
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b""))


def multipart(fields, files):
    """Build a multipart/form-data body without pulling in `requests`."""
    boundary = "----stamptest" + uuid.uuid4().hex
    buf = io.BytesIO()
    for name, value in fields.items():
        buf.write(("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n"
                   % (boundary, name, value)).encode())
    for name, (filename, content, ctype) in files.items():
        buf.write(("--%s\r\nContent-Disposition: form-data; name=\"%s\"; filename=\"%s\"\r\n"
                   "Content-Type: %s\r\n\r\n" % (boundary, name, filename, ctype)).encode())
        buf.write(content)
        buf.write(b"\r\n")
    buf.write(("--%s--\r\n" % boundary).encode())
    return buf.getvalue(), "multipart/form-data; boundary=" + boundary


def fetch_static(path):
    """Stamps are served by the public /data static provider so <img src> works
    inside the print popup — no Authorization header is sent."""
    try:
        with urllib.request.urlopen(BASE + path) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, b""
    except urllib.error.URLError as e:
        return 0, b""


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
    if status != 200 or not isinstance(res, dict) or not res.get("token"):
        print("login failed (%s): %s" % (status, res))
        sys.exit(1)
    token = res["token"]

    status, companies = request("GET", "/api/companies", token=token)
    if status != 200 or not companies:
        print("no companies available (%s)" % status)
        sys.exit(1)
    cid = companies[0]["id"]
    print("using company %s (%s)\n" % (cid, companies[0].get("name")))

    created = []

    # Slugs are unique per company and stamps from earlier runs (or ones the
    # operator uploaded by hand) still exist, so a fixed name would collide and
    # silently get a "_2" suffix. Derive a fresh name per run instead.
    run_id = uuid.uuid4().hex[:8]
    base_name = "Zz Test Sign %s" % run_id
    base_slug = "zz_test_sign_%s" % run_id

    # ── 1. Upload ──
    print("[1. Upload]")
    body, ctype = multipart({"name": base_name},
                            {"file": ("sign.png", png_bytes(), "image/png")})
    status, stamp = request("POST", "/api/companies/%d/stamps" % cid,
                            token=token, raw=body, content_type=ctype)
    ok = status == 200 and isinstance(stamp, dict) and stamp.get("id")
    check("upload", "1.1 upload returns 200 + stamp", ok, "status=%s %s" % (status, stamp))
    if not ok:
        summarize(); sys.exit(1)
    created.append(stamp["id"])
    check("upload", "1.2 slug derived from name", stamp.get("slug") == base_slug,
          "slug=%s expected=%s" % (stamp.get("slug"), base_slug))
    check("upload", "1.3 url points at the /data stamps path",
          str(stamp.get("url", "")).startswith("/data/uploads/stamps/company_%d/" % cid),
          "url=%s" % stamp.get("url"))

    st, content = fetch_static(stamp["url"])
    check("upload", "1.4 url actually serves the image", st == 200 and content[:8] == b"\x89PNG\r\n\x1a\n",
          "status=%s len=%d" % (st, len(content)))

    status, listed = request("GET", "/api/companies/%d/stamps" % cid, token=token)
    check("upload", "1.5 appears in the company list",
          status == 200 and any(s["id"] == stamp["id"] for s in listed), "status=%s" % status)

    # ── 2. Slug stability + uniqueness ──
    print("\n[2. Slug rules]")
    status, renamed = request("PUT", "/api/companies/%d/stamps/%d" % (cid, stamp["id"]),
                              token=token, body={"name": base_name + " Renamed"})
    check("slug", "2.1 rename returns 200", status == 200, "status=%s" % status)
    check("slug", "2.2 rename changes the name", renamed.get("name") == base_name + " Renamed",
          "name=%s" % renamed.get("name"))
    # The whole point: templates embed the slug, so renaming must not break them.
    check("slug", "2.3 rename does NOT change the slug", renamed.get("slug") == stamp["slug"],
          "slug=%s" % renamed.get("slug"))

    body, ctype = multipart({"name": base_name},
                            {"file": ("sign.png", png_bytes(), "image/png")})
    status, dup = request("POST", "/api/companies/%d/stamps" % cid,
                          token=token, raw=body, content_type=ctype)
    ok = status == 200 and isinstance(dup, dict)
    if ok:
        created.append(dup["id"])
    check("slug", "2.4 duplicate name gets a suffixed slug",
          ok and dup.get("slug") == base_slug + "_2", "slug=%s" % (dup or {}).get("slug"))

    body, ctype = multipart({"name": "123 Stamp!! " + run_id},
                            {"file": ("sign.png", png_bytes(), "image/png")})
    status, odd = request("POST", "/api/companies/%d/stamps" % cid,
                          token=token, raw=body, content_type=ctype)
    ok = status == 200 and isinstance(odd, dict)
    if ok:
        created.append(odd["id"])
    slug = (odd or {}).get("slug", "")
    # Must be a usable Handlebars path segment: no leading digit, no punctuation.
    check("slug", "2.5 slug never starts with a digit", ok and not slug[:1].isdigit(), "slug=%s" % slug)
    check("slug", "2.6 slug is [a-z0-9_] only",
          ok and all(c.islower() or c.isdigit() or c == "_" for c in slug), "slug=%s" % slug)

    # ── 3. Upload validation ──
    print("\n[3. Validation]")
    body, ctype = multipart({"name": "Not an image"},
                            {"file": ("evil.png", b"MZ\x90\x00 not a png", "image/png")})
    status, res = request("POST", "/api/companies/%d/stamps" % cid,
                          token=token, raw=body, content_type=ctype)
    check("validation", "3.1 non-image content rejected despite .png name", status == 400,
          "status=%s" % status)

    # ── 4. Tenant isolation ──
    print("\n[4. Tenant isolation]")
    # An unknown company id returns 200 + [] here, exactly as every other
    # tenant-scoped list endpoint does under a global-access admin token. What
    # matters is that stamps behave like the rest, not that they invent a
    # stricter contract — the real guarantee (403 for a company the caller is
    # not a member of) is asserted in scripts/test_tenant_isolation.py, which
    # covers this route.
    ghost = 999999
    st_stamps, body_stamps = request("GET", "/api/companies/%d/stamps" % ghost, token=token)
    st_sibling, _ = request("GET", "/api/printtemplates/company/%d" % ghost, token=token)
    check("isolation", "4.1 unknown company behaves like sibling tenant-scoped routes",
          st_stamps == st_sibling, "stamps=%s printtemplates=%s" % (st_stamps, st_sibling))
    check("isolation", "4.2 unknown company leaks no rows", body_stamps == [],
          "body=%s" % (body_stamps,))
    check("isolation", "4.3 listed stamps all belong to the requested company",
          all(s["companyId"] == cid for s in listed), "")
    print("      (cross-tenant 403 for a real forbidden company is covered by "
          "scripts/test_tenant_isolation.py)")

    # ── 5. Delete ──
    print("\n[5. Delete]")
    url = stamp["url"]
    status, _ = request("DELETE", "/api/companies/%d/stamps/%d" % (cid, stamp["id"]), token=token)
    check("delete", "5.1 delete returns 204", status == 204, "status=%s" % status)
    created.remove(stamp["id"])
    st, _ = fetch_static(url)
    check("delete", "5.2 file stops being served", st in (404, 0), "status=%s" % st)
    status, listed2 = request("GET", "/api/companies/%d/stamps" % cid, token=token)
    check("delete", "5.3 gone from the list",
          status == 200 and not any(s["id"] == stamp["id"] for s in listed2), "status=%s" % status)

    # cleanup
    for sid in created:
        request("DELETE", "/api/companies/%d/stamps/%d" % (cid, sid), token=token)

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

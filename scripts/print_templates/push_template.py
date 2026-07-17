# -*- coding: utf-8 -*-
"""
List / back up / push print templates via the running API (branch DB, :5134).
See PRINT_TEMPLATE_GUIDE.md (repo root). Always BACK UP before overwriting.

Env: BASE (default http://localhost:5134), USER (admin), PASS (admin123).

  # See what exists for a company (id, type, divisionId, name, default):
  python scripts/print_templates/push_template.py list <companyId>

  # Back up one template's current HTML to a file:
  python scripts/print_templates/push_template.py backup <templateId> <out.html>

  # Update an existing template's body+name (idempotent):
  python scripts/print_templates/push_template.py update <templateId> <html_file> "<Name>"

  # Create a new template in a scope (divisionId "" or a number):
  python scripts/print_templates/push_template.py create <companyId> <Type> <divisionId|-> "<Name>" <html_file>

  # Upload a logo to a company or division (only sets LogoPath — safe):
  python scripts/print_templates/push_template.py logo company <companyId> <img>
  python scripts/print_templates/push_template.py logo division <divisionId> <img>
"""
import os, sys, json, urllib.request

BASE = os.environ.get("BASE", "http://localhost:5134")
USER = os.environ.get("USER_NAME", "admin")
PASS = os.environ.get("PASS", "admin123")

def login():
    r = urllib.request.Request(BASE + "/api/auth/login",
        data=json.dumps({"username": USER, "password": PASS}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    return json.load(urllib.request.urlopen(r, timeout=20))["token"]

def api(method, path, tok, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
        headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    raw = urllib.request.urlopen(r, timeout=30).read()
    return json.loads(raw) if raw else None

def upload_logo(tok, kind, oid, img):
    bnd = "----ptpush"; data = open(img, "rb").read()
    body = (("--"+bnd+"\r\n").encode() +
            b'Content-Disposition: form-data; name="file"; filename="logo.png"\r\n' +
            b"Content-Type: image/png\r\n\r\n" + data + b"\r\n" + ("--"+bnd+"--\r\n").encode())
    seg = "companies" if kind == "company" else "divisions"
    r = urllib.request.Request(BASE + f"/api/{seg}/{oid}/logo", data=body, method="POST",
        headers={"Authorization": "Bearer " + tok, "Content-Type": "multipart/form-data; boundary=" + bnd})
    return json.load(urllib.request.urlopen(r, timeout=60))

def main():
    if len(sys.argv) < 2: print(__doc__); return
    cmd = sys.argv[1]; tok = login()
    if cmd == "list":
        rows = api("GET", f"/api/printtemplates/company/{sys.argv[2]}", tok)
        for t in sorted(rows, key=lambda x: (x["templateType"], str(x.get("divisionId")))):
            print(f"  id={t['id']:<5} {t['templateType']:<22} div={str(t.get('divisionId')):<5} name={t.get('name'):<24} default={t.get('isDefault')}")
        print("total", len(rows))
    elif cmd == "backup":
        d = api("GET", f"/api/printtemplates/{sys.argv[2]}", tok)
        open(sys.argv[3], "w", encoding="utf-8").write(d.get("htmlContent") or "")
        print(f"backed up id={sys.argv[2]} ({len(d.get('htmlContent') or '')} chars) -> {sys.argv[3]}")
    elif cmd == "update":
        html = open(sys.argv[3], encoding="utf-8").read()
        api("PUT", f"/api/printtemplates/{sys.argv[2]}", tok,
            {"name": sys.argv[4], "htmlContent": html, "templateJson": None, "editorMode": "code"})
        print(f"updated id={sys.argv[2]} ({len(html)} chars)")
    elif cmd == "create":
        cid, typ, div, name, f = sys.argv[2:7]
        html = open(f, encoding="utf-8").read()
        d = api("POST", f"/api/printtemplates/company/{cid}", tok,
            {"templateType": typ, "divisionId": (None if div in ("-", "") else int(div)),
             "name": name, "htmlContent": html, "templateJson": None, "editorMode": "code", "isDefault": True})
        print(f"created id={d.get('id')} {typ} div={div} ({len(html)} chars)")
    elif cmd == "logo":
        d = upload_logo(tok, sys.argv[2], sys.argv[3], sys.argv[4])
        print("logoPath =", d.get("logoPath"))
    else:
        print(__doc__)

if __name__ == "__main__":
    main()

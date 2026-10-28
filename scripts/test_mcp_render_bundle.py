"""
MCP get_document_render_bundle on the importer line (2026-10-29, ported from Trader).

One document ready to print with its company's own template: the chunks rebuild to the
advertised sha256, the data equals the screen's print data, the template is the one chosen
(explicit, else default, else oldest), signed / unsigned behave, and the company's own stamp
is inlined. Refused: another company's document or template, the retired Bill type, a token
without documents.read. The tool rides on the get_document_print_data grant.

Uses the shared fixture companies (scripts/mcp_importer_fixture.py). LOCAL only.
    python scripts/test_mcp_render_bundle.py --base http://localhost:5195
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import secrets
import sys
import urllib.request

import mcp_importer_fixture as fx

RUN = secrets.token_hex(3)
results: list[tuple[str, bool, str]] = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), "" if ok else str(detail)[:300]))
    print(("  PASS  " if ok else "  FAIL  ") + name + ("" if ok else f"  -- {str(detail)[:300]}"))


def bundle(token, args):
    """(refused, bundle-or-message): read every chunk, verify the sha256."""
    text, sha, offset = "", None, 0
    while offset is not None:
        refused, raw = fx.call(token, "get_document_render_bundle", {**args, "offset": offset, "length": 4000})
        if refused:
            return True, raw
        chunk = json.loads(raw)
        if sha not in (None, chunk["sha256"]):
            return True, "sha changed between chunks"
        sha, offset = chunk["sha256"], chunk["nextOffset"]
        text += chunk["content"]
    if hashlib.sha256(text.encode()).hexdigest() != sha:
        return True, "sha mismatch"
    return False, json.loads(text)


def upload_stamp(admin, company_id):
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
    boundary = "----render" + RUN
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"name\"\r\n\r\nRender test {RUN}\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"sig.png\"\r\nContent-Type: image/png\r\n\r\n").encode() \
        + png + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(f"{fx.BASE}/api/companies/{company_id}/stamps", data=body, method="POST",
                                 headers={"Authorization": "Bearer " + admin, "Content-Type": "multipart/form-data; boundary=" + boundary})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5195")
    fx.set_base(ap.parse_args().base)
    admin = fx.login("admin", "admin123")
    A, B = fx.companies(admin)
    challan_a = fx.first_id(admin, f"/api/deliverychallans/company/{A}/paged?page=1&pageSize=1")
    challan_b = fx.first_id(admin, f"/api/deliverychallans/company/{B}/paged?page=1&pageSize=1")
    templates, stamps = [], []
    fx.remove_users(admin, "render_")
    try:
        sysr = fx.system_roles(admin)
        _, jwt = fx.make_user(admin, f"render_{RUN}", [A], [fx.staff_role(admin), sysr["MCP Access"]], writes=False)
        uid = next(u["id"] for u in fx.http("GET", "/api/users", admin)[1] if u["username"] == f"render_{RUN}")
        tok = fx.token_for(jwt, [A])
        no_docs = fx.token_for(jwt, [A], scopes=["read"])

        stamp = upload_stamp(admin, A)
        stamps.append((A, stamp["id"]))
        slotted = ('<html><body><p>{{challanNumber}}</p><span class="stamp-slot"><img class="stamp-img" src="{{stamp}}"></span></body></html>')
        pinned = '<html><body><p>{{challanNumber}}</p><img src="{{stamps.' + stamp["slug"] + '}}"></body></html>'
        ids = {}
        for label, html, cid in (("slotted", slotted, A), ("pinned", pinned, A), ("plain", "<html><body><p>{{challanNumber}}</p></body></html>", A),
                                 ("foreign", "<html><body>{{challanNumber}}</body></html>", B)):
            s, t = fx.http("POST", f"/api/printtemplates/company/{cid}", admin, {"name": f"Render {label} {RUN}", "templateType": "Challan",
                           "htmlContent": html, "editorMode": "code", "isDefault": False})
            assert s in (200, 201), (label, s, t)
            templates.append(t["id"])
            ids[label] = t["id"]
        assert fx.http("PUT", f"/api/printtemplates/{ids['slotted']}/stamp", admin, {"stampId": stamp["id"]})[0] == 200
        s, screen = fx.http("GET", f"/api/deliverychallans/{challan_a}/print", admin)
        assert s == 200, (s, screen)
        own = {"companyId": A, "documentType": "Challan", "documentId": challan_a}

        print("\n=== Render bundle ===")
        err, b = bundle(tok, {**own, "templateId": ids["slotted"]})
        check("chunks rebuild to the advertised sha256", not err, b)
        scalar = lambda d: {k: v for k, v in d.items() if not isinstance(v, (list, dict)) and not (isinstance(v, str) and (v.startswith("data:") or v.startswith("/data/")))}
        check("data equals the screen's print data", not err and scalar(b["data"]) == scalar(screen), "differs")
        check("the chosen template's html", not err and b["html"] == slotted and b["template"]["id"] == ids["slotted"])
        check("the assigned stamp is inlined", not err and b["signed"] and str(b["stamp"]).startswith("data:image/png;base64,"), not err and b.get("stamp"))
        err, b = bundle(tok, {**own, "templateId": ids["slotted"], "signed": False})
        check("unsigned drops the stamp", not err and b["stamp"] is None and not b["signed"])
        err, b = bundle(tok, {**own, "templateId": ids["pinned"], "signed": False})
        check("unsigned strips pinned signature images", not err and "{{stamps." not in b["html"] and b["stamps"] == {})
        err, b = bundle(tok, {**own, "templateId": ids["pinned"], "signed": True})
        check("a pinned signature is inlined", not err and b["stamps"].get(stamp["slug"], "").startswith("data:image/"))
        err, msg = bundle(tok, {**own, "templateId": ids["plain"], "signed": True})
        check("signed refused on a template without one, naming the signed ones", err and f"#{ids['slotted']}" in str(msg), msg)
        err, b = bundle(tok, own)
        check("no templateId: the default, else the oldest", not err and (b["template"]["isDefault"] or b["template"]["id"] <= min(ids["slotted"], ids["pinned"], ids["plain"])), b if err else b["template"])

        print("\n=== Refusals ===")
        for label, token, args in (
            ("another company's document", tok, {**own, "companyId": B, "documentId": challan_b}),
            ("another company's document id in my company", tok, {**own, "documentId": challan_b}),
            ("another company's template", tok, {**own, "templateId": ids["foreign"]}),
            ("the retired Bill type", tok, {**own, "documentType": "Bill"}),
            ("a token without documents.read", no_docs, own),
        ):
            refused, text = fx.call(token, "get_document_render_bundle", args)
            check(label + " refused", refused, text)

        print("\n=== Rides on the print-data grant ===")
        listed = set(fx.tools(tok))
        check("on by default with print data", {"get_document_print_data", "get_document_render_bundle"} <= listed, sorted(listed)[:5])
        s, cat = fx.http("GET", f"/api/mcp/catalog/{uid}", admin)
        keep = [t["name"] for t in cat["tools"] if t["configurable"] and t["granted"] and t["name"] != "get_document_print_data"]
        fx.grant_catalog(admin, uid, writes=False, only=keep)
        listed = set(fx.tools(tok))
        check("removing print data removes render too", "get_document_print_data" not in listed and "get_document_render_bundle" not in listed)
        check("and a render call is refused", fx.call(tok, "get_document_render_bundle", own)[0])
    finally:
        for tid in templates:
            fx.http("DELETE", f"/api/printtemplates/{tid}", admin)
        for cid, sid in stamps:
            fx.http("DELETE", f"/api/companies/{cid}/stamps/{sid}", admin)
        fx.remove_users(admin, "render_")

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} render bundle checks passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()

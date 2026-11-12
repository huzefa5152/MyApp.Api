"""Trader: classify bills' FBR filing rows from an HS-code sheet over the hosted MCP (POST /mcp).

Same plan as classify_browser.js, through MCP tools: search_invoices, search_item_types,
get_bill_tax_filing, prepare_item_type, prepare_bill_tax_filing, commit_action.

The agent token is read from the MYAPP_MCP_TOKEN environment variable (never pass it on the
command line or paste it into chat). It needs the company, scopes read + taxfiling.write, and
itemtypes.write if the sheet has an HS code with no catalog item.

  python classify_mcp.py --base <site> --company <id> --rows rows.json                 # plan only
  python classify_mcp.py --base <site> --company <id> --rows rows.json --apply          # after approval
    --name 7217.1000="Iron and steel wire"   name for an HS code with no catalog item (repeatable)
    --unit 8544.6020=Meter                   unit for that new item (default KG)
    --item 8302.1090=123                     catalog item when several share a code
    --only 101,102                             limit to these invoice numbers
    --overwrite                              re-classify bills that already have filing rows
"""
import argparse, collections, json, os, re, sys, urllib.error, urllib.request, uuid

A = None
_id = [0]


def call(tool, args):
    _id[0] += 1
    body = {"jsonrpc": "2.0", "id": _id[0], "method": "tools/call", "params": {"name": tool, "arguments": args}}
    req = urllib.request.Request(A.base.rstrip("/") + "/mcp", data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + A.token})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            d = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{tool}: HTTP {e.code} {e.read().decode()[:300]}")
    if "error" in d:
        raise RuntimeError(f"{tool}: {d['error'].get('message')}")
    res = d["result"]
    text = res["content"][0]["text"]
    if res.get("isError"):
        raise RuntimeError(f"{tool}: {text}")
    return json.loads(text)


def kv(pairs):
    return dict(p.split("=", 1) for p in pairs or [])


def norm(s):
    return re.sub(r"\s+", " ", str(s or "")).strip().upper()


def near(a, b):
    return b is None or abs(float(a) - float(b)) < 0.02


def main():
    global A
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--company", type=int, required=True)
    ap.add_argument("--rows", required=True)
    ap.add_argument("--name", action="append")
    ap.add_argument("--unit", action="append")
    ap.add_argument("--item", action="append")
    ap.add_argument("--only")
    ap.add_argument("--overwrite", action="store_true")
    ap.add_argument("--apply", action="store_true")
    A = ap.parse_args()
    A.token = os.environ.get("MYAPP_MCP_TOKEN") or sys.exit("Set MYAPP_MCP_TOKEN to the agent token.")
    names, units, force = kv(A.name), kv(A.unit), {k: int(v) for k, v in kv(A.item).items()}
    only = {int(x) for x in A.only.split(",")} if A.only else None
    co = A.company

    sheet = collections.OrderedDict()
    for r in json.load(open(A.rows, encoding="utf-8")):
        if only is None or r[0] in only:
            sheet.setdefault(r[0], []).append(r)

    ids, page = {}, 1
    while True:
        d = call("search_invoices", {"companyId": co, "page": page, "pageSize": 100})
        ids.update({b["invoiceNumber"]: b["id"] for b in d["items"]})
        if page >= (d.get("totalPages") or 1):
            break
        page += 1

    skipped, problems, plan, codes = collections.defaultdict(list), [], [], {}
    for no, lines in sheet.items():
        if any(not l[1] for l in lines):
            skipped["blankHs"].append(no); continue
        if no not in ids:
            skipped["notFound"].append(no); continue
        ed = call("get_bill_tax_filing", {"companyId": co, "invoiceId": ids[no]})
        if ed.get("fbrStatus") == "Submitted":
            skipped["filed"].append(no); continue
        if ed.get("hasSavedRows") and not A.overwrite:
            skipped["classified"].append(no); continue
        free, groups, bad = list(ed["lines"]), collections.OrderedDict(), None
        for _, hs, desc, excl in lines:
            i = next((k for k, l in enumerate(free) if norm(l["description"]) == norm(desc) and near(l["lineTotal"], excl)), None)
            if i is None:
                i = next((k for k, l in enumerate(free) if norm(l["description"]) == norm(desc)), None)
            if i is None and excl is not None:
                i = next((k for k, l in enumerate(free) if near(l["lineTotal"], excl)), None)
            if i is None:
                bad = f'{no}: no bill line for "{desc}" {excl}'; break
            groups.setdefault(hs, []).append(free.pop(i))
        if not bad and free:
            bad = f"{no}: bill lines not in the sheet: " + ", ".join(f'"{l["description"]}" {l["lineTotal"]}' for l in free)
        if bad:
            problems.append(bad); continue
        for hs, ls in groups.items():
            c = codes.setdefault(hs, {"bills": 0, "lines": 0}); c["bills"] += 1; c["lines"] += len(ls)
        plan.append({"no": no, "id": ids[no], "groups": groups})

    for hs, c in codes.items():
        found = [x for x in call("search_item_types", {"companyId": co, "search": hs, "limit": 100})["items"]
                 if (x.get("hsCode") or "").strip() == hs]
        found.sort(key=lambda x: x["id"])
        pick = next((x for x in found if x["id"] == force.get(hs)), None) if hs in force else (found[0] if found else None)
        if pick:
            c.update(itemTypeId=pick["id"], item=f'{pick["id"]} {pick["name"]} [{pick.get("uom")}]', others=len(found) - 1)
        else:
            c.update(itemTypeId=None, item=f'NEW: {names.get(hs, f"Goods under HS {hs}")} [{units.get(hs, "KG")}]')

    print(f"{len(plan)} bills, {sum(len(l) for p in plan for l in p['groups'].values())} lines, "
          f"{sum(len(p['groups']) for p in plan)} filing rows")
    print("invoices:", ",".join(str(p["no"]) for p in plan))
    for hs, c in codes.items():
        print(f"  {hs}: {c['bills']} bills/{c['lines']} lines -> {c['item']}" + (f" (+{c['others']} other items)" if c.get("others") else ""))
    for k, v in skipped.items():
        print(f"skipped {k}: {','.join(map(str, v))}")
    for p in problems:
        print("PROBLEM", p)
    if not A.apply:
        print("Plan only. Show it to the user; after approval re-run with --apply.")
        return

    for hs, c in codes.items():
        if c["itemTypeId"] is None:
            pl = call("prepare_item_type", {"companyId": co, "name": names.get(hs, f"Goods under HS {hs}"), "hsCode": hs,
                                            "uom": units.get(hs, "KG"), "idempotencyKey": f"hsc-item-{co}-{hs}"})
            done = call("commit_action", {"planId": pl["planId"]})
            c["itemTypeId"] = done.get("itemTypeId") or done.get("id") or (done.get("result") or {}).get("id")
            if not c["itemTypeId"]:
                c["itemTypeId"] = next(x["id"] for x in call("search_item_types", {"companyId": co, "search": hs})["items"]
                                       if (x.get("hsCode") or "").strip() == hs)
            print(f"created item {c['itemTypeId']} for {hs}")

    saved = 0
    for p in plan:
        ed = call("get_bill_tax_filing", {"companyId": co, "invoiceId": p["id"]})
        live = {l["id"]: l for l in ed["lines"]}
        want = [l["id"] for ls in p["groups"].values() for l in ls]
        if sorted(want) != sorted(live):
            sys.exit(f"STOPPED at {p['no']}: the bill's lines changed since the plan. Saved {saved}.")
        rows = [{"sourceLineIds": [l["id"] for l in ls], "itemTypeId": codes[hs]["itemTypeId"],
                 "quantity": sum(float(live[l["id"]]["quantity"]) for l in ls),
                 "valueExclTax": round(sum(float(live[l["id"]]["lineTotal"]) for l in ls), 2)}
                for hs, ls in p["groups"].items()]
        try:
            pl = call("prepare_bill_tax_filing", {"companyId": co, "invoiceId": p["id"], "version": ed["version"], "rows": rows,
                                                  "idempotencyKey": f"hsc-{co}-{p['id']}-{uuid.uuid4().hex[:8]}"})
            call("commit_action", {"planId": pl["planId"]})
        except RuntimeError as e:
            sys.exit(f"STOPPED at {p['no']}: {e}. Saved {saved}.")
        saved += 1
    print(f"saved {saved} bills")


if __name__ == "__main__":
    main()

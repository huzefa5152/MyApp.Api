#!/usr/bin/env python3
"""
Classify the NEW-vs-OLD prod dump (scripts/_prod_dump_out/dump.json).

OLD = parent commit 2577301 (adjacency-primary) = what production currently runs.
NEW = master 77cefb5 (column-primary) = the generic parser being evaluated.

For each archived PDF, decide whether the NEW parser REGRESSED, IMPROVED, or made
a benign diff vs OLD, using a plausibility metric: a description that is a bare
unit-of-measure token (PC/PCS/TIN/RFT/KGS…) is the fingerprint of the column
reader mis-mapping the description column onto the Unit column.
"""
import json, re, os, sys, collections

OUT = os.path.join(os.path.dirname(__file__), "_prod_dump_out")
d = json.load(open(os.path.join(OUT, "dump.json"), encoding="utf-8"))

UNIT_TOKENS = r"(?:PC|PCS|PKT|KG|KGS|GRAM|GRM|LTR|LTRS|MTR|RFT|BOTTLE|BOX|BAG|BAGS|TIN|PAK|PIR|NOS|NO|SET|ROLL|COIL|PAIR|DRUM|CAN|EA|EACH|DOZEN|SHEET|BUNDLE|UNIT|YARD|YRD|CTN|CARTON)"

def unit_like(desc):
    """True when the description is the column reader's mis-map artifact rather
    than a real product name: a bare UOM token, a description that STARTS with a
    UOM token (the Unit cell leaked into the description), or a price/amount
    triplet (the numeric right-hand columns leaked in)."""
    if not desc or not desc.strip():
        return True
    s = desc.strip()
    # Bare short token (no digits, no space, <=4 chars): PC, PCS, TIN, RFT, KGS…
    if not any(c.isdigit() for c in s) and " " not in s and len(s) <= 4:
        return True
    # Description begins with a UOM token then more text ("PC AUTO DRAIN VALVE",
    # "KGS. …", "RFT BRIDGE STONE") — the Unit column bled into the description.
    if re.match(rf"^{UNIT_TOKENS}\.?\b", s, re.I):
        return True
    # Price/amount triplet leak: "1 900.00 900 18.00", "5000 11.00 55,000 18.00",
    # "10 620.00 6,200 18.00" — three+ numbers, includes a .NN rate.
    nums = re.findall(r"\d[\d,]*(?:\.\d+)?", s)
    if len(nums) >= 3 and re.search(r"\d\.\d{2}\b", s) and len(re.sub(r"[\d,.\s]", "", s)) <= 3:
        return True
    return False

def plausible(items):
    return sum(1 for it in items if not unit_like(it["description"]))

def norm(s):
    return " ".join((s or "").lower().split())

def items_same(a, b):
    if len(a) != len(b):
        return False
    for x, y in zip(a, b):
        if norm(x["description"]) != norm(y["description"]):
            return False
        if str(x["quantity"]) != str(y["quantity"]):
            return False
    return True

rows = [r for r in d["results"] if not r.get("skipped")]
groups = collections.defaultdict(list)
verdict_counts = collections.Counter()

for r in rows:
    new = r["new"]; old = r.get("old", {"items": [], "miss": True})
    ni, oi = new["items"], old["items"]
    fmt = new.get("matchedFormatName") or old.get("matchedFormatName") or ("(no-format)" if new.get("miss") else "(unknown)")
    pn, po = plausible(ni), plausible(oi)
    same = items_same(ni, oi)
    if new.get("miss") and not old.get("miss"):
        v = "NEW-REGRESSED (new matches no format, old did)"
    elif same:
        v = "OK (identical)"
    elif len(ni) < len(oi) or pn < po:
        v = "NEW-REGRESSED"
    elif len(ni) > len(oi) or pn > po:
        v = "NEW-IMPROVED"
    else:
        v = "DIFF-BENIGN (same counts+plausible, text differs)"
    r["_verdict"] = v; r["_pn"] = pn; r["_po"] = po
    verdict_counts[v] += 1
    groups[fmt].append(r)

print("=" * 78)
print("OVERALL VERDICTS (NEW column-primary vs OLD adjacency = prod-current)")
print("=" * 78)
for v, c in verdict_counts.most_common():
    print(f"  {c:>4}  {v}")
print(f"  ----  {len(rows)} total")

print("\n" + "=" * 78)
print("BY FORMAT")
print("=" * 78)
for fmt in sorted(groups):
    rs = groups[fmt]
    vc = collections.Counter(r["_verdict"] for r in rs)
    print(f"\n{fmt}  ({len(rs)} PDFs)")
    for v, c in vc.most_common():
        print(f"     {c:>3}  {v}")

# Show concrete bad rows for regressions (a few per format)
print("\n" + "=" * 78)
print("SAMPLE REGRESSION ROWS (NEW garbage vs OLD correct)")
print("=" * 78)
shown = collections.Counter()
for fmt in sorted(groups):
    for r in groups[fmt]:
        if not r["_verdict"].startswith("NEW-REGRESSED"):
            continue
        if shown[fmt] >= 3:
            continue
        shown[fmt] += 1
        print(f"\n  #{r['id']} [{fmt}] {r['file']}  (prod={r['prodItems']} new={len(r['new']['items'])} old={len(r['old']['items'])})")
        print(f"     NEW: " + " | ".join(f"{it['description']!r}#{it['quantity']}" for it in r['new']['items'][:6]))
        print(f"     OLD: " + " | ".join(f"{it['description']!r}#{it['quantity']}" for it in r['old']['items'][:6]))

# write full classified json
with open(os.path.join(OUT, "classified.json"), "w", encoding="utf-8") as f:
    json.dump({"verdicts": dict(verdict_counts),
               "rows": [{"id": r["id"], "file": r["file"], "companyId": r["companyId"],
                         "format": (r["new"].get("matchedFormatName") or "(no-format)"),
                         "verdict": r["_verdict"], "prodItems": r["prodItems"],
                         "newItems": len(r["new"]["items"]), "oldItems": len(r["old"]["items"]),
                         "newPlausible": r["_pn"], "oldPlausible": r["_po"],
                         "new": r["new"]["items"], "old": r["old"]["items"]} for r in rows]},
              f, indent=2, ensure_ascii=False)
print(f"\nWrote {os.path.join(OUT, 'classified.json')}")

#!/usr/bin/env bash
# Regression sweep: Common Clients change must not affect any of the
# downstream business flows. Tests the read paths + a full create →
# validate cycle for both common-client and uncommon-client cases.
set -e

BASE=http://localhost:5134
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | python -c 'import sys,json; print(json.load(sys.stdin).get("token",""))')
H="Authorization: Bearer $TOKEN"

PASS=0; FAIL=0
ok() { echo "  ✓ $1"; PASS=$((PASS+1)); }
ng() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

# ── Sanity ─────────────────────────────────────────────────────────────
echo "== 1. Auth + admin permissions =="
PERMS=$(curl -s -H "$H" "$BASE/api/permissions/me" | python -c "
import sys,json
d=json.load(sys.stdin); p=d.get('permissions',[])
print(len(p))")
[ "$PERMS" -gt 50 ] && ok "/permissions/me ($PERMS perms)" || ng "/permissions/me only $PERMS"

# ── Existing read paths must be unchanged ───────────────────────────────
echo "== 2. Per-company endpoints unchanged =="
for cid in 1 2 5 6 7; do
  CC=$(curl -s -H "$H" "$BASE/api/clients/company/$cid" | python -c "import sys,json; print(len(json.load(sys.stdin)))")
  CH=$(curl -s -H "$H" "$BASE/api/deliverychallans/count?companyId=$cid")
  IN=$(curl -s -H "$H" "$BASE/api/invoices/count?companyId=$cid")
  echo "  cid=$cid: clients=$CC challans=$CH invoices=$IN"
done

# ── Common Clients endpoints ────────────────────────────────────────────
echo "== 3. Common Clients list stable across companies =="
N1=$(curl -s -H "$H" "$BASE/api/clients/common?companyId=1" | python -c "import sys,json; print(len(json.load(sys.stdin)))")
N2=$(curl -s -H "$H" "$BASE/api/clients/common?companyId=2" | python -c "import sys,json; print(len(json.load(sys.stdin)))")
N5=$(curl -s -H "$H" "$BASE/api/clients/common?companyId=5" | python -c "import sys,json; print(len(json.load(sys.stdin)))")
[ "$N1" = "$N2" ] && [ "$N2" = "$N5" ] && ok "List stable: cid1=$N1 cid2=$N2 cid5=$N5" \
                                     || ng "List drifts: cid1=$N1 cid2=$N2 cid5=$N5"

# Detail endpoint
MEKO_GROUP=$(curl -s -H "$H" "$BASE/api/clients/common?companyId=2" | python -c "
import sys,json
for x in json.load(sys.stdin):
  if 'MEKO DENIM' in x.get('displayName',''):
    print(x['groupId']); break")
[ -n "$MEKO_GROUP" ] && ok "Found Meko group id=$MEKO_GROUP" || ng "No Meko group"

DETAIL_NTN=$(curl -s -H "$H" "$BASE/api/clients/common/$MEKO_GROUP" | python -c "import sys,json; print(json.load(sys.stdin).get('ntn'))")
[ "$DETAIL_NTN" = "8826050-2" ] && ok "Detail NTN matches: $DETAIL_NTN" || ng "Detail NTN: $DETAIL_NTN"

DETAIL_SITE=$(curl -s -H "$H" "$BASE/api/clients/common/$MEKO_GROUP" | python -c "import sys,json; print(json.load(sys.stdin).get('site') or '')")
echo "  Meko master Site (longest member's): \"$DETAIL_SITE\""
echo "$DETAIL_SITE" | grep -q "T-GARMENT" && ok "Site pre-fill carries Roshan's full list" \
                                          || ng "Site pre-fill missing T-GARMENT"

# ── Per-company list filter (should hide common clients) ────────────────
echo "== 4. Per-company list filter — common clients should NOT appear =="
ROSHAN_CLIENT_NAMES=$(curl -s -H "$H" "$BASE/api/clients/company/2" | python -c "
import sys,json
d=json.load(sys.stdin)
names=[c.get('name') for c in d]
print('|'.join(names))")
echo "  Roshan all clients via API: $(echo $ROSHAN_CLIENT_NAMES | tr '|' '\n' | wc -l) names"
# The frontend filters out common ones; the API still returns them all
# (so the existing per-company endpoints stay unchanged for any caller
# that needs the full list — e.g. Bill / Challan client picker).

# ── Bill creation client picker uses per-company endpoint ───────────────
echo "== 5. Bill / Challan client pickers still see ALL clients (common + uncommon) =="
COUNT_FROM_API=$(curl -s -H "$H" "$BASE/api/clients/company/2" | python -c "import sys,json; print(len(json.load(sys.stdin)))")
[ "$COUNT_FROM_API" -ge 10 ] && ok "Roshan client picker has $COUNT_FROM_API clients (Common + Uncommon)" \
                             || ng "Roshan picker only $COUNT_FROM_API"

# ── List existing challans + bills are still readable ──────────────────
echo "== 6. Existing Challans / Bills readable =="
CHALLAN_LIST=$(curl -s -H "$H" "$BASE/api/deliverychallans/company/1" | python -c "import sys,json; print(len(json.load(sys.stdin)))")
[ "$CHALLAN_LIST" -gt 0 ] && ok "Hakimi challans list ($CHALLAN_LIST)" || ng "Hakimi challan list empty"

BILLS_LIST=$(curl -s -H "$H" "$BASE/api/invoices/company/1" | python -c "import sys,json; print(len(json.load(sys.stdin)))")
[ "$BILLS_LIST" -gt 0 ] && ok "Hakimi bills list ($BILLS_LIST)" || ng "Hakimi bills list empty"

# Bill detail with items
BILL_DETAIL=$(curl -s -H "$H" "$BASE/api/invoices/1039" | python -c "
import sys,json
d=json.load(sys.stdin)
print(f\"id={d.get('id')} client={d.get('clientName')!r} items={len(d.get('items',[]))}\")")
echo "  bill 1039: $BILL_DETAIL"
echo "$BILL_DETAIL" | grep -q "items=" && ok "Bill detail intact" || ng "Bill detail broken"

# ── FBR validate on a bill that uses a Common Client ────────────────────
echo "== 7. FBR validate on bill linked to a Common Client =="
# Bill 1039 links to Adhesive Tape (Roshan's MEKO buyer is common w/ Hakimi-Sandbox)
VR=$(curl -s -X POST -H "$H" "$BASE/api/fbr/1039/validate")
SUC=$(echo "$VR" | python -c "import sys,json; print(json.load(sys.stdin).get('success'))")
ERR=$(echo "$VR" | python -c "import sys,json; print((json.load(sys.stdin).get('errorMessage') or '')[:120])")
echo "  bill 1039 validate: success=$SUC err=\"$ERR\""
[ "$SUC" = "True" ] && ok "FBR validate against Common Client passes" \
                   || ng "FBR validate failed: $ERR"

# ── Common Client edit — propagation does not break per-company queries ─
echo "== 8. Edit Meko master fields, verify no business read paths broken =="
RESULT=$(curl -s -X PUT -H "$H" -H "Content-Type: application/json" \
  -d "{\"name\":\"MEKO DENIM MILLS (Pvt) Ltd.\",\"ntn\":\"8826050-2\",\"strn\":\"327787622231-3\",\"cnic\":null,\"address\":\"Plot F-131 Hub River Road, SITE. Karachi\",\"phone\":\"+92-21-3333333\",\"email\":null,\"site\":\"T-GARMENT;A-MAIN STORE. KOTRI;MDM-K. KOTRI-II;N-Knitting;MDM-C.KOTRI;F-MDMSITE-2\",\"registrationType\":\"Registered\",\"fbrProvinceCode\":8}" \
  "$BASE/api/clients/common/$MEKO_GROUP")
UPD=$(echo "$RESULT" | python -c "import sys,json; print(json.load(sys.stdin).get('clientsUpdated',0))")
[ "$UPD" -ge 2 ] && ok "Update propagated to $UPD clients" || ng "Propagation broken ($UPD)"

# Re-check Roshan client 5 site / Hakimi-Sandbox client 19 site after propagation
ROSHAN_MEKO=$(curl -s -H "$H" "$BASE/api/clients/5" | python -c "import sys,json; d=json.load(sys.stdin); print(d.get('site',''))")
SANDBOX_MEKO=$(curl -s -H "$H" "$BASE/api/clients/19" | python -c "import sys,json; d=json.load(sys.stdin); print(d.get('site',''))")
echo "  Roshan-Meko Site length: ${#ROSHAN_MEKO}"
echo "  Sandbox-Meko Site length: ${#SANDBOX_MEKO}"
[ ${#SANDBOX_MEKO} -gt 30 ] && ok "Sandbox-Meko received Roshan's site list (was empty before)" \
                            || ng "Sandbox-Meko did not get sites: \"$SANDBOX_MEKO\""

# ── FBR validate AFTER propagation ─────────────────────────────────────
echo "== 9. FBR validate still passes after propagation =="
VR2=$(curl -s -X POST -H "$H" "$BASE/api/fbr/1039/validate")
SUC2=$(echo "$VR2" | python -c "import sys,json; print(json.load(sys.stdin).get('success'))")
[ "$SUC2" = "True" ] && ok "FBR validate after propagation: still passes" \
                    || ng "FBR validate broken post-propagation"

# ── Common Clients list count unchanged after edit ─────────────────────
echo "== 10. Common Clients list count unchanged after edit =="
N1B=$(curl -s -H "$H" "$BASE/api/clients/common?companyId=1" | python -c "import sys,json; print(len(json.load(sys.stdin)))")
[ "$N1B" = "$N1" ] && ok "Common count stable: $N1 → $N1B" \
                  || ng "Common count drifted: $N1 → $N1B"

echo
echo "==== Result: $PASS passed, $FAIL failed ===="
[ $FAIL -eq 0 ] || exit 1

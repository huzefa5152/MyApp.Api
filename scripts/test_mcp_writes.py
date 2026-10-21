"""
Hosted MCP write tools on the importer line: prepare / approve / commit.

  1. The cycle: prepare saves nothing; commit writes exactly once through the screen's service;
     a second commit, a cancel after commit and another token's plan id are refused; an
     idempotency key returns the same plan, then the same result.
  2. Every gate is checked again at commit: a revoked permission, a removed company, a switched
     off write opt-in, and a record changed since the plan (the plan is re-prepared and must match).
  3. The hourly ceiling per user and tool.
  4. Every write tool once, end to end, verified in the database: customer, supplier, item (with
     the company's own name), quotation, sales order (items and from a quotation), challan
     (items and from an order), bill (standalone and from a challan), purchase bill, goods
     receipt, customer receipt with an allocation, supplier payment on account, hand-entered GD
     costing, GD charge add and remove, GD line correction, claim months (GD and line), letter of
     credit (create, update, link), opening balance, journal entry.
  5. Linked records of another company are refused in every write: customer, bill, GD, LC,
     account, item, opening balance.

LOCAL only (refuses a non-localhost base); needs sqlcmd. Uses the shared fixture companies and
throwaway users "mcpw_*".

Usage: python scripts/test_mcp_writes.py --base http://localhost:5141 --db MyApp_Importer_Local
"""
from __future__ import annotations

import argparse
import json
import secrets
import subprocess
import sys
from datetime import date

import mcp_importer_fixture as fx
from mcp_importer_fixture import call, http, login, tools

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://localhost:5141")
ap.add_argument("--sql-server", default=r".\MSSQLSERVER02")
ap.add_argument("--db", default="MyApp_Importer_Local")
ARGS = ap.parse_args()
fx.set_base(ARGS.base)
RUN = secrets.token_hex(3)
TODAY = date.today().isoformat()
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), str(detail)))
    print(("  PASS  " if ok else "  FAIL  ") + name + ("" if ok else f"  -> {str(detail)[:500]}"))


def sql(q):
    out = subprocess.run(["sqlcmd", "-S", ARGS.sql_server, "-d", ARGS.db, "-E", "-C", "-I", "-b", "-h", "-1", "-W", "-Q", "SET NOCOUNT ON; " + q],
                         capture_output=True, text=True)
    assert out.returncode == 0, out.stdout + out.stderr
    return [l.strip() for l in out.stdout.splitlines() if l.strip()]


def one(q):
    r = sql(q)
    return int(r[0]) if r and r[0].lstrip("-").isdigit() else None


def count(table, where):
    return one(f"SELECT COUNT(*) FROM {table} WHERE {where}")


def prepare(tok, name, args):
    refused, text = call(tok, name, args)
    return (None, text) if refused else (json.loads(text), text)


def commit(tok, plan):
    refused, text = call(tok, "commit_action", {"planId": plan["planId"]})
    return (None, text) if refused else (json.loads(text), text)


def cycle(tok, label, name, args, table, where):
    """Prepare (nothing saved), commit (one row), return the commit result."""
    before = count(table, where)
    plan, text = prepare(tok, name, args)
    if not plan:
        check(f"{label}: prepares", False, text)
        return None
    check(f"{label}: prepare saves nothing", count(table, where) == before, (before, count(table, where)))
    res, text = commit(tok, plan)
    check(f"{label}: commit writes exactly one record through the screen's service", res and res["committed"] and count(table, where) == before + 1,
          (text, before, count(table, where)))
    return res


print(f"Importer MCP writes against {fx.BASE}  (run {RUN})")
admin = login("admin", "admin123")
A, B = fx.companies(admin)
fx.remove_users(admin, "mcpw_")
sysr = fx.system_roles(admin)
STAFF, MCPA, MCPW = fx.staff_role(admin), sysr["MCP Access"], sysr["MCP Write"]
uid, jw = fx.make_user(admin, "mcpw_writer", [A], [STAFF, MCPA, MCPW])
T = fx.token_for(jw, [A])
listed = tools(T)
check("a write token lists every importer write tool",
      all(n in listed for n in ("prepare_client", "prepare_bill", "prepare_gd_costing", "prepare_gd_claim_month", "prepare_lc",
                                 "prepare_opening_stock", "prepare_receipt", "prepare_supplier_payment", "prepare_journal_entry", "commit_action")),
      sorted(n for n in listed if n.startswith("prepare_")))

client_a = one(f"SELECT TOP 1 Id FROM Clients WHERE CompanyId = {A} ORDER BY Id")
client_b = one(f"SELECT TOP 1 Id FROM Clients WHERE CompanyId = {B} ORDER BY Id")
supplier_a = one(f"SELECT TOP 1 Id FROM Suppliers WHERE CompanyId = {A} ORDER BY Id")
item_a = one(f"SELECT TOP 1 ItemTypeId FROM OpeningStockBalances WHERE CompanyId = {A} ORDER BY Id")
item_b_only = one(f"SELECT TOP 1 ItemTypeId FROM OpeningStockBalances b WHERE CompanyId = {B} AND NOT EXISTS (SELECT 1 FROM OpeningStockBalances a WHERE a.CompanyId = {A} AND a.ItemTypeId = b.ItemTypeId)")

# ── 1. the cycle ─────────────────────────────────────────────────────
print("\n== 1. prepare / commit / cancel / idempotency ==")
name = f"MCP Writes Client {RUN}"
key = f"key-{RUN}"
plan, text = prepare(T, "prepare_client", {"companyId": A, "name": name, "idempotencyKey": key})
check("prepare_client returns a plan and saves nothing", plan and plan["saved"] is False and count("Clients", f"Name = '{name}'") == 0, text)
again, _ = prepare(T, "prepare_client", {"companyId": A, "name": name, "idempotencyKey": key})
check("the same idempotency key returns the same plan", again and again["planId"] == plan["planId"], again)
refused, text = call(T, "prepare_client", {"companyId": A, "name": name + " other", "idempotencyKey": key})
check("…and the same key for different arguments still answers with the original plan, never a second one", (not refused and json.loads(text)["planId"] == plan["planId"]) or refused, text)
res, text = commit(T, plan)
check("commit creates the customer once", res and count("Clients", f"Name = '{name}' AND CompanyId = {A}") == 1, text)
refused, text = call(T, "commit_action", {"planId": plan["planId"]})
check("a second commit of the same plan is refused", refused and "already" in text, text)
refused, text = call(T, "cancel_action", {"planId": plan["planId"]})
check("a committed plan cannot be cancelled", refused, text)
st = json.loads(call(T, "get_action_status", {"planId": plan["planId"]})[1])
check("get_action_status says succeeded with the record reference", st["status"] == "succeeded" and st["resultRef"].startswith("Client:"), st)
redo, _ = prepare(T, "prepare_client", {"companyId": A, "name": name, "idempotencyKey": key})
check("the key after commit reports the earlier result instead of a duplicate", redo and redo.get("alreadyDone") is True, redo)
p2, _ = prepare(T, "prepare_client", {"companyId": A, "name": f"MCP cancel {RUN}"})
call(T, "cancel_action", {"planId": p2["planId"]})
refused, text = call(T, "commit_action", {"planId": p2["planId"]})
check("a cancelled plan cannot be committed", refused and "not found" in text.lower(), text)
_, jother = fx.make_user(admin, "mcpw_other", [A], [STAFF, MCPA, MCPW])
T2 = fx.token_for(jother, [A])
p3, _ = prepare(T, "prepare_client", {"companyId": A, "name": f"MCP foreign {RUN}"})
for t in ("get_action_status", "commit_action", "cancel_action"):
    refused, text = call(T2, t, {"planId": p3["planId"]})
    check(f"{t} with another user's plan id answers like a missing plan", refused and "not found" in text.lower(), text)
call(T, "cancel_action", {"planId": p3["planId"]})

# ── 2. gates at commit ───────────────────────────────────────────────
print("\n== 2. every gate is checked again at commit ==")
noclient = fx.role_with(admin, "MCP Suite Staff (no customers)", [p["key"] for p in http("GET", "/api/permissions", admin)[1]
                         if not p["key"].startswith(fx.ADMIN_PREFIXES) and not p["key"].startswith("clients.manage.c")])
p4, _ = prepare(T, "prepare_client", {"companyId": A, "name": f"MCP gate perm {RUN}"})
http("PUT", f"/api/users/{uid}/roles", admin, {"roleIds": [noclient, MCPA, MCPW]})
refused, text = call(T, "commit_action", {"planId": p4["planId"]})
check("a permission removed after prepare refuses the commit", refused and count("Clients", f"Name = 'MCP gate perm {RUN}'") == 0, text)
http("PUT", f"/api/users/{uid}/roles", admin, {"roleIds": [STAFF, MCPA, MCPW]})
p5, _ = prepare(T, "prepare_client", {"companyId": A, "name": f"MCP gate company {RUN}"})
http("PUT", f"/api/usercompanies/user/{uid}", admin, {"companyIds": []})
refused, text = call(T, "commit_action", {"planId": p5["planId"]})
check("a company unassigned after prepare refuses the commit", refused and count("Clients", f"Name = 'MCP gate company {RUN}'") == 0, text)
http("PUT", f"/api/usercompanies/user/{uid}", admin, {"companyIds": [A]})
p6, _ = prepare(T, "prepare_client", {"companyId": A, "name": f"MCP gate optin {RUN}"})
s, cat = http("GET", f"/api/mcp/catalog/{uid}", admin)
granted = [t["name"] for t in cat["tools"] if t["granted"] and t["configurable"]]
http("PUT", f"/api/mcp/catalog/{uid}", admin, {"revision": cat["revision"], "accessGranted": True, "accessEnabled": True, "writesGranted": True,
     "writesEnabled": False, "grantedTools": granted, "selectedTools": granted})
refused, text = call(T, "commit_action", {"planId": p6["planId"]})
check("write access switched off after prepare refuses the commit", refused and count("Clients", f"Name = 'MCP gate optin {RUN}'") == 0, text)
fx.grant_catalog(admin, uid)
created = one(f"SELECT Id FROM Clients WHERE Name = '{name}' AND CompanyId = {A}")
p7, _ = prepare(T, "prepare_client", {"companyId": A, "clientId": created, "phone": "021-1111111"})
http("PUT", f"/api/clients/{created}", admin, {"id": created, "companyId": A, "name": name, "phone": "021-2222222", "registrationType": "Unregistered"})
refused, text = call(T, "commit_action", {"planId": p7["planId"]})
check("a record changed since the plan refuses the commit (prepare it again)", refused and "changed" in text, text)
st = json.loads(call(T, "get_action_status", {"planId": p7["planId"]})[1])
check("…and the refused plan is still only prepared, never half-applied", st["status"] == "prepared", st)
call(T, "cancel_action", {"planId": p7["planId"]})

# ── 3. hourly ceiling ────────────────────────────────────────────────
print("\n== 3. hourly ceiling ==")
tok_id = one(f"SELECT TOP 1 Id FROM McpAgentTokens WHERE UserId = {uid} ORDER BY Id DESC")
sql(f"INSERT INTO McpPendingActions (PlanId, AgentTokenId, UserId, CompanyId, Kind, Payload, Summary, CreatedAt, ExpiresAt, CommittedAt, ResultRef) "
    f"SELECT CONCAT('plan_cap_{RUN}_', n), {tok_id}, {uid}, {A}, 'journal_entry', '{{}}', 'cap fill', SYSUTCDATETIME(), DATEADD(minute,10,SYSUTCDATETIME()), SYSUTCDATETIME(), 'JournalEntry:0' "
    "FROM (VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10)) v(n)")
accts = json.loads(call(T, "search_accounts", {"companyId": A, "limit": 100})[1])["items"]
postable = [a for a in accts if a["journalPostable"]]
cash = next(a for a in postable if a["type"] == "Expense")
other = next(a for a in postable if a["type"] in ("Equity", "Liability"))
bank = next((a for a in accts if not a["journalPostable"]), None)
je_args = {"companyId": A, "date": TODAY, "narration": f"MCP cap {RUN}", "lines": [{"accountId": cash["accountId"], "debit": "10"}, {"accountId": other["accountId"], "credit": "10"}]}
p8, text = prepare(T, "prepare_journal_entry", je_args)
refused, text = call(T, "commit_action", {"planId": p8["planId"]}) if p8 else (True, text)
check("the 11th journal entry within the hour is refused", refused and "last hour" in text, text)
sql(f"DELETE FROM McpPendingActions WHERE PlanId LIKE 'plan_cap_{RUN}_%'")
if p8:
    call(T, "cancel_action", {"planId": p8["planId"]})

# ── 4. every write tool ──────────────────────────────────────────────
print("\n== 4. every write tool, end to end ==")
cycle(T, "supplier", "prepare_supplier", {"companyId": A, "name": f"MCP Supplier {RUN}"}, "Suppliers", f"CompanyId = {A}")
res = cycle(T, "item with its own name", "prepare_item_type", {"companyId": A, "name": f"MCP ITEM {RUN}", "hsCode": "7318.1510", "uom": "Pcs", "displayName": f"Our item {RUN}"},
            "CompanyItemTypeSettings", f"CompanyId = {A}")
if res:
    new_item = int(res["resultRef"].split(":")[1])
    check("…the company's own name is on its overlay, not the shared row",
          sql(f"SELECT DisplayName FROM CompanyItemTypeSettings WHERE CompanyId = {A} AND ItemTypeId = {new_item}") == [f"Our item {RUN}"]
          and sql(f"SELECT Name FROM ItemTypes WHERE Id = {new_item}") == [f"MCP ITEM {RUN}"])
    names = json.loads(call(T, "search_item_types", {"companyId": A, "search": f"MCP ITEM {RUN}"})[1])["items"]
    check("…and search_item_types shows the company's name", any(i["displayName"] == f"Our item {RUN}" for i in names), names)
line = [{"description": f"MCP line {RUN}", "quantity": "2", "unit": "Pcs", "unitPrice": "500", "itemTypeId": item_a}]
res = cycle(T, "quotation", "prepare_quote", {"companyId": A, "clientId": client_a, "items": line}, "SalesQuotes", f"CompanyId = {A}")
quote_id = int(res["resultRef"].split(":")[1]) if res else None
cycle(T, "sales order from items", "prepare_sales_order", {"companyId": A, "clientId": client_a, "items": line}, "SalesOrders", f"CompanyId = {A}")
res = cycle(T, "sales order from a quotation", "prepare_sales_order", {"companyId": A, "quoteId": quote_id}, "SalesOrders", f"CompanyId = {A}")
order_id = int(res["resultRef"].split(":")[1]) if res else None
order = json.loads(call(T, "get_sales_order", {"companyId": A, "orderId": order_id})[1]) if order_id else {"lines": {"items": []}}
ol = order["lines"]["items"][0] if order["lines"]["items"] else {"salesOrderItemId": 1}
cycle(T, "challan delivering a sales order", "prepare_challan", {"companyId": A, "salesOrderId": order_id, "deliveryDate": TODAY,
      "lines": [{"salesOrderItemId": ol["salesOrderItemId"], "quantity": "1"}]}, "DeliveryChallans", f"CompanyId = {A}")
res = cycle(T, "challan from items", "prepare_challan", {"companyId": A, "clientId": client_a, "deliveryDate": TODAY,
            "items": [{"description": f"MCP deliver {RUN}", "quantity": "1", "unit": "Pcs", "itemTypeId": item_a}]}, "DeliveryChallans", f"CompanyId = {A}")
challan_id = int(res["resultRef"].split(":")[1]) if res else None
cycle(T, "standalone bill", "prepare_bill", {"companyId": A, "clientId": client_a, "items": line}, "Invoices", f"CompanyId = {A}")
ch = json.loads(call(T, "get_challan", {"companyId": A, "challanId": challan_id})[1]) if challan_id else {"lines": {"items": []}}
prices = [{"deliveryItemId": l["deliveryItemId"], "unitPrice": "750"} for l in ch["lines"]["items"]]
res = cycle(T, "bill from a challan", "prepare_bill", {"companyId": A, "clientId": client_a, "challanIds": [challan_id], "prices": prices}, "Invoices", f"CompanyId = {A}")
bill_id = int(res["resultRef"].split(":")[1]) if res else None
check("…the challan is now billed", challan_id and one(f"SELECT COUNT(*) FROM DeliveryChallans WHERE Id = {challan_id} AND InvoiceId = {bill_id or 0}") == 1)
refused, text = call(T, "prepare_bill", {"companyId": A, "clientId": client_a, "challanIds": [challan_id], "prices": prices})
check("…and cannot be billed twice", refused and "cannot be billed" in text, text)
refused, text = call(T, "prepare_bill", {"companyId": A, "clientId": client_a, "date": "2099-01-01", "items": line})
check("a future-dated bill is refused", refused and "future" in text, text)
cycle(T, "purchase bill", "prepare_purchase_bill", {"companyId": A, "supplierId": supplier_a, "items": [{"description": f"MCP buy {RUN}", "quantity": "3", "unitPrice": "300", "unit": "Pcs", "itemTypeId": item_a}]},
      "PurchaseBills", f"CompanyId = {A}")
cycle(T, "goods receipt", "prepare_goods_receipt", {"companyId": A, "supplierId": supplier_a, "items": [{"description": f"MCP in {RUN}", "quantity": 2, "unit": "Pcs", "itemTypeId": item_a}]},
      "GoodsReceipts", f"CompanyId = {A}")
res = cycle(T, "customer receipt with an allocation", "prepare_receipt", {"companyId": A, "clientId": client_a, "amount": "1000", "allocations": [{"invoiceId": bill_id, "amount": "200"}]},
            "Payments", f"CompanyId = {A} AND Direction = 0")
if res:
    pid = int(res["resultRef"].split(":")[1])
    check("…200 settles the bill and 800 stays on account", one(f"SELECT CAST(SUM(Amount) AS INT) FROM PaymentAllocations WHERE PaymentId = {pid} AND InvoiceId = {bill_id}") == 200, sql(f"SELECT Amount FROM PaymentAllocations WHERE PaymentId = {pid}"))
cycle(T, "supplier payment on account", "prepare_supplier_payment", {"companyId": A, "supplierId": supplier_a, "amount": "400"}, "Payments", f"CompanyId = {A} AND Direction = 1")

gd = f"KAPE-HC-{secrets.randbelow(80000) + 10000}"
gd_line = {"description": f"MCP GD ITEM {RUN}", "hsCode": "7318.1590", "quantity": "10", "unit": "Pcs", "assessedValue": "10000", "salesTaxRate": "18",
           "astRate": "3", "incomeTaxRate": "6", "claimMonth": "2026-08", "confirmNewStock": True}
refused, text = call(T, "prepare_gd_costing", {"companyId": A, "gdNumber": gd, "gdDate": "2026-08-10", "mode": "new-arrivals", "lines": [{**gd_line, "confirmNewStock": False}]})
if refused:
    check("a GD line that would create unconfirmed stock is refused with the screen's checklist", "confirm" in text.lower(), text)
else:
    # The line matched stock already on the books (an earlier run's item), so no new stock needs confirming.
    pv = json.loads(text)
    check("an unconfirmed GD line is accepted only when it creates no new stock", all(l["disposition"] != "stock-posted" for l in pv["details"]["lines"]), text)
    call(T, "cancel_action", {"planId": pv["planId"]})
res = cycle(T, "hand-entered GD costing", "prepare_gd_costing", {"companyId": A, "gdNumber": gd, "gdDate": "2026-08-10", "mode": "new-arrivals", "lines": [gd_line]},
            "ImportConsignments", f"CompanyId = {A}")
gd_id = one(f"SELECT Id FROM ImportConsignments WHERE CompanyId = {A} AND GdNumber = '{gd}'")
check("…with the line's claim month", one(f"SELECT COUNT(*) FROM ImportConsignmentLines WHERE ImportConsignmentId = {gd_id or 0} AND ClaimMonth = '2026-08-01'") == 1)
refused, text = call(T, "prepare_gd_costing", {"companyId": A, "gdNumber": gd, "gdDate": "2026-08-10", "mode": "new-arrivals", "lines": [gd_line]})
p9 = json.loads(text) if not refused else None
r9 = commit(T, p9)[1] if p9 else text
check("the same GD again is refused (the import's own duplicate guard)", (refused or "refused" in r9) and count("ImportConsignments", f"CompanyId = {A} AND GdNumber = '{gd}'") == 1, r9)
res = cycle(T, "GD charge add", "prepare_gd_charge", {"companyId": A, "gdId": gd_id, "action": "add", "kind": "freight", "amount": "500"},
            "ImportConsignmentCharges", f"ImportConsignmentId = {gd_id or 0}")
charge_id = one(f"SELECT TOP 1 Id FROM ImportConsignmentCharges WHERE ImportConsignmentId = {gd_id or 0}")
plan, text = prepare(T, "prepare_gd_charge", {"companyId": A, "gdId": gd_id, "action": "remove", "chargeId": charge_id})
res, text = commit(T, plan) if plan else (None, text)
check("GD charge remove", res and count("ImportConsignmentCharges", f"ImportConsignmentId = {gd_id or 0}") == 0, text)
line_id = one(f"SELECT TOP 1 Id FROM ImportConsignmentLines WHERE ImportConsignmentId = {gd_id or 0}")
plan, text = prepare(T, "prepare_gd_line_correction", {"companyId": A, "gdId": gd_id, "lineId": line_id, "assessedValue": "12000", "reason": "MCP test"})
res, text = commit(T, plan) if plan else (None, text)
check("GD line correction goes through the screen's service", res and one(f"SELECT CAST(AssessedValue AS INT) FROM ImportConsignmentLines WHERE Id = {line_id}") == 12000, text)
plan, text = prepare(T, "prepare_gd_claim_month", {"companyId": A, "lineId": line_id, "claimMonth": "2026-09"})
res, text = commit(T, plan) if plan else (None, text)
check("line claim month set", res and one(f"SELECT COUNT(*) FROM ImportConsignmentLines WHERE Id = {line_id} AND ClaimMonth = '2026-09-01'") == 1, text)
plan, text = prepare(T, "prepare_gd_claim_month", {"companyId": A, "gdNumber": gd, "claimMonth": "2026-09"})
res, text = commit(T, plan) if plan else (None, text)
check("GD claim month set", res and count("GdClaimPeriods", f"CompanyId = {A} AND GdNumber = '{gd}' AND ClaimMonth = '2026-09-01'") == 1, text)
refused, text = call(T, "prepare_gd_claim_month", {"companyId": A, "gdNumber": gd, "claimMonth": "2026-09-15"})
check("a claim month that is not the first of a month is refused", refused, text)
refused, text = call(T, "prepare_gd_claim_month", {"companyId": A, "gdNumber": "NO-SUCH-GD", "claimMonth": "2026-09"})
check("a GD number the company does not have is refused", refused and "no stock GD" in text, text)
res = cycle(T, "letter of credit", "prepare_lc", {"companyId": A, "action": "create", "lcNumber": f"LC-{RUN}", "foreignAmount": "5000", "openedOn": "2026-07-01"},
            "ImportLetterOfCredits", f"CompanyId = {A}")
lc_id = int(res["resultRef"].split(":")[1]) if res else None
plan, text = prepare(T, "prepare_lc", {"companyId": A, "action": "update", "lcId": lc_id, "status": "closed"})
res, text = commit(T, plan) if plan else (None, text)
check("LC update", res and count("ImportLetterOfCredits", f"Id = {lc_id} AND Status = 'closed'") == 1, text)
plan, text = prepare(T, "prepare_lc", {"companyId": A, "action": "link", "gdId": gd_id, "lcId": lc_id, "blNumber": "BL-1"})
res, text = commit(T, plan) if plan else (None, text)
check("GD linked to the LC", res and count("ImportConsignments", f"Id = {gd_id} AND ImportLcId = {lc_id}") == 1, text)
before = sql(f"SELECT CAST(Quantity AS DECIMAL(18,2)) FROM OpeningStockBalances WHERE CompanyId = {A} AND ItemTypeId = {item_a}")
plan, text = prepare(T, "prepare_opening_stock", {"companyId": A, "itemTypeId": item_a, "quantity": "150", "valueExcludingTax": "75000", "salesTaxRate": "18", "asOfDate": "2026-01-01"})
check("opening balance plan shows the before and after", plan and plan["details"]["replaces"] and plan["details"]["after"]["quantity"] == 150, text)
res, text = commit(T, plan) if plan else (None, text)
check("opening balance replaced through the stock screen's service", res and sql(f"SELECT CAST(Quantity AS DECIMAL(18,2)) FROM OpeningStockBalances WHERE CompanyId = {A} AND ItemTypeId = {item_a}") == ["150.00"], (before, text))
res = cycle(T, "journal entry", "prepare_journal_entry", {**je_args, "narration": f"MCP journal {RUN}"}, "JournalEntries", f"CompanyId = {A} AND Narration = 'MCP journal {RUN}'")
refused, text = call(T, "prepare_journal_entry", {**je_args, "lines": [{"accountId": cash["accountId"], "debit": "10"}, {"accountId": other["accountId"], "credit": "9"}]})
check("an unbalanced journal entry is refused", refused and "equal" in text, text)
if bank:
    refused, text = call(T, "prepare_journal_entry", {**je_args, "lines": [{"accountId": bank["accountId"], "debit": "10"}, {"accountId": other["accountId"], "credit": "10"}]})
    check("a journal entry on a bank or cash account is refused at prepare", refused and "Bank and cash" in text, text)

# ── 5. another company's linked records ──────────────────────────────
print("\n== 5. linked records of another company are refused ==")
b_bill = one(f"SELECT TOP 1 Id FROM Invoices WHERE CompanyId = {B}")
b_gd = one(f"SELECT TOP 1 Id FROM ImportConsignments WHERE CompanyId = {B}")
b_lc = one(f"SELECT TOP 1 Id FROM ImportLetterOfCredits WHERE CompanyId = {B}")
b_acct = one(f"SELECT TOP 1 Id FROM Accounts WHERE CompanyId = {B}")
b_line = one(f"SELECT TOP 1 l.Id FROM ImportConsignmentLines l JOIN ImportConsignments c ON c.Id = l.ImportConsignmentId WHERE c.CompanyId = {B}")
b_challan = one(f"SELECT TOP 1 Id FROM DeliveryChallans WHERE CompanyId = {B}")
b_order = one(f"SELECT TOP 1 Id FROM SalesOrders WHERE CompanyId = {B}")
cases = [
    ("bill for B's customer", "prepare_bill", {"companyId": A, "clientId": client_b, "items": line}),
    ("bill of B's challan", "prepare_bill", {"companyId": A, "clientId": client_a, "challanIds": [b_challan], "prices": [{"deliveryItemId": 1, "unitPrice": "1"}]}),
    ("receipt allocating B's bill", "prepare_receipt", {"companyId": A, "clientId": client_a, "amount": "10", "allocations": [{"invoiceId": b_bill, "amount": "10"}]}),
    ("charge on B's GD", "prepare_gd_charge", {"companyId": A, "gdId": b_gd, "action": "add", "kind": "freight", "amount": "1"}),
    ("correction of B's GD", "prepare_gd_line_correction", {"companyId": A, "gdId": b_gd, "lineId": b_line, "reason": "x"}),
    ("claim month on B's GD line", "prepare_gd_claim_month", {"companyId": A, "lineId": b_line, "claimMonth": "2026-08"}),
    ("link to B's LC", "prepare_lc", {"companyId": A, "action": "link", "gdId": gd_id, "lcId": b_lc}),
    ("update of B's LC", "prepare_lc", {"companyId": A, "action": "update", "lcId": b_lc, "status": "closed"}),
    ("journal on B's account", "prepare_journal_entry", {**je_args, "lines": [{"accountId": b_acct, "debit": "10"}, {"accountId": other["accountId"], "credit": "10"}]}),
    ("challan delivering B's order", "prepare_challan", {"companyId": A, "salesOrderId": b_order, "deliveryDate": TODAY, "lines": [{"salesOrderItemId": 1, "quantity": "1"}]}),
    ("opening balance for an item only B holds", "prepare_opening_stock", {"companyId": A, "itemTypeId": item_b_only, "quantity": "1", "valueExcludingTax": "1", "salesTaxRate": "18", "asOfDate": "2026-01-01"}),
    ("quotation line with an item only B holds", "prepare_quote", {"companyId": A, "clientId": client_a, "items": [{**line[0], "itemTypeId": item_b_only}]}),
    ("update of B's customer", "prepare_client", {"companyId": A, "clientId": client_b, "phone": "1"}),
    ("anything in company B itself", "prepare_client", {"companyId": B, "name": "x"}),
]
for label, tool, args in cases:
    refused, text = call(T, tool, args)
    check(f"refused: {label}", refused, text)

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} MCP write checks passed")
if fails:
    sys.exit(1)
fx.remove_users(admin, "mcpw_")
print("all checks passed")

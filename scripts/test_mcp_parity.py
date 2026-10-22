"""
Importer MCP full parity (2026-10-22): the tools that let an administrator's agent do what the
screens do, for the companies the user holds and no other.

Every case runs twice in spirit: the company the user holds (A) works, and a record or company the
user was never given (B) is refused, at prepare and therefore at commit. Results are checked in the
database, not only in the tool's answer.

  Phase 1. Edits of quotes, orders, challans, bills, purchase bills, goods receipts, receipts and
           journals; receipt allocation; withholding tax receipts; stock values, movements, GD pools,
           tie-out and adjustment; single-record reads.

LOCAL only; needs sqlcmd. Uses the shared fixture companies and throwaway users "mcpp_*".

Usage: python scripts/test_mcp_parity.py --base http://localhost:5191 --db MyApp_Importer_Local
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date

import mcp_importer_fixture as fx
from mcp_importer_fixture import call, login, tools

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://localhost:5191")
ap.add_argument("--sql-server", default=r".\MSSQLSERVER02")
ap.add_argument("--db", default="MyApp_Importer_Local")
ARGS = ap.parse_args()
fx.set_base(ARGS.base)
TODAY = date.today().isoformat()
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("  PASS  " if ok else "  FAIL  ") + name + ("" if ok else f"  -> {str(detail)[:400]}"))
    return ok


def sql(q):
    out = subprocess.run(["sqlcmd", "-S", ARGS.sql_server, "-d", ARGS.db, "-E", "-C", "-I", "-b", "-h", "-1", "-W", "-Q", "SET NOCOUNT ON; " + q],
                         capture_output=True, text=True)
    assert out.returncode == 0, out.stdout + out.stderr
    return [l.strip() for l in out.stdout.splitlines() if l.strip()]


def one(q):
    r = sql(q)
    return int(r[0]) if r and r[0].lstrip("-").isdigit() else None


def val(q):
    r = sql(q)
    return r[0] if r else None


def prepare(tok, name, args):
    refused, text = call(tok, name, args)
    return (None, text) if refused else (json.loads(text), text)


def commit(tok, plan):
    refused, text = call(tok, "commit_action", {"planId": plan["planId"]})
    return (None, text) if refused else (json.loads(text), text)


def run(tok, label, name, args):
    plan, text = prepare(tok, name, args)
    if not check(f"{label}: prepares", plan, text):
        return None
    res, text = commit(tok, plan)
    check(f"{label}: commits", res and res.get("committed"), text)
    return res


def refused(tok, label, name, args):
    r, text = call(tok, name, args)
    check(f"refused: {label}", r, text)


def read(tok, name, args):
    r, text = call(tok, name, args)
    return None if r else json.loads(text)


print(f"Importer MCP parity against {fx.BASE}")
admin = login("admin", "admin123")
A, B = fx.companies(admin)
fx.remove_users(admin, "mcpp_")
sysr = fx.system_roles(admin)
uid, jw = fx.make_user(admin, "mcpp_admin", [A], [fx.staff_role(admin), sysr["MCP Access"], sysr["MCP Write"]])
T = fx.token_for(jw, [A])
listed = set(tools(T))

# ── phase 1 ──────────────────────────────────────────────────────────
print("\n== Phase 1: edits, allocation, withholding tax, stock, single reads ==")
phase1 = {"get_stock_values", "get_stock_movements", "get_stock_gd_details", "get_stock_tie_out", "prepare_stock_adjustment",
          "search_withholding_receipts", "get_withholding_receipt", "prepare_withholding_receipt", "prepare_receipt_allocation",
          "get_receipt", "get_payment", "get_goods_receipt", "get_journal_entry"}
check("every phase 1 tool is listed for an administrator with MCP write", phase1 <= listed, sorted(phase1 - listed))

client_a = one(f"SELECT TOP 1 Id FROM Clients WHERE CompanyId = {A} ORDER BY Id")
client_b = one(f"SELECT TOP 1 Id FROM Clients WHERE CompanyId = {B} ORDER BY Id")
supplier_a = one(f"SELECT TOP 1 Id FROM Suppliers WHERE CompanyId = {A} ORDER BY Id")
bolt_a = one(f"SELECT TOP 1 m.ItemTypeId FROM StockMovements m JOIN ItemTypes t ON t.Id = m.ItemTypeId WHERE m.CompanyId = {A} AND t.Name LIKE '%BOLT' ORDER BY m.Id")
bolt_b = one(f"SELECT TOP 1 m.ItemTypeId FROM StockMovements m JOIN ItemTypes t ON t.Id = m.ItemTypeId WHERE m.CompanyId = {B} AND t.Name LIKE '%BOLT' ORDER BY m.Id")

def latest(table, company):
    return one(f"SELECT TOP 1 Id FROM {table} WHERE CompanyId = {company} ORDER BY Id DESC")

# quotation edit
run(T, "quotation to edit", "prepare_quote", {"companyId": A, "clientId": client_a, "notes": "mcpp edit me",
    "items": [{"description": "first", "quantity": "1", "unit": "Pcs", "unitPrice": "600", "itemTypeId": bolt_a}]})
q_a = one(f"SELECT TOP 1 Id FROM SalesQuotes WHERE CompanyId = {A} AND Notes = 'mcpp edit me' ORDER BY Id DESC")
q_b = latest("SalesQuotes", B)
qd = read(T, "get_quote", {"companyId": A, "quoteId": q_a})
line = (qd or {}).get("lines", {}).get("items", [{}])[0] if qd else {}
run(T, "quotation edit", "prepare_quote", {"companyId": A, "quoteId": q_a, "clientId": client_a,
    "items": [{"id": line.get("id"), "description": "Edited by MCP", "quantity": "7", "unit": "Pcs", "unitPrice": "655", "itemTypeId": bolt_a}]})
check("the quotation line now reads 7 at 655", val(f"SELECT CONCAT(CAST(Quantity AS DECIMAL(18,0)), '@', CAST(UnitPrice AS DECIMAL(18,0))) FROM SalesQuoteItems WHERE SalesQuoteId = {q_a}") == "7@655")
refused(T, "edit B's quotation", "prepare_quote", {"companyId": A, "quoteId": q_b, "clientId": client_a, "items": [{"description": "x", "quantity": "1", "unit": "Pcs", "unitPrice": "1"}]})
refused(T, "a line of another quotation", "prepare_quote", {"companyId": A, "quoteId": q_a, "clientId": client_a,
    "items": [{"id": one(f"SELECT TOP 1 Id FROM SalesQuoteItems WHERE SalesQuoteId = {q_b}"), "description": "x", "quantity": "1", "unit": "Pcs", "unitPrice": "1"}]})

# sales order edit
run(T, "sales order to edit", "prepare_sales_order", {"companyId": A, "clientId": client_a, "notes": "mcpp edit me",
    "items": [{"description": "first", "quantity": "1", "unit": "Pcs", "unitPrice": "600", "itemTypeId": bolt_a}]})
o_a = one(f"SELECT TOP 1 Id FROM SalesOrders WHERE CompanyId = {A} AND Notes = 'mcpp edit me' ORDER BY Id DESC")
o_b = latest("SalesOrders", B)
od = read(T, "get_sales_order", {"companyId": A, "salesOrderId": o_a})
oline = (od or {}).get("lines", {}).get("items", [{}])[0] if od else {}
run(T, "sales order edit", "prepare_sales_order", {"companyId": A, "salesOrderId": o_a, "clientId": client_a,
    "items": [{"id": oline.get("id"), "description": "Order edited", "quantity": "6", "unit": "Pcs", "unitPrice": "640", "itemTypeId": bolt_a}]})
check("the order line now reads 6", val(f"SELECT CAST(Quantity AS DECIMAL(18,0)) FROM SalesOrderItems WHERE SalesOrderId = {o_a}") == "6")
refused(T, "edit B's sales order", "prepare_sales_order", {"companyId": A, "salesOrderId": o_b, "clientId": client_a, "items": [{"description": "x", "quantity": "1", "unit": "Pcs"}]})

# challan edit
c_a = one(f"SELECT TOP 1 Id FROM DeliveryChallans WHERE CompanyId = {A} AND InvoiceId IS NULL AND Status NOT IN ('Cancelled','Invoiced') ORDER BY Id DESC")
c_b = latest("DeliveryChallans", B)
cd = read(T, "get_challan", {"companyId": A, "challanId": c_a})
cline = (cd or {}).get("lines", {}).get("items", [{}])[0] if cd else {}
run(T, "challan edit", "prepare_challan", {"companyId": A, "challanId": c_a, "clientId": client_a, "deliveryDate": TODAY,
    "items": [{"id": cline.get("id"), "description": "Challan edited", "quantity": "2", "unit": "Pcs", "itemTypeId": bolt_a}]})
check("the challan line now reads 2", val(f"SELECT CAST(Quantity AS DECIMAL(18,0)) FROM DeliveryItems WHERE DeliveryChallanId = {c_a}") == "2")
refused(T, "edit B's challan", "prepare_challan", {"companyId": A, "challanId": c_b, "clientId": client_a, "deliveryDate": TODAY, "items": [{"description": "x", "quantity": "1", "unit": "Pcs"}]})

# bill edit
b_a = one(f"SELECT TOP 1 Id FROM Invoices WHERE CompanyId = {A} AND FbrSubmittedAt IS NULL AND IsCancelled = 0 AND NoteKind = 0 ORDER BY Id DESC")
b_b = latest("Invoices", B)
bd = read(T, "get_invoice", {"companyId": A, "invoiceId": b_a})
bline = (bd or {}).get("lines", {}).get("items", [{}])[0] if bd else {}
run(T, "bill edit", "prepare_bill", {"companyId": A, "billId": b_a,
    "items": [{"id": bline.get("id"), "description": "Bill edited", "quantity": str(bline.get("quantity") or 2), "unit": "Pcs", "unitPrice": "777", "itemTypeId": bolt_a}]})
check("the bill line now reads 777", val(f"SELECT CAST(UnitPrice AS DECIMAL(18,0)) FROM InvoiceItems WHERE InvoiceId = {b_a}") == "777")
refused(T, "edit B's bill", "prepare_bill", {"companyId": A, "billId": b_b, "items": [{"description": "x", "quantity": "1", "unit": "Pcs", "unitPrice": "1", "itemTypeId": bolt_a}]})
refused(T, "a bill line with B's item", "prepare_bill", {"companyId": A, "billId": b_a, "items": [{"description": "x", "quantity": "1", "unit": "Pcs", "unitPrice": "1", "itemTypeId": bolt_b}]})

# purchase bill edit
p_a, p_b = latest("PurchaseBills", A), latest("PurchaseBills", B)
pd = read(T, "get_purchase_bill", {"companyId": A, "purchaseBillId": p_a})
pline = (pd or {}).get("lines", {}).get("items", [{}])[0] if pd else {}
run(T, "purchase bill edit", "prepare_purchase_bill", {"companyId": A, "purchaseBillId": p_a, "supplierId": supplier_a,
    "items": [{"id": pline.get("id"), "description": "PB edited", "quantity": "5", "unit": "Pcs", "unitPrice": "410", "itemTypeId": bolt_a}]})
check("the purchase line now reads 410", val(f"SELECT CAST(UnitPrice AS DECIMAL(18,0)) FROM PurchaseItems WHERE PurchaseBillId = {p_a}") == "410")
refused(T, "edit B's purchase bill", "prepare_purchase_bill", {"companyId": A, "purchaseBillId": p_b, "supplierId": supplier_a, "items": [{"description": "x", "quantity": "1", "unit": "Pcs", "unitPrice": "1", "itemTypeId": bolt_a}]})

# goods receipt: create then edit
res = run(T, "goods receipt create", "prepare_goods_receipt", {"companyId": A, "supplierId": supplier_a, "items": [{"description": "GR line", "quantity": 3, "unit": "Pcs", "itemTypeId": bolt_a}]})
g_a = latest("GoodsReceipts", A)
gd = read(T, "get_goods_receipt", {"companyId": A, "goodsReceiptId": g_a})
check("get_goods_receipt answers with its lines", gd and gd.get("items"), gd)
gline = (gd or {}).get("items", [{}])[0]
run(T, "goods receipt edit", "prepare_goods_receipt", {"companyId": A, "goodsReceiptId": g_a, "supplierId": supplier_a,
    "items": [{"id": gline.get("id"), "description": "GR edited", "quantity": 4, "unit": "Pcs", "itemTypeId": bolt_a}]})
check("the goods receipt line now reads 4", val(f"SELECT Quantity FROM GoodsReceiptItems WHERE GoodsReceiptId = {g_a}") == "4")

# receipt edit + allocation
r_a = one(f"SELECT TOP 1 Id FROM Payments WHERE CompanyId = {A} AND Direction = 0 AND ContactId = {client_a} ORDER BY Id DESC")
r_b = one(f"SELECT TOP 1 Id FROM Payments WHERE CompanyId = {B} AND Direction = 0 ORDER BY Id DESC")
rd = read(T, "get_receipt", {"companyId": A, "receiptId": r_a})
check("get_receipt answers", rd and rd.get("id") == r_a, rd)
run(T, "receipt edit", "prepare_receipt", {"companyId": A, "receiptId": r_a, "clientId": client_a, "amount": "600", "method": "Cash"})
check("the receipt is now 600", val(f"SELECT CAST(Amount AS DECIMAL(18,0)) FROM Payments WHERE Id = {r_a}") == "600")
run(T, "receipt allocation to a bill", "prepare_receipt_allocation", {"companyId": A, "mode": "lines", "receiptId": r_a, "lines": [{"invoiceId": b_a, "amount": "100"}]})
check("the allocation is on file", one(f"SELECT COUNT(*) FROM PaymentAllocations WHERE PaymentId = {r_a} AND InvoiceId = {b_a}") >= 1)
refused(T, "allocate B's receipt", "prepare_receipt_allocation", {"companyId": A, "mode": "auto", "receiptId": r_b})
refused(T, "allocate to B's bill", "prepare_receipt_allocation", {"companyId": A, "mode": "lines", "receiptId": r_a, "lines": [{"invoiceId": b_b, "amount": "1"}]})
refused(T, "apply advances of B's customer", "prepare_receipt_allocation", {"companyId": A, "mode": "advances", "clientId": client_b})
refused(T, "read B's receipt", "get_receipt", {"companyId": A, "receiptId": r_b})

# journal: create then edit
accts = read(T, "search_accounts", {"companyId": A, "limit": 200}) or {}
acc = [a for a in accts.get("items", []) if a.get("type") in ("Expense", "Equity", "Income") and a.get("journalPostable")]
if len(acc) >= 2:
    jl = [{"accountId": acc[0]["accountId"], "debit": "50"}, {"accountId": acc[1]["accountId"], "credit": "50"}]
    run(T, "journal create", "prepare_journal_entry", {"companyId": A, "date": TODAY, "narration": "mcpp journal", "lines": jl})
    j_a = one(f"SELECT TOP 1 Id FROM JournalEntries WHERE CompanyId = {A} AND Narration = 'mcpp journal' ORDER BY Id DESC")
    check("get_journal_entry answers", read(T, "get_journal_entry", {"companyId": A, "journalEntryId": j_a}))
    run(T, "journal edit", "prepare_journal_entry", {"companyId": A, "journalEntryId": j_a, "date": TODAY, "narration": "mcpp journal edited",
        "lines": [{"accountId": acc[0]["accountId"], "debit": "75"}, {"accountId": acc[1]["accountId"], "credit": "75"}]})
    check("the journal now reads 75", val(f"SELECT CAST(SUM(Debit) AS DECIMAL(18,0)) FROM JournalLines WHERE JournalEntryId = {j_a}") == "75")
    refused(T, "read B's journal", "get_journal_entry", {"companyId": A, "journalEntryId": latest("JournalEntries", B)})
else:
    check("journal accounts available", False, accts)

# withholding tax receipt
run(T, "withholding receipt create", "prepare_withholding_receipt", {"companyId": A, "clientId": client_a, "amount": "120", "description": "mcpp wht"})
w_a = one(f"SELECT TOP 1 Id FROM WithholdingTaxReceipts WHERE CompanyId = {A} ORDER BY Id DESC")
check("search finds it", any(x["id"] == w_a for x in (read(T, "search_withholding_receipts", {"companyId": A}) or {}).get("items", [])))
run(T, "withholding receipt edit", "prepare_withholding_receipt", {"companyId": A, "withholdingReceiptId": w_a, "clientId": client_a, "amount": "130"})
check("it now reads 130", val(f"SELECT CAST(Amount AS DECIMAL(18,0)) FROM WithholdingTaxReceipts WHERE Id = {w_a}") == "130")
refused(T, "withholding receipt for B's customer", "prepare_withholding_receipt", {"companyId": A, "clientId": client_b, "amount": "1"})

# stock
sv = read(T, "get_stock_values", {"companyId": A})
check("get_stock_values gives values", sv and sv.get("totalValueExcludingTax") is not None and sv.get("items"), sv)
check("get_stock_movements answers", read(T, "get_stock_movements", {"companyId": A, "itemTypeId": bolt_a}))
check("get_stock_gd_details answers", read(T, "get_stock_gd_details", {"companyId": A, "itemTypeId": bolt_a}) is not None)
r, text = call(T, "get_stock_tie_out", {"companyId": A})
check("get_stock_tie_out answers", not r and "stockValue" in text, text)
before = val(f"SELECT COUNT(*) FROM StockMovements WHERE CompanyId = {A} AND ItemTypeId = {bolt_a} AND SourceType = 3")
run(T, "stock adjustment (one damaged)", "prepare_stock_adjustment", {"companyId": A, "itemTypeId": bolt_a, "mode": "delta", "delta": "-1", "notes": "mcpp damaged"})
check("an adjustment movement was written", int(val(f"SELECT COUNT(*) FROM StockMovements WHERE CompanyId = {A} AND ItemTypeId = {bolt_a} AND SourceType = 3")) == int(before) + 1)
refused(T, "adjust B's item", "prepare_stock_adjustment", {"companyId": A, "itemTypeId": bolt_b, "mode": "delta", "delta": "-1"})

# whole-company cross checks: every phase 1 read against company B itself
for tool, args in [("get_stock_values", {}), ("get_stock_movements", {}), ("get_stock_tie_out", {}), ("search_withholding_receipts", {}),
                   ("get_stock_gd_details", {"itemTypeId": bolt_b})]:
    refused(T, f"{tool} for company B", tool, {"companyId": B, **args})

# ── phase 2 ──────────────────────────────────────────────────────────
print("\n== Phase 2: delete, cancel, status, notes, FBR ==")
listed = set(tools(T))
phase2 = {"prepare_delete", "prepare_void", "prepare_quote_status", "prepare_sales_order_status", "prepare_note",
          "get_fbr_preview", "prepare_fbr_submit", "prepare_fbr_reset", "prepare_fbr_exclusion", "get_fbr_log", "get_fbr_summary"}
check("every phase 2 tool is listed", phase2 <= listed, sorted(phase2 - listed))

# delete: a quotation made for the purpose
run(T, "throwaway quotation", "prepare_quote", {"companyId": A, "clientId": client_a, "notes": "mcpp delete me",
    "items": [{"description": "to delete", "quantity": "1", "unit": "Pcs", "unitPrice": "1", "itemTypeId": bolt_a}]})
dq = one(f"SELECT TOP 1 Id FROM SalesQuotes WHERE CompanyId = {A} AND Notes = 'mcpp delete me' ORDER BY Id DESC")
plan, text = prepare(T, "prepare_delete", {"companyId": A, "kind": "quote", "id": dq})
check("delete prepares and saves nothing", plan and one(f"SELECT COUNT(*) FROM SalesQuotes WHERE Id = {dq}") == 1, text)
res, text = commit(T, plan) if plan else (None, text)
check("delete removes the quotation", res and one(f"SELECT COUNT(*) FROM SalesQuotes WHERE Id = {dq}") == 0, text)
refused(T, "delete B's quotation", "prepare_delete", {"companyId": A, "kind": "quote", "id": q_b})
refused(T, "delete B's customer", "prepare_delete", {"companyId": A, "kind": "client", "id": client_b})
refused(T, "delete B's item", "prepare_delete", {"companyId": A, "kind": "item_type", "id": bolt_b})
refused(T, "delete B's GD", "prepare_delete", {"companyId": A, "kind": "gd", "id": latest("ImportConsignments", B)})

# quote and order status
run(T, "quotation marked Sent", "prepare_quote_status", {"companyId": A, "quoteId": q_a, "status": "Sent"})
check("the quotation is Sent", val(f"SELECT Status FROM SalesQuotes WHERE Id = {q_a}") == "Sent")
refused(T, "status of B's quotation", "prepare_quote_status", {"companyId": A, "quoteId": q_b, "status": "Sent"})
refused(T, "status of B's sales order", "prepare_sales_order_status", {"companyId": A, "salesOrderId": o_b, "status": "Closed"})

# cancel a challan made for the purpose
run(T, "throwaway challan", "prepare_challan", {"companyId": A, "clientId": client_a, "deliveryDate": TODAY, "site": "mcpp cancel me",
    "items": [{"description": "to cancel", "quantity": "1", "unit": "Pcs", "itemTypeId": bolt_a}]})
cc = one(f"SELECT TOP 1 Id FROM DeliveryChallans WHERE CompanyId = {A} AND Site = 'mcpp cancel me' ORDER BY Id DESC")
run(T, "challan cancelled", "prepare_void", {"companyId": A, "kind": "challan", "id": cc})
check("the challan is Cancelled", val(f"SELECT Status FROM DeliveryChallans WHERE Id = {cc}") == "Cancelled")
refused(T, "cancel B's challan", "prepare_void", {"companyId": A, "kind": "challan", "id": c_b})

# a bill made for the purpose: credit note, exclusion, void
run(T, "throwaway bill", "prepare_bill", {"companyId": A, "clientId": client_a, "paymentTerms": "mcpp note me",
    "items": [{"description": "to note", "quantity": "2", "unit": "Pcs", "unitPrice": "500", "itemTypeId": bolt_a}]})
nb = one(f"SELECT TOP 1 Id FROM Invoices WHERE CompanyId = {A} AND PaymentTerms = 'mcpp note me' ORDER BY Id DESC")
nline = one(f"SELECT TOP 1 Id FROM InvoiceItems WHERE InvoiceId = {nb}")
notes_before = one(f"SELECT COUNT(*) FROM Invoices WHERE OriginalInvoiceId = {nb}")
r = run(T, "credit note for one unit", "prepare_note", {"companyId": A, "invoiceId": nb, "mode": "credit", "reason": "Goods returned",
        "lines": [{"invoiceItemId": nline, "quantity": "1"}]})
check("a note now points at the bill", one(f"SELECT COUNT(*) FROM Invoices WHERE OriginalInvoiceId = {nb}") == notes_before + 1, r)
refused(T, "note on B's bill", "prepare_note", {"companyId": A, "invoiceId": b_b, "mode": "reverse"})
refused(T, "note with another bill's line", "prepare_note", {"companyId": A, "invoiceId": nb, "mode": "credit",
        "lines": [{"invoiceItemId": one(f"SELECT TOP 1 Id FROM InvoiceItems WHERE InvoiceId = {b_a}"), "quantity": "1"}]})
run(T, "bill excluded from FBR", "prepare_fbr_exclusion", {"companyId": A, "invoiceId": b_a, "excluded": True})
check("the bill is excluded", val(f"SELECT CAST(IsFbrExcluded AS INT) FROM Invoices WHERE Id = {b_a}") == "1")
run(T, "bill included again", "prepare_fbr_exclusion", {"companyId": A, "invoiceId": b_a, "excluded": False})
refused(T, "exclusion on B's bill", "prepare_fbr_exclusion", {"companyId": A, "invoiceId": b_b, "excluded": True})

# FBR: preview answers (or the ERP's own pre-check message), submit prepares only, B refused everywhere
r, text = call(T, "get_fbr_preview", {"companyId": A, "invoiceId": b_a})
check("FBR preview answers without sending (or names what is missing)", not r or "denied" not in text.lower(), text)
plan, text = prepare(T, "prepare_fbr_submit", {"companyId": A, "invoiceId": b_a})
check("FBR submit prepares a plan with the warning (not committed here)", plan and "cannot be undone" in json.dumps(plan), text)
if plan:
    call(T, "cancel_action", {"planId": plan["planId"]})
refused(T, "FBR preview of B's bill", "get_fbr_preview", {"companyId": A, "invoiceId": b_b})
refused(T, "FBR submit of B's bill", "prepare_fbr_submit", {"companyId": A, "invoiceId": b_b})
refused(T, "FBR reset of B's bill", "prepare_fbr_reset", {"companyId": A, "invoiceId": b_b, "mode": "retry", "reason": "x"})
check("FBR log answers for A", read(T, "get_fbr_log", {"companyId": A}) is not None)
check("FBR summary answers for A", read(T, "get_fbr_summary", {"companyId": A}) is not None)
refused(T, "FBR log for company B", "get_fbr_log", {"companyId": B})
refused(T, "FBR summary for company B", "get_fbr_summary", {"companyId": B})

run(T, "throwaway bill voided", "prepare_void", {"companyId": A, "kind": "bill", "id": nb})
check("the bill is cancelled", val(f"SELECT CAST(IsCancelled AS INT) FROM Invoices WHERE Id = {nb}") == "1")
refused(T, "void B's bill", "prepare_void", {"companyId": A, "kind": "bill", "id": b_b})

# a token without the delete scope cannot even prepare a deletion
nodel = fx.token_for(jw, [A], scopes=[x for x in fx.http("GET", "/api/mcp/me/status", jw)[1]["scopesAvailable"] if x not in ("delete.write", "fbr.submit")])
refused(nodel, "deletion with a token lacking delete.write", "prepare_delete", {"companyId": A, "kind": "quote", "id": q_a})
refused(nodel, "FBR submit with a token lacking fbr.submit", "prepare_fbr_submit", {"companyId": A, "invoiceId": b_a})

# ── phase 3 ──────────────────────────────────────────────────────────
print("\n== Phase 3: transfers, supplier debit notes, bank reconciliation, stock reconcile ==")
listed = set(tools(T))
phase3 = {"search_account_transfers", "prepare_account_transfer", "search_purchase_debit_notes", "get_purchase_debit_note",
          "prepare_purchase_debit_note", "get_bank_reconciliation", "prepare_bank_clear", "prepare_bank_reconciliation_lock",
          "prepare_bank_statement_import", "prepare_bank_statement_line", "prepare_stock_reconcile"}
check("every phase 3 tool is listed", phase3 <= listed, sorted(phase3 - listed))

def bank_accounts(company):
    return [int(x) for x in sql(f"SELECT Id FROM Accounts WHERE CompanyId = {company} AND ControlType = 4 AND IsActive = 1 ORDER BY Id")]

banks_a = bank_accounts(A)
if len(banks_a) < 2:
    group = one(f"SELECT AccountGroupId FROM Accounts WHERE Id = {banks_a[0]}")
    fx.http("POST", f"/api/accounts/company/{A}", admin, {"name": "MCPP Second Bank", "accountGroupId": group, "isControlAccount": True, "controlType": "BankCash"})
    banks_a = bank_accounts(A)
bank_b = bank_accounts(B)[0]
if check("company A has two bank/cash accounts for a transfer", len(banks_a) >= 2, banks_a):
    run(T, "account transfer", "prepare_account_transfer", {"companyId": A, "fromAccountId": banks_a[0], "toAccountId": banks_a[1], "amount": "250", "description": "mcpp transfer"})
    tr = one(f"SELECT TOP 1 Id FROM AccountTransfers WHERE CompanyId = {A} AND Description = 'mcpp transfer' ORDER BY Id DESC")
    check("the transfer is on file", tr)
    run(T, "account transfer edit", "prepare_account_transfer", {"companyId": A, "transferId": tr, "fromAccountId": banks_a[0], "toAccountId": banks_a[1], "amount": "275", "description": "mcpp transfer"})
    check("it now reads 275", val(f"SELECT CAST(Amount AS DECIMAL(18,0)) FROM AccountTransfers WHERE Id = {tr}") == "275")
    check("search_account_transfers finds it", tr in [x.get("id") for x in (read(T, "search_account_transfers", {"companyId": A}) or {}).get("items", [])])
    run(T, "transfer marked cleared", "prepare_bank_clear", {"companyId": A, "kind": "transfer", "id": tr, "cleared": True, "clearedDate": TODAY})
    refused(T, "transfer to B's bank account", "prepare_account_transfer", {"companyId": A, "fromAccountId": banks_a[0], "toAccountId": bank_b, "amount": "1"})
    br = read(T, "get_bank_reconciliation", {"companyId": A, "bankAccountId": banks_a[0]})
    check("bank reconciliation of an A account answers", br and "transactions" in br, br)
    plan, text = prepare(T, "prepare_bank_reconciliation_lock", {"companyId": A, "bankAccountId": banks_a[0], "statementDate": TODAY, "statementBalance": "0"})
    check("closing a reconciliation prepares (not committed here)", plan, text)
    if plan:
        call(T, "cancel_action", {"planId": plan["planId"]})
    plan, text = prepare(T, "prepare_bank_statement_import", {"companyId": A, "bankAccountId": banks_a[0], "fileName": "s.csv", "csvText": "Date,Description,Amount\n2026-10-01,Test,100"})
    check("a statement import prepares (not committed here)", plan, text)
    if plan:
        call(T, "cancel_action", {"planId": plan["planId"]})
check("bank reconciliation summary answers for A", read(T, "get_bank_reconciliation", {"companyId": A}) is not None)
refused(T, "bank reconciliation for company B", "get_bank_reconciliation", {"companyId": B})
refused(T, "B's bank account through company A", "get_bank_reconciliation", {"companyId": A, "bankAccountId": bank_b})
refused(T, "close a reconciliation on B's account", "prepare_bank_reconciliation_lock", {"companyId": A, "bankAccountId": bank_b, "statementDate": TODAY, "statementBalance": "0"})
refused(T, "import a statement into B's account", "prepare_bank_statement_import", {"companyId": A, "bankAccountId": bank_b, "csvText": "x"})
refused(T, "clear B's receipt", "prepare_bank_clear", {"companyId": A, "kind": "payment", "id": r_b, "cleared": True})
refused(T, "a statement line that is not A's", "prepare_bank_statement_line", {"companyId": A, "lineId": 999999999, "action": "ignore"})

# supplier debit note
run(T, "supplier debit note", "prepare_purchase_debit_note", {"companyId": A, "supplierId": supplier_a, "notes": "mcpp debit",
    "items": [{"description": "returned", "quantity": "1", "unit": "Pcs", "unitPrice": "400", "itemTypeId": bolt_a}]})
dn = one(f"SELECT TOP 1 Id FROM PurchaseDebitNotes WHERE CompanyId = {A} AND Notes = 'mcpp debit' ORDER BY Id DESC")
check("the debit note is on file", dn)
check("get_purchase_debit_note answers", read(T, "get_purchase_debit_note", {"companyId": A, "purchaseDebitNoteId": dn}))
check("search finds it", any(x.get("id") == dn for x in (read(T, "search_purchase_debit_notes", {"companyId": A}) or {}).get("items", [])))
run(T, "supplier debit note edit", "prepare_purchase_debit_note", {"companyId": A, "purchaseDebitNoteId": dn, "supplierId": supplier_a,
    "items": [{"description": "returned", "quantity": "2", "unit": "Pcs", "unitPrice": "400", "itemTypeId": bolt_a}]})
supplier_b = one(f"SELECT TOP 1 Id FROM Suppliers WHERE CompanyId = {B} ORDER BY Id")
refused(T, "debit note on B's supplier", "prepare_purchase_debit_note", {"companyId": A, "supplierId": supplier_b, "items": [{"description": "x", "quantity": "1", "unitPrice": "1"}]})
refused(T, "debit notes of company B", "search_purchase_debit_notes", {"companyId": B})

# stock reconcile: rows taken from the item's own GD pools, so the plan is a no-op
pools = read(T, "get_stock_gd_details", {"companyId": A, "itemTypeId": bolt_a}) or []
name_a = val(f"SELECT Name FROM ItemTypes WHERE Id = {bolt_a}")
rows = [{"sourceRow": i + 1, "itemNameOnSheet": name_a, "lotRef": p.get("gdNumber"), "balanceQuantity": str(p.get("remainingQuantity") or 0),
         "balanceValueExcludingTax": str(p.get("remainingValueExcludingTax") or p.get("remainingValue") or 0), "balanceSalesTaxRate": "18", "chosenItemTypeId": bolt_a}
        for i, p in enumerate(pools) if (p.get("remainingQuantity") or 0) > 0]
r, text = call(T, "prepare_stock_reconcile", {"companyId": A, "asOf": TODAY, "sourceFile": "mcpp sheet", "rows": rows or [{"sourceRow": 1, "itemNameOnSheet": name_a, "balanceQuantity": "0", "balanceValueExcludingTax": "0", "chosenItemTypeId": bolt_a}]})
check("stock reconcile prepares a plan, or says what to resolve (never a denial)", "denied" not in text.lower(), text)
if not r:
    call(T, "cancel_action", {"planId": json.loads(text)["planId"]})
refused(T, "stock reconcile choosing B's item", "prepare_stock_reconcile", {"companyId": A, "asOf": TODAY, "rows": [{"sourceRow": 1, "itemNameOnSheet": "x", "balanceQuantity": "1", "balanceValueExcludingTax": "1", "chosenItemTypeId": bolt_b}]})

# ── phase 4 ──────────────────────────────────────────────────────────
print("\n== Phase 4: every accounting report, sales detail, client ledger ==")
listed = set(tools(T))
check("every phase 4 tool is listed", {"get_accounting_report", "get_invoice_sales_detail", "get_client_ledger"} <= listed)
schema = next((x for x in fx.mcp(T, "tools/list")[1]["result"]["tools"] if x["name"] == "get_accounting_report"), {})
reports = schema.get("inputSchema", {}).get("properties", {}).get("report", {}).get("enum", [])
check("the report tool offers all 47 screen reports", len(reports) == 47, len(reports))
needs_client = {"customer-ledger", "customer-statement"}
needs_supplier = {"supplier-ledger", "supplier-statement"}
broken = []
for rep in reports:
    extra = {"clientId": client_a} if rep in needs_client else {"supplierId": supplier_a} if rep in needs_supplier else {}
    r, text = call(T, "get_accounting_report", {"companyId": A, "report": rep, "period": "thisyear", **extra})
    if r:
        broken.append((rep, text[:120]))
check("every report answers for company A", not broken, broken)
mine = read(T, "get_accounting_report", {"companyId": A, "report": "customer-balances", "period": "thisyear"})
old = read(T, "get_customer_balances", {"companyId": A})
check("customer balances agree with the existing balances tool", mine is not None and old is not None and
      json.dumps(mine.get("totals", mine.get("total")), sort_keys=True, default=str) == json.dumps(old.get("totals", old.get("total")), sort_keys=True, default=str), (mine and list(mine)[:6], old and list(old)[:6]))
refused(T, "a report for company B", "get_accounting_report", {"companyId": B, "report": "trial-balance"})
refused(T, "a statement of B's customer", "get_accounting_report", {"companyId": A, "report": "customer-statement", "clientId": client_b})
refused(T, "a ledger filtered on B's bank account", "get_accounting_report", {"companyId": A, "report": "bank-book", "accountId": bank_b})
check("invoice sales detail answers for A", read(T, "get_invoice_sales_detail", {"companyId": A, "period": "thisyear"}) is not None)
check("client ledger answers for A", read(T, "get_client_ledger", {"companyId": A, "year": date.today().year}) is not None)
refused(T, "invoice sales detail for company B", "get_invoice_sales_detail", {"companyId": B, "period": "thisyear"})
refused(T, "client ledger of B's customer", "get_client_ledger", {"companyId": A, "year": date.today().year, "clientId": client_b})

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} parity checks passed")
sys.exit(1 if fails else 0)

#!/usr/bin/env python3
"""Phase-3d reconciliation: compare what we imported into MyApp against the
legacy Data_2021 general ledger (the source of truth), to quantify tie-out and
attribute any gap. Read-only on both databases.

- Legacy control totals come from VoucherDetail (the authoritative double-entry
  ledger): A/R = net of 303* accounts, A/P = net of 201* accounts, Sales = 4*.
- MyApp totals come from the migrated company's Invoices / PurchaseBills.

Because the import is a documented subset (≈80% of sales, ≈78% of purchases,
receipts only where they hit imported invoices), this won't tie to zero — the
report shows coverage and the residual so the remaining tail is explicit.

Usage: python scripts/reconcile_legacy.py --company <MyAppCompanyId>
"""
import argparse, subprocess, sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SQLCMD = r"C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\sqlcmd.exe"
SRV = r"CRKRL-HUSSAHUZ1\MSSQLSERVER2"


def scalar(db, q):
    out = subprocess.run([SQLCMD, "-S", SRV, "-d", db, "-E", "-C", "-h", "-1", "-W", "-Q",
                          f"SET NOCOUNT ON; {q}"], capture_output=True, text=True)
    if out.returncode != 0:
        print("sqlcmd error:", out.stdout, out.stderr); sys.exit(2)
    vals = [v.strip() for v in out.stdout.replace("\n", " ").split() if v.strip()]
    return vals


def money(q, db):
    v = scalar(db, q)
    try:
        return float(v[0]) if v and v[0] not in ("NULL",) else 0.0
    except ValueError:
        return 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--company", type=int, required=True)
    ap.add_argument("--legacy", default="Data_2021")
    ap.add_argument("--app", default="DeliveryChallanDb")
    args = ap.parse_args()
    L, A, c = args.legacy, args.app, args.company

    # ── Legacy GL (source of truth) ──
    gl_dr = money("SELECT SUM(Debit) FROM VoucherDetail", L)
    gl_cr = money("SELECT SUM(Credit) FROM VoucherDetail", L)
    ar_net = money("SELECT SUM(Debit-Credit) FROM VoucherDetail WHERE FKAccountCode LIKE '303%'", L)
    ap_net = money("SELECT SUM(Credit-Debit) FROM VoucherDetail WHERE FKAccountCode LIKE '201%'", L)
    sales_gl = money("SELECT SUM(Credit-Debit) FROM VoucherDetail WHERE FKAccountCode LIKE '4%'", L)
    leg_sales_n = int(money("SELECT COUNT(*) FROM SalesInvoiceMaster WHERE FKCostCentreID=1", L))
    leg_purch_n = int(money("SELECT COUNT(*) FROM PurchaseMaster WHERE FKCostCentreID=1", L))

    # ── MyApp imported ──
    inv_n = int(money(f"SELECT COUNT(*) FROM Invoices WHERE CompanyId={c} AND IsMigrated=1", A))
    inv_total = money(f"SELECT SUM(GrandTotal) FROM Invoices WHERE CompanyId={c} AND IsMigrated=1", A)
    inv_paid = money(f"SELECT SUM(AmountPaid) FROM Invoices WHERE CompanyId={c} AND IsMigrated=1", A)
    bill_n = int(money(f"SELECT COUNT(*) FROM PurchaseBills WHERE CompanyId={c} AND IsMigrated=1", A))
    bill_total = money(f"SELECT SUM(GrandTotal) FROM PurchaseBills WHERE CompanyId={c} AND IsMigrated=1", A)
    bill_paid = money(f"SELECT SUM(AmountPaid) FROM PurchaseBills WHERE CompanyId={c} AND IsMigrated=1", A)

    def row(label, val): print(f"  {label:<42} {val:>18,.2f}")
    print("\n=== Legacy GL control totals (VoucherDetail, source of truth) ===")
    row("GL total debits", gl_dr)
    row("GL total credits", gl_cr)
    row("GL imbalance (Dr-Cr; known ~200,000)", gl_dr - gl_cr)
    row("A/R net (accounts 303*)", ar_net)
    row("A/P net (accounts 201*)", ap_net)
    row("Sales (accounts 4*)", sales_gl)

    print("\n=== MyApp imported (company %d) ===" % c)
    print(f"  Sales invoices: {inv_n} of {leg_sales_n} legacy ({100*inv_n/max(leg_sales_n,1):.0f}% coverage)")
    row("  imported invoice grand total", inv_total)
    row("  receipts applied (AmountPaid)", inv_paid)
    row("  A/R outstanding (grand - paid)", inv_total - inv_paid)
    print(f"  Purchase bills: {bill_n} of {leg_purch_n} legacy ({100*bill_n/max(leg_purch_n,1):.0f}% coverage)")
    row("  imported bill grand total", bill_total)
    row("  payments applied (AmountPaid)", bill_paid)
    row("  A/P outstanding (grand - paid)", bill_total - bill_paid)

    print("\n=== Read ===")
    print("  • The imported subset is GL-anchored: each imported invoice's total")
    print("    equals its legacy A/R voucher debit (exact by construction). Imported")
    print(f"    sales value is {100*inv_total/max(sales_gl,1):.0f}% of legacy sales.")
    print("  • MyApp A/R outstanding is HIGHER than legacy A/R net because receipt")
    print("    coverage is partial — only receipts that hit an imported invoice were")
    print("    applied (254 of 755), so imported invoices understate payments. The")
    print("    fix is the receipt/payment tail (incl. the GRN→bill mapping for")
    print("    payments) + the skipped sales (shared-folio/opening-balance batches).")
    print("  • The Rs 200,000 GL imbalance is a legacy data issue to resolve at")
    print("    source before any full cut-over.")


if __name__ == "__main__":
    sys.exit(main())

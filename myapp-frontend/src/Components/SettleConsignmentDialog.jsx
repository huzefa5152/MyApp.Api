import { useState, useEffect, useMemo } from "react";
import { MdClose } from "react-icons/md";
import { formStyles, modalSizes, colors, dropdownStyles } from "../theme";
import SearchableSelect from "./SearchableSelect";
import BankCashSelect from "./BankCashSelect";
import useScrollToError from "../hooks/useScrollToError";
import { createPayment, updatePayment } from "../api/paymentApi";
import { getSuppliersByCompany } from "../api/supplierApi";
import { getAccountsFlat } from "../api/accountApi";
import { getImportConsignment } from "../api/importConsignmentApi";

const METHODS = ["Cash", "Bank Transfer", "Cheque", "Online", "Other"];
const money = (n) => (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Settle one GD consignment's Import Clearing liability (Task 23), and EDIT
 * that settlement afterwards (2026-09-13) — a focused action on the
 * Consignments screen, and the editor PaymentsPage hands a GD payment to.
 *
 * Why a separate dialog rather than teaching PaymentForm a fourth purpose:
 * PaymentForm's "settle" screen is built entirely around a Client/Supplier
 * CONTACT that owns open documents — canSettle gates on payeeType matching
 * the direction, its docs-effect fetches by contactId, and on edit it keys
 * an existing allocation back to a row by invoiceId/purchaseBillId. A GD
 * consignment owns no contact at all (the costing sheet names no supplier),
 * so it cannot be found by any of that, and bolting it in would mean a new
 * payee type that bypasses the contact requirement, a second docs source,
 * and a second key (importConsignmentId) threaded through ownRaw/alloc — on
 * a form the rest of the app already depends on for ordinary bill payments.
 *
 * This dialog creates and updates the SAME Payment through the SAME
 * createPayment()/updatePayment() calls PaymentForm uses — one allocation,
 * kind "ImportConsignment" — so everything downstream (PostingService, the
 * Payments list, the print voucher) is exactly the shared path; only the
 * picking UI is separate.
 *
 * Two modes, one form:
 *   • create — opened from the Consignments screen with `consignment`.
 *   • edit   — opened from Payments with `payment`; the consignment is read
 *              back from the payment's own allocation, and the cap has to
 *              ADD this payment's current contribution back before measuring,
 *              exactly as the server's excludePaymentId guard does. Without
 *              that, re-saving an unchanged settlement would read as an
 *              over-settle of its own amount.
 */
export default function SettleConsignmentDialog({ companyId, consignment, payment, onClose, onSaved }) {
  const isEdit = !!payment;
  const ownLine = isEdit
    ? (payment.allocations || []).find((a) => a.importConsignmentId) || {}
    : null;
  const consignmentId = isEdit ? ownLine.importConsignmentId : consignment?.id;
  const gdNumber = isEdit
    ? (ownLine.importConsignmentGdNumber || "")
    : (consignment?.gdNumber || "");

  const today = new Date().toISOString().slice(0, 10);

  // On edit the ceiling comes from the consignment, fetched below; on create
  // the caller already has it. Null means "not known" — the cap is then left
  // to the server rather than guessed at, which is the honest answer for an
  // operator who can settle a GD but cannot read the Consignments screen.
  const [outstanding, setOutstanding] = useState(isEdit ? null : (consignment?.outstanding ?? 0));

  const [date, setDate] = useState(isEdit ? (payment.date || today).slice(0, 10) : today);
  const [amount, setAmount] = useState(() => {
    if (isEdit) return String(ownLine.amount ?? 0);
    const o = consignment?.outstanding ?? 0;
    return o > 0 ? String(o) : "";
  });
  const [adjAmount, setAdjAmount] = useState(isEdit ? String(ownLine.adjustmentAmount || "") : "");
  const [adjAccountId, setAdjAccountId] = useState(isEdit ? (ownLine.adjustmentAccountId ?? "") : "");
  const [showAdj, setShowAdj] = useState(isEdit ? (ownLine.adjustmentAmount || 0) > 0 : false);

  const [payeeType, setPayeeType] = useState(
    isEdit ? (payment.contactType === "Supplier" ? "Supplier" : "Other") : "Other");
  const [payeeName, setPayeeName] = useState(isEdit ? (payment.contactName || "") : "");
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState(
    isEdit && payment.contactType === "Supplier" ? String(payment.contactId ?? "") : "");
  const [bankAccountId, setBankAccountId] = useState(isEdit ? (payment.bankAccountId ?? "") : "");
  const [bankAccountName, setBankAccountName] = useState(isEdit ? (payment.bankAccountName || "") : "");
  const [method, setMethod] = useState(isEdit ? (payment.method || "Bank Transfer") : "Bank Transfer");
  const [description, setDescription] = useState(
    isEdit ? (payment.description || "") : `Settlement of GD ${gdNumber}`);
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState("");
  const errRef = useScrollToError(error);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (payeeType !== "Supplier") return;
    let cancelled = false;
    getSuppliersByCompany(companyId)
      .then(({ data }) => { if (!cancelled) setSuppliers(data || []); })
      .catch(() => { if (!cancelled) setSuppliers([]); });
    return () => { cancelled = true; };
  }, [companyId, payeeType]);

  // The chart, for the write-off destination. Best-effort: with the ledger off
  // there are no accounts, the server accepts a null AdjustmentAccountId, and
  // the gap simply clears the liability with nowhere to post.
  useEffect(() => {
    let cancelled = false;
    getAccountsFlat(companyId)
      .then(({ data }) => { if (!cancelled) setAccounts(data || []); })
      .catch(() => { if (!cancelled) setAccounts([]); });
    return () => { cancelled = true; };
  }, [companyId]);

  // Edit only: what this GD still has room for, with THIS payment's own
  // contribution added back (the server measures the same way).
  useEffect(() => {
    if (!isEdit || !consignmentId) return;
    let cancelled = false;
    getImportConsignment(consignmentId)
      .then(({ data }) => {
        if (cancelled) return;
        const own = round2((ownLine.amount || 0) + (ownLine.adjustmentAmount || 0));
        setOutstanding(round2((data.importClearingCredited || 0) - (data.amountSettled || 0) + own));
      })
      .catch(() => { if (!cancelled) setOutstanding(null); });
    return () => { cancelled = true; };
  }, [isEdit, consignmentId, ownLine?.amount, ownLine?.adjustmentAmount]);

  const glOn = accounts.length > 0;
  const activeAccounts = useMemo(() => accounts.filter((a) => a.isActive), [accounts]);
  const ctrlId = (ct) => {
    const m = accounts.filter((a) => a.controlType === ct);
    return (m.find((a) => a.isActive) || m[0])?.id ?? null;
  };
  // Money OUT, so the gap is income: the estimate was higher than the bill.
  // Same two control types PaymentForm resolves for a supplier payment.
  const discountAccId = useMemo(() => ctrlId("DiscountReceived"), [accounts]);
  const writeoffAccId = useMemo(() => ctrlId("WriteBackIncome"), [accounts]);

  const amountNum = round2(amount);
  const adjNum = showAdj ? round2(adjAmount) : 0;
  const settledNum = round2(amountNum + adjNum);
  const capKnown = outstanding != null;
  const overAmount = capKnown && settledNum > outstanding + 0.005;
  const needsAccount = glOn && adjNum > 0 && !adjAccountId;
  const canSave = !saving && settledNum > 0 && !overAmount && !needsAccount && !!date
    && !!consignmentId && (payeeType !== "Supplier" || !!supplierId);

  const openAdj = (accId) => {
    setShowAdj(true);
    if (accId != null) setAdjAccountId(accId);
    if (capKnown && !adjAmount) {
      const gap = round2(outstanding - amountNum);
      if (gap > 0) setAdjAmount(String(gap));
    }
  };
  const clearAdj = () => { setShowAdj(false); setAdjAmount(""); setAdjAccountId(""); };

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      const body = {
        direction: "Payment",
        date,
        contactType: payeeType,
        contactId: payeeType === "Supplier" ? Number(supplierId) : null,
        contactName: payeeType === "Other" ? (payeeName.trim() || null) : null,
        bankAccountId: bankAccountId || null,
        bankAccountName: bankAccountName || null,
        method,
        description: description.trim() || null,
        allocations: [{
          kind: "ImportConsignment",
          importConsignmentId: consignmentId,
          amount: amountNum,
          adjustmentAmount: adjNum,
          adjustmentAccountId: adjNum > 0 ? (adjAccountId ? Number(adjAccountId) : null) : null,
        }],
      };
      if (isEdit) await updatePayment("payments", payment.id, body);
      else await createPayment("payments", companyId, body);
      onSaved?.();
    } catch (err) {
      setError(err.response?.data?.message
        || `Could not ${isEdit ? "update" : "record"} the settlement. Please try again.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={formStyles.backdrop} onMouseDown={onClose}>
      <div
        style={{ ...formStyles.modal, maxWidth: `${modalSizes.md}px` }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={formStyles.header}>
          <h3 style={formStyles.title}>
            {isEdit ? "Edit settlement" : "Settle"} GD {gdNumber}
          </h3>
          <button style={formStyles.closeButton} onClick={onClose} aria-label="Close">
            <MdClose size={18} />
          </button>
        </div>

        <div style={formStyles.body}>
          {error && <div ref={errRef} style={formStyles.error}>{error}</div>}

          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            background: "#f5f7fa", border: `1px solid ${colors.cardBorder}`,
            borderRadius: 10, padding: "0.7rem 0.9rem", marginBottom: "1.1rem", fontSize: 14,
          }}>
            <span style={{ color: colors.textSecondary }}>
              {isEdit ? "Available on this GD" : "Outstanding"}
            </span>
            <strong style={{ fontVariantNumeric: "tabular-nums" }}>
              {capKnown ? money(outstanding) : "—"}
            </strong>
          </div>

          <div style={formStyles.formGroup}>
            <label style={formStyles.label}>Date</label>
            <input
              type="date" style={formStyles.input} value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div style={formStyles.formGroup}>
            <label style={formStyles.label}>Amount paid</label>
            <input
              type="number" min="0" step="0.01" style={formStyles.input}
              value={amount} onChange={(e) => setAmount(e.target.value)}
            />
            <div style={{ marginTop: "0.4rem", display: "flex", flexWrap: "wrap", gap: 6 }}>
              {capKnown && (
                <button
                  type="button"
                  onClick={() => { setAmount(String(outstanding)); clearAdj(); }}
                  style={pillBtn}
                >
                  Settle in full ({money(outstanding)})
                </button>
              )}
              {!showAdj && capKnown && amountNum > 0 && amountNum < outstanding - 0.005 && (
                <>
                  {glOn && discountAccId != null && (
                    <button type="button" onClick={() => openAdj(discountAccId)} style={pillBtn}>
                      Discount received
                    </button>
                  )}
                  {glOn && writeoffAccId != null && (
                    <button type="button" onClick={() => openAdj(writeoffAccId)} style={pillBtn}>
                      Write back the rest
                    </button>
                  )}
                  <button type="button" onClick={() => openAdj(null)} style={pillBtn}>
                    {glOn ? "Other account" : "Write off the rest"}
                  </button>
                </>
              )}
            </div>
            {overAmount && (
              <div style={{ marginTop: "0.4rem", fontSize: 12.5, color: colors.danger }}>
                Cash plus adjustment ({money(settledNum)}) is more than the {money(outstanding)} available.
              </div>
            )}
          </div>

          {showAdj && (
            <div style={{
              border: `1px solid ${colors.cardBorder}`, borderRadius: 10,
              padding: "0.75rem 0.9rem", marginBottom: "1.1rem", background: "#fbfcfe",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <strong style={{ fontSize: 13 }}>Settle the rest without cash</strong>
                <button type="button" onClick={clearAdj} style={{ ...pillBtn, color: colors.danger }}>
                  Remove
                </button>
              </div>
              <div style={{ fontSize: 12.5, color: colors.textSecondary, marginBottom: "0.6rem" }}>
                A GD's Import Clearing liability is an estimate until the agent's final
                bill arrives. This clears the remainder to an account instead of
                overstating what was actually paid.
              </div>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Adjustment amount</label>
                <input
                  type="number" min="0" step="0.01" style={formStyles.input}
                  value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)}
                />
              </div>
              {glOn && (
                <div style={formStyles.formGroup}>
                  <label style={formStyles.label}>Post it to</label>
                  <select
                    style={{ ...dropdownStyles.base, width: "100%" }}
                    value={adjAccountId}
                    onChange={(e) => setAdjAccountId(e.target.value)}
                  >
                    <option value="">— Choose an account —</option>
                    {activeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                  {needsAccount && (
                    <div style={{ marginTop: "0.35rem", fontSize: 12.5, color: colors.danger }}>
                      Choose the account the adjustment posts to.
                    </div>
                  )}
                </div>
              )}
              <div style={{ fontSize: 12.5, color: colors.textSecondary }}>
                Clears <strong>{money(settledNum)}</strong> of the GD
                — {money(amountNum)} in cash and {money(adjNum)} adjusted.
              </div>
            </div>
          )}

          <div style={formStyles.formGroup}>
            <label style={formStyles.label}>Paid to</label>
            <div style={{ display: "flex", gap: 8, marginBottom: "0.5rem" }}>
              {["Other", "Supplier"].map((t) => (
                <button
                  key={t} type="button" onClick={() => setPayeeType(t)}
                  style={{
                    ...formStyles.button, flex: 1, minHeight: 40,
                    background: payeeType === t ? colors.blue : "#eef2f7",
                    color: payeeType === t ? "#fff" : colors.textPrimary,
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
            {payeeType === "Supplier" ? (
              <SearchableSelect
                items={suppliers} value={supplierId}
                onChange={(id) => setSupplierId(id || "")}
                labelKey="name" searchKeys={["name"]}
                placeholder="— Select supplier —"
              />
            ) : (
              <input
                style={formStyles.input} value={payeeName}
                onChange={(e) => setPayeeName(e.target.value)}
                placeholder="e.g. the clearing agent's name (optional)"
              />
            )}
          </div>

          <BankCashSelect
            companyId={companyId} value={bankAccountId} name={bankAccountName}
            onChange={(id, name) => { setBankAccountId(id || ""); setBankAccountName(name || ""); }}
            label="Paid from" autoSelectSingle
          />

          <div style={formStyles.formGroup}>
            <label style={formStyles.label}>Method</label>
            <select style={formStyles.input} value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div style={formStyles.formGroup}>
            <label style={formStyles.label}>Description</label>
            <input
              style={formStyles.input} value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <div style={formStyles.footer}>
          <button style={{ ...formStyles.button, ...formStyles.cancel, minHeight: 40 }} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            style={{ ...formStyles.button, ...formStyles.submit, minHeight: 40, opacity: canSave ? 1 : 0.55 }}
            onClick={submit} disabled={!canSave}
          >
            {saving ? "Saving…" : isEdit ? "Save changes" : "Record payment"}
          </button>
        </div>
      </div>
    </div>
  );
}

const pillBtn = {
  ...formStyles.button, background: "#eef2f7", color: colors.textPrimary,
  padding: "0.3rem 0.7rem", fontSize: 12, minHeight: 32,
};

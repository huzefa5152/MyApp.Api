import { useState, useEffect } from "react";
import { MdClose } from "react-icons/md";
import { formStyles, modalSizes, colors } from "../theme";
import SearchableSelect from "./SearchableSelect";
import BankCashSelect from "./BankCashSelect";
import useScrollToError from "../hooks/useScrollToError";
import { createPayment } from "../api/paymentApi";
import { getSuppliersByCompany } from "../api/supplierApi";

const METHODS = ["Cash", "Bank Transfer", "Cheque", "Online", "Other"];
const money = (n) => (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Settle one GD consignment's Import Clearing liability (Task 23) — a
 * focused action on the Consignments screen, not a route into PaymentForm.
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
 * This dialog creates the SAME Payment through the SAME createPayment() call
 * PaymentForm uses — one allocation, kind "ImportConsignment" — so every-
 * thing downstream (PostingService, the Payments list, the print voucher)
 * is exactly the shared path; only the picking UI is separate. See
 * PaymentsPage.jsx for why such a payment is then view/delete-only there,
 * never edited through the generic form.
 */
export default function SettleConsignmentDialog({ companyId, consignment, onClose, onSaved }) {
  const outstanding = consignment.outstanding ?? 0;
  const today = new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState(outstanding > 0 ? String(outstanding) : "");
  const [payeeType, setPayeeType] = useState("Other");
  const [payeeName, setPayeeName] = useState("");
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [method, setMethod] = useState("Bank Transfer");
  const [description, setDescription] = useState(`Settlement of GD ${consignment.gdNumber}`);
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

  const amountNum = parseFloat(amount) || 0;
  const overAmount = amountNum > outstanding + 0.005;
  const canSave = !saving && amountNum > 0 && !overAmount && !!date
    && (payeeType !== "Supplier" || !!supplierId);

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      await createPayment("payments", companyId, {
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
          importConsignmentId: consignment.id,
          amount: amountNum,
        }],
      });
      onSaved?.();
    } catch (err) {
      setError(err.response?.data?.message || "Could not record the settlement. Please try again.");
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
          <h3 style={formStyles.title}>Settle GD {consignment.gdNumber}</h3>
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
            <span style={{ color: colors.textSecondary }}>Outstanding</span>
            <strong style={{ fontVariantNumeric: "tabular-nums" }}>{money(outstanding)}</strong>
          </div>

          <div style={formStyles.formGroup}>
            <label style={formStyles.label}>Date</label>
            <input
              type="date" style={formStyles.input} value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div style={formStyles.formGroup}>
            <label style={formStyles.label}>Amount</label>
            <input
              type="number" min="0" step="0.01" style={formStyles.input}
              value={amount} onChange={(e) => setAmount(e.target.value)}
            />
            <div style={{ marginTop: "0.4rem" }}>
              <button
                type="button"
                onClick={() => setAmount(String(outstanding))}
                style={{
                  ...formStyles.button, background: "#eef2f7", color: colors.textPrimary,
                  padding: "0.3rem 0.7rem", fontSize: 12, minHeight: 32,
                }}
              >
                Settle in full ({money(outstanding)})
              </button>
            </div>
            {overAmount && (
              <div style={{ marginTop: "0.4rem", fontSize: 12.5, color: colors.danger }}>
                Cannot settle more than the {money(outstanding)} outstanding.
              </div>
            )}
          </div>

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
            {saving ? "Saving…" : "Record payment"}
          </button>
        </div>
      </div>
    </div>
  );
}

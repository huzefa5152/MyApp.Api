import { MdEmail, MdPhone, MdLocationOn, MdEdit, MdDelete, MdContentCopy, MdShoppingCart } from "react-icons/md";
import { deleteSupplier } from "../api/supplierApi";
import { cardStyles, cardHover } from "../theme";
import { useConfirm } from "./ConfirmDialog";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";

export default function SupplierList({
  suppliers, onEdit, onCopy, fetchSuppliers, billCounts = {}, onShowBills,
  // Per-supplier payables roll-up, keyed by supplier id — { accountsPayable,
  // status, openBills }. Absent while it loads, so the card degrades to what it
  // showed before rather than rendering "Rs 0.00" as if it were settled.
  summary = {},
  onShowLedger,
}) {
  const confirm = useConfirm();
  const { has } = usePermissions();
  const canUpdate = has("suppliers.manage.update");
  const canDelete = has("suppliers.manage.delete");
  const canCopy = has("suppliers.manage.copy");

  const handleDelete = async (s) => {
    // Supplier delete now cascades (parity with clients) — a supplier with
    // purchase bills is deletable; warn that its documents go too.
    const hasBills = s.hasPurchaseBills;
    const ok = await confirm({
      title: "Delete Supplier?",
      message: hasBills
        ? `Deleting "${s.name}" will also permanently delete its purchase bills, goods receipts, payments, and the related stock movements. This cannot be undone.`
        : `Are you sure you want to delete "${s.name}"? This cannot be undone.`,
      variant: "danger",
      confirmText: hasBills ? "Delete supplier + documents" : "Delete",
    });
    if (!ok) return;
    try {
      await deleteSupplier(s.id);
      fetchSuppliers();
      notify("Supplier deleted.", "success");
    } catch (err) {
      notify(err.response?.data?.error || err.response?.data?.message || "Failed to delete supplier.", "error");
    }
  };

  return (
    <div className="card-grid">
      {suppliers.map((supplier) => (
        <div
          key={supplier.id}
          style={cardStyles.card}
          onMouseEnter={(e) => Object.assign(e.currentTarget.style, cardHover)}
          onMouseLeave={(e) =>
            Object.assign(e.currentTarget.style, {
              transform: "none",
              boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
            })
          }
        >
          <div style={cardStyles.cardContent}>
            <div>
              <h5 style={cardStyles.title}>{supplier.name}</h5>

              {/* Accounts payable + status. The figure is clickable and opens the
                  supplier's ledger, the same affordance the customer A/R cell has. */}
              {summary[supplier.id] && (
                <div style={payRow}>
                  <span style={payLabel}>Accounts payable</span>
                  {onShowLedger ? (
                    <button
                      type="button"
                      onClick={() => onShowLedger(supplier)}
                      title="Open this supplier's ledger"
                      style={payAmountBtn}
                    >
                      {fmtPayable(summary[supplier.id].accountsPayable)}
                    </button>
                  ) : (
                    <span style={payAmount}>{fmtPayable(summary[supplier.id].accountsPayable)}</span>
                  )}
                  <span style={{ ...statusPill, ...statusTone(summary[supplier.id].status) }}>
                    {summary[supplier.id].status}
                  </span>
                </div>
              )}

              {onShowBills && (
                <button
                  type="button"
                  onClick={() => onShowBills(supplier)}
                  title="View this supplier's purchase bills"
                  style={countChip}
                >
                  <MdShoppingCart size={13} />
                  {billCounts[supplier.id] || 0} purchase bill{(billCounts[supplier.id] || 0) !== 1 ? "s" : ""}
                </button>
              )}
              {supplier.email && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <MdEmail style={{ color: "#0d47a1", flexShrink: 0 }} /> {supplier.email}
                </p>
              )}
              {supplier.phone && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <MdPhone style={{ color: "#00897b", flexShrink: 0 }} /> {supplier.phone}
                </p>
              )}
              {supplier.address && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <MdLocationOn style={{ color: "#5f6d7e", flexShrink: 0 }} /> {supplier.address}
                </p>
              )}
              {supplier.ntn && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <strong style={{ fontSize: "0.75rem", color: "#5f6d7e" }}>NTN:</strong> {supplier.ntn}
                </p>
              )}
              {supplier.strn && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <strong style={{ fontSize: "0.75rem", color: "#5f6d7e" }}>STRN:</strong> {supplier.strn}
                </p>
              )}
              {supplier.registrationType && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <strong style={{ fontSize: "0.75rem", color: "#5f6d7e" }}>Type:</strong> {supplier.registrationType}
                </p>
              )}
              {/* The clickable purchase-bill count above replaces the old
                  static "has purchase bills" hint; fall back to it only when
                  the count chip isn't shown (operator lacks bill-view perm). */}
              {!onShowBills && supplier.hasPurchaseBills && (
                <p style={{ ...cardStyles.text, fontSize: "0.74rem", color: "#00695c", marginTop: "0.25rem" }}>
                  has purchase bills
                </p>
              )}
            </div>
            {(canUpdate || canDelete || canCopy) && (
              <div style={cardStyles.buttonGroup}>
                {canUpdate && (
                  <button
                    style={{ ...cardStyles.button, ...cardStyles.edit, display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                    onClick={() => onEdit(supplier)}
                  >
                    <MdEdit /> Edit
                  </button>
                )}
                {canCopy && onCopy && (
                  <button
                    style={{ ...cardStyles.button, backgroundColor: "#ede7f6", color: "#4527a0", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                    onClick={() => onCopy(supplier)}
                    title="Copy this supplier into another company"
                  >
                    <MdContentCopy /> Copy
                  </button>
                )}
                {canDelete && (
                  <button
                    style={{
                      ...cardStyles.button, ...cardStyles.delete,
                      display: "inline-flex", alignItems: "center", gap: "0.3rem",
                      opacity: supplier.hasPurchaseBills ? 0.5 : 1,
                      cursor: supplier.hasPurchaseBills ? "not-allowed" : "pointer",
                    }}
                    title={supplier.hasPurchaseBills ? "Has purchase bills — delete those first" : "Delete supplier"}
                    onClick={() => handleDelete(supplier)}
                  >
                    <MdDelete /> Delete
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const countChip = {
  display: "inline-flex", alignItems: "center", gap: 4,
  margin: "0.3rem 0 0.1rem", padding: "0.2rem 0.55rem",
  borderRadius: 14, border: "1px solid #ce93d8", background: "#f3e5f5",
  color: "#6a1b9a", fontSize: "0.74rem", fontWeight: 700, cursor: "pointer",
};

// ── Accounts payable + status ───────────────────────────────────────────────
/** "Rs 1,234.00", or "Rs 500.00 in credit" when we have paid ahead — a bare
 *  negative reads like a bug, and "in credit" is what it actually means. */
const fmtPayable = (n) => {
  const v = Number(n) || 0;
  const amount = `Rs ${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return v < -0.005 ? `${amount} in credit` : amount;
};

const payRow = {
  display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem",
  margin: "0.4rem 0 0.2rem",
};
const payLabel = { color: "#5f6d7e", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em" };
const payAmount = { fontSize: "0.86rem", fontWeight: 700, color: "#1a2332", fontVariantNumeric: "tabular-nums" };
const payAmountBtn = {
  ...payAmount, padding: 0, border: "none", background: "none",
  color: "#0d47a1", textDecoration: "underline", cursor: "pointer",
};
const statusPill = {
  padding: "0.1rem 0.5rem", borderRadius: 12,
  fontSize: "0.7rem", fontWeight: 800, letterSpacing: "0.02em",
};
const statusTone = (status) =>
  status === "Paid" ? { background: "#e8f5e9", color: "#1b5e20", border: "1px solid #a5d6a7" }
  : status === "Partial" ? { background: "#fff8e1", color: "#8a5a00", border: "1px solid #ffe082" }
  : { background: "#fdecea", color: "#b3261e", border: "1px solid #f5c6c2" };

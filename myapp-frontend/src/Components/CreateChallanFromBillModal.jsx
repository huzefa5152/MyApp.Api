import { useEffect, useState } from "react";
import { MdLocalShipping, MdClose } from "react-icons/md";
import { getInvoiceChallanPlan, createChallanFromInvoice } from "../api/invoiceApi";
import { notify } from "../utils/notify";
import { todayYmd } from "../utils/dateInput";
import { modalSizes } from "../theme";

/**
 * Raise a delivery challan against a bill.
 *
 * The bill is already issued; this records what actually goes out. All four
 * shapes the operator asked for work from one screen:
 *
 *   every line on one challan   -- leave the quantities as they load
 *   one line on its own challan -- zero the others
 *   a line in instalments       -- send part now, come back for the rest
 *   a mix                       -- some lines in full, some in part
 *
 * Each row is capped at what is still outstanding, and the server refuses
 * anything above it regardless of what the form sends.
 */
export default function CreateChallanFromBillModal({ invoice, onClose, onCreated }) {
  const [plan, setPlan] = useState(null);
  const [rows, setRows] = useState({});          // invoiceItemId -> quantity string
  const [date, setDate] = useState(todayYmd());
  const [site, setSite] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!invoice?.id) return;
    let cancelled = false;
    getInvoiceChallanPlan(invoice.id)
      .then(({ data }) => {
        if (cancelled) return;
        setPlan(data);
        // Default to delivering everything outstanding -- the common case is
        // one challan for the whole bill.
        setRows(Object.fromEntries(
          (data.lines || []).map((l) => [l.invoiceItemId, String(l.remainingQuantity || 0)])
        ));
      })
      .catch(() => { if (!cancelled) setError("Could not read this bill's lines."); });
    return () => { cancelled = true; };
  }, [invoice?.id]);

  const lines = plan?.lines || [];
  const chosen = lines
    .map((l) => ({ l, qty: parseFloat(rows[l.invoiceItemId]) || 0 }))
    .filter((x) => x.qty > 0);
  const overOne = chosen.find((x) => x.qty > Number(x.l.remainingQuantity) + 1e-9);
  const totalQty = chosen.reduce((s, x) => s + x.qty, 0);

  const submit = async (e) => {
    e.preventDefault();
    if (chosen.length === 0) { setError("Give a quantity on at least one line."); return; }
    if (overOne) {
      setError(`"${overOne.l.description}" has only ${Number(overOne.l.remainingQuantity).toLocaleString()} left to deliver.`);
      return;
    }
    setSaving(true); setError("");
    try {
      const { data } = await createChallanFromInvoice(invoice.id, {
        deliveryDate: date,
        site: site || null,
        lines: chosen.map((x) => ({ invoiceItemId: x.l.invoiceItemId, quantity: x.qty })),
      });
      notify(`Delivery Challan #${data.challanNumber} created.`, "success");
      onCreated?.(data);
      onClose?.();
    } catch (err) {
      setError(err.response?.data?.error || "Could not create the delivery challan.");
    } finally {
      setSaving(false);
    }
  };

  const setAll = (full) =>
    setRows(Object.fromEntries(lines.map((l) => [
      l.invoiceItemId, full ? String(l.remainingQuantity || 0) : "0",
    ])));

  return (
    <div style={styles.backdrop}>
      <form style={styles.modal} onSubmit={submit}>
        <div style={styles.header}>
          <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <MdLocalShipping size={20} /> Delivery Challan for Bill #{invoice?.invoiceNumber}
          </span>
          <button type="button" onClick={onClose} style={styles.x}><MdClose size={20} /></button>
        </div>

        <div style={styles.body}>
          {!plan ? (
            <p style={styles.muted}>Loading the bill's lines…</p>
          ) : (
            <>
              <div style={styles.meta}>
                <span><strong>{plan.clientName}</strong></span>
                {plan.existingChallanNumbers?.length > 0 && (
                  <span style={styles.muted}>
                    already delivered on challan{plan.existingChallanNumbers.length > 1 ? "s" : ""}{" "}
                    {plan.existingChallanNumbers.map((n) => `#${n}`).join(", ")}
                  </span>
                )}
              </div>

              <div style={styles.row}>
                <label style={styles.field}>
                  <span style={styles.label}>Delivery date</span>
                  <input type="date" required value={date} style={styles.input}
                         onChange={(e) => setDate(e.target.value)} />
                </label>
                <label style={styles.field}>
                  <span style={styles.label}>Site (optional)</span>
                  <input type="text" value={site} style={styles.input} placeholder="where it is going"
                         onChange={(e) => setSite(e.target.value)} />
                </label>
              </div>

              <div style={styles.toolbar}>
                <span style={styles.label}>What is going out</span>
                <span>
                  <button type="button" style={styles.link} onClick={() => setAll(true)}>All remaining</button>
                  <button type="button" style={styles.link} onClick={() => setAll(false)}>None</button>
                </span>
              </div>

              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Item</th>
                    <th style={{ ...styles.th, textAlign: "right" }}>Billed</th>
                    <th style={{ ...styles.th, textAlign: "right" }}>Delivered</th>
                    <th style={{ ...styles.th, textAlign: "right" }}>Left</th>
                    <th style={{ ...styles.th, textAlign: "right", width: 130 }}>Deliver now</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const left = Number(l.remainingQuantity) || 0;
                    const qty = parseFloat(rows[l.invoiceItemId]) || 0;
                    const over = qty > left + 1e-9;
                    return (
                      <tr key={l.invoiceItemId} style={{ opacity: left > 0 ? 1 : 0.5 }}>
                        <td style={styles.td}>
                          {l.description}
                          {l.unit ? <span style={styles.muted}> · {l.unit}</span> : null}
                        </td>
                        <td style={styles.tdNum}>{Number(l.billedQuantity).toLocaleString()}</td>
                        <td style={styles.tdNum}>{Number(l.deliveredQuantity).toLocaleString()}</td>
                        <td style={{ ...styles.tdNum, fontWeight: 700 }}>{left.toLocaleString()}</td>
                        <td style={styles.tdNum}>
                          <input
                            type="text"
                            inputMode="decimal"
                            disabled={left <= 0}
                            value={rows[l.invoiceItemId] ?? ""}
                            onChange={(e) => {
                              const cleaned = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
                              setRows((prev) => ({ ...prev, [l.invoiceItemId]: cleaned }));
                            }}
                            style={{
                              ...styles.input, textAlign: "right", fontWeight: 600,
                              borderColor: over ? "#c62828" : undefined,
                              backgroundColor: left <= 0 ? "#f1f3f6" : "#fff",
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {error && <div style={styles.error}>{error}</div>}
            </>
          )}
        </div>

        <div style={styles.footer}>
          <span style={styles.muted}>
            {chosen.length === 0
              ? "Nothing selected"
              : `${chosen.length} line${chosen.length > 1 ? "s" : ""} · ${totalQty.toLocaleString()} going out`}
          </span>
          <span style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" onClick={onClose} style={styles.cancel}>Cancel</button>
            <button type="submit" disabled={saving || chosen.length === 0 || !!overOne}
                    style={{ ...styles.save, opacity: saving || chosen.length === 0 || overOne ? 0.6 : 1 }}>
              {saving ? "Creating…" : "Create Challan"}
            </button>
          </span>
        </div>
      </form>
    </div>
  );
}

const styles = {
  backdrop: {
    position: "fixed", inset: 0, backgroundColor: "rgba(15,20,30,0.55)",
    backdropFilter: "blur(4px)", display: "flex", alignItems: "center",
    justifyContent: "center", zIndex: 1200, padding: "2vh 1rem",
  },
  modal: {
    background: "#fff", borderRadius: 12, width: "100%",
    maxWidth: modalSizes?.lg || 820, maxHeight: "92vh",
    display: "flex", flexDirection: "column", overflow: "hidden",
    boxShadow: "0 20px 60px rgba(13,71,161,0.25)",
  },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "0.9rem 1.1rem", background: "linear-gradient(90deg,#0d47a1,#00897b)",
    color: "#fff", fontWeight: 700,
  },
  x: { background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 0 },
  body: { padding: "1rem 1.1rem", overflowY: "auto" },
  meta: { display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "baseline", marginBottom: "0.8rem" },
  row: { display: "flex", flexWrap: "wrap", gap: "0.8rem", marginBottom: "0.9rem" },
  field: { flex: 1, minWidth: 190, display: "flex", flexDirection: "column", gap: "0.25rem" },
  label: { fontSize: "0.76rem", fontWeight: 700, color: "#5f6d7e", textTransform: "uppercase", letterSpacing: "0.03em" },
  input: {
    width: "100%", padding: "0.45rem 0.6rem", border: "1px solid #d0d7e2",
    borderRadius: 8, fontSize: "0.86rem", backgroundColor: "#f8f9fb", color: "#1a2332", outline: "none",
  },
  toolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" },
  link: {
    background: "none", border: "none", color: "#0d47a1", cursor: "pointer",
    fontSize: "0.78rem", fontWeight: 600, padding: "0.2rem 0.4rem",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" },
  th: {
    textAlign: "left", padding: "0.5rem 0.6rem", backgroundColor: "#f5f8fc",
    borderBottom: "1px solid #e8edf3", fontSize: "0.72rem", fontWeight: 700,
    color: "#5f6d7e", textTransform: "uppercase", letterSpacing: "0.04em",
  },
  td: { padding: "0.5rem 0.6rem", borderBottom: "1px solid #eef1f5", color: "#1a2332" },
  tdNum: {
    padding: "0.5rem 0.6rem", borderBottom: "1px solid #eef1f5",
    textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#1a2332",
  },
  muted: { color: "#5f6d7e", fontSize: "0.78rem" },
  error: {
    marginTop: "0.7rem", padding: "0.5rem 0.7rem", borderRadius: 8,
    backgroundColor: "#ffebee", color: "#c62828", fontSize: "0.82rem",
  },
  footer: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "0.8rem 1.1rem", borderTop: "1px solid #e8edf3", backgroundColor: "#fafbfd",
  },
  cancel: {
    padding: "0.5rem 1rem", borderRadius: 8, border: "1px solid #d0d7e2",
    background: "#fff", color: "#5f6d7e", cursor: "pointer", fontWeight: 600,
  },
  save: {
    padding: "0.5rem 1.1rem", borderRadius: 8, border: "none",
    background: "linear-gradient(90deg,#0d47a1,#00897b)", color: "#fff",
    cursor: "pointer", fontWeight: 700,
  },
};

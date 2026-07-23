import { useState, useEffect } from "react";
import { createChallanFromOrder } from "../api/salesOrderApi";
import { getClientsByCompany } from "../api/clientApi";
import { formStyles, modalSizes } from "../theme";

const colors = {
  textSecondary: "#5f6d7e", cardBorder: "#e8edf3", inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2", danger: "#dc3545", dangerLight: "#fff0f1", teal: "#00897b", blue: "#0d47a1",
};

// Raise a delivery challan that fulfils a Sales Order. Pre-fills each line's
// quantity with what's still remaining; the operator can deliver less (partial)
// or more (over-delivery is allowed and flagged on the order afterwards).
export default function CreateChallanFromOrderModal({ order, companyId, onClose, onCreated }) {
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().slice(0, 10));
  const [site, setSite] = useState(order?.site || "");
  const [qtys, setQtys] = useState(() => {
    const m = {};
    (order?.items || []).forEach((i) => { m[i.id] = i.remainingQuantity > 0 ? i.remainingQuantity : 0; });
    return m;
  });
  const [clients, setClients] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Load the company's clients so the Site field can offer this order's
  // client's configured sites (";"-separated) as a dropdown — same UX as
  // the Delivery Challan form. Falls back to free text when none configured.
  useEffect(() => {
    getClientsByCompany(companyId).then(({ data }) => setClients(data || [])).catch(() => {});
  }, [companyId]);

  const client = clients.find((c) => String(c.id) === String(order?.clientId));
  const sites = client?.site ? client.site.split(";").map((x) => x.trim()).filter(Boolean) : [];

  const setQty = (id, val) => setQtys((p) => ({ ...p, [id]: val }));
  const anyToDeliver = Object.values(qtys).some((q) => Number(q) > 0);

  const submit = async () => {
    if (saving || !anyToDeliver) return;
    setSaving(true);
    setError("");
    try {
      const lines = (order.items || [])
        .map((i) => ({ salesOrderItemId: i.id, quantity: Number(qtys[i.id]) || 0 }))
        .filter((l) => l.quantity > 0);
      const { data } = await createChallanFromOrder(order.id, {
        deliveryDate: deliveryDate ? new Date(deliveryDate).toISOString() : null,
        site: site.trim() || null,
        lines,
      });
      onCreated(data);
    } catch (err) {
      setError(err.response?.data?.error || "Could not create the challan.");
      setSaving(false);
    }
  };

  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>Deliver Sales Order #{order.salesOrderNumber}</h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <div style={formStyles.body}>
          {error && <div style={s.err}>{error}</div>}
          <p style={s.sub}>Quantities default to what's still remaining. Adjust to deliver a partial amount; a challan will be created and linked to this order.</p>
          <div style={s.row}>
            <div style={{ flex: 1, minWidth: 150 }}>
              <label style={s.label}>Delivery Date</label>
              <input type="date" style={s.input} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
            </div>
            <div style={{ flex: 2, minWidth: 180 }}>
              <label style={s.label}>Site / Department <span style={{ fontWeight: 400 }}>(optional)</span></label>
              {sites.length > 0 ? (
                <select style={s.input} value={site} onChange={(e) => setSite(e.target.value)}>
                  <option value="">(none)</option>
                  {sites.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              ) : (
                <input type="text" style={s.input} value={site} onChange={(e) => setSite(e.target.value)} placeholder="Optional" />
              )}
            </div>
          </div>

          <div style={s.tableHead}>
            <div style={{ flex: 2 }}>Item</div>
            <div style={s.col}>Ordered</div>
            <div style={s.col}>Delivered</div>
            <div style={s.col}>Remaining</div>
            <div style={s.col}>Deliver now</div>
          </div>
          {(order.items || []).map((i) => (
            <div key={i.id} style={s.tableRow}>
              <div style={{ flex: 2, minWidth: 0 }}>
                <div style={s.desc}>{i.description}</div>
                <div style={s.unit}>{i.unit}</div>
              </div>
              <div style={s.col}>{i.quantity}</div>
              <div style={s.col}>{i.deliveredQuantity}</div>
              <div style={{ ...s.col, fontWeight: 700, color: i.remainingQuantity > 0 ? colors.blue : colors.teal }}>{i.remainingQuantity}</div>
              <div style={s.col}>
                <input type="number" min="0" step="0.0001" style={{ ...s.input, textAlign: "right", padding: "0.4rem 0.45rem" }} value={qtys[i.id] ?? 0} onChange={(e) => setQty(i.id, e.target.value)} />
              </div>
            </div>
          ))}
        </div>
        <div style={formStyles.footer}>
          <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
          <button type="button" style={{ ...formStyles.button, ...formStyles.submit, opacity: anyToDeliver && !saving ? 1 : 0.6 }} disabled={!anyToDeliver || saving} onClick={submit}>{saving ? "Creating..." : "Create Challan"}</button>
        </div>
      </div>
    </div>
  );
}

const s = {
  sub: { fontSize: "0.85rem", color: colors.textSecondary, marginBottom: "1rem" },
  row: { display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" },
  label: { display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem", color: colors.textSecondary },
  input: { width: "100%", padding: "0.55rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: "#1a2332", outline: "none", boxSizing: "border-box" },
  err: { backgroundColor: colors.dangerLight, color: colors.danger, padding: "0.65rem 1rem", borderRadius: 8, marginBottom: "1rem", fontWeight: 500, fontSize: "0.85rem" },
  tableHead: { display: "flex", gap: "0.4rem", padding: "0.5rem", fontSize: "0.72rem", textTransform: "uppercase", fontWeight: 700, color: colors.textSecondary, borderBottom: `2px solid ${colors.cardBorder}` },
  tableRow: { display: "flex", gap: "0.4rem", alignItems: "center", padding: "0.5rem", borderBottom: `1px solid ${colors.cardBorder}` },
  col: { width: 90, flexShrink: 0, textAlign: "center", fontSize: "0.85rem" },
  desc: { fontSize: "0.88rem", fontWeight: 600, color: "#1a2332", whiteSpace: "pre-wrap" },
  unit: { fontSize: "0.75rem", color: colors.textSecondary },
};

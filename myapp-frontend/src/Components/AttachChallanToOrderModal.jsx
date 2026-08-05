import { useState, useEffect, useMemo, useCallback } from "react";
import { MdLink, MdWarningAmber } from "react-icons/md";
import {
  getAttachableChallans, attachChallanToOrder,
  getSalesOrdersForPicker, getSalesOrderById,
} from "../api/salesOrderApi";
import SearchableSelect from "./SearchableSelect";
import { formStyles, modalSizes } from "../theme";
import useIsNarrow from "../hooks/useIsNarrow";
import { richTextToPlain } from "../utils/richText";

const colors = {
  textPrimary: "#1a2332", textSecondary: "#5f6d7e", cardBorder: "#e8edf3",
  inputBg: "#f8f9fb", inputBorder: "#d0d7e2", danger: "#dc3545", dangerLight: "#fff0f1",
  teal: "#00897b", blue: "#0d47a1", warn: "#e65100", warnLight: "#fff8e1", bg: "#f7f9fc",
};

const fmtQty = (n) => { const v = Number(n) || 0; return Number.isInteger(v) ? String(v) : parseFloat(v.toFixed(4)).toString(); };
const fmtDate = (d) => { if (!d) return "—"; const dt = new Date(d); const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return `${String(dt.getDate()).padStart(2,"0")}-${m[dt.getMonth()]}-${String(dt.getFullYear()).slice(-2)}`; };

const EXTRA = ""; // mapping value for "not an ordered line"

/**
 * Attach an existing (unlinked, unbilled) delivery challan to a Sales Order.
 *
 * Two launch modes — pass exactly one of `order` / `challan`:
 *   • order   → SO fixed; operator picks a challan from this client's
 *               unlinked challans in the order's division (the No-PO-before-PO
 *               case).
 *   • challan → challan fixed; operator picks an SO for the challan's client.
 *
 * Either way the operator lands on a mapping grid: each challan line gets a
 * dropdown of the order's lines (auto-suggested by item type / description),
 * plus "Add as new order line". The delivered quantity was already booked when
 * the challan was created — attaching only links the rows and adopts the
 * order's PO. The challan keeps its own division.
 */
export default function AttachChallanToOrderModal({ companyId, order, challan, onClose, onAttached }) {
  const fromOrder = !!order;
  const isNarrow = useIsNarrow(760);

  // The "other side" the operator picks.
  const [attachable, setAttachable] = useState([]);   // mode A: challans for the order's client
  const [orders, setOrders] = useState([]);           // mode B: SOs for the challan's client
  const [pickedChallanId, setPickedChallanId] = useState("");
  const [pickedOrderId, setPickedOrderId] = useState("");

  // Resolved both sides once a pick is made.
  const [soItems, setSoItems] = useState(fromOrder ? (order.items || []) : []); // target ordered lines
  const [challanLines, setChallanLines] = useState(() => fromOrder ? [] : normalizeChallanLines(challan?.items || []));
  const [mapping, setMapping] = useState({});         // { deliveryItemId: salesOrderItemId | "" }

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const orderId = fromOrder ? order.id : (pickedOrderId ? Number(pickedOrderId) : null);
  const challanId = fromOrder ? (pickedChallanId ? Number(pickedChallanId) : null) : challan.id;

  // Auto-suggest a mapping: item-type match first, then case-insensitive
  // description, preferring ordered lines that still have remaining qty.
  const buildAutoMap = useCallback((lines, items) => {
    const remaining = (s) => Number(s.remainingQuantity ?? (Number(s.quantity) - Number(s.deliveredQuantity || 0)));
    const pools = [items.filter((s) => remaining(s) > 0), items];
    const m = {};
    for (const line of lines) {
      let hit = "";
      for (const pool of pools) {
        if (line.itemTypeId) {
          const byType = pool.find((s) => s.itemTypeId && String(s.itemTypeId) === String(line.itemTypeId));
          if (byType) { hit = byType.id; break; }
        }
        const d = (line.description || "").trim().toLowerCase();
        const byDesc = d && pool.find((s) => richTextToPlain(s.description || "").trim().toLowerCase() === d);
        if (byDesc) { hit = byDesc.id; break; }
      }
      m[line.deliveryItemId] = hit;
    }
    return m;
  }, []);

  // Load the pick list for the not-fixed side.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const run = async () => {
      try {
        if (fromOrder) {
          const { data } = await getAttachableChallans(order.id);
          if (!cancelled) setAttachable(data || []);
        } else {
          const list = await getSalesOrdersForPicker(companyId);
          const forClient = (list || []).filter(
            (o) => String(o.clientId) === String(challan.clientId) && o.status !== "Cancelled"
          );
          if (!cancelled) setOrders(forClient);
        }
      } catch {
        if (!cancelled) setError("Failed to load options.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [fromOrder, companyId, order?.id, challan?.clientId]);

  // Mode A: picking a challan resolves its lines; SO items are fixed.
  const onPickChallan = (id) => {
    setPickedChallanId(id || "");
    setError("");
    const c = attachable.find((x) => String(x.id) === String(id));
    const lines = normalizeChallanLines(c?.lines || []);
    setChallanLines(lines);
    setMapping(buildAutoMap(lines, soItems));
  };

  // Mode B: picking an SO resolves the ordered lines; challan lines are fixed.
  const onPickOrder = async (id) => {
    setPickedOrderId(id || "");
    setError("");
    if (!id) { setSoItems([]); setMapping({}); return; }
    try {
      const { data } = await getSalesOrderById(id);
      const items = data?.items || [];
      setSoItems(items);
      setMapping(buildAutoMap(challanLines, items));
    } catch { setError("Failed to load the order's lines."); }
  };

  const setLineMap = (deliveryItemId, soItemId) =>
    setMapping((p) => ({ ...p, [deliveryItemId]: soItemId }));

  // Preview: projected delivered/remaining per ordered line after the attach.
  const preview = useMemo(() => {
    const byItem = {};
    for (const s of soItems) {
      const add = challanLines
        .filter((l) => String(mapping[l.deliveryItemId] ?? EXTRA) === String(s.id))
        .reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
      const already = Number(s.deliveredQuantity || 0);
      const projected = already + add;
      byItem[s.id] = { add, projected, ordered: Number(s.quantity) || 0, over: projected > (Number(s.quantity) || 0) };
    }
    return byItem;
  }, [soItems, challanLines, mapping]);

  const anyOver = Object.values(preview).some((p) => p.over);
  const ready = !!orderId && !!challanId && challanLines.length > 0;

  const submit = async () => {
    if (!ready || saving) return;
    setSaving(true);
    setError("");
    try {
      const lineMappings = challanLines.map((l) => ({
        deliveryItemId: l.deliveryItemId,
        salesOrderItemId: mapping[l.deliveryItemId] ? Number(mapping[l.deliveryItemId]) : null,
      }));
      const { data } = await attachChallanToOrder(orderId, { challanId, lineMappings });
      onAttached?.(data);
    } catch (err) {
      setError(err.response?.data?.error || "Could not attach the challan.");
      setSaving(false);
    }
  };

  // Options carry an item preview in the label AND a hidden `items` field with
  // every line description, so the operator can find the right challan by
  // typing a product name (not just DC#/PO). Both feed SearchableSelect's
  // searchKeys.
  const challanOptions = useMemo(() => attachable.map((c) => {
    const items = (c.lines || []).map((l) => richTextToPlain(l.description || "")).filter(Boolean);
    const preview = items.length
      ? ` · ${items.slice(0, 3).join(", ")}${items.length > 3 ? ` +${items.length - 3} more` : ""}`
      : "";
    return {
      id: c.id,
      label: `DC #${c.challanNumber} · ${fmtDate(c.deliveryDate)} · ${c.status}${c.poNumber ? ` · PO ${c.poNumber}` : ""} · ${items.length} line${items.length !== 1 ? "s" : ""}${preview}`,
      items: items.join(" "),
    };
  }), [attachable]);

  const orderOptions = useMemo(() => orders.map((o) => ({
    id: o.id,
    label: `SO #${o.salesOrderNumber} · ${fmtDate(o.orderDate)}${o.customerPoNumber ? ` · PO ${o.customerPoNumber}` : ""} · ${o.fulfillmentStatus}`,
  })), [orders]);

  const soLineLabel = (s) => `${richTextToPlain(s.description || "")}${s.unit ? ` (${s.unit})` : ""} — ${fmtQty(s.deliveredQuantity || 0)}/${fmtQty(s.quantity)} delivered`;

  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>
            <MdLink size={18} style={{ verticalAlign: "-3px", marginRight: 6 }} />
            {fromOrder ? `Attach a challan to SO #${order.salesOrderNumber}` : `Link Challan #${challan.challanNumber} to a Sales Order`}
          </h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>

        <div style={formStyles.body}>
          {error && <div style={s.err}>{error}</div>}
          <p style={s.sub}>
            The delivered quantity was already recorded when the challan was created — attaching links its lines to the order (adding any items not on the order as new lines) and adopts the order's PO. No stock changes.
          </p>

          {/* Pick the not-fixed side */}
          <div style={{ marginBottom: "1rem" }}>
            <label style={s.label}>{fromOrder ? "Challan to attach" : "Sales Order"}</label>
            {fromOrder ? (
              <>
                <SearchableSelect
                  items={challanOptions} value={pickedChallanId}
                  onChange={(id) => onPickChallan(id)}
                  labelKey="label" searchKeys={["label", "items"]}
                  placeholder={loading ? "Loading…" : (challanOptions.length ? "Pick a challan…" : "No unlinked challans for this customer")}
                  loading={loading}
                />
                {challanOptions.length > 0 && (
                  <div style={s.hint}>Only No-PO challans in this order's division are shown. Search by challan # or item description.</div>
                )}
              </>
            ) : (
              <SearchableSelect
                items={orderOptions} value={pickedOrderId}
                onChange={(id) => onPickOrder(id)}
                labelKey="label" searchKeys={["label"]}
                placeholder={loading ? "Loading…" : (orderOptions.length ? "Pick an order…" : "No open orders for this customer")}
                loading={loading}
              />
            )}
          </div>

          {/* Mapping grid */}
          {challanLines.length > 0 && soItems.length > 0 && (
            <>
              <div style={s.gridTitle}>Map each challan line to an order line — or add it as a new one</div>
              {anyOver && (
                <div style={s.warn}><MdWarningAmber size={16} /> Some lines will over-deliver the order (delivered exceeds ordered). Allowed, but the order will flag as Over Delivered.</div>
              )}

              {isNarrow ? (
                <div style={s.mcards}>
                  {challanLines.map((l) => (
                    <div key={l.deliveryItemId} style={s.mcard}>
                      <div style={s.desc}>{l.description}</div>
                      <div style={s.unit}>{fmtQty(l.quantity)} {l.unit}</div>
                      <label style={s.mlabel}>Fulfils ordered line</label>
                      <select style={s.select} value={mapping[l.deliveryItemId] ?? EXTRA} onChange={(e) => setLineMap(l.deliveryItemId, e.target.value)}>
                        <option value={EXTRA}>Add as new order line</option>
                        {soItems.map((s2) => <option key={s2.id} value={s2.id}>{soLineLabel(s2)}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={s.tableWrap}>
                  <div style={s.thead}>
                    <div style={{ flex: 2 }}>Challan line</div>
                    <div style={s.qCol}>Qty</div>
                    <div style={{ flex: 3 }}>Fulfils ordered line</div>
                  </div>
                  {challanLines.map((l) => (
                    <div key={l.deliveryItemId} style={s.trow}>
                      <div style={{ flex: 2, minWidth: 0 }}>
                        <div style={s.desc}>{l.description}</div>
                        {l.itemTypeName && <div style={s.unit}>{l.itemTypeName}</div>}
                      </div>
                      <div style={s.qCol}>{fmtQty(l.quantity)} {l.unit}</div>
                      <div style={{ flex: 3 }}>
                        <select style={s.select} value={mapping[l.deliveryItemId] ?? EXTRA} onChange={(e) => setLineMap(l.deliveryItemId, e.target.value)}>
                          <option value={EXTRA}>Add as new order line</option>
                          {soItems.map((s2) => <option key={s2.id} value={s2.id}>{soLineLabel(s2)}</option>)}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Resulting-fulfilment preview */}
              <div style={s.previewTitle}>After attaching</div>
              <div style={s.previewList}>
                {soItems.map((s2) => {
                  const p = preview[s2.id] || { add: 0, projected: Number(s2.deliveredQuantity || 0), ordered: Number(s2.quantity), over: false };
                  if (!p.add) return null;
                  return (
                    <div key={s2.id} style={s.previewRow}>
                      <span style={s.pDesc}>{richTextToPlain(s2.description || "")}</span>
                      <span style={{ ...s.pQty, color: p.over ? colors.warn : colors.teal }}>
                        {fmtQty(p.projected)}/{fmtQty(p.ordered)}{p.over ? " ⚠ over" : ""}
                      </span>
                    </div>
                  );
                })}
                {challanLines.filter((l) => !mapping[l.deliveryItemId]).map((l, i) => (
                  <div key={`new-${i}`} style={s.previewRow}>
                    <span style={s.pDesc}>+ New order line: {l.description}</span>
                    <span style={{ ...s.pQty, color: colors.blue }}>{fmtQty(l.quantity)} {l.unit}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div style={formStyles.footer}>
          <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
          <button type="button" style={{ ...formStyles.button, ...formStyles.submit, opacity: ready && !saving ? 1 : 0.6 }} disabled={!ready || saving} onClick={submit}>
            {saving ? "Attaching…" : "Attach challan"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Normalize both DTO shapes (AttachableChallanLineDto and DeliveryItemDto) to
// a common { deliveryItemId, itemTypeId, itemTypeName, description, quantity,
// unit }. Descriptions are flattened to plain text (they may carry rich-text
// markup) so they render cleanly inside <select> options and search strings.
function normalizeChallanLines(lines) {
  return (lines || []).map((l) => ({
    deliveryItemId: l.deliveryItemId ?? l.id,
    itemTypeId: l.itemTypeId ?? null,
    itemTypeName: l.itemTypeName || "",
    description: richTextToPlain(l.description || ""),
    quantity: Number(l.quantity) || 0,
    unit: l.unit || "",
  }));
}

const s = {
  sub: { fontSize: "0.85rem", color: colors.textSecondary, marginBottom: "1rem" },
  label: { display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem", color: colors.textSecondary },
  hint: { fontSize: "0.75rem", color: colors.textSecondary, marginTop: "0.35rem", fontStyle: "italic" },
  err: { backgroundColor: colors.dangerLight, color: colors.danger, padding: "0.65rem 1rem", borderRadius: 8, marginBottom: "1rem", fontWeight: 500, fontSize: "0.85rem" },
  warn: { display: "flex", alignItems: "center", gap: "0.4rem", backgroundColor: colors.warnLight, color: colors.warn, padding: "0.55rem 0.85rem", borderRadius: 8, margin: "0.5rem 0 0.75rem", fontSize: "0.82rem", fontWeight: 500 },
  gridTitle: { fontSize: "0.9rem", fontWeight: 700, color: colors.textPrimary, marginBottom: "0.5rem" },
  tableWrap: { border: `1px solid ${colors.cardBorder}`, borderRadius: 10, overflow: "hidden" },
  thead: { display: "flex", gap: "0.6rem", padding: "0.5rem 0.7rem", fontSize: "0.72rem", textTransform: "uppercase", fontWeight: 700, color: colors.textSecondary, background: colors.bg, borderBottom: `1px solid ${colors.cardBorder}` },
  trow: { display: "flex", gap: "0.6rem", alignItems: "center", padding: "0.5rem 0.7rem", borderBottom: `1px solid ${colors.cardBorder}` },
  qCol: { width: 110, flexShrink: 0, fontSize: "0.85rem", fontWeight: 600, color: colors.textPrimary },
  desc: { fontSize: "0.88rem", fontWeight: 600, color: colors.textPrimary, whiteSpace: "pre-wrap" },
  unit: { fontSize: "0.74rem", color: colors.textSecondary, marginTop: "0.1rem" },
  select: { width: "100%", padding: "0.5rem 0.6rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.85rem", backgroundColor: colors.inputBg, color: colors.textPrimary, cursor: "pointer" },
  mcards: { display: "flex", flexDirection: "column", gap: "0.6rem" },
  mcard: { border: `1px solid ${colors.cardBorder}`, borderRadius: 12, padding: "0.7rem 0.75rem", background: "#fff" },
  mlabel: { display: "block", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.03em", color: colors.textSecondary, fontWeight: 700, margin: "0.5rem 0 0.25rem" },
  previewTitle: { fontSize: "0.8rem", fontWeight: 700, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.03em", margin: "1rem 0 0.4rem" },
  previewList: { display: "flex", flexDirection: "column", gap: "0.3rem" },
  previewRow: { display: "flex", justifyContent: "space-between", gap: "0.75rem", fontSize: "0.83rem", padding: "0.3rem 0.5rem", borderRadius: 6, background: colors.bg },
  pDesc: { color: colors.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 },
  pQty: { fontWeight: 700, flexShrink: 0, whiteSpace: "nowrap" },
};

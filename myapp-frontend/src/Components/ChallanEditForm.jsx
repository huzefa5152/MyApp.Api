import { useState, useRef, useEffect, useMemo } from "react";
import { MdAdd, MdDelete, MdInfo, MdContentCopy } from "react-icons/md";
import LookupAutocomplete from "./LookupAutocomplete";
import QuantityInput from "./QuantityInput";
import { updateChallan } from "../api/challanApi";
import { getClientsByCompany } from "../api/clientApi";
import { saveItemFbrDefaults } from "../api/lookupApi";
import { getAllUnits } from "../api/unitsApi";
import { formStyles, modalSizes } from "../theme";

const colors = {
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  danger: "#dc3545",
  dangerLight: "#fff0f1",
  teal: "#00897b",
  blue: "#0d47a1",
  warning: "#f57c00",
  warningLight: "#fff3e0",
};

/**
 * ChallanEditForm — edit ANY editable challan (Pending / No PO / Setup Required /
 * Invoiced-non-submitted). Lets the operator change:
 *    • Client             (from the same company's client list)
 *    • Site               (dropdown from the picked client's sites)
 *    • Delivery date
 *    • PO number          (CLEAR it to transition Pending → No PO)
 *    • PO date
 *    • Items              (add / remove / reorder)
 *
 * Submits via a single `PUT /deliverychallans/{id}` call. The backend
 * re-evaluates status:
 *    empty PO  → No PO
 *    with PO   → Pending (if FBR-ready)
 *    FBR gaps  → Setup Required
 *    Invoiced  → stays Invoiced (status preserved — bill syncs separately)
 */
export default function ChallanEditForm({ challan, onClose, onSaved }) {
  // ── Duplicate mode ─────────────────────────────────────────────────────
  // When this challan is itself a duplicate (cloned from another via the
  // Duplicate action), only PO Number, PO Date, and Items may be edited.
  // Client / Site / Delivery Date / Indent are inherited from the source
  // and locked so the original physical-delivery context stays consistent
  // across all copies of this challan number.
  const isDuplicate = challan.duplicatedFromId != null;

  // ── Header fields ──
  const [clientId, setClientId] = useState(challan.clientId || "");
  const [site, setSite] = useState(challan.site || "");
  const [deliveryDate, setDeliveryDate] = useState(
    challan.deliveryDate ? challan.deliveryDate.substring(0, 10) : ""
  );
  const [poNumber, setPoNumber] = useState(challan.poNumber || "");
  const [poDate, setPoDate] = useState(challan.poDate ? challan.poDate.substring(0, 10) : "");
  const [indentNo, setIndentNo] = useState(challan.indentNo || "");

  // ── Line items ──
  // Item Type isn't captured on challans anymore — that classification
  // happens on the Invoices tab during FBR submission. We still preserve
  // any pre-existing itemTypeId on the row so legacy challans round-trip
  // unchanged through Save (the backend's diff helper sees no qty/desc/unit
  // change and won't touch them).
  const [items, setItems] = useState(
    challan.items.map((i) => ({
      id: i.id,
      itemTypeId: i.itemTypeId || null,
      description: i.description,
      quantity: i.quantity,
      unit: i.unit,
    }))
  );

  // ── Lookups ──
  const [clients, setClients] = useState([]);
  // Units list — gates each row's quantity input on the picked UOM.
  const [units, setUnits] = useState([]);

  // ── UI state ──
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const containerRef = useRef(null);

  // Load lookups once
  useEffect(() => {
    if (challan.companyId) {
      getClientsByCompany(challan.companyId).then(({ data }) => setClients(data)).catch(() => {});
    }
    getAllUnits().then(({ data }) => setUnits(data)).catch(() => setUnits([]));
  }, [challan.companyId]);

  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [items.length]);

  // Derive the site options from the selected client's semicolon-separated list.
  // Null-safe: if the client has no sites the dropdown collapses to a free-text
  // input so operator can still type a one-off site.
  const selectedClient = useMemo(
    () => clients.find((c) => String(c.id) === String(clientId)),
    [clients, clientId]
  );
  const clientSites = useMemo(
    () =>
      selectedClient?.site
        ? selectedClient.site.split(";").map((s) => s.trim()).filter(Boolean)
        : [],
    [selectedClient]
  );

  // If user switches client, clear any site that doesn't belong to the new
  // client's list. Keeps the free-text case intact (empty list → always clear).
  useEffect(() => {
    if (clientSites.length > 0 && site && !clientSites.includes(site)) {
      setSite("");
    }
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Item handlers ──
  const handleItemChange = (index, field, value) => {
    const next = [...items];
    next[index][field] = value;
    setItems(next);
  };

  const handleItemPick = (index, picked) => {
    const next = [...items];
    if (picked.name) next[index].description = picked.name;
    if (picked.uom) next[index].unit = picked.uom;
    setItems(next);

    if (picked.name && (picked.hsCode || picked.saleType || picked.fbrUOMId)) {
      saveItemFbrDefaults({
        name: picked.name,
        hsCode: picked.hsCode || null,
        saleType: picked.saleType || null,
        fbrUOMId: picked.fbrUOMId || null,
        uom: picked.uom || null,
      }).catch(() => {});
    }
  };

  const addItem = () => {
    setItems([...items, { id: 0, itemTypeId: null, description: "", quantity: 1, unit: "" }]);
  };

  const removeItem = (index) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  // ── Preview the status the backend WILL set, so the operator sees the
  //    consequence of clearing the PO before they hit Save ──
  const previewStatus = useMemo(() => {
    if (challan.status === "Invoiced") return "Invoiced (unchanged — bill already exists)";
    if (challan.status === "Cancelled") return "Cancelled";
    const hasPo = poNumber.trim().length > 0;
    // Imported challans keep the "Imported" label when they have a PO; native
    // ones use "Pending". Setup Required is possible but the preview just
    // shows the ready state optimistically; the backend corrects if not FBR-ready.
    const readyLabel = challan.isImported ? "Imported" : "Pending";
    if (challan.status === "Setup Required") return hasPo ? `${readyLabel} (if FBR-ready)` : "No PO";
    return hasPo ? readyLabel : "No PO";
  }, [poNumber, challan.status, challan.isImported]);

  const statusWillChange = previewStatus !== challan.status;

  // ── Submit ──
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!clientId) { setError("Client is required."); return; }
    if (!deliveryDate) { setError("Delivery date is required."); return; }
    const validItems = items.filter((i) => i.description.trim());
    if (validItems.length === 0) { setError("At least one item is required."); return; }
    if (validItems.some((i) => i.quantity <= 0)) { setError("All items must have a quantity > 0."); return; }

    setSaving(true);
    try {
      await updateChallan(challan.id, {
        companyId: challan.companyId,
        clientId: parseInt(clientId),
        site: site || null,
        // Empty string = operator wants to clear PO → "No PO" status.
        // Backend re-evaluates status based on FBR readiness.
        poNumber: poNumber.trim(),
        poDate: poNumber.trim() && poDate ? new Date(poDate).toISOString() : null,
        indentNo: indentNo.trim() || null,
        deliveryDate: new Date(deliveryDate).toISOString(),
        items: validItems.map((i) => ({
          id: i.id || 0,
          // Preserved from the row for legacy challans whose lines were
          // typed pre-split. New rows have itemTypeId=null. Either way the
          // backend stores it as-is; classification happens on Invoices.
          itemTypeId: i.itemTypeId ? parseInt(i.itemTypeId) : null,
          description: i.description.trim(),
          // parseFloat preserves decimals (12.5, 0.0004) — server-side
          // validation rejects fractions for integer-only UOMs.
          quantity: parseFloat(i.quantity) || 1,
          unit: (i.unit || "").trim(),
          itemTypeName: "",
        })),
      });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to update challan.");
    } finally {
      setSaving(false);
    }
  };

  // Backdrop click is a no-op — protects in-progress edits from a stray
  // click. Dismiss via the X in the header or the Cancel button.
  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.xl}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>
            {isDuplicate ? "Edit Duplicate Challan" : "Edit Challan"} #{challan.challanNumber}
          </h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={formStyles.body}>
            {error && <div style={styles.errorAlert}>{error}</div>}

            {/* Duplicate-mode banner — explains why so many fields are
                read-only and what the operator IS allowed to change. */}
            {isDuplicate && (
              <div style={styles.duplicateBanner}>
                <MdContentCopy size={16} />
                <span>
                  This is a <strong>duplicate</strong>
                  {challan.duplicatedFromChallanNumber
                    ? <> of <strong>Challan #{challan.duplicatedFromChallanNumber}</strong></>
                    : null}
                  . Only <strong>PO Number</strong>, <strong>PO Date</strong>, and <strong>Items</strong> can be changed —
                  Client, Site, Delivery Date, and Indent No are inherited from the original.
                </span>
              </div>
            )}

            {/* Status preview banner — shows what the Save click will do to
                the challan's status. Especially useful when clearing the PO. */}
            <div style={{ ...styles.statusBanner, backgroundColor: statusWillChange ? colors.warningLight : "#eef4fb", borderColor: statusWillChange ? "#ffcc80" : "#90caf9", color: statusWillChange ? "#e65100" : colors.blue }}>
              <MdInfo size={16} />
              <span>
                Status: <strong>{challan.status}</strong>
                {statusWillChange && <> → will become <strong>{previewStatus}</strong> after save</>}
                {!statusWillChange && <> (will stay <strong>{previewStatus}</strong>)</>}
              </span>
            </div>

            {/* ── Header row: Client / Site / Delivery Date ── */}
            <div style={styles.rowGroup}>
              <div style={{ flex: 2, minWidth: 220 }}>
                <label style={styles.label}>
                  Client *
                  {isDuplicate && <span style={styles.lockedHint}> (locked — inherited)</span>}
                </label>
                <select
                  style={isDuplicate ? { ...styles.input, ...styles.lockedInput } : styles.input}
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  required
                  disabled={isDuplicate}
                >
                  <option value="">Select a client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1.5, minWidth: 180 }}>
                <label style={styles.label}>
                  Site / Department
                  {isDuplicate && <span style={styles.lockedHint}> (locked)</span>}
                </label>
                {clientSites.length > 0 ? (
                  <select
                    style={isDuplicate ? { ...styles.input, ...styles.lockedInput } : styles.input}
                    value={site}
                    onChange={(e) => setSite(e.target.value)}
                    disabled={isDuplicate}
                  >
                    <option value="">(none)</option>
                    {clientSites.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input
                    type="text"
                    style={isDuplicate ? { ...styles.input, ...styles.lockedInput } : styles.input}
                    placeholder="Optional"
                    value={site}
                    onChange={(e) => setSite(e.target.value)}
                    disabled={isDuplicate}
                  />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <label style={styles.label}>
                  Delivery Date *
                  {isDuplicate && <span style={styles.lockedHint}> (locked)</span>}
                </label>
                <input
                  type="date"
                  style={isDuplicate ? { ...styles.input, ...styles.lockedInput } : styles.input}
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  required
                  disabled={isDuplicate}
                />
              </div>
            </div>

            {/* ── PO row: Number (clearable) + Date + Indent No ──
                All three on one line so the operator sees the full PO/indent
                context at a glance. Indent No is optional and independent
                of PO — companies that don't use indents leave it blank. */}
            <div style={styles.rowGroup}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <label style={styles.label}>
                  PO Number
                  <span style={styles.labelHint}> (clear to move to "No PO")</span>
                </label>
                <input
                  type="text"
                  style={styles.input}
                  placeholder="Leave blank for No PO"
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                />
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={styles.label}>PO Date</label>
                <input
                  type="date"
                  style={styles.input}
                  value={poDate}
                  onChange={(e) => setPoDate(e.target.value)}
                  disabled={!poNumber.trim()}
                  title={!poNumber.trim() ? "Set a PO Number first" : undefined}
                />
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <label style={styles.label}>
                  Indent No
                  {isDuplicate
                    ? <span style={styles.lockedHint}> (locked)</span>
                    : <span style={styles.labelHint}> (optional)</span>}
                </label>
                <input
                  type="text"
                  style={isDuplicate ? { ...styles.input, ...styles.lockedInput } : styles.input}
                  disabled={isDuplicate}
                  placeholder="Leave blank if not used"
                  value={indentNo}
                  onChange={(e) => setIndentNo(e.target.value)}
                />
              </div>
            </div>

            {/* ── Items ── */}
            <label style={{ ...styles.label, marginTop: "0.75rem" }}>Items *</label>

            {/* Item Type lives on the Invoices tab now — challans capture
                description / qty / unit only. Operators classify each line
                by Item Type when preparing the bill for FBR submission. */}

            <div ref={containerRef} style={styles.itemsContainer}>
              {items.map((item, idx) => (
                <div key={idx} style={styles.itemRow}>
                  <div style={styles.itemIndex}>{idx + 1}</div>
                  <div style={{ flex: 2, minWidth: 0 }}>
                    <LookupAutocomplete
                      label="Description"
                      endpoint="/lookup/items"
                      value={item.description}
                      onChange={(val) => handleItemChange(idx, "description", val)}
                    />
                  </div>
                  {/* Wider column so 4-place decimals (0.0004, 1234.5678)
                      stay fully visible alongside the spinner controls. */}
                  <div style={{ width: 130, flexShrink: 0 }}>
                    <QuantityInput
                      value={item.quantity}
                      onChange={(val) => handleItemChange(idx, "quantity", val === "" ? 1 : val)}
                      unit={item.unit}
                      units={units}
                      style={{ ...styles.input, textAlign: "right", padding: "0.55rem 0.5rem" }}
                    />
                  </div>
                  <div style={{ width: 180, flexShrink: 0 }}>
                    <LookupAutocomplete
                      label="Unit"
                      endpoint="/lookup/units"
                      value={item.unit}
                      onChange={(val) => handleItemChange(idx, "unit", val)}
                    />
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    {items.length > 1 && (
                      <button type="button" style={styles.removeBtn} onClick={() => removeItem(idx)}>
                        <MdDelete size={16} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button type="button" style={styles.addItemBtn} onClick={addItem}>
              <MdAdd size={16} /> Add Item
            </button>
          </div>
          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              style={{ ...formStyles.button, ...formStyles.submit, opacity: saving ? 0.6 : 1 }}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles = {
  errorAlert: {
    backgroundColor: colors.dangerLight,
    color: colors.danger,
    padding: "0.65rem 1rem",
    borderRadius: 8,
    marginBottom: "1rem",
    fontWeight: 500,
    border: `1px solid ${colors.danger}30`,
    fontSize: "0.85rem",
  },
  statusBanner: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.6rem 0.85rem",
    borderRadius: 10,
    border: "1px solid",
    fontSize: "0.82rem",
    marginBottom: "0.9rem",
  },
  duplicateBanner: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.65rem 0.85rem",
    borderRadius: 10,
    border: "1px solid #b39ddb",
    backgroundColor: "#ede7f6",
    color: "#4527a0",
    fontSize: "0.82rem",
    marginBottom: "0.75rem",
    lineHeight: 1.45,
  },
  lockedInput: {
    backgroundColor: "#eef0f4",
    color: "#5f6d7e",
    cursor: "not-allowed",
  },
  lockedHint: {
    fontWeight: 400,
    fontSize: "0.72rem",
    color: "#4527a0",
    marginLeft: 4,
  },
  rowGroup: {
    display: "flex",
    gap: "0.75rem",
    flexWrap: "wrap",
    marginBottom: "0.75rem",
  },
  label: {
    display: "block",
    marginBottom: 4,
    fontWeight: 600,
    fontSize: "0.82rem",
    color: colors.textSecondary,
  },
  labelHint: {
    fontWeight: 400,
    fontSize: "0.72rem",
    color: colors.textSecondary,
    marginLeft: 4,
  },
  input: {
    width: "100%",
    padding: "0.55rem 0.75rem",
    borderRadius: 8,
    border: `1px solid ${colors.inputBorder}`,
    fontSize: "0.9rem",
    backgroundColor: colors.inputBg,
    color: colors.textPrimary,
    outline: "none",
    boxSizing: "border-box",
  },
  itemsContainer: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    maxHeight: 280,
    overflowY: "auto",
    paddingRight: 4,
  },
  itemRow: {
    display: "flex",
    gap: "0.4rem",
    alignItems: "flex-start",
    padding: "0.5rem",
    borderRadius: 10,
    border: `1px solid ${colors.cardBorder}`,
    backgroundColor: "#fafbfc",
    minWidth: 0,
  },
  itemIndex: {
    width: 22,
    paddingTop: "0.55rem",
    fontWeight: 700,
    fontSize: "0.82rem",
    color: colors.textSecondary,
    textAlign: "center",
    flexShrink: 0,
  },
  removeBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0.4rem",
    marginTop: "0.3rem",
    borderRadius: 8,
    border: `1px solid ${colors.danger}25`,
    backgroundColor: colors.dangerLight,
    color: colors.danger,
    cursor: "pointer",
  },
  addItemBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    marginTop: "0.6rem",
    padding: "0.4rem 0.9rem",
    borderRadius: 8,
    border: "none",
    backgroundColor: `${colors.teal}14`,
    color: colors.teal,
    fontSize: "0.82rem",
    fontWeight: 600,
    cursor: "pointer",
  },
};

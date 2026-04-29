import { useState, useRef, useEffect, useMemo } from "react";
import { MdAdd, MdDelete, MdInfo } from "react-icons/md";
import LookupAutocomplete from "./LookupAutocomplete";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";
import QuantityInput from "./QuantityInput";
import { updateChallan } from "../api/challanApi";
import { getClientsByCompany } from "../api/clientApi";
import { getItemTypes } from "../api/itemTypeApi";
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
  const [items, setItems] = useState(
    challan.items.map((i) => ({
      id: i.id,
      itemTypeId: i.itemTypeId || "",
      description: i.description,
      quantity: i.quantity,
      unit: i.unit,
    }))
  );

  // ── Lookups ──
  const [clients, setClients] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
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
    getItemTypes().then(({ data }) => setItemTypes(data)).catch(() => {});
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
    setItems([...items, { id: 0, itemTypeId: "", description: "", quantity: 1, unit: "" }]);
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
          <h5 style={formStyles.title}>Edit Challan #{challan.challanNumber}</h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={formStyles.body}>
            {error && <div style={styles.errorAlert}>{error}</div>}

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
                <label style={styles.label}>Client *</label>
                <select
                  style={styles.input}
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  required
                >
                  <option value="">Select a client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1.5, minWidth: 180 }}>
                <label style={styles.label}>Site / Department</label>
                {clientSites.length > 0 ? (
                  <select style={styles.input} value={site} onChange={(e) => setSite(e.target.value)}>
                    <option value="">(none)</option>
                    {clientSites.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input
                    type="text"
                    style={styles.input}
                    placeholder="Optional"
                    value={site}
                    onChange={(e) => setSite(e.target.value)}
                  />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <label style={styles.label}>Delivery Date *</label>
                <input
                  type="date"
                  style={styles.input}
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  required
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
                  <span style={styles.labelHint}> (optional)</span>
                </label>
                <input
                  type="text"
                  style={styles.input}
                  placeholder="Leave blank if not used"
                  value={indentNo}
                  onChange={(e) => setIndentNo(e.target.value)}
                />
              </div>
            </div>

            {/* ── Items ── */}
            <label style={{ ...styles.label, marginTop: "0.75rem" }}>Items *</label>

            {/* Bulk Item Type apply — saves picking the same catalog row N times. */}
            {items.length > 1 && (
              <div style={{
                display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap",
                padding: "0.5rem 0.65rem", marginBottom: "0.5rem",
                borderRadius: 8, border: "1px solid #e8edf3", backgroundColor: "#f8faff",
              }}>
                <span style={{ fontSize: "0.8rem", color: "#1a2332" }}>
                  Apply same Item Type to all {items.length} rows:
                </span>
                <div style={{ flex: "1 1 220px", maxWidth: 280 }}>
                  <SearchableItemTypeSelect
                    items={itemTypes}
                    value=""
                    onChange={(newId, picked) => {
                      if (!newId) return;
                      const newIdNum = parseInt(newId);
                      const next = items.map((row) => {
                        const updated = { ...row, itemTypeId: newIdNum };
                        if (picked?.uom) updated.unit = picked.uom;
                        return updated;
                      });
                      setItems(next);
                    }}
                    placeholder="— pick to apply to all —"
                    style={{ padding: "0.45rem 0.55rem", fontSize: "0.82rem" }}
                  />
                </div>
              </div>
            )}

            <div ref={containerRef} style={styles.itemsContainer}>
              {items.map((item, idx) => (
                <div key={idx} style={styles.itemRow}>
                  <div style={styles.itemIndex}>{idx + 1}</div>
                  <div style={{ width: 180, flexShrink: 0 }}>
                    <SearchableItemTypeSelect
                      items={itemTypes}
                      value={item.itemTypeId || ""}
                      onChange={(newId, picked) => {
                        const next = [...items];
                        next[idx].itemTypeId = newId ? parseInt(newId) : "";
                        if (picked && picked.uom) next[idx].unit = picked.uom;
                        setItems(next);
                      }}
                      placeholder="Item (optional)"
                      style={{ padding: "0.55rem 0.55rem", fontSize: "0.82rem" }}
                    />
                  </div>
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

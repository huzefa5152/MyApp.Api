import { useState, useRef, useEffect } from "react";
import { MdAdd, MdDelete } from "react-icons/md";
import LookupAutocomplete from "./LookupAutocomplete";
import SmartItemAutocomplete from "./SmartItemAutocomplete";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";
import { updateChallanItems, updateChallanPo } from "../api/challanApi";
import { getItemTypes } from "../api/itemTypeApi";
import { saveItemFbrDefaults } from "../api/lookupApi";
import { formStyles } from "../theme";

const colors = {
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  danger: "#dc3545",
  dangerLight: "#fff0f1",
  teal: "#00897b",
};

export default function ChallanEditForm({ challan, onClose, onSaved }) {
  const [items, setItems] = useState(
    challan.items.map((i) => ({
      id: i.id,
      itemTypeId: i.itemTypeId || "",
      description: i.description,
      quantity: i.quantity,
      unit: i.unit,
    }))
  );
  const [itemTypes, setItemTypes] = useState([]);
  const isNoPo = challan.status === "No PO";
  const [poNumber, setPoNumber] = useState(challan.poNumber || "");
  const [poDate, setPoDate] = useState(challan.poDate ? challan.poDate.substring(0, 10) : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    getItemTypes().then(({ data }) => setItemTypes(data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [items.length]);

  const handleItemChange = (index, field, value) => {
    const next = [...items];
    next[index][field] = value;
    setItems(next);
  };

  // Fires when user picks from the SmartItemAutocomplete dropdown.
  // Auto-fills description + unit, and remembers FBR metadata for future bills.
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const validItems = items.filter((i) => i.description.trim());
    if (validItems.length === 0) { setError("At least one item is required."); return; }
    setSaving(true);
    try {
      await updateChallanItems(challan.id, validItems.map((i) => ({ ...i, itemTypeId: i.itemTypeId || null })));
      if (isNoPo && poNumber.trim()) {
        await updateChallanPo(challan.id, { poNumber: poNumber.trim(), poDate: poDate ? new Date(poDate).toISOString() : null });
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to update.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: 800, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>Edit Challan #{challan.challanNumber} Items</h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={formStyles.body}>
            {error && <div style={styles.errorAlert}>{error}</div>}
            {isNoPo && (
              <div style={styles.poSection}>
                <p style={styles.poHint}>This challan has no PO. Add PO details below (optional — save without to keep "No PO" status).</p>
                <div style={styles.poRow}>
                  <div style={{ flex: 1 }}>
                    <label style={styles.label}>PO Number</label>
                    <input type="text" style={styles.input} placeholder="Enter PO number" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={styles.label}>PO Date</label>
                    <input type="date" style={styles.input} value={poDate} onChange={(e) => setPoDate(e.target.value)} />
                  </div>
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
                        if (picked) {
                          if (!next[idx].description?.trim()) next[idx].description = picked.name;
                          if (picked.uom) next[idx].unit = picked.uom;
                        }
                        setItems(next);
                      }}
                      placeholder="Pick item…"
                      style={{ padding: "0.55rem 0.55rem", fontSize: "0.82rem" }}
                    />
                  </div>
                  <div style={{ flex: 2, minWidth: 0 }}>
                    <SmartItemAutocomplete
                      companyId={challan.companyId}
                      value={item.description}
                      onChange={(val) => handleItemChange(idx, "description", val)}
                      onPick={(picked) => handleItemPick(idx, picked)}
                      style={{ ...styles.input, padding: "0.55rem 0.5rem", fontSize: "0.82rem" }}
                      placeholder="Search FBR or type…"
                    />
                  </div>
                  <div style={{ width: 58, flexShrink: 0 }}>
                    <input type="number" min={1} style={{ ...styles.input, textAlign: "center", padding: "0.55rem 0.25rem" }} value={item.quantity} onChange={(e) => handleItemChange(idx, "quantity", parseInt(e.target.value) || 1)} />
                  </div>
                  <div style={{ width: 90, flexShrink: 0 }}>
                    <LookupAutocomplete label="Unit" endpoint="/lookup/units" value={item.unit} onChange={(val) => handleItemChange(idx, "unit", val)} />
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    {items.length > 1 && (
                      <button type="button" style={styles.removeBtn} onClick={() => removeItem(idx)}><MdDelete size={16} /></button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button type="button" style={styles.addItemBtn} onClick={addItem}><MdAdd size={16} /> Add Item</button>
          </div>
          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...formStyles.button, ...formStyles.submit, opacity: saving ? 0.6 : 1 }} disabled={saving}>
              {saving ? "Saving..." : "Update Items"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles = {
  errorAlert: { backgroundColor: colors.dangerLight, color: colors.danger, padding: "0.65rem 1rem", borderRadius: 8, marginBottom: "1rem", fontWeight: 500, border: `1px solid ${colors.danger}30`, fontSize: "0.85rem" },
  itemsContainer: { display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: 280, overflowY: "auto", paddingRight: 4 },
  itemRow: { display: "flex", gap: "0.4rem", alignItems: "flex-start", padding: "0.5rem", borderRadius: 10, border: `1px solid ${colors.cardBorder}`, backgroundColor: "#fafbfc", minWidth: 0 },
  itemIndex: { width: 22, paddingTop: "0.55rem", fontWeight: 700, fontSize: "0.82rem", color: colors.textSecondary, textAlign: "center", flexShrink: 0 },
  input: { width: "100%", padding: "0.55rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", boxSizing: "border-box" },
  removeBtn: { display: "flex", alignItems: "center", justifyContent: "center", padding: "0.4rem", marginTop: "0.3rem", borderRadius: 8, border: `1px solid ${colors.danger}25`, backgroundColor: colors.dangerLight, color: colors.danger, cursor: "pointer" },
  addItemBtn: { display: "inline-flex", alignItems: "center", gap: "0.3rem", marginTop: "0.6rem", padding: "0.4rem 0.9rem", borderRadius: 8, border: "none", backgroundColor: `${colors.teal}14`, color: colors.teal, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer" },
  poSection: { marginBottom: "1rem", padding: "0.75rem", borderRadius: 10, border: `1px solid #0d47a130`, backgroundColor: "#e3f2fd" },
  poHint: { margin: "0 0 0.5rem", fontSize: "0.82rem", color: "#0d47a1", fontWeight: 500 },
  poRow: { display: "flex", gap: "0.75rem", flexWrap: "wrap" },
  label: { display: "block", marginBottom: 4, fontWeight: 600, fontSize: "0.82rem", color: colors.textSecondary },
};

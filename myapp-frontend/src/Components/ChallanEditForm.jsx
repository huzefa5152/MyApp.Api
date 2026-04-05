import { useState, useRef, useEffect } from "react";
import { MdAdd, MdDelete } from "react-icons/md";
import LookupAutocomplete from "./LookupAutocomplete";
import { updateChallanItems } from "../api/challanApi";
import { getItemTypes } from "../api/itemTypeApi";
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
    if (validItems.some((i) => !i.itemTypeId)) { setError("Select an item type for all items."); return; }
    setSaving(true);
    try {
      await updateChallanItems(challan.id, validItems);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to update items.");
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
            <div ref={containerRef} style={styles.itemsContainer}>
              {items.map((item, idx) => (
                <div key={idx} style={styles.itemRow}>
                  <div style={styles.itemIndex}>{idx + 1}</div>
                  <div style={{ width: 120, flexShrink: 0 }}>
                    <select
                      style={{ ...styles.input, padding: "0.55rem 0.35rem", fontSize: "0.82rem" }}
                      value={item.itemTypeId}
                      onChange={(e) => handleItemChange(idx, "itemTypeId", parseInt(e.target.value) || "")}
                    >
                      <option value="">Type...</option>
                      {itemTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 2, minWidth: 0 }}>
                    <LookupAutocomplete label="Description" endpoint="/lookup/items" value={item.description} onChange={(val) => handleItemChange(idx, "description", val)} />
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
};

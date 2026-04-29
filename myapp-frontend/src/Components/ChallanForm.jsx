import { useState, useRef, useEffect } from "react";
import { MdAdd, MdClose, MdDelete } from "react-icons/md";
import LookupAutocomplete from "./LookupAutocomplete";
import SmartItemAutocomplete from "./SmartItemAutocomplete";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";
import SelectDropdown from "./SelectDropdown";
import QuantityInput from "./QuantityInput";
import { getItemTypes } from "../api/itemTypeApi";
import { saveItemFbrDefaults } from "../api/lookupApi";
import { getAllUnits } from "../api/unitsApi";
import { formStyles, modalSizes } from "../theme";

const colors = {
  blue: "#0d47a1",
  blueLight: "#1565c0",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  danger: "#dc3545",
  dangerLight: "#fff0f1",
  success: "#28a745",
};

export default function ChallanForm({ onClose, onSaved, companyId }) {
  const [client, setClient] = useState(null);
  const [site, setSite] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [indentNo, setIndentNo] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [items, setItems] = useState([
    { itemTypeId: "", description: "", quantity: 1, unit: "" },
  ]);
  const [itemTypes, setItemTypes] = useState([]);
  // Units list with the AllowsDecimalQuantity flag — drives whether each
  // row's quantity input accepts decimals or only whole numbers. Loaded
  // once on mount; cheap (≤50 rows) and the operator can flip flags via
  // the Units admin page (changes only need a re-open of this form).
  const [units, setUnits] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const itemsContainerRef = useRef(null);

  useEffect(() => {
    getItemTypes().then(({ data }) => setItemTypes(data)).catch(() => {});
    getAllUnits().then(({ data }) => setUnits(data)).catch(() => setUnits([]));
  }, []);

  useEffect(() => {
    if (itemsContainerRef.current) {
      itemsContainerRef.current.scrollTop = itemsContainerRef.current.scrollHeight;
    }
  }, [items]);

  const handleItemChange = (index, field, value) => {
    const newItems = [...items];
    newItems[index][field] = value;
    setItems(newItems);
  };

  // Fires when user picks from the SmartItemAutocomplete dropdown
  // (either a SAVED local item or an FBR catalog entry).
  // Fills description + unit in one shot, and also remembers the HS code /
  // sale type per description so the bill can auto-fill them later.
  const handleItemPick = (index, picked) => {
    const newItems = [...items];
    if (picked.name) newItems[index].description = picked.name;
    if (picked.uom) newItems[index].unit = picked.uom;
    setItems(newItems);

    // Remember FBR defaults for this description so future bills auto-fill
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
    const lastItem = items[items.length - 1];
    if (!lastItem.description.trim()) {
      setError("Please fill the description of the current item before adding a new one.");
      return;
    }
    setError("");
    setItems([...items, { itemTypeId: "", description: "", quantity: 1, unit: "" }]);
  };

  const removeItem = (index) => setItems(items.filter((_, i) => i !== index));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setError("");

    const validItems = items.filter((item) => item.description.trim());
    if (validItems.length === 0) {
      setError("Please add at least one item with a description.");
      return;
    }
    if (!client) {
      setError("Please select a client.");
      return;
    }

    setSaving(true);
    try {
      await onSaved({
        clientId: client.id,
        clientName: client.label,
        site: site || null,
        poNumber: poNumber.trim(),
        poDate: poDate ? new Date(poDate).toISOString() : null,
        indentNo: indentNo.trim() || null,
        deliveryDate: deliveryDate ? new Date(deliveryDate).toISOString() : null,
        items: validItems.map((i) => ({
          ...i,
          itemTypeId: i.itemTypeId || null,
          // parseFloat preserves decimals (12.5 KG, 0.0004 Carat). The
          // QuantityInput already coerces correctly per UOM, this is just
          // defensive in case a string slips through.
          quantity: typeof i.quantity === "number" ? i.quantity : (parseFloat(i.quantity) || 1),
        })),
      });
      onClose();
    } catch (err) {
      if (err.response?.data?.error) setError(err.response.data.error);
      else if (err.message) setError(err.message);
      else setError("Something went wrong.");
      setSaving(false);
    }
  };

  const isDisabled = items.some((i) => !i.description.trim()) || !client || saving;

  // Backdrop click is intentionally a no-op — the user can lose minutes
  // of typed data with one stray click otherwise. Use the X in the
  // header or the Cancel button to dismiss.
  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.xl}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>Create Delivery Challan</h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={formStyles.body}>
            {error && <div style={styles.errorAlert}>{error}</div>}

            {/* Header row: Client / Site / Delivery Date — same layout as
                Edit Challan so operators see identical shape on both flows.
                Site is dropdown when the picked client has presets, free-text
                otherwise so one-offs still work. */}
            <div style={styles.row}>
              <div style={{ flex: 2, minWidth: 220 }}>
                <SelectDropdown
                  label="Client"
                  endpoint={`/clients/company/${companyId}`}
                  value={client}
                  onChange={(val) => { setClient(val); setSite(""); }}
                  placeholder="Choose client"
                  className=""
                />
              </div>
              <div style={{ flex: 1.5, minWidth: 180 }}>
                <label style={styles.label}>Site / Department</label>
                {(() => {
                  const clientSites = client?.site
                    ? client.site.split(";").map((s) => s.trim()).filter(Boolean)
                    : [];
                  return clientSites.length > 0 ? (
                    <select
                      style={styles.input}
                      value={site}
                      onChange={(e) => setSite(e.target.value)}
                    >
                      <option value="">(none)</option>
                      {clientSites.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      style={styles.input}
                      placeholder={client ? "Optional" : "Pick a client first"}
                      value={site}
                      onChange={(e) => setSite(e.target.value)}
                      disabled={!client}
                    />
                  );
                })()}
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <label style={styles.label}>Delivery Date</label>
                <input type="date" style={styles.input} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
              </div>
            </div>

            {/* PO row: Number + Date + Indent No — flex weights match
                ChallanEditForm's PO row so Add and Edit look identical. */}
            <div style={styles.row}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <label style={styles.label}>PO Number</label>
                <input type="text" style={styles.input} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="Enter PO number" />
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={styles.label}>PO Date</label>
                <input type="date" style={styles.input} value={poDate} onChange={(e) => setPoDate(e.target.value)} />
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <label style={styles.label}>
                  Indent No <span style={{ color: "#5f6d7e", fontWeight: 400 }}>(optional)</span>
                </label>
                <input
                  type="text"
                  style={styles.input}
                  value={indentNo}
                  onChange={(e) => setIndentNo(e.target.value)}
                  placeholder="Enter indent number"
                />
              </div>
            </div>

            <div style={{ marginTop: "0.25rem" }}>
              <label style={{ ...styles.label, marginBottom: "0.5rem" }}>Items</label>

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
                        const newItems = items.map((row) => {
                          const next = { ...row, itemTypeId: newIdNum };
                          if (picked?.uom) next.unit = picked.uom;
                          return next;
                        });
                        setItems(newItems);
                      }}
                      placeholder="— pick to apply to all —"
                      style={{ padding: "0.45rem 0.55rem", fontSize: "0.82rem" }}
                    />
                  </div>
                </div>
              )}

              <div ref={itemsContainerRef} style={styles.itemsContainer}>
                {items.map((item, idx) => (
                  <div key={idx} style={styles.itemRow}>
                    <div style={styles.itemIndex}>{idx + 1}</div>

                    {/* Item Type — searchable dropdown; picking one auto-fills UOM only (user types description) */}
                    <div style={{ width: 180, flexShrink: 0 }}>
                      <SearchableItemTypeSelect
                        items={itemTypes}
                        value={item.itemTypeId || ""}
                        onChange={(newId, picked) => {
                          const newItems = [...items];
                          newItems[idx].itemTypeId = newId ? parseInt(newId) : "";
                          // Only auto-fill UOM from the catalog — description stays user-entered
                          if (picked && picked.uom) newItems[idx].unit = picked.uom;
                          setItems(newItems);
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

                    {/* Wider column so 4-place decimals like "0.0004" or
                        "1234.5678" stay fully visible alongside the input
                        spinners. Right-aligned reads more naturally for
                        numbers than centred. */}
                    <div style={{ width: 130, flexShrink: 0 }}>
                      <QuantityInput
                        value={item.quantity}
                        onChange={(val) => handleItemChange(idx, "quantity", val)}
                        unit={item.unit}
                        units={units}
                        style={{ ...styles.input, textAlign: "right", padding: "0.55rem 0.5rem" }}
                      />
                    </div>

                    <div style={{ width: 180, flexShrink: 0 }}>
                      <LookupAutocomplete label="Unit" endpoint="/lookup/units" value={item.unit} onChange={(val) => handleItemChange(idx, "unit", val)} />
                    </div>

                    <div style={{ flexShrink: 0 }}>
                      {idx !== 0 && (
                        <button type="button" style={styles.removeBtn} onClick={() => removeItem(idx)} title="Remove item"><MdDelete size={16} /></button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <button type="button" style={styles.addItemBtn} onClick={addItem}><MdAdd size={16} /> Add Item</button>
            </div>
          </div>

          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...formStyles.button, ...formStyles.submit, opacity: isDisabled ? 0.6 : 1 }} disabled={isDisabled}>{saving ? "Saving..." : "Save Challan"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles = {
  row: { display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" },
  label: { display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem", color: colors.textSecondary },
  input: { width: "100%", padding: "0.55rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", transition: "border-color 0.25s", boxSizing: "border-box" },
  errorAlert: { backgroundColor: colors.dangerLight, color: colors.danger, padding: "0.65rem 1rem", borderRadius: 8, marginBottom: "1rem", fontWeight: 500, border: `1px solid ${colors.danger}30`, fontSize: "0.85rem" },
  itemsContainer: { display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: 220, overflowY: "auto", overflowX: "hidden", paddingRight: 4 },
  itemRow: { display: "flex", gap: "0.4rem", alignItems: "flex-start", padding: "0.5rem", borderRadius: 10, border: `1px solid ${colors.cardBorder}`, backgroundColor: "#fafbfc", minWidth: 0 },
  itemIndex: { width: 22, paddingTop: "0.55rem", fontWeight: 700, fontSize: "0.82rem", color: colors.textSecondary, textAlign: "center", flexShrink: 0 },
  removeBtn: { display: "flex", alignItems: "center", justifyContent: "center", padding: "0.4rem", marginTop: "0.3rem", borderRadius: 8, border: `1px solid ${colors.danger}25`, backgroundColor: colors.dangerLight, color: colors.danger, cursor: "pointer", transition: "background-color 0.2s", flexShrink: 0 },
  addItemBtn: { display: "inline-flex", alignItems: "center", gap: "0.3rem", marginTop: "0.6rem", padding: "0.4rem 0.9rem", borderRadius: 8, border: "none", backgroundColor: `${colors.teal}14`, color: colors.teal, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", transition: "background-color 0.2s" },
};

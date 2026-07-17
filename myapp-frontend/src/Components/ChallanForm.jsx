import { useState, useRef, useEffect } from "react";
import { MdAdd, MdClose, MdDelete } from "react-icons/md";
import LookupAutocomplete from "./LookupAutocomplete";
import SmartItemAutocomplete from "./SmartItemAutocomplete";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";
import SelectDropdown from "./SelectDropdown";
import DivisionSelect from "./DivisionSelect";
import QuantityInput from "./QuantityInput";
import { usePermissions } from "../contexts/PermissionsContext";
import { saveItemFbrDefaults } from "../api/lookupApi";
import { getAllUnits } from "../api/unitsApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getNonInventoryItemsByCompany } from "../api/nonInventoryItemApi";
import { formStyles, modalSizes } from "../theme";
import AttachmentManager from "./AttachmentManager";

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

export default function ChallanForm({ onClose, onSaved, companyId, defaultDivisionId }) {
  const [client, setClient] = useState(null);
  const [site, setSite] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [indentNo, setIndentNo] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const { has } = usePermissions();
  // New challans default to the division the page is currently filtered to
  // (so "filter to a division → New Challan" lands in that division).
  const [divisionId, setDivisionId] = useState(defaultDivisionId ? String(defaultDivisionId) : "");
  const [items, setItems] = useState([
    { description: "", quantity: 1, unit: "", itemTypeId: null, nonInventoryItemId: null },
  ]);
  const [itemTypes, setItemTypes] = useState([]);
  const [nonInvItems, setNonInvItems] = useState([]);
  // Units list with the AllowsDecimalQuantity flag — drives whether each
  // row's quantity input accepts decimals or only whole numbers. Loaded
  // once on mount; cheap (≤50 rows) and the operator can flip flags via
  // the Units admin page (changes only need a re-open of this form).
  const [units, setUnits] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const itemsContainerRef = useRef(null);
  const attachmentRef = useRef(null);

  useEffect(() => {
    getAllUnits().then(({ data }) => setUnits(data)).catch(() => setUnits([]));
  }, []);
  useEffect(() => {
    getItemTypes(companyId).then(({ data }) => setItemTypes(data || [])).catch(() => setItemTypes([]));
  }, [companyId]);
  // Per-company Non-Inventory Items (GL-account shortcut lines: Freight, Discount, …).
  // A company with GL off / no items resolves to [] and the picker shows none.
  useEffect(() => {
    if (!companyId) { setNonInvItems([]); return; }
    getNonInventoryItemsByCompany(companyId, true).then(({ data }) => setNonInvItems(data || [])).catch(() => setNonInvItems([]));
  }, [companyId]);

  // Picking an item type only TAGS the challan line (records ItemTypeId); it must
  // NOT overwrite the typed description/unit. Description auto-fill from an item
  // type is reserved for Invoice (FBR-classification) mode. Mutually exclusive
  // with a non-inventory item — clear any non-inv binding.
  const pickItemType = (index, newId) => {
    const next = [...items];
    next[index] = { ...next[index], itemTypeId: newId ? parseInt(newId) : null, nonInventoryItemId: null };
    setItems(next);
  };

  // Non-Inventory pick — mutually exclusive with an item type. Records the
  // non-inv id, clears any itemTypeId, and prefills description / unit only
  // when empty (challans are qty-only, so ignore price).
  const pickNonInventory = (index, n) => {
    setItems((prev) => prev.map((it, i) => {
      if (i !== index) return it;
      if (!n) return { ...it, nonInventoryItemId: null };
      const next = { ...it, nonInventoryItemId: n.id, itemTypeId: null };
      if (!it.description?.trim()) next.description = n.defaultLineDescription || n.name || "";
      if (!it.unit?.trim()) next.unit = n.unitName || "";
      return next;
    }));
  };

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
    setItems([...items, { description: "", quantity: 1, unit: "", itemTypeId: null, nonInventoryItemId: null }]);
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
      const saved = await onSaved({
        clientId: client.id,
        divisionId: divisionId ? parseInt(divisionId) : null,
        clientName: client.label,
        site: site || null,
        poNumber: poNumber.trim(),
        poDate: poDate ? new Date(poDate).toISOString() : null,
        indentNo: indentNo.trim() || null,
        deliveryDate: deliveryDate ? new Date(deliveryDate).toISOString() : null,
        items: validItems.map((i) => ({
          ...i,
          // Item Type is optional on a challan line. When the operator picks
          // one it persists on DeliveryItem.ItemTypeId; otherwise null and FBR
          // classification can still happen later on the Invoices tab.
          itemTypeId: i.itemTypeId || null,
          // Non-Inventory line (Freight / Discount / …) — mutually exclusive
          // with itemTypeId; optional.
          nonInventoryItemId: i.nonInventoryItemId || null,
          // parseFloat preserves decimals (12.5 KG, 0.0004 Carat). The
          // QuantityInput already coerces correctly per UOM, this is just
          // defensive in case a string slips through.
          quantity: typeof i.quantity === "number" ? i.quantity : (parseFloat(i.quantity) || 1),
        })),
      });
      // Upload any attachments staged before the challan had an id — must run
      // BEFORE onClose() unmounts this form (and its staged files with it).
      try {
        if (saved?.id) await attachmentRef.current?.flush(saved.id);
      } catch { /* attachments are best-effort — the challan is already saved */ }
      onClose();
    } catch (err) {
      // Server-supplied user-friendly message wins; otherwise show a
      // friendly stable string. Bare err.message from axios is
      // "Network Error" / "Request failed with status code 500" —
      // not user-facing, so we don't surface it.
      const serverMsg = err.response?.data?.error || err.response?.data?.message;
      if (serverMsg) setError(serverMsg);
      else if (!err.response) setError("Could not reach the server. Please check your connection and try again.");
      else setError("Could not save the challan. Please try again or contact an administrator.");
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
              {has("divisions.manage.view") && (
                <DivisionSelect companyId={companyId} value={divisionId} onChange={setDivisionId} mode="select" label={<>Division <span style={{ color: "#5f6d7e", fontWeight: 400 }}>(optional)</span></>} labelStyle={styles.label} style={styles.input} wrapStyle={{ flex: 1, minWidth: 150 }} />
              )}
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

              {/* Each line has an optional Item Type (its own column), then
                  description / qty / unit. Item Type can still be (re)classified
                  on the Invoices tab when preparing the bill for FBR. */}

              <div ref={itemsContainerRef} style={styles.itemsContainer}>
                {items.map((item, idx) => (
                  <div key={idx} style={styles.itemRow}>
                    <div style={styles.itemIndex}>{idx + 1}</div>

                    <div style={{ width: 190, flexShrink: 0 }}>
                      <SearchableItemTypeSelect
                        divisionId={divisionId}
                        items={itemTypes}
                        value={item.itemTypeId || ""}
                        onChange={(newId, picked) => pickItemType(idx, newId, picked)}
                        nonInventoryItems={nonInvItems}
                        nonInventoryValue={item.nonInventoryItemId || ""}
                        onPickNonInventory={(n) => pickNonInventory(idx, n)}
                        placeholder="— item type (optional) —"
                        style={{ padding: "0.3rem 0.5rem", fontSize: "0.78rem" }}
                      />
                    </div>

                    <div style={{ flex: 2, minWidth: 0 }}>
                      <LookupAutocomplete
                        label="Description"
                        endpoint="/lookup/items"
                        value={item.description}
                        onChange={(val) => handleItemChange(idx, "description", val)}
                        multiline
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

            {/* entityId=null — files are staged client-side and flushed against
                the new challan id after save (this form is create-only). */}
            <AttachmentManager
              ref={attachmentRef}
              companyId={companyId}
              entityType="DeliveryChallan"
              entityId={null}
              mode="edit"
            />
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

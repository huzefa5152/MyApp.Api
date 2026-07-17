import { useState } from "react";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";

/**
 * BulkItemTypeBar — a one-shot "apply the same Item Type to every line" toolbar,
 * shared by every multi-line document form. Shows ONLY when there are 2+ lines.
 * The bulk picker RETAINS the last applied selection so the operator can see
 * what was applied.
 *
 * Two ways to drive it:
 *
 * A) Array model (most forms) — pass `items` + `setItems`; the bar computes the
 *    apply/clear over the array. Each line must carry `itemTypeId` /
 *    `nonInventoryItemId`. Optional `applyFields(picked)` sets extra per-line
 *    fields (uom / hsCode / accountId …) to match the form's per-row pick.
 *
 * B) Callback model (bill/invoice forms with keyed state) — pass `itemCount`
 *    plus `onApplyItemType(id, picked, mode)`, `onApplyNonInv(n, mode)`,
 *    `onClearAll(mode)` and `anyTagged`. The bar renders the UI and calls back.
 *
 * `mode` is "all" | "empty" (fill only rows without an item type).
 */
export default function BulkItemTypeBar({
  itemTypes, nonInventoryItems = [], divisionId = null,
  // Array model
  items, setItems, applyFields, applyNonInvFields, clearFields,
  // Callback model
  itemCount, onApplyItemType, onApplyNonInv, onClearAll, anyTagged: anyTaggedProp,
  label = "Apply same Item Type to:",
}) {
  const count = itemCount ?? (items?.length || 0);
  const [mode, setMode] = useState("all");
  // Retained bulk selection (so the dropdown shows what was applied).
  const [selId, setSelId] = useState("");
  const [selNonInv, setSelNonInv] = useState("");

  if (count < 2) return null;

  // ── Array-model defaults (used when no explicit callback is supplied) ──
  const isEmpty = (r) => !r.itemTypeId && !r.nonInventoryItemId;
  const matchArr = (r) => mode === "all" || isEmpty(r);
  const arrApplyItemType = (id, picked) =>
    setItems((prev) => prev.map((r) => (matchArr(r)
      ? { ...r, itemTypeId: id, nonInventoryItemId: null, ...(applyFields ? applyFields(picked) : {}) } : r)));
  const arrApplyNonInv = (n) =>
    setItems((prev) => prev.map((r) => (matchArr(r)
      ? { ...r, nonInventoryItemId: n.id, itemTypeId: null, ...(applyNonInvFields ? applyNonInvFields(n) : {}) } : r)));
  const arrClear = () =>
    setItems((prev) => prev.map((r) => (matchArr(r)
      ? { ...r, itemTypeId: null, nonInventoryItemId: null, ...(clearFields ? clearFields() : {}) } : r)));
  const arrAnyTagged = (items || []).some((r) => r.itemTypeId || r.nonInventoryItemId);

  const anyTagged = anyTaggedProp ?? arrAnyTagged;

  const doClear = () => { if (onClearAll) onClearAll(mode); else arrClear(); };

  // ── Picker handlers (retain the selection) ──
  const handlePick = (newId, picked) => {
    // Clearing the picker (× icon) clears the item type from every row in
    // scope — same as the "Clear all" button.
    if (!newId) { setSelId(""); setSelNonInv(""); doClear(); return; }
    const id = parseInt(newId);
    setSelId(id); setSelNonInv("");
    if (onApplyItemType) onApplyItemType(id, picked, mode); else arrApplyItemType(id, picked);
  };
  const handlePickNonInv = (n) => {
    if (!n) { setSelId(""); setSelNonInv(""); doClear(); return; }
    setSelNonInv(n.id); setSelId("");
    if (onApplyNonInv) onApplyNonInv(n, mode); else arrApplyNonInv(n);
  };
  const handleClear = () => { setSelId(""); setSelNonInv(""); doClear(); };

  return (
    <div style={styles.bar}>
      <span style={styles.label}>{label}</span>
      <select value={mode} onChange={(e) => setMode(e.target.value)} style={styles.modeSel}>
        <option value="all">All {count} rows</option>
        <option value="empty">Only empty rows</option>
      </select>
      <div style={{ flex: "1 1 220px", maxWidth: 300 }}>
        <SearchableItemTypeSelect
          divisionId={divisionId}
          items={itemTypes}
          value={selId}
          nonInventoryItems={nonInventoryItems}
          nonInventoryValue={selNonInv}
          onPickNonInventory={(n) => handlePickNonInv(n)}
          onChange={(newId, picked) => handlePick(newId, picked)}
          placeholder={mode === "all" ? "— pick to apply to all —" : "— pick to fill empty rows —"}
          style={{ padding: "0.3rem 0.5rem", fontSize: "0.78rem" }}
        />
      </div>
      <button
        type="button"
        style={{ ...styles.clearBtn, ...(anyTagged ? {} : styles.clearDisabled) }}
        onClick={handleClear}
        disabled={!anyTagged}
        title="Drop the Item Type from every row"
      >
        Clear all
      </button>
    </div>
  );
}

const colors = { textPrimary: "#1a2332", cardBorder: "#e8edf3", danger: "#dc3545" };
const styles = {
  bar: {
    display: "flex", alignItems: "center", gap: "0.65rem", flexWrap: "wrap",
    padding: "0.55rem 0.85rem", marginBottom: "0.6rem", borderRadius: 8,
    border: `1px solid ${colors.cardBorder}`, backgroundColor: "#f8faff",
  },
  label: { fontSize: "0.82rem", color: colors.textPrimary, fontWeight: 600 },
  modeSel: {
    padding: "0.35rem 0.5rem", fontSize: "0.8rem", maxWidth: 170,
    borderRadius: 6, border: `1px solid #d0d7e2`, backgroundColor: "#fff", color: colors.textPrimary,
  },
  clearBtn: {
    display: "inline-flex", alignItems: "center", gap: "0.3rem",
    padding: "0.35rem 0.7rem", borderRadius: 6, border: `1px solid ${colors.danger}`,
    backgroundColor: "#fff", color: colors.danger, fontSize: "0.78rem",
    fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
  },
  clearDisabled: { opacity: 0.45, cursor: "not-allowed" },
};

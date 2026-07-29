import { useState, useEffect, useRef } from "react";
import { MdAdd, MdDelete, MdContentPaste, MdRepeat } from "react-icons/md";
import LookupAutocomplete from "./LookupAutocomplete";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";
import QuantityInput from "./QuantityInput";

/**
 * Shared line-item entry for the sales module (Quote / Order / Challan).
 *
 * CONTROLLED: the parent owns `items` (an array of row objects) and its exact
 * row shape via `makeBlankItem`. This editor only edits the common fields
 * (itemTypeId, description, quantity, unit, unitPrice) and preserves every
 * other field the parent stamped on a row (id, salesOrderItemId, delivered, …)
 * by spreading. Totals / tax / submit stay in the parent.
 *
 * Responsive: a dense table on desktop, tap-friendly stacked cards below
 * `narrowBreakpoint` (default 760px) — no horizontal scroll on phones.
 *
 * Fast desktop entry:
 *   - Enter in any row field commits + advances: on the last row it appends a
 *     fresh line and focuses its description; otherwise it jumps to the next
 *     row's description. So "type · Enter · type · Enter" flies down the list.
 *   - "Repeat last" clones the previous line's item-type / unit / price into a
 *     new blank row (description + qty cleared) — for many similar items.
 *   - "Paste list" turns pasted lines into rows (tab/comma → qty, price).
 *
 * Config flags let each form show only the columns it needs:
 *   - showItemType + itemTypes  → the Item Type picker + bulk-apply bar (Quote/Order)
 *   - showUnitPrice             → the Unit Price + Amount columns (Quote/Bill)
 *   - getRate                   → last-billed-rate auto-fill on the price (Quote/Bill)
 */
export default function LineItemsEditor({
  items,
  onItemsChange,
  makeBlankItem,
  units = [],
  showItemType = false,
  itemTypes = [],
  itemTypePlaceholder = "— item type (optional) —",
  bulkApply,
  canCreateItemType = false,
  onAddItemType,
  showUnitPrice = false,
  currency = "Rs",
  getRate,
  isRowLocked,
  rowLockHint,
  // Optional per-row minimum quantity → floors the qty spinner (e.g. the
  // already-delivered qty on a Sales Order line, so it can't step below it).
  getRowMin,
  itemsLabel = "Items",
  itemsHint,
  enablePaste = true,
  enableRepeatLast = true,
  narrowBreakpoint = 760,
}) {
  const showBulk = (bulkApply ?? showItemType) && showItemType;
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < narrowBreakpoint
  );
  const [bulkApplyMode, setBulkApplyMode] = useState("all");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const rateTimers = useRef({});
  const descRefs = useRef({});
  const pendingFocus = useRef(null);
  // Latest items, readable from async callbacks (debounced rate fetch) without
  // capturing a stale closure — this is a controlled component, so we can't use
  // a functional setState to reach current state.
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; });

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < narrowBreakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [narrowBreakpoint]);

  // After a row is added/inserted we stash the index to focus; this runs post-
  // render (once the new description input exists) and focuses it exactly once.
  useEffect(() => {
    if (pendingFocus.current == null) return;
    const el = descRefs.current[pendingFocus.current];
    if (el) el.focus();
    pendingFocus.current = null;
  });

  const requestFocus = (idx) => { pendingFocus.current = idx; };

  const setItem = (idx, patch) =>
    onItemsChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  // Picking an item type only TAGS the row (records ItemTypeId) — it must not
  // overwrite the operator's typed description/unit (matches Quote/Order).
  const pickItemType = (idx, newId) =>
    setItem(idx, { itemTypeId: newId ? parseInt(newId) : null });

  const applyItemTypeToAll = (newId) => {
    if (!newId) return;
    const id = parseInt(newId);
    onItemsChange(
      items.map((it) => (bulkApplyMode === "empty" && it.itemTypeId ? it : { ...it, itemTypeId: id }))
    );
  };
  const clearAllItemTypes = () => onItemsChange(items.map((it) => ({ ...it, itemTypeId: null })));

  const lineTotal = (it) =>
    Math.round((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0) * 100) / 100;

  // Auto-fill price from the item's last billed rate. Only fills when the
  // row's price is still 0 so it never clobbers a typed price; always sets the
  // hint. No-op unless the parent supplied `getRate`.
  const fetchRate = async (idx, description) => {
    if (!getRate || !description?.trim()) return;
    try {
      const res = await getRate(description);
      if (res && res.lastUnitPrice != null) {
        onItemsChange(
          itemsRef.current.map((it, i) => {
            if (i !== idx) return it;
            return !it.unitPrice || Number(it.unitPrice) === 0
              ? { ...it, unitPrice: res.lastUnitPrice, rateHint: res.hint || "" }
              : { ...it, rateHint: res.hint || "" };
          })
        );
      }
    } catch { /* no suggestion */ }
  };

  const handleDescChange = (idx, val) => {
    setItem(idx, { description: val });
    if (!getRate) return;
    clearTimeout(rateTimers.current[idx]);
    rateTimers.current[idx] = setTimeout(() => fetchRate(idx, val), 600);
  };

  const addItem = (seed) => {
    const next = [...items, { ...makeBlankItem(), ...(seed || {}) }];
    onItemsChange(next);
    requestFocus(next.length - 1);
  };

  // Add-button guard: don't append a second blank while the current last row
  // has no description — focus it instead so the operator finishes it first.
  const addGuarded = () => {
    const last = items[items.length - 1];
    if (last && !String(last.description || "").trim()) {
      const el = descRefs.current[items.length - 1];
      if (el) el.focus();
      return;
    }
    addItem();
  };

  const removeItem = (idx) => onItemsChange(items.filter((_, i) => i !== idx));

  // Enter anywhere in a row: last row + filled description → append & focus the
  // new line; otherwise hop to the next row's description.
  const commitAndAdvance = (idx) => {
    if (idx === items.length - 1) {
      if (String(items[idx].description || "").trim()) addItem();
      else { const el = descRefs.current[idx]; if (el) el.focus(); }
    } else {
      const el = descRefs.current[idx + 1];
      if (el) el.focus();
    }
  };

  // Duplicate the last line — copies item type, description, quantity, unit and
  // (when shown) unit price into a fresh row. No-op when the last row has no
  // description yet (nothing to repeat) — focus it instead.
  const canRepeat = items.length > 0 && !!String(items[items.length - 1]?.description || "").trim();
  const repeatLast = () => {
    if (!canRepeat) {
      const el = descRefs.current[items.length - 1];
      if (el) el.focus();
      return;
    }
    const last = items[items.length - 1];
    const seed = {
      itemTypeId: last.itemTypeId ?? null,
      description: last.description || "",
      quantity: last.quantity,
      unit: last.unit || "",
    };
    if (showUnitPrice) seed.unitPrice = last.unitPrice || 0;
    if (last.rateHint) seed.rateHint = last.rateHint;
    addItem(seed);
  };

  // Parse pasted lines into rows. Each non-empty line becomes a row. Columns are
  // tab- (preferred, e.g. an Excel paste) or comma-separated in the fixed order
  //   description, quantity, unit, unit price
  // where quantity/price are numeric and unit is the non-numeric token between
  // them. The unit-price column is read only when this document shows prices
  // (Quote/Bill), never for a Sales Order / Challan. The trailing measurement
  // block is optional per field — "desc, qty, unit, price", "desc, qty, unit",
  // "desc, qty, price", "desc, qty" and a bare "desc" all read correctly. A
  // number embedded in the description (a size like 12mm or 1/2") is left alone
  // because only whole delimited cells at the END are peeled as measurements.
  const applyPaste = () => {
    const lines = pasteText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { setPasteOpen(false); setPasteText(""); return; }
    const isNum = (s) => /^[\d,]+(\.\d+)?$/.test(s);   // pure number (rejects "12mm", "1/2\"")
    const num = (s) => parseFloat(s.replace(/,/g, ""));
    const parsed = lines.map((line) => {
      const row = makeBlankItem();
      const parts = (line.includes("\t") ? line.split("\t") : line.split(","))
        .map((p) => p.trim()).filter((p) => p !== "");
      if (parts.length <= 1) { row.description = line; return row; }
      const n = parts.length;
      // Peel the longest valid trailing tail matching qty [unit] [price], in
      // that order. `keep` = how many leading parts stay as the description.
      let tail = null;
      for (const len of (showUnitPrice ? [3, 2, 1] : [2, 1])) {
        if (n - len < 1) continue;            // always leave >=1 part for the description
        const t = parts.slice(n - len);
        if (len === 1 && isNum(t[0])) { tail = { keep: n - 1, qty: num(t[0]) }; break; }
        if (len === 2) {
          if (isNum(t[0]) && !isNum(t[1])) { tail = { keep: n - 2, qty: num(t[0]), unit: t[1] }; break; }
          if (showUnitPrice && isNum(t[0]) && isNum(t[1])) { tail = { keep: n - 2, qty: num(t[0]), price: num(t[1]) }; break; }
        }
        if (len === 3 && showUnitPrice && isNum(t[0]) && !isNum(t[1]) && isNum(t[2])) {
          tail = { keep: n - 3, qty: num(t[0]), unit: t[1], price: num(t[2]) }; break;
        }
      }
      if (tail) {
        row.description = parts.slice(0, tail.keep).join(" ").trim() || line;
        if (tail.qty != null) row.quantity = tail.qty;
        if (tail.unit) row.unit = tail.unit;
        if (showUnitPrice && tail.price != null) row.unitPrice = tail.price;
      } else {
        row.description = parts.join(" ").trim() || line;
      }
      return row;
    });
    // Replace a lone blank starter row; otherwise append.
    const base =
      items.length === 1 && !String(items[0].description || "").trim() ? [] : items;
    onItemsChange([...base, ...parsed]);
    setPasteText("");
    setPasteOpen(false);
  };

  const nonHsPlaceholderAll = bulkApplyMode === "all" ? "— pick to apply to all —" : "— pick to fill empty rows —";
  const rowLocked = (it) => (isRowLocked ? isRowLocked(it) : false);

  const priceInput = (item, idx, styleExtra) => (
    <input
      type="number"
      inputMode="decimal"
      min="0"
      step="0.01"
      style={{ ...s.cellInput, textAlign: "right", ...styleExtra }}
      value={item.unitPrice}
      onChange={(e) => setItem(idx, { unitPrice: e.target.value })}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitAndAdvance(idx); } }}
    />
  );

  return (
    <div>
      <div style={s.itemsHeaderBar}>
        <label style={{ ...s.label, margin: 0 }}>
          {itemsLabel}
          {itemsHint && <span style={s.hintText}> — {itemsHint}</span>}
        </label>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          {enableRepeatLast && (
            <button type="button" style={{ ...s.toolBtn, opacity: canRepeat ? 1 : 0.5, cursor: canRepeat ? "pointer" : "not-allowed" }} onClick={repeatLast} disabled={!canRepeat} title={canRepeat ? "Duplicate the last line (item type, description, qty, unit, price)" : "Fill the current line's description first"}>
              <MdRepeat size={14} /> Repeat last
            </button>
          )}
          {enablePaste && (
            <button type="button" style={s.toolBtn} onClick={() => setPasteOpen((v) => !v)} title="Paste a list of items (one per line)">
              <MdContentPaste size={14} /> Paste list
            </button>
          )}
          {canCreateItemType && onAddItemType && (
            <button type="button" style={s.inlineAddBtn} onClick={onAddItemType} title="Add a new item type to your catalog">
              <MdAdd size={14} /> New Item Type
            </button>
          )}
        </div>
      </div>

      {pasteOpen && (
        <div style={s.pastePanel}>
          <div style={s.pasteHintRow}>
            Paste one item per line, columns in order —{" "}
            {showUnitPrice ? "description, qty, unit, unit price" : "description, qty, unit"} (tab or comma
            separated; trailing columns optional).
          </div>
          <textarea
            style={s.pasteArea}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={showUnitPrice ? "Steel rod 12mm, 10, Pcs, 850\nCement bag, 5, Bag" : "Steel rod 12mm, 10, Pcs\nCement bag, 5, Bag"}
            rows={4}
            autoFocus
          />
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button type="button" style={s.pasteCancel} onClick={() => { setPasteOpen(false); setPasteText(""); }}>Cancel</button>
            <button type="button" style={s.pasteApply} onClick={applyPaste} disabled={!pasteText.trim()}>Add lines</button>
          </div>
        </div>
      )}

      {showBulk && items.length > 1 && (
        <div style={s.bulkApplyBar}>
          <span style={{ fontSize: "0.82rem", color: "#1a2332", fontWeight: 500 }}>Apply same Item Type to:</span>
          <select value={bulkApplyMode} onChange={(e) => setBulkApplyMode(e.target.value)} style={{ ...s.input, width: "auto", padding: "0.3rem 0.5rem", fontSize: "0.8rem", maxWidth: 160 }}>
            <option value="all">All {items.length} rows</option>
            <option value="empty">Only empty rows</option>
          </select>
          <div style={{ flex: "1 1 200px", maxWidth: 280 }}>
            <SearchableItemTypeSelect
              items={itemTypes}
              value={""}
              onChange={(newId) => applyItemTypeToAll(newId)}
              placeholder={nonHsPlaceholderAll}
              style={{ padding: "0.3rem 0.5rem", fontSize: "0.78rem" }}
            />
          </div>
          <button type="button" style={s.bulkClearBtn} onClick={clearAllItemTypes} disabled={!items.some((it) => it.itemTypeId)} title="Drop the Item Type binding from every row">
            Clear all
          </button>
        </div>
      )}

      {isNarrow ? (
        <div style={s.mcards}>
          {items.map((item, idx) => {
            const locked = rowLocked(item);
            const hint = rowLockHint ? rowLockHint(item) : null;
            return (
              <div style={s.mcard} key={idx}>
                <div style={s.mcardHead}>
                  <span style={s.mnum}>{idx + 1}</span>
                  {showItemType && (
                    <div style={{ flex: 1 }}>
                      <SearchableItemTypeSelect items={itemTypes} value={item.itemTypeId || ""} onChange={(newId) => pickItemType(idx, newId)} placeholder={itemTypePlaceholder} style={{ padding: "0.4rem 0.55rem", fontSize: "0.82rem" }} />
                    </div>
                  )}
                  {!showItemType && <div style={{ flex: 1 }} />}
                  {items.length > 1 && !locked && (
                    <button type="button" style={s.del} onClick={() => removeItem(idx)} title="Remove item"><MdDelete size={16} /></button>
                  )}
                </div>
                <LookupAutocomplete
                  label="Item description"
                  endpoint="/lookup/items"
                  value={item.description}
                  onChange={(v) => handleDescChange(idx, v)}
                  inputStyle={{ ...s.cellInput, fontSize: "0.95rem" }}
                  inputRef={(el) => { descRefs.current[idx] = el; }}
                  onEnterKey={() => commitAndAdvance(idx)}
                />
                {item.rateHint && <div style={s.hint}>{item.rateHint}</div>}
                {hint && <div style={s.lockHint}>{hint}</div>}
                <div style={showUnitPrice ? s.m3col : s.m2col}>
                  <div>
                    <label style={s.mlabel}>Qty</label>
                    <QuantityInput value={item.quantity} onChange={(v) => setItem(idx, { quantity: v })} unit={item.unit} units={units} min={getRowMin ? getRowMin(item) : undefined} style={{ ...s.cellInput, textAlign: "right" }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitAndAdvance(idx); } }} />
                  </div>
                  <div>
                    <label style={s.mlabel}>Unit</label>
                    <LookupAutocomplete label="Unit" endpoint="/lookup/units" value={item.unit} onChange={(v) => setItem(idx, { unit: v })} inputStyle={s.cellInput} onEnterKey={() => commitAndAdvance(idx)} />
                  </div>
                  {showUnitPrice && (
                    <div>
                      <label style={s.mlabel}>Unit Price</label>
                      {priceInput(item, idx)}
                    </div>
                  )}
                </div>
                {showUnitPrice && (
                  <div style={s.mamt}><span>Amount</span><b>{currency} {lineTotal(item).toLocaleString()}</b></div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={{ ...s.th, width: 28, textAlign: "center" }}>#</th>
                {showItemType && <th style={{ ...s.th, width: 190 }}>Item Type</th>}
                <th style={s.th}>Description</th>
                <th style={{ ...s.th, width: 92, textAlign: "right" }}>Qty</th>
                <th style={{ ...s.th, width: 120 }}>Unit</th>
                {showUnitPrice && <th style={{ ...s.th, width: 120, textAlign: "right" }}>Unit Price</th>}
                {showUnitPrice && <th style={{ ...s.th, width: 110, textAlign: "right" }}>Amount</th>}
                <th style={{ ...s.th, width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const locked = rowLocked(item);
                const hint = rowLockHint ? rowLockHint(item) : null;
                return (
                  <tr key={idx}>
                    <td style={{ ...s.td, textAlign: "center", color: colors.textSecondary, fontWeight: 700 }}>{idx + 1}</td>
                    {showItemType && (
                      <td style={{ ...s.td, verticalAlign: "top" }}>
                        <SearchableItemTypeSelect items={itemTypes} value={item.itemTypeId || ""} onChange={(newId) => pickItemType(idx, newId)} placeholder="— optional —" style={{ padding: "0.3rem 0.5rem", fontSize: "0.78rem" }} />
                      </td>
                    )}
                    <td style={{ ...s.td, verticalAlign: "top" }}>
                      <LookupAutocomplete
                        label="Item description"
                        endpoint="/lookup/items"
                        value={item.description}
                        onChange={(v) => handleDescChange(idx, v)}
                        inputStyle={s.cellInput}
                        inputRef={(el) => { descRefs.current[idx] = el; }}
                        onEnterKey={() => commitAndAdvance(idx)}
                      />
                      {item.rateHint && <div style={s.hint}>{item.rateHint}</div>}
                      {hint && <div style={s.lockHint}>{hint}</div>}
                    </td>
                    <td style={s.td}>
                      <QuantityInput value={item.quantity} onChange={(v) => setItem(idx, { quantity: v })} unit={item.unit} units={units} min={getRowMin ? getRowMin(item) : undefined} style={{ ...s.cellInput, textAlign: "right" }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitAndAdvance(idx); } }} />
                    </td>
                    <td style={s.td}>
                      <LookupAutocomplete label="Unit" endpoint="/lookup/units" value={item.unit} onChange={(v) => setItem(idx, { unit: v })} inputStyle={s.cellInput} onEnterKey={() => commitAndAdvance(idx)} />
                    </td>
                    {showUnitPrice && <td style={s.td}>{priceInput(item, idx)}</td>}
                    {showUnitPrice && (
                      <td style={{ ...s.td, textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{lineTotal(item).toLocaleString()}</td>
                    )}
                    <td style={{ ...s.td, textAlign: "center" }}>
                      {items.length > 1 && !locked && (
                        <button type="button" style={s.del} onClick={() => removeItem(idx)} title="Remove item"><MdDelete size={16} /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={s.addRow}>
        <button type="button" style={s.addBtn} onClick={addGuarded}><MdAdd size={16} /> Add Item</button>
        <span style={s.enterHint}>Press <kbd style={s.kbd}>Enter</kbd> in a row to add the next line</span>
      </div>
    </div>
  );
}

const colors = {
  textSecondary: "#5f6d7e", cardBorder: "#e8edf3", inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2", danger: "#dc3545", dangerLight: "#fff0f1", teal: "#00897b",
};

const s = {
  itemsHeaderBar: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.5rem" },
  label: { display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem", color: colors.textSecondary },
  hintText: { fontWeight: 400, fontSize: "0.72rem", color: colors.textSecondary },
  input: { width: "100%", padding: "0.55rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: "#1a2332", outline: "none", boxSizing: "border-box" },
  toolBtn: { display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.4rem 0.7rem", borderRadius: 6, border: `1px solid ${colors.inputBorder}`, backgroundColor: "#fff", color: colors.textSecondary, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  inlineAddBtn: { display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.4rem 0.7rem", borderRadius: 6, border: `1px solid ${colors.teal}`, backgroundColor: "#fff", color: colors.teal, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  pastePanel: { border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.7rem", marginBottom: "0.6rem", background: "#f8faff" },
  pasteHintRow: { fontSize: "0.75rem", color: colors.textSecondary, marginBottom: "0.4rem" },
  pasteArea: { width: "100%", boxSizing: "border-box", padding: "0.5rem 0.6rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.85rem", fontFamily: "inherit", marginBottom: "0.5rem", resize: "vertical" },
  pasteCancel: { padding: "0.4rem 0.9rem", borderRadius: 6, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.textSecondary, fontSize: "0.8rem", fontWeight: 600, cursor: "pointer" },
  pasteApply: { padding: "0.4rem 0.9rem", borderRadius: 6, border: "none", background: colors.teal, color: "#fff", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" },
  bulkApplyBar: { display: "flex", alignItems: "center", gap: "0.65rem", flexWrap: "wrap", padding: "0.55rem 0.85rem", marginBottom: "0.5rem", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, backgroundColor: "#f8faff" },
  bulkClearBtn: { display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.35rem 0.7rem", borderRadius: 6, border: `1px solid ${colors.danger}`, backgroundColor: "#fff", color: colors.danger, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 },
  tableWrap: { maxHeight: 320, overflowY: "auto", overflowX: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 10 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.02em", fontWeight: 700, color: colors.textSecondary, padding: "0.5rem 0.4rem", borderBottom: `2px solid ${colors.cardBorder}`, whiteSpace: "nowrap", background: "#fafbfc", position: "sticky", top: 0 },
  td: { padding: "0.3rem 0.4rem", verticalAlign: "middle", borderBottom: `1px solid ${colors.cardBorder}` },
  cellInput: { width: "100%", padding: "0.5rem 0.55rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.88rem", backgroundColor: colors.inputBg, color: "#1a2332", outline: "none", boxSizing: "border-box" },
  hint: { fontSize: "0.7rem", color: colors.teal, marginTop: 2, fontWeight: 600 },
  lockHint: { fontSize: "0.7rem", color: colors.textSecondary, marginTop: 2, fontStyle: "italic" },
  del: { display: "grid", placeItems: "center", padding: "0.4rem", borderRadius: 8, border: `1px solid ${colors.danger}25`, backgroundColor: colors.dangerLight, color: colors.danger, cursor: "pointer", margin: "0 auto" },
  addRow: { display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.6rem", flexWrap: "wrap" },
  addBtn: { display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.4rem 0.9rem", borderRadius: 8, border: "none", backgroundColor: `${colors.teal}14`, color: colors.teal, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer" },
  enterHint: { fontSize: "0.72rem", color: colors.textSecondary },
  kbd: { fontFamily: "monospace", fontSize: "0.7rem", padding: "0.05rem 0.35rem", borderRadius: 4, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: "#1a2332" },
  // Mobile stacked-card line items (below narrowBreakpoint).
  mcards: { display: "flex", flexDirection: "column", gap: "0.6rem" },
  mcard: { border: `1px solid ${colors.cardBorder}`, borderRadius: 12, padding: "0.7rem 0.75rem", background: "#fff" },
  mcardHead: { display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" },
  mnum: { flex: "0 0 auto", width: 24, height: 24, borderRadius: 7, background: "#f0f3f8", color: colors.textSecondary, display: "grid", placeItems: "center", fontSize: "0.78rem", fontWeight: 700 },
  m3col: { display: "grid", gridTemplateColumns: "1fr 1fr 1.1fr", gap: "0.5rem", marginTop: "0.5rem" },
  m2col: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginTop: "0.5rem" },
  mlabel: { display: "block", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.03em", color: colors.textSecondary, fontWeight: 700, marginBottom: "0.2rem" },
  mamt: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.55rem", paddingTop: "0.45rem", borderTop: `1px dashed ${colors.cardBorder}`, fontSize: "0.85rem", color: colors.textSecondary },
};

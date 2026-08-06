import { useState, useEffect, useRef } from "react";
import { MdAdd, MdDelete, MdContentPaste, MdRepeat } from "react-icons/md";
import LookupAutocomplete from "./LookupAutocomplete";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";
import BulkItemTypeBar from "./BulkItemTypeBar";
import QuantityInput from "./QuantityInput";
import useIsNarrow from "../hooks/useIsNarrow";

/**
 * Shared line-item entry for the sales module (Quote / Order / Challan +
 * Challan edit). Ported from master and adapted to this branch's line model.
 *
 * CONTROLLED: the parent owns `items` (an array of row objects) and its exact
 * row shape via `makeBlankItem`. This editor edits the common fields
 * (itemTypeId, nonInventoryItemId, description, quantity, unit, unitPrice) and
 * preserves every other field the parent stamped on a row (id, delivered, …)
 * by spreading. Totals / tax / submit stay in the parent — the submit payload
 * is unchanged by swapping the hand-rolled table for this component.
 *
 * Item picker: this branch's SearchableItemTypeSelect supports BOTH an item
 * type AND a mutually-exclusive Non-Inventory item (Freight / Discount …), plus
 * per-document division scoping. All three flow through here via `itemTypes`,
 * `nonInventoryItems`, and `divisionId`.
 *
 * Responsive: a dense table on desktop, tap-friendly stacked cards below
 * `narrowBreakpoint` (default 768px) — no horizontal scroll on phones.
 *
 * Fast entry:
 *   - "Paste list" turns pasted lines into rows (tab/comma columns →
 *     description, qty, unit[, unit price] in that order).
 *   - "Repeat last" clones the previous line's fields (item type / non-inv /
 *     description / qty / unit[, price]) into a new row.
 *   - "Add Item" appends a blank row (or focuses the current one if it's still
 *     empty) and focuses the new row's description.
 *
 * Config flags let each form show only the columns it needs:
 *   - showItemType + itemTypes  → Item Type / Non-Inventory picker + bulk bar
 *   - showUnitPrice             → the Unit Price column (Quote / Order)
 *   - showAmount                → the per-row Amount column (Quote)
 *   - getRate                   → last-billed-rate auto-fill on the price (Quote)
 */
export default function LineItemsEditor({
  items,
  onItemsChange,
  makeBlankItem,
  units = [],
  // Item Type / Non-Inventory picker + bulk-apply bar.
  showItemType = true,
  itemTypes = [],
  nonInventoryItems = [],
  divisionId = null,
  itemTypePlaceholder = "— item type (optional) —",
  showBulkBar = true,
  // When true, picking a Non-Inventory item also fills the row's unit price
  // from its defaultSalePrice (only when the price field is still empty). The
  // Quote does this; the Order deliberately does not (price stays operator-set).
  nonInvPrefillsPrice = false,
  // Unit price / amount columns.
  showUnitPrice = false,
  showAmount = false,
  currency = "Rs",
  priceOptional = false,
  unitPriceTitle,
  getRate, // (description) => Promise<{ lastUnitPrice, hint } | null | undefined>
  // Description field — multiline (rich text + line breaks) for Quote / Order /
  // Challan; single-line for Challan edit (matches the current forms).
  descriptionMultiline = true,
  // Row locking (e.g. an already-delivered Sales Order line): locked rows can't
  // be removed. `rowLockHint` returns an optional note shown under the row.
  isRowLocked,
  rowLockHint,
  getRowMin,
  // Challan-edit keeps qty from ever being blank (its submit validates qty > 0).
  coerceEmptyQtyToOne = false,
  // Header + tools.
  itemsLabel = "Items",
  itemsHint,
  enablePaste = true,
  enableRepeatLast = true,
  narrowBreakpoint = 768,
}) {
  const isNarrow = useIsNarrow(narrowBreakpoint);
  const showBulk = showBulkBar && showItemType;
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const rateTimers = useRef({});
  const descRefs = useRef({});
  const pendingFocus = useRef(null);
  // Latest items, readable from the debounced rate fetch without capturing a
  // stale closure (this is a controlled component, so no functional setState).
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; });

  // After a row is added/inserted we stash its index to focus; this runs post-
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
  // overwrite the operator's typed description/unit. Mutually exclusive with a
  // Non-Inventory item, so clear any non-inv binding.
  const pickItemType = (idx, newId) =>
    setItem(idx, { itemTypeId: newId ? parseInt(newId) : null, nonInventoryItemId: null });

  // Non-Inventory pick — mutually exclusive with an item type. Records the
  // non-inv id, clears any itemTypeId, and prefills description / unit (and, on
  // price-bearing docs that opt in, unit price) only when those are still empty.
  const pickNonInventory = (idx, n) => {
    if (!n) { setItem(idx, { nonInventoryItemId: null }); return; }
    onItemsChange(items.map((it, i) => {
      if (i !== idx) return it;
      const next = { ...it, nonInventoryItemId: n.id, itemTypeId: null };
      if (!it.description?.trim()) next.description = n.defaultLineDescription || n.name || "";
      if (!it.unit?.trim()) next.unit = n.unitName || "";
      if (showUnitPrice && nonInvPrefillsPrice && (!it.unitPrice || Number(it.unitPrice) === 0) && n.defaultSalePrice != null) {
        next.unitPrice = n.defaultSalePrice;
      }
      return next;
    }));
  };

  const lineTotal = (it) =>
    Math.round((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0) * 100) / 100;

  // Auto-fill price from the item's last billed rate. Only fills when the row's
  // price is still 0 so it never clobbers a typed price; always sets the hint.
  // No-op unless the parent supplied `getRate`.
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

  const setQuantity = (idx, v) =>
    setItem(idx, { quantity: coerceEmptyQtyToOne && v === "" ? 1 : v });

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

  // Duplicate the last line — copies item type / non-inv / description / qty /
  // unit and (when shown) unit price into a fresh row. No-op when the last row
  // has no description yet (nothing to repeat) — focus it instead.
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
      nonInventoryItemId: last.nonInventoryItemId ?? null,
      description: last.description || "",
      quantity: last.quantity,
      unit: last.unit || "",
    };
    if (showUnitPrice) seed.unitPrice = last.unitPrice ?? "";
    if (last.rateHint) seed.rateHint = last.rateHint;
    addItem(seed);
  };

  // Parse pasted lines into rows. Each non-empty line becomes a row. Columns are
  // tab- (preferred, e.g. an Excel paste) or comma-separated in the fixed order
  //   description, quantity, unit, unit price
  // where quantity/price are numeric and unit is the non-numeric token between
  // them. The unit-price column is read only when this document shows prices
  // (Quote/Order). The trailing measurement block is optional per field — a
  // bare "desc", "desc, qty", "desc, qty, unit", "desc, qty, price" and
  // "desc, qty, unit, price" all read correctly. A number embedded in the
  // description (a size like 12mm or 1/2") is left alone because only whole
  // delimited cells at the END are peeled as measurements.
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

  const rowLocked = (it) => (isRowLocked ? isRowLocked(it) : false);

  const priceInput = (item, idx, styleExtra) => (
    <input
      type="number"
      inputMode="decimal"
      min="0"
      step="0.01"
      placeholder={priceOptional ? "—" : undefined}
      title={unitPriceTitle}
      style={{ ...s.cellInput, textAlign: "right", ...styleExtra }}
      value={item.unitPrice ?? ""}
      onChange={(e) => setItem(idx, { unitPrice: e.target.value })}
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

      {showBulk && (
        <BulkItemTypeBar
          items={items}
          setItems={onItemsChange}
          itemTypes={itemTypes}
          nonInventoryItems={nonInventoryItems}
          divisionId={divisionId}
        />
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
                  {showItemType ? (
                    <div style={{ flex: 1 }}>
                      <SearchableItemTypeSelect
                        divisionId={divisionId}
                        items={itemTypes}
                        value={item.itemTypeId || ""}
                        onChange={(newId) => pickItemType(idx, newId)}
                        nonInventoryItems={nonInventoryItems}
                        nonInventoryValue={item.nonInventoryItemId || ""}
                        onPickNonInventory={(n) => pickNonInventory(idx, n)}
                        placeholder={itemTypePlaceholder}
                        style={{ padding: "0.4rem 0.55rem", fontSize: "0.82rem" }}
                      />
                    </div>
                  ) : (
                    <div style={{ flex: 1 }} />
                  )}
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
                  multiline={descriptionMultiline}
                  inputRef={(el) => { descRefs.current[idx] = el; }}
                />
                {item.rateHint && <div style={s.hint}>{item.rateHint}</div>}
                {hint && <div style={s.lockHint}>{hint}</div>}
                <div style={showUnitPrice ? s.m3col : s.m2col}>
                  <div>
                    <label style={s.mlabel}>Qty</label>
                    <QuantityInput value={item.quantity} onChange={(v) => setQuantity(idx, v)} unit={item.unit} units={units} min={getRowMin ? getRowMin(item) : undefined} style={{ ...s.cellInput, textAlign: "right" }} />
                  </div>
                  <div>
                    <label style={s.mlabel}>Unit</label>
                    <LookupAutocomplete label="Unit" endpoint="/lookup/units" value={item.unit} onChange={(v) => setItem(idx, { unit: v })} inputStyle={s.cellInput} />
                  </div>
                  {showUnitPrice && (
                    <div>
                      <label style={s.mlabel}>Unit Price{priceOptional && <span style={s.opt}> (opt)</span>}</label>
                      {priceInput(item, idx)}
                    </div>
                  )}
                </div>
                {showAmount && (
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
                <th style={{ ...s.th, minWidth: 240 }}>Description</th>
                <th style={{ ...s.th, width: 100, textAlign: "right" }}>Qty</th>
                <th style={{ ...s.th, width: 130 }}>Unit</th>
                {showUnitPrice && <th style={{ ...s.th, width: 120, textAlign: "right" }}>Unit Price{priceOptional && <span style={s.opt}> (opt)</span>}</th>}
                {showAmount && <th style={{ ...s.th, width: 110, textAlign: "right" }}>Amount</th>}
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
                        <SearchableItemTypeSelect
                          divisionId={divisionId}
                          items={itemTypes}
                          value={item.itemTypeId || ""}
                          onChange={(newId) => pickItemType(idx, newId)}
                          nonInventoryItems={nonInventoryItems}
                          nonInventoryValue={item.nonInventoryItemId || ""}
                          onPickNonInventory={(n) => pickNonInventory(idx, n)}
                          placeholder={itemTypePlaceholder}
                          style={{ padding: "0.3rem 0.5rem", fontSize: "0.78rem" }}
                        />
                      </td>
                    )}
                    <td style={{ ...s.td, verticalAlign: "top" }}>
                      <LookupAutocomplete
                        label="Item description"
                        endpoint="/lookup/items"
                        value={item.description}
                        onChange={(v) => handleDescChange(idx, v)}
                        inputStyle={s.cellInput}
                        multiline={descriptionMultiline}
                        inputRef={(el) => { descRefs.current[idx] = el; }}
                      />
                      {item.rateHint && <div style={s.hint}>{item.rateHint}</div>}
                      {hint && <div style={s.lockHint}>{hint}</div>}
                    </td>
                    <td style={s.td}>
                      <QuantityInput value={item.quantity} onChange={(v) => setQuantity(idx, v)} unit={item.unit} units={units} min={getRowMin ? getRowMin(item) : undefined} style={{ ...s.cellInput, textAlign: "right" }} />
                    </td>
                    <td style={s.td}>
                      <LookupAutocomplete label="Unit" endpoint="/lookup/units" value={item.unit} onChange={(v) => setItem(idx, { unit: v })} inputStyle={s.cellInput} />
                    </td>
                    {showUnitPrice && <td style={s.td}>{priceInput(item, idx)}</td>}
                    {showAmount && (
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
  opt: { color: colors.textSecondary, fontWeight: 400 },
  toolBtn: { display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.4rem 0.7rem", borderRadius: 6, border: `1px solid ${colors.inputBorder}`, backgroundColor: "#fff", color: colors.textSecondary, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", minHeight: 44 },
  pastePanel: { border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.7rem", marginBottom: "0.6rem", background: "#f8faff" },
  pasteHintRow: { fontSize: "0.75rem", color: colors.textSecondary, marginBottom: "0.4rem" },
  pasteArea: { width: "100%", boxSizing: "border-box", padding: "0.5rem 0.6rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.85rem", fontFamily: "inherit", marginBottom: "0.5rem", resize: "vertical" },
  pasteCancel: { padding: "0.4rem 0.9rem", borderRadius: 6, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.textSecondary, fontSize: "0.8rem", fontWeight: 600, cursor: "pointer" },
  pasteApply: { padding: "0.4rem 0.9rem", borderRadius: 6, border: "none", background: colors.teal, color: "#fff", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" },
  tableWrap: { maxHeight: 320, overflowY: "auto", overflowX: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 10 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.02em", fontWeight: 700, color: colors.textSecondary, padding: "0.5rem 0.4rem", borderBottom: `2px solid ${colors.cardBorder}`, whiteSpace: "nowrap", background: "#fafbfc", position: "sticky", top: 0 },
  td: { padding: "0.3rem 0.4rem", verticalAlign: "middle", borderBottom: `1px solid ${colors.cardBorder}` },
  cellInput: { width: "100%", padding: "0.5rem 0.55rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.88rem", backgroundColor: colors.inputBg, color: "#1a2332", outline: "none", boxSizing: "border-box" },
  hint: { fontSize: "0.7rem", color: colors.teal, marginTop: 2, fontWeight: 600 },
  lockHint: { fontSize: "0.7rem", color: colors.textSecondary, marginTop: 2, fontStyle: "italic" },
  del: { display: "grid", placeItems: "center", width: 44, height: 44, borderRadius: 8, border: `1px solid ${colors.danger}25`, backgroundColor: colors.dangerLight, color: colors.danger, cursor: "pointer", margin: "0 auto" },
  addRow: { display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.6rem", flexWrap: "wrap" },
  addBtn: { display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.5rem 0.9rem", borderRadius: 8, border: "none", backgroundColor: `${colors.teal}14`, color: colors.teal, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", minHeight: 44 },
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

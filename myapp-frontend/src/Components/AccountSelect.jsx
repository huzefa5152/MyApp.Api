import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { MdArrowDropDown, MdSearch } from "react-icons/md";

/**
 * AccountSelect — the Chart-of-Accounts picker.
 *
 * One searchable GL-account dropdown, grouped by account type (Assets /
 * Liabilities / Equity / Income / Expenses), mirroring the item-type picker's
 * UX. The `side` hint ("income" / "expense") floats that type's group to the
 * top, so a sales line leads with Income and a purchase line with Expense.
 *
 * The CALLER fetches the flat account list once (getAccountsFlat(companyId))
 * and passes it in — this component never fetches, so rendering one per table
 * row costs no extra network calls.
 *
 * Props:
 *   accounts    — AccountDto[] (id, name, code, accountType, accountGroupName…).
 *                 Filter to active accounts in the caller if you want that.
 *   value       — selected account id (number | string | null | "")
 *   onChange    — (idOrNull) => void
 *   side        — "income" | "expense" | null — which type leads the list
 *   placeholder — text for the empty option
 *   disabled, style — passthroughs
 *   unavailable — true when the chart could not be loaded, so the empty option
 *                 says so instead of implying the company has no accounts
 */

// Canonical statement order + the label on each group header.
const TYPE_ORDER = ["Asset", "Liability", "Equity", "Income", "Expense"];
const TYPE_LABEL = {
  Asset: "Assets",
  Liability: "Liabilities",
  Equity: "Equity",
  Income: "Income",
  Expense: "Expenses",
};
const TYPE_COLOR = {
  Asset: { fg: "#0d5c63", bg: "#e0f2f1" },
  Liability: { fg: "#8a5a00", bg: "#fff3cd" },
  Equity: { fg: "#5b3fa3", bg: "#ede7f6" },
  Income: { fg: "#1b5e20", bg: "#e8f5e9" },
  Expense: { fg: "#b3261e", bg: "#fdecea" },
};

export default function AccountSelect({
  accounts = [],
  value,
  onChange,
  side = null,
  placeholder = "Use company default",
  disabled = false,
  style,
  unavailable = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [triggerRect, setTriggerRect] = useState(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const wrapperRef = useRef(null);

  const selected = useMemo(
    () => accounts.find((a) => String(a.id) === String(value)),
    [accounts, value]
  );

  const label = (a) => `${a.code ? `${a.code} — ` : ""}${a.name}`;

  // The `side` hint floats Income (sales) or Expense (purchase) to the front;
  // the remaining types keep canonical statement order.
  const typeOrder = useMemo(() => {
    const primary = side === "income" ? "Income" : side === "expense" ? "Expense" : null;
    if (!primary) return TYPE_ORDER;
    return [primary, ...TYPE_ORDER.filter((t) => t !== primary)];
  }, [side]);

  // Filtered + grouped: [{ type, label, accounts[] }] in the resolved order,
  // with any non-standard accountType falling into a trailing group of its own.
  const groups = useMemo(() => {
    const term = query.trim().toLowerCase();
    const match = (a) =>
      !term ||
      (a.name || "").toLowerCase().includes(term) ||
      (a.code || "").toLowerCase().includes(term) ||
      (a.accountGroupName || "").toLowerCase().includes(term) ||
      (a.accountType || "").toLowerCase().includes(term);
    const byType = new Map();
    accounts.filter(match).forEach((a) => {
      const t = a.accountType || "Other";
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(a);
    });
    const order = [...typeOrder, ...[...byType.keys()].filter((t) => !typeOrder.includes(t))];
    return order
      .filter((t) => byType.has(t))
      .map((t) => ({
        type: t,
        label: TYPE_LABEL[t] || t,
        accounts: byType.get(t).sort((a, b) => (a.code || a.name || "").localeCompare(b.code || b.name || "")),
      }));
  }, [accounts, query, typeOrder]);

  // Flat list, in visual order, for arrow-key navigation.
  const flat = useMemo(() => groups.flatMap((g) => g.accounts), [groups]);

  useEffect(() => {
    const onMouseDown = (e) => {
      if (
        wrapperRef.current && !wrapperRef.current.contains(e.target) &&
        triggerRef.current && !triggerRef.current.contains(e.target)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightIdx(-1);
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const recompute = () => {
      if (triggerRef.current) setTriggerRect(triggerRef.current.getBoundingClientRect());
    };
    recompute();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [open]);

  const pick = (a) => { onChange?.(a ? a.id : null); setOpen(false); };
  const clear = (e) => { e.stopPropagation(); onChange?.(null); };

  const handleKeyDown = (e) => {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIdx((i) => Math.min(flat.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (highlightIdx >= 0 && highlightIdx < flat.length) pick(flat[highlightIdx]); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  let runningIdx = -1;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        ref={triggerRef}
        disabled={disabled}
        // The trigger is a single-line control inside table rows, so it can't
        // wrap without shifting the row height; the title carries the full name
        // so two accounts sharing a prefix are still distinguishable here. The
        // LIST rows below, where the choice is actually made, do wrap.
        title={selected ? label(selected) : undefined}
        onClick={() => !disabled && setOpen((v) => !v)}
        style={{ ...styles.trigger, ...(disabled ? styles.triggerDisabled : null), ...style }}
      >
        <span style={styles.triggerLabel}>
          {selected ? (
            <>
              {selected.accountType && (
                <span style={{ ...styles.typeDot, backgroundColor: (TYPE_COLOR[selected.accountType] || {}).fg || "#94a3b8" }} />
              )}
              {label(selected)}
            </>
          ) : (
            <span style={styles.placeholder}>{unavailable ? "(chart of accounts unavailable)" : placeholder}</span>
          )}
        </span>
        {selected && <span onClick={clear} style={styles.clearBtn} title="Clear">×</span>}
        <MdArrowDropDown size={18} style={{ flexShrink: 0 }} />
      </button>

      {open && triggerRect && createPortal(
        <div ref={wrapperRef} style={styles.dropdown(triggerRect)} onKeyDown={handleKeyDown}>
          <div style={styles.searchRow}>
            <MdSearch size={16} style={styles.searchIcon} />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search account by name, code, group…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHighlightIdx(0); }}
              onKeyDown={handleKeyDown}
              style={styles.searchInput}
            />
          </div>

          <div style={styles.list}>
            {/* "None" row — clears back to the company default / empty. */}
            <div onMouseDown={() => pick(null)} style={{ ...styles.row, ...styles.noneRow }}>
              {unavailable ? "(chart of accounts unavailable)" : placeholder}
            </div>

            {flat.length === 0 && (
              <div style={styles.empty}>
                {accounts.length === 0 ? "No accounts in the chart yet." : `No accounts match "${query}".`}
              </div>
            )}

            {groups.map((g) => {
              const c = TYPE_COLOR[g.type] || { fg: "#5f6d7e", bg: "#f1f5f9" };
              return (
                <div key={g.type}>
                  <div style={{ ...styles.groupHeader, color: c.fg, backgroundColor: c.bg }}>
                    {g.label} ({g.accounts.length})
                  </div>
                  {g.accounts.map((a) => {
                    runningIdx += 1;
                    const idx = runningIdx;
                    const highlighted = idx === highlightIdx;
                    const isSel = String(a.id) === String(value);
                    return (
                      <div
                        key={a.id}
                        onMouseDown={() => pick(a)}
                        onMouseEnter={() => setHighlightIdx(idx)}
                        style={{ ...styles.row, backgroundColor: highlighted ? "#e3f2fd" : isSel ? "#f0f7ff" : "transparent" }}
                      >
                        <span style={styles.rowName}>
                          {a.code && <span style={styles.codeChip}>{a.code}</span>}
                          {a.name}
                        </span>
                        {/* Which group the account sits in, muted on the right —
                            often the only way to tell two like-named accounts
                            apart at a glance. Dropped when it merely repeats the
                            section header above it, so it adds signal, not noise. */}
                        {a.accountGroupName && a.accountGroupName !== g.label && (
                          <span style={styles.rowGroup}>{a.accountGroupName}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

const styles = {
  trigger: {
    display: "flex", alignItems: "center", gap: "0.25rem", width: "100%",
    // 38px keeps the control a comfortable tap target inside a dense line-item
    // row without forcing the row to 44px on desktop.
    minHeight: 38,
    padding: "0.45rem 0.55rem", border: "1px solid #d0d7e2", borderRadius: 6,
    backgroundColor: "#fff", fontSize: "0.82rem", color: "#1a2332",
    cursor: "pointer", textAlign: "left", boxShadow: "none",
  },
  triggerDisabled: { backgroundColor: "#f1f5f9", color: "#94a3b8", cursor: "not-allowed" },
  triggerLabel: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 },
  typeDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  placeholder: { color: "#94a3b8" },
  clearBtn: { fontSize: "1rem", color: "#94a3b8", padding: "0 0.3rem", cursor: "pointer", lineHeight: 1 },
  dropdown: (rect) => {
    const spaceBelow = window.innerHeight - rect.bottom;
    const listHeight = 380;
    const flipAbove = spaceBelow < 220 && rect.top > spaceBelow;
    const width = Math.min(Math.max(rect.width, 260), window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    return {
      position: "fixed",
      top: flipAbove ? undefined : rect.bottom + 2,
      bottom: flipAbove ? window.innerHeight - rect.top + 2 : undefined,
      left, width,
      maxHeight: flipAbove ? Math.min(listHeight, rect.top - 10) : Math.min(listHeight, spaceBelow - 10),
      backgroundColor: "#fff", border: "1px solid #d0d7e2", borderRadius: 8,
      boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 9999,
      display: "flex", flexDirection: "column",
    };
  },
  searchRow: { display: "flex", alignItems: "center", padding: "0.45rem 0.65rem", borderBottom: "1px solid #e8edf3", position: "relative" },
  searchIcon: { position: "absolute", left: 12, color: "#94a3b8" },
  searchInput: { width: "100%", padding: "0.35rem 0.35rem 0.35rem 1.85rem", border: "1px solid #e8edf3", borderRadius: 6, fontSize: "0.82rem", outline: "none", backgroundColor: "#f8f9fb" },
  list: { overflowY: "auto", flex: 1 },
  groupHeader: { padding: "0.35rem 0.7rem", fontSize: "0.66rem", fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", position: "sticky", top: 0, zIndex: 1 },
  row: {
    display: "flex", alignItems: "baseline", gap: "0.6rem",
    // 44px min so a row is a real tap target on a phone.
    minHeight: 44,
    padding: "0.5rem 0.7rem", cursor: "pointer", borderBottom: "1px solid #f0f4f8",
    fontSize: "0.82rem", color: "#1a2332",
  },
  noneRow: { color: "#5f6d7e", fontStyle: "italic" },
  rowName: {
    flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
    // NOT nowrap + ellipsis: account names are operator-supplied and two that
    // share a long prefix would render identically, which is how a posting ends
    // up on the wrong account.
    overflowWrap: "anywhere",
  },
  rowGroup: { flexShrink: 0, maxWidth: "45%", overflowWrap: "anywhere", color: "#94a3b8", fontSize: "0.74rem" },
  codeChip: { padding: "0.05rem 0.35rem", backgroundColor: "#eef2ff", color: "#0d47a1", fontFamily: "monospace", fontWeight: 700, fontSize: "0.7rem", borderRadius: 3, flexShrink: 0 },
  empty: { padding: "0.8rem", color: "#5f6d7e", fontSize: "0.82rem" },
};

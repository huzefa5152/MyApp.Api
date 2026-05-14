import { useState, useMemo, useRef, useEffect } from "react";
import { MdArrowUpward, MdArrowDownward, MdViewColumn, MdSearch } from "react-icons/md";
import { useUiPreference } from "../hooks/useUiPreference";

/**
 * Sticky-header sortable table for dense list views.
 *
 * Props:
 *   columns:  Array<{
 *     key:        string,           // unique id (also used as the data accessor when `accessor` is missing)
 *     header:     string,           // column heading
 *     accessor?:  (row) => any,     // value-extractor for sorting + default cell content
 *     render?:    (row) => ReactNode, // optional custom cell renderer
 *     align?:     "left" | "right" | "center",
 *     width?:     number | string,  // px or any CSS width
 *     sortable?:  boolean,          // default true
 *     hideable?:  boolean,          // default true — false to pin the column in the visibility menu
 *     defaultHidden?: boolean,
 *   }>
 *   rows:        any[]               // each row needs a stable .id (or pass `rowKey`)
 *   rowKey?:     (row) => string|number
 *   onRowClick?: (row) => void       // row click handler (whole row clickable)
 *   actions?:    (row) => ReactNode  // right-most action cell (buttons live here)
 *   actionsHeader?: string            // optional header label for the actions column
 *   quickSearchPlaceholder?: string  // omit to hide the in-table quick filter
 *   storageKey?: string               // when provided, column visibility persists in localStorage
 *   emptyMessage?: string
 *   dense?:      boolean              // tighter row padding for very dense lists
 */
export default function DataTable({
  columns,
  rows,
  rowKey,
  onRowClick,
  actions,
  actionsHeader = "",
  quickSearchPlaceholder,
  storageKey,
  emptyMessage = "No records to display.",
  dense = false,
}) {
  const [sort, setSort] = useState({ key: null, dir: "asc" });
  const [quickFilter, setQuickFilter] = useState("");
  // Column visibility — persisted under storageKey so the operator's
  // preference survives reloads.
  const [hiddenSerialized, setHiddenSerialized] = useUiPreference(
    storageKey ? `dataTable.hidden:${storageKey}` : "dataTable.hidden:__transient__",
    JSON.stringify(
      columns.filter((c) => c.defaultHidden).map((c) => c.key)
    )
  );

  let hidden;
  try { hidden = new Set(JSON.parse(hiddenSerialized || "[]")); }
  catch { hidden = new Set(); }

  const toggleHidden = (key) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    setHiddenSerialized(JSON.stringify(Array.from(next)));
  };

  const [colMenuOpen, setColMenuOpen] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!colMenuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setColMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colMenuOpen]);

  const visibleColumns = columns.filter((c) => !hidden.has(c.key));

  const getValue = (row, col) => {
    if (col.accessor) return col.accessor(row);
    return row?.[col.key];
  };

  const sortedRows = useMemo(() => {
    if (!sort.key) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const dir = sort.dir === "desc" ? -1 : 1;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = getValue(a, col);
      const bv = getValue(b, col);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      // Try numeric coercion for stringy numbers (totals etc.)
      const an = Number(av), bn = Number(bv);
      if (!Number.isNaN(an) && !Number.isNaN(bn) && (typeof av === "string" || typeof bv === "string")) {
        return (an - bn) * dir;
      }
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
    return copy;
    // columns ref is stable per render anyway; rows + sort drive the sort.
  }, [rows, sort, columns]);

  const filteredRows = useMemo(() => {
    if (!quickFilter.trim()) return sortedRows;
    const q = quickFilter.toLowerCase();
    return sortedRows.filter((row) =>
      visibleColumns.some((col) => {
        const v = getValue(row, col);
        if (v == null) return false;
        return String(v).toLowerCase().includes(q);
      })
    );
  }, [sortedRows, quickFilter, visibleColumns]);

  const handleSort = (col) => {
    if (col.sortable === false) return;
    setSort((prev) => {
      if (prev.key !== col.key) return { key: col.key, dir: "asc" };
      if (prev.dir === "asc") return { key: col.key, dir: "desc" };
      return { key: null, dir: "asc" };
    });
  };

  const cellPad = dense ? "0.45rem 0.7rem" : "0.6rem 0.85rem";
  const headPad = dense ? "0.5rem 0.7rem" : "0.65rem 0.85rem";

  return (
    <div style={styles.outer}>
      {(quickSearchPlaceholder || true) && (
        <div style={styles.toolbar}>
          {quickSearchPlaceholder && (
            <div style={styles.searchWrap}>
              <MdSearch size={15} style={styles.searchIcon} />
              <input
                type="text"
                placeholder={quickSearchPlaceholder}
                value={quickFilter}
                onChange={(e) => setQuickFilter(e.target.value)}
                style={styles.searchInput}
              />
            </div>
          )}
          <div style={{ flex: 1 }} />
          <div style={{ position: "relative" }} ref={menuRef}>
            <button
              type="button"
              onClick={() => setColMenuOpen((v) => !v)}
              style={styles.colBtn}
              title="Show / hide columns"
            >
              <MdViewColumn size={16} />
              Columns
            </button>
            {colMenuOpen && (
              <div style={styles.colMenu} role="menu">
                <div style={styles.colMenuTitle}>Visible columns</div>
                {columns.map((c) => {
                  const disabled = c.hideable === false;
                  const checked = !hidden.has(c.key);
                  return (
                    <label
                      key={c.key}
                      style={{
                        ...styles.colMenuItem,
                        opacity: disabled ? 0.55 : 1,
                        cursor: disabled ? "not-allowed" : "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleHidden(c.key)}
                      />
                      {c.header}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              {visibleColumns.map((col) => {
                const isSorted = sort.key === col.key;
                const sortable = col.sortable !== false;
                return (
                  <th
                    key={col.key}
                    onClick={() => sortable && handleSort(col)}
                    style={{
                      ...styles.th,
                      padding: headPad,
                      cursor: sortable ? "pointer" : "default",
                      textAlign: col.align || "left",
                      width: col.width,
                    }}
                    title={sortable ? `Sort by ${col.header}` : undefined}
                  >
                    <span style={styles.thInner}>
                      {col.header}
                      {sortable && isSorted && (
                        sort.dir === "asc"
                          ? <MdArrowUpward size={13} />
                          : <MdArrowDownward size={13} />
                      )}
                    </span>
                  </th>
                );
              })}
              {actions && (
                <th style={{ ...styles.th, padding: headPad, textAlign: "right", width: 1 }}>
                  {actionsHeader}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + (actions ? 1 : 0)}
                  style={{ ...styles.tdEmpty, padding: cellPad }}
                >
                  {quickFilter ? "No rows match the quick filter." : emptyMessage}
                </td>
              </tr>
            ) : filteredRows.map((row, i) => {
              const k = rowKey ? rowKey(row) : (row.id ?? i);
              return (
                <tr
                  key={k}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={{
                    ...styles.tr,
                    cursor: onRowClick ? "pointer" : "default",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#f8fafc"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#fff"; }}
                >
                  {visibleColumns.map((col) => (
                    <td
                      key={col.key}
                      style={{
                        ...styles.td,
                        padding: cellPad,
                        textAlign: col.align || "left",
                        width: col.width,
                      }}
                    >
                      {col.render ? col.render(row) : (() => {
                        const v = getValue(row, col);
                        return v == null || v === "" ? "—" : v;
                      })()}
                    </td>
                  ))}
                  {actions && (
                    <td
                      style={{ ...styles.td, padding: cellPad, textAlign: "right" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={styles.actionsCell}>{actions(row)}</div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const colors = {
  cardBorder: "#e8edf3",
  inputBorder: "#d0d7e2",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  headBg: "#f5f8fc",
};

const styles = {
  outer: {
    backgroundColor: "#fff",
    borderRadius: 12,
    border: `1px solid ${colors.cardBorder}`,
    boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
    overflow: "hidden",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    padding: "0.6rem 0.85rem",
    borderBottom: `1px solid ${colors.cardBorder}`,
    flexWrap: "wrap",
  },
  searchWrap: {
    position: "relative",
    flex: "0 1 320px",
    minWidth: 200,
  },
  searchIcon: {
    position: "absolute",
    left: 10,
    top: "50%",
    transform: "translateY(-50%)",
    color: colors.textSecondary,
  },
  searchInput: {
    width: "100%",
    padding: "0.45rem 0.7rem 0.45rem 2rem",
    borderRadius: 8,
    border: `1px solid ${colors.inputBorder}`,
    backgroundColor: "#f8f9fb",
    fontSize: "0.85rem",
    outline: "none",
    boxSizing: "border-box",
  },
  colBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "0.4rem 0.75rem",
    borderRadius: 8,
    border: `1px solid ${colors.inputBorder}`,
    backgroundColor: "#fff",
    color: colors.textSecondary,
    fontSize: "0.8rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  colMenu: {
    position: "absolute",
    right: 0,
    top: "calc(100% + 4px)",
    minWidth: 220,
    padding: "0.5rem 0.25rem",
    backgroundColor: "#fff",
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 10,
    boxShadow: "0 8px 32px rgba(15,23,42,0.18)",
    zIndex: 50,
    maxHeight: "60vh",
    overflowY: "auto",
  },
  colMenuTitle: {
    fontSize: "0.7rem",
    fontWeight: 700,
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    padding: "0.25rem 0.75rem 0.5rem",
  },
  colMenuItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "0.4rem 0.75rem",
    fontSize: "0.85rem",
    color: colors.textPrimary,
    borderRadius: 6,
    userSelect: "none",
  },
  tableWrap: {
    width: "100%",
    overflowX: "auto",
    maxHeight: "70vh",
    overflowY: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    fontSize: "0.85rem",
  },
  th: {
    position: "sticky",
    top: 0,
    backgroundColor: colors.headBg,
    color: colors.textSecondary,
    fontSize: "0.74rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    borderBottom: `1px solid ${colors.cardBorder}`,
    whiteSpace: "nowrap",
    userSelect: "none",
    zIndex: 1,
  },
  thInner: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  },
  tr: {
    transition: "background-color 0.12s",
  },
  td: {
    borderBottom: `1px solid ${colors.cardBorder}`,
    color: colors.textPrimary,
    verticalAlign: "middle",
  },
  tdEmpty: {
    textAlign: "center",
    color: colors.textSecondary,
    padding: "2rem 1rem",
    fontStyle: "italic",
  },
  actionsCell: {
    display: "inline-flex",
    gap: 6,
    flexWrap: "nowrap",
    justifyContent: "flex-end",
  },
};

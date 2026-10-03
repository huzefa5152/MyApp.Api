import { useState, useMemo, useRef, useEffect } from "react";
import { MdArrowUpward, MdArrowDownward, MdViewColumn, MdSearch } from "react-icons/md";
import { useUiPreference } from "../hooks/useUiPreference";
import "../ui/kit.css";
import "../ui/shared-components.css";

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

  // Theme look (header height, row height, padding, colours) comes from the kit's
  // .k-table rules via --k-* tokens; `dense` maps to the kit's compact row variant.
  return (
    <div className="sc-dt">
      {(quickSearchPlaceholder || true) && (
        <div className="sc-dt__toolbar">
          {quickSearchPlaceholder && (
            <div className="sc-dt__search">
              <MdSearch size={15} aria-hidden="true" />
              <input
                type="text"
                className="k-input"
                placeholder={quickSearchPlaceholder}
                value={quickFilter}
                onChange={(e) => setQuickFilter(e.target.value)}
              />
            </div>
          )}
          <div style={{ flex: 1 }} />
          <div style={{ position: "relative" }} ref={menuRef}>
            <button
              type="button"
              onClick={() => setColMenuOpen((v) => !v)}
              className="k-btn k-btn--secondary k-btn--sm"
              title="Show / hide columns"
            >
              <MdViewColumn size={16} />
              Columns
            </button>
            {colMenuOpen && (
              <div className="sc-dt__menu" role="menu">
                <div className="sc-dt__menu-title">Visible columns</div>
                {columns.map((c) => {
                  const disabled = c.hideable === false;
                  const checked = !hidden.has(c.key);
                  return (
                    <label
                      key={c.key}
                      className="sc-dt__menu-item"
                      style={{
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

      <div className="sc-dt__scroll">
        <table className={dense ? "k-table k-table--compact" : "k-table"}>
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
                      cursor: sortable ? "pointer" : "default",
                      textAlign: col.align || "left",
                      width: col.width,
                    }}
                    title={sortable ? `Sort by ${col.header}` : undefined}
                  >
                    <span className="sc-dt__th-inner">
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
                <th className="k-actions" style={{ textAlign: "right", width: 1 }}>
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
                  className="sc-dt__empty"
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
                  style={{ cursor: onRowClick ? "pointer" : "default" }}
                >
                  {visibleColumns.map((col) => (
                    <td
                      key={col.key}
                      style={{
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
                      className="k-actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="sc-dt__actions">{actions(row)}</div>
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

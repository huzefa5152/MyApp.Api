import { useEffect, useMemo, useRef, useState } from "react";
import { MdArrowDownward, MdArrowUpward, MdSearch, MdViewColumn, MdDensityMedium, MdDensitySmall } from "react-icons/md";
import { useUiPreference } from "../hooks/useUiPreference";
import { IconBtn, RowMenu } from "./primitives";

/**
 * Compact data table for list screens. Same column contract as the app's DataTable
 * (key, header, accessor, render, align, width, sortable, hideable, defaultHidden) and the
 * same persisted "visible columns" key, so a user's existing column choices carry over.
 *
 * New here: a density switch (comfortable / compact, remembered), keyboard-operable sort
 * headers with aria-sort, and per-row actions given as DATA: the ones marked `inline` render as
 * icon buttons, the rest collapse into one overflow menu. Nothing is dropped: every action the
 * old row offered is still reachable, with a visible label in the menu.
 *
 * rowActions(row) => [{ key, label, icon, onClick, disabled, danger, inline, loading, title, separatorBefore }]
 */
export default function DataGrid({
  columns,
  rows,
  rowKey,
  rowActions,
  storageKey,
  quickSearchPlaceholder = "Filter rows on this page…",
  emptyMessage = "No records to display.",
  attached = false,
}) {
  const [sort, setSort] = useState({ key: null, dir: "asc" });
  const [quick, setQuick] = useState("");
  const [density, setDensity] = useUiPreference("u2.density", "comfortable");
  const [hiddenSerialized, setHiddenSerialized] = useUiPreference(
    storageKey ? `dataTable.hidden:${storageKey}` : "dataTable.hidden:__transient__",
    JSON.stringify(columns.filter((c) => c.defaultHidden).map((c) => c.key))
  );

  let hidden;
  try { hidden = new Set(JSON.parse(hiddenSerialized || "[]")); } catch { hidden = new Set(); }
  const toggleHidden = (key) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    setHiddenSerialized(JSON.stringify([...next]));
  };

  const [colsOpen, setColsOpen] = useState(false);
  const colsRef = useRef(null);
  useEffect(() => {
    if (!colsOpen) return;
    const onDown = (e) => { if (colsRef.current && !colsRef.current.contains(e.target)) setColsOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setColsOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [colsOpen]);

  const visible = columns.filter((c) => !hidden.has(c.key));
  const valueOf = (row, col) => (col.accessor ? col.accessor(row) : row?.[col.key]);

  const sorted = useMemo(() => {
    if (!sort.key) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const dir = sort.dir === "desc" ? -1 : 1;
    return [...rows].sort((a, b) => {
      const av = valueOf(a, col), bv = valueOf(b, col);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      const an = Number(av), bn = Number(bv);
      if (!Number.isNaN(an) && !Number.isNaN(bn) && (typeof av === "string" || typeof bv === "string")) return (an - bn) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
  }, [rows, sort, columns]);

  const shown = useMemo(() => {
    const q = quick.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((row) => visible.some((c) => {
      const v = valueOf(row, c);
      return v != null && String(v).toLowerCase().includes(q);
    }));
  }, [sorted, quick, visible]);

  const cycleSort = (col) => {
    if (col.sortable === false) return;
    setSort((p) => (p.key !== col.key ? { key: col.key, dir: "asc" } : p.dir === "asc" ? { key: col.key, dir: "desc" } : { key: null, dir: "asc" }));
  };

  const compact = density === "compact";
  const hasActions = typeof rowActions === "function";

  return (
    <div className={`u2-grid${attached ? "" : " u2-grid--standalone"}`}>
      <div className="u2-grid__bar u2-grid__bar--slim">
        <span style={{ flex: 1 }} />
        <IconBtn
          large
          label={compact ? "Switch to comfortable rows" : "Switch to compact rows"}
          icon={compact ? MdDensityMedium : MdDensitySmall}
          onClick={() => setDensity(compact ? "comfortable" : "compact")}
        />
        <span className="u2-menu-wrap" ref={colsRef}>
          <IconBtn large label="Show or hide columns" icon={MdViewColumn} active={colsOpen} aria-haspopup="true" aria-expanded={colsOpen} onClick={() => setColsOpen((v) => !v)} />
          {colsOpen && (
            <div className="u2-menu" role="group" aria-label="Visible columns" style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, left: "auto", padding: "0.4rem" }}>
              {columns.map((c) => (
                <label key={c.key} className="u2-menu__item" style={{ cursor: c.hideable === false ? "not-allowed" : "pointer", opacity: c.hideable === false ? 0.55 : 1 }}>
                  <input type="checkbox" checked={!hidden.has(c.key)} disabled={c.hideable === false} onChange={() => toggleHidden(c.key)} />
                  {c.header}
                </label>
              ))}
            </div>
          )}
        </span>
      </div>

      <div className="u2-grid__scroll">
        <table className={`u2-table${compact ? " u2-table--compact" : ""}`}>
          <thead>
            <tr>
              {visible.map((col) => {
                const sortable = col.sortable !== false;
                const active = sort.key === col.key;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={col.align === "right" ? "is-right" : col.align === "center" ? "is-center" : undefined}
                    style={{ width: col.width }}
                    aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : sortable ? "none" : undefined}
                  >
                    {sortable ? (
                      <button type="button" onClick={() => cycleSort(col)} title={`Sort by ${col.header}`}>
                        {col.header}
                        {active && (sort.dir === "asc" ? <MdArrowUpward size={12} aria-hidden="true" /> : <MdArrowDownward size={12} aria-hidden="true" />)}
                      </button>
                    ) : col.header}
                  </th>
                );
              })}
              {hasActions && <th scope="col" className="is-right"><span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={visible.length + (hasActions ? 1 : 0)} style={{ textAlign: "center", height: 72, color: "var(--u2-muted)" }}>
                  {quick ? "No rows on this page match the filter." : emptyMessage}
                </td>
              </tr>
            ) : shown.map((row, i) => {
              const actions = hasActions ? rowActions(row) : [];
              const inline = actions.filter((a) => a.inline);
              const more = actions.filter((a) => !a.inline);
              return (
                <tr key={rowKey ? rowKey(row) : (row.id ?? i)}>
                  {visible.map((col) => {
                    const v = valueOf(row, col);
                    return (
                      <td key={col.key} className={col.align === "right" ? "is-right" : col.align === "center" ? "is-center" : undefined} style={{ width: col.width }}>
                        {col.render ? col.render(row) : v == null || v === "" ? <span className="u2-cell-muted">—</span> : v}
                      </td>
                    );
                  })}
                  {hasActions && (
                    <td className="u2-cell-actions">
                      <div className="u2-row-actions">
                        {inline.map((a) => (
                          <IconBtn key={a.key} label={a.title || a.label} icon={a.icon} disabled={a.disabled} onClick={a.onClick}>
                            {a.loading ? <span className="u2-spinner" aria-hidden="true" /> : null}
                          </IconBtn>
                        ))}
                        <RowMenu items={more} />
                      </div>
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

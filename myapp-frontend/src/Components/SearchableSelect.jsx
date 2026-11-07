import { useState, useEffect, useRef, useMemo, useId } from "react";
import { createPortal } from "react-dom";
import { MdAdd, MdArrowDropDown, MdSearch } from "react-icons/md";
import ClientForm from "./ClientForm";
import SupplierForm from "./SupplierForm";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";

const QUICK_CREATE = {
  client: { Form: ClientForm, permission: "clients.manage.create", label: "New client" },
  supplier: { Form: SupplierForm, permission: "suppliers.manage.create", label: "New supplier" },
};

// The "+" beside a form's client or supplier picker. It lives apart from the
// picker so list filters, which never ask for it, need no permission or company
// context. The form is portaled to <body>, and React still bubbles its submit
// through the portal, so it must stop here or it would submit the parent document.
function QuickCreate({ kind, companyId, onCreated }) {
  const { has } = usePermissions();
  const { companies } = useCompany();
  const [open, setOpen] = useState(false);
  const { Form, permission, label } = QUICK_CREATE[kind];
  if (!companyId || !has(permission)) return null;
  const company = companies?.find((c) => String(c.id) === String(companyId));
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
        style={styles.createBtn}
      >
        <MdAdd size={16} /> New
      </button>
      {open &&
        createPortal(
          <div
            onSubmit={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Form
              companyId={companyId}
              fbrEnabled={company ? company.fbrEnabled !== false : undefined}
              onClose={() => setOpen(false)}
              onSaved={onCreated}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Generic single-select combobox with inline search — the common dropdown used
 * across the app for clients, suppliers, and any id/name list. Replaces plain
 * <select> so long lists (e.g. 500+ clients) are searchable.
 *
 * The dropdown is portaled to <body> and re-anchored on every ancestor scroll /
 * resize, so it never clips inside a scrollable modal and flips above when there
 * isn't room below. (Positioning/keyboard logic mirrors SearchableItemTypeSelect.)
 *
 * Props:
 *   items        — array of option objects
 *   value        — selected option's id (string | number) or "" / null for none
 *   onChange(id, item) — id is "" when cleared; item is the picked option or null
 *   valueKey     — option id field (default "id")
 *   labelKey     — option label field (default "name")
 *   searchKeys   — option fields to match against the query (default [labelKey])
 *   placeholder, style, disabled, loading, allowClear (default true)
 *   quickCreate  — "client" | "supplier": shows a "+" that creates one in `companyId`
 *                  and selects it. For forms only; list and report filters omit it.
 *   companyId    — the company the new record belongs to (required with quickCreate)
 *   onCreated(saved) — lets a parent that keeps its own list add the new record
 */
export default function SearchableSelect({
  items,
  value,
  onChange,
  valueKey = "id",
  labelKey = "name",
  searchKeys,
  placeholder = "Select…",
  style,
  disabled = false,
  loading = false,
  allowClear = true,
  id,
  ariaLabel,
  quickCreate,
  companyId,
  onCreated,
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [triggerRect, setTriggerRect] = useState(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const wrapperRef = useRef(null);

  const keys = useMemo(
    () => (searchKeys && searchKeys.length ? searchKeys : [labelKey]),
    [searchKeys, labelKey],
  );

  // Records created through the "+" this session, kept per kind and company so a
  // picker that switches either one never offers the previous scope's record.
  const createdScope = `${quickCreate}:${companyId}`;
  const [created, setCreated] = useState({ scope: createdScope, items: [] });
  const allItems = useMemo(() => {
    const base = items || [];
    if (created.scope !== createdScope) return base;
    return [
      ...created.items.filter(
        (c) => !base.some((b) => String(b[valueKey]) === String(c[valueKey])),
      ),
      ...base,
    ];
  }, [items, created, createdScope, valueKey]);

  const selected = useMemo(
    () => allItems.find((it) => String(it[valueKey]) === String(value)),
    [allItems, value, valueKey],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return allItems;
    return allItems.filter((it) =>
      keys.some((k) =>
        String(it[k] ?? "")
          .toLowerCase()
          .includes(term),
      ),
    );
  }, [allItems, query, keys]);

  useEffect(() => {
    const onMouseDown = (e) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
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

  const pick = (it) => {
    onChange?.(it ? it[valueKey] : "", it || null);
    setOpen(false);
  };
  const clear = (e) => {
    e.stopPropagation();
    onChange?.("", null);
  };
  const handleCreated = (saved) => {
    if (!saved?.[valueKey]) return;
    setCreated((prev) => ({
      scope: createdScope,
      items: [saved, ...(prev.scope === createdScope ? prev.items : [])],
    }));
    onCreated?.(saved);
    onChange?.(saved[valueKey], saved);
  };

  const onKeyDown = (e) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIdx >= 0 && highlightIdx < filtered.length) pick(filtered[highlightIdx]);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        display: "flex",
        alignItems: "stretch",
        gap: 6,
      }}
    >
      <button
        id={id}
        aria-label={ariaLabel || placeholder}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        type="button"
        ref={triggerRef}
        disabled={disabled || loading}
        onClick={() => setOpen((v) => !v)}
        style={{
          ...styles.trigger,
          flex: 1,
          minWidth: 0,
          ...(disabled || loading ? { opacity: 0.6, cursor: "not-allowed" } : {}),
          ...style,
        }}
      >
        <span style={styles.triggerLabel}>
          {loading ? (
            <span style={styles.placeholder}>Loading…</span>
          ) : selected ? (
            selected[labelKey]
          ) : (
            <span style={styles.placeholder}>{placeholder}</span>
          )}
        </span>
        {allowClear && selected && !disabled && (
          <span onClick={clear} style={styles.clearBtn} title="Clear">
            ×
          </span>
        )}
        <MdArrowDropDown size={18} style={{ flexShrink: 0, color: "#5f6d7e" }} />
      </button>
      {quickCreate && !disabled && !loading && (
        <QuickCreate kind={quickCreate} companyId={companyId} onCreated={handleCreated} />
      )}

      {open &&
        triggerRect &&
        createPortal(
          <div
            data-admin-popup=""
            ref={wrapperRef}
            style={styles.dropdown(triggerRect)}
            onKeyDown={onKeyDown}
          >
            <div style={styles.searchRow}>
              <MdSearch size={16} style={styles.searchIcon} />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlightIdx(0);
                }}
                onKeyDown={onKeyDown}
                style={styles.searchInput}
              />
            </div>
            <div
              id={listId}
              role="listbox"
              aria-label={ariaLabel || placeholder}
              style={styles.list}
            >
              {filtered.length === 0 && (
                <div style={styles.empty}>
                  {allItems.length === 0 ? "No options." : `No match for "${query}".`}
                </div>
              )}
              {filtered.map((it, idx) => (
                <div
                  key={it[valueKey]}
                  role="option"
                  aria-selected={String(it[valueKey]) === String(value)}
                  onMouseDown={() => pick(it)}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  style={{
                    ...styles.row,
                    backgroundColor: idx === highlightIdx ? "#e3f2fd" : "transparent",
                  }}
                >
                  {it[labelKey]}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

const styles = {
  trigger: {
    display: "flex",
    alignItems: "center",
    gap: "0.25rem",
    width: "100%",
    padding: "0.55rem 0.7rem",
    border: "1px solid #d0d7e2",
    borderRadius: 8,
    backgroundColor: "#f8f9fb",
    fontSize: "0.9rem",
    color: "#1a2332",
    cursor: "pointer",
    textAlign: "left",
    minHeight: 40,
  },
  triggerLabel: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  placeholder: { color: "#94a3b8" },
  createBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    flexShrink: 0,
    padding: "0 0.7rem",
    minHeight: 40,
    border: "1px solid #00897b",
    borderRadius: 8,
    backgroundColor: "#fff",
    color: "#00897b",
    fontSize: "0.82rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  clearBtn: {
    fontSize: "1.05rem",
    color: "#94a3b8",
    padding: "0 0.3rem",
    cursor: "pointer",
    lineHeight: 1,
  },
  dropdown: (rect) => {
    const spaceBelow = window.innerHeight - rect.bottom;
    const listHeight = 360;
    const flipAbove = spaceBelow < 220 && rect.top > spaceBelow;
    return {
      position: "fixed",
      top: flipAbove ? undefined : rect.bottom + 2,
      bottom: flipAbove ? window.innerHeight - rect.top + 2 : undefined,
      left: rect.left,
      width: Math.max(rect.width, 240),
      maxHeight: flipAbove
        ? Math.min(listHeight, rect.top - 10)
        : Math.min(listHeight, spaceBelow - 10),
      backgroundColor: "#fff",
      border: "1px solid #d0d7e2",
      borderRadius: 8,
      boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
      zIndex: 9999,
      display: "flex",
      flexDirection: "column",
    };
  },
  searchRow: {
    display: "flex",
    alignItems: "center",
    padding: "0.45rem 0.65rem",
    borderBottom: "1px solid #e8edf3",
    position: "relative",
  },
  searchIcon: { position: "absolute", left: 12, color: "#94a3b8" },
  searchInput: {
    width: "100%",
    padding: "0.35rem 0.35rem 0.35rem 1.85rem",
    border: "1px solid #e8edf3",
    borderRadius: 6,
    fontSize: "0.85rem",
    outline: "none",
    backgroundColor: "#f8f9fb",
  },
  list: { overflowY: "auto", flex: 1 },
  // Wrap long option labels instead of nowrap+ellipsis. Many real names share
  // a long prefix (e.g. "CHINA STATE CONSTRUCTION …") — truncating made every
  // row read identically so the user couldn't tell them apart. Full wrap keeps
  // the whole name visible; the distinguishing tail is never hidden.
  row: {
    padding: "0.5rem 0.7rem",
    cursor: "pointer",
    borderBottom: "1px solid #f0f4f8",
    fontSize: "0.88rem",
    color: "#1a2332",
    lineHeight: 1.35,
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },
  empty: { padding: "0.8rem", color: "#5f6d7e", fontSize: "0.85rem" },
};

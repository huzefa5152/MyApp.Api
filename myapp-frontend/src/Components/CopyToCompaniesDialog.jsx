import { useState, useMemo } from "react";
import { MdContentCopy, MdClose, MdBusiness, MdCheckCircle } from "react-icons/md";
import { formStyles } from "../theme";
import { Button, EmptyState } from "../ui/Kit";

// Generic multi-company picker dialog used by both Clients and Suppliers
// for the "copy into other companies" flow, and by the Common-Client /
// Common-Supplier edit screens for the "add to more companies" flow.
//
// Props:
//   open           — boolean
//   title          — heading text, e.g. "Copy client to other companies"
//   subjectLabel   — what is being copied, e.g. a client name
//   companies      — full list of accessible companies (id, name, brandName)
//   excludeIds     — company ids to hide / disable (e.g. source's own company,
//                    plus any companies the record is already in)
//   onConfirm      — async (selectedIds) => result | throws
//                    Should return the server's result so we can surface
//                    skip-reasons / counts. Throw to keep the dialog open.
//   onCancel       — () => void
//   busy           — boolean; disables actions while a parent op is in flight
export default function CopyToCompaniesDialog({
  open,
  title = "Copy to other companies",
  subjectLabel,
  companies = [],
  excludeIds = [],
  onConfirm,
  onCancel,
  busy = false,
}) {
  const [selected, setSelected] = useState(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  // Reset whenever the dialog opens with new context.
  useMemo(() => {
    if (open) {
      setSelected(new Set());
      setErrorMsg(null);
    }
  }, [open]);

  if (!open) return null;

  const excluded = new Set(excludeIds);
  const eligibleCompanies = companies.filter((c) => !excluded.has(c.id));

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      if (prev.size === eligibleCompanies.length) return new Set();
      return new Set(eligibleCompanies.map((c) => c.id));
    });
  };

  const handleConfirm = async () => {
    if (selected.size === 0) {
      setErrorMsg("Pick at least one company.");
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await onConfirm(Array.from(selected));
    } catch (err) {
      setErrorMsg(err?.response?.data?.message || err?.message || "Failed to copy.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-admin-backdrop="" style={formStyles.backdrop} onClick={() => !submitting && onCancel?.()}>
      <div data-admin-dialog="" style={{ ...formStyles.modal, maxWidth: 520, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div data-admin-header="" style={formStyles.header}>
          <h3 style={{ ...formStyles.title, display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
            <MdContentCopy size={20} aria-hidden="true" style={{ flexShrink: 0 }} />
            {title}
          </h3>
          <button data-admin-close=""
            type="button"
            aria-label="Close"
            style={formStyles.closeButton}
            onClick={() => !submitting && onCancel?.()}
            disabled={submitting}
            title="Close"
          >
            <MdClose size={20} />
          </button>
        </div>

        <div data-admin-body="" style={formStyles.body}>
          {subjectLabel && (
            <p style={styles.subjectLine}>
              <strong>{subjectLabel}</strong>
            </p>
          )}

          {eligibleCompanies.length === 0 ? (
            <EmptyState icon={MdBusiness} boxed={false}>
              No other companies available — this record already exists in every accessible company.
            </EmptyState>
          ) : (
            <>
              <div style={styles.toolbar}>
                <span style={{ fontSize: "var(--k-font-sm)", color: "#5f6d7e" }}>
                  {selected.size} of {eligibleCompanies.length} selected
                </span>
                <Button size="sm" variant="ghost" onClick={toggleAll}>
                  {selected.size === eligibleCompanies.length ? "Clear all" : "Select all"}
                </Button>
              </div>
              <div style={styles.list}>
                {eligibleCompanies.map((c) => {
                  const id = c.id;
                  const checked = selected.has(id);
                  return (
                    <label
                      key={id}
                      style={{
                        ...styles.row,
                        ...(checked ? styles.rowActive : {}),
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(id)}
                        disabled={submitting}
                      />
                      <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                        <strong>{c.brandName || c.name}</strong>
                        {c.brandName && c.name && c.brandName !== c.name && (
                          <span style={styles.muted}>  ·  {c.name}</span>
                        )}
                      </span>
                      {checked && <MdCheckCircle size={16} color="#0d47a1" />}
                    </label>
                  );
                })}
              </div>
            </>
          )}

          {errorMsg && <div style={{ ...formStyles.error, marginTop: "0.75rem", marginBottom: 0 }}>{errorMsg}</div>}
        </div>

        <div data-admin-footer="" style={formStyles.footer}>
          <button data-admin-close=""
            type="button"
            style={{ ...formStyles.button, ...formStyles.cancel }}
            onClick={() => onCancel?.()}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            style={{
              ...formStyles.button, ...formStyles.submit,
              display: "inline-flex", alignItems: "center", gap: 6,
              opacity: (submitting || busy || selected.size === 0) ? 0.6 : 1,
            }}
            onClick={handleConfirm}
            disabled={submitting || busy || selected.size === 0}
          >
            <MdContentCopy size={15} />
            {submitting ? "Copying..." : `Copy to ${selected.size || ""} ${selected.size === 1 ? "company" : "companies"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// Dialog chrome comes from the themed formStyles; only the picker list is local.
const styles = {
  subjectLine: { margin: "0 0 0.75rem", fontSize: "var(--k-font)", color: "#1a2332", overflowWrap: "anywhere" },
  toolbar: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: "0.5rem",
  },
  list: { display: "flex", flexDirection: "column", gap: "0.35rem" },
  row: {
    display: "flex", alignItems: "center", gap: "0.6rem",
    minHeight: "var(--k-h)", padding: "0.4rem 0.75rem", borderRadius: 8,
    border: "1px solid #e8edf3", cursor: "pointer",
    fontSize: "var(--k-font)", color: "#1a2332", userSelect: "none",
    transition: "background-color 0.15s, border-color 0.15s",
  },
  rowActive: { borderColor: "#0d47a1", backgroundColor: "#e3f2fd" },
  muted: { color: "#94a3b8", fontWeight: 400, fontSize: "var(--k-font-sm)" },
};
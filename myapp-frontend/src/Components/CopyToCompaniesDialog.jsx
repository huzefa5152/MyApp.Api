import { useState, useMemo } from "react";
import { MdContentCopy, MdClose, MdBusiness, MdCheckCircle } from "react-icons/md";

// Generic multi-company picker dialog used by both Clients and Suppliers
// for the "copy into other companies" flow, and by the Common-Client /
// Common-Supplier edit screens for the "add to more companies" flow.
//
// Props:
//   open           — boolean
//   title          — heading text, e.g. "Copy client to other companies"
//   subjectLabel   — what is being copied, e.g. "MEKO DENIM MILLS"
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
    <div style={styles.backdrop} onClick={() => !submitting && onCancel?.()}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <MdContentCopy size={20} color="#fff" />
          <h3 style={styles.title}>{title}</h3>
          <button
            type="button"
            aria-label="Close"
            style={styles.closeBtn}
            onClick={() => !submitting && onCancel?.()}
            disabled={submitting}
            title="Close"
          >
            <MdClose size={20} color="#fff" />
          </button>
        </div>

        <div style={styles.body}>
          {subjectLabel && (
            <p style={styles.subjectLine}>
              <strong>{subjectLabel}</strong>
            </p>
          )}

          {eligibleCompanies.length === 0 ? (
            <div style={styles.emptyState}>
              <MdBusiness size={32} color="#cbd5e1" />
              <p style={{ margin: "0.5rem 0 0", color: "#5f6d7e", fontSize: "0.88rem" }}>
                No other companies available — this record already exists in every accessible company.
              </p>
            </div>
          ) : (
            <>
              <div style={styles.toolbar}>
                <span style={{ fontSize: "0.82rem", color: "#5f6d7e" }}>
                  {selected.size} of {eligibleCompanies.length} selected
                </span>
                <button type="button" style={styles.linkBtn} onClick={toggleAll}>
                  {selected.size === eligibleCompanies.length ? "Clear all" : "Select all"}
                </button>
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
                      <span style={{ flex: 1 }}>
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

          {errorMsg && <div style={styles.error}>{errorMsg}</div>}
        </div>

        <div style={styles.footer}>
          <button
            style={styles.btnSecondary}
            onClick={() => onCancel?.()}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            style={{ ...styles.btnPrimary, opacity: (submitting || busy || selected.size === 0) ? 0.6 : 1 }}
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

const styles = {
  backdrop: {
    position: "fixed", inset: 0, backgroundColor: "rgba(15,20,30,0.55)",
    backdropFilter: "blur(4px)", display: "flex", alignItems: "center",
    justifyContent: "center", zIndex: 1100, padding: "2vh 1rem",
  },
  modal: {
    backgroundColor: "#fff", borderRadius: 14, width: "100%",
    maxWidth: 520, maxHeight: "92vh", boxShadow: "0 20px 60px rgba(13,71,161,0.2)",
    display: "flex", flexDirection: "column", overflow: "hidden",
  },
  header: {
    background: "linear-gradient(135deg, #0d47a1, #00897b)",
    padding: "0.9rem 1.25rem",
    display: "flex", alignItems: "center", gap: "0.5rem",
  },
  title: { margin: 0, flex: 1, fontSize: "1.02rem", fontWeight: 700, color: "#fff" },
  closeBtn: {
    background: "rgba(255,255,255,0.18)", border: "none", color: "#fff",
    cursor: "pointer", width: 28, height: 28, borderRadius: 6,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
  },
  body: { padding: "1rem 1.25rem 0.5rem", overflowY: "auto", flex: 1 },
  subjectLine: { margin: "0 0 0.75rem", fontSize: "0.88rem", color: "#1a2332" },
  emptyState: {
    display: "flex", flexDirection: "column", alignItems: "center",
    padding: "1.25rem", textAlign: "center",
  },
  toolbar: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: "0.5rem",
  },
  linkBtn: {
    background: "none", border: "none", color: "#0d47a1",
    fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", padding: 0,
  },
  list: { display: "flex", flexDirection: "column", gap: "0.35rem" },
  row: {
    display: "flex", alignItems: "center", gap: "0.6rem",
    padding: "0.55rem 0.75rem", borderRadius: 8,
    border: "1px solid #e8edf3", cursor: "pointer",
    fontSize: "0.9rem", color: "#1a2332", userSelect: "none",
    transition: "background-color 0.15s, border-color 0.15s",
  },
  rowActive: { borderColor: "#0d47a1", backgroundColor: "#e3f2fd" },
  muted: { color: "#94a3b8", fontWeight: 400, fontSize: "0.82rem" },
  error: {
    marginTop: "0.75rem", padding: "0.55rem 0.75rem",
    backgroundColor: "#fff0f1", border: "1px solid #dc354540",
    color: "#c62828", borderRadius: 8, fontSize: "0.82rem",
  },
  footer: {
    display: "flex", justifyContent: "flex-end", gap: "0.5rem",
    padding: "0.85rem 1.25rem", borderTop: "1px solid #e8edf3", backgroundColor: "#f8f9fb",
  },
  btnPrimary: {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "0.45rem 1rem", borderRadius: 8, border: "none",
    background: "linear-gradient(135deg, #0d47a1, #1565c0)", color: "#fff",
    fontSize: "0.86rem", fontWeight: 600, cursor: "pointer",
  },
  btnSecondary: {
    padding: "0.45rem 1rem", borderRadius: 8, border: "1px solid #d0d7e2",
    backgroundColor: "#fff", color: "#5f6d7e",
    fontSize: "0.86rem", fontWeight: 600, cursor: "pointer",
  },
};

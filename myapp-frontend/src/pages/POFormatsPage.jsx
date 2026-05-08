import { useState, useEffect, useCallback } from "react";
import { MdAdd, MdEdit, MdDelete, MdDescription, MdWarning, MdInfoOutline, MdBusiness } from "react-icons/md";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { listPoFormats, getPoFormat, deletePoFormat } from "../api/poFormatApi";
import POFormatForm from "../Components/POFormatForm";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  danger: "#dc3545",
  dangerLight: "#fff0f1",
  success: "#28a745",
  successLight: "#e8f5e9",
  warning: "#f57c00",
  warningLight: "#fff3e0",
  primary: "#0d47a1",
  primaryLight: "#e3f2fd",
};

export default function POFormatsPage() {
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canCreate = has("poformats.manage.create");
  const canUpdate = has("poformats.manage.update");
  const canDelete = has("poformats.manage.delete");
  const [formats, setFormats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");

  // PO Formats are now keyed off the Common Client GROUP, not the
  // selling tenant. One format per legal entity, applies in every
  // company that has that client. So the company dropdown that used
  // to scope this page is gone — we list ALL formats regardless of
  // CompanyId / ClientId, and the form picks a Common Client.
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await listPoFormats({});
      setFormats(res.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load PO formats.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (format) => {
    const ok = await confirm({
      title: `Delete PO format "${format.name}"?`,
      message: "Future PDFs with this layout will no longer auto-parse — they'll need a fresh format wizard run.",
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await deletePoFormat(format.id);
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to delete.");
    }
  };

  const handleEdit = async (format) => {
    // The list endpoint returns a slim DTO (no RuleSetJson / no keyword
    // signature) — fetch the full format so the modal can pre-fill the
    // 5 label/header strings from the stored rule-set.
    try {
      const { data } = await getPoFormat(format.id);
      setEditing(data);
      setShowForm(true);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load format.");
    }
  };

  const handleAdd = () => {
    setEditing(null);
    setShowForm(true);
  };

  const handleSaved = () => {
    setShowForm(false);
    setEditing(null);
    load();
  };

  return (
    <div className="pof-page" style={styles.page}>
      <div className="pof-header">
        <div className="pof-header__title-block">
          <h1 className="pof-header__title">PO Formats</h1>
          <p className="pof-header__subtitle">
            One PO format per client (across ALL companies). Configure once and the same layout parses automatically whenever any tenant receives a PO from that client.
          </p>
        </div>
        {canCreate && (
          <button className="pof-header__add" onClick={handleAdd}>
            <MdAdd size={18} /> Add PO Format
          </button>
        )}
      </div>

      {error && (
        <div style={styles.errorAlert}>
          <MdWarning size={16} /> {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: "2rem", textAlign: "center", color: colors.textSecondary }}>Loading…</div>
      ) : formats.length === 0 ? (
        <div style={styles.emptyCard}>
          <MdDescription size={36} color={colors.textSecondary} />
          <h3 style={{ margin: "0.75rem 0 0.25rem", color: colors.textPrimary }}>No PO formats yet</h3>
          <p style={{ margin: "0 0 1rem", color: colors.textSecondary, fontSize: "0.9rem" }}>
            Add a format for each of your clients. You'll need a sample PDF and the column header names.
          </p>
          {canCreate && (
            <button style={styles.addBtn} onClick={handleAdd}>
              <MdAdd size={18} /> Add your first PO format
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop / tablet — table */}
          <div className="pof-table" style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Client</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Last updated</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {formats.map((f) => (
                  <tr key={f.id}>
                    <td style={styles.td}>
                      <div style={{ fontWeight: 600, color: colors.textPrimary }}>{f.name}</div>
                      <div style={{ fontSize: "0.75rem", color: colors.textSecondary }}>v{f.currentVersion}</div>
                    </td>
                    <td style={styles.td}>
                      {/* Prefer the ClientGroup display name — that's the
                          canonical "client" the format applies to (across
                          every tenant). Fallback to per-tenant ClientName
                          for legacy formats not yet group-bound. */}
                      {f.clientGroupName ? (
                        <span style={styles.chip}>{f.clientGroupName}</span>
                      ) : f.clientName ? (
                        <span style={styles.chip}>{f.clientName}</span>
                      ) : (
                        <span style={{ ...styles.chip, ...styles.chipMuted }}>Unassigned</span>
                      )}
                    </td>
                    <td style={styles.td}>
                      {f.isActive ? (
                        <span style={{ ...styles.chip, ...styles.chipSuccess }}>Active</span>
                      ) : (
                        <span style={{ ...styles.chip, ...styles.chipMuted }}>Inactive</span>
                      )}
                    </td>
                    <td style={{ ...styles.td, color: colors.textSecondary, fontSize: "0.85rem" }}>
                      {new Date(f.updatedAt).toLocaleDateString()}
                    </td>
                    <td style={{ ...styles.td, textAlign: "right" }}>
                      {canUpdate && (
                        <button style={styles.iconBtn} onClick={() => handleEdit(f)} title="Edit"><MdEdit size={16} /></button>
                      )}
                      {canDelete && (
                        <button style={{ ...styles.iconBtn, ...styles.iconBtnDanger }} onClick={() => handleDelete(f)} title="Delete"><MdDelete size={16} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile — stacked cards */}
          <div className="pof-cards">
            {formats.map((f) => {
              const clientLabel = f.clientGroupName || f.clientName;
              return (
                <div key={f.id} className="pof-card">
                  <div className="pof-card__top">
                    <div className="pof-card__title">
                      <div className="pof-card__name">{f.name}</div>
                      <div className="pof-card__version">v{f.currentVersion}</div>
                    </div>
                    {f.isActive ? (
                      <span className="pof-card__status pof-card__status--active">Active</span>
                    ) : (
                      <span className="pof-card__status pof-card__status--muted">Inactive</span>
                    )}
                  </div>

                  <div className="pof-card__meta">
                    <div className="pof-card__field">
                      <span className="pof-card__field-label">Client</span>
                      {clientLabel ? (
                        <span className="pof-card__chip">{clientLabel}</span>
                      ) : (
                        <span className="pof-card__chip pof-card__chip--muted">Unassigned</span>
                      )}
                    </div>
                    <div className="pof-card__field">
                      <span className="pof-card__field-label">Updated</span>
                      <span className="pof-card__field-value">
                        {new Date(f.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  {(canUpdate || canDelete) && (
                    <div className="pof-card__actions">
                      {canUpdate && (
                        <button className="pof-card__edit" onClick={() => handleEdit(f)}>
                          <MdEdit size={14} /> Edit
                        </button>
                      )}
                      {canDelete && (
                        <button className="pof-card__delete" onClick={() => handleDelete(f)}>
                          <MdDelete size={14} /> Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {showForm && (
        <POFormatForm
          format={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

const styles = {
  page: { padding: "1.5rem", maxWidth: 1200, margin: "0 auto" },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" },
  title: { margin: 0, fontSize: "1.5rem", fontWeight: 700, color: colors.textPrimary },
  companyRow: { display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" },
  subtitle: { margin: "0.25rem 0 0", color: colors.textSecondary, fontSize: "0.9rem", maxWidth: 720 },
  addBtn: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.6rem 1rem", borderRadius: 8, border: "none", backgroundColor: colors.primary, color: "white", fontSize: "0.9rem", fontWeight: 600, cursor: "pointer" },
  // Card wraps the PO formats table; overflowX makes the 5-column
  // grid (Name / Client / Status / Last updated / Actions) scroll
  // horizontally on mobile instead of getting cut off.
  card: { backgroundColor: "white", borderRadius: 10, border: `1px solid ${colors.cardBorder}`, overflowX: "auto", WebkitOverflowScrolling: "touch" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "0.75rem 1rem", borderBottom: `1px solid ${colors.cardBorder}`, fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textSecondary, fontWeight: 600, backgroundColor: colors.inputBg },
  td: { padding: "0.85rem 1rem", borderBottom: `1px solid ${colors.cardBorder}`, fontSize: "0.9rem", color: colors.textPrimary, verticalAlign: "top" },
  chip: { display: "inline-block", padding: "0.2rem 0.6rem", borderRadius: 12, fontSize: "0.78rem", fontWeight: 600, backgroundColor: colors.primaryLight, color: colors.primary },
  chipSuccess: { backgroundColor: colors.successLight, color: colors.success },
  chipMuted: { backgroundColor: "#f2f4f7", color: colors.textSecondary },
  iconBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0.4rem", borderRadius: 6, border: "none", backgroundColor: "transparent", color: colors.textSecondary, cursor: "pointer", marginLeft: "0.25rem" },
  iconBtnDanger: { color: colors.danger },
  emptyCard: { backgroundColor: "white", border: `2px dashed ${colors.cardBorder}`, borderRadius: 10, padding: "3rem 2rem", textAlign: "center" },
  errorAlert: { display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.75rem 1rem", borderRadius: 8, backgroundColor: colors.dangerLight, color: colors.danger, marginBottom: "1rem", fontSize: "0.88rem", fontWeight: 500 },
};

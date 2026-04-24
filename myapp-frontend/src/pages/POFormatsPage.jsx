import { useState, useEffect, useCallback } from "react";
import { MdAdd, MdEdit, MdDelete, MdDescription, MdWarning, MdInfoOutline, MdBusiness } from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { listPoFormats, getPoFormat, deletePoFormat } from "../api/poFormatApi";
import POFormatForm from "../Components/POFormatForm";
import { dropdownStyles } from "../theme";

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
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has } = usePermissions();
  const canCreate = has("poformats.manage.create");
  const canUpdate = has("poformats.manage.update");
  const canDelete = has("poformats.manage.delete");
  const [formats, setFormats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!selectedCompany) return;
    setLoading(true);
    setError("");
    try {
      const res = await listPoFormats({ companyId: selectedCompany.id });
      setFormats(res.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load PO formats.");
    } finally {
      setLoading(false);
    }
  }, [selectedCompany]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (format) => {
    if (!confirm(`Delete PO format "${format.name}"? Future PDFs with this layout will no longer auto-parse.`)) return;
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

  if (!selectedCompany) {
    return (
      <div style={styles.page}>
        <div style={styles.emptyCard}>
          <MdInfoOutline size={28} color={colors.textSecondary} />
          <p style={{ margin: "0.5rem 0 0", color: colors.textSecondary }}>
            Select a company first to manage its PO formats.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={{ flex: 1 }}>
          <h1 style={styles.title}>PO Formats</h1>
          <p style={styles.subtitle}>
            Each client's purchase-order layout is saved once. Future PDFs with the same layout parse automatically — no AI, no retry.
          </p>
        </div>
        {canCreate && (
          <button style={styles.addBtn} onClick={handleAdd}>
            <MdAdd size={18} /> Add PO Format
          </button>
        )}
      </div>

      {/* Company selector — scopes every format + client dropdown below */}
      <div style={styles.companyRow}>
        <MdBusiness size={20} color={colors.primary} />
        <select
          style={dropdownStyles.base}
          value={selectedCompany?.id || ""}
          onChange={(e) =>
            setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))
          }
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.brandName || c.name}</option>
          ))}
        </select>
        <span style={{ fontSize: "0.82rem", color: colors.textSecondary }}>
          Formats below are scoped to this company.
        </span>
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
        <div style={styles.card}>
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
                    {f.clientName ? (
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
      )}

      {showForm && (
        <POFormatForm
          companyId={selectedCompany.id}
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
  card: { backgroundColor: "white", borderRadius: 10, border: `1px solid ${colors.cardBorder}`, overflow: "hidden" },
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

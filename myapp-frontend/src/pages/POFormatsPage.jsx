import { useState, useEffect, useCallback, useRef } from "react";
import { MdAdd, MdEdit, MdDelete, MdDescription, MdWarning } from "react-icons/md";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { listPoFormats, getPoFormat, deletePoFormat } from "../api/poFormatApi";
import { useCompany } from "../contexts/CompanyContext";
import POFormatForm from "../Components/POFormatForm";
import { PageHeader, CompanyPicker, Button, IconButton, TableWrap, EmptyState, Loading, Alert } from "../ui/Kit";

const colors = {
  success: "#28a745",
  successLight: "#e8f5e9",
  primary: "var(--k-blue)",
  primaryLight: "#e3f2fd",
};

export default function POFormatsPage() {
  const { selectedCompany } = useCompany();
  return (
    <div style={styles.page}>
      {selectedCompany ? (
        <CompanyPOFormats key={selectedCompany.id} company={selectedCompany} />
      ) : (
        <>
          <CompanyPicker />
          <EmptyState icon={MdDescription}>No company access is configured for your account.</EmptyState>
        </>
      )}
    </div>
  );
}

function CompanyPOFormats({ company }) {
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canCreate = has("poformats.manage.create");
  const canUpdate = has("poformats.manage.update");
  const canDelete = has("poformats.manage.delete");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [formats, setFormats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await listPoFormats({ companyId: company.id });
      if (mounted.current) setFormats(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || "Failed to load PO formats.");
    } finally {
      setLoading(false);
    }
  }, [company.id]);

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
      setError(err.response?.data?.error || err.response?.data?.message || "Failed to delete.");
    }
  };

  const handleEdit = async (format) => {
    // The list endpoint returns a slim DTO (no RuleSetJson / no keyword
    // signature) — fetch the full format so the modal can pre-fill the
    // 5 label/header strings from the stored rule-set.
    try {
      const { data } = await getPoFormat(format.id);
      if (!mounted.current) return;
      setEditing(data);
      setShowForm(true);
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || "Failed to load format.");
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
    <>
      <PageHeader
        icon={MdDescription}
        tone="blue"
        title="PO Formats"
        subtitle={`One PO format per client in ${company.name}. Formats and PDF matching are private to this company.`}
        actions={canCreate ? (
          <Button variant="primary" icon={MdAdd} onClick={handleAdd}>Add PO Format</Button>
        ) : null}
      />

      <CompanyPicker />

      {error && (
        <Alert tone="error" icon={MdWarning}>{error}</Alert>
      )}

      {loading ? (
        <Loading>Loading…</Loading>
      ) : formats.length === 0 ? (
        <EmptyState
          icon={MdDescription}
          title="No PO formats yet"
          action={canCreate ? (
            <Button variant="primary" icon={MdAdd} onClick={handleAdd} style={{ marginTop: "0.6rem" }}>Add your first PO format</Button>
          ) : null}
        >
          Add a format for each of your clients. You'll need a sample PDF and the column header names.
        </EmptyState>
      ) : (
        <>
          {/* Desktop / tablet — table */}
          <TableWrap className="pof-table">
            <table className="k-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Last updated</th>
                  <th className="k-num">Actions</th>
                </tr>
              </thead>
              <tbody>
                {formats.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{f.name}</div>
                      <div className="k-muted" style={{ fontSize: "0.75rem" }}>v{f.currentVersion}</div>
                    </td>
                    <td>
                      {f.clientName ? (
                        <span style={styles.chip}>{f.clientName}</span>
                      ) : (
                        <span style={{ ...styles.chip, ...styles.chipMuted }}>Unassigned</span>
                      )}
                    </td>
                    <td>
                      {f.isActive ? (
                        <span style={{ ...styles.chip, ...styles.chipSuccess }}>Active</span>
                      ) : (
                        <span style={{ ...styles.chip, ...styles.chipMuted }}>Inactive</span>
                      )}
                    </td>
                    <td className="k-muted">
                      {new Date(f.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="k-actions">
                      {canUpdate && (
                        <IconButton icon={MdEdit} size={16} label="Edit" onClick={() => handleEdit(f)} />
                      )}
                      {canDelete && (
                        <IconButton danger icon={MdDelete} size={16} label="Delete" onClick={() => handleDelete(f)} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>

          {/* Mobile — stacked cards */}
          <div className="pof-cards">
            {formats.map((f) => {
              const clientLabel = f.clientName;
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
          companyId={company.id}
          companyName={company.name}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}

const styles = {
  page: { maxWidth: 1200, margin: "0 auto" },
  chip: { display: "inline-block", padding: "0.2rem 0.6rem", borderRadius: 12, fontSize: "0.78rem", fontWeight: 600, backgroundColor: colors.primaryLight, color: colors.primary },
  chipSuccess: { backgroundColor: colors.successLight, color: colors.success },
  chipMuted: { backgroundColor: "#f2f4f7", color: "var(--k-muted)" },
};

import { useState, useEffect } from "react";
import { MdTune, MdAdd, MdEdit, MdDelete, MdLock } from "react-icons/md";
import { getFbrLookups, createFbrLookup, updateFbrLookup, deleteFbrLookup } from "../api/fbrLookupApi";
import { formStyles, modalSizes } from "../theme";
import { notify } from "../utils/notify";
import { useConfirm } from "../Components/ConfirmDialog";
import { usePermissions } from "../contexts/PermissionsContext";
import { PageHeader, Button, IconButton, Toolbar, SearchBox, Card, EmptyState } from "../ui/Kit";

const CATEGORIES = [
  "Province",
  "BusinessActivity",
  "Sector",
  "RegistrationType",
  "Environment",
  "DocumentType",
  "PaymentMode",
];

const categoryLabels = {
  Province: "Province",
  BusinessActivity: "Business Activity",
  Sector: "Sector",
  RegistrationType: "Registration Type",
  Environment: "Environment",
  DocumentType: "Document Type",
  PaymentMode: "Payment Mode",
};

export default function FbrSettingsPage() {
  const confirm = useConfirm();
  const { has } = usePermissions();
  const canManage = has("fbr.config.update");
  const [lookups, setLookups] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [formData, setFormData] = useState({ category: "", code: "", label: "", sortOrder: 0 });
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");

  const fetchAll = async () => {
    try {
      const { data } = await getFbrLookups();
      setLookups(data);
    } catch {
      notify("Failed to load FBR settings.", "error");
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const openAdd = (category = "") => {
    setEditItem(null);
    const maxSort = lookups.filter((l) => l.category === (category || filterCategory)).reduce((m, l) => Math.max(m, l.sortOrder), 0);
    setFormData({ category: category || filterCategory || "", code: "", label: "", sortOrder: maxSort + 1 });
    setError("");
    setShowForm(true);
  };

  const openEdit = (item) => {
    setEditItem(item);
    setFormData({ category: item.category, code: item.code, label: item.label, sortOrder: item.sortOrder });
    setError("");
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!formData.category) return setError("Category is required.");
    if (!formData.code.trim()) return setError("Code is required.");
    if (!formData.label.trim()) return setError("Label is required.");
    try {
      if (editItem) {
        await updateFbrLookup(editItem.id, { ...formData, isActive: true });
      } else {
        await createFbrLookup({ ...formData, isActive: true });
      }
      setShowForm(false);
      fetchAll();
      notify(editItem ? "Updated successfully." : "Created successfully.", "success");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to save.");
    }
  };

  const handleDelete = async (item) => {
    const ok = await confirm({
      title: "Delete FBR Lookup?",
      message: `Delete "${item.label}" from ${categoryLabels[item.category] || item.category}?`,
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await deleteFbrLookup(item.id);
      fetchAll();
      notify("Deleted successfully.", "success");
    } catch (err) {
      notify(err.response?.data?.message || "Failed to delete.", "error");
    }
  };

  const filtered = lookups.filter((l) => {
    if (filterCategory && l.category !== filterCategory) return false;
    if (search) {
      const term = search.toLowerCase();
      return l.label.toLowerCase().includes(term) || l.code.toLowerCase().includes(term);
    }
    return true;
  });

  const grouped = CATEGORIES.reduce((acc, cat) => {
    const items = filtered.filter((l) => l.category === cat);
    if (items.length > 0 || (!filterCategory || filterCategory === cat)) acc[cat] = items;
    return acc;
  }, {});

  if (!canManage) {
    return (
      <EmptyState icon={MdLock} title="Access denied">
        You don&apos;t have permission to manage FBR settings.
      </EmptyState>
    );
  }

  return (
    <div>
      <PageHeader
        icon={MdTune}
        tone="brand"
        title="FBR Settings"
        subtitle={`${lookups.length} lookup value${lookups.length !== 1 ? "s" : ""} configured`}
        actions={<Button variant="primary" icon={MdAdd} onClick={() => openAdd()}>New Value</Button>}
      />

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search..." />
        <select className="k-select" aria-label="Category" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{categoryLabels[c] || c}</option>
          ))}
        </select>
      </Toolbar>

      {Object.keys(grouped).length === 0 ? (
        <EmptyState>No lookup values found.</EmptyState>
      ) : (
        Object.entries(grouped).map(([cat, items]) => (
          <Card
            key={cat}
            title={categoryLabels[cat] || cat}
            actions={<Button size="sm" icon={MdAdd} onClick={() => openAdd(cat)}>Add</Button>}
          >
            {items.length === 0 ? (
              <p style={styles.emptyCat}>No values in this category.</p>
            ) : (
              <div style={styles.list}>
                {items.sort((a, b) => a.sortOrder - b.sortOrder).map((item) => (
                  <div key={item.id} style={styles.item}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: 1, minWidth: 0 }}>
                      <span style={styles.sortBadge}>{item.sortOrder}</span>
                      <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                        <span style={styles.itemLabel}>{item.label}</span>
                        {item.code !== item.label && (
                          <span style={styles.itemCode}> ({item.code})</span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.25rem" }}>
                      <IconButton label="Edit" icon={MdEdit} size={16} onClick={() => openEdit(item)} />
                      <IconButton label="Delete" icon={MdDelete} size={16} danger onClick={() => handleDelete(item)} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))
      )}

      {showForm && (
        // Backdrop click is a no-op so a stray click can't drop the FBR
        // lookup form before the operator finishes typing.
        <div data-admin-backdrop="" style={formStyles.backdrop}>
          <div data-admin-dialog="" style={{ ...formStyles.modal, maxWidth: `${modalSizes.sm}px`, cursor: "default" }}>
            <div style={formStyles.header}>
              <h5 style={formStyles.title}>{editItem ? "Edit Lookup Value" : "New Lookup Value"}</h5>
              <button data-admin-close="" type="button" style={formStyles.closeButton} onClick={() => setShowForm(false)} aria-label="Close">&times;</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={formStyles.body}>
                {error && <div style={formStyles.error}>{error}</div>}

                <div style={formStyles.formGroup}>
                  <label style={formStyles.label}>Category *</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    style={formStyles.input}
                    disabled={!!editItem}
                  >
                    <option value="">Select...</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{categoryLabels[c] || c}</option>
                    ))}
                  </select>
                </div>

                <div className="form-grid-2col" style={formStyles.formGroup}>
                  <div>
                    <label style={formStyles.label}>Code *</label>
                    <input type="text" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} style={formStyles.input} placeholder="e.g. 7 or Registered" />
                  </div>
                  <div>
                    <label style={formStyles.label}>Sort Order</label>
                    <input type="number" value={formData.sortOrder} onChange={(e) => setFormData({ ...formData, sortOrder: Number(e.target.value) })} style={formStyles.input} min={0} />
                  </div>
                </div>

                <div style={formStyles.formGroup}>
                  <label style={formStyles.label}>Label *</label>
                  <input type="text" value={formData.label} onChange={(e) => setFormData({ ...formData, label: e.target.value })} style={formStyles.input} placeholder="Display name" autoFocus />
                </div>
              </div>
              <div style={formStyles.footer}>
                <button data-admin-close="" type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" style={{ ...formStyles.button, ...formStyles.submit }}>{editItem ? "Update" : "Create"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  emptyCat: { margin: 0, color: "var(--k-muted)", fontSize: "var(--k-font-sm)" },
  list: { display: "flex", flexDirection: "column", gap: "0.35rem" },
  item: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", padding: "0.35rem 0.5rem 0.35rem 0.85rem", minHeight: "var(--k-h)", borderRadius: "var(--k-radius)", border: "1px solid var(--k-line)", backgroundColor: "var(--k-surface)" },
  sortBadge: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 6, backgroundColor: "#e3f2fd", color: "var(--k-blue)", fontSize: "0.78rem", fontWeight: 700, flexShrink: 0 },
  itemLabel: { fontWeight: 600, fontSize: "var(--k-font)", color: "var(--k-ink)" },
  itemCode: { fontSize: "var(--k-font-sm)", color: "var(--k-muted)" },
};

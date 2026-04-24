import { useState, useEffect } from "react";
import { MdTune, MdAdd, MdEdit, MdDelete, MdSearch, MdLock } from "react-icons/md";
import { getFbrLookups, createFbrLookup, updateFbrLookup, deleteFbrLookup } from "../api/fbrLookupApi";
import { formStyles } from "../theme";
import { notify } from "../utils/notify";
import { useConfirm } from "../Components/ConfirmDialog";
import { usePermissions } from "../contexts/PermissionsContext";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  danger: "#dc3545",
};

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
      <div style={{ textAlign: "center", padding: "4rem 1.5rem", background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 14 }}>
        <MdLock style={{ fontSize: "2.5rem", color: colors.textSecondary }} />
        <h3 style={{ margin: "0.75rem 0 0.25rem" }}>Access denied</h3>
        <p style={{ margin: 0, color: colors.textSecondary, fontSize: "0.9rem" }}>You don&apos;t have permission to manage FBR settings.</p>
      </div>
    );
  }

  return (
    <div>
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
          <div style={styles.headerIcon}><MdTune size={24} color="#fff" /></div>
          <div>
            <h2 style={styles.title}>FBR Settings</h2>
            <p style={styles.subtitle}>{lookups.length} lookup value{lookups.length !== 1 ? "s" : ""} configured</p>
          </div>
        </div>
        <button style={styles.addBtn} onClick={() => openAdd()}>
          <MdAdd size={18} /> New Value
        </button>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
        <div style={styles.searchWrap}>
          <MdSearch size={18} style={styles.searchIcon} />
          <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} style={styles.searchInput} />
        </div>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} style={styles.filterSelect}>
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{categoryLabels[c] || c}</option>
          ))}
        </select>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <p style={{ color: colors.textSecondary, textAlign: "center", padding: "2rem" }}>No lookup values found.</p>
      ) : (
        Object.entries(grouped).map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: "1.5rem" }}>
            <div style={styles.categoryHeader}>
              <h3 style={styles.categoryTitle}>{categoryLabels[cat] || cat}</h3>
              <button style={styles.catAddBtn} onClick={() => openAdd(cat)}>
                <MdAdd size={16} /> Add
              </button>
            </div>
            {items.length === 0 ? (
              <p style={{ color: colors.textSecondary, fontSize: "0.85rem", padding: "0.5rem 0" }}>No values in this category.</p>
            ) : (
              <div style={styles.list}>
                {items.sort((a, b) => a.sortOrder - b.sortOrder).map((item) => (
                  <div key={item.id} style={styles.item}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: 1 }}>
                      <span style={styles.sortBadge}>{item.sortOrder}</span>
                      <div>
                        <span style={styles.itemLabel}>{item.label}</span>
                        {item.code !== item.label && (
                          <span style={styles.itemCode}> ({item.code})</span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                      <button style={styles.editBtn} onClick={() => openEdit(item)}><MdEdit size={16} /></button>
                      <button style={styles.deleteBtn} onClick={() => handleDelete(item)}><MdDelete size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
      )}

      {showForm && (
        <div style={formStyles.backdrop} onClick={() => setShowForm(false)}>
          <div style={{ ...formStyles.modal, maxWidth: 420, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
            <div style={formStyles.header}>
              <h5 style={formStyles.title}>{editItem ? "Edit Lookup Value" : "New Lookup Value"}</h5>
              <button style={formStyles.closeButton} onClick={() => setShowForm(false)}>&times;</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={formStyles.body}>
                {error && <div style={{ color: colors.danger, fontSize: "0.85rem", marginBottom: "0.75rem" }}>{error}</div>}

                <div style={{ marginBottom: "0.75rem" }}>
                  <label style={styles.formLabel}>Category *</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    style={styles.formInput}
                    disabled={!!editItem}
                  >
                    <option value="">Select...</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{categoryLabels[c] || c}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
                  <div>
                    <label style={styles.formLabel}>Code *</label>
                    <input type="text" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} style={styles.formInput} placeholder="e.g. 7 or Registered" />
                  </div>
                  <div>
                    <label style={styles.formLabel}>Sort Order</label>
                    <input type="number" value={formData.sortOrder} onChange={(e) => setFormData({ ...formData, sortOrder: Number(e.target.value) })} style={styles.formInput} min={0} />
                  </div>
                </div>

                <div style={{ marginBottom: "0.75rem" }}>
                  <label style={styles.formLabel}>Label *</label>
                  <input type="text" value={formData.label} onChange={(e) => setFormData({ ...formData, label: e.target.value })} style={styles.formInput} placeholder="Display name" autoFocus />
                </div>
              </div>
              <div style={formStyles.footer}>
                <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={() => setShowForm(false)}>Cancel</button>
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
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" },
  headerIcon: { width: 42, height: 42, borderRadius: 12, background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, display: "flex", alignItems: "center", justifyContent: "center" },
  title: { fontSize: "1.45rem", fontWeight: 800, color: colors.textPrimary, margin: 0 },
  subtitle: { fontSize: "0.82rem", color: colors.textSecondary, margin: 0 },
  addBtn: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 1.2rem", background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, color: "#fff", border: "none", borderRadius: 10, fontSize: "0.88rem", fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 14px rgba(13,71,161,0.25)" },
  searchWrap: { position: "relative", flex: 1, maxWidth: 300 },
  searchIcon: { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" },
  searchInput: { width: "100%", padding: "0.55rem 0.75rem 0.55rem 2.3rem", border: "1px solid #d0d7e2", borderRadius: 10, fontSize: "0.88rem", backgroundColor: "#f8f9fb", color: colors.textPrimary, outline: "none", boxSizing: "border-box" },
  filterSelect: { padding: "0.55rem 0.75rem", border: "1px solid #d0d7e2", borderRadius: 10, fontSize: "0.88rem", backgroundColor: "#f8f9fb", color: colors.textPrimary, outline: "none" },
  categoryHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem", paddingBottom: "0.4rem", borderBottom: `2px solid ${colors.cardBorder}` },
  categoryTitle: { fontSize: "1rem", fontWeight: 700, color: colors.blue, margin: 0 },
  catAddBtn: { display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.3rem 0.7rem", background: "transparent", color: colors.blue, border: `1px solid ${colors.blue}40`, borderRadius: 8, fontSize: "0.8rem", fontWeight: 600, cursor: "pointer" },
  list: { display: "flex", flexDirection: "column", gap: "0.35rem" },
  item: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.6rem 0.85rem", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, backgroundColor: "#fff" },
  sortBadge: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 6, backgroundColor: "#e3f2fd", color: colors.blue, fontSize: "0.78rem", fontWeight: 700, flexShrink: 0 },
  itemLabel: { fontWeight: 600, fontSize: "0.9rem", color: colors.textPrimary },
  itemCode: { fontSize: "0.8rem", color: colors.textSecondary },
  editBtn: { display: "flex", alignItems: "center", justifyContent: "center", padding: "0.35rem", borderRadius: 6, border: "none", backgroundColor: "#e3f2fd", color: colors.blue, cursor: "pointer" },
  deleteBtn: { display: "flex", alignItems: "center", justifyContent: "center", padding: "0.35rem", borderRadius: 6, border: "none", backgroundColor: "#ffebee", color: colors.danger, cursor: "pointer" },
  formLabel: { display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem", color: colors.textSecondary },
  formInput: { width: "100%", padding: "0.55rem 0.75rem", borderRadius: 8, border: "1px solid #d0d7e2", fontSize: "0.9rem", outline: "none", boxSizing: "border-box" },
};

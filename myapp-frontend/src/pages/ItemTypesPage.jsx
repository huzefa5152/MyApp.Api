import { useState, useEffect } from "react";
import { MdCategory, MdAdd, MdEdit, MdDelete, MdSearch } from "react-icons/md";
import { getItemTypes, createItemType, updateItemType, deleteItemType } from "../api/itemTypeApi";
import { formStyles } from "../theme";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  danger: "#dc3545",
};

export default function ItemTypesPage() {
  const [itemTypes, setItemTypes] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const fetch = async () => {
    try {
      const { data } = await getItemTypes();
      setItemTypes(data);
    } catch { alert("Failed to load item types."); }
  };

  useEffect(() => { fetch(); }, []);

  const openAdd = () => { setEditItem(null); setName(""); setError(""); setShowForm(true); };
  const openEdit = (it) => { setEditItem(it); setName(it.name); setError(""); setShowForm(true); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("Name is required.");
    try {
      if (editItem) await updateItemType(editItem.id, { name: name.trim() });
      else await createItemType({ name: name.trim() });
      setShowForm(false);
      fetch();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to save.");
    }
  };

  const handleDelete = async (it) => {
    if (!window.confirm(`Delete item type "${it.name}"?`)) return;
    try {
      await deleteItemType(it.id);
      fetch();
    } catch (err) {
      alert(err.response?.data?.message || "Cannot delete - may be in use.");
    }
  };

  const filtered = itemTypes.filter((it) =>
    it.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
          <div style={styles.headerIcon}><MdCategory size={24} color="#fff" /></div>
          <div>
            <h2 style={styles.title}>Item Types</h2>
            <p style={styles.subtitle}>{itemTypes.length} type{itemTypes.length !== 1 ? "s" : ""} configured</p>
          </div>
        </div>
        <button style={styles.addBtn} onClick={openAdd}>
          <MdAdd size={18} /> New Item Type
        </button>
      </div>

      {itemTypes.length > 5 && (
        <div style={styles.searchWrap}>
          <MdSearch size={18} style={styles.searchIcon} />
          <input type="text" placeholder="Search item types..." value={search} onChange={(e) => setSearch(e.target.value)} style={styles.searchInput} />
        </div>
      )}

      <div style={styles.list}>
        {filtered.length === 0 ? (
          <p style={{ color: colors.textSecondary, textAlign: "center", padding: "2rem" }}>
            {itemTypes.length === 0 ? 'No item types yet. Click "New Item Type" to add one.' : "No matching item types."}
          </p>
        ) : (
          filtered.map((it) => (
            <div key={it.id} style={styles.item}>
              <span style={styles.itemName}>{it.name}</span>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <button style={styles.editBtn} onClick={() => openEdit(it)}><MdEdit size={16} /></button>
                <button style={styles.deleteBtn} onClick={() => handleDelete(it)}><MdDelete size={16} /></button>
              </div>
            </div>
          ))
        )}
      </div>

      {showForm && (
        <div style={formStyles.backdrop} onClick={() => setShowForm(false)}>
          <div style={{ ...formStyles.modal, maxWidth: 400, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
            <div style={formStyles.header}>
              <h5 style={formStyles.title}>{editItem ? "Edit Item Type" : "New Item Type"}</h5>
              <button style={formStyles.closeButton} onClick={() => setShowForm(false)}>&times;</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={formStyles.body}>
                {error && <div style={{ color: colors.danger, fontSize: "0.85rem", marginBottom: "0.75rem" }}>{error}</div>}
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem", color: colors.textSecondary }}>Name *</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    style={{ width: "100%", padding: "0.55rem 0.75rem", borderRadius: 8, border: "1px solid #d0d7e2", fontSize: "0.9rem", outline: "none", boxSizing: "border-box" }}
                    autoFocus
                  />
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
  searchWrap: { position: "relative", marginBottom: "1.25rem", maxWidth: 360 },
  searchIcon: { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" },
  searchInput: { width: "100%", padding: "0.55rem 0.75rem 0.55rem 2.3rem", border: "1px solid #d0d7e2", borderRadius: 10, fontSize: "0.88rem", backgroundColor: "#f8f9fb", color: colors.textPrimary, outline: "none" },
  list: { display: "flex", flexDirection: "column", gap: "0.5rem" },
  item: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 1rem", borderRadius: 10, border: `1px solid ${colors.cardBorder}`, backgroundColor: "#fff" },
  itemName: { fontWeight: 600, fontSize: "0.92rem", color: colors.textPrimary },
  editBtn: { display: "flex", alignItems: "center", justifyContent: "center", padding: "0.35rem", borderRadius: 6, border: "none", backgroundColor: "#e3f2fd", color: colors.blue, cursor: "pointer" },
  deleteBtn: { display: "flex", alignItems: "center", justifyContent: "center", padding: "0.35rem", borderRadius: 6, border: "none", backgroundColor: "#ffebee", color: colors.danger, cursor: "pointer" },
};

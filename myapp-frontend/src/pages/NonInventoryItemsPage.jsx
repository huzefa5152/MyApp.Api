import { useState, useEffect, useCallback, useMemo } from "react";
import { MdRequestQuote, MdAdd, MdBusiness, MdSearch, MdEdit, MdDelete } from "react-icons/md";
import {
  getNonInventoryItemsByCompany, createNonInventoryItem,
  updateNonInventoryItem, deleteNonInventoryItem,
} from "../api/nonInventoryItemApi";
import NonInventoryItemForm from "../Components/NonInventoryItemForm";
import { useConfirm } from "../Components/ConfirmDialog";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { dropdownStyles } from "../theme";

const colors = { blue: "#0d47a1", textPrimary: "#1a2332", textSecondary: "#5f6d7e", cardBorder: "#e8edf3" };

export default function NonInventoryItemsPage() {
  const { companies, selectedCompany, setSelectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canView = has("noninventoryitems.list.view");
  const canCreate = has("noninventoryitems.manage.create");
  const canUpdate = has("noninventoryitems.manage.update");
  const canDelete = has("noninventoryitems.manage.delete");

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);

  const fetchItems = useCallback(async (companyId) => {
    if (!companyId) return;
    setLoading(true);
    try {
      const { data } = await getNonInventoryItemsByCompany(companyId);
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCompany) fetchItems(selectedCompany.id);
    else setItems([]);
  }, [selectedCompany, fetchItems]);

  const handleSave = async (payload) => {
    if (editItem) await updateNonInventoryItem(editItem.id, payload);
    else await createNonInventoryItem(selectedCompany.id, payload);
    notify(editItem ? "Non-inventory item updated." : "Non-inventory item created.", "success");
    await fetchItems(selectedCompany.id);
  };

  const handleDelete = async (it) => {
    const ok = await confirm({
      title: "Delete non-inventory item?",
      message: `Delete "${it.name}"? This can't be undone. (If it's used on documents, deactivate it instead.)`,
      variant: "danger", confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await deleteNonInventoryItem(it.id);
      notify("Non-inventory item deleted.", "success");
      fetchItems(selectedCompany.id);
    } catch (err) {
      notify(err.response?.data?.error || "Failed to delete the item.", "error");
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const t = search.toLowerCase();
    return items.filter((it) =>
      (it.name || "").toLowerCase().includes(t)
      || (it.code || "").toLowerCase().includes(t)
      || (it.saleAccountName || "").toLowerCase().includes(t)
      || (it.purchaseAccountName || "").toLowerCase().includes(t));
  }, [items, search]);

  if (!canView) {
    return <div style={styles.emptyState}><MdRequestQuote size={40} color={colors.cardBorder} /><p style={{ color: colors.textSecondary, marginTop: 8 }}>You don't have access to Non-Inventory Items.</p></div>;
  }

  return (
    <div>
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={styles.headerIcon}><MdRequestQuote size={26} color="#fff" /></div>
          <div>
            <h2 style={styles.pageTitle}>Non-Inventory Items</h2>
            <p style={styles.pageSubtitle}>
              {selectedCompany ? `${filtered.length} item${filtered.length !== 1 ? "s" : ""} — GL-account shortcut lines (Freight, Discount, …)` : "Select a company"}
            </p>
          </div>
        </div>
        {companies.length > 0 && canCreate && selectedCompany && (
          <button style={styles.addBtn} onClick={() => { setEditItem(null); setShowForm(true); }}>
            <MdAdd size={18} /> New Item
          </button>
        )}
      </div>

      {loadingCompanies ? (
        <div style={styles.loading}><div style={styles.spinner} /></div>
      ) : companies.length > 0 ? (
        <div style={styles.filters}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <MdBusiness size={20} color={colors.blue} />
            <select
              style={dropdownStyles.base}
              value={selectedCompany?.id || ""}
              onChange={(e) => setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))}
            >
              {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
            </select>
          </div>
          {items.length > 3 && (
            <div style={styles.searchWrap}>
              <MdSearch style={styles.searchIcon} />
              <input type="text" placeholder="Search name / account…" value={search} onChange={(e) => setSearch(e.target.value)} style={styles.searchInput} />
            </div>
          )}
        </div>
      ) : (
        <div style={styles.emptyState}><MdBusiness size={40} color={colors.cardBorder} /><p style={{ color: colors.textSecondary, marginTop: 8 }}>No companies available.</p></div>
      )}

      {loading ? (
        <div style={styles.loading}><div style={styles.spinner} /></div>
      ) : selectedCompany && filtered.length === 0 ? (
        <div style={styles.emptyState}>
          <MdRequestQuote size={40} color={colors.cardBorder} />
          <p style={{ color: colors.textSecondary, marginTop: 8 }}>
            {items.length === 0 ? "No non-inventory items yet. Add Freight, Discount, or other charge lines." : "No items match your search."}
          </p>
        </div>
      ) : selectedCompany ? (
        <div style={styles.scroll}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Code</th>
                <th style={styles.th}>When sold → account</th>
                <th style={styles.th}>When purchased → account</th>
                <th style={styles.th}>Status</th>
                <th style={styles.thActions}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <tr key={it.id} style={styles.tr}>
                  <td style={{ ...styles.td, fontWeight: 600 }}>{it.name}</td>
                  <td style={{ ...styles.td, color: colors.textSecondary }}>{it.code || "—"}</td>
                  <td style={styles.td}>{it.saleAccountName || <span style={styles.unmapped}>Suspense (unmapped)</span>}</td>
                  <td style={styles.td}>{it.purchaseAccountName || <span style={styles.unmapped}>Suspense (unmapped)</span>}</td>
                  <td style={styles.td}>
                    {it.isActive
                      ? <span style={styles.badgeActive}>Active</span>
                      : <span style={styles.badgeInactive}>Inactive</span>}
                  </td>
                  <td style={styles.tdActions}>
                    <div style={styles.actionRow}>
                      {canUpdate && <button style={{ ...styles.iconBtn, ...styles.edit }} title="Edit" onClick={() => { setEditItem(it); setShowForm(true); }}><MdEdit size={16} /></button>}
                      {canDelete && <button style={{ ...styles.iconBtn, ...styles.del }} title="Delete" onClick={() => handleDelete(it)}><MdDelete size={16} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {showForm && selectedCompany && (
        <NonInventoryItemForm
          companyId={selectedCompany.id}
          item={editItem}
          onClose={() => { setShowForm(false); setEditItem(null); }}
          onSaved={handleSave}
        />
      )}
    </div>
  );
}

const styles = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" },
  headerIcon: { width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg, #0d47a1, #00897b)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  pageTitle: { margin: 0, fontSize: "1.5rem", fontWeight: 700, color: colors.textPrimary },
  pageSubtitle: { margin: "0.15rem 0 0", fontSize: "0.88rem", color: colors.textSecondary },
  addBtn: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 1.25rem", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #0d47a1, #00897b)", color: "#fff", fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 14px rgba(13,71,161,0.25)" },
  filters: { display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1.25rem" },
  searchWrap: { position: "relative", flex: 1, minWidth: 180, maxWidth: 320 },
  searchIcon: { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", fontSize: "1.1rem" },
  searchInput: { width: "100%", padding: "0.55rem 0.75rem 0.55rem 2.3rem", border: "1px solid #d0d7e2", borderRadius: 10, fontSize: "0.88rem", backgroundColor: "#f8f9fb", color: "#1a2332", outline: "none" },
  scroll: { width: "100%", overflowX: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 12, background: "#fff", WebkitOverflowScrolling: "touch" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 720 },
  th: { textAlign: "left", padding: "0.6rem 0.8rem", fontWeight: 700, color: colors.textSecondary, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.02em", background: "#f8f9fb", borderBottom: "2px solid #e8edf3", whiteSpace: "nowrap" },
  thActions: { padding: "0.6rem 0.5rem", background: "#f8f9fb", borderBottom: "2px solid #e8edf3", width: 1 },
  tr: { borderBottom: "1px solid #eef2f7" },
  td: { padding: "0.55rem 0.8rem", color: "#334155", verticalAlign: "middle" },
  tdActions: { padding: "0.4rem 0.5rem", verticalAlign: "middle" },
  unmapped: { color: "#b26a00", fontStyle: "italic", fontSize: "0.8rem" },
  badgeActive: { fontSize: "0.72rem", fontWeight: 700, color: "#00695c", background: "#e0f2f1", padding: "0.15rem 0.5rem", borderRadius: 8 },
  badgeInactive: { fontSize: "0.72rem", fontWeight: 700, color: "#8d6e63", background: "#efebe9", padding: "0.15rem 0.5rem", borderRadius: 8 },
  actionRow: { display: "flex", gap: 4, justifyContent: "flex-end" },
  iconBtn: { display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 8, border: "none", cursor: "pointer" },
  edit: { background: "#e3f2fd", color: "#0d47a1" },
  del: { background: "#ffebee", color: "#c62828" },
  loading: { display: "flex", alignItems: "center", justifyContent: "center", padding: "3rem 0" },
  spinner: { width: 28, height: 28, border: `3px solid ${colors.cardBorder}`, borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  emptyState: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "3rem 1rem", textAlign: "center" },
};

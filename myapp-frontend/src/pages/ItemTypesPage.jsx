import { useState, useEffect, useMemo } from "react";
import { MdCategory, MdAdd, MdEdit, MdDelete, MdSearch, MdStar, MdStarBorder, MdInfo, MdBusiness } from "react-icons/md";
import { getItemTypes, createItemType, updateItemType, deleteItemType } from "../api/itemTypeApi";
import { getFbrHsUom } from "../api/fbrApi";
import { formStyles } from "../theme";
import { notify } from "../utils/notify";
import { useConfirm } from "../Components/ConfirmDialog";
import { useCompany } from "../contexts/CompanyContext";
import HsCodeAutocomplete from "../Components/HsCodeAutocomplete";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  danger: "#dc3545",
  danger_light: "#fff0f1",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  favorite: "#f59f00",
};

const SALE_TYPES = [
  "Goods at standard rate (default)",
  "Goods at Reduced Rate",
  "Goods at zero-rate",
  "Exempt goods",
  "3rd Schedule Goods",
  "Services",
  "Services (FED in ST Mode)",
  "Goods (FED in ST Mode)",
  "Steel Melting and re-rolling",
  "Toll Manufacturing",
  "Mobile Phones",
  "Petroleum Products",
  "Electric Vehicle",
  "Cement /Concrete Block",
  "Processing/Conversion of Goods",
  "Cotton Ginners",
  "Non-Adjustable Supplies",
];

/**
 * Item Types = the user's curated FBR item catalog.
 *
 * Each row carries an FBR HS Code + UOM + Sale Type, so that every time the
 * user invoices this kind of item (on a challan or bill) those FBR fields
 * flow through automatically. Keeps the challan/bill forms short — users
 * pick from "their items" instead of searching FBR's 15k+ catalog every time.
 */
export default function ItemTypesPage() {
  const confirm = useConfirm();
  const { companies, selectedCompany } = useCompany();
  const [itemTypes, setItemTypes] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    name: "",
    hsCode: "",
    uom: "",
    fbrUOMId: null,
    saleType: "Goods at standard rate (default)",
    fbrDescription: "",
    isFavorite: true,
  });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingUom, setLoadingUom] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const { data } = await getItemTypes();
      setItemTypes(data);
    } catch {
      notify("Failed to load item types.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const openAdd = () => {
    setEditItem(null);
    setForm({
      name: "",
      hsCode: "",
      uom: "",
      fbrUOMId: null,
      saleType: "Goods at standard rate (default)",
      fbrDescription: "",
      isFavorite: true,
    });
    setFormError("");
    setShowForm(true);
  };

  const openEdit = (it) => {
    setEditItem(it);
    setForm({
      name: it.name || "",
      hsCode: it.hsCode || "",
      uom: it.uom || "",
      fbrUOMId: it.fbrUOMId || null,
      saleType: it.saleType || "Goods at standard rate (default)",
      fbrDescription: it.fbrDescription || "",
      isFavorite: it.isFavorite ?? true,
    });
    setFormError("");
    setShowForm(true);
  };

  // When user picks an HS code, look up the FBR-recommended UOM for it.
  const handleHsCodeChange = async (code) => {
    setForm((f) => ({ ...f, hsCode: code }));
    if (!code || code.length < 6 || !selectedCompany) return;
    setLoadingUom(true);
    try {
      const { data } = await getFbrHsUom(selectedCompany.id, code, 3);
      if (Array.isArray(data) && data.length > 0) {
        setForm((f) => ({
          ...f,
          // only fill if the user didn't manually set one
          uom: f.uom || data[0].description || "",
          fbrUOMId: f.fbrUOMId || data[0].uoM_ID || null,
        }));
      }
    } catch { /* silently ignore */ } finally {
      setLoadingUom(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    if (!form.name.trim()) return setFormError("Name is required.");
    // HS code is OPTIONAL — operators can save a quick-entry item type
    // with just a name. Bills built from HS-less items won't pass FBR
    // validation until someone fills in the HS/UOM/SaleType later, but
    // that's fine for non-FBR workflows and draft entries.

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        hsCode: form.hsCode?.trim() || null,
        uom: form.uom?.trim() || null,
        fbrUOMId: form.fbrUOMId || null,
        saleType: form.saleType || null,
        fbrDescription: form.fbrDescription?.trim() || null,
        isFavorite: !!form.isFavorite,
      };
      if (editItem) {
        await updateItemType(editItem.id, { ...payload, id: editItem.id });
        notify(`"${payload.name}" updated.`, "success");
      } else {
        await createItemType(payload);
        notify(`"${payload.name}" added.`, "success");
      }
      setShowForm(false);
      fetchAll();
    } catch (err) {
      setFormError(err.response?.data?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const toggleFavorite = async (it) => {
    try {
      await updateItemType(it.id, { ...it, isFavorite: !it.isFavorite });
      fetchAll();
    } catch {
      notify("Failed to update favorite.", "error");
    }
  };

  const handleDelete = async (it) => {
    const ok = await confirm({
      title: "Delete Item?",
      message: `Delete item "${it.name}"? It may be in use by existing challans.`,
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await deleteItemType(it.id);
      fetchAll();
    } catch (err) {
      notify(err.response?.data?.message || "Cannot delete - may be in use.", "error");
    }
  };

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    if (!term) return itemTypes;
    return itemTypes.filter((it) =>
      it.name.toLowerCase().includes(term) ||
      (it.hsCode || "").toLowerCase().includes(term) ||
      (it.uom || "").toLowerCase().includes(term) ||
      (it.fbrDescription || "").toLowerCase().includes(term)
    );
  }, [itemTypes, search]);

  const favoritesCount = itemTypes.filter((it) => it.isFavorite).length;
  const withFbrCount = itemTypes.filter((it) => it.hsCode).length;

  return (
    <div>
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
          <div style={styles.headerIcon}><MdCategory size={24} color="#fff" /></div>
          <div>
            <h2 style={styles.title}>Item Catalog</h2>
            <p style={styles.subtitle}>
              {itemTypes.length} item{itemTypes.length !== 1 ? "s" : ""}
              {" · "}{withFbrCount} with FBR mapping
              {" · "}{favoritesCount} favorited
            </p>
          </div>
        </div>
        <button style={styles.addBtn} onClick={openAdd} disabled={!selectedCompany}>
          <MdAdd size={18} /> New Item
        </button>
      </div>

      {!selectedCompany && companies?.length > 0 && (
        <div style={styles.infoBox}>
          <MdBusiness size={16} style={{ flexShrink: 0 }} />
          <div>Select a company on the dashboard first — HS-code lookups need an FBR-enabled company to query the catalog.</div>
        </div>
      )}

      <div style={styles.infoBox}>
        <MdInfo size={16} style={{ flexShrink: 0 }} />
        <div>
          All items must come from <b>FBR's official catalog</b> — each has a valid HS Code, UOM, and Sale Type so bills pass FBR validation automatically.
          &nbsp;The app seeded 19 common categories for pneumatic / hardware / general-order-supply on first run; add more by picking from the FBR HS Code search.</div>
      </div>

      {itemTypes.length > 5 && (
        <div style={styles.searchWrap}>
          <MdSearch size={18} style={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search by name, HS code, UOM…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={styles.searchInput}
          />
        </div>
      )}

      {loading ? (
        <p style={{ color: colors.textSecondary, textAlign: "center", padding: "2rem" }}>Loading…</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: colors.textSecondary, textAlign: "center", padding: "2rem" }}>
          {itemTypes.length === 0
            ? 'No items yet. Click "New Item" to add one from the FBR catalog.'
            : "No matching items."}
        </p>
      ) : (
        <div style={styles.list}>
          <div style={styles.listHeader}>
            <span style={{ width: 32 }}></span>
            <span style={{ flex: 2 }}>Name</span>
            <span style={{ flex: 1.1 }}>HS Code</span>
            <span style={{ flex: 1.5 }}>UOM</span>
            <span style={{ flex: 1.8 }}>Sale Type</span>
            <span style={{ flex: 0.7, textAlign: "center" }}>Used</span>
            <span style={{ width: 90, textAlign: "right" }}></span>
          </div>
          {filtered.map((it) => (
            <div key={it.id} style={styles.item}>
              <button
                style={styles.starBtn}
                onClick={() => toggleFavorite(it)}
                title={it.isFavorite ? "Unfavorite" : "Add to favorites"}
              >
                {it.isFavorite
                  ? <MdStar size={18} color={colors.favorite} />
                  : <MdStarBorder size={18} color={colors.textSecondary} />}
              </button>
              <div style={{ flex: 2, minWidth: 0 }}>
                <div style={styles.itemName}>{it.name}</div>
                {it.fbrDescription && (
                  <div style={styles.itemDesc} title={it.fbrDescription}>
                    {it.fbrDescription}
                  </div>
                )}
              </div>
              <span style={{ flex: 1.1, fontFamily: "monospace", fontSize: "0.82rem", color: it.hsCode ? colors.blue : colors.textSecondary }}>
                {it.hsCode || "—"}
              </span>
              <span style={{ flex: 1.5, fontSize: "0.82rem", color: colors.textPrimary }}>
                {it.uom || "—"}
              </span>
              <span style={{ flex: 1.8, fontSize: "0.78rem", color: colors.textSecondary }}>
                {it.saleType || "—"}
              </span>
              <span style={{ flex: 0.7, textAlign: "center", fontSize: "0.82rem", color: colors.textSecondary }}>
                {it.usageCount > 0 ? `${it.usageCount}×` : "—"}
              </span>
              <div style={{ width: 90, display: "flex", gap: "0.4rem", justifyContent: "flex-end" }}>
                <button style={styles.editBtn} onClick={() => openEdit(it)} title="Edit"><MdEdit size={16} /></button>
                <button style={styles.deleteBtn} onClick={() => handleDelete(it)} title="Delete"><MdDelete size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div style={formStyles.backdrop} onClick={() => setShowForm(false)}>
          <div style={{ ...formStyles.modal, maxWidth: 620, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
            <div style={formStyles.header}>
              <h5 style={formStyles.title}>{editItem ? "Edit Item" : "New Item"}</h5>
              <button style={formStyles.closeButton} onClick={() => setShowForm(false)}>&times;</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={formStyles.body}>
                {formError && <div style={styles.errorAlert}>{formError}</div>}

                <div style={styles.field}>
                  <label style={styles.label}>Item Name *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    style={styles.input}
                    placeholder="e.g. Ball Valve 2 inch"
                    autoFocus
                  />
                  <p style={styles.hint}>This is the short name shown in challan / bill dropdowns.</p>
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>
                    HS Code * <span style={{ ...styles.optTag, backgroundColor: "#ffebee", color: "#c62828" }}>REQUIRED</span>
                  </label>
                  <HsCodeAutocomplete
                    companyId={selectedCompany?.id}
                    value={form.hsCode}
                    onChange={handleHsCodeChange}
                    style={styles.input}
                    placeholder="Type 'valve', 'pipe', 'bolt'… to search FBR catalog"
                    excludeHsCodes={
                      // Hide HS codes already used by OTHER items (allow the current
                      // edit target to keep its own code)
                      itemTypes
                        .filter((t) => t.hsCode && t.id !== editItem?.id)
                        .map((t) => t.hsCode)
                    }
                  />
                  <p style={styles.hint}>
                    Must be picked from FBR's official catalog (no free-type).
                    HS codes already saved in your catalog are hidden — each code maps to one item.
                    UOM below auto-fills from the HS_UOM lookup.
                  </p>
                </div>

                <div style={styles.row}>
                  <div style={{ flex: 1 }}>
                    <label style={styles.label}>
                      UOM (FBR) {loadingUom && <span style={{ color: colors.textSecondary, fontSize: "0.75rem" }}>…loading</span>}
                    </label>
                    <input
                      type="text"
                      value={form.uom}
                      onChange={(e) => setForm((f) => ({ ...f, uom: e.target.value }))}
                      style={styles.input}
                      placeholder="e.g. Numbers, pieces, units"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={styles.label}>Sale Type</label>
                    <select
                      value={form.saleType}
                      onChange={(e) => setForm((f) => ({ ...f, saleType: e.target.value }))}
                      style={styles.input}
                    >
                      {SALE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                <div style={styles.field}>
                  <label style={{ ...styles.label, display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={form.isFavorite}
                      onChange={(e) => setForm((f) => ({ ...f, isFavorite: e.target.checked }))}
                    />
                    Show in challan &amp; bill dropdowns (favorite)
                  </label>
                </div>
              </div>
              <div style={formStyles.footer}>
                <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" style={{ ...formStyles.button, ...formStyles.submit, opacity: saving ? 0.6 : 1 }} disabled={saving}>
                  {saving ? "Saving…" : editItem ? "Update" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" },
  headerIcon: { width: 42, height: 42, borderRadius: 12, background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, display: "flex", alignItems: "center", justifyContent: "center" },
  title: { fontSize: "1.45rem", fontWeight: 800, color: colors.textPrimary, margin: 0 },
  subtitle: { fontSize: "0.82rem", color: colors.textSecondary, margin: 0 },
  addBtn: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 1.2rem", background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, color: "#fff", border: "none", borderRadius: 10, fontSize: "0.88rem", fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 14px rgba(13,71,161,0.25)" },
  infoBox: { display: "flex", alignItems: "flex-start", gap: "0.5rem", padding: "0.65rem 0.85rem", backgroundColor: "#e3f2fd", border: "1px solid #90caf9", color: colors.textPrimary, borderRadius: 8, marginBottom: "1rem", fontSize: "0.82rem", lineHeight: 1.4 },
  searchWrap: { position: "relative", marginBottom: "1rem", maxWidth: 420 },
  searchIcon: { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" },
  searchInput: { width: "100%", padding: "0.55rem 0.75rem 0.55rem 2.3rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 10, fontSize: "0.88rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none" },
  list: { display: "flex", flexDirection: "column", gap: "0.35rem" },
  listHeader: { display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.4rem 0.75rem", fontSize: "0.72rem", fontWeight: 800, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.03em" },
  item: { display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.6rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, backgroundColor: "#fff" },
  starBtn: { width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: "pointer", borderRadius: 6, padding: 0 },
  itemName: { fontWeight: 600, fontSize: "0.88rem", color: colors.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  itemDesc: { fontSize: "0.7rem", color: colors.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.3 },
  editBtn: { display: "flex", alignItems: "center", justifyContent: "center", padding: "0.35rem", borderRadius: 6, border: "none", backgroundColor: "#e3f2fd", color: colors.blue, cursor: "pointer" },
  deleteBtn: { display: "flex", alignItems: "center", justifyContent: "center", padding: "0.35rem", borderRadius: 6, border: "none", backgroundColor: "#ffebee", color: colors.danger, cursor: "pointer" },
  field: { marginBottom: "1rem" },
  row: { display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" },
  label: { display: "block", marginBottom: "0.3rem", fontWeight: 600, fontSize: "0.82rem", color: colors.textPrimary },
  optTag: { marginLeft: "0.3rem", padding: "0.05rem 0.35rem", borderRadius: 4, backgroundColor: "#fff3e0", color: "#e65100", fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.03em" },
  input: { width: "100%", padding: "0.55rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.88rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", boxSizing: "border-box" },
  hint: { margin: "0.25rem 0 0", fontSize: "0.72rem", color: colors.textSecondary, lineHeight: 1.3 },
  errorAlert: { backgroundColor: colors.danger_light, color: colors.danger, padding: "0.6rem 0.85rem", borderRadius: 6, marginBottom: "0.75rem", fontSize: "0.82rem", border: `1px solid ${colors.danger}40` },
};

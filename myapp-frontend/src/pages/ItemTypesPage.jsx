import { useState, useEffect, useMemo } from "react";
import { MdCategory, MdAdd, MdEdit, MdDelete, MdSearch, MdStar, MdStarBorder, MdInfo, MdBusiness } from "react-icons/md";
import { getItemTypes, updateItemType, deleteItemType } from "../api/itemTypeApi";
import { notify } from "../utils/notify";
import { useConfirm } from "../Components/ConfirmDialog";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import ItemTypeForm from "../Components/ItemTypeForm";

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

// Trim trailing zeros so 12.000 → "12" and 1.50 → "1.5". Keeps the
// On-hand column readable for the common integer-qty case while still
// honouring fractional UOMs (kg, litre, m²).
const formatQty = (n) => {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const num = Number(n);
  if (Number.isInteger(num)) return num.toLocaleString();
  return num.toLocaleString(undefined, { maximumFractionDigits: 3 });
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
  const { has } = usePermissions();
  const canCreate = has("itemtypes.manage.create");
  const canUpdate = has("itemtypes.manage.update");
  const canDelete = has("itemtypes.manage.delete");
  const [itemTypes, setItemTypes] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    setLoading(true);
    try {
      // Pass companyId so the backend joins per-company on-hand stock
      // (opening + Σ purchases − Σ sales) onto each row. Empty when the
      // selected company has stock tracking disabled — list still renders.
      const { data } = await getItemTypes(selectedCompany?.id);
      setItemTypes(data);
    } catch {
      notify("Failed to load item types.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, [selectedCompany?.id]);

  const openAdd = () => {
    setEditItem(null);
    setShowForm(true);
  };

  const openEdit = (it) => {
    setEditItem(it);
    setShowForm(true);
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
        {canCreate && (
          <button style={styles.addBtn} onClick={openAdd} disabled={!selectedCompany}>
            <MdAdd size={18} /> New Item
          </button>
        )}
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
        <>
          {/* Desktop / tablet — flex-row "list". The min-width: 720px on the
              inner list pushes columns wide; on narrower screens the
              .it-list-wrap below is hidden via media query and the mobile
              card list takes over. */}
          <div className="it-list-wrap" style={styles.listWrap}>
            <div style={styles.list}>
              <div style={styles.listHeader}>
                <span style={{ width: 32 }}></span>
                <span style={{ flex: 2 }}>Name</span>
                <span style={{ flex: 1.1 }}>HS Code</span>
                <span style={{ flex: 1.5 }}>UOM</span>
                <span style={{ flex: 1.6 }}>Sale Type</span>
                <span style={{ flex: 0.9, textAlign: "right" }}>On hand</span>
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
                  <span style={{ flex: 1.6, fontSize: "0.78rem", color: colors.textSecondary }}>
                    {it.saleType || "—"}
                  </span>
                  <span style={{
                    flex: 0.9,
                    textAlign: "right",
                    fontSize: "0.82rem",
                    fontWeight: 600,
                    fontFamily: "monospace",
                    color: it.availableQty == null
                      ? colors.textSecondary
                      : it.availableQty > 0 ? colors.teal : colors.danger,
                  }}>
                    {it.availableQty == null ? "—" : formatQty(it.availableQty)}
                  </span>
                  <span style={{ flex: 0.7, textAlign: "center", fontSize: "0.82rem", color: colors.textSecondary }}>
                    {it.usageCount > 0 ? `${it.usageCount}×` : "—"}
                  </span>
                  <div style={{ width: 90, display: "flex", gap: "0.4rem", justifyContent: "flex-end" }}>
                    {canUpdate && (
                      <button style={styles.editBtn} onClick={() => openEdit(it)} title="Edit"><MdEdit size={16} /></button>
                    )}
                    {canDelete && (
                      <button style={styles.deleteBtn} onClick={() => handleDelete(it)} title="Delete"><MdDelete size={16} /></button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Mobile — stacked cards */}
          <div className="it-cards">
            {filtered.map((it) => (
              <div key={it.id} className="it-card">
                <div className="it-card__top">
                  <button
                    className="it-card__star"
                    onClick={() => toggleFavorite(it)}
                    aria-label={it.isFavorite ? "Unfavorite" : "Add to favorites"}
                  >
                    {it.isFavorite
                      ? <MdStar size={20} color={colors.favorite} />
                      : <MdStarBorder size={20} color={colors.textSecondary} />}
                  </button>
                  <div className="it-card__title">
                    <div className="it-card__name">{it.name}</div>
                    {it.fbrDescription && (
                      <div className="it-card__desc">{it.fbrDescription}</div>
                    )}
                  </div>
                </div>

                <div className="it-card__grid">
                  <div className="it-card__field">
                    <span className="it-card__field-label">HS Code</span>
                    <span
                      className="it-card__field-value"
                      style={{ fontFamily: "monospace", color: it.hsCode ? colors.blue : colors.textSecondary }}
                    >
                      {it.hsCode || "—"}
                    </span>
                  </div>
                  <div className="it-card__field">
                    <span className="it-card__field-label">UOM</span>
                    <span className="it-card__field-value">{it.uom || "—"}</span>
                  </div>
                  <div className="it-card__field it-card__field--full">
                    <span className="it-card__field-label">Sale Type</span>
                    <span className="it-card__field-value">{it.saleType || "—"}</span>
                  </div>
                  <div className="it-card__field">
                    <span className="it-card__field-label">On hand</span>
                    <span
                      className="it-card__field-value"
                      style={{
                        fontFamily: "monospace",
                        fontWeight: 600,
                        color: it.availableQty == null
                          ? colors.textSecondary
                          : it.availableQty > 0 ? colors.teal : colors.danger,
                      }}
                    >
                      {it.availableQty == null ? "—" : formatQty(it.availableQty)}
                    </span>
                  </div>
                  <div className="it-card__field">
                    <span className="it-card__field-label">Used</span>
                    <span className="it-card__field-value">
                      {it.usageCount > 0 ? `${it.usageCount}×` : "—"}
                    </span>
                  </div>
                </div>

                {(canUpdate || canDelete) && (
                  <div className="it-card__actions">
                    {canUpdate && (
                      <button className="it-card__edit" onClick={() => openEdit(it)}>
                        <MdEdit size={14} /> Edit
                      </button>
                    )}
                    {canDelete && (
                      <button className="it-card__delete" onClick={() => handleDelete(it)}>
                        <MdDelete size={14} /> Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {showForm && (
        <ItemTypeForm
          editItem={editItem}
          companyId={selectedCompany?.id}
          showFavoriteToggle
          showRichHints
          existingHsCodes={itemTypes
            .filter((t) => t.hsCode && t.id !== editItem?.id)
            .map((t) => t.hsCode)}
          onClose={() => setShowForm(false)}
          onSaved={(saved) => {
            // Edit responses carry the propagation summary so the
            // operator sees auto-synced lines. Mirrors the inline
            // notify() the page used to do.
            if (editItem) {
              const p = saved?.propagation;
              const bills = p?.invoiceItemsUpdated > 0
                ? `${p.invoiceItemsUpdated} unposted bill line${p.invoiceItemsUpdated !== 1 ? "s" : ""} synced.` : "";
              const dcs = p?.deliveryItemsUpdated > 0
                ? `${p.deliveryItemsUpdated} unposted challan line${p.deliveryItemsUpdated !== 1 ? "s" : ""} synced.` : "";
              const skipped = p?.submittedInvoiceLinesSkipped > 0
                ? `${p.submittedInvoiceLinesSkipped} FBR-submitted line${p.submittedInvoiceLinesSkipped !== 1 ? "s" : ""} left unchanged (locked).` : "";
              const propLines = [bills, dcs, skipped].filter(Boolean).join(" ");
              notify(`"${saved?.name || "Item"}" updated.${propLines ? "\n" + propLines : ""}`, "success");
            } else {
              notify(`"${saved?.name || "Item"}" added.`, "success");
            }
            setShowForm(false);
            fetchAll();
          }}
        />
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
  // Outer wrapper with `responsive-table-wrap` class — on phones the
  // 7-column row layout below would otherwise squash and become
  // unreadable; horizontal scroll keeps every column at the right
  // width while letting the operator swipe across.
  listWrap: { padding: 0, border: "none", borderRadius: 0 },
  // minWidth on the inner list pushes the rows out to the column
  // widths their flex ratios imply, triggering horizontal scroll on
  // viewports narrower than that. 720px gives every column a
  // legible minimum without horizontal scrolling on tablet+.
  list: { display: "flex", flexDirection: "column", gap: "0.35rem", minWidth: 720 },
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
  hintBox: { marginTop: "0.55rem", padding: "0.6rem 0.75rem", backgroundColor: "#e3f2fd", border: "1px solid #90caf9", borderRadius: 6, fontSize: "0.78rem", color: colors.textPrimary, lineHeight: 1.5 },
  hintRow: { display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "baseline" },
  hintLabel: { color: colors.textSecondary, fontSize: "0.72rem", fontWeight: 600 },
  hintNotes: { margin: "0.35rem 0 0", paddingLeft: "1.1rem", color: colors.textSecondary, fontSize: "0.72rem" },
  errorAlert: { backgroundColor: colors.danger_light, color: colors.danger, padding: "0.6rem 0.85rem", borderRadius: 6, marginBottom: "0.75rem", fontSize: "0.82rem", border: `1px solid ${colors.danger}40` },
};

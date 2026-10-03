import { useState, useEffect, useMemo } from "react";
import { MdCategory, MdAdd, MdEdit, MdDelete, MdStar, MdStarBorder, MdInfo } from "react-icons/md";
import { getItemTypes, updateItemType, deleteItemType } from "../api/itemTypeApi";
import { notify } from "../utils/notify";
import { useConfirm } from "../Components/ConfirmDialog";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import ImportFromExcelButton from "../Components/onboarding/ImportFromExcelButton";
import ItemTypeForm from "../Components/ItemTypeForm";
import { PageHeader, CompanyPicker, Button, IconButton, Toolbar, SearchBox, Alert, TableWrap, Facts, EmptyState, Loading } from "../ui/Kit";

const colors = {
  blue: "var(--k-blue)",
  teal: "var(--k-teal)",
  textSecondary: "var(--k-muted)",
  danger: "var(--k-danger)",
  favorite: "#f59f00",
};

const qtyColor = (it) => (it.availableQty == null ? colors.textSecondary : it.availableQty > 0 ? colors.teal : colors.danger);

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
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
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
      const { data } = await getItemTypes(selectedCompany?.id);
      setItemTypes(data);
    } catch {
      notify("Failed to load item types.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedCompany?.id) fetchAll();
    else setItemTypes([]);
  }, [selectedCompany?.id]);

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
      <PageHeader
        icon={MdCategory}
        tone="brand"
        title="Item Catalog"
        subtitle={<>
          {itemTypes.length} item{itemTypes.length !== 1 ? "s" : ""}
          {" · "}{withFbrCount} with FBR mapping
          {" · "}{favoritesCount} favorited
        </>}
        actions={(
          <>
            <ImportFromExcelButton sheet="items" />
            {canCreate && (
              <Button variant="primary" icon={MdAdd} onClick={openAdd} disabled={!selectedCompany}>New Item</Button>
            )}
          </>
        )}
      />

      <CompanyPicker label="Catalog company" />

      <Alert tone="info" icon={MdInfo}>
        These items belong to <b>{selectedCompany?.name}</b>. Configure their HS Code, UOM, and Sale Type for FBR invoicing.
      </Alert>

      {itemTypes.length > 5 && (
        <Toolbar>
          <SearchBox value={search} onChange={setSearch} placeholder="Search by name, HS code, UOM…" />
        </Toolbar>
      )}

      {loading ? (
        <Loading>Loading…</Loading>
      ) : filtered.length === 0 ? (
        <EmptyState icon={MdCategory}>
          {itemTypes.length === 0
            ? 'No items yet. Click "New Item" to add one from the FBR catalog.'
            : "No matching items."}
        </EmptyState>
      ) : (
        <>
          {/* Desktop / tablet — table. On narrower screens .it-list-wrap is
              hidden via media query and the mobile card list takes over. */}
          <div className="it-list-wrap">
            <TableWrap>
              <table className="k-table">
                <thead>
                  <tr>
                    <th style={{ width: 44 }} aria-label="Favorite"></th>
                    <th>Name</th>
                    <th>HS Code</th>
                    <th>UOM</th>
                    <th>Sale Type</th>
                    <th className="k-num">On hand</th>
                    <th className="is-center">Used</th>
                    <th className="k-actions" aria-label="Actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((it) => (
                    <tr key={it.id}>
                      <td>
                        <IconButton
                          label={it.isFavorite ? "Unfavorite" : "Add to favorites"}
                          onClick={() => toggleFavorite(it)}
                        >
                          {it.isFavorite
                            ? <MdStar size={18} color={colors.favorite} />
                            : <MdStarBorder size={18} color={colors.textSecondary} />}
                        </IconButton>
                      </td>
                      <td style={{ minWidth: 200 }}>
                        <div style={styles.itemName} title={it.name}>{it.name}</div>
                        {it.fbrDescription && (
                          <div style={styles.itemDesc} title={it.fbrDescription}>
                            {it.fbrDescription}
                          </div>
                        )}
                      </td>
                      <td style={{ fontFamily: "monospace", color: it.hsCode ? colors.blue : colors.textSecondary }}>
                        {it.hsCode || "—"}
                      </td>
                      <td>{it.uom || "—"}</td>
                      <td className="k-muted" style={{ fontSize: "var(--k-font-sm)" }}>{it.saleType || "—"}</td>
                      <td className="k-num" style={{ fontWeight: 600, fontFamily: "monospace", color: qtyColor(it) }}>
                        {it.availableQty == null ? "—" : formatQty(it.availableQty)}
                      </td>
                      <td className="is-center k-muted">
                        {it.usageCount > 0 ? `${it.usageCount}×` : "—"}
                      </td>
                      <td className="k-actions">
                        {canUpdate && (
                          <IconButton label="Edit" icon={MdEdit} size={16} onClick={() => openEdit(it)} />
                        )}
                        {canDelete && (
                          <IconButton label="Delete" icon={MdDelete} size={16} danger onClick={() => handleDelete(it)} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>

          {/* Mobile — stacked cards (same card shape as the client / company cards) */}
          <div className="it-cards">
            {filtered.map((it) => (
              <article key={it.id} className="k-card" style={styles.card}>
                <div className="k-card__body" style={styles.cardBody}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
                    <IconButton
                      label={it.isFavorite ? "Unfavorite" : "Add to favorites"}
                      onClick={() => toggleFavorite(it)}
                    >
                      {it.isFavorite
                        ? <MdStar size={20} color={colors.favorite} />
                        : <MdStarBorder size={20} color={colors.textSecondary} />}
                    </IconButton>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h3 style={styles.cardName} title={it.name}>{it.name}</h3>
                      {it.fbrDescription && (
                        <div style={{ ...styles.itemDesc, marginTop: "0.15rem" }}>{it.fbrDescription}</div>
                      )}
                    </div>
                  </div>

                  <Facts
                    facts={[
                      ["HS Code", <span style={{ fontFamily: "monospace", color: it.hsCode ? colors.blue : colors.textSecondary }}>{it.hsCode || "—"}</span>],
                      ["UOM", it.uom || "—"],
                      ["Sale Type", it.saleType || "—"],
                      ["On hand", (
                        <span style={{ fontFamily: "monospace", fontWeight: 600, color: qtyColor(it) }}>
                          {it.availableQty == null ? "—" : formatQty(it.availableQty)}
                        </span>
                      )],
                      ["Used", it.usageCount > 0 ? `${it.usageCount}×` : "—"],
                    ]}
                  />

                  {(canUpdate || canDelete) && (
                    <div style={styles.cardActions}>
                      {canUpdate && (
                        <Button variant="primary" size="sm" icon={MdEdit} onClick={() => openEdit(it)}>Edit</Button>
                      )}
                      {canDelete && (
                        <Button variant="danger" size="sm" icon={MdDelete} onClick={() => handleDelete(it)}>Delete</Button>
                      )}
                    </div>
                  )}
                </div>
              </article>
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

const clamp2 = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" };

const styles = {
  itemName: { ...clamp2, fontWeight: 600, color: "var(--k-ink)", lineHeight: 1.3 },
  itemDesc: { ...clamp2, fontSize: "0.7rem", color: "var(--k-muted)", lineHeight: 1.3 },
  // Entity-card layout shared with the client / company cards. marginTop: 0
  // cancels the kit's `.k-card + .k-card` stacking gap inside the list.
  card: { display: "flex", flexDirection: "column", overflow: "hidden", marginTop: 0 },
  cardBody: { flex: 1, display: "flex", flexDirection: "column", gap: "0.75rem" },
  cardName: { ...clamp2, margin: 0, fontSize: "calc(var(--k-font) + 0.1rem)", fontWeight: 700, lineHeight: 1.3, color: "var(--k-ink)" },
  cardActions: { display: "flex", flexWrap: "wrap", gap: "0.5rem", paddingTop: "0.75rem", borderTop: "1px solid var(--k-line)" },
};

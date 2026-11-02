import RecordsViewport from "../Components/RecordsViewport";
import { useState, useEffect, useMemo, useRef } from "react";
import { MdCategory, MdAdd, MdEdit, MdDelete, MdStar, MdStarBorder, MdInfo } from "react-icons/md";
import { getItemTypes, updateItemType, deleteItemType } from "../api/itemTypeApi";
import { notify } from "../utils/notify";
import { useConfirm } from "../Components/ConfirmDialog";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import ImportFromExcelButton from "../Components/onboarding/ImportFromExcelButton";
import ItemTypeForm from "../Components/ItemTypeForm";
import {
  PageHeader,
  CompanyPicker,
  Button,
  IconButton,
  Toolbar,
  SearchBox,
  Alert,
  TableWrap,
  Facts,
  EmptyState,
  Loading,
} from "../ui/Kit";

const colors = {
  blue: "var(--k-blue)",
  teal: "var(--k-teal)",
  textSecondary: "var(--k-muted)",
  danger: "var(--k-danger)",
  favorite: "#f59f00",
};

const qtyColor = (it) =>
  it.availableQty == null
    ? colors.textSecondary
    : it.availableQty > 0
      ? colors.teal
      : colors.danger;

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
  const [catalogKind, setCatalogKind] = useState("bill");
  const isFbr = catalogKind === "classification";

  const currentCompany = useRef(selectedCompany?.id);
  currentCompany.current = selectedCompany?.id;
  const fetchAll = async () => {
    const companyId = selectedCompany?.id;
    setLoading(true);
    try {
      const { data } = await getItemTypes(companyId);
      if (currentCompany.current === companyId) setItemTypes(data);
    } catch {
      notify("Failed to load item types.", "error");
    } finally {
      if (currentCompany.current === companyId) setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    setItemTypes([]);
    setShowForm(false);
    setEditItem(null);
    if (!selectedCompany?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getItemTypes(selectedCompany.id)
      .then(({ data }) => {
        if (active) setItemTypes(data);
      })
      .catch(() => {
        if (active) notify("Failed to load item types.", "error");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
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
      await updateItemType(it.id, { ...it, isFavorite: !it.isFavorite }, selectedCompany?.id);
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
    const relevant = itemTypes.filter((it) => !!it.hsCode?.trim() === isFbr);
    if (!term) return relevant;
    return relevant.filter(
      (it) =>
        it.name.toLowerCase().includes(term) ||
        (it.hsCode || "").toLowerCase().includes(term) ||
        (it.uom || "").toLowerCase().includes(term) ||
        (it.fbrDescription || "").toLowerCase().includes(term),
    );
  }, [itemTypes, search, isFbr]);

  const favoritesCount = itemTypes.filter((it) => it.isFavorite).length;
  const withFbrCount = itemTypes.filter((it) => it.hsCode).length;

  return (
    <div>
      <PageHeader
        icon={MdCategory}
        tone="brand"
        title="Item Catalog"
        subtitle={
          <>
            {itemTypes.length} item{itemTypes.length !== 1 ? "s" : ""}
            {" · "}
            {withFbrCount} with FBR mapping
            {" · "}
            {favoritesCount} favorited
          </>
        }
        actions={
          <>
            <ImportFromExcelButton sheet="items" />
            {canCreate && (
              <Button variant="primary" icon={MdAdd} onClick={openAdd} disabled={!selectedCompany}>
                {isFbr ? "Add FBR classification" : "Add bill category"}
              </Button>
            )}
          </>
        }
      />

      <CompanyPicker label="Catalog company" />

      <div
        role="group"
        aria-label="Catalog purpose"
        style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}
      >
        {[
          { key: "bill", label: "Bill categories", count: itemTypes.length - withFbrCount },
          { key: "classification", label: "FBR classifications", count: withFbrCount },
        ].map((tab) => (
          <Button
            key={tab.key}
            variant={catalogKind === tab.key ? "primary" : "secondary"}
            aria-pressed={catalogKind === tab.key}
            onClick={() => {
              setCatalogKind(tab.key);
              setSearch("");
            }}
          >
            {tab.label} ({tab.count})
          </Button>
        ))}
      </div>
      <Alert tone="info" icon={MdInfo}>
        <b>{selectedCompany?.name}</b>
        {" | "}
        {isFbr
          ? "Used when preparing FBR invoices. Save one classification per tax mapping; choose kg, pack or another supported unit on each filing row."
          : "Used on commercial bills and challans. These categories have no HS code; select FBR classifications separately when preparing invoices."}
      </Alert>

      {itemTypes.length > 0 && (
        <Toolbar>
          <SearchBox
            value={search}
            onChange={setSearch}
            label="Search catalog"
            placeholder={
              isFbr ? "Search classification, HS code, unit…" : "Search bill category, unit…"
            }
          />
        </Toolbar>
      )}

      <RecordsViewport label="Item Types records">
        {loading ? (
          <Loading>Loading…</Loading>
        ) : filtered.length === 0 ? (
          <EmptyState icon={MdCategory}>
            {search
              ? "No matching entries."
              : isFbr
                ? "No FBR classifications yet. Add a classification to prepare invoices."
                : "No bill categories yet. Add a category for commercial bill entry."}
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
                      <th>{isFbr ? "HS code" : "Used for"}</th>
                      <th>{isFbr ? "Default filing unit" : "Usual unit"}</th>
                      {isFbr && <th>Sale Type</th>}
                      {isFbr && <th className="k-num">On hand</th>}
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
                            {it.isFavorite ? (
                              <MdStar size={18} color={colors.favorite} />
                            ) : (
                              <MdStarBorder size={18} color={colors.textSecondary} />
                            )}
                          </IconButton>
                        </td>
                        <td style={{ minWidth: 200 }}>
                          <div style={styles.itemName} title={it.name}>
                            {it.name}
                          </div>
                          {isFbr && (
                            <div style={{ fontSize: "0.75rem", color: colors.blue }}>
                              {it.isHsCodePartial
                                ? "Needs complete sales HS code"
                                : "FBR invoice classification"}
                            </div>
                          )}
                          {it.fbrDescription && (
                            <div style={styles.itemDesc} title={it.fbrDescription}>
                              {it.fbrDescription}
                            </div>
                          )}
                        </td>
                        <td
                          style={{
                            fontFamily: "monospace",
                            color: it.hsCode ? colors.blue : colors.textSecondary,
                          }}
                        >
                          {isFbr ? it.hsCode : "Bills / challans"}
                        </td>
                        <td>{it.uom || "—"}</td>
                        {isFbr && (
                          <td className="k-muted" style={{ fontSize: "var(--k-font-sm)" }}>
                            {it.saleType || "—"}
                          </td>
                        )}
                        {isFbr && (
                          <td
                            className="k-num"
                            style={{
                              fontWeight: 600,
                              fontFamily: "monospace",
                              color: qtyColor(it),
                            }}
                          >
                            {it.availableQty == null ? "—" : formatQty(it.availableQty)}
                          </td>
                        )}
                        <td className="is-center k-muted">
                          {it.usageCount > 0 ? `${it.usageCount}×` : "—"}
                        </td>
                        <td className="k-actions">
                          {canUpdate && (
                            <IconButton
                              label="Edit"
                              icon={MdEdit}
                              size={16}
                              onClick={() => openEdit(it)}
                            />
                          )}
                          {canDelete && (
                            <IconButton
                              label="Delete"
                              icon={MdDelete}
                              size={16}
                              danger
                              onClick={() => handleDelete(it)}
                            />
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
                        {it.isFavorite ? (
                          <MdStar size={20} color={colors.favorite} />
                        ) : (
                          <MdStarBorder size={20} color={colors.textSecondary} />
                        )}
                      </IconButton>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <h3 style={styles.cardName} title={it.name}>
                          {it.name}
                        </h3>
                        {isFbr && (
                          <div style={{ fontSize: "0.75rem", color: colors.blue }}>
                            {it.isHsCodePartial
                              ? "Needs complete sales HS code"
                              : "FBR invoice classification"}
                          </div>
                        )}
                        {it.fbrDescription && (
                          <div style={{ ...styles.itemDesc, marginTop: "0.15rem" }}>
                            {it.fbrDescription}
                          </div>
                        )}
                      </div>
                    </div>

                    <Facts
                      facts={[
                        [
                          isFbr ? "HS Code" : "Used for",
                          <span
                            style={{
                              fontFamily: "monospace",
                              color: it.hsCode ? colors.blue : colors.textSecondary,
                            }}
                          >
                            {isFbr ? it.hsCode : "Bills / challans"}
                          </span>,
                        ],
                        [isFbr ? "Default filing unit" : "Usual unit", it.uom || "—"],
                        isFbr && ["Sale Type", it.saleType || "—"],
                        isFbr && [
                          "On hand",
                          <span
                            style={{
                              fontFamily: "monospace",
                              fontWeight: 600,
                              color: qtyColor(it),
                            }}
                          >
                            {it.availableQty == null ? "—" : formatQty(it.availableQty)}
                          </span>,
                        ],
                        ["Used", it.usageCount > 0 ? `${it.usageCount}×` : "—"],
                      ]}
                    />

                    {(canUpdate || canDelete) && (
                      <div style={styles.cardActions}>
                        {canUpdate && (
                          <Button
                            variant="primary"
                            size="sm"
                            icon={MdEdit}
                            onClick={() => openEdit(it)}
                          >
                            Edit
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="danger"
                            size="sm"
                            icon={MdDelete}
                            onClick={() => handleDelete(it)}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </RecordsViewport>

      {showForm && (
        <ItemTypeForm
          editItem={editItem}
          purpose={editItem ? (editItem.hsCode ? "classification" : "bill") : catalogKind}
          companyId={selectedCompany?.id}
          showFavoriteToggle
          showRichHints
          onClose={() => setShowForm(false)}
          onSaved={(saved) => {
            // Edit responses carry the propagation summary so the
            // operator sees auto-synced lines. Mirrors the inline
            // notify() the page used to do.
            if (editItem) {
              const p = saved?.propagation;
              const bills =
                p?.invoiceItemsUpdated > 0
                  ? `${p.invoiceItemsUpdated} unposted bill line${p.invoiceItemsUpdated !== 1 ? "s" : ""} synced.`
                  : "";
              const dcs =
                p?.deliveryItemsUpdated > 0
                  ? `${p.deliveryItemsUpdated} unposted challan line${p.deliveryItemsUpdated !== 1 ? "s" : ""} synced.`
                  : "";
              const skipped =
                p?.submittedInvoiceLinesSkipped > 0
                  ? `${p.submittedInvoiceLinesSkipped} FBR-submitted line${p.submittedInvoiceLinesSkipped !== 1 ? "s" : ""} left unchanged (locked).`
                  : "";
              const propLines = [bills, dcs, skipped].filter(Boolean).join(" ");
              notify(
                `"${saved?.name || "Item"}" updated.${propLines ? "\n" + propLines : ""}`,
                "success",
              );
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

const clamp2 = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  overflowWrap: "anywhere",
};

const styles = {
  itemName: { ...clamp2, fontWeight: 600, color: "var(--k-ink)", lineHeight: 1.3 },
  itemDesc: { ...clamp2, fontSize: "0.7rem", color: "var(--k-muted)", lineHeight: 1.3 },
  // Entity-card layout shared with the client / company cards. marginTop: 0
  // cancels the kit's `.k-card + .k-card` stacking gap inside the list.
  card: { display: "flex", flexDirection: "column", overflow: "hidden", marginTop: 0 },
  cardBody: { flex: 1, display: "flex", flexDirection: "column", gap: "0.75rem" },
  cardName: {
    ...clamp2,
    margin: 0,
    fontSize: "calc(var(--k-font) + 0.1rem)",
    fontWeight: 700,
    lineHeight: 1.3,
    color: "var(--k-ink)",
  },
  cardActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem",
    paddingTop: "0.75rem",
    borderTop: "1px solid var(--k-line)",
  },
};

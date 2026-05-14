import { useState, useEffect, useMemo } from "react";
import { MdLocalShipping, MdAdd, MdSearch, MdBusiness } from "react-icons/md";
import SupplierList from "../Components/SupplierList";
import SupplierForm from "../Components/SupplierForm";
import CommonSuppliersPanel from "../Components/CommonSuppliersPanel";
import CommonSupplierForm from "../Components/CommonSupplierForm";
import CopyToCompaniesDialog from "../Components/CopyToCompaniesDialog";
import { getSuppliersByCompany, getCommonSuppliers, copySupplierToCompanies } from "../api/supplierApi";
import { notify } from "../utils/notify";
import { dropdownStyles } from "../theme";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
};

export default function SuppliersPage() {
  const { companies, selectedCompany, setSelectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const canCreate = has("suppliers.manage.create");
  const [suppliers, setSuppliers] = useState([]);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);

  // Common Supplier edit state — separate from per-company edit
  // because the modal, payload shape and propagation behaviour are
  // all different. commonRefreshKey lets the panel reload after a save.
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [commonRefreshKey, setCommonRefreshKey] = useState(0);

  // Copy-to-companies dialog source.
  const [copyingSupplier, setCopyingSupplier] = useState(null);

  // Multi-company group ids that show in the Common Suppliers panel —
  // used to filter them out of the per-company list below the dropdown
  // (each supplier appears in exactly one place on the page).
  const [commonGroupIds, setCommonGroupIds] = useState(() => new Set());

  useEffect(() => {
    if (!selectedCompany) {
      setCommonGroupIds(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await getCommonSuppliers(selectedCompany.id);
        if (!cancelled) {
          setCommonGroupIds(new Set((data || []).map((g) => g.groupId)));
        }
      } catch {
        if (!cancelled) setCommonGroupIds(new Set());
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCompany, commonRefreshKey]);

  const fetchSuppliers = async (companyId) => {
    if (!companyId) return;
    setLoadingSuppliers(true);
    try {
      const { data } = await getSuppliersByCompany(companyId);
      setSuppliers(data);
    } catch {
      setSuppliers([]);
    } finally {
      setLoadingSuppliers(false);
    }
  };

  useEffect(() => {
    if (selectedCompany) fetchSuppliers(selectedCompany.id);
    else setSuppliers([]);
  }, [selectedCompany]);

  const handleEdit = (s) => { setSelectedSupplier(s); setShowModal(true); };
  const handleAdd = () => { setSelectedSupplier(null); setShowModal(true); };

  // Hide suppliers that already appear in the Common Suppliers panel
  // above — each supplier visible in exactly one place on the page.
  const uncommonSuppliers = useMemo(() => {
    if (commonGroupIds.size === 0) return suppliers;
    return suppliers.filter((s) => !s.supplierGroupId || !commonGroupIds.has(s.supplierGroupId));
  }, [suppliers, commonGroupIds]);

  const filtered = uncommonSuppliers.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.ntn || "").toLowerCase().includes(search.toLowerCase()) ||
    (s.email || "").toLowerCase().includes(search.toLowerCase()) ||
    (s.phone || "").includes(search)
  );

  return (
    <div>
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={styles.headerIcon}>
            <MdLocalShipping size={28} color="#fff" />
          </div>
          <div>
            <h2 style={styles.pageTitle}>Suppliers</h2>
            <p style={styles.pageSubtitle}>
              {selectedCompany
                ? `${uncommonSuppliers.length} company-specific supplier${uncommonSuppliers.length !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}`
                : "Select a company to view suppliers"}
            </p>
          </div>
        </div>
        {companies.length > 0 && canCreate && (
          <button
            style={styles.addBtn}
            onClick={handleAdd}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
          >
            <MdAdd size={18} /> New Supplier
          </button>
        )}
      </div>

      {/* Common Suppliers panel — auto-hides for tenants with no
          multi-company duplicates. Stable across the company dropdown. */}
      {selectedCompany && (
        <CommonSuppliersPanel
          companyId={selectedCompany.id}
          refreshKey={commonRefreshKey}
          onEdit={(s) => setEditingGroupId(s.groupId)}
        />
      )}

      {loadingCompanies ? (
        <div style={styles.loadingContainer}>
          <div style={styles.spinner} />
          <span style={{ color: colors.textSecondary, fontSize: "0.9rem" }}>Loading companies...</span>
        </div>
      ) : companies.length > 0 ? (
        <div style={{ marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <MdBusiness size={20} color={colors.blue} />
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
        </div>
      ) : (
        <div style={styles.emptyState}>
          <MdBusiness size={40} color={colors.cardBorder} />
          <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>No companies available. Add a company first.</p>
        </div>
      )}

      {suppliers.length > 3 && (
        <div style={styles.searchWrap}>
          <MdSearch style={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search suppliers (name / NTN / email / phone)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={styles.searchInput}
          />
        </div>
      )}

      {loadingSuppliers ? (
        <div style={styles.loadingContainer}>
          <div style={styles.spinner} />
          <span style={{ color: colors.textSecondary, fontSize: "0.9rem" }}>Loading suppliers...</span>
        </div>
      ) : filtered.length === 0 && selectedCompany ? (
        <div style={styles.emptyState}>
          <MdLocalShipping size={40} color={colors.cardBorder} />
          <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>
            {suppliers.length === 0 ? "No suppliers for this company yet." : "No suppliers match your search."}
          </p>
        </div>
      ) : (
        <SupplierList
          suppliers={filtered}
          onEdit={handleEdit}
          onCopy={(s) => setCopyingSupplier(s)}
          fetchSuppliers={() => fetchSuppliers(selectedCompany?.id)}
        />
      )}

      {copyingSupplier && (
        <CopyToCompaniesDialog
          open={true}
          title="Copy supplier to other companies"
          subjectLabel={copyingSupplier.name}
          companies={companies}
          excludeIds={[copyingSupplier.companyId]}
          onCancel={() => setCopyingSupplier(null)}
          onConfirm={async (companyIds) => {
            const { data } = await copySupplierToCompanies(copyingSupplier.id, companyIds);
            const createdCount = data?.created?.length ?? 0;
            const skipped = data?.skippedReasons ?? [];
            if (createdCount > 0) {
              notify(
                `Copied "${copyingSupplier.name}" into ${createdCount} ${createdCount === 1 ? "company" : "companies"}` +
                (skipped.length > 0 ? ` (${skipped.length} skipped)` : "."),
                "success"
              );
            } else if (skipped.length > 0) {
              notify(`No copies made — ${skipped[0]}`, "warning");
            }
            setCopyingSupplier(null);
            if (selectedCompany) fetchSuppliers(selectedCompany.id);
            setCommonRefreshKey((k) => k + 1);
          }}
        />
      )}

      {showModal && selectedCompany && (
        <SupplierForm
          supplier={selectedSupplier}
          companyId={selectedCompany.id}
          companies={companies}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            fetchSuppliers(selectedCompany.id);
            // A per-company save can change Name / NTN, which moves
            // the supplier to a different group — bump the panel
            // refresh key so the Common Suppliers list re-pulls.
            setCommonRefreshKey((k) => k + 1);
          }}
        />
      )}

      {/* Common Supplier edit modal — propagates to every member */}
      {editingGroupId != null && (
        <CommonSupplierForm
          groupId={editingGroupId}
          onClose={() => setEditingGroupId(null)}
          onSaved={() => {
            setEditingGroupId(null);
            if (selectedCompany) fetchSuppliers(selectedCompany.id);
            setCommonRefreshKey((k) => k + 1);
          }}
          onChange={() => {
            // Fired after "Add to more companies" — the modal stays
            // open so the operator can keep editing master fields, but
            // the underlying group membership has changed.
            if (selectedCompany) fetchSuppliers(selectedCompany.id);
            setCommonRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

const styles = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" },
  headerIcon: { width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg, #00695c, #00897b)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  pageTitle: { margin: 0, fontSize: "1.5rem", fontWeight: 700, color: colors.textPrimary },
  pageSubtitle: { margin: "0.15rem 0 0", fontSize: "0.88rem", color: colors.textSecondary },
  addBtn: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 1.25rem", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #0d47a1, #00897b)", color: "#fff", fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", transition: "filter 0.2s, transform 0.2s", boxShadow: "0 4px 14px rgba(13,71,161,0.25)" },
  searchWrap: { position: "relative", marginBottom: "1.25rem", maxWidth: 360 },
  searchIcon: { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", fontSize: "1.1rem" },
  searchInput: { width: "100%", padding: "0.55rem 0.75rem 0.55rem 2.3rem", border: "1px solid #d0d7e2", borderRadius: 10, fontSize: "0.88rem", backgroundColor: "#f8f9fb", color: "#1a2332", outline: "none", transition: "border-color 0.2s" },
  loadingContainer: { display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", padding: "3rem 0" },
  spinner: { width: 28, height: 28, border: `3px solid ${colors.cardBorder}`, borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  emptyState: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "3rem 1rem", textAlign: "center" },
};

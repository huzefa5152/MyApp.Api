import RecordsViewport from "../Components/RecordsViewport";
import { useState, useEffect, useMemo } from "react";
import { MdLocalShipping, MdAdd, MdBusiness, MdSearchOff } from "react-icons/md";
import SupplierList from "../Components/SupplierList";
import SupplierForm from "../Components/SupplierForm";
import CommonSupplierForm from "../Components/CommonSupplierForm";
import CopyToCompaniesDialog from "../Components/CopyToCompaniesDialog";
import { getSuppliersByCompany, getCommonSuppliers, copySupplierToCompanies } from "../api/supplierApi";
import { notify } from "../utils/notify";
import PartyToolbar from "../Components/party/PartyToolbar";
import { matchesSearch, countByType } from "../Components/party/partyUtils";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import ImportFromExcelButton from "../Components/onboarding/ImportFromExcelButton";

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
  const [typeFilter, setTypeFilter] = useState("all");
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);

  // Common Supplier edit state — separate from per-company edit
  // because the modal, payload shape and propagation behaviour are
  // all different. commonRefreshKey lets the panel reload after a save.
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [commonRefreshKey, setCommonRefreshKey] = useState(0);

  // Copy-to-companies dialog source.
  const [copyingSupplier, setCopyingSupplier] = useState(null);

  // Common Supplier groups this company shares with others, by group id.
  // Every supplier is listed once; one whose group is here carries a
  // "Common" tag and edits through the Common Supplier form.
  const [commonGroups, setCommonGroups] = useState(() => new Map());

  useEffect(() => {
    if (!selectedCompany) {
      setCommonGroups(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await getCommonSuppliers(selectedCompany.id);
        if (!cancelled) setCommonGroups(new Map((data || []).map((g) => [g.groupId, g])));
      } catch {
        // Soft-fail: the list still works, just without Common tags.
        if (!cancelled) setCommonGroups(new Map());
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
    setTypeFilter("all");
    if (selectedCompany) fetchSuppliers(selectedCompany.id);
    else setSuppliers([]);
  }, [selectedCompany]);

  const handleEdit = (s) => { setSelectedSupplier(s); setShowModal(true); };
  const handleAdd = () => { setSelectedSupplier(null); setShowModal(true); };

  const isCommon = (s) => s.supplierGroupId != null && commonGroups.has(s.supplierGroupId);
  const commonCount = useMemo(() => suppliers.filter(isCommon).length, [suppliers, commonGroups]); // eslint-disable-line react-hooks/exhaustive-deps

  const searched = suppliers.filter((s) => matchesSearch(s, search));
  const counts = { ...countByType(searched), common: searched.filter(isCommon).length };
  const filtered = typeFilter === "all" ? searched
    : typeFilter === "common" ? searched.filter(isCommon)
    : searched.filter((s) => (s.registrationType || "None") === typeFilter);

  return (
    <div>
      <div data-admin-page-header="" style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div data-admin-page-icon="" style={styles.headerIcon}>
            <MdLocalShipping size={28} color="#fff" />
          </div>
          <div>
            <h2 style={styles.pageTitle}>Suppliers</h2>
            <p style={styles.pageSubtitle}>
              {selectedCompany
                ? `${suppliers.length} supplier${suppliers.length !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}` +
                  (commonCount > 0 ? ` · ${commonCount} shared with other companies` : "")
                : "Select a company to view suppliers"}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <ImportFromExcelButton sheet="suppliers" />
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
      </div>

      {loadingCompanies ? (
        <div style={styles.loadingContainer}>
          <div style={styles.spinner} />
          <span style={{ color: colors.textSecondary, fontSize: "0.9rem" }}>Loading companies...</span>
        </div>
      ) : companies.length > 0 ? (
        <PartyToolbar
          companies={companies}
          selectedCompany={selectedCompany}
          onCompanyChange={setSelectedCompany}
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search name, NTN, CNIC, phone, email, address"
          typeFilter={typeFilter}
          onTypeFilter={setTypeFilter}
          counts={counts}
        />
      ) : (
        <div className="pd-empty">
          <span className="pd-empty__icon"><MdBusiness size={30} /></span>
          <strong>No companies yet</strong>
          <p>Add a company first, then its suppliers will appear here.</p>
        </div>
      )}

      <RecordsViewport label="Suppliers records">{loadingSuppliers ? (
        <div className="pd-grid" aria-busy="true" aria-label="Loading suppliers">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="pd-skeleton" />)}
        </div>
      ) : filtered.length === 0 && selectedCompany ? (
        <div className="pd-empty">
          <span className="pd-empty__icon">{suppliers.length === 0 ? <MdLocalShipping size={30} /> : <MdSearchOff size={30} />}</span>
          <strong>{suppliers.length === 0 ? "No suppliers yet" : "No matching suppliers"}</strong>
          <p>
            {suppliers.length === 0
              ? "Add your first supplier, or bring them in from an Excel file."
              : "Try a different search or registration type."}
          </p>
          {suppliers.length === 0 && canCreate && (
            <button type="button" className="pd-btn pd-btn--primary" style={{ flex: "none" }} onClick={handleAdd}>
              <MdAdd size={18} /> New Supplier
            </button>
          )}
        </div>
      ) : (
        <SupplierList
          suppliers={filtered}
          commonGroups={commonGroups}
          onEdit={handleEdit}
          onEditCommon={(groupId) => setEditingGroupId(groupId)}
          onCopy={(s) => setCopyingSupplier(s)}
          fetchSuppliers={() => fetchSuppliers(selectedCompany?.id)}
        />
      )}</RecordsViewport>

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
  headerIcon: { width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg, #0d47a1, #00897b)", boxShadow: "0 10px 22px -10px rgba(13,71,161,0.6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  pageTitle: { margin: 0, fontSize: "1.5rem", fontWeight: 700, color: colors.textPrimary },
  pageSubtitle: { margin: "0.15rem 0 0", fontSize: "0.88rem", color: colors.textSecondary },
  addBtn: { minHeight: 44, display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 1.25rem", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #0d47a1, #00897b)", color: "#fff", fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", transition: "filter 0.2s, transform 0.2s", boxShadow: "0 4px 14px rgba(13,71,161,0.25)" },
  loadingContainer: { display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", padding: "3rem 0" },
  spinner: { width: 28, height: 28, border: `3px solid ${colors.cardBorder}`, borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
};

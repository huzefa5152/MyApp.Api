import { useState, useEffect, useMemo } from "react";
import { MdLocalShipping, MdAdd, MdBusiness } from "react-icons/md";
import SupplierList from "../Components/SupplierList";
import SupplierForm from "../Components/SupplierForm";
import CommonSuppliersPanel from "../Components/CommonSuppliersPanel";
import CommonSupplierForm from "../Components/CommonSupplierForm";
import CopyToCompaniesDialog from "../Components/CopyToCompaniesDialog";
import { getSuppliersByCompany, getCommonSuppliers, copySupplierToCompanies } from "../api/supplierApi";
import { notify } from "../utils/notify";
import { PageHeader, CompanyPicker, Button, Toolbar, SearchBox, EmptyState, Loading } from "../ui/Kit";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import ImportFromExcelButton from "../Components/onboarding/ImportFromExcelButton";

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
      <PageHeader
        icon={MdLocalShipping}
        tone="teal"
        title="Suppliers"
        subtitle={selectedCompany
          ? `${uncommonSuppliers.length} company-specific supplier${uncommonSuppliers.length !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}`
          : "Select a company to view suppliers"}
        actions={(
          <>
            <ImportFromExcelButton sheet="suppliers" />
            {companies.length > 0 && canCreate && <Button variant="primary" icon={MdAdd} onClick={handleAdd}>New Supplier</Button>}
          </>
        )}
      />

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
        <Loading>Loading companies…</Loading>
      ) : companies.length > 0 ? (
        <CompanyPicker />
      ) : (
        <EmptyState icon={MdBusiness}>No companies available. Add a company first.</EmptyState>
      )}

      {suppliers.length > 3 && (
        <Toolbar>
          <SearchBox value={search} onChange={setSearch} placeholder="Search suppliers (name / NTN / email / phone)..." />
        </Toolbar>
      )}

      {loadingSuppliers ? (
        <Loading>Loading suppliers…</Loading>
      ) : filtered.length === 0 && selectedCompany ? (
        <EmptyState icon={MdLocalShipping}>
          {suppliers.length === 0 ? "No suppliers for this company yet." : "No suppliers match your search."}
        </EmptyState>
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

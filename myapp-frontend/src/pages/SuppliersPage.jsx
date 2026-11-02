import RecordsViewport from "../Components/RecordsViewport";
import { useState, useEffect, useMemo } from "react";
import { MdLocalShipping, MdAdd, MdBusiness, MdSearchOff, MdPayments } from "react-icons/md";
import { useNavigate } from "react-router-dom";
import { supplierSummary } from "../api/commercialCostApi";
import SupplierList from "../Components/SupplierList";
import SupplierForm from "../Components/SupplierForm";
import CommonSupplierForm from "../Components/CommonSupplierForm";
import CopyToCompaniesDialog from "../Components/CopyToCompaniesDialog";
import {
  getSuppliersByCompany,
  getCommonSuppliers,
  copySupplierToCompanies,
} from "../api/supplierApi";
import { notify } from "../utils/notify";
import { PageHeader, Button, EmptyState, Loading } from "../ui/Kit";
import PartyToolbar from "../Components/party/PartyToolbar";
import { matchesSearch, countByType } from "../Components/party/partyUtils";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import ImportFromExcelButton from "../Components/onboarding/ImportFromExcelButton";

export default function SuppliersPage() {
  const {
    companies,
    selectedCompany,
    setSelectedCompany,
    loading: loadingCompanies,
  } = useCompany();
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
  // What each supplier is still owed (Supplier Payables' own figure). Only for a
  // role that can see payables; everyone else gets the screen as before.
  const navigate = useNavigate();
  const canSeePayables = has("purchasebills.payables.view");
  const [payables, setPayables] = useState(null);
  useEffect(() => {
    setPayables(null);
    if (!canSeePayables || !selectedCompany?.id) return;
    let active = true;
    supplierSummary(selectedCompany.id)
      .then(({ data }) => {
        if (active)
          setPayables(new Map((data || []).map((r) => [r.supplierId, Number(r.netBalance) || 0])));
      })
      .catch(() => {
        if (active) setPayables(null);
      });
    return () => {
      active = false;
    };
  }, [canSeePayables, selectedCompany?.id, suppliers]);
  const totalPayable = payables
    ? [...payables.values()].reduce((sum, v) => sum + Math.max(0, v), 0)
    : 0;

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
    return () => {
      cancelled = true;
    };
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

  const handleEdit = (s) => {
    setSelectedSupplier(s);
    setShowModal(true);
  };
  const handleAdd = () => {
    setSelectedSupplier(null);
    setShowModal(true);
  };

  const isCommon = (s) => s.supplierGroupId != null && commonGroups.has(s.supplierGroupId);
  const commonCount = useMemo(() => suppliers.filter(isCommon).length, [suppliers, commonGroups]); // eslint-disable-line react-hooks/exhaustive-deps

  const searched = suppliers.filter((s) => matchesSearch(s, search));
  const counts = { ...countByType(searched), common: searched.filter(isCommon).length };
  const filtered =
    typeFilter === "all"
      ? searched
      : typeFilter === "common"
        ? searched.filter(isCommon)
        : searched.filter((s) => (s.registrationType || "None") === typeFilter);

  return (
    <div>
      <PageHeader
        icon={MdLocalShipping}
        tone="teal"
        title="Suppliers"
        subtitle={
          selectedCompany
            ? `${suppliers.length} supplier${suppliers.length !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}` +
              (commonCount > 0 ? ` · ${commonCount} shared with other companies` : "")
            : "Select a company to view suppliers"
        }
        actions={
          <>
            {payables && (
              <Button
                icon={MdPayments}
                onClick={() => navigate("/supplier-payables")}
                title="Open Supplier Payables to see and pay what each supplier is owed"
              >
                <span>
                  Total payable{" "}
                  <strong>
                    Rs.{" "}
                    {totalPayable.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </strong>
                </span>
              </Button>
            )}
            <ImportFromExcelButton sheet="suppliers" />
            {companies.length > 0 && canCreate && (
              <Button variant="primary" icon={MdAdd} onClick={handleAdd}>
                New Supplier
              </Button>
            )}
          </>
        }
      />

      {loadingCompanies ? (
        <Loading>Loading companies…</Loading>
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
        <EmptyState icon={MdBusiness} title="No companies yet">
          Add a company first, then its suppliers will appear here.
        </EmptyState>
      )}

      <RecordsViewport label="Suppliers records">
        {loadingSuppliers ? (
          <Loading>Loading suppliers…</Loading>
        ) : filtered.length === 0 && selectedCompany ? (
          <EmptyState
            icon={suppliers.length === 0 ? MdLocalShipping : MdSearchOff}
            title={suppliers.length === 0 ? "No suppliers yet" : "No matching suppliers"}
            action={
              suppliers.length === 0 && canCreate ? (
                <Button variant="primary" icon={MdAdd} onClick={handleAdd}>
                  New Supplier
                </Button>
              ) : null
            }
          >
            {suppliers.length === 0
              ? "Add your first supplier, or bring them in from an Excel file."
              : "Try a different search or registration type."}
          </EmptyState>
        ) : (
          <SupplierList
            suppliers={filtered}
            commonGroups={commonGroups}
            onEdit={handleEdit}
            onEditCommon={(groupId) => setEditingGroupId(groupId)}
            onCopy={(s) => setCopyingSupplier(s)}
            fetchSuppliers={() => fetchSuppliers(selectedCompany?.id)}
            payables={payables}
          />
        )}
      </RecordsViewport>

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
                "success",
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

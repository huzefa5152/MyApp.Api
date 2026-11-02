import RecordsViewport from "../Components/RecordsViewport";
import { useState, useEffect, useMemo } from "react";
import { MdPeople, MdAdd, MdBusiness, MdSearchOff } from "react-icons/md";
import ClientList from "../Components/ClientList";
import ClientForm from "../Components/ClientForm";
import CommonClientForm from "../Components/CommonClientForm";
import CopyToCompaniesDialog from "../Components/CopyToCompaniesDialog";
import { getClientsByCompany, getCommonClients, copyClientToCompanies } from "../api/clientApi";
import { notify } from "../utils/notify";
import { PageHeader, Button, EmptyState, Loading } from "../ui/Kit";
import PartyToolbar from "../Components/party/PartyToolbar";
import { matchesSearch, countByType } from "../Components/party/partyUtils";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import ImportFromExcelButton from "../Components/onboarding/ImportFromExcelButton";

export default function ClientsPage() {
  const {
    companies,
    selectedCompany,
    setSelectedCompany,
    loading: loadingCompanies,
  } = useCompany();
  const { has } = usePermissions();
  const canCreate = has("clients.manage.create");
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [loadingClients, setLoadingClients] = useState(false);

  // Common Client edit state — separate from per-company edit because
  // the modal, payload shape and propagation behaviour are all different.
  // commonRefreshKey lets the panel reload its list after a save (display
  // names / membership might have shifted).
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [commonRefreshKey, setCommonRefreshKey] = useState(0);

  // Copy-to-companies dialog: holds the source client when open, null when closed.
  const [copyingClient, setCopyingClient] = useState(null);

  // Common Client groups this company shares with others, by group id.
  // Every client is listed once in the grid; one whose group is here
  // carries a "Common" tag and edits through the Common Client form,
  // which applies the change to every company's copy.
  const [commonGroups, setCommonGroups] = useState(() => new Map());

  useEffect(() => {
    if (!selectedCompany) {
      setCommonGroups(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await getCommonClients(selectedCompany.id);
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

  const fetchClients = async (companyId) => {
    if (!companyId) return;
    setLoadingClients(true);
    try {
      const { data } = await getClientsByCompany(companyId);
      setClients(data);
    } catch {
      setClients([]);
    } finally {
      setLoadingClients(false);
    }
  };

  useEffect(() => {
    setTypeFilter("all");
    if (selectedCompany) fetchClients(selectedCompany.id);
    else setClients([]);
  }, [selectedCompany]);

  const handleEdit = (client) => {
    setSelectedClient(client);
    setShowModal(true);
  };

  const handleAdd = () => {
    setSelectedClient(null);
    setShowModal(true);
  };

  const isCommon = (c) => c.clientGroupId != null && commonGroups.has(c.clientGroupId);
  const commonCount = useMemo(() => clients.filter(isCommon).length, [clients, commonGroups]); // eslint-disable-line react-hooks/exhaustive-deps

  const searched = clients.filter((c) => matchesSearch(c, search));
  const counts = { ...countByType(searched), common: searched.filter(isCommon).length };
  const filtered =
    typeFilter === "all"
      ? searched
      : typeFilter === "common"
        ? searched.filter(isCommon)
        : searched.filter((c) => (c.registrationType || "None") === typeFilter);

  return (
    <div>
      <PageHeader
        icon={MdPeople}
        tone="teal"
        title="Clients"
        subtitle={
          selectedCompany
            ? `${clients.length} client${clients.length !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}` +
              (commonCount > 0 ? ` · ${commonCount} shared with other companies` : "")
            : "Select a company to view clients"
        }
        actions={
          <>
            <ImportFromExcelButton sheet="customers" />
            {companies.length > 0 && canCreate && (
              <Button variant="primary" icon={MdAdd} onClick={handleAdd}>
                New Client
              </Button>
            )}
          </>
        }
      />

      {/* Company picker (hidden in Workspace: the topbar switches company),
          search and registration-type / Common chips — same toolbar as Suppliers. */}
      {loadingCompanies ? (
        <Loading>Loading companies...</Loading>
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
          Add a company first, then its clients will appear here.
        </EmptyState>
      )}

      {/* Client List */}
      <RecordsViewport label="Clients records">
        {loadingClients ? (
          <Loading>Loading clients...</Loading>
        ) : filtered.length === 0 && selectedCompany ? (
          <EmptyState
            icon={clients.length === 0 ? MdPeople : MdSearchOff}
            title={clients.length === 0 ? "No clients yet" : "No matching clients"}
            action={
              clients.length === 0 && canCreate ? (
                <Button variant="primary" icon={MdAdd} onClick={handleAdd}>
                  New Client
                </Button>
              ) : null
            }
          >
            {clients.length === 0
              ? "Add your first client, or bring them in from an Excel file."
              : "Try a different search or registration type."}
          </EmptyState>
        ) : (
          <ClientList
            clients={filtered}
            commonGroups={commonGroups}
            onEdit={handleEdit}
            onEditCommon={(groupId) => setEditingGroupId(groupId)}
            onCopy={(client) => setCopyingClient(client)}
            fetchClients={() => fetchClients(selectedCompany?.id)}
          />
        )}
      </RecordsViewport>

      {/* Copy client into other companies — shared dialog used by both
          the per-company list (this screen) and the Common Client edit
          modal. Excludes the source's own company from the picker so
          the operator can't accidentally try to copy a client onto
          itself (the backend also defends against this). */}
      {copyingClient && (
        <CopyToCompaniesDialog
          open={true}
          title="Copy client to other companies"
          subjectLabel={copyingClient.name}
          companies={companies}
          excludeIds={[copyingClient.companyId]}
          onCancel={() => setCopyingClient(null)}
          onConfirm={async (companyIds) => {
            const { data } = await copyClientToCompanies(copyingClient.id, companyIds);
            const createdCount = data?.created?.length ?? 0;
            const skipped = data?.skippedReasons ?? [];
            if (createdCount > 0) {
              notify(
                `Copied "${copyingClient.name}" into ${createdCount} ${createdCount === 1 ? "company" : "companies"}` +
                  (skipped.length > 0 ? ` (${skipped.length} skipped)` : "."),
                "success",
              );
            } else if (skipped.length > 0) {
              notify(`No copies made — ${skipped[0]}`, "warning");
            }
            setCopyingClient(null);
            // Fresh data: the source company's per-row count didn't change
            // but the Common Clients panel almost certainly did (the source
            // and new copies should now share a group).
            if (selectedCompany) fetchClients(selectedCompany.id);
            setCommonRefreshKey((k) => k + 1);
          }}
        />
      )}

      {/* Client Form Modal — `companies` enables the multi-company
          picker on Add. On Edit, the picker is hidden (a Client row
          can only belong to one company; cross-tenant edits are done
          via the Common Client form). */}
      {showModal && selectedCompany && (
        <ClientForm
          client={selectedClient}
          companyId={selectedCompany.id}
          companies={companies}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            fetchClients(selectedCompany.id);
            // A per-company save can change Name / NTN, which moves
            // the client to a different group — bump the panel refresh
            // key so the Common Clients list re-pulls.
            setCommonRefreshKey((k) => k + 1);
          }}
        />
      )}

      {/* Common Client edit modal — propagates to every member */}
      {editingGroupId != null && (
        <CommonClientForm
          groupId={editingGroupId}
          onClose={() => setEditingGroupId(null)}
          onSaved={() => {
            setEditingGroupId(null);
            // Refresh BOTH the per-company list (this company's row may
            // have changed name/NTN) AND the common panel.
            if (selectedCompany) fetchClients(selectedCompany.id);
            setCommonRefreshKey((k) => k + 1);
          }}
          onChange={() => {
            // Background-refresh signal — fired when the modal mutated
            // something (e.g. a per-company "remove from this company"
            // delete) but should stay open so the operator can keep
            // managing the rest of the group.
            if (selectedCompany) fetchClients(selectedCompany.id);
            setCommonRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

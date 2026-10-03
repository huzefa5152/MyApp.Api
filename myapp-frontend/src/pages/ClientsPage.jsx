import { useState, useEffect, useMemo } from "react";
import { MdPeople, MdAdd, MdBusiness } from "react-icons/md";
import ClientList from "../Components/ClientList";
import ClientForm from "../Components/ClientForm";
import CommonClientsPanel from "../Components/CommonClientsPanel";
import CommonClientForm from "../Components/CommonClientForm";
import CopyToCompaniesDialog from "../Components/CopyToCompaniesDialog";
import { getClientsByCompany, getCommonClients, copyClientToCompanies } from "../api/clientApi";
import { notify } from "../utils/notify";
import { PageHeader, CompanyPicker, Button, Toolbar, SearchBox, EmptyState, Loading } from "../ui/Kit";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import ImportFromExcelButton from "../Components/onboarding/ImportFromExcelButton";

export default function ClientsPage() {
  const { companies, selectedCompany, setSelectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const canCreate = has("clients.manage.create");
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [loadingClients, setLoadingClients] = useState(false);

  // Common Client edit state — separate from per-company edit because
  // the modal, payload shape and propagation behaviour are all different.
  // commonRefreshKey lets the panel reload its list after a save (display
  // names / membership might have shifted).
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [commonRefreshKey, setCommonRefreshKey] = useState(0);

  // Copy-to-companies dialog: holds the source client when open, null when closed.
  const [copyingClient, setCopyingClient] = useState(null);

  // The set of multi-company group IDs visible right now — used to
  // hide those clients from the per-company list below the dropdown.
  // Same data the CommonClientsPanel renders (kept in sync via
  // commonRefreshKey), only the IDs are needed here so it's a thin
  // shadow query rather than a duplicate fetch.
  const [commonGroupIds, setCommonGroupIds] = useState(() => new Set());

  useEffect(() => {
    if (!selectedCompany) {
      setCommonGroupIds(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await getCommonClients(selectedCompany.id);
        if (!cancelled) {
          setCommonGroupIds(new Set((data || []).map((g) => g.groupId)));
        }
      } catch {
        if (!cancelled) setCommonGroupIds(new Set());
      }
    })();
    return () => { cancelled = true; };
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

  // Hide clients that already appear in the Common Clients panel
  // above — operator wants exactly ONE place to edit each client,
  // not the same name listed twice on the same page.
  const uncommonClients = useMemo(() => {
    if (commonGroupIds.size === 0) return clients;
    return clients.filter((c) => !c.clientGroupId || !commonGroupIds.has(c.clientGroupId));
  }, [clients, commonGroupIds]);

  const filtered = uncommonClients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.email || "").toLowerCase().includes(search.toLowerCase()) ||
    (c.phone || "").includes(search)
  );

  return (
    <div>
      <PageHeader
        icon={MdPeople}
        tone="teal"
        title="Clients"
        subtitle={selectedCompany
          ? `${uncommonClients.length} company-specific client${uncommonClients.length !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}`
          : "Select a company to view clients"}
        actions={(
          <>
            <ImportFromExcelButton sheet="customers" />
            {companies.length > 0 && canCreate && <Button variant="primary" icon={MdAdd} onClick={handleAdd}>New Client</Button>}
          </>
        )}
      />

      {/* Common Clients panel — shows ONLY when this company shares
          a client (by NTN, fallback to name) with at least one other
          company. Empty / single-tenant setups render nothing here. */}
      {selectedCompany && (
        <CommonClientsPanel
          companyId={selectedCompany.id}
          refreshKey={commonRefreshKey}
          onEdit={(c) => setEditingGroupId(c.groupId)}
        />
      )}

      {/* Company Selector */}
      {loadingCompanies ? (
        <Loading>Loading companies...</Loading>
      ) : companies.length > 0 ? (
        <CompanyPicker />
      ) : (
        <EmptyState icon={MdBusiness}>No companies available. Add a company first.</EmptyState>
      )}

      {/* Search */}
      {clients.length > 3 && (
        <Toolbar>
          <SearchBox value={search} onChange={setSearch} placeholder="Search clients..." />
        </Toolbar>
      )}

      {/* Client List */}
      {loadingClients ? (
        <Loading>Loading clients...</Loading>
      ) : filtered.length === 0 && selectedCompany ? (
        <EmptyState icon={MdPeople}>
          {clients.length === 0 ? "No clients for this company yet." : "No clients match your search."}
        </EmptyState>
      ) : (
        <ClientList
          clients={filtered}
          onEdit={handleEdit}
          onCopy={(client) => setCopyingClient(client)}
          fetchClients={() => fetchClients(selectedCompany?.id)}
        />
      )}

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
                "success"
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

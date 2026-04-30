import { useState, useEffect } from "react";
import { MdPeople, MdAdd, MdSearch, MdBusiness } from "react-icons/md";
import ClientList from "../Components/ClientList";
import ClientForm from "../Components/ClientForm";
import CommonClientsPanel from "../Components/CommonClientsPanel";
import CommonClientForm from "../Components/CommonClientForm";
import { getClientsByCompany } from "../api/clientApi";
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

  const filtered = clients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.email || "").toLowerCase().includes(search.toLowerCase()) ||
    (c.phone || "").includes(search)
  );

  return (
    <div>
      {/* Page Header */}
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={styles.headerIcon}>
            <MdPeople size={28} color="#fff" />
          </div>
          <div>
            <h2 style={styles.pageTitle}>Clients</h2>
            <p style={styles.pageSubtitle}>
              {selectedCompany
                ? `${clients.length} client${clients.length !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}`
                : "Select a company to view clients"}
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
            <MdAdd size={18} /> New Client
          </button>
        )}
      </div>

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

      {/* Search */}
      {clients.length > 3 && (
        <div style={styles.searchWrap}>
          <MdSearch style={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search clients..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={styles.searchInput}
          />
        </div>
      )}

      {/* Client List */}
      {loadingClients ? (
        <div style={styles.loadingContainer}>
          <div style={styles.spinner} />
          <span style={{ color: colors.textSecondary, fontSize: "0.9rem" }}>Loading clients...</span>
        </div>
      ) : filtered.length === 0 && selectedCompany ? (
        <div style={styles.emptyState}>
          <MdPeople size={40} color={colors.cardBorder} />
          <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>
            {clients.length === 0 ? "No clients for this company yet." : "No clients match your search."}
          </p>
        </div>
      ) : (
        <ClientList
          clients={filtered}
          onEdit={handleEdit}
          fetchClients={() => fetchClients(selectedCompany?.id)}
        />
      )}

      {/* Client Form Modal */}
      {showModal && selectedCompany && (
        <ClientForm
          client={selectedClient}
          companyId={selectedCompany.id}
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
        />
      )}
    </div>
  );
}

const styles = {
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "1rem",
    marginBottom: "1.5rem",
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    background: "linear-gradient(135deg, #00695c, #00897b)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  pageTitle: {
    margin: 0,
    fontSize: "1.5rem",
    fontWeight: 700,
    color: colors.textPrimary,
  },
  pageSubtitle: {
    margin: "0.15rem 0 0",
    fontSize: "0.88rem",
    color: colors.textSecondary,
  },
  addBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    padding: "0.55rem 1.25rem",
    borderRadius: 10,
    border: "none",
    background: "linear-gradient(135deg, #0d47a1, #00897b)",
    color: "#fff",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "filter 0.2s, transform 0.2s",
    boxShadow: "0 4px 14px rgba(13,71,161,0.25)",
  },
  searchWrap: {
    position: "relative",
    marginBottom: "1.25rem",
    maxWidth: 360,
  },
  searchIcon: {
    position: "absolute",
    left: 12,
    top: "50%",
    transform: "translateY(-50%)",
    color: "#94a3b8",
    fontSize: "1.1rem",
  },
  searchInput: {
    width: "100%",
    padding: "0.55rem 0.75rem 0.55rem 2.3rem",
    border: "1px solid #d0d7e2",
    borderRadius: 10,
    fontSize: "0.88rem",
    backgroundColor: "#f8f9fb",
    color: "#1a2332",
    outline: "none",
    transition: "border-color 0.2s",
  },
  loadingContainer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.75rem",
    padding: "3rem 0",
  },
  spinner: {
    width: 28,
    height: 28,
    border: `3px solid ${colors.cardBorder}`,
    borderTopColor: colors.blue,
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "3rem 1rem",
    textAlign: "center",
  },
};

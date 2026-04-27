import { useState, useEffect } from "react";
import { MdLocalShipping, MdAdd, MdSearch, MdBusiness } from "react-icons/md";
import SupplierList from "../Components/SupplierList";
import SupplierForm from "../Components/SupplierForm";
import { getSuppliersByCompany } from "../api/supplierApi";
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

  const filtered = suppliers.filter((s) =>
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
                ? `${suppliers.length} supplier${suppliers.length !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}`
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
          fetchSuppliers={() => fetchSuppliers(selectedCompany?.id)}
        />
      )}

      {showModal && selectedCompany && (
        <SupplierForm
          supplier={selectedSupplier}
          companyId={selectedCompany.id}
          onClose={() => setShowModal(false)}
          onSaved={() => fetchSuppliers(selectedCompany.id)}
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

import { useState, useEffect } from "react";
import { MdDescription, MdAdd, MdBusiness } from "react-icons/md";
import ChallanList from "../Components/ChallanList";
import ChallanForm from "../Components/ChallanForm";
import { getDeliveryChallansByCompany, createDeliveryChallan } from "../api/challanApi";
import { getCompanies } from "../api/companyApi";
import { dropdownStyles } from "../theme";

const colors = {
  blue: "#0d47a1",
  blueLight: "#1565c0",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
};

export default function ChallanPage() {
  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [challans, setChallans] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [loadingChallans, setLoadingChallans] = useState(false);

  const fetchCompanies = async () => {
    setLoadingCompanies(true);
    try {
      const { data } = await getCompanies();
      setCompanies(data);
      if (!selectedCompany && data.length > 0) setSelectedCompany(data[0]);
    } catch {
      alert("Failed to fetch companies. Please try again.");
    } finally {
      setLoadingCompanies(false);
    }
  };

  const fetchChallans = async (companyId) => {
    if (!companyId) return;
    setLoadingChallans(true);
    try {
      const { data } = await getDeliveryChallansByCompany(companyId);
      setChallans(data);
    } catch {
      setChallans([]);
      alert("Failed to fetch delivery challans.");
    } finally {
      setLoadingChallans(false);
    }
  };

  useEffect(() => { fetchCompanies(); }, []);
  useEffect(() => {
    if (selectedCompany) fetchChallans(selectedCompany.id);
    else setChallans([]);
  }, [selectedCompany]);

  const handleAddChallan = () => { if (selectedCompany) setShowModal(true); };

  const handleSaveChallan = async (payload) => {
    if (!selectedCompany) return;
    await createDeliveryChallan(selectedCompany.id, payload);
    await fetchChallans(selectedCompany.id);
    setShowModal(false);
  };

  return (
    <div>
      {/* Page Header */}
      <div style={styles.pageHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={styles.headerIcon}>
            <MdDescription size={28} color="#fff" />
          </div>
          <div>
            <h2 style={styles.pageTitle}>Delivery Challans</h2>
            <p style={styles.pageSubtitle}>
              {selectedCompany
                ? `${challans.length} challan${challans.length !== 1 ? "s" : ""} for ${selectedCompany.name}`
                : "Select a company to view challans"}
            </p>
          </div>
        </div>
        {companies.length > 0 && (
          <button style={styles.addBtn} onClick={handleAddChallan}>
            <MdAdd size={18} /> New Challan
          </button>
        )}
      </div>

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
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      ) : (
        <div style={styles.emptyState}>
          <MdBusiness size={40} color={colors.cardBorder} />
          <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>No companies available. Add a company first.</p>
        </div>
      )}

      {/* Challan List */}
      {loadingChallans ? (
        <div style={styles.loadingContainer}>
          <div style={styles.spinner} />
          <span style={{ color: colors.textSecondary, fontSize: "0.9rem" }}>Loading challans...</span>
        </div>
      ) : challans.length === 0 && selectedCompany ? (
        <div style={styles.emptyState}>
          <MdDescription size={40} color={colors.cardBorder} />
          <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>No delivery challans found for this company.</p>
        </div>
      ) : (
        <ChallanList challans={challans} />
      )}

      {/* Create Challan Modal */}
      {showModal && selectedCompany && (
        <ChallanForm
          companyId={selectedCompany.id}
          onClose={() => setShowModal(false)}
          onSaved={handleSaveChallan}
        />
      )}
    </div>
  );
}

const styles = {
  pageHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "1.5rem",
    flexWrap: "wrap",
    gap: "1rem",
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`,
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
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`,
    color: "#fff",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "filter 0.2s, transform 0.2s",
    boxShadow: "0 4px 14px rgba(13,71,161,0.25)",
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

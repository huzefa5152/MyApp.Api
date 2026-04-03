import { useState, useEffect } from "react";
import { MdBusiness, MdAdd, MdSearch } from "react-icons/md";
import CompanyList from "../Components/CompanyList";
import CompanyForm from "../Components/CompanyForm";
import { getCompanies } from "../api/companyApi";

const styles = {
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "1rem",
    marginBottom: "1.5rem",
  },
  titleWrap: {
    display: "flex",
    alignItems: "center",
    gap: "0.7rem",
  },
  titleIcon: {
    width: "42px",
    height: "42px",
    borderRadius: "12px",
    background: "linear-gradient(135deg, #0d47a1, #1565c0)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "1.3rem",
  },
  title: {
    fontSize: "1.45rem",
    fontWeight: "800",
    color: "#1a2332",
    margin: 0,
  },
  subtitle: {
    fontSize: "0.82rem",
    color: "#5f6d7e",
    margin: 0,
  },
  addBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    padding: "0.55rem 1.2rem",
    background: "linear-gradient(135deg, #0d47a1, #00897b)",
    color: "#fff",
    border: "none",
    borderRadius: "10px",
    fontSize: "0.88rem",
    fontWeight: "600",
    cursor: "pointer",
    transition: "transform 0.2s, box-shadow 0.2s",
    boxShadow: "0 4px 14px rgba(13,71,161,0.25)",
  },
  searchWrap: {
    position: "relative",
    marginBottom: "1.25rem",
    maxWidth: "360px",
  },
  searchIcon: {
    position: "absolute",
    left: "12px",
    top: "50%",
    transform: "translateY(-50%)",
    color: "#94a3b8",
    fontSize: "1.1rem",
  },
  searchInput: {
    width: "100%",
    padding: "0.55rem 0.75rem 0.55rem 2.3rem",
    border: "1px solid #d0d7e2",
    borderRadius: "10px",
    fontSize: "0.88rem",
    backgroundColor: "#f8f9fb",
    color: "#1a2332",
    outline: "none",
    transition: "border-color 0.2s",
  },
  empty: {
    textAlign: "center",
    padding: "3rem 1rem",
    color: "#5f6d7e",
    fontSize: "0.95rem",
  },
};

export default function CompanyPage() {
  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");

  const fetchCompanies = async () => {
    try {
      const { data } = await getCompanies();
      setCompanies(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCompanies();
  }, []);

  const handleEdit = (company) => {
    setSelectedCompany(company);
    setShowModal(true);
  };

  const handleAdd = () => {
    setSelectedCompany(null);
    setShowModal(true);
  };

  const filtered = companies.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div style={styles.header}>
        <div style={styles.titleWrap}>
          <div style={styles.titleIcon}><MdBusiness /></div>
          <div>
            <h2 style={styles.title}>Companies</h2>
            <p style={styles.subtitle}>{companies.length} registered {companies.length === 1 ? "company" : "companies"}</p>
          </div>
        </div>
        <button
          style={styles.addBtn}
          onClick={handleAdd}
          onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
        >
          <MdAdd /> New Company
        </button>
      </div>

      {companies.length > 2 && (
        <div style={styles.searchWrap}>
          <MdSearch style={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search companies..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={styles.searchInput}
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={styles.empty}>
          {companies.length === 0 ? "No companies added yet. Click \"New Company\" to get started." : "No companies match your search."}
        </div>
      ) : (
        <CompanyList
          companies={filtered}
          onEdit={handleEdit}
          fetchCompanies={fetchCompanies}
        />
      )}

      {showModal && (
        <CompanyForm
          company={selectedCompany}
          onClose={() => setShowModal(false)}
          onSaved={fetchCompanies}
        />
      )}
    </div>
  );
}

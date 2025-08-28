import { useState, useEffect } from "react";
import CompanyList from "../Components/CompanyList";
import CompanyForm from "../Components/CompanyForm";
import { getCompanies } from "../api/companyApi";

export default function CompanyPage() {
  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [showModal, setShowModal] = useState(false);

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

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2>Companies</h2>
        <button className="btn btn-primary" onClick={handleAdd}>
          + New Company
        </button>
      </div>

      {companies.length === 0 ? (
        <p className="text-muted">No companies found.</p>
      ) : (
        <CompanyList
          companies={companies}
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

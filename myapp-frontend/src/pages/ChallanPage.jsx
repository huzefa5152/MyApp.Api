import { useState, useEffect } from "react";
import ChallanList from "../Components/ChallanList";
import ChallanForm from "../Components/ChallanForm";
import { getDeliveryChallansByCompany, createDeliveryChallan } from "../api/challanApi";
import { getCompanies } from "../api/companyApi";

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
    } catch (err) {
      console.error(err);
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
    } catch (err) {
      console.error(err);
      setChallans([]);
      alert("Failed to fetch delivery challans.");
    } finally {
      setLoadingChallans(false);
    }
  };

  useEffect(() => {
    fetchCompanies();
  }, []);

  useEffect(() => {
    if (selectedCompany) fetchChallans(selectedCompany.id);
    else setChallans([]);
  }, [selectedCompany]);

  const handleAddChallan = () => {
    if (selectedCompany) setShowModal(true);
  };

  const handleSaveChallan = async (payload) => {
    if (!selectedCompany) return;
    await createDeliveryChallan(selectedCompany.id, payload);
    await fetchChallans(selectedCompany.id);
    setShowModal(false);
  };

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2>Delivery Challans</h2>
        {companies.length > 0 && (
          <button className="btn btn-primary" onClick={handleAddChallan}>
            + New Challan
          </button>
        )}
      </div>

      {/* Company Dropdown */}
      {loadingCompanies ? (
        <div className="d-flex justify-content-center my-4">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading companies...</span>
          </div>
        </div>
      ) : companies.length > 0 ? (
        <div className="mb-5">
          <select
            className="form-select w-25 rounded"
            value={selectedCompany?.id || ""}
            onChange={(e) =>
              setSelectedCompany(
                companies.find((c) => parseInt(c.id) === parseInt(e.target.value))
              )
            }
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p>No companies available.</p>
      )}

      {/* Challan List */}
      {loadingChallans ? (
        <div className="d-flex justify-content-center my-4">
          <div className="spinner-border text-success" role="status">
            <span className="visually-hidden">Loading delivery challans...</span>
          </div>
        </div>
      ) : challans.length === 0 ? (
        <p>No delivery challans found.</p>
      ) : (
        <ChallanList challans={challans} />
      )}

      {/* Modal */}
      {showModal && selectedCompany && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            zIndex: 9999,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
          onClick={() => setShowModal(false)}
        >
          <div
            style={{
              backgroundColor: "white",
              padding: "1.5rem",
              borderRadius: "0.5rem",
              minWidth: "400px",
              maxWidth: "600px",
            }}
            onClick={(e) => e.stopPropagation()} // prevent closing
          >
            <ChallanForm
              companyId={selectedCompany.id}
              onClose={() => setShowModal(false)}
              onSaved={handleSaveChallan}
            />
          </div>
        </div>
      )}


      {/* CSS Animations */}
      <style>
        {`
          .fade-in {
            opacity: 0;
            animation: fadeIn 0.3s forwards;
          }
          .slide-up {
            transform: translateY(20px);
            animation: slideUp 0.3s forwards;
          }
          @keyframes fadeIn {
            to { opacity: 1; }
          }
          @keyframes slideUp {
            to { transform: translateY(0); }
          }
        `}
      </style>
    </div>
  );
}

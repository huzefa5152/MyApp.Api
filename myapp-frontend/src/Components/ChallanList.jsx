import { useState } from "react";
import ChallanModal from "./ChallanModal";

export default function ChallanList({ challans }) {
  const [selectedChallan, setSelectedChallan] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");

  if (!challans || challans.length === 0)
    return <p className="text-muted">No challans found.</p>;

  const filteredChallans = challans.filter((c) => {
    const term = searchTerm.toLowerCase();
    return (
      c.challanNumber.toString().includes(term) ||
      c.clientName.toLowerCase().includes(term) ||
      (c.poNumber && c.poNumber.toLowerCase().includes(term))
    );
  });

  return (
    <>
      {/* Search Bar */}
      <div className="mb-5">
        <input
          type="text"
          className="form-control w-50 rounded"
          placeholder="Search by Challan #, Client, or PO Number..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Scrollable list container */}
      <div
        className="row g-3 mb-3"
        style={{
          maxHeight: "calc(100vh - 294px)",
          overflowY: "auto",
        }}
      >
        {filteredChallans.length === 0 && (
          <p className="text-muted">No matching challans found.</p>
        )}

        {filteredChallans.map((c) => (
          <div key={c.challanNumber} className="col-md-4">
            <div className="card shadow-sm h-100">
              <div className="card-body d-flex flex-column">
                <div className="d-flex justify-content-between mb-2">
                  <h5 className="card-title">Challan #{c.challanNumber}</h5>
                  <span className="text-muted">
                    {new Date(c.deliveryDate).toLocaleDateString()}
                  </span>
                </div>

                <p className="mb-1">
                  <strong>Client:</strong> {c.clientName}
                </p>
                <p className="mb-2">
                  <strong>PO Number:</strong> {c.poNumber || "-"}
                </p>

                <button
                  className="btn btn-outline-primary btn-sm mt-auto align-self-start mb-3"
                  onClick={() => setSelectedChallan(c)}
                >
                  View Details
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Extracted Modal */}
      <ChallanModal
        challan={selectedChallan}
        onClose={() => setSelectedChallan(null)}
      />
    </>
  );
}

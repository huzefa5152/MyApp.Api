export default function ChallanModal({ challan, onClose }) {
  if (!challan) return null;

  return (
    <div
      className="modal fade show"
      style={{ display: "block", backgroundColor: "rgba(0,0,0,0.5)" }}
      tabIndex="-1"
    >
      <div className="modal-dialog modal-lg modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              Challan #{challan.challanNumber} Details
            </h5>
            <button type="button" className="btn-close" onClick={onClose}></button>
          </div>

          <div className="modal-body">
            <p>
              <strong>Client:</strong> {challan.clientName}
            </p>
            <p>
              <strong>PO Number:</strong> {challan.poNumber || "-"}
            </p>
            <p>
              <strong>Delivery Date:</strong>{" "}
              {new Date(challan.deliveryDate).toLocaleDateString()}
            </p>

            <strong>Items:</strong>
            <div
              className="table-responsive mt-2 table-responsive-bordered-fix"
              style={{ maxHeight: "300px", overflowY: "auto" }}
            >
              <table className="table table-sm table-bordered mb-0 challan-items-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {challan.items.map((i, idx) => (
                    <tr key={idx}>
                      <td>{idx + 1}</td>
                      <td>{i.description}</td>
                      <td>{i.quantity}</td>
                      <td>{i.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

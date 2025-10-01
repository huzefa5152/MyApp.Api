import { useState, useEffect } from "react";
import ClientList from "../Components/ClientList";
import ClientForm from "../Components/ClientForm";
import { getClients } from "../api/clientApi";

export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const fetchClients = async () => {
    try {
      const { data } = await getClients();
      setClients(data);
    } catch (err) {
      console.error("Error fetching clients:", err);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const handleEdit = (client) => {
    setSelectedClient(client);
    setShowModal(true);
  };

  const handleAdd = () => {
    setSelectedClient(null);
    setShowModal(true);
  };

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2>Clients</h2>
        <button className="btn btn-primary" onClick={handleAdd}>
          + New Client
        </button>
      </div>

      {clients.length === 0 ? (
        <p className="text-muted">No clients found.</p>
      ) : (
        <ClientList
          clients={clients}
          onEdit={handleEdit}
          fetchClients={fetchClients}
        />
      )}

      {showModal && (
        <ClientForm
          client={selectedClient}
          onClose={() => setShowModal(false)}
          onSaved={fetchClients}
        />
      )}
    </div>
  );
}

import { MdEmail, MdPhone, MdLocationOn, MdEdit, MdDelete } from "react-icons/md";
import { deleteClient } from "../api/clientApi";
import { cardStyles, cardHover } from "../theme";

export default function ClientList({ clients, onEdit, fetchClients }) {
  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this client?")) return;
    try {
      await deleteClient(id);
      fetchClients();
    } catch (err) {
      console.error("Error deleting client:", err);
    }
  };

  return (
    <div className="card-grid">
      {clients.map((client) => (
        <div
          key={client.id}
          style={cardStyles.card}
          onMouseEnter={(e) => Object.assign(e.currentTarget.style, cardHover)}
          onMouseLeave={(e) =>
            Object.assign(e.currentTarget.style, {
              transform: "none",
              boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
            })
          }
        >
          <div style={cardStyles.cardContent}>
            <div>
              <h5 style={cardStyles.title}>{client.name}</h5>
              {client.email && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <MdEmail style={{ color: "#0d47a1", flexShrink: 0 }} /> {client.email}
                </p>
              )}
              {client.phone && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <MdPhone style={{ color: "#00897b", flexShrink: 0 }} /> {client.phone}
                </p>
              )}
              {client.address && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <MdLocationOn style={{ color: "#5f6d7e", flexShrink: 0 }} /> {client.address}
                </p>
              )}
            </div>
            <div style={cardStyles.buttonGroup}>
              <button
                style={{ ...cardStyles.button, ...cardStyles.edit, display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                onClick={() => onEdit(client)}
                onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(1.08)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.filter = ""; }}
              >
                <MdEdit /> Edit
              </button>
              <button
                style={{ ...cardStyles.button, ...cardStyles.delete, display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                onClick={() => handleDelete(client.id)}
                onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(0.95)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.filter = ""; }}
              >
                <MdDelete /> Delete
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

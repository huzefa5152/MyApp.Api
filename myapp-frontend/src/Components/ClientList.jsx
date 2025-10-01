import { deleteClient } from "../api/clientApi";

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
    <table className="table table-striped">
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Phone</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {clients.map((client) => (
          <tr key={client.id}>
            <td>{client.name}</td>
            <td>{client.email}</td>
            <td>{client.phone}</td>
            <td>
              <button
                className="btn btn-sm btn-warning me-2"
                onClick={() => onEdit(client)}
              >
                Edit
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={() => handleDelete(client.id)}
              >
                Delete
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

import { useState, useEffect } from "react";
import {
  MdPeople,
  MdAdd,
  MdSearch,
  MdEdit,
  MdDelete,
  MdClose,
  MdSave,
  MdPerson,
  MdLock,
  MdBadge,
  MdShield,
} from "react-icons/md";
import { getUsers, createUser, updateUser, deleteUser } from "../api/usersApi";
import { useAuth } from "../contexts/AuthContext";
import { notify } from "../utils/notify";

const colors = {
  blue: "#0d47a1",
  blueLight: "#1565c0",
  teal: "#00897b",
  cyan: "#00e5ff",
  cardBg: "#ffffff",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  danger: "#dc3545",
  dangerLight: "#fff0f1",
  success: "#28a745",
  successLight: "#eafbef",
};

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const isSeedAdmin = currentUser?.isSeedAdmin === true;
  const seedAdminUserId = currentUser?.seedAdminUserId;
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [form, setForm] = useState({ username: "", fullName: "", password: "", role: "Admin" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data } = await getUsers();
      setUsers(data);
    } catch {
      setMsg({ type: "error", text: "Failed to load users" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const openAdd = () => {
    setEditUser(null);
    setForm({ username: "", fullName: "", password: "", role: "Admin" });
    setMsg(null);
    setShowModal(true);
  };

  const openEdit = (u) => {
    setEditUser(u);
    setForm({ username: u.username, fullName: u.fullName, password: "", role: u.role });
    setMsg(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditUser(null);
    setMsg(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      if (editUser) {
        const payload = { username: form.username, fullName: form.fullName, role: form.role };
        if (form.password) payload.password = form.password;
        await updateUser(editUser.id, payload);
        setMsg({ type: "success", text: "User updated successfully" });
      } else {
        await createUser(form);
        setMsg({ type: "success", text: "User created successfully" });
      }
      await fetchUsers();
      setTimeout(closeModal, 800);
    } catch (err) {
      const m = err.response?.data?.message || "An error occurred";
      setMsg({ type: "error", text: m });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteUser(id);
      setDeleteConfirm(null);
      fetchUsers();
    } catch (err) {
      notify(err.response?.data?.message || "Failed to delete user", "error");
      setDeleteConfirm(null);
    }
  };

  const filtered = users.filter(
    (u) =>
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      u.fullName.toLowerCase().includes(search.toLowerCase())
  );

  const getInitials = (name) => {
    if (!name) return "?";
    return name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div>
      {/* Page Header */}
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={styles.headerIcon}>
            <MdPeople style={{ fontSize: "1.5rem", color: "#fff" }} />
          </div>
          <div>
            <h2 style={styles.headerTitle}>User Management</h2>
            <p style={styles.headerSub}>Manage admin users and their access</p>
          </div>
        </div>
        {isSeedAdmin && (
          <button style={styles.addBtn} onClick={openAdd}>
            <MdAdd style={{ fontSize: "1.2rem" }} />
            Add User
          </button>
        )}
      </div>

      {/* Search */}
      <div style={styles.searchWrap}>
        <MdSearch style={{ color: colors.textSecondary, fontSize: "1.25rem" }} />
        <input
          style={styles.searchInput}
          type="text"
          placeholder="Search users..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Users List */}
      <div>
        {loading ? (
          <p style={{ padding: "2rem", textAlign: "center", color: colors.textSecondary }}>
            Loading users...
          </p>
        ) : filtered.length === 0 ? (
          <p style={{ padding: "2rem", textAlign: "center", color: colors.textSecondary }}>
            {search ? "No users match your search" : "No users found"}
          </p>
        ) : (
          <div className="user-cards-grid">
            {filtered.map((u) => (
              <div key={u.id} style={styles.userCard}>
                <div style={styles.userCardTop}>
                  {u.avatarPath ? (
                    <img src={u.avatarPath} alt={u.fullName} style={styles.avatar} />
                  ) : (
                    <div style={styles.avatarFallback}>
                      {getInitials(u.fullName)}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: colors.textPrimary, fontSize: "0.95rem" }}>
                      {u.fullName}
                    </div>
                    <div style={{ color: colors.textSecondary, fontSize: "0.84rem" }}>
                      @{u.username}
                    </div>
                  </div>
                  <span style={styles.roleBadge}>{u.role}</span>
                </div>
                <div style={styles.userCardMeta}>
                  <span style={{ color: colors.textSecondary, fontSize: "0.82rem" }}>
                    Joined {new Date(u.createdAt).toLocaleDateString()}
                  </span>
                  {isSeedAdmin && u.id !== seedAdminUserId && (
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button style={styles.editBtn} onClick={() => openEdit(u)} title="Edit user">
                        <MdEdit style={{ fontSize: "1rem" }} />
                        <span>Edit</span>
                      </button>
                      <button style={styles.deleteBtn} onClick={() => setDeleteConfirm(u)} title="Delete user">
                        <MdDelete style={{ fontSize: "1rem" }} />
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary */}
      <p style={{ color: colors.textSecondary, fontSize: "0.85rem", marginTop: "1rem" }}>
        {filtered.length} user{filtered.length !== 1 ? "s" : ""} total
      </p>

      {/* ---- Create/Edit Modal ---- */}
      {showModal && (
        <div style={styles.overlay} onClick={closeModal}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={{ margin: 0, fontSize: "1.15rem", color: colors.textPrimary }}>
                {editUser ? "Edit User" : "Add New User"}
              </h3>
              <button style={styles.modalClose} onClick={closeModal}>
                <MdClose style={{ fontSize: "1.25rem" }} />
              </button>
            </div>

            <div style={styles.modalBody}>
              {msg && (
                <div
                  style={
                    msg.type === "success"
                      ? styles.successMsg
                      : styles.errorMsg
                  }
                >
                  {msg.text}
                </div>
              )}

              {/* Full Name */}
              <label style={styles.label}>
                <MdBadge style={styles.labelIcon} />
                Full Name
              </label>
              <input
                style={styles.input}
                type="text"
                placeholder="Enter full name"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />

              {/* Username */}
              <label style={styles.label}>
                <MdPerson style={styles.labelIcon} />
                Username
              </label>
              <input
                style={styles.input}
                type="text"
                placeholder="Enter username"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />

              {/* Password */}
              <label style={styles.label}>
                <MdLock style={styles.labelIcon} />
                {editUser ? "New Password (leave blank to keep)" : "Password"}
              </label>
              <input
                style={styles.input}
                type="password"
                placeholder={editUser ? "Leave blank to keep current" : "Min. 6 characters"}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />

              {/* Role */}
              <label style={styles.label}>
                <MdShield style={styles.labelIcon} />
                Role
              </label>
              <select
                style={styles.input}
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <option value="Admin">Admin</option>
              </select>
            </div>

            <div style={styles.modalFooter}>
              <button style={styles.cancelBtn} onClick={closeModal}>
                Cancel
              </button>
              <button
                style={styles.saveBtn}
                onClick={handleSave}
                disabled={saving}
              >
                <MdSave style={{ fontSize: "1.1rem" }} />
                {saving ? "Saving..." : editUser ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Delete Confirmation Modal ---- */}
      {deleteConfirm && (
        <div style={styles.overlay} onClick={() => setDeleteConfirm(null)}>
          <div style={styles.deleteModal} onClick={(e) => e.stopPropagation()}>
            <MdDelete style={{ fontSize: "2.5rem", color: colors.danger }} />
            <h3 style={{ margin: "0.75rem 0 0.5rem", color: colors.textPrimary }}>
              Delete User?
            </h3>
            <p style={{ margin: 0, color: colors.textSecondary, fontSize: "0.9rem" }}>
              Are you sure you want to delete <strong>{deleteConfirm.fullName}</strong>?
              This action cannot be undone.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
              <button
                style={styles.cancelBtn}
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                style={{ ...styles.saveBtn, background: colors.danger }}
                onClick={() => handleDelete(deleteConfirm.id)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Styles ---------- */
const styles = {
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "1rem",
    marginBottom: "1.5rem",
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    margin: 0,
    fontSize: "1.4rem",
    fontWeight: 700,
    color: colors.textPrimary,
  },
  headerSub: {
    margin: "0.2rem 0 0",
    fontSize: "0.88rem",
    color: colors.textSecondary,
  },
  addBtn: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    padding: "0.65rem 1.25rem",
    background: colors.blue,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: "0.9rem",
    cursor: "pointer",
  },
  searchWrap: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    padding: "0.6rem 1rem",
    background: colors.inputBg,
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 8,
    marginBottom: "1.25rem",
  },
  searchInput: {
    flex: 1,
    border: "none",
    outline: "none",
    background: "transparent",
    fontSize: "0.9rem",
    color: colors.textPrimary,
  },
  userCard: {
    background: colors.cardBg,
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 12,
    padding: "1rem 1.15rem",
    transition: "box-shadow 0.2s, transform 0.15s",
  },
  userCardTop: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  userCardMeta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "0.5rem",
    marginTop: "0.75rem",
    paddingTop: "0.75rem",
    borderTop: `1px solid ${colors.cardBorder}`,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    objectFit: "cover",
  },
  avatarFallback: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`,
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.8rem",
    fontWeight: 700,
  },
  roleBadge: {
    display: "inline-block",
    padding: "0.25rem 0.75rem",
    borderRadius: 50,
    fontSize: "0.78rem",
    fontWeight: 600,
    background: `${colors.blue}14`,
    color: colors.blue,
  },
  editBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    padding: "0.4rem 0.85rem",
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 8,
    background: "#fff",
    cursor: "pointer",
    color: colors.blue,
    fontSize: "0.82rem",
    fontWeight: 600,
  },
  deleteBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    padding: "0.4rem 0.85rem",
    border: `1px solid ${colors.dangerLight}`,
    borderRadius: 8,
    background: colors.dangerLight,
    cursor: "pointer",
    color: colors.danger,
    fontSize: "0.82rem",
    fontWeight: 600,
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2000,
    padding: "1rem",
  },
  modal: {
    background: "#fff",
    borderRadius: 14,
    width: "100%",
    maxWidth: 460,
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
  },
  modalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "1.25rem 1.5rem",
    borderBottom: `1px solid ${colors.cardBorder}`,
  },
  modalClose: {
    background: "none",
    border: "none",
    color: colors.textSecondary,
    cursor: "pointer",
    padding: "0.25rem",
  },
  modalBody: {
    padding: "1.25rem 1.5rem",
  },
  modalFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.75rem",
    padding: "1rem 1.5rem",
    borderTop: `1px solid ${colors.cardBorder}`,
  },
  label: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    fontSize: "0.85rem",
    fontWeight: 600,
    color: colors.textPrimary,
    marginBottom: "0.4rem",
    marginTop: "1rem",
  },
  labelIcon: {
    fontSize: "1rem",
    color: colors.blue,
  },
  input: {
    width: "100%",
    padding: "0.65rem 0.85rem",
    border: `1px solid ${colors.inputBorder}`,
    borderRadius: 8,
    fontSize: "0.9rem",
    background: colors.inputBg,
    color: colors.textPrimary,
    outline: "none",
    boxSizing: "border-box",
  },
  cancelBtn: {
    padding: "0.6rem 1.25rem",
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 8,
    background: "#fff",
    color: colors.textPrimary,
    fontWeight: 600,
    fontSize: "0.9rem",
    cursor: "pointer",
  },
  saveBtn: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    padding: "0.6rem 1.25rem",
    border: "none",
    borderRadius: 8,
    background: colors.blue,
    color: "#fff",
    fontWeight: 600,
    fontSize: "0.9rem",
    cursor: "pointer",
  },
  successMsg: {
    padding: "0.65rem 1rem",
    borderRadius: 8,
    background: colors.successLight,
    color: colors.success,
    fontSize: "0.85rem",
    fontWeight: 500,
  },
  errorMsg: {
    padding: "0.65rem 1rem",
    borderRadius: 8,
    background: colors.dangerLight,
    color: colors.danger,
    fontSize: "0.85rem",
    fontWeight: 500,
  },
  deleteModal: {
    background: "#fff",
    borderRadius: 14,
    padding: "2rem",
    textAlign: "center",
    maxWidth: 380,
    width: "100%",
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
  },
};

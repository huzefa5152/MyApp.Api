import UserSessionsPanel from "../Components/UserSessionsPanel";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  MdPeople,
  MdAdd,
  MdEdit,
  MdDelete,
  MdClose,
  MdSave,
  MdPerson,
  MdLock,
  MdBadge,
  MdShield,
  MdAdminPanelSettings,
  MdDevices,
  MdSmartToy,
} from "react-icons/md";
import { getUsers, createUser, updateUser, deleteUser } from "../api/usersApi";
import { getRoles, getUserRoles, assignUserRoles } from "../api/rbacApi";
import { useAuth } from "../contexts/AuthContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
// Shared modal baseline — gradient header, blurred backdrop, size tiers,
// non-movable. Every popup in the app pulls from these so widths and
// behaviour stay consistent.
import { formStyles, modalSizes } from "../theme";
import SearchableSelect from "../Components/SearchableSelect";
import { PageHeader, Button, Tabs, Toolbar, SearchBox, Loading, EmptyState, Alert } from "../ui/Kit";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  cardBorder: "var(--k-line)",
  textPrimary: "var(--k-ink)",
  textSecondary: "var(--k-muted)",
  danger: "#dc3545",
};

const msgTone = (type) => (type === "success" ? "success" : type === "warn" ? "warn" : "error");
const isMcpRole = (role) => role.isSystemRole && ["MCP Access", "MCP Write"].includes(role.name);

export default function UsersPage() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const { has } = usePermissions();
  const seedAdminUserId = currentUser?.seedAdminUserId;
  const canCreate = has("users.manage.create");
  const canUpdate = has("users.manage.update");
  const canDelete = has("users.manage.delete");
  const canAssignRoles = has("rbac.userroles.assign");
  const isSeedAdmin = currentUser?.isSeedAdmin === true;
  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [form, setForm] = useState({ username: "", fullName: "", password: "", role: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // Roles loaded once for the create / edit form's role-picker. Separate
  // from the role-assignment modal's `allRoles` (which lazy-loads on open)
  // because we need the dropdown populated immediately when the operator
  // hits "Add User".
  const [availableRoles, setAvailableRoles] = useState([]);

  // Role-assignment modal state
  const [rolesModalUser, setRolesModalUser] = useState(null);
  const [allRoles, setAllRoles] = useState([]);
  const [assignedRoleIds, setAssignedRoleIds] = useState(new Set());
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesSaving, setRolesSaving] = useState(false);
  const [rolesMsg, setRolesMsg] = useState(null);

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

  useEffect(() => {
    fetchUsers();
    // Load the role catalog once so the create / edit dialog's dropdown
    // shows whatever the operator has defined under Roles & Permissions.
    // Best-effort — non-admin users may not have rbac.roles.view, in which
    // case the dropdown falls back to free-typing the legacy role name.
    getRoles()
      .then(({ data }) => setAvailableRoles((data || []).filter((role) => !isMcpRole(role))))
      .catch(() => setAvailableRoles([]));
  }, []);

  const defaultRoleName = () => availableRoles[0]?.name || "Admin";

  const openAdd = () => {
    setEditUser(null);
    setForm({ username: "", fullName: "", password: "", role: defaultRoleName() });
    setMsg(null);
    setShowModal(true);
  };

  const openEdit = (u) => {
    setEditUser(u);
    setForm({ username: u.username, fullName: u.fullName, password: "", role: u.role || defaultRoleName() });
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

        // Sync RBAC role assignment to match the dropdown's pick — without
        // this, the Edit form silently keeps the user's old permissions
        // (the legacy `role` text was updated but the UserRoles join table
        // wasn't). Mirrors what the Create branch already does.
        // MCP grants are managed in the profile and survive normal role edits.
        const matchingRole = availableRoles.find(
          (r) => r.name?.toLowerCase() === form.role?.toLowerCase());
        if (matchingRole?.id && canAssignRoles) {
          try {
            const { data: existing } = await getUserRoles(editUser.id);
            const mcpIds = existing.roles.filter(isMcpRole).map((role) => role.id);
            await assignUserRoles(editUser.id, [...new Set([matchingRole.id, ...mcpIds])]);
            setMsg({ type: "success", text: `User updated and role "${matchingRole.name}" applied.` });
          } catch {
            setMsg({
              type: "warn",
              text: `User updated, but could not apply role "${matchingRole.name}". Use the Roles button to set it manually.`,
            });
          }
        } else {
          setMsg({ type: "success", text: "User updated successfully" });
        }
      } else {
        // Create the user with the legacy `role` text field (kept for
        // backwards-compat with existing JWT-claim consumers), then assign
        // the matching RBAC role via the UserRoles join table so the new
        // user immediately gets their permissions. If the operator can't
        // assign roles (rbac.userroles.assign), the create still succeeds
        // — they just won't have permissions until an admin assigns them.
        const { data: newUser } = await createUser(form);
        const matchingRole = availableRoles.find(
          (r) => r.name?.toLowerCase() === form.role?.toLowerCase());
        if (newUser?.id && matchingRole?.id && canAssignRoles) {
          try {
            await assignUserRoles(newUser.id, [matchingRole.id]);
          } catch {
            // Non-fatal: the user was created; surface a soft warning.
            setMsg({
              type: "warn",
              text: `User created, but could not auto-assign role "${matchingRole.name}". Use the Roles button to set it manually.`,
            });
          }
        }
        if (!msg) setMsg({ type: "success", text: "User created successfully" });
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

  const openRolesModal = async (u) => {
    setRolesModalUser(u);
    setRolesMsg(null);
    setRolesLoading(true);
    try {
      const [rolesRes, userRolesRes] = await Promise.all([getRoles(), getUserRoles(u.id)]);
      setAllRoles(rolesRes.data.filter((role) => !isMcpRole(role)));
      setAssignedRoleIds(new Set(userRolesRes.data.roles.map((r) => r.id)));
    } catch {
      setRolesMsg({ type: "error", text: "Failed to load roles" });
    } finally {
      setRolesLoading(false);
    }
  };

  const closeRolesModal = () => {
    if (rolesSaving) return;
    setRolesModalUser(null);
    setRolesMsg(null);
    setAssignedRoleIds(new Set());
  };

  const toggleRoleAssignment = (roleId) => {
    setAssignedRoleIds((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  };

  const handleSaveRoles = async () => {
    if (!rolesModalUser) return;
    setRolesSaving(true);
    setRolesMsg(null);
    try {
      const { data: current } = await getUserRoles(rolesModalUser.id);
      const normalIds = allRoles.filter((role) => assignedRoleIds.has(role.id)).map((role) => role.id);
      const mcpIds = current.roles.filter(isMcpRole).map((role) => role.id);
      await assignUserRoles(rolesModalUser.id, [...new Set([...normalIds, ...mcpIds])]);
      setRolesMsg({ type: "success", text: "Roles updated" });
      setTimeout(closeRolesModal, 700);
    } catch (err) {
      const m = err.response?.data?.message || "Could not update roles";
      setRolesMsg({ type: "error", text: m });
    } finally {
      setRolesSaving(false);
    }
  };

  const filtered = users.filter(
    (u) =>
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      u.fullName.toLowerCase().includes(search.toLowerCase())
  );

  // Create / edit role picker options — same labels the old <option>s showed.
  const roleOptions = availableRoles.length === 0
    ? [{ name: "Admin", label: "Admin" }]
    : availableRoles.map((r) => ({ name: r.name, label: `${r.name}${r.isSystemRole ? " (system)" : ""}` }));

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
      <PageHeader
        icon={MdPeople}
        tone="brand"
        title="User Management"
        subtitle="Manage admin users and their access"
        actions={canCreate && (
          <Button variant="primary" icon={MdAdd} onClick={openAdd}>Add User</Button>
        )}
      />

      {/* Tabs — Sessions & devices exists for the primary admin only */}
      {isSeedAdmin && (
        <Tabs
          label="User management sections"
          idPrefix="users-tab"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "users", label: "Users", icon: MdPeople },
            { key: "sessions", label: "Sessions & devices", icon: MdDevices },
          ]}
        />
      )}

      {isSeedAdmin && tab === "sessions" && (
        <div role="tabpanel" id="users-tab-panel-sessions" aria-labelledby="users-tab-sessions"><UserSessionsPanel /></div>
      )}

      <div role="tabpanel" id="users-tab-panel-users" aria-labelledby={isSeedAdmin ? "users-tab-users" : undefined} hidden={isSeedAdmin && tab !== "users"}>
      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search users..." />
      </Toolbar>

      {/* Users List */}
      <div>
        {loading ? (
          <Loading>Loading users...</Loading>
        ) : filtered.length === 0 ? (
          <EmptyState icon={MdPeople}>
            {search ? "No users match your search" : "No users found"}
          </EmptyState>
        ) : (
          <div className="user-cards-grid">
            {filtered.map((u) => (
              <div key={u.id} className="k-card" style={styles.userCard}>
                <div style={styles.userCardTop}>
                  {u.avatarPath ? (
                    <img src={u.avatarPath} alt={u.fullName} style={styles.avatar} />
                  ) : (
                    <div style={styles.avatarFallback}>
                      {getInitials(u.fullName)}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.userName}>
                      {u.fullName}
                    </div>
                    <div style={{ color: "var(--k-muted)", fontSize: "var(--k-font-sm)", overflowWrap: "anywhere" }}>
                      @{u.username}
                    </div>
                  </div>
                  <span style={styles.roleBadge}>{u.role}</span>
                </div>
                <div style={styles.userCardMeta}>
                  <span style={{ color: "var(--k-muted)", fontSize: "var(--k-font-sm)" }}>
                    Joined {new Date(u.createdAt).toLocaleDateString()}
                  </span>
                  {canUpdate && (
                    <Button variant="secondary" size="sm" icon={MdSmartToy}
                      onClick={() => navigate(`/profile?tab=mcp-catalog&userId=${u.id}`)} title={`MCP access for ${u.fullName}`}>
                      MCP access
                    </Button>
                  )}
                  {u.id !== seedAdminUserId && (canAssignRoles || canUpdate || canDelete) && (
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      {canAssignRoles && (
                        <Button size="sm" icon={MdAdminPanelSettings} onClick={() => openRolesModal(u)} title="Manage roles">
                          Roles
                        </Button>
                      )}
                      {canUpdate && (
                        <Button size="sm" icon={MdEdit} onClick={() => openEdit(u)} title="Edit user">
                          Edit
                        </Button>
                      )}
                      {canDelete && (
                        <Button size="sm" variant="danger" icon={MdDelete} onClick={() => setDeleteConfirm(u)} title="Delete user">
                          Delete
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary */}
      <p style={{ color: "var(--k-muted)", fontSize: "var(--k-font-sm)", marginTop: "1rem" }}>
        {filtered.length} user{filtered.length !== 1 ? "s" : ""} total
      </p>
      </div>

      {/* ---- Create/Edit Modal ---- */}
      {showModal && (
        // Backdrop click is a no-op — explicit Cancel / X only, so a stray
        // click can't drop the half-typed user form.
        <div style={styles.overlay}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={formStyles.title}>
                {editUser ? "Edit User" : "Add New User"}
              </h3>
              <button type="button" style={styles.modalClose} onClick={closeModal} aria-label="Close">
                <MdClose style={{ fontSize: "1.25rem" }} />
              </button>
            </div>

            <div style={styles.modalBody}>
              {msg && (
                <Alert tone={msgTone(msg.type)}>
                  {msg.text}
                </Alert>
              )}

              {/* Full Name */}
              <div style={formStyles.formGroup}>
                <label style={styles.label}>
                  <MdBadge style={styles.labelIcon} />
                  Full Name
                </label>
                <input
                  style={formStyles.input}
                  type="text"
                  placeholder="Enter full name"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                />
              </div>

              {/* Username */}
              <div style={formStyles.formGroup}>
                <label style={styles.label}>
                  <MdPerson style={styles.labelIcon} />
                  Username
                </label>
                <input
                  style={formStyles.input}
                  type="text"
                  placeholder="Enter username"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </div>

              {/* Password */}
              <div style={formStyles.formGroup}>
                <label style={styles.label}>
                  <MdLock style={styles.labelIcon} />
                  {editUser ? "New Password (leave blank to keep)" : "Password"}
                </label>
                <input
                  style={formStyles.input}
                  type="password"
                  placeholder={editUser ? "Leave blank to keep current" : "Min. 6 characters"}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>

              {/* Role */}
              <div>
                <label style={styles.label}>
                  <MdShield style={styles.labelIcon} />
                  Role
                </label>
                <SearchableSelect
                  items={roleOptions}
                  valueKey="name"
                  labelKey="label"
                  searchKeys={["label"]}
                  value={form.role}
                  onChange={(name) => setForm({ ...form, role: name })}
                  allowClear={false}
                  placeholder="Select role"
                  ariaLabel="Role"
                />
                {!editUser && availableRoles.length > 0 && (
                  <p style={{ margin: "0.35rem 0 0", fontSize: "0.72rem", color: "var(--k-muted)" }}>
                    The selected role's permissions will be auto-assigned to this user on create.
                  </p>
                )}
              </div>
            </div>

            <div style={styles.modalFooter}>
              <button type="button" style={styles.cancelBtn} onClick={closeModal}>
                Cancel
              </button>
              <button
                type="button"
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

      {/* ---- Role Assignment Modal ---- */}
      {rolesModalUser && (
        // Backdrop click is a no-op — explicit Cancel / X only.
        <div style={styles.overlay}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={formStyles.title}>
                Manage roles — {rolesModalUser.fullName}
              </h3>
              <button type="button" style={styles.modalClose} onClick={closeRolesModal} aria-label="Close">
                <MdClose style={{ fontSize: "1.25rem" }} />
              </button>
            </div>

            <div style={styles.modalBody}>
              {rolesMsg && (
                <Alert tone={msgTone(rolesMsg.type)}>
                  {rolesMsg.text}
                </Alert>
              )}

              <p style={{ margin: "0 0 0.75rem", color: colors.textSecondary, fontSize: "0.85rem" }}>
                Select the roles this user should have. Their permissions are the union
                of everything granted by their assigned roles.
              </p>

              {rolesLoading ? (
                <Loading>Loading roles...</Loading>
              ) : allRoles.length === 0 ? (
                <EmptyState boxed={false}>
                  No roles defined yet. Go to <strong>Roles &amp; Permissions</strong> to create one.
                </EmptyState>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {allRoles.map((role) => {
                    const checked = assignedRoleIds.has(role.id);
                    return (
                      <label
                        key={role.id}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "0.75rem",
                          padding: "0.75rem 0.9rem",
                          border: `1px solid ${checked ? colors.blue : colors.cardBorder}`,
                          borderRadius: 10,
                          background: checked ? `${colors.blue}0c` : "var(--k-surface)",
                          cursor: "pointer",
                          transition: "background 0.15s, border-color 0.15s",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRoleAssignment(role.id)}
                          style={{ accentColor: colors.blue, marginTop: 3 }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 600, color: colors.textPrimary, fontSize: "0.92rem" }}>
                              {role.name}
                            </span>
                            {role.isSystemRole && (
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "0.1rem 0.45rem",
                                  borderRadius: 50,
                                  fontSize: "0.68rem",
                                  fontWeight: 700,
                                  background: `${colors.teal}18`,
                                  color: colors.teal,
                                  textTransform: "uppercase",
                                  letterSpacing: "0.03em",
                                }}
                              >
                                System
                              </span>
                            )}
                            <span style={{ marginLeft: "auto", fontSize: "0.78rem", color: colors.textSecondary }}>
                              {role.permissionKeys.length} permission
                              {role.permissionKeys.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                          {role.description && (
                            <p style={{ margin: "0.25rem 0 0", color: colors.textSecondary, fontSize: "0.82rem" }}>
                              {role.description}
                            </p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={styles.modalFooter}>
              <button type="button" style={styles.cancelBtn} onClick={closeRolesModal} disabled={rolesSaving}>
                Cancel
              </button>
              <button type="button" style={styles.saveBtn} onClick={handleSaveRoles} disabled={rolesSaving || rolesLoading}>
                <MdSave style={{ fontSize: "1.1rem" }} />
                {rolesSaving ? "Saving..." : "Save roles"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Delete Confirmation Modal ---- */}
      {deleteConfirm && (
        // Backdrop click is a no-op — destructive action requires explicit
        // Cancel or Delete click.
        <div style={styles.overlay}>
          <div style={styles.deleteModal} onClick={(e) => e.stopPropagation()}>
            <MdDelete style={{ fontSize: "2.5rem", color: colors.danger }} />
            <h3 style={{ margin: "0.75rem 0 0.5rem", color: colors.textPrimary }}>
              Delete User?
            </h3>
            <p style={{ margin: 0, color: colors.textSecondary, fontSize: "0.9rem" }}>
              Are you sure you want to delete <strong>{deleteConfirm.fullName}</strong>?
              This action cannot be undone.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem", justifyContent: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                style={styles.cancelBtn}
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
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
  userCard: {
    marginTop: 0,
    padding: "var(--k-card-pad)",
  },
  userCardTop: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  userName: {
    fontWeight: 600,
    color: "var(--k-ink)",
    fontSize: "var(--k-font)",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  userCardMeta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "0.5rem",
    marginTop: "0.75rem",
    paddingTop: "0.75rem",
    borderTop: "1px solid var(--k-line)",
  },
  avatar: {
    width: 36,
    height: 36,
    flex: "none",
    borderRadius: "50%",
    objectFit: "cover",
  },
  avatarFallback: {
    width: 36,
    height: 36,
    flex: "none",
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
  // Modal chrome — all delegated to the shared formStyles baseline so
  // every popup (Create/Edit user, Roles, Delete confirm) has identical
  // backdrop blur, width tier, gradient header, and non-movable behaviour
  // as the rest of the app.
  overlay: formStyles.backdrop,
  modal: { ...formStyles.modal, maxWidth: `${modalSizes.md}px` },
  modalHeader: formStyles.header,
  modalClose: formStyles.closeButton,
  modalBody: formStyles.body,
  modalFooter: formStyles.footer,
  label: {
    ...formStyles.label,
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
  },
  labelIcon: {
    fontSize: "1rem",
    color: colors.blue,
  },
  cancelBtn: { ...formStyles.button, ...formStyles.cancel },
  saveBtn: { ...formStyles.button, ...formStyles.submit, display: "inline-flex", alignItems: "center", gap: "0.4rem" },
  // Delete-confirm uses the small modal tier, but skips the gradient header
  // (small alert dialog with centered icon + buttons inline). Padding is
  // applied directly because the body/footer stack isn't used here.
  deleteModal: {
    ...formStyles.modal,
    maxWidth: `${modalSizes.sm}px`,
    padding: "2rem",
    textAlign: "center",
    overflow: "visible",
  },
};

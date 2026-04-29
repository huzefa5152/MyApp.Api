import { useEffect, useMemo, useState } from "react";
import {
  MdAdminPanelSettings,
  MdAdd,
  MdSearch,
  MdEdit,
  MdDelete,
  MdClose,
  MdSave,
  MdCheckBox,
  MdCheckBoxOutlineBlank,
  MdIndeterminateCheckBox,
  MdLock,
  MdPeople,
  MdExpandMore,
  MdExpandLess,
} from "react-icons/md";
import {
  getRoles,
  createRole,
  updateRole,
  deleteRole,
  getPermissionTree,
} from "../api/rbacApi";
import { useAuth } from "../contexts/AuthContext";
import { Can, usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
// Shared modal baseline — gradient header, blurred backdrop, size tiers,
// non-movable. See comment in theme.js modalSizes for tier guidance.
import { formStyles, modalSizes } from "../theme";

const colors = {
  blue: "#0d47a1",
  blueLight: "#1565c0",
  teal: "#00897b",
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
  warn: "#b26a00",
  warnLight: "#fff4e0",
};

export default function RolesPage() {
  const { user: currentUser } = useAuth();
  const { has } = usePermissions();
  const canView = has("rbac.roles.view");
  const canCreate = has("rbac.roles.create");
  const canUpdate = has("rbac.roles.update");
  const canDelete = has("rbac.roles.delete");

  const [roles, setRoles] = useState([]);
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editRole, setEditRole] = useState(null);
  const [form, setForm] = useState({ name: "", description: "", permissionKeys: new Set() });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [collapsedModules, setCollapsedModules] = useState(() => new Set());

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [rolesRes, treeRes] = await Promise.all([getRoles(), getPermissionTree()]);
      setRoles(rolesRes.data);
      setTree(treeRes.data);
    } catch {
      notify("Failed to load roles and permissions", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  // ── Modal helpers ────────────────────────────────────────────────────────
  // Start with EVERY module collapsed so the operator sees a tidy stack of
  // module headers at first glance, and can drill in only where they need
  // to. Far less overwhelming than seeing 57 permissions sprawled out.
  const allModulesCollapsed = () => new Set(tree.map((m) => m.module));

  const openCreate = () => {
    setEditRole(null);
    setForm({ name: "", description: "", permissionKeys: new Set() });
    setMsg(null);
    setCollapsedModules(allModulesCollapsed());
    setModalOpen(true);
  };

  const openEdit = (role) => {
    setEditRole(role);
    setForm({
      name: role.name,
      description: role.description || "",
      permissionKeys: new Set(role.permissionKeys),
    });
    setMsg(null);
    setCollapsedModules(allModulesCollapsed());
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditRole(null);
    setMsg(null);
  };

  const togglePermission = (key) => {
    setForm((f) => {
      const next = new Set(f.permissionKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...f, permissionKeys: next };
    });
  };

  const togglePage = (pagePerms, allSelected) => {
    setForm((f) => {
      const next = new Set(f.permissionKeys);
      pagePerms.forEach((p) => {
        if (allSelected) next.delete(p.key);
        else next.add(p.key);
      });
      return { ...f, permissionKeys: next };
    });
  };

  const toggleModule = (moduleGroup, allSelected) => {
    setForm((f) => {
      const next = new Set(f.permissionKeys);
      moduleGroup.pages.forEach((pg) =>
        pg.permissions.forEach((p) => {
          if (allSelected) next.delete(p.key);
          else next.add(p.key);
        })
      );
      return { ...f, permissionKeys: next };
    });
  };

  const toggleModuleCollapsed = (moduleName) => {
    setCollapsedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleName)) next.delete(moduleName);
      else next.add(moduleName);
      return next;
    });
  };

  // ── Save / delete ────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        permissionKeys: Array.from(form.permissionKeys),
      };
      if (!payload.name) {
        setMsg({ type: "error", text: "Role name is required" });
        setSaving(false);
        return;
      }

      if (editRole) {
        await updateRole(editRole.id, payload);
        setMsg({ type: "success", text: "Role updated" });
      } else {
        await createRole(payload);
        setMsg({ type: "success", text: "Role created" });
      }
      await fetchAll();
      setTimeout(() => closeModal(), 700);
    } catch (err) {
      const m = err.response?.data?.message || "Could not save role";
      setMsg({ type: "error", text: m });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (role) => {
    try {
      await deleteRole(role.id);
      notify("Role deleted", "success");
      setDeleteConfirm(null);
      fetchAll();
    } catch (err) {
      notify(err.response?.data?.message || "Could not delete role", "error");
      setDeleteConfirm(null);
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.description || "").toLowerCase().includes(q)
    );
  }, [roles, search]);

  const totalCatalogKeys = useMemo(
    () => tree.reduce((n, m) => n + m.pages.reduce((pn, pg) => pn + pg.permissions.length, 0), 0),
    [tree]
  );

  // ── Render ───────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div style={styles.forbidden}>
        <MdLock style={{ fontSize: "2.5rem", color: colors.textSecondary }} />
        <h3 style={{ margin: "0.75rem 0 0.25rem" }}>Access denied</h3>
        <p style={{ margin: 0, color: colors.textSecondary, fontSize: "0.9rem" }}>
          You don&apos;t have permission to view roles.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Page Header */}
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={styles.headerIcon}>
            <MdAdminPanelSettings style={{ fontSize: "1.5rem", color: "#fff" }} />
          </div>
          <div>
            <h2 style={styles.headerTitle}>Roles &amp; Permissions</h2>
            <p style={styles.headerSub}>
              Define what each role can see and do. {totalCatalogKeys} permissions available.
            </p>
          </div>
        </div>
        {canCreate && (
          <button style={styles.addBtn} onClick={openCreate}>
            <MdAdd style={{ fontSize: "1.2rem" }} />
            New Role
          </button>
        )}
      </div>

      {/* Search */}
      <div style={styles.searchWrap}>
        <MdSearch style={{ color: colors.textSecondary, fontSize: "1.25rem" }} />
        <input
          style={styles.searchInput}
          type="text"
          placeholder="Search roles..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* List */}
      {loading ? (
        <p style={{ padding: "2rem", textAlign: "center", color: colors.textSecondary }}>
          Loading roles...
        </p>
      ) : filtered.length === 0 ? (
        <p style={{ padding: "2rem", textAlign: "center", color: colors.textSecondary }}>
          {search ? "No roles match your search" : "No roles defined yet"}
        </p>
      ) : (
        <div className="role-cards-grid" style={styles.grid}>
          {filtered.map((role) => (
            <div key={role.id} style={styles.card}>
              <div style={styles.cardHeader}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", flexWrap: "wrap" }}>
                  <h3 style={styles.cardTitle}>{role.name}</h3>
                  {role.isSystemRole && <span style={styles.systemBadge}>System</span>}
                </div>
                {!role.isSystemRole && (canUpdate || canDelete) && (
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    {canUpdate && (
                      <button
                        style={styles.iconBtn}
                        onClick={() => openEdit(role)}
                        title="Edit role"
                      >
                        <MdEdit style={{ fontSize: "1rem" }} />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        style={styles.iconBtnDanger}
                        onClick={() => setDeleteConfirm(role)}
                        title="Delete role"
                      >
                        <MdDelete style={{ fontSize: "1rem" }} />
                      </button>
                    )}
                  </div>
                )}
              </div>
              {role.description && (
                <p style={styles.cardDescription}>{role.description}</p>
              )}
              <div style={styles.cardMeta}>
                <span style={styles.metaChip}>
                  <MdAdminPanelSettings style={{ fontSize: "0.95rem" }} />
                  {role.permissionKeys.length} permission{role.permissionKeys.length !== 1 ? "s" : ""}
                </span>
                <span style={styles.metaChip}>
                  <MdPeople style={{ fontSize: "0.95rem" }} />
                  {role.userCount} user{role.userCount !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Create/Edit Modal ── */}
      {modalOpen && (
        // Backdrop click is a no-op — explicit Cancel / X only, protects
        // mid-edit permission selections from a stray click.
        <div style={styles.overlay}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={formStyles.title}>
                {editRole ? `Edit role — ${editRole.name}` : "Create new role"}
              </h3>
              <button
                type="button"
                style={styles.modalClose}
                onClick={closeModal}
                aria-label="Close"
                title="Close"
              >
                <MdClose size={20} color="#fff" />
              </button>
            </div>

            <div style={styles.modalBody}>
              {msg && (
                <div style={msg.type === "success" ? styles.successMsg : styles.errorMsg}>
                  {msg.text}
                </div>
              )}

              <label style={styles.label}>Role name</label>
              <input
                style={styles.input}
                type="text"
                placeholder="e.g. Billing Operator"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={saving}
              />

              <label style={styles.label}>Description</label>
              <input
                style={styles.input}
                type="text"
                placeholder="What this role is for (optional)"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                disabled={saving}
              />

              <div style={styles.permHeader}>
                <label style={{ ...styles.label, marginTop: 0 }}>Permissions</label>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  {/* Collapse All / Expand All — quality-of-life when the
                      catalog has 15+ modules. Sets/clears every module
                      name in the collapsedModules Set in one shot. */}
                  <button
                    type="button"
                    style={styles.smallLinkBtn}
                    onClick={() => setCollapsedModules(new Set(tree.map((m) => m.module)))}
                    title="Collapse every module group"
                  >
                    Collapse all
                  </button>
                  <span style={{ color: colors.cardBorder }}>|</span>
                  <button
                    type="button"
                    style={styles.smallLinkBtn}
                    onClick={() => setCollapsedModules(new Set())}
                    title="Expand every module group"
                  >
                    Expand all
                  </button>
                  <span style={{ color: colors.textSecondary, fontSize: "0.82rem", marginLeft: "0.5rem" }}>
                    {form.permissionKeys.size} / {totalCatalogKeys} selected
                  </span>
                </div>
              </div>

              <div style={styles.permTree}>
                {tree.map((mod) => {
                  const modKeys = mod.pages.flatMap((pg) => pg.permissions.map((p) => p.key));
                  const modSelected = modKeys.filter((k) => form.permissionKeys.has(k)).length;
                  const modAll = modSelected === modKeys.length;
                  const modSome = modSelected > 0 && modSelected < modKeys.length;
                  const collapsed = collapsedModules.has(mod.module);

                  return (
                    <div key={mod.module} style={styles.moduleBlock}>
                      <div style={styles.moduleHeader}>
                        <button
                          type="button"
                          style={styles.moduleToggle}
                          onClick={() => toggleModuleCollapsed(mod.module)}
                          aria-expanded={!collapsed}
                        >
                          {collapsed ? <MdExpandMore /> : <MdExpandLess />}
                        </button>
                        <button
                          type="button"
                          style={styles.moduleCheckBtn}
                          onClick={() => toggleModule(mod, modAll)}
                          title={modAll ? "Clear module" : "Select all in module"}
                        >
                          {modAll ? (
                            <MdCheckBox style={{ color: colors.blue, fontSize: "1.15rem" }} />
                          ) : modSome ? (
                            <MdIndeterminateCheckBox style={{ color: colors.blue, fontSize: "1.15rem" }} />
                          ) : (
                            <MdCheckBoxOutlineBlank style={{ color: colors.textSecondary, fontSize: "1.15rem" }} />
                          )}
                          <span style={styles.moduleName}>{mod.module}</span>
                          <span style={styles.moduleCount}>
                            {modSelected}/{modKeys.length}
                          </span>
                        </button>
                      </div>

                      {!collapsed && mod.pages.map((pg) => {
                        const pgSelected = pg.permissions.filter((p) => form.permissionKeys.has(p.key)).length;
                        const pgAll = pgSelected === pg.permissions.length;
                        const pgSome = pgSelected > 0 && pgSelected < pg.permissions.length;
                        return (
                          <div key={`${mod.module}/${pg.page}`} style={styles.pageBlock}>
                            <button
                              type="button"
                              style={styles.pageCheckBtn}
                              onClick={() => togglePage(pg.permissions, pgAll)}
                              title={pgAll ? "Clear page" : "Select all in page"}
                            >
                              {pgAll ? (
                                <MdCheckBox style={{ color: colors.teal, fontSize: "1.05rem" }} />
                              ) : pgSome ? (
                                <MdIndeterminateCheckBox style={{ color: colors.teal, fontSize: "1.05rem" }} />
                              ) : (
                                <MdCheckBoxOutlineBlank style={{ color: colors.textSecondary, fontSize: "1.05rem" }} />
                              )}
                              <span style={styles.pageName}>{pg.page}</span>
                            </button>

                            <div style={styles.actionList}>
                              {pg.permissions.map((p) => {
                                const checked = form.permissionKeys.has(p.key);
                                return (
                                  <label key={p.key} style={styles.actionRow} title={p.description || ""}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => togglePermission(p.key)}
                                      style={styles.checkbox}
                                    />
                                    <span style={styles.actionName}>{p.action}</span>
                                    <span style={styles.actionKey}>{p.key}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={styles.modalFooter}>
              <button style={styles.cancelBtn} onClick={closeModal} disabled={saving}>
                Cancel
              </button>
              <button style={styles.saveBtn} onClick={handleSave} disabled={saving}>
                <MdSave style={{ fontSize: "1.1rem" }} />
                {saving ? "Saving..." : editRole ? "Update role" : "Create role"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ── */}
      {deleteConfirm && (
        // Backdrop click is a no-op — destructive action requires explicit
        // Cancel or Delete click.
        <div style={styles.overlay}>
          <div style={styles.deleteModal} onClick={(e) => e.stopPropagation()}>
            <MdDelete style={{ fontSize: "2.5rem", color: colors.danger }} />
            <h3 style={{ margin: "0.75rem 0 0.5rem", color: colors.textPrimary }}>Delete role?</h3>
            <p style={{ margin: 0, color: colors.textSecondary, fontSize: "0.9rem" }}>
              Are you sure you want to delete <strong>{deleteConfirm.name}</strong>?
              {deleteConfirm.userCount > 0 && (
                <>
                  <br />
                  <span style={{ color: colors.warn }}>
                    {deleteConfirm.userCount} user(s) currently have this role.
                  </span>
                </>
              )}
            </p>
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
              <button style={styles.cancelBtn} onClick={() => setDeleteConfirm(null)}>
                Cancel
              </button>
              <button
                style={{ ...styles.saveBtn, background: colors.danger }}
                onClick={() => handleDelete(deleteConfirm)}
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

/* ─────────── Styles ─────────── */
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
  headerTitle: { margin: 0, fontSize: "1.4rem", fontWeight: 700, color: colors.textPrimary },
  headerSub: { margin: "0.2rem 0 0", fontSize: "0.88rem", color: colors.textSecondary },
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
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "1rem",
  },
  card: {
    background: colors.cardBg,
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 12,
    padding: "1rem 1.15rem",
  },
  cardHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "0.5rem",
    marginBottom: "0.4rem",
  },
  cardTitle: { margin: 0, fontSize: "1rem", fontWeight: 700, color: colors.textPrimary },
  cardDescription: {
    margin: "0 0 0.75rem",
    color: colors.textSecondary,
    fontSize: "0.85rem",
    lineHeight: 1.4,
  },
  cardMeta: { display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.5rem" },
  systemBadge: {
    display: "inline-block",
    padding: "0.15rem 0.5rem",
    borderRadius: 50,
    fontSize: "0.7rem",
    fontWeight: 700,
    background: `${colors.teal}18`,
    color: colors.teal,
    letterSpacing: "0.03em",
    textTransform: "uppercase",
  },
  metaChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    padding: "0.2rem 0.6rem",
    borderRadius: 50,
    fontSize: "0.78rem",
    fontWeight: 600,
    background: `${colors.blue}10`,
    color: colors.blue,
  },
  // The global `button` rule in index.css adds chunky padding + a
  // box-shadow + a dark-theme background. These icon buttons need to
  // be a tight 32 × 32 square with the role-page tint, so we override
  // every property the global rule would otherwise smuggle in.
  iconBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    minWidth: 32,
    padding: 0,
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 8,
    background: "#fff",
    boxShadow: "none",
    cursor: "pointer",
    color: colors.blue,
    flexShrink: 0,
  },
  iconBtnDanger: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    minWidth: 32,
    padding: 0,
    border: `1px solid ${colors.dangerLight}`,
    borderRadius: 8,
    background: colors.dangerLight,
    boxShadow: "none",
    cursor: "pointer",
    color: colors.danger,
    flexShrink: 0,
  },
  // Modal chrome delegated to formStyles so the Roles & Permissions popup
  // matches every other dialog in the app (blurred backdrop, gradient
  // header, fixed centered position, non-movable). Tier "lg" because the
  // permission tree needs more room than a typical short form.
  overlay: formStyles.backdrop,
  modal: { ...formStyles.modal, maxWidth: `${modalSizes.lg}px` },
  modalHeader: formStyles.header,
  modalClose: formStyles.closeButton,
  modalBody: formStyles.body,
  modalFooter: formStyles.footer,
  label: {
    display: "block",
    fontSize: "0.85rem",
    fontWeight: 600,
    color: colors.textPrimary,
    marginBottom: "0.4rem",
    marginTop: "0.9rem",
  },
  input: {
    width: "100%",
    padding: "0.6rem 0.85rem",
    border: `1px solid ${colors.inputBorder}`,
    borderRadius: 8,
    fontSize: "0.9rem",
    background: colors.inputBg,
    color: colors.textPrimary,
    outline: "none",
    boxSizing: "border-box",
  },
  // Compact text-link-style button for collapse/expand-all controls. Has to
  // override the global button rule from index.css (padding 0.8em 1.6em,
  // box-shadow, etc.).
  smallLinkBtn: {
    background: "transparent",
    backgroundColor: "transparent",
    border: "none",
    color: colors.blue,
    fontSize: "0.78rem",
    fontWeight: 600,
    padding: "0.15rem 0.35rem",
    margin: 0,
    cursor: "pointer",
    boxShadow: "none",
    textDecoration: "underline",
    textUnderlineOffset: 2,
    lineHeight: 1.2,
    borderRadius: 4,
  },
  permHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: "1.25rem",
    marginBottom: "0.5rem",
  },
  permTree: {
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 10,
    maxHeight: "46vh",
    overflowY: "auto",
    background: "#fafcfe",
  },
  moduleBlock: { borderBottom: `1px solid ${colors.cardBorder}` },
  moduleHeader: {
    display: "flex",
    alignItems: "center",
    background: "#eef3f9",
    padding: "0.4rem 0.6rem",
    gap: "0.25rem",
  },
  moduleToggle: {
    background: "transparent",
    border: "none",
    color: colors.textSecondary,
    cursor: "pointer",
    padding: "0.2rem",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  moduleCheckBtn: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: "0.25rem",
    fontWeight: 700,
    color: colors.textPrimary,
    fontSize: "0.9rem",
    textAlign: "left",
  },
  moduleName: { flex: 1 },
  moduleCount: {
    fontWeight: 600,
    color: colors.textSecondary,
    fontSize: "0.78rem",
    background: "#fff",
    borderRadius: 50,
    padding: "0.1rem 0.55rem",
  },
  pageBlock: { padding: "0.5rem 1rem 0.65rem 1.75rem" },
  pageCheckBtn: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: "0.15rem 0",
    fontWeight: 600,
    color: colors.textPrimary,
    fontSize: "0.85rem",
  },
  pageName: { color: colors.textPrimary },
  actionList: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: "0.25rem 1rem",
    marginTop: "0.3rem",
    marginLeft: "1.4rem",
  },
  actionRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.25rem 0.4rem",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: "0.85rem",
    color: colors.textPrimary,
  },
  checkbox: { cursor: "pointer", accentColor: colors.blue },
  actionName: { fontWeight: 600 },
  actionKey: {
    marginLeft: "auto",
    color: colors.textSecondary,
    fontSize: "0.73rem",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
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
    marginBottom: "0.5rem",
  },
  errorMsg: {
    padding: "0.65rem 1rem",
    borderRadius: 8,
    background: colors.dangerLight,
    color: colors.danger,
    fontSize: "0.85rem",
    fontWeight: 500,
    marginBottom: "0.5rem",
  },
  // Delete-confirm uses the smallest tier with centered icon + text;
  // padding is applied directly because the body/footer stack isn't used.
  deleteModal: {
    ...formStyles.modal,
    maxWidth: `${modalSizes.sm}px`,
    padding: "2rem",
    textAlign: "center",
    overflow: "visible",
  },
  forbidden: {
    textAlign: "center",
    padding: "4rem 1.5rem",
    background: "#fff",
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 14,
  },
};

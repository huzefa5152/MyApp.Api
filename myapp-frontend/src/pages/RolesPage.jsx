import { useEffect, useMemo, useState } from "react";
import {
  MdAdminPanelSettings,
  MdAdd,
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
  getRoleTenants,
  copyRole,
  getRoles,
  createRole,
  updateRole,
  deleteRole,
  getPermissionTree,
} from "../api/rbacApi";
import { useAuth } from "../contexts/AuthContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
// Shared modal baseline — gradient header, blurred backdrop, size tiers,
// non-movable. See comment in theme.js modalSizes for tier guidance.
import { formStyles, modalSizes } from "../theme";
// Section layout config — maps catalog modules to navbar super-groups.
// Edit this file to add a new module/screen; nothing else here needs to change.
import { groupTreeBySections, getModuleLabel } from "../config/permissionSections";
import SearchableSelect from "../Components/SearchableSelect";
import { PageHeader, Button, IconButton, Toolbar, SearchBox, Loading, EmptyState, Alert } from "../ui/Kit";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  cardBorder: "#e8edf3",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  danger: "#dc3545",
  warn: "#b26a00",
};


/**
 * The permission tree, cut down to the keys `myKeys` actually holds.
 *
 * `module -> pages -> permissions` in, same shape out, with empty pages and
 * empty modules dropped so the editor does not render a heading over nothing.
 * MCP permissions are managed separately from this product-role editor.
 */
function grantableTree(tree, myKeys, isSeedAdmin) {
  return (tree || [])
    .map((mod) => ({
      ...mod,
      pages: (mod.pages || [])
        .map((pg) => ({
          ...pg,
          permissions: (pg.permissions || []).filter((p) => !p.key.startsWith("mcp.") && (isSeedAdmin || !myKeys || myKeys.size === 0 || myKeys.has(p.key))),
        }))
        .filter((pg) => pg.permissions.length > 0),
    }))
    .filter((mod) => mod.pages.length > 0);
}

export default function RolesPage() {
  const { user: currentUser } = useAuth();
  const { has, permissions: myKeys, isSeedAdmin } = usePermissions();
  const canView = has("rbac.roles.view");
  const canCreate = has("rbac.roles.create");
  const canUpdate = has("rbac.roles.update");
  const canDelete = has("rbac.roles.delete");

  const [roles, setRoles] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [tenantId, setTenantId] = useState("");
  const [copySource, setCopySource] = useState(null);
  const [copyTargets, setCopyTargets] = useState(new Set());
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
  const [collapsedSections, setCollapsedSections] = useState(() => new Set());

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [rolesRes, treeRes] = await Promise.all([getRoles(), getPermissionTree()]);
      setRoles(rolesRes.data.filter((role) => !(role.isSystemRole && ["MCP Access", "MCP Write"].includes(role.name))));
      if (isSeedAdmin && canCreate) setTenants((await getRoleTenants()).data);
      // Show only what THIS operator could actually hand out. The server
      // enforces it either way -- a role may not grant a key its author does
      // not hold -- but offering a checkbox that always fails on save is a
      // trap, and for a tenant administrator on an edition it would also
      // advertise the module they did not buy. The seed admin holds
      // every product permission; MCP access is managed in the user profile.
      setTree(grantableTree(treeRes.data, myKeys, isSeedAdmin));
    } catch {
      notify("Failed to load roles and permissions", "error");
    } finally {
      setLoading(false);
    }
  };

  // Re-filter once the caller's own permission set has loaded.
  useEffect(() => { fetchAll(); }, [isSeedAdmin, myKeys]);

  // ── Modal helpers ────────────────────────────────────────────────────────
  // Start with EVERY module collapsed so the operator sees a tidy stack of
  // module headers at first glance, and can drill in only where they need
  // to. Far less overwhelming than seeing 57 permissions sprawled out.
  const allModulesCollapsed = () => new Set(tree.map((m) => m.module));
  // Sections start expanded so the operator immediately sees the navbar
  // structure (Sales / Purchases / Configuration / Administration); modules
  // inside them stay collapsed for a tidy stack.
  const allSectionsExpanded = () => new Set();

  const openCreate = () => {
    setEditRole(null);
    setCopySource(null);
    setCopyTargets(new Set());
    setTenantId(String(currentUser?.id || ""));
    setForm({ name: "", description: "", permissionKeys: new Set() });
    setMsg(null);
    setCollapsedModules(allModulesCollapsed());
    setCollapsedSections(allSectionsExpanded());
    setModalOpen(true);
  };

  const openEdit = (role) => {
    setEditRole(role);
    setCopySource(null);
    setTenantId(String(role.tenantAdminUserId || ""));
    setForm({
      name: role.name,
      description: role.description || "",
      permissionKeys: new Set(role.permissionKeys),
    });
    setMsg(null);
    setCollapsedModules(allModulesCollapsed());
    setCollapsedSections(allSectionsExpanded());
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditRole(null);
    setMsg(null);
  };

  const togglePermission = (key) => {
    if (copySource) return;
    setForm((f) => {
      const next = new Set(f.permissionKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...f, permissionKeys: next };
    });
  };

  const togglePage = (pagePerms, allSelected) => {
    if (copySource) return;
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
    if (copySource) return;
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

  const toggleSectionCollapsed = (sectionName) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionName)) next.delete(sectionName);
      else next.add(sectionName);
      return next;
    });
  };

  const toggleSection = (sectionGroup, allSelected) => {
    if (copySource) return;
    setForm((f) => {
      const next = new Set(f.permissionKeys);
      sectionGroup.modules.forEach((mod) =>
        mod.pages.forEach((pg) =>
          pg.permissions.forEach((p) => {
            if (allSelected) next.delete(p.key);
            else next.add(p.key);
          })
        )
      );
      return { ...f, permissionKeys: next };
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

      if (copySource) {
        if (copyTargets.size === 0) throw new Error("Select at least one tenant administrator");
        await copyRole(copySource.id, { name: payload.name, tenantAdminUserIds: Array.from(copyTargets) });
        setMsg({ type: "success", text: "Independent tenant roles created" });
      } else if (editRole) {
        await updateRole(editRole.id, payload);
        setMsg({ type: "success", text: "Role updated" });
      } else {
        await createRole({ ...payload, ...(isSeedAdmin ? { tenantAdminUserId: Number(tenantId) } : {}) });
        setMsg({ type: "success", text: "Role created" });
      }
      await fetchAll();
      setTimeout(() => closeModal(), 700);
    } catch (err) {
      const m = err.response?.data?.message || err.message || "Could not save role";
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
  const visibleSelectedKeys = tree.flatMap((module) => module.pages.flatMap((page) => page.permissions)).filter((permission) => form.permissionKeys.has(permission.key)).length;

  // Re-bucket the API tree (which is module → page → permission) into
  // section → module → page → permission so the Roles editor mirrors the
  // sidebar layout. The mapping config lives in
  // `src/config/permissionSections.js` — edit there to add modules.
  const groupedSections = useMemo(() => groupTreeBySections(tree), [tree]);

  // Tenant-administrator picker options — same text the old <option> showed.
  const tenantOptions = useMemo(
    () => tenants.map((t) => ({
      userId: t.userId,
      label: `${t.fullName || t.username} (${t.username}) - ${t.companies.join(", ") || "No assigned companies"}`,
    })),
    [tenants]
  );

  // ── Render ───────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <EmptyState icon={MdLock} title="Access denied">
        You don&apos;t have permission to view roles.
      </EmptyState>
    );
  }

  return (
    <div>
      <PageHeader
        icon={MdAdminPanelSettings}
        tone="brand"
        title="Roles & Permissions"
        subtitle={`Define what each role can see and do. ${totalCatalogKeys} permissions available.`}
        actions={canCreate && (
          <Button variant="primary" icon={MdAdd} onClick={openCreate}>New Role</Button>
        )}
      />

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search roles..." />
      </Toolbar>

      {/* List */}
      {loading ? (
        <Loading>Loading roles...</Loading>
      ) : filtered.length === 0 ? (
        <EmptyState icon={MdAdminPanelSettings}>
          {search ? "No roles match your search" : "No roles defined yet"}
        </EmptyState>
      ) : (
        <div className="role-cards-grid k-grid-cards">
          {filtered.map((role) => (
            <div key={role.id} className="k-card" style={styles.card}>
              <div style={styles.cardHeader}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", flexWrap: "wrap", minWidth: 0 }}>
                  <h3 style={styles.cardTitle}>{role.name}</h3>
                  {role.isSystemRole && <span style={styles.systemBadge}>System</span>}
                </div>
                {!role.isSystemRole && role.canEdit && (canUpdate || canDelete) && (
                  <div style={{ display: "flex", gap: "0.25rem" }}>
                    {canUpdate && (
                      <IconButton label="Edit role" icon={MdEdit} size={17} onClick={() => openEdit(role)} />
                    )}
                    {canDelete && (
                      <IconButton label="Delete role" icon={MdDelete} size={17} danger onClick={() => setDeleteConfirm(role)} />
                    )}
                  </div>
                )}
              </div>
              {isSeedAdmin && !role.isSystemRole && <p style={styles.cardDescription}>
                Tenant: {tenants.find(t => t.userId === role.tenantAdminUserId)?.username || `Administrator #${role.tenantAdminUserId}`}
              </p>}
              {isSeedAdmin && canCreate && !role.isSystemRole && <button type="button" style={styles.smallLinkBtn} onClick={() => {
                openCreate(); setCopySource(role); setForm({ name: role.name, description: role.description || "", permissionKeys: new Set(role.permissionKeys) });
              }}>Copy to tenants</button>}
              {role.description && (
                <p style={styles.cardDescription}>{role.description}</p>
              )}
              <div style={styles.cardMeta}>
                <span style={styles.metaChip}>
                  <MdAdminPanelSettings style={{ fontSize: "0.95rem" }} />
                  {role.permissionKeys.filter((key) => !key.startsWith("mcp.")).length} permissions
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
                {copySource ? "Copy role to tenants" : editRole ? `Edit role — ${editRole.name}` : "Create new role"}
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
                <Alert tone={msg.type === "success" ? "success" : "error"}>
                  {msg.text}
                </Alert>
              )}

              {isSeedAdmin && !editRole && !copySource && <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Tenant administrator</label>
                <SearchableSelect
                  items={tenantOptions}
                  valueKey="userId"
                  labelKey="label"
                  value={tenantId}
                  disabled={saving}
                  onChange={(id) => setTenantId(String(id))}
                  placeholder="Select tenant administrator"
                  ariaLabel="Tenant administrator"
                />
              </div>}
              {copySource && <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Destination tenant administrators</label>
                {tenants.map(t => <label key={t.userId} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, overflowWrap: "anywhere" }}>
                  <input type="checkbox" checked={copyTargets.has(t.userId)} disabled={saving} onChange={e => setCopyTargets(prev => {
                    const next = new Set(prev); if (e.target.checked) next.add(t.userId); else next.delete(t.userId); return next;
                  })} />{t.fullName || t.username} ({t.username}) - {t.companies.join(", ") || "No assigned companies"}
                </label>)}
                <p style={styles.cardDescription}>Each copy has its own permissions and no user assignments. Later edits do not affect the original.</p>
              </div>}
              <div style={formStyles.formGroup}>
              <label style={formStyles.label}>Role name</label>
              <input
                style={formStyles.input}
                type="text"
                placeholder="e.g. Billing Operator"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={saving}
              />
              </div>

              <div style={formStyles.formGroup}>
              <label style={formStyles.label}>Description</label>
              <input
                style={formStyles.input}
                type="text"
                placeholder="What this role is for (optional)"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                disabled={saving || Boolean(copySource)}
              />
              </div>

              {!copySource && <>
              <div style={styles.permHeader}>
                <label style={{ ...formStyles.label, marginBottom: 0 }}>Permissions</label>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  {/* Collapse All / Expand All — quality-of-life when the
                      catalog has 15+ modules. Sets/clears every module
                      name in the collapsedModules Set in one shot. */}
                  <button
                    type="button"
                    style={styles.smallLinkBtn}
                    onClick={() => {
                      setCollapsedSections(new Set(groupedSections.map((s) => s.section)));
                      setCollapsedModules(new Set(tree.map((m) => m.module)));
                    }}
                    title="Collapse every section and module"
                  >
                    Collapse all
                  </button>
                  <span style={{ color: colors.cardBorder }}>|</span>
                  <button
                    type="button"
                    style={styles.smallLinkBtn}
                    onClick={() => {
                      setCollapsedSections(new Set());
                      setCollapsedModules(new Set());
                    }}
                    title="Expand every section and module"
                  >
                    Expand all
                  </button>
                  <span style={{ color: colors.textSecondary, fontSize: "0.82rem", marginLeft: "0.5rem" }}>
                    {visibleSelectedKeys} / {totalCatalogKeys} selected
                  </span>
                </div>
              </div>

              <div style={styles.permTree}>
                {groupedSections.map((sec) => {
                  const secKeys = sec.modules.flatMap((m) =>
                    m.pages.flatMap((pg) => pg.permissions.map((p) => p.key))
                  );
                  const secSelected = secKeys.filter((k) => form.permissionKeys.has(k)).length;
                  const secAll = secSelected === secKeys.length;
                  const secSome = secSelected > 0 && secSelected < secKeys.length;
                  const secCollapsed = collapsedSections.has(sec.section);

                  return (
                    <div key={sec.section} style={styles.sectionBlock}>
                      <div style={styles.sectionHeader}>
                        <button
                          type="button"
                          style={styles.sectionToggle}
                          onClick={() => toggleSectionCollapsed(sec.section)}
                          aria-expanded={!secCollapsed}
                        >
                          {secCollapsed ? <MdExpandMore /> : <MdExpandLess />}
                        </button>
                        <button
                          type="button"
                          style={styles.sectionCheckBtn}
                          onClick={() => toggleSection(sec, secAll)}
                          title={secAll ? "Clear section" : "Select all in section"}
                        >
                          {secAll ? (
                            <MdCheckBox style={{ color: "#fff", fontSize: "1.2rem" }} />
                          ) : secSome ? (
                            <MdIndeterminateCheckBox style={{ color: "#fff", fontSize: "1.2rem" }} />
                          ) : (
                            <MdCheckBoxOutlineBlank style={{ color: "rgba(255,255,255,0.85)", fontSize: "1.2rem" }} />
                          )}
                          <span style={styles.sectionName}>{sec.section}</span>
                          <span style={styles.sectionCount}>
                            {secSelected}/{secKeys.length}
                          </span>
                        </button>
                      </div>

                      {!secCollapsed && sec.modules.map((mod) => {
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
                          <span style={styles.moduleName}>{getModuleLabel(mod.module)}</span>
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
                                      disabled={Boolean(copySource)}
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
                  );
                })}
              </div>
              </>}
            </div>

            <div style={styles.modalFooter}>
              <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={closeModal} disabled={saving}>
                Cancel
              </button>
              <button type="button" style={{ ...formStyles.button, ...formStyles.submit, ...styles.iconLabel }} onClick={handleSave} disabled={saving || (!editRole && !copySource && isSeedAdmin && !tenantId) || (copySource && copyTargets.size === 0)}>
                <MdSave style={{ fontSize: "1.1rem" }} />
                {saving ? "Saving..." : copySource ? "Copy role" : editRole ? "Update role" : "Create role"}
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
            <h3 style={{ margin: "0.75rem 0 0.5rem", color: "var(--k-ink)" }}>Delete role?</h3>
            <p style={{ margin: 0, color: "var(--k-muted)", fontSize: "var(--k-font)" }}>
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
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem", justifyContent: "center", flexWrap: "wrap" }}>
              <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={() => setDeleteConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                style={{ ...formStyles.button, background: colors.danger, color: "#fff" }}
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
  card: { marginTop: 0, padding: "var(--k-card-pad)" },
  cardHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "0.5rem",
    marginBottom: "0.4rem",
  },
  cardTitle: { margin: 0, fontSize: "calc(var(--k-font) + 0.1rem)", fontWeight: 700, color: "var(--k-ink)", overflowWrap: "anywhere" },
  cardDescription: {
    margin: "0 0 0.75rem",
    color: "var(--k-muted)",
    fontSize: "var(--k-font-sm)",
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
  iconLabel: { display: "inline-flex", alignItems: "center", gap: "0.4rem" },
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
    flexWrap: "wrap",
    gap: "0.5rem",
    marginTop: "0.25rem",
    marginBottom: "0.5rem",
  },
  permTree: {
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 10,
    maxHeight: "46vh",
    overflowY: "auto",
    background: "#fafcfe",
  },
  sectionBlock: { borderBottom: `2px solid ${colors.cardBorder}` },
  sectionToggle: {
    background: "transparent",
    border: "none",
    color: "#fff",
    cursor: "pointer",
    padding: "0.2rem",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "none",
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`,
    padding: "0.5rem 0.6rem",
    gap: "0.25rem",
    color: "#fff",
    position: "sticky",
    top: 0,
    zIndex: 1,
  },
  sectionCheckBtn: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: "0.25rem",
    fontWeight: 700,
    color: "#fff",
    fontSize: "0.95rem",
    textAlign: "left",
    letterSpacing: "0.02em",
    textTransform: "uppercase",
  },
  sectionName: { flex: 1 },
  sectionCount: {
    fontWeight: 700,
    color: colors.blue,
    fontSize: "0.78rem",
    background: "#fff",
    borderRadius: 50,
    padding: "0.1rem 0.6rem",
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
  // Delete-confirm uses the smallest tier with centered icon + text;
  // padding is applied directly because the body/footer stack isn't used.
  deleteModal: {
    ...formStyles.modal,
    maxWidth: `${modalSizes.sm}px`,
    padding: "2rem",
    textAlign: "center",
    overflow: "visible",
  },
};

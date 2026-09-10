import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  MdAdminPanelSettings,
  MdAdd,
  MdBusiness,
  MdCheckBox,
  MdCheckBoxOutlineBlank,
  MdClose,
  MdDelete,
  MdExpandLess,
  MdExpandMore,
  MdLock,
  MdLockOpen,
  MdPeople,
  MdRefresh,
  MdSave,
  MdSearch,
} from "react-icons/md";
import { getAdministratorTree } from "../api/administratorsApi";
import { getCompanies } from "../api/companyApi";
import { createUser, deleteUser } from "../api/usersApi";
import { getRoles, assignUserRoles } from "../api/rbacApi";
import { setUserCompanies } from "../api/userCompaniesApi";
import { useAuth } from "../contexts/AuthContext";
import { notify } from "../utils/notify";
import { colors, formStyles, modalSizes } from "../theme";
import { useConfirm } from "../Components/ConfirmDialog";

/**
 * Seed-admin console. Lists every top-level account (created by the seed
 * admin) with the users beneath it, the companies that belong to that
 * tree and each account's tenant-access grants. Only the seed admin sees
 * the nav entry and only the seed admin can load /api/administrators —
 * anyone else gets 403 server-side regardless of their permissions.
 *
 * Writes reuse the existing endpoints: create user + assign role for a
 * new Administrator, PUT /usercompanies/user/{id} for company access,
 * DELETE /users/{id} for removal.
 */
export default function AdministratorsPage() {
  const { user: me } = useAuth();
  const isSeedAdmin = !!me?.isSeedAdmin;
  const confirm = useConfirm();

  const [tree, setTree] = useState([]);
  const [allCompanies, setAllCompanies] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());

  // Create-administrator modal
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ username: "", fullName: "", password: "" });
  const [saving, setSaving] = useState(false);

  // Company-access modal: { userId, fullName, username } + selected ids
  const [accessTarget, setAccessTarget] = useState(null);
  const [accessSelected, setAccessSelected] = useState(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [treeRes, compRes, rolesRes] = await Promise.all([
        getAdministratorTree(),
        getCompanies(),
        getRoles(),
      ]);
      setTree(treeRes.data || []);
      setAllCompanies(compRes.data || []);
      setRoles(rolesRes.data || []);
    } catch {
      notify("Failed to load administrators", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSeedAdmin) load();
  }, [isSeedAdmin, load]);

  const companyName = useMemo(() => {
    const m = new Map();
    for (const c of allCompanies) m.set(c.id, c.name);
    return (id) => m.get(id) || `#${id}`;
  }, [allCompanies]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return tree;
    return tree.filter((a) =>
      a.fullName?.toLowerCase().includes(s)
      || a.username?.toLowerCase().includes(s)
      || a.users?.some((u) => u.fullName?.toLowerCase().includes(s) || u.username?.toLowerCase().includes(s))
      || a.companies?.some((c) => c.name?.toLowerCase().includes(s)));
  }, [tree, search]);

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // ── Create administrator ────────────────────────────────────────
  const submitCreate = async () => {
    if (!form.username.trim() || !form.fullName.trim() || !form.password) {
      notify("Username, full name and password are required", "warning");
      return;
    }
    setSaving(true);
    try {
      const adminRole = roles.find((r) => r.isSystemRole && r.name === "Administrator")
        || roles.find((r) => r.name === "Administrator");
      const { data: created } = await createUser({
        username: form.username.trim(),
        fullName: form.fullName.trim(),
        password: form.password,
        role: adminRole?.name || "Administrator",
      });
      if (created?.id && adminRole?.id) {
        try {
          await assignUserRoles(created.id, [adminRole.id]);
        } catch {
          notify("Administrator created, but the Administrator role could not be applied. Set it from Users → Roles.", "warning");
        }
      }
      notify(`Administrator "${created?.fullName || form.fullName}" created.`, "success");
      setShowCreate(false);
      setForm({ username: "", fullName: "", password: "" });
      await load();
    } catch (err) {
      notify(err?.response?.data?.message || "Failed to create administrator", "error");
    } finally {
      setSaving(false);
    }
  };

  // ── Company access ──────────────────────────────────────────────
  const openAccess = (target, currentIds) => {
    setAccessTarget(target);
    setAccessSelected(new Set(currentIds || []));
  };
  const toggleAccess = (companyId) =>
    setAccessSelected((prev) => {
      const next = new Set(prev);
      if (next.has(companyId)) next.delete(companyId); else next.add(companyId);
      return next;
    });
  const submitAccess = async () => {
    if (!accessTarget) return;
    setSaving(true);
    try {
      const { data } = await setUserCompanies(accessTarget.userId, Array.from(accessSelected));
      notify(`Saved: ${data.added} added, ${data.removed} removed (total ${data.total}).`, "success");
      setAccessTarget(null);
      await load();
    } catch (err) {
      notify(err?.response?.data?.message || "Failed to save company access", "error");
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ──────────────────────────────────────────────────────
  const handleDelete = async (target) => {
    const ok = await confirm({
      title: "Delete account?",
      message: `Delete ${target.fullName}? Users and companies they created move up to you.`,
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await deleteUser(target.userId);
      notify(`Deleted ${target.fullName}.`, "success");
      await load();
    } catch (err) {
      notify(err?.response?.data?.message || "Failed to delete user", "error");
    }
  };

  if (!isSeedAdmin) {
    return (
      <div style={styles.empty}>
        <MdLock size={48} color={colors.textSecondary} />
        <p>Only the seed admin can open the administrators console.</p>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 }}>
          <div style={styles.headerIcon}><MdAdminPanelSettings size={22} /></div>
          <div style={{ minWidth: 0 }}>
            <h1 style={styles.h1}>Administrators</h1>
            <p style={styles.sub}>
              Every Administrator you created, with their users, companies and company access.
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" style={styles.ghostBtn} onClick={load} title="Reload">
            <MdRefresh size={18} /> Refresh
          </button>
          <button type="button" style={styles.primaryBtn} onClick={() => setShowCreate(true)}>
            <MdAdd size={18} /> New Administrator
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={styles.searchWrap}>
        <MdSearch style={{ color: colors.textSecondary, fontSize: "1.25rem" }} />
        <input
          style={styles.searchInput}
          type="text"
          placeholder="Search administrators, users or companies..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <p style={styles.muted}>Loading administrators...</p>
      ) : filtered.length === 0 ? (
        <p style={styles.muted}>
          {search ? "Nothing matches your search." : "No administrators yet. Create the first one to start delegating."}
        </p>
      ) : (
        <div style={styles.list}>
          {filtered.map((a) => {
            const open = expanded.has(a.userId);
            return (
              <div key={a.userId} style={styles.card}>
                {/* Card header */}
                <button type="button" style={styles.cardHead} onClick={() => toggle(a.userId)} aria-expanded={open}>
                  <div style={styles.avatar}>{initials(a.fullName)}</div>
                  <div style={styles.headText}>
                    <div style={styles.name}>{a.fullName}</div>
                    <div style={styles.username}>
                      @{a.username}
                      {a.roles?.length ? ` · ${a.roles.join(", ")}` : ` · ${a.role}`}
                      {a.isLegacyRoot ? " · legacy (no creator recorded)" : ""}
                    </div>
                  </div>
                  <div style={styles.counts}>
                    <span style={styles.pill}><MdPeople size={14} /> {a.users?.length || 0}</span>
                    <span style={styles.pill}><MdBusiness size={14} /> {a.companies?.length || 0}</span>
                    <span style={styles.pill}>{a.companyIds?.length || 0} access</span>
                  </div>
                  {open ? <MdExpandLess size={22} /> : <MdExpandMore size={22} />}
                </button>

                {open && (
                  <div style={styles.cardBody}>
                    {/* Admin's own access */}
                    <Section title="Administrator's company access">
                      <div style={styles.chipRow}>
                        {(a.companyIds || []).length === 0
                          ? <span style={styles.mutedInline}>No company access — this administrator sees "No Company Configured".</span>
                          : a.companyIds.map((id) => <span key={id} style={styles.chip}>{companyName(id)}</span>)}
                      </div>
                      <div style={styles.actions}>
                        <button type="button" style={styles.smallBtn}
                          onClick={() => openAccess({ userId: a.userId, fullName: a.fullName, username: a.username }, a.companyIds)}>
                          <MdLockOpen size={16} /> Edit access
                        </button>
                        <button type="button" style={styles.smallDangerBtn}
                          onClick={() => handleDelete({ userId: a.userId, fullName: a.fullName })}>
                          <MdDelete size={16} /> Delete administrator
                        </button>
                      </div>
                    </Section>

                    {/* Users beneath */}
                    <Section title={`Users (${a.users?.length || 0})`}>
                      {(a.users || []).length === 0 ? (
                        <span style={styles.mutedInline}>This administrator has not created any users.</span>
                      ) : (
                        <div style={styles.subGrid}>
                          {a.users.map((u) => (
                            <div key={u.userId} style={styles.subCard}>
                              <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
                                <div style={{ ...styles.avatar, width: 34, height: 34, fontSize: "0.8rem" }}>{initials(u.fullName)}</div>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div style={styles.name}>{u.fullName}</div>
                                  <div style={styles.username}>@{u.username}{u.roles?.length ? ` · ${u.roles.join(", ")}` : ""}</div>
                                </div>
                              </div>
                              <div style={styles.chipRow}>
                                {(u.companyIds || []).length === 0
                                  ? <span style={styles.mutedInline}>No company access</span>
                                  : u.companyIds.map((id) => <span key={id} style={styles.chip}>{companyName(id)}</span>)}
                              </div>
                              <div style={styles.actions}>
                                <button type="button" style={styles.smallBtn}
                                  onClick={() => openAccess({ userId: u.userId, fullName: u.fullName, username: u.username }, u.companyIds)}>
                                  <MdLockOpen size={16} /> Edit access
                                </button>
                                <button type="button" style={styles.smallDangerBtn}
                                  onClick={() => handleDelete({ userId: u.userId, fullName: u.fullName })}>
                                  <MdDelete size={16} /> Delete
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Section>

                    {/* Companies in this tree */}
                    <Section title={`Companies (${a.companies?.length || 0})`}>
                      {(a.companies || []).length === 0 ? (
                        <span style={styles.mutedInline}>No companies created by or granted to this tree.</span>
                      ) : (
                        <div style={styles.chipRow}>
                          {a.companies.map((c) => (
                            <span key={c.companyId} style={styles.chip} title={c.isTenantIsolated ? "Tenant-isolated" : "Open"}>
                              <MdBusiness size={13} /> {c.name}
                            </span>
                          ))}
                        </div>
                      )}
                      <div style={styles.actions}>
                        <Link to="/companies/list" style={styles.linkBtn}>Open Companies</Link>
                        <Link to="/users" style={styles.linkBtn}>Open Users</Link>
                        <Link to="/tenant-access" style={styles.linkBtn}>Open Tenant Access</Link>
                      </div>
                    </Section>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Create administrator modal ── */}
      {showCreate && (
        <div style={formStyles.backdrop} onClick={() => !saving && setShowCreate(false)}>
          <div style={{ ...formStyles.modal, maxWidth: modalSizes.md }} onClick={(e) => e.stopPropagation()}>
            <div style={formStyles.header}>
              <h3 style={formStyles.title}>New Administrator</h3>
              <button type="button" style={formStyles.closeButton} onClick={() => setShowCreate(false)} aria-label="Close"><MdClose /></button>
            </div>
            <div style={formStyles.body}>
              <p style={{ ...styles.mutedInline, marginBottom: "1rem" }}>
                The account is created under you, receives the Administrator role, and starts with no company
                access. Grant companies afterwards with "Edit access".
              </p>
              <label style={styles.label} htmlFor="adm-fullname">Full name</label>
              <input id="adm-fullname" style={styles.input} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} autoFocus />
              <label style={styles.label} htmlFor="adm-username">Username</label>
              <input id="adm-username" style={styles.input} value={form.username} autoComplete="off" onChange={(e) => setForm({ ...form, username: e.target.value })} />
              <label style={styles.label} htmlFor="adm-password">Password</label>
              <input id="adm-password" style={styles.input} type="password" value={form.password} autoComplete="new-password" onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <div style={styles.hint}>At least 8 characters with a letter and a digit.</div>
            </div>
            <div style={formStyles.footer}>
              <button type="button" style={styles.ghostBtn} onClick={() => setShowCreate(false)} disabled={saving}>Cancel</button>
              <button type="button" style={styles.primaryBtn} onClick={submitCreate} disabled={saving}>
                <MdSave size={18} /> {saving ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Company access modal ── */}
      {accessTarget && (
        <div style={formStyles.backdrop} onClick={() => !saving && setAccessTarget(null)}>
          <div style={{ ...formStyles.modal, maxWidth: modalSizes.md }} onClick={(e) => e.stopPropagation()}>
            <div style={formStyles.header}>
              <h3 style={formStyles.title}>Company access — {accessTarget.fullName}</h3>
              <button type="button" style={formStyles.closeButton} onClick={() => setAccessTarget(null)} aria-label="Close"><MdClose /></button>
            </div>
            <div style={formStyles.body}>
              {allCompanies.length === 0 ? (
                <p style={styles.mutedInline}>No companies exist yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  {allCompanies.map((c) => {
                    const on = accessSelected.has(c.id);
                    return (
                      <button key={c.id} type="button" style={{ ...styles.checkRow, ...(on ? styles.checkRowOn : null) }} onClick={() => toggleAccess(c.id)}>
                        {on ? <MdCheckBox size={22} color={colors.blue} /> : <MdCheckBoxOutlineBlank size={22} color={colors.textSecondary} />}
                        <span style={{ flex: 1, textAlign: "left" }}>{c.name}</span>
                        {c.isTenantIsolated ? <MdLock size={16} color={colors.textSecondary} title="Tenant-isolated" /> : null}
                      </button>
                    );
                  })}
                </div>
              )}
              <p style={{ ...styles.hint, marginTop: "0.75rem" }}>
                Unticking every company leaves the account signed-in but on the "No Company Configured" screen.
              </p>
            </div>
            <div style={formStyles.footer}>
              <button type="button" style={styles.ghostBtn} onClick={() => setAccessTarget(null)} disabled={saving}>Cancel</button>
              <button type="button" style={styles.primaryBtn} onClick={submitAccess} disabled={saving}>
                <MdSave size={18} /> {saving ? "Saving..." : "Save access"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>{title}</div>
      {children}
    </div>
  );
}

function initials(name) {
  return (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";
}

const styles = {
  page: { padding: "clamp(0.75rem, 2vw, 1.5rem)", maxWidth: 1200, margin: "0 auto" },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    gap: "1rem", flexWrap: "wrap", marginBottom: "1rem",
  },
  headerIcon: {
    width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center",
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, color: "#fff", flexShrink: 0,
  },
  h1: { margin: 0, fontSize: "1.35rem", color: colors.textPrimary },
  sub: { margin: 0, color: colors.textSecondary, fontSize: "0.88rem" },
  searchWrap: {
    display: "flex", alignItems: "center", gap: "0.5rem", background: colors.inputBg,
    border: `1px solid ${colors.inputBorder}`, borderRadius: 10, padding: "0.5rem 0.75rem", marginBottom: "1rem",
  },
  searchInput: { flex: 1, border: "none", background: "transparent", outline: "none", fontSize: "0.95rem", minWidth: 0 },
  muted: { padding: "2rem", textAlign: "center", color: colors.textSecondary },
  mutedInline: { color: colors.textSecondary, fontSize: "0.86rem" },
  list: { display: "flex", flexDirection: "column", gap: "0.9rem" },
  card: {
    background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 14,
    boxShadow: "0 1px 3px rgba(16,32,64,0.04), 0 6px 18px rgba(16,32,64,0.06)", overflow: "hidden",
  },
  cardHead: {
    width: "100%", display: "flex", alignItems: "center", gap: "0.85rem", padding: "0.9rem 1rem",
    background: "transparent", border: "none", boxShadow: "none", cursor: "pointer", textAlign: "left",
    color: colors.textPrimary, minHeight: 64,
    // Wrap on phones: the count pills drop under the name instead of
    // squeezing the name column to zero width.
    flexWrap: "wrap",
  },
  // Name + username block. A real flex-basis (not just flex:1) is what
  // keeps it from collapsing when the pills sit on the same line.
  headText: { flex: "1 1 180px", minWidth: 0 },
  avatar: {
    width: 42, height: 42, borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0,
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, color: "#fff", fontWeight: 700, fontSize: "0.9rem",
  },
  name: {
    fontWeight: 600, fontSize: "0.95rem", color: colors.textPrimary,
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
  },
  username: { color: colors.textSecondary, fontSize: "0.82rem", overflowWrap: "break-word" },
  counts: { display: "flex", gap: "0.4rem", flexWrap: "wrap", justifyContent: "flex-end", marginLeft: "auto" },
  pill: {
    display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.2rem 0.55rem",
    borderRadius: 999, background: "#eef3fb", color: colors.blue, fontSize: "0.78rem", fontWeight: 600, whiteSpace: "nowrap",
  },
  cardBody: { borderTop: `1px solid ${colors.cardBorder}`, padding: "0.5rem 1rem 1rem" },
  section: { padding: "0.75rem 0" },
  sectionTitle: {
    fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
    color: colors.textSecondary, marginBottom: "0.5rem",
  },
  chipRow: { display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.6rem" },
  chip: {
    display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.25rem 0.6rem", borderRadius: 8,
    background: "#f3f6fa", border: `1px solid ${colors.cardBorder}`, fontSize: "0.82rem", color: colors.textPrimary,
  },
  actions: { display: "flex", gap: "0.5rem", flexWrap: "wrap" },
  subGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", gap: "0.75rem" },
  subCard: {
    border: `1px solid ${colors.cardBorder}`, borderRadius: 12, padding: "0.75rem",
    display: "flex", flexDirection: "column", gap: "0.6rem", background: "#fbfcfe",
  },
  primaryBtn: {
    display: "inline-flex", alignItems: "center", gap: "0.4rem", minHeight: 44, padding: "0.6rem 1rem",
    border: "none", borderRadius: 10, cursor: "pointer", color: "#fff", fontWeight: 600, boxShadow: "none",
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`,
  },
  ghostBtn: {
    display: "inline-flex", alignItems: "center", gap: "0.4rem", minHeight: 44, padding: "0.6rem 1rem",
    border: `1px solid ${colors.inputBorder}`, borderRadius: 10, cursor: "pointer", background: colors.cardBg,
    color: colors.textPrimary, fontWeight: 600, boxShadow: "none",
  },
  smallBtn: {
    display: "inline-flex", alignItems: "center", gap: "0.35rem", minHeight: 40, padding: "0.45rem 0.8rem",
    border: `1px solid ${colors.inputBorder}`, borderRadius: 8, cursor: "pointer", background: colors.cardBg,
    color: colors.blue, fontWeight: 600, fontSize: "0.85rem", boxShadow: "none",
  },
  smallDangerBtn: {
    display: "inline-flex", alignItems: "center", gap: "0.35rem", minHeight: 40, padding: "0.45rem 0.8rem",
    border: `1px solid ${colors.dangerLight}`, borderRadius: 8, cursor: "pointer", background: colors.dangerLight,
    color: colors.danger, fontWeight: 600, fontSize: "0.85rem", boxShadow: "none",
  },
  linkBtn: {
    display: "inline-flex", alignItems: "center", minHeight: 40, padding: "0.45rem 0.8rem", borderRadius: 8,
    border: `1px solid ${colors.inputBorder}`, color: colors.textPrimary, textDecoration: "none", fontSize: "0.85rem", fontWeight: 600,
  },
  label: { display: "block", fontSize: "0.85rem", fontWeight: 600, color: colors.textPrimary, margin: "0.75rem 0 0.3rem" },
  input: {
    width: "100%", boxSizing: "border-box", padding: "0.65rem 0.8rem", borderRadius: 10,
    border: `1px solid ${colors.inputBorder}`, background: colors.inputBg, fontSize: "0.95rem", minHeight: 44,
  },
  hint: { color: colors.textSecondary, fontSize: "0.8rem", marginTop: "0.35rem" },
  checkRow: {
    display: "flex", alignItems: "center", gap: "0.6rem", width: "100%", minHeight: 44, padding: "0.5rem 0.75rem",
    border: `1px solid ${colors.cardBorder}`, borderRadius: 10, background: colors.cardBg, cursor: "pointer",
    color: colors.textPrimary, fontSize: "0.92rem", boxShadow: "none",
  },
  checkRowOn: { borderColor: colors.blue, background: "#eef3fb" },
  empty: {
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    minHeight: "50vh", gap: "0.75rem", color: colors.textSecondary, padding: "1rem", textAlign: "center",
  },
};

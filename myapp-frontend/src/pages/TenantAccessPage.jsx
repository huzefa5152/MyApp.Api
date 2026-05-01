import { useEffect, useMemo, useState } from "react";
import {
  MdAdminPanelSettings,
  MdSearch,
  MdEdit,
  MdClose,
  MdSave,
  MdLock,
  MdLockOpen,
  MdPerson,
  MdCheckBox,
  MdCheckBoxOutlineBlank,
} from "react-icons/md";
import {
  getAllAssignments,
  setUserCompanies,
} from "../api/userCompaniesApi";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
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

export default function TenantAccessPage() {
  const { has } = usePermissions();
  const canView = has("tenantaccess.manage.view");
  const canAssign = has("tenantaccess.manage.assign");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Edit modal state — full set of companies for one user, edited as a Set.
  const [editUser, setEditUser] = useState(null);
  const [editSelected, setEditSelected] = useState(() => new Set());
  const [saving, setSaving] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const { data } = await getAllAssignments();
      setRows(data);
    } catch {
      notify("Failed to load tenant-access assignments", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canView) fetchAll();
  }, [canView]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.fullName?.toLowerCase().includes(s) ||
        r.username?.toLowerCase().includes(s)
    );
  }, [rows, search]);

  if (!canView) {
    return (
      <div style={pageStyles.empty}>
        <MdLock size={48} color={colors.textSecondary} />
        <p>You don't have permission to view tenant-access assignments.</p>
      </div>
    );
  }

  const openEdit = (row) => {
    setEditUser(row);
    setEditSelected(new Set(
      row.companies.filter((c) => c.hasExplicitGrant).map((c) => c.companyId)
    ));
  };

  const closeEdit = () => {
    setEditUser(null);
    setEditSelected(new Set());
  };

  const toggleCompany = (companyId) => {
    setEditSelected((prev) => {
      const next = new Set(prev);
      if (next.has(companyId)) next.delete(companyId);
      else next.add(companyId);
      return next;
    });
  };

  const submit = async () => {
    if (!editUser) return;
    setSaving(true);
    try {
      const ids = Array.from(editSelected);
      const { data } = await setUserCompanies(editUser.userId, ids);
      notify(
        `Saved: ${data.added} added, ${data.removed} removed (total ${data.total}).`,
        "success"
      );
      closeEdit();
      await fetchAll();
    } catch (err) {
      const msg = err?.response?.data?.message || "Failed to save assignments";
      notify(msg, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={pageStyles.shell}>
      <div style={pageStyles.header}>
        <div style={pageStyles.headerInner}>
          <MdAdminPanelSettings size={28} color={colors.blue} />
          <div>
            <h1 style={pageStyles.title}>Tenant Access</h1>
            <p style={pageStyles.subtitle}>
              Decide which companies each user can reach. Only takes effect on
              companies marked <strong>Tenant Isolated</strong> — open
              companies stay visible to anyone with the right RBAC permission.
            </p>
          </div>
        </div>
      </div>

      <div style={pageStyles.toolbar}>
        <div style={pageStyles.searchBox}>
          <MdSearch color={colors.textSecondary} />
          <input
            type="text"
            placeholder="Search users by name or username…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={pageStyles.searchInput}
          />
        </div>
        <span style={pageStyles.count}>
          {filtered.length} user{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      {loading ? (
        <div style={pageStyles.empty}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={pageStyles.empty}>
          <MdPerson size={48} color={colors.textSecondary} />
          <p>No users match that search.</p>
        </div>
      ) : (
        <div style={pageStyles.tableWrap}>
          <table style={pageStyles.table}>
            <thead>
              <tr>
                <th style={pageStyles.th}>User</th>
                <th style={pageStyles.th}>Username</th>
                <th style={pageStyles.th}>Explicit Grants</th>
                <th style={pageStyles.th}>Isolated Companies</th>
                <th style={{ ...pageStyles.th, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const grants = row.companies.filter((c) => c.hasExplicitGrant);
                const isolated = row.companies.filter((c) => c.isTenantIsolated);
                const reachableIsolated = isolated.filter((c) => c.hasExplicitGrant);
                return (
                  <tr key={row.userId} style={pageStyles.tr}>
                    <td style={pageStyles.td}>
                      <div style={pageStyles.userCell}>
                        <div style={pageStyles.avatar}>
                          {row.fullName?.[0]?.toUpperCase() ?? "?"}
                        </div>
                        <div>
                          <div style={pageStyles.userName}>{row.fullName}</div>
                        </div>
                      </div>
                    </td>
                    <td style={pageStyles.td}>{row.username}</td>
                    <td style={pageStyles.td}>
                      <span style={pageStyles.pill}>{grants.length} / {row.companies.length}</span>
                    </td>
                    <td style={pageStyles.td}>
                      {isolated.length === 0 ? (
                        <span style={pageStyles.muted}>none isolated</span>
                      ) : (
                        <span style={
                          reachableIsolated.length === isolated.length
                            ? pageStyles.pillSuccess
                            : reachableIsolated.length === 0
                            ? pageStyles.pillDanger
                            : pageStyles.pillWarn
                        }>
                          {reachableIsolated.length} / {isolated.length}
                        </span>
                      )}
                    </td>
                    <td style={{ ...pageStyles.td, textAlign: "right" }}>
                      <button
                        type="button"
                        style={pageStyles.btnPrimary}
                        disabled={!canAssign}
                        title={canAssign ? "" : "Requires tenantaccess.manage.assign permission"}
                        onClick={() => openEdit(row)}
                      >
                        <MdEdit /> Edit Access
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editUser && (
        <EditModal
          user={editUser}
          selected={editSelected}
          onToggle={toggleCompany}
          onSubmit={submit}
          onClose={closeEdit}
          saving={saving}
          canAssign={canAssign}
        />
      )}
    </div>
  );
}

function EditModal({ user, selected, onToggle, onSubmit, onClose, saving, canAssign }) {
  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div
        style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={formStyles.header}>
          <span style={formStyles.title}>
            Edit Access — {user.fullName} ({user.username})
          </span>
          <button type="button" style={formStyles.closeButton} onClick={onClose} aria-label="Close">
            <MdClose />
          </button>
        </div>
        <div style={formStyles.body}>
          <p style={pageStyles.helpText}>
            Tick a company to grant explicit access. Companies marked{" "}
            <span style={pageStyles.badgeIsolated}>
              <MdLock size={12} /> Isolated
            </span>{" "}
            require the tick; companies marked{" "}
            <span style={pageStyles.badgeOpen}>
              <MdLockOpen size={12} /> Open
            </span>{" "}
            stay reachable for any authenticated user — your tick is stored as
            a forward-looking grant in case the company is later isolated.
          </p>
          <div style={pageStyles.companyList}>
            {user.companies.map((c) => {
              const checked = selected.has(c.companyId);
              return (
                <label
                  key={c.companyId}
                  style={{
                    ...pageStyles.companyRow,
                    background: checked ? colors.successLight : colors.cardBg,
                    borderColor: checked ? colors.success : colors.cardBorder,
                  }}
                >
                  <input
                    type="checkbox"
                    style={{ display: "none" }}
                    checked={checked}
                    disabled={!canAssign}
                    onChange={() => onToggle(c.companyId)}
                  />
                  {checked ? (
                    <MdCheckBox size={20} color={colors.success} />
                  ) : (
                    <MdCheckBoxOutlineBlank size={20} color={colors.textSecondary} />
                  )}
                  <span style={pageStyles.companyName}>{c.companyName}</span>
                  {c.isTenantIsolated ? (
                    <span style={pageStyles.badgeIsolated}>
                      <MdLock size={12} /> Isolated
                    </span>
                  ) : (
                    <span style={pageStyles.badgeOpen}>
                      <MdLockOpen size={12} /> Open
                    </span>
                  )}
                </label>
              );
            })}
            {user.companies.length === 0 && (
              <div style={pageStyles.empty}>
                <p>No companies in the system yet.</p>
              </div>
            )}
          </div>
        </div>
        <div style={formStyles.footer}>
          <button
            type="button"
            style={{ ...formStyles.button, ...formStyles.cancel }}
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            style={{ ...formStyles.button, ...formStyles.submit }}
            onClick={onSubmit}
            disabled={saving || !canAssign}
          >
            <MdSave /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const pageStyles = {
  shell: { padding: "1.5rem", maxWidth: 1200, margin: "0 auto" },
  header: { marginBottom: "1.5rem" },
  headerInner: { display: "flex", gap: "1rem", alignItems: "flex-start" },
  title: { margin: 0, color: colors.textPrimary, fontSize: "1.5rem" },
  subtitle: { margin: "0.25rem 0 0", color: colors.textSecondary, fontSize: "0.9rem", maxWidth: 720 },
  toolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", gap: "1rem", flexWrap: "wrap" },
  searchBox: { display: "flex", alignItems: "center", gap: "0.5rem", background: colors.inputBg, border: `1px solid ${colors.inputBorder}`, borderRadius: 8, padding: "0.5rem 0.75rem", minWidth: 280 },
  searchInput: { border: "none", outline: "none", background: "transparent", flex: 1, fontSize: "0.9rem", color: colors.textPrimary },
  count: { color: colors.textSecondary, fontSize: "0.85rem" },
  empty: { textAlign: "center", padding: "3rem", color: colors.textSecondary, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem" },
  tableWrap: { background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 8, overflow: "hidden" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "0.75rem 1rem", background: colors.inputBg, borderBottom: `1px solid ${colors.cardBorder}`, color: colors.textSecondary, fontSize: "0.8rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" },
  tr: { borderBottom: `1px solid ${colors.cardBorder}` },
  td: { padding: "0.75rem 1rem", color: colors.textPrimary, fontSize: "0.92rem", verticalAlign: "middle" },
  userCell: { display: "flex", alignItems: "center", gap: "0.75rem" },
  avatar: { width: 32, height: 32, borderRadius: "50%", background: colors.blueLight, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: "0.9rem" },
  userName: { fontWeight: 600 },
  pill: { display: "inline-block", padding: "0.2rem 0.55rem", borderRadius: 999, background: colors.inputBg, border: `1px solid ${colors.cardBorder}`, color: colors.textPrimary, fontSize: "0.8rem", fontWeight: 600 },
  pillSuccess: { display: "inline-block", padding: "0.2rem 0.55rem", borderRadius: 999, background: colors.successLight, border: `1px solid ${colors.success}`, color: colors.success, fontSize: "0.8rem", fontWeight: 600 },
  pillWarn: { display: "inline-block", padding: "0.2rem 0.55rem", borderRadius: 999, background: colors.warnLight, border: `1px solid ${colors.warn}`, color: colors.warn, fontSize: "0.8rem", fontWeight: 600 },
  pillDanger: { display: "inline-block", padding: "0.2rem 0.55rem", borderRadius: 999, background: colors.dangerLight, border: `1px solid ${colors.danger}`, color: colors.danger, fontSize: "0.8rem", fontWeight: 600 },
  muted: { color: colors.textSecondary, fontSize: "0.85rem" },
  btnPrimary: { display: "inline-flex", alignItems: "center", gap: "0.4rem", background: colors.blue, color: "white", border: "none", borderRadius: 6, padding: "0.45rem 0.75rem", cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" },
  helpText: { color: colors.textSecondary, fontSize: "0.85rem", marginTop: 0, marginBottom: "1rem", lineHeight: 1.5 },
  companyList: { display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "60vh", overflowY: "auto" },
  companyRow: { display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.7rem 0.9rem", border: `1px solid ${colors.cardBorder}`, borderRadius: 8, cursor: "pointer", transition: "all 0.15s ease" },
  companyName: { flex: 1, fontWeight: 500, color: colors.textPrimary },
  badgeIsolated: { display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.15rem 0.5rem", borderRadius: 999, background: colors.warnLight, color: colors.warn, fontSize: "0.75rem", fontWeight: 600 },
  badgeOpen: { display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.15rem 0.5rem", borderRadius: 999, background: colors.inputBg, color: colors.textSecondary, fontSize: "0.75rem", fontWeight: 600, border: `1px solid ${colors.cardBorder}` },
};

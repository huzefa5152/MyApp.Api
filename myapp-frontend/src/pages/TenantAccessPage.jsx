import { useEffect, useMemo, useState } from "react";
import {
  MdAdminPanelSettings,
  MdEdit,
  MdClose,
  MdSave,
  MdLock,
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
import { PageHeader, Button, Toolbar, ToolbarSpacer, SearchBox, TableWrap, Loading, EmptyState } from "../ui/Kit";

const colors = {
  blueLight: "#1565c0",
  cardBg: "var(--k-surface)",
  cardBorder: "var(--k-line)",
  textPrimary: "var(--k-ink)",
  textSecondary: "var(--k-muted)",
  success: "#28a745",
  successLight: "#eafbef",
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
      <EmptyState icon={MdLock} boxed={false}>
        You don't have permission to view tenant-access assignments.
      </EmptyState>
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
      <PageHeader
        icon={MdAdminPanelSettings}
        tone="blue"
        title="Tenant Access"
        subtitle={(
          <span style={{ display: "block", maxWidth: 720 }}>
            Decide which companies each user can reach. This is the whole
            answer: a user reaches the companies ticked here and no others.
            No ticks, no access. Only the primary admin bypasses it.
          </span>
        )}
      />

      <Toolbar>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search users by name or username…"
        />
        <ToolbarSpacer />
        <span style={pageStyles.count}>
          {filtered.length} user{filtered.length === 1 ? "" : "s"}
        </span>
      </Toolbar>

      {loading ? (
        <Loading>Loading…</Loading>
      ) : filtered.length === 0 ? (
        <EmptyState icon={MdPerson}>No users match that search.</EmptyState>
      ) : (
        <>
          {/* Desktop / tablet — table */}
          <TableWrap data-admin-table-region="" className="tenant-table">
            <table className="k-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Username</th>
                  <th>Companies Granted</th>
                  <th className="k-num">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  // The grant is the whole story: CompanyAccessGuard is
                  // fail-closed, so a user reaches exactly these and nothing
                  // else. The old "isolated" split implied the rest were open,
                  // which has not been true since the guard changed.
                  const grants = row.companies.filter((c) => c.hasExplicitGrant);
                  return (
                    <tr key={row.userId}>
                      <td>
                        <div style={pageStyles.userCell}>
                          <div style={pageStyles.avatar}>
                            {row.fullName?.[0]?.toUpperCase() ?? "?"}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={pageStyles.userName}>{row.fullName}</div>
                          </div>
                        </div>
                      </td>
                      <td>{row.username}</td>
                      <td>
                        <span style={pageStyles.pill}>{grants.length} / {row.companies.length}</span>
                      </td>
                      <td className="k-actions">
                        <Button
                          variant="primary"
                          size="sm"
                          icon={MdEdit}
                          disabled={!canAssign}
                          title={canAssign ? "" : "Requires tenantaccess.manage.assign permission"}
                          onClick={() => openEdit(row)}
                        >
                          Edit Access
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>

          {/* Mobile — stacked cards. Username under the name; both stat
              pills on a labelled row; full-width Edit button at the
              bottom for an easy thumb target. */}
          <div className="tenant-cards">
            {filtered.map((row) => {
              const grants = row.companies.filter((c) => c.hasExplicitGrant);
              return (
                <div key={row.userId} className="tenant-card">
                  <div className="tenant-card__head">
                    <div className="tenant-card__avatar">
                      {row.fullName?.[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div className="tenant-card__who">
                      <div className="tenant-card__name">{row.fullName}</div>
                      <div className="tenant-card__username">@{row.username}</div>
                    </div>
                  </div>

                  <div className="tenant-card__stats">
                    <div className="tenant-card__stat">
                      <span className="tenant-card__stat-label">Companies Granted</span>
                      <span className="tenant-card__pill">
                        {grants.length} / {row.companies.length}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="tenant-card__edit"
                    disabled={!canAssign}
                    title={canAssign ? "" : "Requires tenantaccess.manage.assign permission"}
                    onClick={() => openEdit(row)}
                  >
                    <MdEdit size={16} /> Edit Access
                  </button>
                </div>
              );
            })}
          </div>
        </>
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
    <div data-admin-backdrop="" style={formStyles.backdrop} onClick={onClose}>
      <div data-admin-dialog=""
        style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={formStyles.header}>
          <span style={formStyles.title}>
            Edit Access — {user.fullName} ({user.username})
          </span>
          <button data-admin-close="" type="button" style={formStyles.closeButton} onClick={onClose} aria-label="Close">
            <MdClose />
          </button>
        </div>
        <div style={formStyles.body}>
          <p style={pageStyles.helpText}>
            Tick a company to grant access to it. Every company requires the
            tick — there is no company this user reaches without one, and
            removing a tick takes the access away within a minute (the access
            cache holds for 60 seconds). RBAC decides what they may DO once
            inside; this decides where.
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
                </label>
              );
            })}
            {user.companies.length === 0 && (
              <EmptyState boxed={false}>No companies in the system yet.</EmptyState>
            )}
          </div>
        </div>
        <div style={formStyles.footer}>
          <button data-admin-close=""
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
            <MdSave style={{ verticalAlign: "-2px" }} /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const pageStyles = {
  shell: { maxWidth: 1200, margin: "0 auto" },
  count: { color: "var(--k-muted)", fontSize: "var(--k-font-sm)" },
  userCell: { display: "flex", alignItems: "center", gap: "0.75rem" },
  avatar: { width: 32, height: 32, flex: "none", borderRadius: "50%", background: colors.blueLight, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: "0.9rem" },
  userName: { fontWeight: 600, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  pill: { display: "inline-block", padding: "0.2rem 0.55rem", borderRadius: 999, background: "var(--k-surface-2)", border: "1px solid var(--k-line)", color: "var(--k-ink)", fontSize: "0.8rem", fontWeight: 600 },
  helpText: { color: colors.textSecondary, fontSize: "var(--ui-label-size, 0.85rem)", marginTop: 0, marginBottom: "1rem", lineHeight: 1.5 },
  companyList: { display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "60vh", overflowY: "auto" },
  companyRow: { display: "flex", alignItems: "center", gap: "0.75rem", minHeight: "var(--k-h)", padding: "0.45rem 0.9rem", border: "1px solid var(--k-line)", borderRadius: 8, cursor: "pointer", transition: "all 0.15s ease" },
  companyName: { flex: 1, fontWeight: 500, color: colors.textPrimary, overflowWrap: "anywhere" },
};

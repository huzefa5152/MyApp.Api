import { useState } from "react";
import {
  MdClose,
  MdSave,
  MdBusiness,
  MdCheckBox,
  MdCheckBoxOutlineBlank,
  MdRadioButtonChecked,
  MdRadioButtonUnchecked,
} from "react-icons/md";
import { setUserDivisions } from "../api/userCompaniesApi";
import { notify } from "../utils/notify";
import { formStyles, modalSizes } from "../theme";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  cardBg: "#ffffff",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  success: "#28a745",
  successLight: "#eafbef",
  warn: "#b26a00",
  warnLight: "#fff4e0",
};

// Companies where the division editor makes sense for this user: an
// explicit company grant (the PUT 400s without one) AND at least one
// division to restrict to. divisionInfo entries are null when the fetch
// failed (e.g. 403 on an isolated company), which excludes them here.
export function eligibleDivisionCompanies(user, divisionInfo) {
  return user.companies.filter(
    (c) =>
      c.hasExplicitGrant &&
      (divisionInfo[c.companyId]?.divisions?.length ?? 0) > 0
  );
}

// Division-level access editor for one user, opened from the Tenant Access
// page. One section per eligible company, each with its own Save — the
// backend PUT is per user × company (replace-all for that company only).
//
// Props:
//   user         — tenant-access row ({ userId, fullName, username, companies })
//   divisionInfo — { [companyId]: { divisions: [{ divisionId, divisionName }],
//                    users: { [userId]: { restrictToDivisions, grantedIds } } } }
//   canAssign    — divisionaccess.manage.assign; without it everything is
//                  read-only and the Save button is not rendered at all
//   onClose      — () => void
//   onSaved      — (companyId) => void, parent refreshes that company's info
export default function DivisionAccessModal({
  user,
  divisionInfo,
  canAssign,
  onClose,
  onSaved,
}) {
  const eligible = eligibleDivisionCompanies(user, divisionInfo);

  // Draft per company, seeded once from the saved state. Ticks are kept
  // while "unrestricted" is selected (greyed out, still sent on save) so
  // they act as forward-looking grants — same idea as ticking an Open
  // company on the Tenant Access grid.
  const [drafts, setDrafts] = useState(() => {
    const init = {};
    for (const c of eligible) {
      const mine = divisionInfo[c.companyId]?.users?.[user.userId];
      init[c.companyId] = {
        restrict: mine?.restrictToDivisions ?? false,
        selected: new Set(mine?.grantedIds ?? []),
      };
    }
    return init;
  });
  const [savingId, setSavingId] = useState(null);

  const setRestrict = (companyId, restrict) => {
    setDrafts((prev) => ({
      ...prev,
      [companyId]: { ...prev[companyId], restrict },
    }));
  };

  const toggleDivision = (companyId, divisionId) => {
    setDrafts((prev) => {
      const next = new Set(prev[companyId].selected);
      if (next.has(divisionId)) next.delete(divisionId);
      else next.add(divisionId);
      return { ...prev, [companyId]: { ...prev[companyId], selected: next } };
    });
  };

  const save = async (companyId, companyName) => {
    const draft = drafts[companyId];
    setSavingId(companyId);
    try {
      const { data } = await setUserDivisions(user.userId, companyId, {
        restrictToDivisions: draft.restrict,
        divisionIds: Array.from(draft.selected),
      });
      notify(
        `${companyName}: ${data.added} added, ${data.removed} removed — ` +
          (data.restrictToDivisions
            ? `restricted to ${data.total} division${data.total === 1 ? "" : "s"}.`
            : "unrestricted (all divisions)."),
        "success"
      );
      onSaved?.(companyId);
    } catch (err) {
      const msg =
        err?.response?.data?.message || "Failed to save division access";
      notify(msg, "error");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div
        style={{ ...formStyles.modal, maxWidth: `${modalSizes.md}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={formStyles.header}>
          <span style={formStyles.title}>
            Division Access — {user.fullName} ({user.username})
          </span>
          <button
            type="button"
            style={formStyles.closeButton}
            onClick={onClose}
            aria-label="Close"
          >
            <MdClose />
          </button>
        </div>
        <div style={formStyles.body}>
          <p style={styles.helpText}>
            Unrestricted users see every division. Restricted users see only
            the ticked divisions plus company-level records that carry no
            division tag — and must pick one of their divisions when creating
            documents.
          </p>

          {eligible.length === 0 && (
            <div style={styles.empty}>
              <p>
                No eligible companies — the user needs an explicit company
                grant and the company needs at least one division.
              </p>
            </div>
          )}

          {eligible.map((c) => {
            const info = divisionInfo[c.companyId];
            const draft = drafts[c.companyId];
            if (!info || !draft) return null;
            const saving = savingId === c.companyId;
            const locked = !canAssign || saving;
            return (
              <div key={c.companyId} style={styles.section}>
                <div style={styles.sectionHead}>
                  <MdBusiness size={18} color={colors.blue} />
                  <span style={styles.companyName}>{c.companyName}</span>
                  {draft.restrict ? (
                    <span style={styles.pillWarn}>
                      {draft.selected.size} / {info.divisions.length}
                    </span>
                  ) : (
                    <span style={styles.pillMuted}>Unrestricted</span>
                  )}
                </div>

                <label
                  style={{
                    ...styles.modeRow,
                    background: !draft.restrict ? colors.successLight : colors.cardBg,
                    borderColor: !draft.restrict ? colors.success : colors.cardBorder,
                  }}
                >
                  <input
                    type="radio"
                    name={`division-mode-${user.userId}-${c.companyId}`}
                    style={{ display: "none" }}
                    checked={!draft.restrict}
                    disabled={locked}
                    onChange={() => setRestrict(c.companyId, false)}
                  />
                  {!draft.restrict ? (
                    <MdRadioButtonChecked size={20} color={colors.success} />
                  ) : (
                    <MdRadioButtonUnchecked size={20} color={colors.textSecondary} />
                  )}
                  <span style={styles.modeLabel}>All divisions (unrestricted)</span>
                </label>
                <label
                  style={{
                    ...styles.modeRow,
                    background: draft.restrict ? colors.warnLight : colors.cardBg,
                    borderColor: draft.restrict ? colors.warn : colors.cardBorder,
                  }}
                >
                  <input
                    type="radio"
                    name={`division-mode-${user.userId}-${c.companyId}`}
                    style={{ display: "none" }}
                    checked={draft.restrict}
                    disabled={locked}
                    onChange={() => setRestrict(c.companyId, true)}
                  />
                  {draft.restrict ? (
                    <MdRadioButtonChecked size={20} color={colors.warn} />
                  ) : (
                    <MdRadioButtonUnchecked size={20} color={colors.textSecondary} />
                  )}
                  <span style={styles.modeLabel}>Restrict to selected divisions</span>
                </label>

                <div
                  style={{
                    ...styles.divisionGrid,
                    opacity: draft.restrict ? 1 : 0.5,
                  }}
                >
                  {info.divisions.map((d) => {
                    const checked = draft.selected.has(d.divisionId);
                    const disabled = locked || !draft.restrict;
                    return (
                      <label
                        key={d.divisionId}
                        style={{
                          ...styles.divisionRow,
                          cursor: disabled ? "default" : "pointer",
                          background:
                            checked && draft.restrict
                              ? colors.successLight
                              : colors.cardBg,
                          borderColor:
                            checked && draft.restrict
                              ? colors.success
                              : colors.cardBorder,
                        }}
                      >
                        <input
                          type="checkbox"
                          style={{ display: "none" }}
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleDivision(c.companyId, d.divisionId)}
                        />
                        {checked ? (
                          <MdCheckBox size={20} color={colors.success} />
                        ) : (
                          <MdCheckBoxOutlineBlank size={20} color={colors.textSecondary} />
                        )}
                        <span style={styles.divisionName}>{d.divisionName}</span>
                      </label>
                    );
                  })}
                </div>

                {draft.restrict && draft.selected.size === 0 && (
                  <p style={styles.warnHint}>
                    No divisions ticked — this user will only see company-level
                    records and won't be able to create documents here.
                  </p>
                )}

                {canAssign && (
                  <button
                    type="button"
                    style={{ ...styles.saveBtn, opacity: saving ? 0.6 : 1 }}
                    disabled={saving}
                    onClick={() => save(c.companyId, c.companyName)}
                  >
                    <MdSave /> {saving ? "Saving…" : `Save ${c.companyName}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div style={formStyles.footer}>
          <button
            type="button"
            style={{ ...formStyles.button, ...formStyles.cancel }}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  helpText: {
    color: colors.textSecondary,
    fontSize: "0.85rem",
    marginTop: 0,
    marginBottom: "1rem",
    lineHeight: 1.5,
  },
  empty: {
    textAlign: "center",
    padding: "2rem 1rem",
    color: colors.textSecondary,
    fontSize: "0.9rem",
  },
  section: {
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 10,
    padding: "0.9rem",
    marginBottom: "1rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  sectionHead: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    marginBottom: "0.25rem",
  },
  companyName: {
    flex: 1,
    fontWeight: 700,
    color: colors.textPrimary,
    fontSize: "0.95rem",
    wordBreak: "break-word",
  },
  pillWarn: {
    display: "inline-block",
    padding: "0.2rem 0.55rem",
    borderRadius: 999,
    background: colors.warnLight,
    border: `1px solid ${colors.warn}`,
    color: colors.warn,
    fontSize: "0.78rem",
    fontWeight: 600,
  },
  pillMuted: {
    display: "inline-block",
    padding: "0.2rem 0.55rem",
    borderRadius: 999,
    background: colors.inputBg,
    border: `1px solid ${colors.cardBorder}`,
    color: colors.textSecondary,
    fontSize: "0.78rem",
    fontWeight: 600,
  },
  modeRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    padding: "0.6rem 0.75rem",
    minHeight: 44,
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 8,
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  modeLabel: {
    fontWeight: 600,
    color: colors.textPrimary,
    fontSize: "0.88rem",
  },
  divisionGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
    gap: "0.5rem",
    marginTop: "0.25rem",
  },
  divisionRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    padding: "0.6rem 0.75rem",
    minHeight: 44,
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 8,
    transition: "all 0.15s ease",
  },
  divisionName: {
    flex: 1,
    fontWeight: 500,
    color: colors.textPrimary,
    fontSize: "0.88rem",
    wordBreak: "break-word",
  },
  warnHint: {
    margin: 0,
    padding: "0.5rem 0.75rem",
    background: colors.warnLight,
    border: `1px solid ${colors.warn}40`,
    borderRadius: 8,
    color: colors.warn,
    fontSize: "0.8rem",
    lineHeight: 1.4,
  },
  saveBtn: {
    alignSelf: "flex-end",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.4rem",
    minHeight: 44,
    padding: "0.55rem 1rem",
    background: colors.teal,
    color: "white",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontWeight: 600,
    fontSize: "0.86rem",
  },
};

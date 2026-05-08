import { MdLock } from "react-icons/md";

// Reusable inline / block hint for "you don't have permission to do X".
// Surfaces the permission key by name so an admin can find it on
// Administration → Roles & Permissions. Used by both bill forms next
// to the inline-create buttons (New Buyer, New Item Type) when the
// caller lacks `clients.manage.create` / `itemtypes.manage.create`.
//
// Props:
//   perm     — the permission key the user needs (e.g. "clients.manage.create")
//   what     — short verb phrase ("add a new buyer", "add a new item type")
//   inline   — true → compact one-liner suitable for table footers;
//              false → full block hint suitable for an empty state.
export default function PermissionLackedHint({ perm, what, inline = false }) {
  return (
    <span
      style={inline ? styles.permHintInline : styles.permHintBlock}
      title={`Ask your admin to enable the '${perm}' permission on your role.`}
    >
      <MdLock size={inline ? 12 : 14} /> Can't {what}? You need the{" "}
      <code style={styles.permCode}>{perm}</code> permission. Ask an admin to enable it via
      <b> Administration → Roles &amp; Permissions</b>.
    </span>
  );
}

const colors = { warn: "#e65100" };
const styles = {
  permHintBlock: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
    padding: "0.45rem 0.75rem",
    borderRadius: 6,
    backgroundColor: "#fff8e1",
    border: `1px solid ${colors.warn}30`,
    color: colors.warn,
    fontSize: "0.78rem",
    lineHeight: 1.35,
    flexWrap: "wrap",
  },
  permHintInline: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    color: colors.warn,
    fontSize: "0.72rem",
    flexWrap: "wrap",
  },
  permCode: {
    fontFamily: "monospace",
    padding: "0 0.25rem",
    borderRadius: 3,
    backgroundColor: "#f5f5f5",
    fontWeight: 700,
    fontSize: "0.74rem",
  },
};

import { MdPerson, MdReceipt, MdCalendarToday, MdLocationOn, MdAssignmentTurnedIn, MdEventNote } from "react-icons/md";
import RichText from "./RichText";
import { formStyles, modalSizes } from "../theme";
import AttachmentManager from "./AttachmentManager";
import ChallanPrivateCosts from "./ChallanPrivateCosts";
import { TableWrap } from "../ui/Kit";

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : "—");

const colors = {
  blue: "var(--k-blue)",
  teal: "var(--k-teal)",
  textSecondary: "var(--k-muted)",
};

export default function ChallanModal({ challan, onClose }) {
  if (!challan) return null;

  // Backdrop click is a no-op for consistency with the rest of the app —
  // every popup dismisses via the X / Close button only.
  return (
    <div data-admin-backdrop="" style={formStyles.backdrop}>
      <div data-admin-dialog=""
        style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px`, cursor: "default" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>
            <MdReceipt size={18} style={{ marginRight: 6, verticalAlign: "middle" }} />
            Challan #{challan.challanNumber} Details
          </h5>
          <button data-admin-close="" style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>

        {/* Body */}
        <div style={formStyles.body}>
          {/* Info grid — every field the operator can set on the
              edit form is mirrored here so View matches Edit one-for-
              one. Optional fields (Indent, Site, PO Date) only render
              their tile when populated to keep the grid tidy on
              minimal-data challans. Status is always shown. */}
          <div style={styles.infoGrid}>
            <div style={styles.infoItem}>
              <MdPerson size={16} color={colors.teal} />
              <div>
                <span style={styles.infoLabel}>Client</span>
                <span style={styles.infoValue}>{challan.clientName || "—"}</span>
              </div>
            </div>
            {challan.site && (
              <div style={styles.infoItem}>
                <MdLocationOn size={16} color={colors.teal} />
                <div>
                  <span style={styles.infoLabel}>Site</span>
                  <span style={styles.infoValue}>{challan.site}</span>
                </div>
              </div>
            )}
            <div style={styles.infoItem}>
              <MdCalendarToday size={16} color={colors.textSecondary} />
              <div>
                <span style={styles.infoLabel}>Delivery Date</span>
                <span style={styles.infoValue}>{fmtDate(challan.deliveryDate)}</span>
              </div>
            </div>
            <div style={styles.infoItem}>
              <MdReceipt size={16} color={colors.blue} />
              <div>
                <span style={styles.infoLabel}>PO Number</span>
                <span style={styles.infoValue}>{challan.poNumber || "—"}</span>
              </div>
            </div>
            {challan.poDate && (
              <div style={styles.infoItem}>
                <MdEventNote size={16} color={colors.blue} />
                <div>
                  <span style={styles.infoLabel}>PO Date</span>
                  <span style={styles.infoValue}>{fmtDate(challan.poDate)}</span>
                </div>
              </div>
            )}
            {challan.indentNo && (
              <div style={styles.infoItem}>
                <MdAssignmentTurnedIn size={16} color={colors.blue} />
                <div>
                  <span style={styles.infoLabel}>Indent No</span>
                  <span style={styles.infoValue}>{challan.indentNo}</span>
                </div>
              </div>
            )}
            <div style={styles.infoItem}>
              <MdAssignmentTurnedIn size={16} color={colors.textSecondary} />
              <div>
                <span style={styles.infoLabel}>Status</span>
                <span style={styles.infoValue}>
                  {challan.status === "Invoiced" ? "Billed" : (challan.status || "—")}
                </span>
              </div>
            </div>
          </div>

          {/* Items table */}
          <div style={{ marginTop: "1.25rem" }}>
            <h6 style={{ fontWeight: 700, fontSize: "var(--k-font)", color: "var(--k-ink)", marginBottom: "0.6rem" }}>
              Items ({challan.items.length})
            </h6>
            <TableWrap data-admin-table-region="" style={styles.tableWrapper}>
              <table className="k-table k-table--compact">
                <thead>
                  <tr>
                    <th className="is-center" style={{ width: 40 }}>#</th>
                    <th style={{ width: 110 }}>Item Type</th>
                    <th>Description</th>
                    <th className="is-center" style={{ width: 70 }}>Qty</th>
                    <th className="is-center" style={{ width: 90 }}>Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {challan.items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="is-center k-muted">{idx + 1}</td>
                      <td>{item.itemTypeName || "—"}</td>
                      <td><RichText text={item.description} /></td>
                      <td className="is-center" style={{ fontWeight: 600 }}>{item.quantity}</td>
                      <td className="is-center">{item.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>

          <ChallanPrivateCosts items={challan.items} readOnly />
          {challan.notes && <div style={{ marginTop: 16 }}><strong>Notes</strong><div style={{ marginTop: 6, padding: 10, border: "1px solid var(--k-line)", borderRadius: 8 }}><RichText text={challan.notes} /></div></div>}

          {/* Attachments — read-only (preview / download only). INSIDE the
              scrollable body so it never pushes the footer off-screen. */}
          <div style={{ marginTop: "1.25rem" }}>
            <AttachmentManager companyId={challan.companyId} entityType="DeliveryChallan" entityId={challan.id} mode="view" />
          </div>
        </div>

        {/* Footer */}
        <div style={formStyles.footer}>
          <button data-admin-close=""
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
  infoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))",
    gap: "var(--k-gap)",
  },
  infoItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.5rem",
    padding: "0.75rem",
    backgroundColor: "var(--k-surface-2)",
    borderRadius: "var(--k-radius)",
    border: "1px solid var(--k-line)",
    minWidth: 0,
  },
  infoLabel: {
    display: "block",
    fontSize: "0.72rem",
    fontWeight: 600,
    color: "var(--k-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.3px",
  },
  infoValue: {
    display: "block",
    fontSize: "var(--k-font)",
    fontWeight: 600,
    color: "var(--k-ink)",
    marginTop: "0.1rem",
    overflowWrap: "anywhere",
  },
  // The items table scrolls inside its frame (sticky kit headers) and
  // horizontally on phones.
  tableWrapper: {
    maxHeight: 280,
    overflowY: "auto",
    boxShadow: "none",
  },
};

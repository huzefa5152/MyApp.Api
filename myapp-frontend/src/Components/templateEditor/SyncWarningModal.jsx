// Small confirm-style dialog. Pulls backdrop / modal / header / body / footer
// from the shared formStyles so it matches every other popup (blurred
// backdrop, centered, non-movable) and follows the selected theme. Sits at
// the standard modal z-index.
import { formStyles, modalSizes } from "../../theme";

export default function SyncWarningModal({ onConfirm, onCancel }) {
  // Backdrop click is a no-op — explicit Cancel / Continue only.
  return (
    <div data-admin-backdrop="" style={formStyles.backdrop}>
      <div data-admin-dialog=""
        style={{ ...formStyles.modal, maxWidth: `${modalSizes.sm}px` }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-warning-title"
      >
        <div style={formStyles.header}>
          <h3 id="sync-warning-title" style={formStyles.title}>Switch to Visual Editor?</h3>
        </div>
        <div style={formStyles.body}>
          <p style={styles.text}>
            This template was created in Code mode. Loading it into the Visual
            Builder may not preserve all formatting. Complex Handlebars constructs
            (nested helpers, block helpers like <code>{"{{#each}}"}</code>) will
            appear as placeholder tags.
          </p>
          <p style={styles.textSmall}>
            Your code will not be modified until you save from Visual mode.
          </p>
        </div>
        <div style={formStyles.footer}>
          <button data-admin-close="" type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" style={{ ...formStyles.button, ...formStyles.submit }} onClick={onConfirm}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  text: {
    margin: "0 0 0.5rem",
    fontSize: "var(--k-font)",
    color: "var(--k-muted)",
    lineHeight: 1.5,
  },
  textSmall: {
    margin: 0,
    fontSize: "var(--k-font-sm)",
    color: "var(--k-faint)",
    lineHeight: 1.4,
  },
};

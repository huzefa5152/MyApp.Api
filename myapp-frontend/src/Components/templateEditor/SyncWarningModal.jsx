// Small confirm-style dialog. Pulls backdrop / modal from the shared
// formStyles so it matches every other popup (blurred backdrop, centered,
// non-movable). Sits at the standard modal z-index.
import { formStyles, modalSizes } from "../../theme";

export default function SyncWarningModal({ onConfirm, onCancel }) {
  // Backdrop click is a no-op — explicit Cancel / Continue only.
  return (
    <div style={styles.overlay}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.title}>Switch to Visual Editor?</h3>
        <p style={styles.text}>
          This template was created in Code mode. Loading it into the Visual
          Builder may not preserve all formatting. Complex Handlebars constructs
          (nested helpers, block helpers like <code>{"{{#each}}"}</code>) will
          appear as placeholder tags.
        </p>
        <p style={styles.textSmall}>
          Your code will not be modified until you save from Visual mode.
        </p>
        <div style={styles.actions}>
          <button style={styles.cancelBtn} onClick={onCancel}>
            Cancel
          </button>
          <button style={styles.confirmBtn} onClick={onConfirm}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: formStyles.backdrop,
  modal: {
    ...formStyles.modal,
    maxWidth: `${modalSizes.sm}px`,
    padding: "1.5rem",
    overflow: "visible",
  },
  title: {
    margin: "0 0 0.75rem",
    fontSize: "1.1rem",
    fontWeight: 700,
    color: "#1a2332",
  },
  text: {
    margin: "0 0 0.5rem",
    fontSize: "0.88rem",
    color: "#5f6d7e",
    lineHeight: 1.5,
  },
  textSmall: {
    margin: "0 0 1.25rem",
    fontSize: "0.82rem",
    color: "#8a95a5",
    lineHeight: 1.4,
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.5rem",
  },
  cancelBtn: {
    padding: "0.5rem 1rem",
    borderRadius: 8,
    border: "1px solid #d0d7e2",
    background: "#fff",
    color: "#5f6d7e",
    fontWeight: 600,
    fontSize: "0.85rem",
    cursor: "pointer",
  },
  confirmBtn: {
    padding: "0.5rem 1rem",
    borderRadius: 8,
    border: "none",
    background: "linear-gradient(135deg, #0d47a1, #00897b)",
    color: "#fff",
    fontWeight: 600,
    fontSize: "0.85rem",
    cursor: "pointer",
  },
};

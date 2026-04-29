import { createContext, useContext, useState, useCallback, useRef } from "react";
import { MdWarning, MdDelete, MdInfo } from "react-icons/md";
// Reuse the shared backdrop / modal baseline so confirm dialogs feel
// identical to every other popup (blurred backdrop, centered, non-movable).
import { formStyles, modalSizes } from "../theme";

const ConfirmContext = createContext(null);

export function useConfirm() {
  return useContext(ConfirmContext);
}

const variants = {
  danger: { bg: "#fdeded", color: "#842029", border: "#f5c6cb", icon: <MdDelete size={28} color="#dc3545" />, btnBg: "#dc3545", btnHover: "#b02a37" },
  warning: { bg: "#fff3cd", color: "#664d03", border: "#ffecb5", icon: <MdWarning size={28} color="#fd7e14" />, btnBg: "#fd7e14", btnHover: "#e8590c" },
  info: { bg: "#cff4fc", color: "#055160", border: "#b6effb", icon: <MdInfo size={28} color="#0d6efd" />, btnBg: "#0d6efd", btnHover: "#0b5ed7" },
};

export default function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback(({ title = "Are you sure?", message = "", variant = "danger", confirmText = "Confirm", cancelText = "Cancel" } = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ title, message, variant, confirmText, cancelText });
    });
  }, []);

  const handleClose = (result) => {
    setState(null);
    resolveRef.current?.(result);
    resolveRef.current = null;
  };

  const v = state ? (variants[state.variant] || variants.danger) : null;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          // Sit slightly above the standard modal layer so a confirm-on-top-
          // of-a-modal stack still wins (e.g. "Discard unsaved changes?"
          // shown above an open Edit dialog). 1101 is just one above
          // formStyles.backdrop's 1100.
          //
          // Backdrop click is intentionally a no-op — destructive
          // confirmations should require explicit Cancel / Confirm.
          style={{ ...formStyles.backdrop, zIndex: 1101, animation: "fadeIn 0.2s ease" }}
        >
          <div
            // Smallest size tier — confirm dialogs are short by design.
            // Reuses formStyles.modal so width/border-radius/box-shadow/
            // non-movable behaviour all match the rest of the app.
            style={{ ...formStyles.modal, maxWidth: `${modalSizes.sm}px`, animation: "fadeIn 0.25s ease" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Icon header */}
            <div style={{ display: "flex", justifyContent: "center", paddingTop: 28 }}>
              <div style={{
                width: 56, height: 56, borderRadius: "50%", background: v.bg,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {v.icon}
              </div>
            </div>

            {/* Content */}
            <div style={{ padding: "16px 28px 8px", textAlign: "center" }}>
              <h3 style={{ margin: "0 0 8px", fontSize: "1.15rem", fontWeight: 700, color: "#1a2332" }}>
                {state.title}
              </h3>
              {state.message && (
                <p style={{ margin: 0, fontSize: "0.9rem", color: "#5f6d7e", lineHeight: 1.5 }}>
                  {state.message}
                </p>
              )}
            </div>

            {/* Buttons */}
            <div style={{ display: "flex", gap: 10, padding: "16px 28px 24px", justifyContent: "center" }}>
              <button
                onClick={() => handleClose(false)}
                style={{
                  flex: 1, padding: "10px 20px", borderRadius: 10, border: "1px solid #d0d7e2",
                  background: "#fff", color: "#1a2332", fontWeight: 600, fontSize: "0.9rem",
                  cursor: "pointer", transition: "background 0.15s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "#f8f9fb"}
                onMouseLeave={(e) => e.currentTarget.style.background = "#fff"}
              >
                {state.cancelText}
              </button>
              <button
                onClick={() => handleClose(true)}
                style={{
                  flex: 1, padding: "10px 20px", borderRadius: 10, border: "none",
                  background: v.btnBg, color: "#fff", fontWeight: 600, fontSize: "0.9rem",
                  cursor: "pointer", transition: "filter 0.15s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.filter = "brightness(0.9)"}
                onMouseLeave={(e) => e.currentTarget.style.filter = ""}
              >
                {state.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

import { createContext, useContext, useState, useCallback, useRef } from "react";
import { MdWarning, MdDelete, MdInfo } from "react-icons/md";
// Reuse the shared backdrop / modal baseline so confirm dialogs feel
// identical to every other popup (blurred backdrop, centered, non-movable).
import { formStyles, modalSizes } from "../theme";
import "../ui/kit.css";
import "../ui/shared-components.css";

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
  // Optional free-text capture (e.g. a void reason). Only used when the
  // caller passes an `input` option; left "" otherwise.
  const [inputValue, setInputValue] = useState("");
  const resolveRef = useRef(null);

  const confirm = useCallback(({ title = "Are you sure?", message = "", variant = "danger", confirmText = "Confirm", cancelText = "Cancel", input = null } = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setInputValue(input?.defaultValue ?? "");
      setState({ title, message, variant, confirmText, cancelText, input });
    });
  }, []);

  // Backward-compatible resolution contract:
  //   • no `input`  → resolves the plain boolean (existing callers).
  //   • with `input`→ resolves { ok, value } so an empty-but-confirmed
  //     reason isn't mistaken for a cancel (which "" would be, being falsy).
  const handleClose = (confirmed) => {
    const hadInput = !!state?.input;
    const value = inputValue;
    setState(null);
    setInputValue("");
    const resolver = resolveRef.current;
    resolveRef.current = null;
    if (hadInput) resolver?.({ ok: confirmed, value: confirmed ? value : undefined });
    else resolver?.(confirmed);
  };

  const v = state ? (variants[state.variant] || variants.danger) : null;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div data-admin-backdrop=""
          // Sit slightly above the standard modal layer so a confirm-on-top-
          // of-a-modal stack still wins (e.g. "Discard unsaved changes?"
          // shown above an open Edit dialog). 1101 is just one above
          // formStyles.backdrop's 1100.
          //
          // Backdrop click is intentionally a no-op — destructive
          // confirmations should require explicit Cancel / Confirm.
          style={{ ...formStyles.backdrop, zIndex: 1101, animation: "fadeIn 0.2s ease" }}
        >
          <div data-admin-dialog=""
            // Smallest size tier — confirm dialogs are short by design.
            // Reuses formStyles.modal so width/border-radius/box-shadow/
            // non-movable behaviour all match the rest of the app.
            style={{ ...formStyles.modal, maxWidth: `${modalSizes.sm}px`, animation: "fadeIn 0.25s ease" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Icon header */}
            <div style={{ display: "flex", justifyContent: "center", paddingTop: "var(--sc-dlg-icon-top, 28px)" }}>
              <div className="sc-dlg-icon" style={{
                width: "var(--sc-dlg-icon, 56px)", height: "var(--sc-dlg-icon, 56px)", borderRadius: "50%", background: v.bg,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {v.icon}
              </div>
            </div>

            {/* Content */}
            <div style={{ padding: "16px var(--sc-dlg-pad-x, 28px) 8px", textAlign: "center" }}>
              <h3 style={{ ...formStyles.title, margin: "0 0 8px", color: "var(--k-ink, #1a2332)" }}>
                {state.title}
              </h3>
              {state.message && (
                <p style={{ margin: 0, fontSize: "var(--sc-dlg-msg, 0.9rem)", color: "var(--k-muted, #5f6d7e)", lineHeight: 1.5 }}>
                  {state.message}
                </p>
              )}
            </div>

            {/* Optional free-text input (e.g. a void reason) */}
            {state.input && (
              <div style={{ padding: "4px var(--sc-dlg-pad-x, 28px) 0" }}>
                {state.input.label && (
                  <label style={{ ...formStyles.label, textAlign: "left" }}>
                    {state.input.label}
                  </label>
                )}
                <textarea
                  autoFocus
                  className="k-textarea"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={state.input.placeholder || ""}
                  rows={3}
                />
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: "flex", gap: 10, padding: "16px var(--sc-dlg-pad-x, 28px) var(--sc-dlg-icon-top, 24px)", justifyContent: "center" }}>
              <button data-admin-close=""
                className="k-btn k-btn--secondary sc-dlg-btn"
                onClick={() => handleClose(false)}
              >
                {state.cancelText}
              </button>
              <button
                className="k-btn sc-dlg-btn sc-dlg-btn--confirm"
                onClick={() => handleClose(true)}
                style={{ background: v.btnBg }}
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

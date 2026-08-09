import { useState, useEffect, useCallback, useRef } from "react";
import { onNotify } from "../utils/notify";

const severityColors = {
  error: { bg: "#fdeded", border: "#f5c6cb", text: "#842029", icon: "!" },
  warning: { bg: "#fff3cd", border: "#ffecb5", text: "#664d03", icon: "⚠" },
  success: { bg: "#d1e7dd", border: "#badbcc", text: "#0f5132", icon: "✓" },
  info: { bg: "#cff4fc", border: "#b6effb", text: "#055160", icon: "i" },
};

export default function NotificationProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };
  const dismiss = useCallback(() => { clearTimer(); setToast(null); }, []);

  const showToast = useCallback(({ message, severity = "error" }) => {
    // Reset any in-flight timer so a new toast always gets its full duration
    // (and an earlier toast's timer can't dismiss this one early).
    clearTimer();
    setToast({ message, severity });
    // Auto-dismiss by severity. Errors linger long enough to actually READ —
    // operators reported FBR / validate errors vanishing before they could
    // read them. Applies APP-WIDE: every toast flows through this one surface
    // (utils/notify). Manual close (× button) still works any time.
    const ms = severity === "error" ? 15000 : severity === "warning" ? 10000 : 5000;
    timerRef.current = setTimeout(() => { timerRef.current = null; setToast(null); }, ms);
  }, []);

  useEffect(() => onNotify(showToast), [showToast]);
  useEffect(() => clearTimer, []); // clear any pending timer on unmount

  const s = toast ? severityColors[toast.severity] || severityColors.error : null;

  return (
    <>
      {children}
      {toast && (
        <div
          style={{
            position: "fixed",
            top: 20,
            right: 20,
            zIndex: 9999,
            minWidth: 320,
            maxWidth: 480,
            padding: "12px 16px",
            borderRadius: 8,
            border: `1px solid ${s.border}`,
            background: s.bg,
            color: s.text,
            fontSize: "0.88rem",
            fontWeight: 500,
            boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            animation: "fadeIn 0.3s ease",
          }}
        >
          <span style={{ fontWeight: 700, fontSize: "1.1rem", lineHeight: 1 }}>{s.icon}</span>
          <span style={{ flex: 1 }}>{toast.message}</span>
          <button
            onClick={dismiss}
            style={{
              background: "none",
              border: "none",
              color: s.text,
              fontSize: "1.1rem",
              cursor: "pointer",
              padding: "0 4px",
              lineHeight: 1,
              opacity: 0.7,
            }}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}

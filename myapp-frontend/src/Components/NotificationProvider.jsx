import { useState, useEffect, useCallback } from "react";
import { onNotify } from "../utils/notify";

const severityColors = {
  error: { bg: "#fdeded", border: "#f5c6cb", text: "#842029", icon: "!" },
  warning: { bg: "#fff3cd", border: "#ffecb5", text: "#664d03", icon: "⚠" },
  success: { bg: "#d1e7dd", border: "#badbcc", text: "#0f5132", icon: "✓" },
  info: { bg: "#cff4fc", border: "#b6effb", text: "#055160", icon: "i" },
};

export default function NotificationProvider({ children }) {
  const [toast, setToast] = useState(null);

  const showToast = useCallback(({ message, severity = "error" }) => {
    setToast({ message, severity });
    setTimeout(() => setToast(null), 5000);
  }, []);

  useEffect(() => onNotify(showToast), [showToast]);

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
            onClick={() => setToast(null)}
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

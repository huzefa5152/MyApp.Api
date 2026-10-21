import { useEffect, useState } from "react";
import { getContinuityState, subscribeContinuity } from "../utils/serviceContinuity";

/**
 * Shown while the service is briefly unreachable (a pause or a dropped
 * connection). Deliberately neutral: it says the page is reconnecting and that
 * the work on it is kept — nothing about updates. A light veil stops clicks
 * from piling up meanwhile; the page underneath, and everything typed into it,
 * stays exactly as it was and carries on by itself once the service answers.
 */
const SHOW_AFTER_MS = 600;

export default function ReconnectingNotice() {
  const [paused, setPaused] = useState(getContinuityState().paused);
  const [visible, setVisible] = useState(false);

  useEffect(() => subscribeContinuity((state) => setPaused(state.paused)), []);

  useEffect(() => {
    if (!paused) { setVisible(false); return undefined; }
    const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [paused]);

  if (!paused) return null;
  return (
    <div style={s.veil} aria-hidden={!visible}>
      {visible && (
        <div role="status" aria-live="polite" style={s.card}>
          <span style={s.spinner} aria-hidden="true" />
          <div>
            <div style={s.title}>Reconnecting…</div>
            <div style={s.text}>Your work on this page is kept and will continue automatically.</div>
          </div>
        </div>
      )}
      <style>{"@keyframes rnSpin{to{transform:rotate(360deg)}}@keyframes rnIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}"}</style>
    </div>
  );
}

const s = {
  veil: {
    position: "fixed", inset: 0, zIndex: 5000, background: "rgba(246, 248, 251, 0.45)",
    display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "72px 16px 16px",
    cursor: "progress",
  },
  card: {
    display: "flex", alignItems: "center", gap: 12, maxWidth: 380, width: "100%",
    padding: "12px 16px", borderRadius: 12, background: "#fff", border: "1px solid #dce5ef",
    boxShadow: "0 10px 30px rgba(10, 22, 40, 0.12)", animation: "rnIn 180ms ease-out both",
  },
  spinner: {
    width: 18, height: 18, flexShrink: 0, borderRadius: "50%", border: "2px solid #d6e3f3",
    borderTopColor: "#0d47a1", animation: "rnSpin 800ms linear infinite",
  },
  title: { fontWeight: 700, fontSize: "0.9rem", color: "#1a2332" },
  text: { fontSize: "0.8rem", color: "#5f6d7e", lineHeight: 1.45 },
};

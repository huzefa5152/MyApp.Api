import { useCallback, useEffect, useRef, useState } from "react";
import httpClient from "../api/httpClient";
import { useAuth } from "../contexts/AuthContext";
import { notify } from "../utils/notify";

const panel = { background: "white", border: "1px solid #e1e7ef", borderRadius: 12, padding: "1rem", minWidth: 0 };
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", gap: "0.8rem" };
const button = { minHeight: 44, padding: "0.5rem 0.8rem", boxShadow: "none" };
const date = value => value ? new Date(value.endsWith("Z") ? value : `${value}Z`).toLocaleString() : "Unknown";
function device(agent) {
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Other browser";
  const os = /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Windows/.test(agent) ? "Windows" : /Macintosh/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "Unknown system";
  return `${browser} · ${os}`;
}
export default function UserSessionsPanel() {
  const { user } = useAuth();
  const requestId = useRef(0);
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("signed-in");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const enabled = user?.isSeedAdmin === true;
  const load = useCallback(async () => {
    if (!enabled) return;
    const id = ++requestId.current;
    try {
      const response = await httpClient.get("/user-sessions", { params: { page, pageSize: 25, status, search: query } });
      if (id === requestId.current) { setData(response.data); setError(""); }
    } catch { if (id === requestId.current) { setData(null); setError("Could not load sessions. Please refresh."); } }
  }, [enabled, page, status, query]);
  useEffect(() => {
    if (!enabled) return;
    setData(null);
    let cancelled = false;
    // Poll only while this screen is visible; requests never overlap.
    const poll = async () => { if (document.visibilityState === "visible") await load(); if (!cancelled) timer = setTimeout(poll, 30000); };
    let timer; poll();
    return () => { cancelled = true; requestId.current++; clearTimeout(timer); };
  }, [enabled, load]);
  if (!enabled) return null;
  const revoke = async (session, all) => {
    if (!window.confirm(all ? `Sign out every device for ${session.username}?${session.userId === user.id ? " This includes your current session." : ""}` : `Sign out this device for ${session.username}?${session.isCurrentSession ? " This is your current session." : ""}`)) return;
    setBusy(true);
    try {
      await httpClient.post(all ? `/user-sessions/user/${session.userId}/revoke` : `/user-sessions/${session.id}/revoke`);
      notify("Session access revoked.", "success");
      await load();
    } catch { notify("Could not revoke session. Refresh to check its status.", "error"); }
    finally { setBusy(false); }
  };
  const metrics = data?.summary;
  return <section style={{ ...panel, marginBottom: "1.2rem" }} aria-label="User sessions and devices">
    <h2 style={{ fontSize: "1.25rem" }}>User sessions &amp; devices</h2>
    <p>Seed admin only. “Recently active” means an authenticated request in the last five minutes. A session represents a browser login, not a unique physical device.</p>
    <p>Browser details are reported by the device. Older logins appear here after sign-in or automatic session renewal.</p>
    {metrics && <div style={grid}>{[
      ["Total users", metrics.totalUsers], ["Signed-in users", metrics.signedInUsers], ["Signed-in browser sessions", metrics.signedInSessions],
      ["Recently active users", metrics.recentlyActiveUsers], ["Recently active sessions", metrics.recentlyActiveSessions]
    ].map(([label, value]) => <div key={label} style={panel}><div>{label}</div><strong style={{ fontSize: "1.6rem", color: "#0d47a1" }}>{value}</strong></div>)}</div>}
    <form onSubmit={e => { e.preventDefault(); setPage(1); setQuery(search.trim()); }} style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", margin: "1rem 0" }}>
      <input aria-label="Search session users" placeholder="Search user name" maxLength={100} value={search} onChange={e => setSearch(e.target.value)} style={{ flex: "1 1 180px", minWidth: 0, minHeight: 44 }} />
      <select aria-label="Session status" value={status} onChange={e => { setPage(1); setStatus(e.target.value); }} style={{ minHeight: 44, maxWidth: "100%" }}>
        <option value="signed-in">Signed in</option><option value="recent">Recently active</option><option value="expired">Expired</option><option value="revoked">Revoked</option><option value="all">All sessions</option>
      </select>
      <button style={button} type="submit">Search</button><button style={button} type="button" onClick={load}>Refresh</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p>Loading sessions…</p>}
    {data && <>
      <p>{data.total} matching sessions · Updated {date(data.observedAt)}</p>
      <div style={grid}>{data.items.map(session => <article key={session.id} style={{ ...panel, overflowWrap: "anywhere" }}>
        <strong>{session.fullName}</strong><div>@{session.username}</div>
        <p><strong>{session.status}</strong>{session.isCurrentSession && " · This session"}</p>
        <div>{device(session.userAgent || "")}</div>
        <div>Observed network address: {session.ipAddress || "Unknown"}</div>
        <div>Signed in: {date(session.createdAt)}</div><div>Last activity: {date(session.lastSeenAt)}</div>
        <div>Session ends: {date(session.expiresAt)}</div>
        {session.revokedAt && <div>Revoked: {date(session.revokedAt)}</div>}
        <details><summary>Browser details</summary><p>{session.userAgent || "Not recorded"}</p></details>
        {["Signed in", "Recently active"].includes(session.status) && <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.8rem" }}>
          <button style={button} disabled={busy} onClick={() => revoke(session, false)}>Sign out device</button>
          <button style={button} disabled={busy} onClick={() => revoke(session, true)}>Sign out all user devices</button>
        </div>}
      </article>)}</div>
      {data.items.length === 0 && <p>No sessions match these filters.</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center", marginTop: "1rem" }}>
        <button style={button} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
        <span>Page {page}</span><button style={button} disabled={page * data.pageSize >= data.total} onClick={() => setPage(p => p + 1)}>Next</button>
      </div>
    </>}
  </section>;
}

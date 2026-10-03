import { useCallback, useEffect, useRef, useState } from "react";
import {
  MdDevices, MdRefresh, MdPeople, MdLogin, MdBolt, MdLogout, MdLaptop, MdPhoneAndroid, MdChevronLeft, MdChevronRight,
} from "react-icons/md";
import httpClient from "../api/httpClient";
import { useAuth } from "../contexts/AuthContext";
import { useConfirm } from "./ConfirmDialog";
import { notify } from "../utils/notify";
import { colors, cardStyles } from "../theme";
import { Button, IconButton, Toolbar, SearchBox, StatGrid, StatCard, TableWrap, Loading, EmptyState, Alert } from "../ui/Kit";

// Seed-admin console: who is signed in, from which browser, and the means to
// end a session. The API is seed-admin only; this panel renders nothing for
// anyone else. A session is a browser login, not a physical device.

// The ERP sidebar takes ~240px of the viewport, so the table needs a wider
// breakpoint than the page-level 760px: below it, cards.
const NARROW = 980;
const STATUS_TONE = {
  "Recently active": { bg: "#eafbef", fg: "#1b6e34", dot: "#28a745" },
  "Signed in": { bg: "#e7f0fb", fg: "#0d47a1", dot: "#1565c0" },
  Expired: { bg: "#eef1f5", fg: "#5f6d7e", dot: "#9aa6b5" },
  Revoked: { bg: "#fff0f1", fg: "#a52834", dot: "#dc3545" },
};
const FILTERS = [
  ["signed-in", "Signed in"], ["recent", "Active now"], ["expired", "Expired"], ["revoked", "Revoked"], ["all", "All"],
];

const asDate = value => value ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`) : null;
const absolute = value => { const d = asDate(value); return d ? d.toLocaleString() : "Unknown"; };
function relative(value) {
  const d = asDate(value);
  if (!d) return "Unknown";
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return d.toLocaleDateString();
}
function device(agent = "") {
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Other browser";
  const os = /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Windows/.test(agent) ? "Windows" : /Macintosh/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "Unknown system";
  return { browser, os, mobile: /Android|iPhone|iPad|Mobile/.test(agent) };
}
function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < NARROW);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < NARROW);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return narrow;
}

function StatusBadge({ status }) {
  const tone = STATUS_TONE[status] || STATUS_TONE.Expired;
  return <span style={{ ...s.badge, background: tone.bg, color: tone.fg }}>
    <span style={{ ...s.dot, background: tone.dot }} />{status}
  </span>;
}

function DeviceCell({ session }) {
  const d = device(session.userAgent || "");
  const Icon = d.mobile ? MdPhoneAndroid : MdLaptop;
  return <div style={s.deviceCell} title={session.userAgent || "Browser details not recorded"}>
    <Icon style={s.deviceIcon} aria-hidden />
    <div style={{ minWidth: 0 }}>
      <div style={s.strong}>{d.browser} · {d.os}</div>
      <div style={s.muted}>{session.ipAddress || "Address unknown"}</div>
    </div>
  </div>;
}

export default function UserSessionsPanel() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const narrow = useNarrow();
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
    } catch { if (id === requestId.current) { setData(null); setError("Could not load sessions."); } }
  }, [enabled, page, status, query]);

  useEffect(() => {
    if (!enabled) return;
    setData(null);
    let cancelled = false;
    let timer;
    // The first load always runs; later refreshes poll only while the page is
    // visible, and requests never overlap.
    let first = true;
    const poll = async () => {
      if (first || document.visibilityState === "visible") await load();
      first = false;
      if (!cancelled) timer = setTimeout(poll, 30000);
    };
    poll();
    return () => { cancelled = true; requestId.current++; clearTimeout(timer); };
  }, [enabled, load]);

  if (!enabled) return null;

  const revoke = async (session, all) => {
    const own = all ? session.userId === user.id : session.isCurrentSession;
    const d = device(session.userAgent || "");
    const ok = await confirm({
      title: all ? "Sign out every device?" : "Sign out this device?",
      message: all
        ? `${session.fullName || session.username} (@${session.username}) will be signed out everywhere and must sign in again.${own ? " This includes your current session." : ""}`
        : `${d.browser} on ${d.os} for @${session.username} will be signed out.${own ? " This is your current session." : ""}`,
      variant: "danger",
      confirmText: all ? "Sign out all" : "Sign out",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await httpClient.post(all ? `/user-sessions/user/${session.userId}/revoke` : `/user-sessions/${session.id}/revoke`);
      notify(all ? "All sessions for this user signed out." : "Device signed out.", "success");
      await load();
    } catch { notify("Could not sign out. Refresh to check the session's status.", "error"); }
    finally { setBusy(false); }
  };

  const m = data?.summary;
  const kpis = m ? [
    [MdPeople, "Total users", m.totalUsers],
    [MdLogin, "Signed-in users", m.signedInUsers],
    [MdDevices, "Browser sessions", m.signedInSessions],
    [MdBolt, "Active now · users", m.recentlyActiveUsers],
    [MdBolt, "Active now · sessions", m.recentlyActiveSessions],
  ] : [];
  const from = data && data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(data.page * data.pageSize, data.total) : 0;
  const live = session => ["Signed in", "Recently active"].includes(session.status);

  const actions = session => live(session) && <div style={s.actions}>
    <Button size="sm" variant="danger" icon={MdLogout} disabled={busy} title="Sign out this device" onClick={() => revoke(session, false)}>Sign out</Button>
    <Button size="sm" disabled={busy} title="Sign out every device this user is signed in on" onClick={() => revoke(session, true)}>Sign out all</Button>
  </div>;

  return <section style={s.wrap} aria-label="User sessions and devices">
    <div style={s.head}>
      <div style={s.headLeft}>
        <span className="k-header__icon k-tone-brand" aria-hidden="true"><MdDevices /></span>
        <div style={{ minWidth: 0 }}>
          <h3 style={s.title}>Sessions &amp; devices</h3>
          <p style={s.sub}>Who is signed in, from which browser, and when they were last active. Visible to the primary admin only.</p>
        </div>
      </div>
      <div style={s.headRight}>
        <span style={s.muted}>{data ? `Updated ${relative(data.observedAt)} · refreshes every 30 s` : "Loading…"}</span>
        <IconButton label="Refresh sessions" icon={MdRefresh} onClick={load} />
      </div>
    </div>

    {m && <StatGrid>{kpis.map(([Icon, label, value]) => <StatCard key={label} icon={Icon} label={label} value={value} tone="blue" />)}</StatGrid>}

    <Toolbar>
      <form onSubmit={e => { e.preventDefault(); setPage(1); setQuery(search.trim()); }} style={s.searchForm}>
        <SearchBox label="Search session users" placeholder="Search by name or username, press Enter" maxLength={100} value={search}
          onChange={setSearch} />
      </form>
      <div style={s.pills} role="group" aria-label="Session status">
        {FILTERS.map(([key, label]) => <Button key={key} size="sm" variant={status === key ? "primary" : "secondary"} aria-pressed={status === key}
          onClick={() => { setPage(1); setStatus(key); }}>{label}</Button>)}
      </div>
    </Toolbar>

    {error && <Alert tone="error">{error} <button type="button" style={s.link} onClick={load}>Try again</button></Alert>}
    {!data && !error && <Loading>Loading sessions…</Loading>}
    {data && data.items.length === 0 && <EmptyState icon={MdDevices}>No sessions match these filters.</EmptyState>}

    {data && data.items.length > 0 && (narrow
      ? <div style={s.cards}>{data.items.map(session => <article key={session.id} className="k-card" style={s.card}>
          <div style={s.cardTop}>
            <div style={{ minWidth: 0 }}>
              <div style={s.strong}>{session.fullName || session.username}</div>
              <div style={s.muted}>@{session.username}</div>
            </div>
            <StatusBadge status={session.status} />
          </div>
          {session.isCurrentSession && <span style={s.you}>This session</span>}
          <DeviceCell session={session} />
          <div style={s.metaGrid}>
            <div><span style={s.metaLabel}>Signed in</span><span style={s.metaValue} title={absolute(session.createdAt)}>{relative(session.createdAt)}</span></div>
            <div><span style={s.metaLabel}>Last activity</span><span style={s.metaValue} title={absolute(session.lastSeenAt)}>{relative(session.lastSeenAt)}</span></div>
            <div><span style={s.metaLabel}>{session.revokedAt ? "Revoked" : "Session ends"}</span><span style={s.metaValue}>{absolute(session.revokedAt || session.expiresAt)}</span></div>
          </div>
          <details><summary style={s.muted}>Browser details</summary><p style={{ ...s.muted, overflowWrap: "anywhere" }}>{session.userAgent || "Not recorded"}</p></details>
          {actions(session)}
        </article>)}</div>
      : <TableWrap><table className="k-table">
          <thead><tr>{["User", "Device", "Status", "Signed in", "Last activity", "Session ends", ""].map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{data.items.map(session => <tr key={session.id}>
            <td>
              <div style={s.strong}>{session.fullName || session.username}</div>
              <div style={s.muted}>@{session.username}{session.isCurrentSession && <span style={{ ...s.you, marginLeft: 8 }}>This session</span>}</div>
            </td>
            <td><DeviceCell session={session} /></td>
            <td><StatusBadge status={session.status} /></td>
            <td style={{ whiteSpace: "nowrap" }} title={absolute(session.createdAt)}>{relative(session.createdAt)}</td>
            <td style={{ whiteSpace: "nowrap" }} title={absolute(session.lastSeenAt)}>{relative(session.lastSeenAt)}</td>
            <td title={session.revokedAt ? `Revoked ${absolute(session.revokedAt)}` : undefined}>{absolute(session.expiresAt)}</td>
            <td className="k-actions">{actions(session)}</td>
          </tr>)}</tbody>
        </table></TableWrap>)}

    {data && data.total > 0 && <div style={s.pager}>
      <span style={s.muted}>{from}–{to} of {data.total}</span>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <IconButton label="Previous page" icon={MdChevronLeft} size={22} disabled={page <= 1} onClick={() => setPage(p => p - 1)} />
        <IconButton label="Next page" icon={MdChevronRight} size={22} disabled={page * data.pageSize >= data.total} onClick={() => setPage(p => p + 1)} />
      </div>
    </div>}
  </section>;
}

const s = {
  wrap: { minWidth: 0 },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.8rem", marginBottom: "var(--k-header-mb)" },
  headLeft: { display: "flex", alignItems: "center", gap: "0.9rem", minWidth: 0, flex: "1 1 320px" },
  title: { margin: 0, fontSize: "calc(var(--k-title) - 0.3rem)", fontWeight: 700, color: "var(--k-ink)" },
  sub: { margin: "0.15rem 0 0", fontSize: "var(--k-sub)", color: "var(--k-muted)", lineHeight: 1.45 },
  headRight: { display: "flex", alignItems: "center", gap: "0.6rem" },
  searchForm: { display: "flex", flex: "1 1 240px", minWidth: 0 },
  pills: { display: "flex", flexWrap: "wrap", gap: "0.4rem" },
  badge: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.2rem 0.65rem", borderRadius: 999, fontSize: "0.74rem", fontWeight: 700, whiteSpace: "nowrap" },
  dot: { width: 7, height: 7, borderRadius: "50%", display: "inline-block" },
  you: { display: "inline-block", padding: "0.1rem 0.5rem", borderRadius: 6, fontSize: "0.68rem", fontWeight: 700, color: colors.tealDark, background: "rgba(0,137,123,0.12)" },
  strong: { fontSize: "var(--k-font)", fontWeight: 700, color: "var(--k-ink)", overflowWrap: "break-word" },
  muted: { fontSize: "var(--k-font-sm)", color: "var(--k-muted)" },
  deviceCell: { display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 },
  deviceIcon: { fontSize: "1.5rem", color: "var(--k-muted)", flexShrink: 0 },
  actions: { display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "flex-end", whiteSpace: "nowrap" },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: "0.8rem" },
  card: { marginTop: 0, padding: "var(--k-card-pad)", display: "grid", gap: "0.7rem", minWidth: 0 },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.6rem" },
  metaGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(130px, 100%), 1fr))", gap: "0.5rem 1rem" },
  metaLabel: cardStyles.metaLabel,
  metaValue: cardStyles.metaValue,
  pager: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.8rem", marginTop: "1rem" },
  link: { background: "none", border: "none", padding: 0, margin: 0, boxShadow: "none", color: colors.blue, fontWeight: 700, textDecoration: "underline", cursor: "pointer", minHeight: 0, fontSize: "inherit" },
};

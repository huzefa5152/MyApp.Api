import { useCallback, useEffect, useRef, useState } from "react";
import {
  MdSmartToy, MdAdd, MdRefresh, MdClose, MdContentCopy, MdBlock, MdChevronLeft, MdChevronRight, MdVpnKey, MdHistory,
} from "react-icons/md";
import httpClient from "../api/httpClient";
import { getUsers } from "../api/usersApi";
import { useAuth } from "../contexts/AuthContext";
import { useConfirm } from "./ConfirmDialog";
import { notify } from "../utils/notify";
import { SCOPE_INFO, orderedScopes } from "../utils/mcpScopes";
import AllCompaniesOption from "./AllCompaniesOption";
import { colors, cardStyles, formStyles, modalSizes } from "../theme";

// Seed-admin console for AI agents (Codex, Claude, automations) connected through
// the hosted MCP endpoint: create and revoke per-agent tokens, and read the
// append-only activity log of everything the agents did. Renders nothing for
// anyone but the primary admin; the API refuses them too.

const NARROW = 980;
const TOKEN_TONE = {
  Active: { bg: "#eafbef", fg: "#1b6e34", dot: "#28a745" },
  Expired: { bg: "#eef1f5", fg: "#5f6d7e", dot: "#9aa6b5" },
  Revoked: { bg: "#fff0f1", fg: "#a52834", dot: "#dc3545" },
};
const OUTCOME_TONE = {
  ok: { bg: "#eafbef", fg: "#1b6e34", dot: "#28a745", label: "Done" },
  denied: { bg: "#fff4e5", fg: "#8a4b00", dot: "#fd7e14", label: "Refused" },
  error: { bg: "#fff0f1", fg: "#a52834", dot: "#dc3545", label: "Failed" },
};
const OUTCOMES = [["", "All"], ["ok", "Done"], ["denied", "Refused"], ["error", "Failed"]];

const asDate = v => v ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`) : null;
const absolute = v => { const d = asDate(v); return d ? d.toLocaleString() : "Never"; };
function relative(v) {
  const d = asDate(v);
  if (!d) return "Never";
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return d.toLocaleDateString();
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
const Badge = ({ tone, children }) => <span style={{ ...s.badge, background: tone.bg, color: tone.fg }}>
  <span style={{ ...s.dot, background: tone.dot }} />{children}</span>;

function NewTokenDialog({ onClose, onCreated }) {
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState("");
  const [companies, setCompanies] = useState([]);
  const [available, setAvailable] = useState(["read"]);
  const [meta, setMeta] = useState({ canUseAllCompanies: false, maxLifetimeDays: 90 });
  const [all, setAll] = useState(false);
  const [scopes, setScopes] = useState(["read"]);
  const [picked, setPicked] = useState([]);
  const [name, setName] = useState("");
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { getUsers().then(r => setUsers(r.data)).catch(() => setError("Could not load users.")); }, []);
  useEffect(() => {
    setPicked([]); setCompanies([]); setAvailable(["read"]); setScopes(["read"]); setAll(false); setMeta({ canUseAllCompanies: false, maxLifetimeDays: 90 });
    if (!userId) return;
    let live = true;
    httpClient.get(`/mcp-admin/eligibility/${userId}`).then(r => {
      if (live) { setCompanies(r.data.companies.map(c => ({ companyId: c.id, companyName: c.name }))); setAvailable(r.data.scopesAvailable); setMeta({ canUseAllCompanies: r.data.canUseAllCompanies, maxLifetimeDays: r.data.maxLifetimeDays }); setDays(d => Math.min(Number(d), r.data.maxLifetimeDays)); }
    }).catch(() => live && setError("Could not load that user's companies."));
    return () => { live = false; };
  }, [userId]);

  const toggle = id => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const toggleScope = k => setScopes(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k]);
  const submit = async e => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const r = await httpClient.post("/mcp-admin/tokens", { userId: Number(userId), name, companyIds: all ? [] : picked, allCompanies: all, scopes, expiresInDays: Number(days) });
      onCreated(r.data);
    } catch (err) { setError(err.response?.data?.message || "Could not create the token."); }
    finally { setBusy(false); }
  };
  const valid = userId && name.trim() && (all || picked.length > 0);
  return <div data-admin-backdrop="" style={formStyles.backdrop}>
    <form data-admin-dialog="" style={{ ...formStyles.modal, maxWidth: modalSizes.md }} onSubmit={submit}>
      <div data-admin-header="" style={formStyles.header}>
        <h3 style={formStyles.title}>New agent token</h3>
        <button data-admin-close="" type="button" style={formStyles.closeButton} onClick={onClose} aria-label="Close"><MdClose /></button>
      </div>
      <div data-admin-body="" style={formStyles.body}>
        <p style={s.sub}>The token acts as one user, only in the companies you tick, and never beyond what that user may do. Every write is shown to a person to approve first.</p>
        <label style={s.label}>Agent name</label>
        <input style={s.input} value={name} maxLength={100} placeholder="e.g. Codex on my laptop" onChange={e => setName(e.target.value)} />
        <label style={s.label}>Runs as user</label>
        <select style={s.input} value={userId} onChange={e => setUserId(e.target.value)}>
          <option value="">Choose a dedicated agent user…</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.fullName} (@{u.username})</option>)}
        </select>
        <p style={s.hint}>The user needs the MCP Access role. The primary admin is allowed and can span every tenant.</p>
        <label style={s.label}>Companies the agent may reach</label>
        {!userId && <p style={s.hint}>Choose a user first.</p>}
        {userId && meta.canUseAllCompanies && <AllCompaniesOption checked={all} onChange={setAll} />}
        {userId && companies.length === 0 && !all && <p style={s.hint}>That user has no company access yet.</p>}
        {!all && <div style={s.checks}>{companies.map(c => <label key={c.companyId} style={{ ...s.check, ...(picked.includes(c.companyId) ? s.checkOn : {}) }}>
          <input type="checkbox" checked={picked.includes(c.companyId)} onChange={() => toggle(c.companyId)} /> {c.companyName}
        </label>)}</div>}
        <label style={s.label}>What it may do</label>
        <div style={s.scopes}>{orderedScopes(available).map(k => <label key={k} style={{ ...s.scope, ...(scopes.includes(k) ? s.checkOn : {}) }}>
          <input type="checkbox" checked={scopes.includes(k)} disabled={k === "read"} onChange={() => toggleScope(k)} />
          <span><strong>{SCOPE_INFO[k].label}</strong><span style={s.scopeHelp}>{SCOPE_INFO[k].help}</span></span></label>)}</div>
        {userId && available.length === 1 && <p style={s.hint}>This user has no write access. Assign the MCP Write role to let their agents create records.</p>}
        <label style={s.label}>Expires after</label>
        <select style={s.input} value={days} onChange={e => setDays(e.target.value)}>
          {[...[7, 30, 60, 90].filter(d => d < meta.maxLifetimeDays), meta.maxLifetimeDays].map(d => [d, d === meta.maxLifetimeDays ? `${d} days (maximum)` : `${d} days`]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {error && <div role="alert" style={s.alert}>{error}</div>}
      </div>
      <div style={s.foot}>
        <button data-admin-close="" type="button" style={s.ghost} onClick={onClose}>Cancel</button>
        <button type="submit" style={{ ...s.primary, opacity: valid && !busy ? 1 : 0.55 }} disabled={!valid || busy}>Create token</button>
      </div>
    </form>
  </div>;
}

export function SecretDialog({ created, onClose }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://<your-site>";
  const toml = `[mcp_servers.erp]\nurl = "${origin}/mcp"\nbearer_token_env_var = "ERP_MCP_TOKEN"`;
  const copy = async (text, what) => { try { await navigator.clipboard.writeText(text); notify(`${what} copied.`, "success"); } catch { notify("Copy failed. Select the text and copy it by hand.", "error"); } };
  return <div data-admin-backdrop="" style={formStyles.backdrop}>
    <div data-admin-dialog="" style={{ ...formStyles.modal, maxWidth: modalSizes.md }} role="dialog" aria-label="Agent token created">
      <div data-admin-header="" style={formStyles.header}><h3 style={formStyles.title}>Copy your token now</h3></div>
      <div data-admin-body="" style={formStyles.body}>
        <div style={s.warn}>This is the only time the token is shown. It is stored as a hash and cannot be recovered. If you lose it, revoke it and create another.</div>
        <label style={s.label}>Token for “{created.name}”</label>
        <div style={s.secretRow}><code style={s.code}>{created.secret}</code>
          <button type="button" style={s.iconBtn} onClick={() => copy(created.secret, "Token")} aria-label="Copy token"><MdContentCopy /></button></div>
        <label style={s.label}>Codex: put the token in the environment, then add this to ~/.codex/config.toml</label>
        <div style={s.secretRow}><pre style={{ ...s.code, margin: 0, whiteSpace: "pre-wrap" }}>{toml}</pre>
          <button type="button" style={s.iconBtn} onClick={() => copy(toml, "Config")} aria-label="Copy config"><MdContentCopy /></button></div>
        <p style={s.hint}>Set <code>ERP_MCP_TOKEN</code> to the token above in your user environment. Expires {absolute(created.expiresAt)}.</p>
      </div>
      <div style={s.foot}><button data-admin-close="" type="button" style={s.primary} onClick={onClose}>I have copied it</button></div>
    </div>
  </div>;
}

export default function McpAgentsPanel() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const narrow = useNarrow();
  const enabled = user?.isSeedAdmin === true;
  const reqId = useRef(0);
  const [tokens, setTokens] = useState(null);
  const [tokenError, setTokenError] = useState("");
  const [activity, setActivity] = useState(null);
  const [actError, setActError] = useState("");
  const [outcome, setOutcome] = useState("");
  const [tokenFilter, setTokenFilter] = useState("");
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadTokens = useCallback(async () => {
    try { setTokens((await httpClient.get("/mcp-admin/tokens")).data); setTokenError(""); }
    catch { setTokens(null); setTokenError("Could not load agent tokens."); }
  }, []);
  const loadActivity = useCallback(async () => {
    const id = ++reqId.current;
    try {
      const r = await httpClient.get("/mcp-admin/activity", { params: { page, pageSize: 25, outcome, tokenId: tokenFilter || undefined } });
      if (id === reqId.current) { setActivity(r.data); setActError(""); }
    } catch { if (id === reqId.current) { setActivity(null); setActError("Could not load activity."); } }
  }, [page, outcome, tokenFilter]);

  useEffect(() => { if (enabled) loadTokens(); }, [enabled, loadTokens]);
  useEffect(() => { if (enabled) loadActivity(); }, [enabled, loadActivity]);
  if (!enabled) return null;

  const revoke = async t => {
    const ok = await confirm({
      title: "Revoke this agent token?",
      message: `“${t.name}” (runs as @${t.username}) stops working on its next call. Its activity history is kept.`,
      variant: "danger", confirmText: "Revoke",
    });
    if (!ok) return;
    setBusy(true);
    try { await httpClient.post(`/mcp-admin/tokens/${t.id}/revoke`); notify("Agent token revoked.", "success"); await loadTokens(); await loadActivity(); }
    catch { notify("Could not revoke. Refresh to check its status.", "error"); }
    finally { setBusy(false); }
  };

  const refresh = () => { loadTokens(); loadActivity(); };
  const from = activity && activity.total ? (activity.page - 1) * activity.pageSize + 1 : 0;
  const to = activity ? Math.min(activity.page * activity.pageSize, activity.total) : 0;
  const chips = t => [...(t.allCompanies ? [<span key="all" style={{ ...s.chip, color: "#8a4b00", background: "#fff4e5" }}>All companies</span>] : t.companies.map(c => <span key={`c${c.id}`} style={s.chip}>{c.name}</span>)),
    ...t.scopes.filter(x => x !== "read").map(x => <span key={x} style={{ ...s.chip, color: "#8a4b00", background: "#fff4e5" }}>{x}</span>)];
  const revokeBtn = t => t.status === "Active" && <button style={s.danger} disabled={busy} onClick={() => revoke(t)}><MdBlock aria-hidden /> Revoke</button>;

  return <section style={{ minWidth: 0 }} aria-label="AI agents">
    <div style={s.head}>
      <div style={s.headLeft}>
        <div style={s.headIcon}><MdSmartToy style={{ fontSize: "1.4rem", color: "#fff" }} /></div>
        <div>
          <h3 style={s.title}>AI agents</h3>
          <p style={s.sub}>Tokens for Codex, Claude and automations connected through MCP, and a permanent record of what they did. Primary admin only.</p>
        </div>
      </div>
      <div style={s.headRight}>
        <button style={s.iconBtn} onClick={refresh} aria-label="Refresh" title="Refresh"><MdRefresh /></button>
        <button style={s.primary} onClick={() => setShowNew(true)}><MdAdd aria-hidden /> New token</button>
      </div>
    </div>

    <h4 style={s.h4}><MdVpnKey aria-hidden /> Agent tokens</h4>
    {tokenError && <div role="alert" style={s.alert}>{tokenError}</div>}
    {!tokens && !tokenError && <div style={s.empty}>Loading…</div>}
    {tokens && tokens.length === 0 && <div style={s.empty}>No agent tokens yet. Create one to connect Codex or Claude.</div>}
    {tokens && tokens.length > 0 && (narrow
      ? <div style={s.cards}>{tokens.map(t => <article key={t.id} style={s.card}>
          <div style={s.cardTop}><div style={{ minWidth: 0 }}><div style={s.strong}>{t.name}</div><div style={s.muted}>@{t.username} · <code>{t.hint}…</code></div></div>
            <Badge tone={TOKEN_TONE[t.status]}>{t.status}</Badge></div>
          <div style={s.chips}>{chips(t)}</div>
          <div style={s.metaGrid}>
            <div><span style={s.metaLabel}>Last used</span><span style={s.metaValue} title={absolute(t.lastUsedAt)}>{relative(t.lastUsedAt)}</span></div>
            <div><span style={s.metaLabel}>Expires</span><span style={s.metaValue}>{absolute(t.expiresAt)}</span></div>
          </div>
          {revokeBtn(t)}
        </article>)}</div>
      : <div data-admin-table-region="" style={s.tableWrap}><table style={s.table}>
          <thead><tr>{["Agent", "Runs as", "Companies", "Status", "Last used", "Expires", ""].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>{tokens.map(t => <tr key={t.id} style={s.tr}>
            <td style={s.td}><div style={s.strong}>{t.name}</div><div style={s.muted}><code>{t.hint}…</code></div></td>
            <td style={s.td}><div style={s.strong}>{t.fullName}</div><div style={s.muted}>@{t.username}</div></td>
            <td style={s.td}><div style={s.chips}>{chips(t)}</div></td>
            <td style={s.td}><Badge tone={TOKEN_TONE[t.status]}>{t.status}</Badge></td>
            <td style={{ ...s.td, whiteSpace: "nowrap" }} title={absolute(t.lastUsedAt)}>{relative(t.lastUsedAt)}</td>
            <td style={s.td}>{absolute(t.expiresAt)}</td>
            <td style={{ ...s.td, textAlign: "right" }}>{revokeBtn(t)}</td>
          </tr>)}</tbody>
        </table></div>)}

    <h4 style={{ ...s.h4, marginTop: "1.6rem" }}><MdHistory aria-hidden /> Activity</h4>
    <div style={s.toolbar}>
      <div style={s.pills} role="group" aria-label="Outcome">
        {OUTCOMES.map(([k, l]) => <button key={k || "all"} type="button" aria-pressed={outcome === k}
          style={{ ...s.pill, ...(outcome === k ? s.pillOn : {}) }} onClick={() => { setPage(1); setOutcome(k); }}>{l}</button>)}
      </div>
      <select aria-label="Filter by agent" style={{ ...s.input, maxWidth: 260, margin: 0 }} value={tokenFilter} onChange={e => { setPage(1); setTokenFilter(e.target.value); }}>
        <option value="">All agents</option>
        {(tokens || []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </div>
    {actError && <div role="alert" style={s.alert}>{actError}</div>}
    {!activity && !actError && <div style={s.empty}>Loading…</div>}
    {activity && activity.items.length === 0 && <div style={s.empty}>No agent activity matches these filters.</div>}
    {activity && activity.items.length > 0 && (narrow
      ? <div style={s.cards}>{activity.items.map(a => <article key={a.id} style={s.card}>
          <div style={s.cardTop}><div style={{ minWidth: 0 }}><div style={s.strong}>{a.tool}</div><div style={s.muted}>{a.agentName || "Login session"} · @{a.username}</div></div>
            <Badge tone={OUTCOME_TONE[a.outcome] || OUTCOME_TONE.error}>{(OUTCOME_TONE[a.outcome] || OUTCOME_TONE.error).label}</Badge></div>
          {a.detail && <div style={s.muted}>{a.detail}</div>}
          {a.resultRef && a.resultRef !== "FAILED" && <div><span style={s.chip}>{a.resultRef}</span></div>}
          <div style={s.metaGrid}>
            <div><span style={s.metaLabel}>When</span><span style={s.metaValue} title={absolute(a.at)}>{relative(a.at)}</span></div>
            <div><span style={s.metaLabel}>Company</span><span style={s.metaValue}>{a.companyId ?? "—"}</span></div>
            <div><span style={s.metaLabel}>Time</span><span style={s.metaValue}>{a.durationMs} ms</span></div>
          </div>
          {a.arguments && <details><summary style={s.muted}>Arguments</summary><pre style={s.pre}>{a.arguments}</pre></details>}
        </article>)}</div>
      : <div data-admin-table-region="" style={s.tableWrap}><table style={s.table}>
          <thead><tr>{["When", "Agent", "Tool", "Company", "Result", "Details"].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>{activity.items.map(a => <tr key={a.id} style={s.tr}>
            <td style={{ ...s.td, whiteSpace: "nowrap" }} title={absolute(a.at)}>{relative(a.at)}</td>
            <td style={s.td}><div style={s.strong}>{a.agentName || "Login session"}</div><div style={s.muted}>@{a.username}</div></td>
            <td style={s.td}><code>{a.tool}</code></td>
            <td style={s.td}>{a.companyId ?? "—"}</td>
            <td style={s.td}><Badge tone={OUTCOME_TONE[a.outcome] || OUTCOME_TONE.error}>{(OUTCOME_TONE[a.outcome] || OUTCOME_TONE.error).label}</Badge></td>
            <td style={s.td}>{a.detail && <div style={s.muted}>{a.detail}</div>}
              {a.resultRef && a.resultRef !== "FAILED" && <div style={{ marginTop: 4 }}><span style={s.chip}>{a.resultRef}</span></div>}
              {a.arguments && <details><summary style={s.muted}>Arguments · {a.durationMs} ms</summary><pre style={s.pre}>{a.arguments}</pre></details>}</td>
          </tr>)}</tbody>
        </table></div>)}
    {activity && activity.total > 0 && <div style={s.pager}>
      <span style={s.muted}>{from}–{to} of {activity.total}</span>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button style={s.iconBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="Previous page"><MdChevronLeft /></button>
        <button style={s.iconBtn} disabled={page * activity.pageSize >= activity.total} onClick={() => setPage(p => p + 1)} aria-label="Next page"><MdChevronRight /></button>
      </div>
    </div>}

    {showNew && <NewTokenDialog onClose={() => setShowNew(false)} onCreated={data => { setShowNew(false); setCreated(data); loadTokens(); }} />}
    {created && <SecretDialog created={created} onClose={() => setCreated(null)} />}
  </section>;
}

const btn = { minHeight: 44, padding: "0.4rem 1rem", borderRadius: 8, fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", boxShadow: "none", display: "inline-flex", alignItems: "center", gap: "0.35rem" };
const s = {
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.8rem", marginBottom: "1.1rem" },
  headLeft: { display: "flex", alignItems: "center", gap: "0.9rem", minWidth: 0, flex: "1 1 320px" },
  headIcon: { width: 44, height: 44, borderRadius: 12, flexShrink: 0, display: "grid", placeItems: "center", background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})` },
  headRight: { display: "flex", alignItems: "center", gap: "0.6rem" },
  title: { margin: 0, fontSize: "1.15rem", fontWeight: 700, color: colors.textPrimary },
  h4: { display: "flex", alignItems: "center", gap: "0.4rem", margin: "0 0 0.7rem", fontSize: "0.98rem", fontWeight: 700, color: colors.textPrimary },
  sub: { margin: "0.15rem 0 0.8rem", fontSize: "0.84rem", color: colors.textSecondary, lineHeight: 1.45 },
  hint: { margin: "0.3rem 0 0.8rem", fontSize: "0.78rem", color: colors.textSecondary },
  primary: { ...btn, background: colors.blue, color: "#fff", border: "none" },
  ghost: { ...btn, background: "#fff", color: colors.blue, border: `1px solid ${colors.inputBorder}` },
  danger: { ...btn, background: colors.dangerLight, color: colors.danger, border: `1px solid ${colors.danger}30` },
  iconBtn: { width: 44, height: 44, padding: 0, display: "grid", placeItems: "center", boxShadow: "none", background: colors.inputBg, color: colors.blue, border: `1px solid ${colors.inputBorder}`, borderRadius: 8, fontSize: "1.3rem", cursor: "pointer", flexShrink: 0 },
  label: { display: "block", margin: "0.9rem 0 0.35rem", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: colors.textSecondary },
  input: { width: "100%", minHeight: 44, padding: "0.5rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: colors.inputBg, color: colors.textPrimary, fontSize: "0.9rem", boxSizing: "border-box", marginBottom: "0.2rem" },
  checks: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.5rem" },
  check: { display: "flex", alignItems: "center", gap: "0.5rem", minHeight: 44, padding: "0.4rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: colors.inputBg, fontSize: "0.88rem", cursor: "pointer" },
  checkOn: { borderColor: colors.blue, background: "rgba(13,71,161,0.07)" },
  scopes: { display: "grid", gap: "0.5rem" },
  scope: { display: "flex", alignItems: "flex-start", gap: "0.6rem", minHeight: 44, padding: "0.55rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: colors.inputBg, fontSize: "0.88rem", cursor: "pointer" },
  scopeHelp: { display: "block", fontSize: "0.76rem", fontWeight: 400, color: colors.textSecondary, marginTop: 2 },
  foot: { display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: "0.6rem", padding: "0.9rem clamp(1rem, 2vw, 1.5rem)", borderTop: `1px solid ${colors.cardBorder}`, flexShrink: 0 },
  warn: { padding: "0.7rem 1rem", borderRadius: 8, background: "#fff3cd", color: "#664d03", border: "1px solid #ffecb5", fontSize: "0.86rem", lineHeight: 1.45 },
  secretRow: { display: "flex", alignItems: "flex-start", gap: "0.5rem" },
  code: { flex: 1, minWidth: 0, padding: "0.6rem 0.8rem", borderRadius: 8, background: "#0a1628", color: "#d6e4ff", fontSize: "0.8rem", overflowWrap: "anywhere", userSelect: "all" },
  alert: { padding: "0.7rem 1rem", margin: "0.8rem 0", borderRadius: 8, background: colors.dangerLight, color: "#842029", border: "1px solid #f5c6cb", fontSize: "0.88rem" },
  empty: { ...cardStyles.card, padding: "1.6rem 1rem", textAlign: "center", color: colors.textSecondary, fontSize: "0.9rem" },
  badge: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.2rem 0.65rem", borderRadius: 999, fontSize: "0.74rem", fontWeight: 700, whiteSpace: "nowrap" },
  dot: { width: 7, height: 7, borderRadius: "50%", display: "inline-block" },
  chips: { display: "flex", flexWrap: "wrap", gap: "0.3rem" },
  chip: { padding: "0.15rem 0.55rem", borderRadius: 6, fontSize: "0.74rem", fontWeight: 600, color: colors.blue, background: "rgba(13,71,161,0.08)" },
  strong: { fontSize: "0.9rem", fontWeight: 700, color: colors.textPrimary, overflowWrap: "break-word" },
  muted: { fontSize: "0.8rem", color: colors.textSecondary, overflowWrap: "anywhere" },
  tableWrap: { ...cardStyles.card, overflow: "hidden" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", color: colors.textPrimary },
  th: { textAlign: "left", padding: "0.7rem 0.9rem", fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textSecondary, background: colors.inputBg, borderBottom: `1px solid ${colors.cardBorder}` },
  tr: { borderBottom: `1px solid ${colors.cardBorder}` },
  td: { padding: "0.75rem 0.9rem", verticalAlign: "top" },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: "0.8rem" },
  card: { ...cardStyles.card, padding: "0.95rem 1rem", display: "grid", gap: "0.65rem", minWidth: 0 },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.6rem" },
  metaGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(120px, 100%), 1fr))", gap: "0.5rem 1rem" },
  metaLabel: cardStyles.metaLabel,
  metaValue: cardStyles.metaValue,
  toolbar: { display: "flex", flexWrap: "wrap", gap: "0.7rem", alignItems: "center", marginBottom: "0.9rem" },
  pills: { display: "flex", flexWrap: "wrap", gap: "0.4rem" },
  pill: { ...btn, padding: "0.35rem 0.8rem", fontSize: "0.82rem", background: colors.inputBg, color: "#455a64", border: `1px solid ${colors.inputBorder}` },
  pillOn: { background: colors.blue, color: "#fff", borderColor: colors.blue },
  pre: { margin: "0.4rem 0 0", padding: "0.5rem 0.7rem", borderRadius: 8, background: colors.inputBg, fontSize: "0.74rem", whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 160, overflow: "auto" },
  pager: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.8rem", marginTop: "1rem" },
};

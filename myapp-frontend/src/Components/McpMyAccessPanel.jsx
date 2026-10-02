import { useCallback, useEffect, useState } from "react";
import {
  MdSmartToy, MdAdd, MdClose, MdContentCopy, MdBlock, MdCheckCircle, MdInfo, MdVpnKey, MdHistory, MdChevronLeft, MdChevronRight,
} from "react-icons/md";
import httpClient from "../api/httpClient";
import { useConfirm } from "./ConfirmDialog";
import { SecretDialog } from "./McpAgentsPanel";
import { notify } from "../utils/notify";
import { colors, cardStyles, formStyles, modalSizes } from "../theme";

// "MCP & AI" tab on My Profile: whether MCP is switched on for this user, how to
// connect their AI tools, their own agent tokens, and a log of what those agents did.

const TONE = {
  Active: { bg: "#eafbef", fg: "#1b6e34", dot: "#28a745" },
  Expired: { bg: "#eef1f5", fg: "#5f6d7e", dot: "#9aa6b5" },
  Revoked: { bg: "#fff0f1", fg: "#a52834", dot: "#dc3545" },
  ok: { bg: "#eafbef", fg: "#1b6e34", dot: "#28a745", label: "Done" },
  denied: { bg: "#fff4e5", fg: "#8a4b00", dot: "#fd7e14", label: "Refused" },
  error: { bg: "#fff0f1", fg: "#a52834", dot: "#dc3545", label: "Failed" },
};
const asDate = v => v ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`) : null;
const absolute = v => { const d = asDate(v); return d ? d.toLocaleString() : "Never"; };
function relative(v) {
  const d = asDate(v);
  if (!d) return "Never";
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return d.toLocaleDateString();
}
const Badge = ({ tone, children }) => <span style={{ ...s.badge, background: tone.bg, color: tone.fg }}>
  <span style={{ ...s.dot, background: tone.dot }} />{children}</span>;

function CopyBlock({ text, label }) {
  const copy = async () => { try { await navigator.clipboard.writeText(text); notify(`${label} copied.`, "success"); } catch { notify("Copy failed. Select the text and copy it by hand.", "error"); } };
  return <div style={s.copyRow}><pre style={s.code}>{text}</pre>
    <button type="button" style={s.iconBtn} onClick={copy} aria-label={`Copy ${label}`}><MdContentCopy /></button></div>;
}

function NewTokenDialog({ status, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState(status.companies.length === 1 ? [status.companies[0].id] : []);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = id => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError("");
    try { onCreated((await httpClient.post("/mcp/me/tokens", { name, companyIds: picked, scopes: ["read"], expiresInDays: Number(days) })).data); }
    catch (err) { setError(err.response?.data?.message || "Could not create the token."); }
    finally { setBusy(false); }
  };
  const valid = name.trim() && picked.length > 0;
  return <div style={formStyles.backdrop}>
    <form style={{ ...formStyles.modal, maxWidth: modalSizes.md }} onSubmit={submit}>
      <div style={formStyles.header}><h3 style={formStyles.title}>New AI token</h3>
        <button type="button" style={formStyles.closeButton} onClick={onClose} aria-label="Close"><MdClose /></button></div>
      <div style={formStyles.body}>
        <p style={s.sub}>The token acts as you, and can read only the companies you tick, and only what you can read yourself.</p>
        <label style={s.label}>Name</label>
        <input style={s.input} value={name} maxLength={100} placeholder="e.g. Codex on my laptop" onChange={e => setName(e.target.value)} />
        <label style={s.label}>Companies it may reach</label>
        <div style={s.checks}>{status.companies.map(c => <label key={c.id} style={{ ...s.check, ...(picked.includes(c.id) ? s.checkOn : {}) }}>
          <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} /> {c.name}</label>)}</div>
        <label style={s.label}>Expires after</label>
        <select style={s.input} value={days} onChange={e => setDays(e.target.value)}>
          {[[7, "7 days"], [30, "30 days"], [60, "60 days"], [status.maxLifetimeDays, `${status.maxLifetimeDays} days (maximum)`]].map(([v, l]) => <option key={l} value={v}>{l}</option>)}
        </select>
        {error && <div role="alert" style={s.alert}>{error}</div>}
      </div>
      <div style={s.foot}>
        <button type="button" style={s.ghost} onClick={onClose}>Cancel</button>
        <button type="submit" style={{ ...s.primary, opacity: valid && !busy ? 1 : 0.55 }} disabled={!valid || busy}>Create token</button>
      </div>
    </form>
  </div>;
}

export default function McpMyAccessPanel() {
  const confirm = useConfirm();
  const origin = window.location.origin;
  const url = `${origin}/mcp`;
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [client, setClient] = useState("codex");
  const [showNew, setShowNew] = useState(false);
  const [created, setCreated] = useState(null);
  const [activity, setActivity] = useState(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setStatus((await httpClient.get("/mcp/me/status")).data); setError(""); }
    catch { setError("Could not load your MCP status."); }
  }, []);
  const loadActivity = useCallback(async () => {
    try { setActivity((await httpClient.get("/mcp/me/activity", { params: { page, pageSize: 10 } })).data); } catch { setActivity(null); }
  }, [page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (status?.enabled) loadActivity(); }, [status?.enabled, loadActivity]);

  const revoke = async t => {
    if (!await confirm({ title: "Revoke this token?", message: `“${t.name}” stops working on its next call. Its history is kept.`, variant: "danger", confirmText: "Revoke" })) return;
    setBusy(true);
    try { await httpClient.post(`/mcp/me/tokens/${t.id}/revoke`); notify("Token revoked.", "success"); await load(); await loadActivity(); }
    catch { notify("Could not revoke. Refresh to check its status.", "error"); }
    finally { setBusy(false); }
  };

  if (error) return <div role="alert" style={s.alert}>{error}</div>;
  if (!status) return <div style={s.empty}>Loading…</div>;

  const guides = {
    codex: { label: "Codex", steps: <>
      <p style={s.p}>1. Create a token below and set it in your environment (PowerShell, then restart Codex):</p>
      <CopyBlock label="command" text={`[Environment]::SetEnvironmentVariable("TRADER_MCP_TOKEN", "<paste your token>", "User")`} />
      <p style={s.p}>2. Add this to <code>~/.codex/config.toml</code>:</p>
      <CopyBlock label="config" text={`[mcp_servers.trader]\nurl = "${url}"\nbearer_token_env_var = "TRADER_MCP_TOKEN"`} />
      <p style={s.p}>3. Ask Codex to call <code>list_companies</code>.</p></> },
    claudecode: { label: "Claude Code", steps: <>
      <p style={s.p}>1. Create a token below. 2. Run this once, with your token pasted in:</p>
      <CopyBlock label="command" text={`claude mcp add --transport http --scope user trader ${url} --header "Authorization: Bearer <paste your token>"`} />
      <p style={s.p}>3. In Claude Code run <code>/mcp</code> and check “trader” is connected.</p></> },
    desktop: { label: "Claude Desktop", steps: <>
      <p style={s.p}>Needs Node.js. Open Settings, Developer, Edit Config and merge this into <code>mcpServers</code>, with your token pasted in:</p>
      <CopyBlock label="config" text={`{\n  "mcpServers": {\n    "trader": {\n      "command": "npx",\n      "args": ["-y", "mcp-remote", "${url}", "--header", "Authorization:\${AUTH}"],\n      "env": { "AUTH": "Bearer <paste your token>" }\n    }\n  }\n}`} />
      <p style={s.p}>Restart Claude Desktop and ask it to list your companies.</p></> },
    web: { label: "Claude.ai / ChatGPT", steps: <>
      <p style={s.p}>The browser versions connect by signing in with your ERP login instead of a pasted token. That sign-in connector is not switched on yet. Until then, use Codex, Claude Code or Claude Desktop above.</p>
      <p style={s.p}>Connector address (for when it is):</p><CopyBlock label="address" text={url} /></> },
  };

  const t = status.tokens;
  return <div style={{ minWidth: 0 }}>
    <div style={status.enabled ? s.ok : s.warn}>
      {status.enabled ? <MdCheckCircle style={s.bannerIcon} /> : <MdInfo style={s.bannerIcon} />}
      <div>
        <strong>{status.enabled ? "MCP is enabled for your account" : status.reason === "seed-admin" ? "The primary admin cannot connect an AI agent" : "MCP is not enabled for your account"}</strong>
        <div style={s.sub}>{status.enabled
          ? "Your AI tools can read the companies you choose, with the same limits as your own login. Every action they take is recorded."
          : status.reason === "seed-admin"
            ? "Create a dedicated user for agents and give that user the MCP Access role."
            : "Ask your administrator to give you the MCP Access role. Once they do, this page lets you create a token and connect your AI tool."}</div>
      </div>
    </div>

    <h4 style={s.h4}><MdSmartToy aria-hidden /> Connect your AI</h4>
    <div style={s.pills} role="group" aria-label="AI tool">
      {Object.entries(guides).map(([k, g]) => <button key={k} type="button" aria-pressed={client === k}
        style={{ ...s.pill, ...(client === k ? s.pillOn : {}) }} onClick={() => setClient(k)}>{g.label}</button>)}
    </div>
    <div style={s.guide}>{guides[client].steps}</div>
    <p style={s.hint}>Server address: <code>{url}</code>. Today MCP is read-only: your AI can look things up but cannot change anything.</p>

    {status.enabled && <>
      <div style={s.sectionHead}>
        <h4 style={{ ...s.h4, margin: 0 }}><MdVpnKey aria-hidden /> My tokens</h4>
        <button style={s.primary} onClick={() => setShowNew(true)}><MdAdd aria-hidden /> New token</button>
      </div>
      {t.length === 0 && <div style={s.empty}>You have no tokens yet.</div>}
      <div style={s.cards}>{t.map(k => <article key={k.id} style={s.card}>
        <div style={s.cardTop}><div style={{ minWidth: 0 }}><div style={s.strong}>{k.name}</div><div style={s.muted}><code>{k.hint}…</code></div></div>
          <Badge tone={TONE[k.status]}>{k.status}</Badge></div>
        <div style={s.chips}>{k.companies.map(c => <span key={c.id} style={s.chip}>{c.name}</span>)}</div>
        <div style={s.meta}>Last used {relative(k.lastUsedAt)} · expires {absolute(k.expiresAt)}</div>
        {k.status === "Active" && <button style={s.danger} disabled={busy} onClick={() => revoke(k)}><MdBlock aria-hidden /> Revoke</button>}
      </article>)}</div>

      <h4 style={{ ...s.h4, marginTop: "1.4rem" }}><MdHistory aria-hidden /> What my AI did</h4>
      {!activity && <div style={s.empty}>Loading…</div>}
      {activity && activity.items.length === 0 && <div style={s.empty}>Nothing yet. Activity appears here as soon as your AI makes a call.</div>}
      {activity && activity.items.length > 0 && <>
        <div style={s.cards}>{activity.items.map(a => <article key={a.id} style={s.card}>
          <div style={s.cardTop}><div style={{ minWidth: 0 }}><div style={s.strong}>{a.tool}</div><div style={s.muted}>{a.agentName || "Login session"}{a.companyId ? ` · company ${a.companyId}` : ""}</div></div>
            <Badge tone={TONE[a.outcome] || TONE.error}>{(TONE[a.outcome] || TONE.error).label}</Badge></div>
          {a.detail && <div style={s.muted}>{a.detail}</div>}
          <div style={s.meta} title={absolute(a.at)}>{relative(a.at)} · {a.durationMs} ms</div>
        </article>)}</div>
        <div style={s.pager}>
          <span style={s.muted}>{(activity.page - 1) * activity.pageSize + 1}–{Math.min(activity.page * activity.pageSize, activity.total)} of {activity.total}</span>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button style={s.iconBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="Previous page"><MdChevronLeft /></button>
            <button style={s.iconBtn} disabled={page * activity.pageSize >= activity.total} onClick={() => setPage(p => p + 1)} aria-label="Next page"><MdChevronRight /></button>
          </div>
        </div></>}
    </>}

    {showNew && <NewTokenDialog status={status} onClose={() => setShowNew(false)} onCreated={d => { setShowNew(false); setCreated(d); load(); }} />}
    {created && <SecretDialog created={created} onClose={() => setCreated(null)} />}
  </div>;
}

const btn = { minHeight: 44, padding: "0.4rem 1rem", borderRadius: 8, fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", boxShadow: "none", display: "inline-flex", alignItems: "center", gap: "0.35rem" };
const banner = { display: "flex", gap: "0.8rem", alignItems: "flex-start", padding: "0.9rem 1.1rem", borderRadius: 12, marginBottom: "1.2rem", fontSize: "0.9rem", lineHeight: 1.45 };
const s = {
  ok: { ...banner, background: "#eafbef", color: "#1b6e34", border: "1px solid #bfe8cb" },
  warn: { ...banner, background: "#fff4e5", color: "#8a4b00", border: "1px solid #ffd9a8" },
  bannerIcon: { fontSize: "1.5rem", flexShrink: 0, marginTop: 1 },
  h4: { display: "flex", alignItems: "center", gap: "0.4rem", margin: "1.2rem 0 0.7rem", fontSize: "0.98rem", fontWeight: 700, color: colors.textPrimary },
  sectionHead: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.6rem", margin: "1.4rem 0 0.7rem" },
  sub: { margin: "0.15rem 0 0.6rem", fontSize: "0.84rem", lineHeight: 1.45, opacity: 0.9 },
  p: { margin: "0.5rem 0 0.4rem", fontSize: "0.86rem", color: colors.textPrimary, lineHeight: 1.5 },
  hint: { margin: "0.6rem 0 0", fontSize: "0.78rem", color: colors.textSecondary },
  guide: { ...cardStyles.card, padding: "0.5rem 1.1rem 1rem", marginTop: "0.8rem" },
  copyRow: { display: "flex", alignItems: "flex-start", gap: "0.5rem" },
  code: { flex: 1, minWidth: 0, margin: 0, padding: "0.6rem 0.8rem", borderRadius: 8, background: "#0a1628", color: "#d6e4ff", fontSize: "0.78rem", whiteSpace: "pre-wrap", overflowWrap: "anywhere", userSelect: "all" },
  primary: { ...btn, background: colors.blue, color: "#fff", border: "none" },
  ghost: { ...btn, background: "#fff", color: colors.blue, border: `1px solid ${colors.inputBorder}` },
  danger: { ...btn, background: colors.dangerLight, color: colors.danger, border: `1px solid ${colors.danger}30`, justifySelf: "start" },
  iconBtn: { width: 44, height: 44, padding: 0, display: "grid", placeItems: "center", boxShadow: "none", background: colors.inputBg, color: colors.blue, border: `1px solid ${colors.inputBorder}`, borderRadius: 8, fontSize: "1.3rem", cursor: "pointer", flexShrink: 0 },
  pills: { display: "flex", flexWrap: "wrap", gap: "0.4rem" },
  pill: { ...btn, padding: "0.35rem 0.9rem", fontSize: "0.82rem", background: colors.inputBg, color: "#455a64", border: `1px solid ${colors.inputBorder}` },
  pillOn: { background: colors.blue, color: "#fff", borderColor: colors.blue },
  label: { display: "block", margin: "0.9rem 0 0.35rem", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: colors.textSecondary },
  input: { width: "100%", minHeight: 44, padding: "0.5rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: colors.inputBg, color: colors.textPrimary, fontSize: "0.9rem", boxSizing: "border-box" },
  checks: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.5rem" },
  check: { display: "flex", alignItems: "center", gap: "0.5rem", minHeight: 44, padding: "0.4rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: colors.inputBg, fontSize: "0.88rem", cursor: "pointer" },
  checkOn: { borderColor: colors.blue, background: "rgba(13,71,161,0.07)" },
  foot: { display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: "0.6rem", padding: "0.9rem clamp(1rem, 2vw, 1.5rem)", borderTop: `1px solid ${colors.cardBorder}`, flexShrink: 0 },
  alert: { padding: "0.7rem 1rem", margin: "0.8rem 0", borderRadius: 8, background: colors.dangerLight, color: "#842029", border: "1px solid #f5c6cb", fontSize: "0.88rem" },
  empty: { ...cardStyles.card, padding: "1.4rem 1rem", textAlign: "center", color: colors.textSecondary, fontSize: "0.9rem" },
  badge: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.2rem 0.65rem", borderRadius: 999, fontSize: "0.74rem", fontWeight: 700, whiteSpace: "nowrap" },
  dot: { width: 7, height: 7, borderRadius: "50%", display: "inline-block" },
  chips: { display: "flex", flexWrap: "wrap", gap: "0.3rem" },
  chip: { padding: "0.15rem 0.55rem", borderRadius: 6, fontSize: "0.74rem", fontWeight: 600, color: colors.blue, background: "rgba(13,71,161,0.08)" },
  strong: { fontSize: "0.9rem", fontWeight: 700, color: colors.textPrimary, overflowWrap: "break-word" },
  muted: { fontSize: "0.8rem", color: colors.textSecondary, overflowWrap: "anywhere" },
  meta: { fontSize: "0.8rem", color: colors.textSecondary },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: "0.8rem" },
  card: { ...cardStyles.card, padding: "0.95rem 1rem", display: "grid", gap: "0.6rem", minWidth: 0 },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.6rem" },
  pager: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.8rem", marginTop: "1rem" },
};

// src/pages/FbrMonitorPage.jsx
//
// FBR communication monitor — backs audit H-3 / M-6 (2026-05-08).
//
// Three-section page:
//   1. Header strip: 5 KPI counters (Submitted / Acknowledged / Rejected /
//      Failed / Uncertain) + avg duration + top FBR error codes for the
//      selected window. One quick glance answers "is FBR healthy right now?"
//   2. Filter bar: status chip, action filter, since/until, search by
//      invoice id. Keep the URL stable enough to share.
//   3. Paged list: timestamp, status pill, action, invoice link, http code,
//      FBR error, duration, retry. Click a row → drawer with full request /
//      response (already-masked NTN/CNIC).
import { useState, useEffect, useMemo } from "react";
import {
  MdCloudDone, MdHourglassEmpty, MdError, MdWarning, MdCheckCircle, MdRefresh, MdFilterList,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { getFbrLogs, getFbrLogById, getFbrSummary } from "../api/fbrMonitorApi";
import { notify } from "../utils/notify";

// Status -> visual config. Keys mirror FbrCommunicationLog.Status taxonomy.
const STATUS_CFG = {
  submitted:    { label: "Submitted",    color: "#2e7d32", bg: "#e8f5e9", border: "#a5d6a7", icon: MdCloudDone },
  acknowledged: { label: "Validated",    color: "#0277bd", bg: "#e3f2fd", border: "#90caf9", icon: MdCheckCircle },
  rejected:     { label: "Rejected",     color: "#c62828", bg: "#ffebee", border: "#ef9a9a", icon: MdError },
  failed:       { label: "Failed",       color: "#b71c1c", bg: "#fdecea", border: "#f5a3a3", icon: MdError },
  uncertain:    { label: "Uncertain",    color: "#8a4b00", bg: "#fff4e0", border: "#ffcc80", icon: MdWarning },
  retrying:     { label: "Retrying",     color: "#6a1b9a", bg: "#f3e5f5", border: "#ce93d8", icon: MdHourglassEmpty },
  sent:         { label: "Sent",         color: "#37474f", bg: "#eceff1", border: "#b0bec5", icon: MdHourglassEmpty },
};

function statusCfg(s) {
  return STATUS_CFG[s] || { label: s || "—", color: "#5f6d7e", bg: "#eceff1", border: "#b0bec5", icon: MdWarning };
}

function fmtDate(s) {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("en-PK", { dateStyle: "short", timeStyle: "medium" }); }
  catch { return s; }
}

function fmtMs(ms) {
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export default function FbrMonitorPage() {
  const { selectedCompany } = useCompany();
  const { has, loading: permsLoading } = usePermissions();

  const canView = has?.("fbrmonitor.view") ?? false;

  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [loading, setLoading] = useState(false);
  const [windowHours, setWindowHours] = useState(24);
  const [statusFilter, setStatusFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [drawer, setDrawer] = useState(null);

  const companyId = selectedCompany?.id ?? null;

  // ── Data fetches ──────────────────────────────────────────────
  // Both calls keyed on the active company + window so a context switch
  // refetches automatically.
  useEffect(() => {
    if (!canView || !companyId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await getFbrSummary({ companyId, hours: windowHours });
        if (!cancelled) setSummary(r.data);
      } catch (err) {
        if (!cancelled) notify.error(err.response?.data?.message || "Could not load summary.");
      }
    })();
    return () => { cancelled = true; };
  }, [canView, companyId, windowHours]);

  useEffect(() => {
    if (!canView || !companyId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();
        const r = await getFbrLogs({
          page, pageSize, companyId,
          status: statusFilter || undefined,
          action: actionFilter || undefined,
          since,
        });
        if (!cancelled) {
          setRows(r.data.items || []);
          setTotal(r.data.totalCount || 0);
        }
      } catch (err) {
        if (!cancelled) notify.error(err.response?.data?.message || "Could not load FBR logs.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canView, companyId, windowHours, page, pageSize, statusFilter, actionFilter]);

  // ── Permission / state gates ──────────────────────────────────
  if (permsLoading) return <Shell><div style={S.placeholder}>Loading…</div></Shell>;
  if (!canView) return <Shell><div style={S.placeholder}>You don't have permission to view FBR monitor.</div></Shell>;
  if (!selectedCompany) return <Shell><div style={S.placeholder}>Pick a company first.</div></Shell>;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const filteredCount = total;

  return (
    <Shell>
      <Header
        company={selectedCompany.name}
        windowHours={windowHours}
        onWindowChange={(h) => { setWindowHours(h); setPage(1); }}
        onRefresh={() => setPage((p) => p)}
      />

      <Summary summary={summary} windowHours={windowHours} />

      <FilterBar
        statusFilter={statusFilter}
        onStatus={(s) => { setStatusFilter(s); setPage(1); }}
        actionFilter={actionFilter}
        onAction={(a) => { setActionFilter(a); setPage(1); }}
        count={filteredCount}
      />

      <RowsList
        rows={rows}
        loading={loading}
        onClickRow={async (r) => {
          // Re-fetch the full row by id — the list view truncates bodies
          // for performance.
          try {
            const fr = await getFbrLogById(r.id);
            setDrawer(fr.data);
          } catch (err) {
            notify.error("Could not load row detail.");
          }
        }}
      />

      <Pagination page={page} totalPages={totalPages} total={total} onPage={setPage} />

      {drawer && <Drawer row={drawer} onClose={() => setDrawer(null)} />}
    </Shell>
  );
}

// ── Layout ─────────────────────────────────────────────────────────

function Shell({ children }) {
  return <div style={{ maxWidth: 1480, margin: "0 auto" }}>{children}</div>;
}

function Header({ company, windowHours, onWindowChange, onRefresh }) {
  return (
    <header style={S.heroBanner}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={S.heroH1}>FBR Communication Monitor</h1>
        <p style={S.heroSub}>
          <strong>{company}</strong> · last {windowHours}h
        </p>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <select value={windowHours} onChange={(e) => onWindowChange(parseInt(e.target.value, 10))} style={S.select} aria-label="Window">
          <option value={1}>Last 1h</option>
          <option value={6}>Last 6h</option>
          <option value={24}>Last 24h</option>
          <option value={168}>Last 7 days</option>
          <option value={720}>Last 30 days</option>
        </select>
        <button type="button" style={S.btnGhost} onClick={onRefresh} title="Refresh">
          <MdRefresh size={16} /> Refresh
        </button>
      </div>
    </header>
  );
}

function Summary({ summary, windowHours }) {
  const tile = (label, value, accent, icon) => (
    <div style={{ ...S.tile, borderTop: `3px solid ${accent}` }}>
      <div style={S.tileLabel}>{icon}<span>{label}</span></div>
      <div style={{ ...S.tileValue, color: accent }}>{value ?? 0}</div>
    </div>
  );
  if (!summary) return <div style={S.tilesSkeleton}><div style={S.tile}>—</div></div>;
  return (
    <>
      <div style={S.tiles}>
        {tile("Total calls", summary.totalCalls, "#0d47a1", null)}
        {tile("Submitted", summary.submitted, "#2e7d32", null)}
        {tile("Validated", summary.acknowledged, "#0277bd", null)}
        {tile("Rejected", summary.rejected, "#c62828", null)}
        {tile("Failed", summary.failed, "#b71c1c", null)}
        {tile("Uncertain", summary.uncertain, "#8a4b00", null)}
        {tile("Avg duration", fmtMs(Math.round(summary.avgDurationMs || 0)), "#37474f", null)}
      </div>
      {summary.topErrorCodes && Object.keys(summary.topErrorCodes).length > 0 && (
        <div style={S.errorBar}>
          <span style={{ fontSize: "0.78rem", color: "#5f6d7e", fontWeight: 600, marginRight: "0.5rem" }}>
            Top FBR error codes ({windowHours}h):
          </span>
          {Object.entries(summary.topErrorCodes).map(([code, n]) => (
            <span key={code} style={S.errChip}>
              <strong>{code}</strong> · {n}×
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function FilterBar({ statusFilter, onStatus, actionFilter, onAction, count }) {
  return (
    <section style={S.filterBar}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", color: "#5f6d7e", fontWeight: 600, fontSize: "0.82rem" }}>
        <MdFilterList size={14} /> Filter:
      </span>
      <select value={statusFilter} onChange={(e) => onStatus(e.target.value)} style={S.select}>
        <option value="">All statuses</option>
        <option value="submitted">Submitted</option>
        <option value="acknowledged">Validated</option>
        <option value="rejected">Rejected</option>
        <option value="failed">Failed</option>
        <option value="uncertain">Uncertain</option>
      </select>
      <select value={actionFilter} onChange={(e) => onAction(e.target.value)} style={S.select}>
        <option value="">All actions</option>
        <option value="Submit">Submit</option>
        <option value="Validate">Validate</option>
        <option value="Preview">Preview</option>
      </select>
      <span style={{ marginLeft: "auto", fontSize: "0.82rem", color: "#5f6d7e" }}>
        {count.toLocaleString()} {count === 1 ? "result" : "results"}
      </span>
    </section>
  );
}

function RowsList({ rows, loading, onClickRow }) {
  if (loading && rows.length === 0) return <div style={S.placeholder}>Loading…</div>;
  if (rows.length === 0) return <div style={S.placeholder}>No FBR communication in the selected window.</div>;
  return (
    <section style={S.list}>
      <div style={S.listHeader}>
        <span style={{ width: 150 }}>Timestamp</span>
        <span style={{ width: 110 }}>Status</span>
        <span style={{ width: 90 }}>Action</span>
        <span style={{ width: 90 }}>Bill</span>
        <span style={{ width: 70, textAlign: "right" }}>HTTP</span>
        <span style={{ flex: 1, minWidth: 0 }}>FBR error</span>
        <span style={{ width: 80, textAlign: "right" }}>Duration</span>
      </div>
      {rows.map((r) => {
        const cfg = statusCfg(r.status);
        const Icon = cfg.icon;
        return (
          <button type="button" key={r.id} onClick={() => onClickRow(r)} style={S.row}>
            <span style={{ width: 150, fontSize: "0.78rem", color: "#5f6d7e", fontFamily: "ui-monospace, monospace" }}>{fmtDate(r.timestamp)}</span>
            <span style={{ width: 110 }}>
              <span style={{ ...S.pill, color: cfg.color, backgroundColor: cfg.bg, border: `1px solid ${cfg.border}` }}>
                <Icon size={12} /> {cfg.label}
              </span>
            </span>
            <span style={{ width: 90, fontSize: "0.82rem", fontWeight: 600 }}>{r.action}</span>
            <span style={{ width: 90, fontSize: "0.82rem", color: "#0d47a1", fontFamily: "ui-monospace, monospace" }}>
              {r.invoiceId ? `#${r.invoiceId}` : "—"}
            </span>
            <span style={{ width: 70, textAlign: "right", fontSize: "0.82rem", fontFamily: "ui-monospace, monospace" }}>
              {r.httpStatusCode ?? "—"}
            </span>
            <span style={{ flex: 1, minWidth: 0, fontSize: "0.82rem", color: r.fbrErrorMessage ? "#b71c1c" : "#1a2332", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.fbrErrorCode ? <strong>[{r.fbrErrorCode}] </strong> : null}
              {r.fbrErrorMessage || "—"}
            </span>
            <span style={{ width: 80, textAlign: "right", fontSize: "0.78rem", color: "#5f6d7e" }}>{fmtMs(r.requestDurationMs)}</span>
          </button>
        );
      })}
    </section>
  );
}

function Pagination({ page, totalPages, total, onPage }) {
  if (totalPages <= 1) return null;
  return (
    <div style={S.pagination}>
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} style={S.pageBtn}>← Prev</button>
      <span style={{ fontSize: "0.82rem", color: "#5f6d7e" }}>
        Page {page} of {totalPages} <span style={{ color: "#98a4b3" }}>({total.toLocaleString()} rows)</span>
      </span>
      <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)} style={S.pageBtn}>Next →</button>
    </div>
  );
}

function Drawer({ row, onClose }) {
  const cfg = statusCfg(row.status);
  return (
    <div style={S.drawerOverlay} onClick={onClose}>
      <div style={S.drawerInner} onClick={(e) => e.stopPropagation()}>
        <header style={S.drawerHeader}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.1rem" }}>FBR call detail</h2>
            <div style={{ fontSize: "0.8rem", color: "#5f6d7e" }}>
              {fmtDate(row.timestamp)} · {row.action} · invoice {row.invoiceId ? `#${row.invoiceId}` : "—"}
            </div>
          </div>
          <button type="button" onClick={onClose} style={S.drawerClose} title="Close">×</button>
        </header>
        <div style={S.drawerBody}>
          <KeyValue label="Status" value={<span style={{ color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>} />
          <KeyValue label="HTTP" value={row.httpStatusCode ?? "—"} />
          <KeyValue label="Duration" value={fmtMs(row.requestDurationMs)} />
          <KeyValue label="Retry attempt" value={row.retryAttempt ?? 0} />
          <KeyValue label="User" value={row.userName || "—"} />
          <KeyValue label="Correlation ID" value={row.correlationId ? <code style={S.code}>{row.correlationId}</code> : "—"} />
          <KeyValue label="Endpoint" value={<code style={S.code}>{row.endpoint}</code>} />
          {row.fbrErrorCode && <KeyValue label="FBR error code" value={<strong style={{ color: "#b71c1c" }}>{row.fbrErrorCode}</strong>} />}
          {row.fbrErrorMessage && <KeyValue label="FBR message" value={<span style={{ color: "#b71c1c" }}>{row.fbrErrorMessage}</span>} />}

          <div style={{ marginTop: "1rem" }}>
            <strong style={{ fontSize: "0.85rem", color: "#1a2332" }}>Request body (NTN/CNIC masked)</strong>
            <pre style={S.pre}>{row.requestBodyMasked || "(empty)"}</pre>
          </div>
          <div style={{ marginTop: "1rem" }}>
            <strong style={{ fontSize: "0.85rem", color: "#1a2332" }}>Response body</strong>
            <pre style={S.pre}>{row.responseBodyMasked || "(empty)"}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function KeyValue({ label, value }) {
  return (
    <div style={{ display: "flex", gap: "0.85rem", fontSize: "0.85rem", padding: "0.25rem 0" }}>
      <span style={{ width: 130, color: "#5f6d7e", fontWeight: 600 }}>{label}</span>
      <span style={{ flex: 1, color: "#1a2332", overflow: "hidden", overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────

const S = {
  heroBanner: {
    background: "linear-gradient(135deg, #0d47a1 0%, #1565c0 50%, #00897b 100%)",
    color: "#fff",
    padding: "1rem 1.15rem",
    borderRadius: 14,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.75rem",
    marginBottom: "0.75rem",
    boxShadow: "0 8px 18px -8px rgba(13,71,161,0.4)",
  },
  heroH1: { margin: 0, fontSize: "1.25rem", fontWeight: 800, letterSpacing: "0.01em" },
  heroSub: { margin: "0.2rem 0 0", fontSize: "0.82rem", color: "rgba(255,255,255,0.85)" },
  select: {
    background: "#fff",
    border: "1px solid #d0d7e2",
    borderRadius: 8,
    padding: "0.4rem 0.6rem",
    fontSize: "0.82rem",
    color: "#1a2332",
    cursor: "pointer",
  },
  btnGhost: {
    display: "inline-flex", alignItems: "center", gap: "0.3rem",
    background: "rgba(255,255,255,0.92)", color: "#0d47a1",
    border: "none", borderRadius: 8,
    padding: "0.4rem 0.75rem",
    fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
  },
  tiles: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(140px, 100%), 1fr))",
    gap: "0.55rem",
    marginBottom: "0.55rem",
  },
  tilesSkeleton: { padding: "0.5rem 0", color: "#5f6d7e", fontSize: "0.85rem" },
  tile: {
    background: "#fff",
    border: "1px solid #e8edf3",
    borderRadius: 12,
    padding: "0.65rem 0.85rem 0.7rem",
    boxShadow: "0 1px 2px rgba(13,71,161,0.04)",
  },
  tileLabel: {
    display: "flex", alignItems: "center", gap: "0.3rem",
    fontSize: "0.7rem", color: "#5f6d7e", fontWeight: 700,
    textTransform: "uppercase", letterSpacing: "0.04em",
    marginBottom: "0.25rem",
  },
  tileValue: {
    fontSize: "1.35rem", fontWeight: 800, fontFamily: "ui-monospace, monospace",
  },
  errorBar: {
    background: "#fff",
    border: "1px solid #e8edf3",
    borderRadius: 10,
    padding: "0.5rem 0.8rem",
    display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem",
    marginBottom: "0.55rem",
  },
  errChip: {
    display: "inline-flex", alignItems: "center",
    padding: "0.15rem 0.5rem", borderRadius: 999,
    background: "#ffebee", color: "#b71c1c", fontSize: "0.78rem",
  },
  filterBar: {
    background: "#f8fafd",
    border: "1px solid #e8edf3",
    borderRadius: 10,
    padding: "0.55rem 0.85rem",
    display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem",
    marginBottom: "0.5rem",
  },
  list: {
    background: "#fff",
    border: "1px solid #e8edf3",
    borderRadius: 12,
    overflow: "hidden",
    boxShadow: "0 1px 2px rgba(13,71,161,0.04)",
  },
  listHeader: {
    display: "flex", alignItems: "center", gap: "0.5rem",
    padding: "0.55rem 0.85rem",
    fontSize: "0.7rem", color: "#5f6d7e", fontWeight: 700,
    textTransform: "uppercase", letterSpacing: "0.04em",
    background: "#f4f7fb", borderBottom: "1px solid #e8edf3",
  },
  row: {
    display: "flex", alignItems: "center", gap: "0.5rem",
    padding: "0.55rem 0.85rem",
    background: "#fff", border: "none",
    borderBottom: "1px solid #f0f3f8",
    width: "100%", textAlign: "left", cursor: "pointer",
    fontFamily: "inherit",
  },
  pill: {
    display: "inline-flex", alignItems: "center", gap: "0.25rem",
    padding: "0.12rem 0.55rem", borderRadius: 999,
    fontSize: "0.72rem", fontWeight: 700, whiteSpace: "nowrap",
  },
  pagination: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: "1rem",
    padding: "0.85rem 0",
  },
  pageBtn: {
    padding: "0.4rem 0.85rem",
    borderRadius: 8,
    border: "1px solid #d0d7e2",
    background: "#fff",
    color: "#0d47a1",
    fontWeight: 600,
    fontSize: "0.82rem",
    cursor: "pointer",
  },
  placeholder: {
    background: "#fff", border: "1px solid #e8edf3", borderRadius: 12,
    padding: "1.5rem", textAlign: "center", color: "#5f6d7e", fontSize: "0.9rem",
  },
  drawerOverlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
    display: "flex", justifyContent: "flex-end", zIndex: 1050,
  },
  drawerInner: {
    background: "#fff", width: "min(640px, 100%)", height: "100vh",
    overflowY: "auto", display: "flex", flexDirection: "column",
  },
  drawerHeader: {
    display: "flex", alignItems: "flex-start", justifyContent: "space-between",
    padding: "0.85rem 1rem",
    borderBottom: "1px solid #e8edf3",
  },
  drawerClose: {
    background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer",
    color: "#5f6d7e", lineHeight: 1, padding: "0 0.35rem",
  },
  drawerBody: { padding: "0.85rem 1rem 1.5rem", flex: 1 },
  pre: {
    background: "#f5f8fc", border: "1px solid #e8edf3", borderRadius: 8,
    padding: "0.6rem 0.75rem", margin: "0.35rem 0 0",
    fontSize: "0.78rem", lineHeight: 1.4,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    whiteSpace: "pre-wrap", wordBreak: "break-word",
    maxHeight: 300, overflow: "auto",
  },
  code: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "0.78rem",
    background: "#f5f8fc",
    padding: "1px 5px",
    borderRadius: 4,
    border: "1px solid #e8edf3",
    wordBreak: "break-all",
  },
};

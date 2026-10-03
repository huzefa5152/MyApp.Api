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
  MdCloudDone, MdHourglassEmpty, MdError, MdWarning, MdCheckCircle, MdRefresh, MdFilterList, MdClose, MdCloudSync,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { getFbrLogs, getFbrLogById, getFbrSummary } from "../api/fbrMonitorApi";
import { notify } from "../utils/notify";
import usePageSize, { PAGE_SIZE_OPTIONS } from "../hooks/usePageSize";
import Pagination from "../Components/Pagination";
import { PageHeader, CompanyPicker, Button, IconButton, Toolbar, ToolbarSpacer, StatGrid, StatCard, Loading, EmptyState } from "../ui/Kit";
import "./FbrMonitorPage.css";

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
  const { selectedCompany, companies } = useCompany();
  const { has, loading: permsLoading } = usePermissions();

  const canView = has?.("fbrmonitor.view") ?? false;

  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("fbrMonitor");
  const [observedSize, setObservedSize] = useState(null);
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
        if (!cancelled) notify(err.response?.data?.message || "Could not load summary.", "error");
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
          page, pageSize: pageSize || undefined, companyId,
          status: statusFilter || undefined,
          action: actionFilter || undefined,
          since,
        });
        if (!cancelled) {
          setRows(r.data.items || []);
          setTotal(r.data.totalCount || 0);
          setObservedSize(r.data.pageSize ?? null);
        }
      } catch (err) {
        if (!cancelled) notify(err.response?.data?.message || "Could not load FBR logs.", "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canView, companyId, windowHours, page, pageSize, statusFilter, actionFilter]);

  // ── Permission / state gates ──────────────────────────────────
  if (permsLoading) return <Shell><Loading>Loading…</Loading></Shell>;
  if (!canView) return <Shell><EmptyState>You don't have permission to view FBR monitor.</EmptyState></Shell>;
  if (!selectedCompany) return <Shell><EmptyState>Pick a company first.</EmptyState></Shell>;

  const effectiveSize = pageSize ?? observedSize ?? 10;
  const totalPages = Math.max(1, Math.ceil(total / effectiveSize));
  const filteredCount = total;

  return (
    <Shell>
      <Header
        company={selectedCompany.name}
        companies={companies}
        onCompanyChange={(c) => {
          // CompanyPicker has already set the global company; reset paging.
          if (c) setPage(1);
        }}
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
            notify("Could not load row detail.", "error");
          }
        }}
      />

      {total > PAGE_SIZE_OPTIONS[0] && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          onPage={setPage}
          pageSize={pageSize ?? observedSize}
          onPageSize={(n) => { setPageSize(n); setPage(1); }}
          unit="rows"
        />
      )}

      {drawer && <Drawer row={drawer} onClose={() => setDrawer(null)} />}
    </Shell>
  );
}

// ── Layout ─────────────────────────────────────────────────────────

function Shell({ children }) {
  return <div className="fbr-mon-page" style={{ maxWidth: 1480, margin: "0 auto" }}>{children}</div>;
}

function Header({ company, companies, onCompanyChange, windowHours, onWindowChange, onRefresh }) {
  // Hide the picker when there's only one company — it'd just be visual
  // noise. Same UX as the dashboard hero.
  const showCompanyPicker = (companies?.length ?? 0) > 1;
  return (
    <>
      <PageHeader
        icon={MdCloudSync}
        tone="brand"
        title="FBR Communication Monitor"
        subtitle={<><strong>{company}</strong> · last {windowHours}h</>}
        actions={(
          <>
            <select className="k-select" style={{ width: "auto" }} value={windowHours} onChange={(e) => onWindowChange(parseInt(e.target.value, 10))} aria-label="Window">
              <option value={1}>Last 1h</option>
              <option value={6}>Last 6h</option>
              <option value={24}>Last 24h</option>
              <option value={168}>Last 7 days</option>
              <option value={720}>Last 30 days</option>
            </select>
            <Button icon={MdRefresh} onClick={onRefresh} title="Refresh">Refresh</Button>
          </>
        )}
      />
      {showCompanyPicker && <CompanyPicker onChange={onCompanyChange} />}
    </>
  );
}

function Summary({ summary, windowHours }) {
  if (!summary) return <StatGrid><div className="k-stat" style={{ color: "var(--k-muted)" }}>—</div></StatGrid>;
  return (
    <>
      <StatGrid className="fbr-mon-tiles">
        <StatCard label="Total calls" value={summary.totalCalls ?? 0} tone="blue" icon={MdCloudSync} />
        <StatCard label="Submitted" value={summary.submitted ?? 0} tone="green" icon={MdCloudDone} />
        <StatCard label="Validated" value={summary.acknowledged ?? 0} tone="teal" icon={MdCheckCircle} />
        <StatCard label="Rejected" value={summary.rejected ?? 0} tone="red" icon={MdError} />
        <StatCard label="Failed" value={summary.failed ?? 0} tone="red" icon={MdError} />
        <StatCard label="Uncertain" value={summary.uncertain ?? 0} tone="orange" icon={MdWarning} />
        <StatCard label="Avg duration" value={fmtMs(Math.round(summary.avgDurationMs || 0))} tone="slate" icon={MdHourglassEmpty} />
      </StatGrid>
      {summary.topErrorCodes && Object.keys(summary.topErrorCodes).length > 0 && (
        <div className="k-card fbr-mon-error-bar" style={S.errorBar}>
          <span style={{ fontSize: "var(--k-font-sm)", color: "var(--k-muted)", fontWeight: 600, marginRight: "0.5rem" }}>
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
    <Toolbar>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", color: "var(--k-muted)", fontWeight: 600, fontSize: "var(--k-font-sm)" }}>
        <MdFilterList size={14} /> Filter:
      </span>
      <select className="k-select" aria-label="Status" value={statusFilter} onChange={(e) => onStatus(e.target.value)}>
        <option value="">All statuses</option>
        <option value="submitted">Submitted</option>
        <option value="acknowledged">Validated</option>
        <option value="rejected">Rejected</option>
        <option value="failed">Failed</option>
        <option value="uncertain">Uncertain</option>
      </select>
      <select className="k-select" aria-label="Action" value={actionFilter} onChange={(e) => onAction(e.target.value)}>
        <option value="">All actions</option>
        <option value="Submit">Submit</option>
        <option value="Validate">Validate</option>
        <option value="Preview">Preview</option>
      </select>
      <ToolbarSpacer />
      <span className="fbr-mon-filter-bar__count" style={{ fontSize: "var(--k-font-sm)", color: "var(--k-muted)" }}>
        {count.toLocaleString()} {count === 1 ? "result" : "results"}
      </span>
    </Toolbar>
  );
}

function RowsList({ rows, loading, onClickRow }) {
  if (loading && rows.length === 0) return <Loading>Loading…</Loading>;
  if (rows.length === 0) return <EmptyState icon={MdCloudSync}>No FBR communication in the selected window.</EmptyState>;
  return (
    <section className="k-card" style={S.list}>
      <div className="fbr-mon-list-header" style={S.listHeader}>
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
          <button type="button" key={r.id} onClick={() => onClickRow(r)} className="fbr-mon-row" style={S.row}>
            <span className="fbr-mon-row__ts" style={{ width: 150, fontSize: "0.78rem", color: "var(--k-muted)", fontFamily: "ui-monospace, monospace" }}>{fmtDate(r.timestamp)}</span>
            <span className="fbr-mon-row__status" style={{ width: 110 }}>
              <span style={{ ...S.pill, color: cfg.color, backgroundColor: cfg.bg, border: `1px solid ${cfg.border}` }}>
                <Icon size={12} /> {cfg.label}
              </span>
            </span>
            <span className="fbr-mon-row__action" style={{ width: 90, fontSize: "var(--k-td-font)", fontWeight: 600 }}>{r.action}</span>
            <span className="fbr-mon-row__bill" style={{ width: 90, fontSize: "var(--k-td-font)", color: "var(--k-blue)", fontFamily: "ui-monospace, monospace" }}>
              {r.invoiceNumber != null ? `#${r.invoiceNumber}` : "—"}
            </span>
            <span className="fbr-mon-row__http" style={{ width: 70, textAlign: "right", fontSize: "var(--k-td-font)", fontFamily: "ui-monospace, monospace" }}>
              {r.httpStatusCode ?? "—"}
            </span>
            <span className="fbr-mon-row__err" style={{ flex: 1, minWidth: 0, fontSize: "var(--k-td-font)", color: r.fbrErrorMessage ? "#b71c1c" : "var(--k-ink)", whiteSpace: "pre-line", wordBreak: "break-word", lineHeight: 1.4 }}>
              {r.fbrErrorCode ? <strong>[{r.fbrErrorCode}] </strong> : null}
              {r.fbrErrorMessage || "—"}
            </span>
            <span className="fbr-mon-row__duration" style={{ width: 80, textAlign: "right", fontSize: "0.78rem", color: "var(--k-muted)" }}>{fmtMs(r.requestDurationMs)}</span>
          </button>
        );
      })}
    </section>
  );
}

function Drawer({ row, onClose }) {
  const cfg = statusCfg(row.status);
  return (
    <div style={S.drawerOverlay} onClick={onClose}>
      <div className="fbr-mon-drawer-inner" style={S.drawerInner} onClick={(e) => e.stopPropagation()}>
        <header className="fbr-mon-drawer-header" style={S.drawerHeader}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.1rem", color: "var(--k-ink)" }}>FBR call detail</h2>
            <div style={{ fontSize: "0.8rem", color: "var(--k-muted)" }}>
              {fmtDate(row.timestamp)} · {row.action} · invoice {row.invoiceNumber != null ? `#${row.invoiceNumber}` : "—"}
            </div>
          </div>
          <IconButton label="Close" icon={MdClose} onClick={onClose} />
        </header>
        <div className="fbr-mon-drawer-body" style={S.drawerBody}>
          <KeyValue label="Status" value={<span style={{ color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>} />
          <KeyValue label="HTTP" value={row.httpStatusCode ?? "—"} />
          <KeyValue label="Duration" value={fmtMs(row.requestDurationMs)} />
          <KeyValue label="Retry attempt" value={row.retryAttempt ?? 0} />
          <KeyValue label="User" value={row.userName || "—"} />
          <KeyValue label="Correlation ID" value={row.correlationId ? <code style={S.code}>{row.correlationId}</code> : "—"} />
          <KeyValue label="Endpoint" value={<code style={S.code}>{row.endpoint}</code>} />
          {row.fbrErrorCode && <KeyValue label="FBR error code" value={<strong style={{ color: "#b71c1c" }}>{row.fbrErrorCode}</strong>} />}
          {row.fbrErrorMessage && <KeyValue label="FBR message" value={<span style={{ color: "#b71c1c", whiteSpace: "pre-line" }}>{row.fbrErrorMessage}</span>} />}

          <div style={{ marginTop: "1rem" }}>
            <strong style={{ fontSize: "var(--k-font)", color: "var(--k-ink)" }}>Request body (NTN/CNIC masked)</strong>
            <pre className="fbr-mon-pre" style={S.pre}>{row.requestBodyMasked || "(empty)"}</pre>
          </div>
          <div style={{ marginTop: "1rem" }}>
            <strong style={{ fontSize: "var(--k-font)", color: "var(--k-ink)" }}>Response body</strong>
            <pre className="fbr-mon-pre" style={S.pre}>{row.responseBodyMasked || "(empty)"}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function KeyValue({ label, value }) {
  return (
    <div className="fbr-mon-kv" style={{ display: "flex", gap: "0.85rem", fontSize: "var(--k-font)", padding: "0.25rem 0" }}>
      <span style={{ width: 130, flex: "none", color: "var(--k-muted)", fontWeight: 600 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, color: "var(--k-ink)", overflow: "hidden", overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────

const S = {
  errorBar: {
    padding: "0.5rem 0.8rem",
    display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem",
    marginBottom: "var(--k-gap)",
  },
  errChip: {
    display: "inline-flex", alignItems: "center",
    padding: "0.15rem 0.5rem", borderRadius: 999,
    background: "#ffebee", color: "#b71c1c", fontSize: "0.78rem",
  },
  list: {
    overflow: "hidden",
  },
  listHeader: {
    display: "flex", alignItems: "center", gap: "0.5rem",
    minHeight: "var(--k-th-h)",
    padding: "0 var(--k-td-pad-x)",
    fontSize: "var(--k-th-font)", color: "var(--k-muted)", fontWeight: 700,
    textTransform: "uppercase", letterSpacing: "0.05em",
    background: "var(--k-th-bg)", borderBottom: "1px solid var(--k-line)",
  },
  row: {
    // alignItems: flex-start so a wrapped multi-line error doesn't
    // visually drift the other columns to the vertical middle. With
    // an 0.55rem top padding the first line lines up with the column
    // header guide above.
    display: "flex", alignItems: "flex-start", gap: "0.5rem",
    padding: "0.55rem var(--k-td-pad-x)",
    margin: 0, borderRadius: 0, boxShadow: "none",
    background: "var(--k-surface)", border: "none",
    borderBottom: "1px solid var(--k-row-line)",
    width: "100%", textAlign: "left", cursor: "pointer",
    fontFamily: "inherit", color: "var(--k-ink)",
  },
  pill: {
    display: "inline-flex", alignItems: "center", gap: "0.25rem",
    padding: "0.12rem 0.55rem", borderRadius: 999,
    fontSize: "0.72rem", fontWeight: 700, whiteSpace: "nowrap",
  },
  drawerOverlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
    display: "flex", justifyContent: "flex-end", zIndex: 1050,
  },
  drawerInner: {
    background: "var(--k-surface)", width: "min(640px, 100%)", height: "100vh",
    overflowY: "auto", display: "flex", flexDirection: "column",
  },
  drawerHeader: {
    display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem",
    padding: "0.85rem 1rem",
    borderBottom: "1px solid var(--k-line)",
  },
  drawerBody: { padding: "0.85rem 1rem 1.5rem", flex: 1 },
  pre: {
    background: "#f5f8fc", border: "1px solid var(--k-line)", borderRadius: 8,
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
    border: "1px solid var(--k-line)",
    wordBreak: "break-all",
  },
};

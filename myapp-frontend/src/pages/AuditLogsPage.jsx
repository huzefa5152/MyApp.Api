import { useState, useEffect, useCallback } from "react";
import { MdBugReport, MdWarning, MdInfo, MdClose, MdLock } from "react-icons/md";
import { getAuditLogs, getAuditSummary } from "../api/auditLogApi";
import { usePermissions } from "../contexts/PermissionsContext";
// Shared backdrop / modal so this audit-log detail dialog matches every
// other popup (blurred backdrop, centered, non-movable).
import { formStyles, modalSizes } from "../theme";
import usePageSize, { PAGE_SIZE_OPTIONS } from "../hooks/usePageSize";
import Pagination from "../Components/Pagination";
import { PageHeader, Button, Toolbar, ToolbarSpacer, SearchBox, Card, TableWrap, Loading, EmptyState } from "../ui/Kit";

const colors = {
  teal: "#00897b",
  textPrimary: "var(--k-ink)",
  danger: "#dc3545",
};

const levelBadge = {
  Error: { bg: "#fdeded", color: "#842029", icon: <MdBugReport size={14} /> },
  Warning: { bg: "#fff3cd", color: "#664d03", icon: <MdWarning size={14} /> },
  Info: { bg: "#cff4fc", color: "#055160", icon: <MdInfo size={14} /> },
};

const methodColor = {
  GET: "#0d6efd",
  POST: "#198754",
  PUT: "#fd7e14",
  DELETE: "#dc3545",
  PATCH: "#6f42c1",
};

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function AuditLogsPage() {
  const { has } = usePermissions();
  const canView = has("auditlogs.view");
  const [logs, setLogs] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("auditLogs");
  const [observedSize, setObservedSize] = useState(null);
  const [level, setLevel] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [summary, setSummary] = useState(null);
  const [selectedLog, setSelectedLog] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      // Don't send pageSize — let the server apply Pagination:DefaultPageSize
      // from appsettings.json. The response carries page + pageSize +
      // totalPages back so the UI's pagination math stays accurate.
      const { data } = await getAuditLogs(page, pageSize || undefined, level || undefined, search || undefined);
      setLogs(data.items);
      setTotalCount(data.totalCount);
      setTotalPages(data.totalPages);
      setObservedSize(data.pageSize ?? null);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, level, search]);

  const fetchSummary = useCallback(async () => {
    try {
      const { data } = await getAuditSummary();
      setSummary(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  if (!canView) {
    return (
      <EmptyState icon={MdLock} title="Access denied">
        You don&apos;t have permission to view audit logs.
      </EmptyState>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <PageHeader
        icon={MdBugReport}
        tone="red"
        title="Audit Logs"
        subtitle="Monitor API errors and system events"
        actions={summary && (
          <>
            <span style={{ ...chip, background: "#fdeded", color: "#842029" }}>
              {summary.errorsLast24h} errors (24h)
            </span>
            <span style={{ ...chip, background: "#fff3cd", color: "#664d03" }}>
              {summary.warningsLast24h} warnings (24h)
            </span>
          </>
        )}
      />

      {/* Filters */}
      <Toolbar>
        <select
          className="k-select"
          aria-label="Level"
          value={level}
          onChange={(e) => { setLevel(e.target.value); setPage(1); }}
        >
          <option value="">All Levels</option>
          <option value="Error">Errors</option>
          <option value="Warning">Warnings</option>
          <option value="Info">Info</option>
        </select>
        <form onSubmit={handleSearch} style={{ display: "flex", gap: "0.4rem", flex: "1 1 280px", minWidth: 0, maxWidth: 460 }}>
          <SearchBox
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Search path, message, user..."
          />
          <Button type="submit" variant="primary">Search</Button>
        </form>
        <ToolbarSpacer />
        <span style={{ fontSize: "var(--k-font-sm)", color: "var(--k-muted)" }}>
          {totalCount} total
        </span>
      </Toolbar>

      {/* Table (desktop) */}
      <Card flush>
        <TableWrap data-admin-table-region="" className="audit-table-wrap">
          <table className="k-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Level</th>
                <th>Method</th>
                <th>Path</th>
                <th>Status</th>
                <th>User</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7}><Loading>Loading...</Loading></td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={7}><EmptyState boxed={false}>No audit logs found</EmptyState></td></tr>
              ) : logs.map((log) => {
                const badge = levelBadge[log.level] || levelBadge.Info;
                return (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    style={{ cursor: "pointer" }}
                  >
                    <td style={{ whiteSpace: "nowrap" }}>{formatDate(log.timestamp)}</td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 6, background: badge.bg, color: badge.color, fontSize: "0.78rem", fontWeight: 600 }}>
                        {badge.icon} {log.level}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontWeight: 700, fontSize: "0.78rem", color: methodColor[log.httpMethod] || colors.textPrimary }}>
                        {log.httpMethod}
                      </span>
                    </td>
                    <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace", fontSize: "0.8rem" }}>
                      {log.requestPath}
                    </td>
                    <td>
                      <span style={{ fontWeight: 700, color: log.statusCode >= 500 ? colors.danger : log.statusCode >= 400 ? "#fd7e14" : colors.teal }}>
                        {log.statusCode}
                      </span>
                    </td>
                    <td>{log.userName || "—"}</td>
                    <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {log.message}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>

        {/* Mobile Cards */}
        <div className="audit-cards">
          {loading ? (
            <Loading>Loading...</Loading>
          ) : logs.length === 0 ? (
            <EmptyState boxed={false}>No audit logs found</EmptyState>
          ) : logs.map((log) => {
            const badge = levelBadge[log.level] || levelBadge.Info;
            const statusColor =
              log.statusCode >= 500 ? colors.danger
              : log.statusCode >= 400 ? "#fd7e14"
              : colors.teal;
            return (
              <div key={log.id} className="audit-card" onClick={() => setSelectedLog(log)}>
                {/* Row 1: level pill + timestamp on the right */}
                <div className="audit-card__head">
                  <span className="audit-card__level" style={{ background: badge.bg, color: badge.color }}>
                    {badge.icon} {log.level}
                  </span>
                  <span className="audit-card__time">{formatDate(log.timestamp)}</span>
                </div>

                {/* Row 2: method + status. Path on its own row below so it
                    can wrap freely without fighting the status code for
                    horizontal space (the bug your screenshot caught). */}
                <div className="audit-card__meta">
                  <span className="audit-card__method" style={{ color: methodColor[log.httpMethod] || colors.textPrimary }}>
                    {log.httpMethod}
                  </span>
                  <span className="audit-card__status" style={{ color: statusColor }}>
                    HTTP {log.statusCode}
                  </span>
                  {log.userName && (
                    <span className="audit-card__user">{log.userName}</span>
                  )}
                </div>

                {/* Path: full-width, monospace, breaks anywhere so long URLs
                    wrap inside the card instead of overflowing it. */}
                <div className="audit-card__path">{log.requestPath}</div>

                {/* Message: wraps freely; clamped to 3 lines so a long
                    stack message doesn't blow out the card height. */}
                {log.message && (
                  <div className="audit-card__msg">{log.message}</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        {totalCount > PAGE_SIZE_OPTIONS[0] && (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={totalCount}
            onPage={setPage}
            pageSize={pageSize ?? observedSize}
            onPageSize={(n) => { setPageSize(n); setPage(1); }}
          />
        )}
      </Card>

      {/* Detail Modal */}
      {selectedLog && (
        <div data-admin-backdrop=""
          // Backdrop click is a no-op for consistency with the rest of the
          // app — dismiss via the X button in the modal header.
          style={formStyles.backdrop}
        >
          <div data-admin-dialog=""
            style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={formStyles.header}>
              <h3 style={formStyles.title}>Log Detail #{selectedLog.id}</h3>
              <button type="button" onClick={() => setSelectedLog(null)} style={formStyles.closeButton} aria-label="Close">
                <MdClose size={20} />
              </button>
            </div>
            <div style={formStyles.body}>
            <div className="audit-detail-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px", fontSize: "var(--k-font)", marginBottom: 16 }}>
              <Detail label="Timestamp" value={formatDate(selectedLog.timestamp)} />
              <Detail label="Level" value={selectedLog.level} />
              <Detail label="User" value={selectedLog.userName || "—"} />
              <Detail label="Status Code" value={selectedLog.statusCode} />
              <Detail label="Method" value={selectedLog.httpMethod} />
              <Detail label="Path" value={selectedLog.requestPath} mono />
              <Detail label="Exception Type" value={selectedLog.exceptionType} mono full />
              <Detail label="Query String" value={selectedLog.queryString || "—"} mono full />
            </div>
            <DetailBlock label="Message" value={selectedLog.message} />
            {selectedLog.requestBody && <DetailBlock label="Request Body" value={selectedLog.requestBody} mono />}
            {selectedLog.stackTrace && <DetailBlock label="Stack Trace" value={selectedLog.stackTrace} mono />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, mono, full }) {
  return (
    <div style={full ? { gridColumn: "1 / -1" } : {}}>
      <div style={{ fontSize: "0.75rem", color: "var(--k-muted)", fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div style={{ color: "var(--k-ink)", fontFamily: mono ? "monospace" : "inherit", fontSize: mono ? "0.82rem" : "0.88rem", wordBreak: "break-all" }}>{value}</div>
    </div>
  );
}

function DetailBlock({ label, value, mono }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: "0.75rem", color: "var(--k-muted)", fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <pre style={{
        background: "var(--k-surface-2)",
        border: "1px solid var(--k-line)",
        borderRadius: 8,
        padding: 12,
        fontSize: "0.8rem",
        fontFamily: mono ? "monospace" : "inherit",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
        maxHeight: 250,
        overflow: "auto",
        margin: 0,
      }}>
        {value}
      </pre>
    </div>
  );
}

const chip = { display: "inline-flex", alignItems: "center", minHeight: 30, borderRadius: 8, padding: "0 14px", fontSize: "var(--k-font-sm)", fontWeight: 600 };

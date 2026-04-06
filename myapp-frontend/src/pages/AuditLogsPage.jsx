import { useState, useEffect, useCallback } from "react";
import { MdBugReport, MdWarning, MdInfo, MdSearch, MdChevronLeft, MdChevronRight, MdClose } from "react-icons/md";
import { getAuditLogs, getAuditSummary } from "../api/auditLogApi";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBg: "#ffffff",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
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
  const [logs, setLogs] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [level, setLevel] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [summary, setSummary] = useState(null);
  const [selectedLog, setSelectedLog] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getAuditLogs(page, pageSize, level || undefined, search || undefined);
      setLogs(data.items);
      setTotalCount(data.totalCount);
      setTotalPages(data.totalPages);
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

  return (
    <div style={{ padding: "1.5rem", maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(135deg, ${colors.danger}, #b71c1c)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <MdBugReport size={24} color="#fff" />
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700, color: colors.textPrimary }}>Audit Logs</h2>
          <p style={{ margin: 0, fontSize: "0.82rem", color: colors.textSecondary }}>Monitor API errors and system events</p>
        </div>
        {summary && (
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.75rem" }}>
            <div style={{ background: "#fdeded", borderRadius: 8, padding: "6px 14px", fontSize: "0.82rem", fontWeight: 600, color: "#842029" }}>
              {summary.errorsLast24h} errors (24h)
            </div>
            <div style={{ background: "#fff3cd", borderRadius: 8, padding: "6px 14px", fontSize: "0.82rem", fontWeight: 600, color: "#664d03" }}>
              {summary.warningsLast24h} warnings (24h)
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={level}
          onChange={(e) => { setLevel(e.target.value); setPage(1); }}
          style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: colors.inputBg, fontSize: "0.85rem", fontWeight: 500 }}
        >
          <option value="">All Levels</option>
          <option value="Error">Errors</option>
          <option value="Warning">Warnings</option>
          <option value="Info">Info</option>
        </select>
        <form onSubmit={handleSearch} style={{ display: "flex", gap: "0.4rem", flex: 1, minWidth: 200, maxWidth: 400 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <MdSearch size={18} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: colors.textSecondary }} />
            <input
              type="text"
              placeholder="Search path, message, user..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{ width: "100%", padding: "6px 12px 6px 34px", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: colors.inputBg, fontSize: "0.85rem" }}
            />
          </div>
          <button type="submit" style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: colors.blue, color: "#fff", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" }}>
            Search
          </button>
        </form>
        <span style={{ fontSize: "0.82rem", color: colors.textSecondary, marginLeft: "auto" }}>
          {totalCount} total
        </span>
      </div>

      {/* Table */}
      <div style={{ background: colors.cardBg, borderRadius: 12, border: `1px solid ${colors.cardBorder}`, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: "#f8f9fb", borderBottom: `2px solid ${colors.cardBorder}` }}>
                <th style={thStyle}>Time</th>
                <th style={thStyle}>Level</th>
                <th style={thStyle}>Method</th>
                <th style={thStyle}>Path</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>User</th>
                <th style={thStyle}>Message</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: 40, textAlign: "center", color: colors.textSecondary }}>Loading...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 40, textAlign: "center", color: colors.textSecondary }}>No audit logs found</td></tr>
              ) : logs.map((log) => {
                const badge = levelBadge[log.level] || levelBadge.Info;
                return (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    style={{ borderBottom: `1px solid ${colors.cardBorder}`, cursor: "pointer", transition: "background 0.15s" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "#f0f4ff"}
                    onMouseLeave={(e) => e.currentTarget.style.background = ""}
                  >
                    <td style={tdStyle}>{formatDate(log.timestamp)}</td>
                    <td style={tdStyle}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 6, background: badge.bg, color: badge.color, fontSize: "0.78rem", fontWeight: 600 }}>
                        {badge.icon} {log.level}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 700, fontSize: "0.78rem", color: methodColor[log.httpMethod] || colors.textPrimary }}>
                        {log.httpMethod}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace", fontSize: "0.8rem" }}>
                      {log.requestPath}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 700, color: log.statusCode >= 500 ? colors.danger : log.statusCode >= 400 ? "#fd7e14" : colors.teal }}>
                        {log.statusCode}
                      </span>
                    </td>
                    <td style={tdStyle}>{log.userName || "—"}</td>
                    <td style={{ ...tdStyle, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {log.message}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", padding: "12px", borderTop: `1px solid ${colors.cardBorder}` }}>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              style={pgBtn}
            >
              <MdChevronLeft size={18} />
            </button>
            <span style={{ fontSize: "0.85rem", color: colors.textSecondary, fontWeight: 500 }}>
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              style={pgBtn}
            >
              <MdChevronRight size={18} />
            </button>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedLog && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1050 }}
          onClick={() => setSelectedLog(null)}
        >
          <div
            style={{ background: "#fff", borderRadius: 12, maxWidth: 700, width: "95%", maxHeight: "85vh", overflow: "auto", padding: "24px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem", color: colors.textPrimary }}>Log Detail #{selectedLog.id}</h3>
              <button onClick={() => setSelectedLog(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                <MdClose size={22} color={colors.textSecondary} />
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px", fontSize: "0.88rem", marginBottom: 16 }}>
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
      )}
    </div>
  );
}

function Detail({ label, value, mono, full }) {
  return (
    <div style={full ? { gridColumn: "1 / -1" } : {}}>
      <div style={{ fontSize: "0.75rem", color: "#5f6d7e", fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div style={{ color: "#1a2332", fontFamily: mono ? "monospace" : "inherit", fontSize: mono ? "0.82rem" : "0.88rem", wordBreak: "break-all" }}>{value}</div>
    </div>
  );
}

function DetailBlock({ label, value, mono }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: "0.75rem", color: "#5f6d7e", fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <pre style={{
        background: "#f8f9fb",
        border: "1px solid #e8edf3",
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

const thStyle = { padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#5f6d7e", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.3px", whiteSpace: "nowrap" };
const tdStyle = { padding: "10px 14px", color: "#1a2332" };
const pgBtn = { display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 8, border: "1px solid #d0d7e2", background: "#fff", cursor: "pointer" };

import http from "./httpClient";

// pageSize is intentionally optional — when omitted, the server applies
// Pagination:DefaultPageSize from appsettings.json. Callers should NOT
// pass a hardcoded number; let the server be the single source of truth.
export const getAuditLogs = (page = 1, pageSize, level, search) =>
  http.get("/auditlogs", { params: { page, pageSize, level, search } });

export const getAuditLogById = (id) => http.get(`/auditlogs/${id}`);

export const getAuditSummary = () => http.get("/auditlogs/summary");

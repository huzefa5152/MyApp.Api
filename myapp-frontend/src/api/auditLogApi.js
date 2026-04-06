import http from "./httpClient";

export const getAuditLogs = (page = 1, pageSize = 20, level, search) =>
  http.get("/auditlogs", { params: { page, pageSize, level, search } });

export const getAuditLogById = (id) => http.get(`/auditlogs/${id}`);

export const getAuditSummary = () => http.get("/auditlogs/summary");

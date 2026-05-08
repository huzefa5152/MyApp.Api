// Frontend client for the FBR communication monitor (audit H-3 / M-6).
// Backend routes:
//   GET /api/fbr-monitor                — paged list, filterable
//   GET /api/fbr-monitor/{id}           — single row drill-down
//   GET /api/fbr-monitor/summary        — aggregate counters for the header
import http from "./httpClient";

export const getFbrLogs = ({
  page = 1,
  pageSize,
  companyId,
  action,
  status,
  invoiceId,
  since,
  until,
} = {}) =>
  http.get("/fbr-monitor", {
    params: { page, pageSize, companyId, action, status, invoiceId, since, until },
  });

export const getFbrLogById = (id) => http.get(`/fbr-monitor/${id}`);

export const getFbrSummary = ({ companyId, hours = 24 } = {}) =>
  http.get("/fbr-monitor/summary", { params: { companyId, hours } });

import httpClient from "./httpClient";

// ── Accounting reports ──────────────────────────────────────────────────────
// Every report returns the same envelope (ReportResultDto), so one fetch helper
// and one renderer serve all of them. The report's `path` comes from the
// registry in config/accountingReports.js — this module never hardcodes a list.

const base = (companyId) => `/accounting/reports/company/${companyId}`;

/**
 * Fetch one report. `path` is the registry entry's route segment
 * (e.g. "expenses", "cash-book"), `params` the filter set.
 */
export const getReport = (companyId, path, params = {}) =>
  httpClient.get(`${base(companyId)}/${path}`, { params: clean(params) });

/**
 * Download a report as .xlsx. Gated server-side by accounting.reports.export.
 * Returns a blob — the caller triggers the save.
 */
export const downloadReportExcel = (companyId, reportId, params = {}) =>
  httpClient.get(`${base(companyId)}/export/${reportId}`, {
    params: clean(params),
    responseType: "blob",
  });

/**
 * Strip empty values so the query string carries only real filters. Without
 * this, `?accountId=&payeeId=` reaches the server as empty strings and model
 * binding turns them into 400s on the nullable ints.
 */
function clean(params) {
  const out = {};
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === null || v === undefined || v === "" || Number.isNaN(v)) return;
    out[k] = v;
  });
  return out;
}

/** Save a blob response as a file, using the filename the server sent. */
export function saveBlob(response, fallbackName) {
  const disposition = response.headers?.["content-disposition"] || "";
  const match = /filename\*?=(?:UTF-8'')?"?([^;"]+)"?/i.exec(disposition);
  const name = match ? decodeURIComponent(match[1]) : fallbackName;

  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick — revoking synchronously cancels the download in
  // some browsers before it starts.
  setTimeout(() => window.URL.revokeObjectURL(url), 0);
}

import httpClient from "./httpClient";

// Spreadsheet import: recognise a workbook layout, preview what it would do,
// then write it. The companyId always travels in the request — never in the
// uploaded file — so a crafted workbook cannot aim itself at another tenant.
//
// Preview takes the FILE; commit takes the REVIEWED ROWS and never re-reads it,
// so what the operator approved on screen is exactly what lands.

const LONG = 300000;   // a 66-sheet ledger takes a while to parse and write

const upload = (path, file, params, fields = {}) => {
  const form = new FormData();
  form.append("file", file);
  Object.entries(fields).forEach(([k, v]) => {
    if (v !== undefined && v !== null) form.append(k, String(v));
  });
  return httpClient.post(path, form, {
    params,
    headers: { "Content-Type": "multipart/form-data" },
    timeout: LONG,
  });
};

/** Validate + fingerprint a workbook and look for a layout that recognises it. */
export const identifyWorkbook = ({ file, companyId, kind }) =>
  upload("/spreadsheet-import/identify", file, { companyId, kind });

export const previewOpeningStock = ({ file, companyId, profileId, mappingJson }) =>
  upload("/spreadsheet-import/opening-stock/preview", file,
    { companyId, ...(profileId ? { profileId } : {}) },
    profileId ? {} : { mappingJson });

export const commitOpeningStock = (body) =>
  httpClient.post("/spreadsheet-import/opening-stock/commit", body, { timeout: LONG });

export const previewCustomerLedger = ({ file, companyId, profileId, mappingJson }) =>
  upload("/spreadsheet-import/customer-ledger/preview", file,
    { companyId, ...(profileId ? { profileId } : {}) },
    profileId ? {} : { mappingJson });

export const commitCustomerLedger = (body) =>
  httpClient.post("/spreadsheet-import/customer-ledger/commit", body, { timeout: LONG });

// ── History ────────────────────────────────────────────────────────────────

export const getImportRuns = ({ companyId, kind, page = 1, pageSize = 25 }) =>
  httpClient.get("/spreadsheet-import/runs", { params: { companyId, kind, page, pageSize } });

/** Set a completed run aside so its file can be imported again. */
export const supersedeImportRun = ({ runId, companyId, reason }) =>
  httpClient.post(`/spreadsheet-import/runs/${runId}/supersede`, { reason }, { params: { companyId } });

// ── Saved layouts ──────────────────────────────────────────────────────────

export const getImportProfiles = ({ kind, companyId } = {}) =>
  httpClient.get("/import-profiles", { params: { kind, companyId } });

export const getImportProfile = (id) => httpClient.get(`/import-profiles/${id}`);

export const createImportProfile = (body) => httpClient.post("/import-profiles", body);

export const updateImportProfile = (id, body) => httpClient.put(`/import-profiles/${id}`, body);

export const getImportProfileVersions = (id) => httpClient.get(`/import-profiles/${id}/versions`);

export const rollbackImportProfile = (id, version, changeNote) =>
  httpClient.post(`/import-profiles/${id}/rollback`, { version, changeNote });

export const deleteImportProfile = (id) => httpClient.delete(`/import-profiles/${id}`);

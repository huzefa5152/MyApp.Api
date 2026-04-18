import httpClient from "./httpClient";

export const parsePdf = (file) => {
  const formData = new FormData();
  formData.append("file", file);
  return httpClient.post("/poimport/parse-pdf", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const parseText = (text) =>
  httpClient.post("/poimport/parse-text", { text });

export const ensureLookups = (descriptions, units) =>
  httpClient.post("/poimport/ensure-lookups", { descriptions, units });

// --- PO format registry + regression harness ---

export const listFormats = (companyId) =>
  httpClient.get("/poformats", { params: companyId ? { companyId } : {} });

export const getFormat = (id) => httpClient.get(`/poformats/${id}`);

export const getFormatVersions = (id) => httpClient.get(`/poformats/${id}/versions`);

export const fingerprintText = (rawText, companyId) =>
  httpClient.post("/poformats/fingerprint", { rawText, companyId });

export const fingerprintPdf = (file, companyId) => {
  const fd = new FormData();
  fd.append("file", file);
  const url = companyId ? `/poformats/fingerprint-pdf?companyId=${companyId}` : "/poformats/fingerprint-pdf";
  return httpClient.post(url, fd, { headers: { "Content-Type": "multipart/form-data" } });
};

export const createFormat = (payload) => httpClient.post("/poformats", payload);

// Gated rule update. If any verified golden sample regresses the server
// returns HTTP 409 with { error, report } — show the diff so the operator
// can fix the rule instead of surprising them with a successful save.
export const updateFormatRules = (id, ruleSetJson, changeNote, force = false) =>
  httpClient.put(`/poformats/${id}/rules${force ? "?force=true" : ""}`, { ruleSetJson, changeNote });

export const testRuleSet = (id, ruleSetJson, additionalRawText) =>
  httpClient.post(`/poformats/${id}/test`, { ruleSetJson, additionalRawText });

export const listSamples = (formatId) => httpClient.get(`/poformats/${formatId}/samples`);

// Create a verified golden sample from a successful parse. Subsequent rule
// edits replay against this to prevent regression.
export const addSample = (formatId, payload) => httpClient.post(`/poformats/${formatId}/samples`, payload);

export const deleteSample = (sampleId) => httpClient.delete(`/poformats/samples/${sampleId}`);

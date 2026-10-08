import httpClient from "./httpClient";

// Parse an uploaded PDF. The server returns the extracted fields when a
// saved POFormat matches, or HTTP 422 with { reason, message, rawText }
// when no format is saved for this layout yet — the caller should flip
// into "fill manually" mode in that case.
export const parsePdf = (file, companyId, clientId) => {
  const formData = new FormData();
  formData.append("file", file);
  const url = companyId ? `/poimport/parse-pdf?companyId=${companyId}${clientId ? `&clientId=${clientId}` : ""}` : "/poimport/parse-pdf";
  return httpClient.post(url, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

// Parse a PO read from a picture. `pages` is what utils/poOcr.readPoFile
// returned — the words and their boxes; the server lays them out and matches
// them against the saved PO formats exactly as it does a PDF. The original
// file is sent too, so the import archive keeps what the operator uploaded.
export const parseImage = (file, pages, companyId, clientId) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("words", JSON.stringify({ pages }));
  return httpClient.post(`/poimport/parse-image?companyId=${companyId}${clientId ? `&clientId=${clientId}` : ""}`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 120000,
  });
};

export const parseText = (text, companyId, clientId) =>
  httpClient.post(`/poimport/parse-text${companyId ? `?companyId=${companyId}${clientId ? `&clientId=${clientId}` : ""}` : ""}`, { text });

export const ensureLookups = (descriptions, units, companyId) =>
  httpClient.post("/poimport/ensure-lookups", { descriptions, units }, { params: { companyId } });

export const readWorkbook = (file, companyId, clientId, mapping) => {
  const body = new FormData();
  body.append("file", file);
  if (mapping) body.append("mapping", JSON.stringify(mapping));
  return httpClient.post("/poimport/workbook", body, { params: { companyId, clientId },
    headers: { "Content-Type": "multipart/form-data" } });
};

export const getWorkbookFormats = (companyId, clientId) => httpClient.get("/poimport/workbook-formats", { params: { companyId, clientId } });
export const saveWorkbookFormat = (companyId, clientId, name, mapping) => httpClient.post("/poimport/workbook-format", { name, mapping }, { params: { companyId, clientId } });

export const linkImportSource = (archiveId, documentKind, documentId) => httpClient.post(`/poimport/archives/${archiveId}/link`, { documentKind, documentId });

export const checkImportDuplicate = (archiveId, documentKind) => httpClient.get(`/poimport/archives/${archiveId}/duplicate`, { params: { documentKind } });

import httpClient from "./httpClient";

// Parse an uploaded PDF. The server returns the extracted fields when a
// saved POFormat matches, or HTTP 422 with { reason, message, rawText }
// when no format is saved for this layout yet — the caller should flip
// into "fill manually" mode in that case.
export const parsePdf = (file, companyId) => {
  const formData = new FormData();
  formData.append("file", file);
  const url = companyId ? `/poimport/parse-pdf?companyId=${companyId}` : "/poimport/parse-pdf";
  return httpClient.post(url, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

// Parse a PO read from a picture. `pages` is what utils/poOcr.readPoFile
// returned — the words and their boxes; the server lays them out and matches
// them against the saved PO formats exactly as it does a PDF. The original
// file is sent too, so the import archive keeps what the operator uploaded.
export const parseImage = (file, pages, companyId) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("words", JSON.stringify({ pages }));
  return httpClient.post(`/poimport/parse-image?companyId=${companyId}`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 120000,
  });
};

export const parseText = (text, companyId) =>
  httpClient.post(`/poimport/parse-text${companyId ? `?companyId=${companyId}` : ""}`, { text });

export const ensureLookups = (descriptions, units, companyId) =>
  httpClient.post("/poimport/ensure-lookups", { descriptions, units }, { params: { companyId } });

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

export const parseText = (text, companyId) =>
  httpClient.post(`/poimport/parse-text${companyId ? `?companyId=${companyId}` : ""}`, { text });

export const ensureLookups = (descriptions, units) =>
  httpClient.post("/poimport/ensure-lookups", { descriptions, units });

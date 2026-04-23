import http from "./httpClient";

// List formats — optionally scoped to a company and/or client.
export const listPoFormats = (params = {}) =>
  http.get("/poformats", { params });

export const getPoFormat = (id) => http.get(`/poformats/${id}`);

// Upload a sample PDF; server returns raw text + hash + any existing
// match. The Add/Edit form calls this first so the operator can see if
// a format for this layout is already saved before creating a duplicate.
export const fingerprintPdf = (file, companyId) => {
  const fd = new FormData();
  fd.append("file", file);
  return http.post("/poformats/fingerprint-pdf", fd, {
    params: companyId ? { companyId } : {},
    headers: { "Content-Type": "multipart/form-data" },
  });
};

// Primary onboarding path: 5 label/header strings + sample raw text.
export const createPoFormatSimple = (payload) =>
  http.post("/poformats/simple", payload);

// Edit existing format — same 5 strings + metadata.
export const updatePoFormatSimple = (id, payload) =>
  http.put(`/poformats/${id}/simple`, payload);

export const deletePoFormat = (id) => http.delete(`/poformats/${id}`);

import httpClient from "./httpClient";

// Parser-feedback API — isolated so the same file drops into either branch.
// Routes and payload keys are IDENTICAL across branches (see the backend
// ImportFeedbackController) so the whole feature cherry-picks cleanly.

// Record whether an import parsed correctly. Multipart so the original PDF is
// retained server-side. `file` is optional (null for pasted-text imports).
// status is "Correct" | "Incorrect". Best-effort: callers fire this AFTER the
// document is created and must not let a failure here block anything.
export const submitParserFeedback = ({
  status,
  file = null,
  purchaseOrderId = null,
  companyId = null,
  parserVersion = null,
  originalFileName = null,
}) => {
  const fd = new FormData();
  fd.append("feedbackStatus", status);
  if (file) fd.append("file", file);
  if (purchaseOrderId != null) fd.append("purchaseOrderId", purchaseOrderId);
  if (companyId != null) fd.append("companyId", companyId);
  if (parserVersion) fd.append("parserVersion", parserVersion);
  if (originalFileName) fd.append("originalFileName", originalFileName);
  return httpClient.post("/import-feedback", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

// Imports users flagged as incorrectly parsed (paged/filter/sort/date-range).
export const getIncorrectImports = (params = {}) =>
  httpClient.get("/import-feedback/incorrect", { params });

// Parser accuracy — overall + per parser version.
export const getParserFeedbackStatistics = () =>
  httpClient.get("/import-feedback/statistics");

// Single retained PDF (blob).
export const downloadFeedbackPdf = (id) =>
  httpClient.get(`/import-feedback/${id}/download`, { responseType: "blob" });

// Selected retained PDFs as a ZIP (blob).
export const downloadFeedbackPdfsZip = (ids) =>
  httpClient.post("/import-feedback/download", { ids }, { responseType: "blob" });

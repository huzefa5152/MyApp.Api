// src/api/attachmentApi.js
// Single client for the unified attachment + folder system — used by the
// Configuration → Folders library AND the reusable <AttachmentManager>.
import httpClient from "./httpClient";

// ── Folders ──────────────────────────────────────────────────────────
export const getFolders = (companyId) =>
  httpClient.get(`/folders/company/${companyId}`);

export const getPagedFolders = (companyId, params = {}) =>
  httpClient.get(`/folders/company/${companyId}/paged`, { params });

export const getFolder = (folderId) =>
  httpClient.get(`/folders/${folderId}`);

export const createFolder = (companyId, payload) =>
  httpClient.post(`/folders/company/${companyId}`, payload);

export const updateFolder = (folderId, payload) =>
  httpClient.put(`/folders/${folderId}`, payload);

export const deleteFolder = (folderId) =>
  httpClient.delete(`/folders/${folderId}`);

// ── Attachments ──────────────────────────────────────────────────────
// folderId / entityType / entityId are all optional. Sent as multipart so
// the same call serves folder uploads and transaction-document uploads.
export const uploadAttachment = (companyId, { file, folderId, entityType, entityId } = {}) => {
  const form = new FormData();
  form.append("file", file);
  if (folderId != null && folderId !== "") form.append("folderId", folderId);
  if (entityType) form.append("entityType", entityType);
  if (entityId != null) form.append("entityId", entityId);
  return httpClient.post(`/attachments/company/${companyId}`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const getAttachmentsByFolder = (companyId, folderId) =>
  httpClient.get(`/attachments/company/${companyId}/folder/${folderId}`);

// Attachments not filed in any folder (the always-present "Uncategorized" bucket).
export const getUncategorizedAttachments = (companyId) =>
  httpClient.get(`/attachments/company/${companyId}/uncategorized`);

export const getAttachmentsByEntity = (companyId, entityType, entityId) =>
  httpClient.get(`/attachments/company/${companyId}/entity/${entityType}/${entityId}`);

// Batch counts → { entityId: count } for list-card badges (one call for a page
// of records instead of one per card). Reusable across all transaction modules.
export const getEntityAttachmentCounts = (companyId, entityType, ids) =>
  httpClient.get(`/attachments/company/${companyId}/entity-counts/${entityType}`, {
    params: { ids: (ids || []).join(",") },
  });

// Bytes come back as a blob (the file is NOT publicly served — auth required).
// Callers build an object URL for preview, or trigger a download.
export const downloadAttachment = (attachmentId) =>
  httpClient.get(`/attachments/${attachmentId}/download`, { responseType: "blob" });

export const deleteAttachment = (attachmentId) =>
  httpClient.delete(`/attachments/${attachmentId}`);

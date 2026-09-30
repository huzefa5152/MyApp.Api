import httpClient from "./httpClient";
import { createInFlightRead } from "../utils/inFlightRead";

const invalidateReads = (request) => request.then(
  (response) => { getTemplatesByCompany.clear(); return response; },
  (error) => { getTemplatesByCompany.clear(); throw error; },
);
const templateWrites = {
  post: (...args) => invalidateReads(httpClient.post(...args)),
  put: (...args) => invalidateReads(httpClient.put(...args)),
  delete: (...args) => invalidateReads(httpClient.delete(...args)),
};


export const getTemplatesByCompany = createInFlightRead(
  (companyId) => httpClient.get(`/printtemplates/company/${companyId}`),
  () => localStorage.getItem("token"),
);

export const getTemplate = (companyId, templateType) =>
  httpClient.get(`/printtemplates/company/${companyId}/${templateType}`);

export const upsertTemplate = (companyId, templateType, htmlContent, templateJson, editorMode) =>
  templateWrites.put(`/printtemplates/company/${companyId}/${templateType}`, {
    htmlContent,
    templateJson: templateJson || null,
    editorMode: editorMode || null,
  });

// ── Multi-template management (id-based) ──

export const getTemplateById = (id) => httpClient.get(`/printtemplates/${id}`);

// payload: { templateType, name, htmlContent, templateJson, editorMode, isDefault, stampId }
export const createTemplate = (companyId, payload) =>
  templateWrites.post(`/printtemplates/company/${companyId}`, {
    templateType: payload.templateType,
    name: payload.name,
    htmlContent: payload.htmlContent ?? "",
    templateJson: payload.templateJson || null,
    editorMode: payload.editorMode || null,
    isDefault: payload.isDefault ?? false,
    // Duplicate / copy-to-type / new-from-copy pass the source's signature so
    // the new template starts life signed the same way. The server validates
    // the stamp belongs to the target company.
    stampId: payload.stampId ?? null,
  });

export const updateTemplateById = (id, payload) =>
  templateWrites.put(`/printtemplates/${id}`, {
    name: payload.name,
    htmlContent: payload.htmlContent ?? "",
    templateJson: payload.templateJson || null,
    editorMode: payload.editorMode || null,
  });

export const setDefaultTemplate = (id) =>
  templateWrites.put(`/printtemplates/${id}/default`);

// Seed one default template per document type for a company (idempotent —
// types that already have a template are skipped). `defaults` is an array of
// { templateType, name, htmlContent }. Used right after a company is created so
// every document screen has a working default template from day one.
export const seedDefaultTemplates = (companyId, defaults) =>
  templateWrites.post(`/printtemplates/company/${companyId}/seed-defaults`, defaults);

export const deleteTemplate = (id) =>
  templateWrites.delete(`/printtemplates/${id}`);

// Apply a starter design onto an EXISTING template.
// mode: "html" (replace body HTML, keep layout+metadata) | "all" (replace layout too).
export const applyStarterToTemplate = (id, { htmlContent, mode = "html", starterName }) =>
  templateWrites.post(`/printtemplates/${id}/apply-starter`, {
    htmlContent: htmlContent ?? "",
    mode,
    starterName: starterName || null,
  });

export const getMergeFields = (templateType) =>
  httpClient.get(`/mergefields/${templateType}`);

// ── Excel Template APIs (legacy, company-default) ──

export const uploadExcelTemplate = (companyId, templateType, file, sheetName) => {
  const form = new FormData();
  form.append("file", file);
  if (sheetName) form.append("sheetName", sheetName);
  return templateWrites.post(
    `/printtemplates/company/${companyId}/${templateType}/excel-template`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
};

export const setExcelSheetName = (companyId, templateType, sheetName) =>
  templateWrites.put(
    `/printtemplates/company/${companyId}/${templateType}/excel-template/sheet-name`,
    { sheetName: sheetName || null }
  );

export const deleteExcelTemplate = (companyId, templateType) =>
  templateWrites.delete(`/printtemplates/company/${companyId}/${templateType}/excel-template`);

export const hasExcelTemplate = (companyId, templateType) =>
  httpClient.get(`/printtemplates/company/${companyId}/${templateType}/has-excel-template`);

export const exportExcel = (companyId, templateType, printData) =>
  templateWrites.post(
    `/printtemplates/company/${companyId}/${templateType}/export-excel`,
    printData,
    { responseType: "blob" }
  );

// ── Excel APIs (id-based, for the multi-template editor) ──

export const uploadExcelTemplateById = (id, file, sheetName) => {
  const form = new FormData();
  form.append("file", file);
  if (sheetName) form.append("sheetName", sheetName);
  return templateWrites.post(`/printtemplates/${id}/excel-template`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const setExcelSheetNameById = (id, sheetName) =>
  templateWrites.put(`/printtemplates/${id}/excel-template/sheet-name`, {
    sheetName: sheetName || null,
  });

export const deleteExcelTemplateById = (id) =>
  templateWrites.delete(`/printtemplates/${id}/excel-template`);

// Assign / clear the stamp rendered in this template's {{stamp}} slot.
// htmlContent is sent only by the convert-to-slot and add-signature-block
// flows, which must change markup and assignment in one write.
export const setTemplateStamp = (id, stampId, htmlContent = null) =>
  templateWrites.put(`/printtemplates/${id}/stamp`, { stampId, htmlContent });

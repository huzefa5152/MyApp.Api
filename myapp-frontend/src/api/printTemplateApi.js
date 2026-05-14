import httpClient from "./httpClient";

export const getTemplatesByCompany = (companyId) =>
  httpClient.get(`/printtemplates/company/${companyId}`);

export const getTemplate = (companyId, templateType) =>
  httpClient.get(`/printtemplates/company/${companyId}/${templateType}`);

export const upsertTemplate = (companyId, templateType, htmlContent, templateJson, editorMode) =>
  httpClient.put(`/printtemplates/company/${companyId}/${templateType}`, {
    htmlContent,
    templateJson: templateJson || null,
    editorMode: editorMode || null,
  });

export const getMergeFields = (templateType) =>
  httpClient.get(`/mergefields/${templateType}`);

// ── Excel Template APIs ──

export const uploadExcelTemplate = (companyId, templateType, file, sheetName) => {
  const form = new FormData();
  form.append("file", file);
  if (sheetName) form.append("sheetName", sheetName);
  return httpClient.post(
    `/printtemplates/company/${companyId}/${templateType}/excel-template`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
};

export const setExcelSheetName = (companyId, templateType, sheetName) =>
  httpClient.put(
    `/printtemplates/company/${companyId}/${templateType}/excel-template/sheet-name`,
    { sheetName: sheetName || null }
  );

export const deleteExcelTemplate = (companyId, templateType) =>
  httpClient.delete(`/printtemplates/company/${companyId}/${templateType}/excel-template`);

export const hasExcelTemplate = (companyId, templateType) =>
  httpClient.get(`/printtemplates/company/${companyId}/${templateType}/has-excel-template`);

export const exportExcel = (companyId, templateType, printData) =>
  httpClient.post(
    `/printtemplates/company/${companyId}/${templateType}/export-excel`,
    printData,
    { responseType: "blob" }
  );

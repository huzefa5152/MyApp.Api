import httpClient from "./httpClient";

export const getTemplatesByCompany = (companyId) =>
  httpClient.get(`/printtemplates/company/${companyId}`);

export const getTemplate = (companyId, templateType) =>
  httpClient.get(`/printtemplates/company/${companyId}/${templateType}`);

export const upsertTemplate = (companyId, templateType, htmlContent) =>
  httpClient.put(`/printtemplates/company/${companyId}/${templateType}`, { htmlContent });

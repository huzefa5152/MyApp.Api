import httpClient from "./httpClient";

// Legacy Data_2021 ETL — admin/ops only. Backend triple-gates these
// (accounting.import.run + non-Production + LegacyDb configured), so in prod
// they return 404. Run in order: masters -> documents -> receipts/payments.
export const importMasters = (companyId) =>
  httpClient.post(`/legacy-import/company/${companyId}/masters`);

export const importDocuments = (companyId) =>
  httpClient.post(`/legacy-import/company/${companyId}/documents`);

export const importReceiptsPayments = (companyId) =>
  httpClient.post(`/legacy-import/company/${companyId}/receipts-payments`);

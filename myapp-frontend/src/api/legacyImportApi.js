import httpClient from "./httpClient";

// Legacy Data_2021 ETL — admin/ops only. Backend triple-gates these
// (accounting.import.run + non-Production + a reachable SQL Server), so in prod
// they return 404. Flow: upload backup -> masters -> documents ->
// receipts/payments (all read from the restored temp DB `source`) -> cleanup.

// Upload a .bak; the server restores it to a temp DB and returns
// { sourceDb, costCentreName, divisions[], salesInvoices, salesQuotes, purchaseBills }.
export const uploadBackup = (file) => {
  const form = new FormData();
  form.append("file", file);
  return httpClient.post("/legacy-import/upload-backup", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const cleanupBackup = (source) =>
  httpClient.post(`/legacy-import/cleanup`, null, { params: { source } });

export const importMasters = (companyId, source) =>
  httpClient.post(`/legacy-import/company/${companyId}/masters`, null, { params: { source } });

export const importDocuments = (companyId, source) =>
  httpClient.post(`/legacy-import/company/${companyId}/documents`, null, { params: { source } });

export const importReceiptsPayments = (companyId, source) =>
  httpClient.post(`/legacy-import/company/${companyId}/receipts-payments`, null, { params: { source } });

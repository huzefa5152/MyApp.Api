import httpClient from "./httpClient";

export const readCosts = (kind, id) => httpClient.get(`/commercial-costs/${kind}/${id}`);
export const billPayables = id => httpClient.get(`/commercial-costs/bill/${id}/payables`);
export const saveCosts = (kind, id, data) => httpClient.patch(`/commercial-costs/${kind}/${id}`, data);
export const createLocalPurchases = (kind, id, data) => httpClient.post(`/commercial-costs/${kind}/${id}/purchases`, data);
export const supplierSummary = (companyId, params) => httpClient.get(`/commercial-costs/suppliers/${companyId}`, { params });
export const supplierLedger = (companyId, supplierId, params) => httpClient.get(`/commercial-costs/suppliers/${companyId}/${supplierId}`, { params });

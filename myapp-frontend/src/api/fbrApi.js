import httpClient from "./httpClient";

export const getFbrProvinces = (companyId) =>
  httpClient.get(`/fbr/provinces/${companyId}`);

export const getFbrDocTypes = (companyId) =>
  httpClient.get(`/fbr/doctypes/${companyId}`);

export const getFbrHSCodes = (companyId, search) =>
  httpClient.get(`/fbr/hscodes/${companyId}`, { params: { search } });

// Get allowed UOMs for a specific HS code (FBR V1.12 §5.9).
// annexureId = 3 for sales annexure (default).
export const getFbrHsUom = (companyId, hsCode, annexureId = 3) =>
  httpClient.get(`/fbr/hsuom/${companyId}`, { params: { hsCode, annexureId } });

export const getFbrUOMs = (companyId) =>
  httpClient.get(`/fbr/uom/${companyId}`);

export const getFbrTransactionTypes = (companyId) =>
  httpClient.get(`/fbr/transactiontypes/${companyId}`);

export const getFbrSaleTypeRates = (companyId, date, transTypeId, provinceId) =>
  httpClient.get(`/fbr/saletyperates/${companyId}`, {
    params: { date, transTypeId, provinceId },
  });

export const submitInvoiceToFbr = (invoiceId) =>
  httpClient.post(`/fbr/${invoiceId}/submit`);

export const validateInvoiceWithFbr = (invoiceId) =>
  httpClient.post(`/fbr/${invoiceId}/validate`);

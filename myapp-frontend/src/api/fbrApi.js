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

// Catalog of all 28 FBR scenarios (SN001..SN028) with metadata —
// drives the bill-creation Scenario picker so item types can be filtered
// by sale type compatibility.
export const getFbrScenarios = () => httpClient.get("/fbr/scenarios");

// Subset of scenarios applicable to a company's BusinessActivity × Sector
// profile.
export const getFbrApplicableScenarios = (companyId) =>
  httpClient.get(`/fbr/scenarios/applicable/${companyId}`);

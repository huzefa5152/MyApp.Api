import httpClient from "./httpClient";

export const getDivisionsByCompany = (companyId) =>
  httpClient.get(`/divisions/company/${companyId}`);

// payload: { name, brandName, fullAddress, phone, ntn, cnic, strn, startingSalesQuoteNumber }
// (logo is uploaded separately via uploadDivisionLogo after the row exists)
export const createDivision = (companyId, payload) =>
  httpClient.post(`/divisions/company/${companyId}`, payload);

export const updateDivision = (id, payload) =>
  httpClient.put(`/divisions/${id}`, payload);

export const deleteDivision = (id) =>
  httpClient.delete(`/divisions/${id}`);

// Upload a division logo (multipart). Mirrors uploadCompanyLogo; returns the
// updated division DTO with its new logoPath.
export const uploadDivisionLogo = (id, formData) =>
  httpClient.post(`/divisions/${id}/logo`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

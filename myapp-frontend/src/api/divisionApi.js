import httpClient from "./httpClient";

export const getDivisionsByCompany = (companyId) =>
  httpClient.get(`/divisions/company/${companyId}`);

export const createDivision = (companyId, name) =>
  httpClient.post(`/divisions/company/${companyId}`, { name });

export const updateDivision = (id, name) =>
  httpClient.put(`/divisions/${id}`, { name });

export const deleteDivision = (id) =>
  httpClient.delete(`/divisions/${id}`);

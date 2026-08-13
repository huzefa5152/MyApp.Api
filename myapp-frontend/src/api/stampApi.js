import httpClient from "./httpClient";

// Company stamps — images usable in print templates as {{stamps.<slug>}}.
export const getCompanyStamps = (companyId) =>
  httpClient.get(`/companies/${companyId}/stamps`);

export const uploadStamp = (companyId, file, name) => {
  const form = new FormData();
  form.append("file", file);
  if (name) form.append("name", name);
  return httpClient.post(`/companies/${companyId}/stamps`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const updateStamp = (companyId, id, payload) =>
  httpClient.put(`/companies/${companyId}/stamps/${id}`, payload);

export const deleteStamp = (companyId, id) =>
  httpClient.delete(`/companies/${companyId}/stamps/${id}`);

// Make this the company's default stamp — pre-selected in pickers and used by
// the built-in fallback templates, which have no row to carry an assignment.
export const setDefaultStamp = (companyId, id) =>
  httpClient.put(`/companies/${companyId}/stamps/${id}/default`);

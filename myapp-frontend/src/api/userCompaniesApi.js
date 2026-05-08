import http from "./httpClient";

// User → Company tenant-access assignments. Reads need
// `tenantaccess.manage.view`; writes need `tenantaccess.manage.assign`.
// The seed admin always bypasses the access guard, so the grid hides it.
export const getAllAssignments = () => http.get("/usercompanies");
export const getAssignmentForUser = (userId) =>
  http.get(`/usercompanies/user/${userId}`);
export const setUserCompanies = (userId, companyIds) =>
  http.put(`/usercompanies/user/${userId}`, { companyIds });

import http from "./httpClient";

// User → Company tenant-access assignments. Reads need
// `tenantaccess.manage.view`; writes need `tenantaccess.manage.assign`.
// The seed admin always bypasses the access guard, so the grid hides it.
export const getAllAssignments = () => http.get("/usercompanies");
export const getAssignmentForUser = (userId) =>
  http.get(`/usercompanies/user/${userId}`);
export const setUserCompanies = (userId, companyIds) =>
  http.put(`/usercompanies/user/${userId}`, { companyIds });

// User → Division access within one company (the layer below the company
// grant). Reads need `divisionaccess.manage.view`; writes need
// `divisionaccess.manage.assign`. Both routes are tenant-guarded, so a
// caller without access to an isolated company gets a 403.
export const getDivisionAssignments = (companyId) =>
  http.get(`/userdivisions/company/${companyId}`);
export const setUserDivisions = (userId, companyId, { restrictToDivisions, divisionIds }) =>
  http.put(`/userdivisions/user/${userId}/company/${companyId}`, {
    restrictToDivisions,
    divisionIds,
  });

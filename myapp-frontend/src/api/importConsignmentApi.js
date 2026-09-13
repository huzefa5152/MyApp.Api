import httpClient from "./httpClient";

// The read + correction side of the GD costing import (Task 21) --
// Controllers/ImportConsignmentsController.cs. gd-costing/preview + commit
// (spreadsheetImportApi.js) WRITE a consignment; these three calls are what
// let an operator see what was written, and undo it if it was wrong.

export const getImportConsignments = ({ companyId, page = 1, pageSize = 25 }) =>
  httpClient.get("/import-consignments", { params: { companyId, page, pageSize } });

export const getImportConsignment = (id) => httpClient.get(`/import-consignments/${id}`);

// Undoes exactly what the commit did (cost written, balances created, journal
// entry posted) or refuses the whole thing -- see the service for the rules.
export const deleteImportConsignment = (id) => httpClient.delete(`/import-consignments/${id}`);

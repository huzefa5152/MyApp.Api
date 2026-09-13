import httpClient from "./httpClient";

// The read + correction side of the GD costing import (Task 21) --
// Controllers/ImportConsignmentsController.cs. gd-costing/preview + commit
// (spreadsheetImportApi.js) WRITE a consignment; these three calls are what
// let an operator see what was written, and undo it if it was wrong.

// onlyOutstanding narrows the page to consignments that still owe something;
// either way the response's totalOutstanding is the company-wide figure,
// unaffected by the page or the filter (Task 23).
export const getImportConsignments = ({ companyId, page = 1, pageSize = 25, onlyOutstanding = false }) =>
  httpClient.get("/import-consignments", { params: { companyId, page, pageSize, onlyOutstanding } });

export const getImportConsignment = (id) => httpClient.get(`/import-consignments/${id}`);

// Undoes exactly what the commit did (cost written, balances created, journal
// entry posted) or refuses the whole thing -- see the service for the rules.
export const deleteImportConsignment = (id) => httpClient.delete(`/import-consignments/${id}`);

// Correct ONE line of a recorded GD in place -- the surgical alternative to
// deleting and re-importing, which a settled consignment cannot do at all.
// Sends the costing INPUTS; the server recomputes the cost and the selling
// value itself and re-derives the balance and the journal entry from them.
export const updateImportConsignmentLine = (id, lineId, body) =>
  httpClient.put(`/import-consignments/${id}/lines/${lineId}`, body);

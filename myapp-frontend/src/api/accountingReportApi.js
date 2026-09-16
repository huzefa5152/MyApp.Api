import httpClient from "./httpClient";

// Accounting reports. Every one is company-scoped on the route, so a report can
// never be asked for two companies at once.

const q = (companyId, name, params = {}) =>
  httpClient.get(`/accounting/reports/company/${companyId}/${name}`, { params });

export const getBalanceSheet = (companyId, asOf) => q(companyId, "balance-sheet", { asOf });
export const getProfitAndLoss = (companyId, from, to) => q(companyId, "profit-and-loss", { from, to });
export const getAgedReceivables = (companyId, asOf) => q(companyId, "aged-receivables", { asOf });
export const getAgedPayables = (companyId, asOf) => q(companyId, "aged-payables", { asOf });
export const getCashBook = (companyId, from, to) => q(companyId, "cash-book", { from, to });
export const getExpenseReport = (companyId, from, to) => q(companyId, "expenses", { from, to });
export const getTaxControl = (companyId, from, to) => q(companyId, "tax-control", { from, to });
export const getAccountingDashboard = (companyId, from, to) => q(companyId, "dashboard", { from, to });

export const getPartyLedger = (companyId, partyType, partyId, from, to) =>
  q(companyId, "party-ledger", { partyType, partyId, from, to });

// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Page from "./InvoiceSalesDetailPage";
import { getInvoiceSalesDetail as fetchReport, getInvoiceSalesDetailExcel as exportReport } from "../api/reportApi";
const { state } = vi.hoisted(() => ({ state: { company: { id: 1 }, permissions: new Set() } }));
vi.mock("../contexts/CompanyContext", () => ({ useCompany: () => ({ companies: [state.company], selectedCompany: state.company, setSelectedCompany: vi.fn() }) }));
vi.mock("../contexts/PermissionsContext", () => ({ usePermissions: () => ({ has: k => state.permissions.has(k) }) }));
vi.mock("../api/reportApi", () => ({ getInvoiceSalesDetail: vi.fn(), getInvoiceSalesDetailExcel: vi.fn() }));
vi.mock("../Components/SearchableClientSelect", () => ({ default: ({ clients, value, onChange }) => <select aria-label="Client" value={value} onChange={e => onChange(e.target.value)}><option value="">All clients</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select> }));
const data = (companyName = "Sample company") => ({ companyId: 1, companyName, rows: [], buyers: [{ clientId: 9, name: "Sample buyer" }], periodLabel: "This month", from: "2026-10-01", to: "2026-10-31", invoiceCount: 0 });
const change = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const loaded = () => screen.findByRole("heading", { name: /Sample company/ });
beforeEach(() => { vi.clearAllMocks(); state.company = { id: 1 }; state.permissions = new Set(["reports.invoicedetail.view", "reports.invoicedetail.export"]); fetchReport.mockResolvedValue({ data: data() }); exportReport.mockResolvedValue({ data: new Blob(["workbook"]) }); URL.createObjectURL = vi.fn(() => "blob:test"); URL.revokeObjectURL = vi.fn(); vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("applies every filter immediately and exports the same query", async () => {
 render(<Page />); await loaded(); expect(screen.queryByRole("button", { name: /apply/i })).toBeNull();
 change("Period", "lastMonth"); change("Client", "9"); change("FBR status", "submitted"); change("Search bills", "2mm");
 await waitFor(() => expect(fetchReport.mock.lastCall[1]).toEqual({ period: "lastMonth", clientId: "9", fbrStatus: "submitted", search: "2mm" }));
 await waitFor(() => expect(screen.getByRole("button", { name: "Excel" }).disabled).toBe(false)); fireEvent.click(screen.getByRole("button", { name: "Excel" })); expect(exportReport).toHaveBeenCalledWith(1, fetchReport.mock.lastCall[1]);
});
it("waits for a complete valid custom range", async () => {
 render(<Page />); await loaded(); fetchReport.mockClear(); change("Period", "custom"); change("From", "2026-10-18"); change("To", "2026-10-01");
 expect(fetchReport).not.toHaveBeenCalled(); expect(screen.getByRole("button", { name: "Excel" }).disabled).toBe(true);
 change("To", "2026-10-31"); await waitFor(() => expect(fetchReport.mock.lastCall[1]).toEqual({ period: "custom", from: "2026-10-18", to: "2026-10-31" }));
});
it("aborts old requests and ignores out-of-order responses", async () => {
 let old, current; fetchReport.mockImplementationOnce(() => new Promise(r => { old = r; })).mockImplementationOnce(() => new Promise(r => { current = r; }));
 render(<Page />); change("Search bills", "new"); expect(fetchReport.mock.calls[0][2].signal.aborted).toBe(true);
 await act(async () => current({ data: data("Newest result") })); await screen.findByRole("heading", { name: /Newest result/ });
 await act(async () => old({ data: data("Old result") })); expect(screen.queryByText(/Old result/)).toBeNull();
});
it("clears buyer filters and stale content on company switch", async () => {
 const view = render(<Page />); await loaded(); change("Client", "9"); await waitFor(() => expect(fetchReport.mock.lastCall[1].clientId).toBe("9"));
 fetchReport.mockImplementation(() => new Promise(() => {})); state.company = { id: 2 }; view.rerender(<Page />);
 expect(screen.queryByRole("heading", { name: /Sample company/ })).toBeNull(); expect(screen.getByLabelText("Client").value).toBe(""); expect(screen.queryByRole("option", { name: "Sample buyer" })).toBeNull(); expect(fetchReport.mock.lastCall.slice(0, 2)).toEqual([2, { period: "thisMonth" }]);
});
it("does not fetch without view permission", () => { state.permissions.clear(); render(<Page />); expect(fetchReport).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "Excel" })).toBeNull(); });
it("hides Excel without export permission", async () => { state.permissions.delete("reports.invoicedetail.export"); render(<Page />); await loaded(); expect(screen.queryByRole("button", { name: "Excel" })).toBeNull(); });
it("handles companies still loading without a request or render error", () => { state.company = null; render(<Page />); expect(screen.getByText("Select a company to view this report.")).toBeTruthy(); expect(fetchReport).not.toHaveBeenCalled(); });

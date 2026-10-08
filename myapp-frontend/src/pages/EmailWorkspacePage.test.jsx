// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import EmailWorkspacePage from "./EmailWorkspacePage";
import http from "../api/httpClient";
const state = vi.hoisted(() => ({ selectedCompany: { id: 1, name: "Sample Company" }, companies: [], setSelectedCompany: vi.fn(), allowed: new Set() }));
const has = vi.hoisted(() => key => state.allowed.has(key));
vi.mock("../contexts/CompanyContext", () => ({ useCompany: () => state }));
vi.mock("../contexts/PermissionsContext", () => ({ usePermissions: () => ({ has }) }));
vi.mock("../api/httpClient", () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock("../api/clientApi", () => ({ getClientsByCompany: () => Promise.resolve({ data: [{ id: 7, name: "Sample Customer" }] }) }));
vi.mock("../Components/LineItemsEditor", () => ({ default: () => <p>Review item editor</p> }));
const message = { id: 3, sender: "buyer@example.com", subject: "Sample RFQ", receivedAt: "2026-10-08T10:00:00Z", decision: "Unreviewed", revision: null, text: "Please quote", attachments: [] };
const setup = () => render(<MemoryRouter><EmailWorkspacePage /></MemoryRouter>);
beforeEach(() => {
  vi.resetAllMocks(); state.selectedCompany = { id: 1, name: "Sample Company" };
  state.companies = [state.selectedCompany, { id: 2, name: "Other Company" }];
  state.allowed = new Set(["email.workspace.use", "email.inbox.view", "email.inbox.manage", "email.enquiries.manage", "email.connections.manage", "salesquotes.manage.create"]);
  http.get.mockImplementation(url => Promise.resolve({ data: url.endsWith("/customers") ? [] : url.endsWith("/connections") ? { configured: true, links: [], ownConnections: [] } : url.endsWith("/messages") ? { items: [message], totalCount: 1 } : message }));
  http.put.mockResolvedValue({ data: { revision: "new-revision" } });
});
afterEach(cleanup);
it("requires Keep before exposing quotation preparation", async () => {
  setup(); fireEvent.click(await screen.findByText("Sample RFQ"));
  await screen.findByText("Please quote");
  expect(screen.queryByText("Prepare quotation")).toBeNull();
  fireEvent.click(screen.getByText("Keep enquiry"));
  await waitFor(() => expect(http.put).toHaveBeenCalledWith("/email-workspace/company/1/messages/3/decision", { decision: "Kept", revision: null }));
});
it("read-only users have no decision or quotation buttons", async () => {
  state.allowed = new Set(["email.workspace.use", "email.inbox.view"]); setup();
  fireEvent.click(await screen.findByText("Sample RFQ")); await screen.findByText("Please quote");
  expect(screen.queryByText("Keep enquiry")).toBeNull(); expect(screen.queryByText("Ignore")).toBeNull();
  fireEvent.click(screen.getByText("Connections")); expect(screen.queryByText("Connect Gmail")).toBeNull();
});
it("switching companies clears a source and rejects a late old-company response", async () => {
  let finish;
  http.get.mockImplementation(url => {
    if (url.endsWith("/customers")) return Promise.resolve({ data: [] }); if (url.endsWith("/connections")) return Promise.resolve({ data: { configured: true, links: [], ownConnections: [] } });
    if (url.includes("company/1/messages")) return new Promise(resolve => { finish = resolve; });
    return Promise.resolve({ data: { items: [{ ...message, id: 8, subject: "Other company RFQ" }], totalCount: 1 } });
  });
  const view = setup(); state.selectedCompany = { id: 2, name: "Other Company" };
  view.rerender(<MemoryRouter><EmailWorkspacePage /></MemoryRouter>);
  await screen.findByText("Other company RFQ"); await act(async () => finish({ data: { items: [message], totalCount: 1 } }));
  expect(screen.queryByText("Sample RFQ")).toBeNull();
});
it("conversion stays disabled until the operator confirms review", async () => {
  http.get.mockImplementation(url => Promise.resolve({ data: url.endsWith("/customers") ? [] : url.endsWith("/connections") ? { configured: true, links: [], ownConnections: [] } : url.endsWith("/messages") ? { items: [message], totalCount: 1 } : { ...message, decision: "Kept", revision: "r", draft: { items: [], warnings: [], date: "2026-10-08", gstRate: 18, reviewed: false } } }));
  setup(); fireEvent.click(await screen.findByText("Sample RFQ"));
  const convert = await screen.findByText("Create quotation"); expect(convert.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/I reviewed the customer/)); expect(convert.disabled).toBe(false);
  expect(http.post).not.toHaveBeenCalled();
});

it("does not load mail or expose connections without the module grant", () => {
  state.allowed.delete("email.workspace.use"); setup();
  expect(screen.getByRole("alert").textContent).toContain("not assigned");
  expect(http.get).not.toHaveBeenCalled();
  expect(screen.queryByText("Connect Gmail")).toBeNull();
});
it("module access alone does not grant inbox access", () => {
  state.allowed = new Set(["email.workspace.use"]); setup();
  expect(screen.getByRole("alert").textContent).toContain("inbox permission");
  expect(http.get).not.toHaveBeenCalled();
});

it("keeps company selection available in Connections and selects only accessible companies", async () => {
  setup();
  fireEvent.change(screen.getByRole("combobox", { name: "Email workspace company" }), { target: { value: "2" } });
  expect(state.setSelectedCompany).toHaveBeenCalledWith(state.companies[1]);
  expect(screen.getAllByRole("option").map(o => o.value)).toEqual(["1", "2"]);
  fireEvent.click(screen.getByRole("button", { name: "Connections" }));
  expect(screen.getByRole("combobox", { name: "Email workspace company" })).toBeTruthy();
});
it("offers company selection without loading mail when no company is selected", () => {
  state.selectedCompany = null; setup();
  expect(screen.getByRole("combobox", { name: "Email workspace company" })).toBeTruthy();
  expect(http.get).not.toHaveBeenCalled();
});

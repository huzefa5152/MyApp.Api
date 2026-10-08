// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DashboardLayout from "./DashboardLayout";
const state = vi.hoisted(() => ({ allowed: new Set() }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: 2, username: "sample" }, logout: vi.fn() }) }));
vi.mock("../contexts/CompanyContext", () => ({ useCompany: () => ({ companies: [{ id: 1 }], loading: false }) }));
vi.mock("../contexts/PermissionsContext", () => ({
  usePermissions: () => ({ has: key => state.allowed.has(key), hasAny: keys => keys.some(key => state.allowed.has(key)) }),
  Can: ({ permission, children }) => state.allowed.has(permission) ? children : null,
}));
afterEach(() => { cleanup(); localStorage.clear(); });
function show(keys, path="/dashboard") {
  state.allowed = new Set(keys);
  render(<MemoryRouter initialEntries={[path]}><DashboardLayout /></MemoryRouter>);
  return screen.getByRole("navigation");
}
it("keeps legacy Trader navigation unchanged when email is unassigned", () => {
  const nav=show(["dashboard.view", "salesquotes.list.view"]);
  expect(within(nav).getByText("Sales")).toBeTruthy();
  expect(within(nav).getByText("Sales Quotes")).toBeTruthy();
  expect(within(nav).queryByText("Email Workspace")).toBeNull();
  expect(within(nav).queryByRole("link", {name: "Inbox & Connections"})).toBeNull();
});
it("shows Email Workspace as its own active module without opening Sales", () => {
  const nav=show(["email.workspace.use", "email.inbox.view"], "/email-workspace");
  expect(within(nav).getByRole("button", {name: /Email Workspace/}).getAttribute("aria-expanded")).toBe("true");
  expect(within(nav).getByRole("link", {name: "Inbox & Connections"}).getAttribute("href")).toBe("/email-workspace");
  expect(within(nav).queryByText("Sales")).toBeNull();
});
it("hides the module when only an email action permission is granted", () => {
  const nav=show(["email.inbox.view", "email.connections.manage"]);
  expect(within(nav).queryByText("Email Workspace")).toBeNull();
});

// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import HsCodeAutocomplete from "./HsCodeAutocomplete";
import { getFbrHSCodes } from "../api/fbrApi";
vi.mock("../api/fbrApi", () => ({ getFbrHSCodes: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);
it("catalog browsing excludes saved company codes and keeps other FBR codes", async () => {
  getFbrHSCodes.mockResolvedValue({ data: [{ hS_CODE: "9403.6000", description: "Already saved" }, { hS_CODE: "9401.3000", description: "Available chair" }] });
  render(<HsCodeAutocomplete companyId={7} excludeHsCodes={["9403.6000"]} />);
  fireEvent.focus(screen.getByRole("textbox"));
  await screen.findByText("Available chair");
  expect(screen.queryByText("Already saved")).toBeNull();
  expect(getFbrHSCodes).toHaveBeenCalledWith(7, "", null, { excludeSaved: true, includeHsCode: undefined });
});
it("invoice search includes all FBR results without saved-code exclusion", async () => {
  getFbrHSCodes.mockResolvedValue({ data: [{ hS_CODE: "9403.6000", description: "FBR furniture" }] });
  render(<HsCodeAutocomplete companyId={7} />);
  fireEvent.focus(screen.getByRole("textbox"));
  await screen.findByText("FBR furniture");
  expect(getFbrHSCodes).toHaveBeenCalledWith(7, "", null, {});
});
it("a company switch discards late responses from the previous company", async () => {
  let complete;
  getFbrHSCodes.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const { rerender } = render(<HsCodeAutocomplete companyId={7} />);
  fireEvent.focus(screen.getByRole("textbox"));
  await waitFor(() => expect(getFbrHSCodes).toHaveBeenCalledOnce());
  rerender(<HsCodeAutocomplete companyId={8} />);
  complete({ data: [{ hS_CODE: "9403.6000", description: "Previous company result" }] });
  await waitFor(() => expect(screen.queryByText("Previous company result")).toBeNull());
});
it("staff lookup errors give a visible recovery message", async () => {
  getFbrHSCodes.mockRejectedValue({ response: { data: { message: "Catalog unavailable. Retry." } } });
  render(<HsCodeAutocomplete companyId={7} />);
  fireEvent.focus(screen.getByRole("textbox"));
  expect((await screen.findByRole("alert")).textContent).toContain("Catalog unavailable. Retry.");
});

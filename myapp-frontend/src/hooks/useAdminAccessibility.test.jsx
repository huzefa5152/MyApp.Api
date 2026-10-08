// @vitest-environment jsdom
import React, { useState } from "react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import useAdminAccessibility from "./useAdminAccessibility";

function Surface({ busy = false, onClose = () => {}, closePopupOnEscape = false }) {
  useAdminAccessibility();
  const [open, setOpen] = useState(false);
  const [nested, setNested] = useState(false);
  const [popup, setPopup] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open form</button>
    {open && <div data-admin-backdrop="" style={{ zIndex: 1100 }}><div data-admin-dialog="">
      <h2>Client details</h2><label>Name</label><input />
      <button onClick={() => setNested(true)}>Open confirmation</button>
      <button onClick={() => setPopup(true)}>Open picker</button>
      <button data-admin-close="" disabled={busy} onClick={() => { onClose(); setOpen(false); }}>Cancel</button>
      {popup && createPortal(<div data-admin-popup=""><input aria-label="Picker search" onKeyDown={event => { if (closePopupOnEscape && event.key === "Escape") setPopup(false); }} /></div>, document.body)}
    </div></div>}
    {nested && createPortal(<div data-admin-backdrop="" style={{ zIndex: 1101 }}><div data-admin-dialog="">
      <h3>Confirm change</h3><button data-admin-close="" onClick={() => setNested(false)}>Back</button>
    </div></div>, document.body)}
    <div data-admin-table-region=""><table><tbody><tr><td>Example</td></tr></tbody></table></div>
  </>;
}
beforeEach(() => {
  document.body.classList.add("admin-ui");
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(() => [{ width: 100, height: 40 }]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.body.classList.remove("admin-ui"); document.body.style.overflow = ""; });
async function open() {
  const opener = screen.getByText("Open form"); opener.focus(); fireEvent.click(opener);
  const dialog = await screen.findByRole("dialog", { name: "Client details" });
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  return { opener, dialog };
}
it("names dialogs and fields, contains keyboard focus, restores the opener and unlocks scrolling", async () => {
  render(<Surface />); const { opener, dialog } = await open();
  expect(screen.getByLabelText("Name").tagName).toBe("INPUT");
  expect(document.body.style.overflow).toBe("hidden");
  const last = screen.getByText("Cancel"); last.focus(); fireEvent.keyDown(last, { key: "Tab" });
  expect(dialog.querySelector("input")).toBe(document.activeElement);
  fireEvent.keyDown(document.activeElement, { key: "Tab", shiftKey: true }); expect(last).toBe(document.activeElement);
  fireEvent.keyDown(last, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(opener));
  expect(document.body.style.overflow).toBe("");
});
it("does not bypass a disabled close action while saving", async () => {
  const close = vi.fn(); render(<Surface busy onClose={close} />); const { dialog } = await open();
  fireEvent.keyDown(dialog, { key: "Escape" }); expect(close).not.toHaveBeenCalled(); expect(dialog.isConnected).toBe(true);
});
it("keeps the top confirmation active and restores focus inside its parent", async () => {
  render(<Surface />); await open(); const trigger = screen.getByText("Open confirmation"); trigger.focus(); fireEvent.click(trigger);
  const nested = await screen.findByRole("dialog", { name: "Confirm change" });
  await waitFor(() => expect(nested.contains(document.activeElement)).toBe(true));
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(screen.getByRole("dialog", { name: "Client details" }).isConnected).toBe(true);
});
it("allows focus in a portaled picker and makes table scrolling keyboard accessible", async () => {
  render(<Surface />); await open(); fireEvent.click(screen.getByText("Open picker"));
  const search = screen.getByLabelText("Picker search"); search.focus(); fireEvent.keyDown(search, { key: "Escape" });
  expect(screen.getByRole("dialog", { name: "Client details" }).isConnected).toBe(true);
  expect(search).toBe(document.activeElement);
  const region = screen.getByRole("region", { name: "Scrollable table" }); expect(region.tabIndex).toBe(0);
});

it("closing a portaled picker with Escape does not also dismiss its parent form", async () => {
  render(<Surface closePopupOnEscape />); await open(); fireEvent.click(screen.getByText("Open picker"));
  const search = screen.getByLabelText("Picker search"); search.focus(); fireEvent.keyDown(search, { key: "Escape" });
  await waitFor(() => expect(screen.queryByLabelText("Picker search")).toBeNull());
  expect(screen.getByRole("dialog", { name: "Client details" }).isConnected).toBe(true);
});

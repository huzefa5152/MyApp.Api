// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import AttachmentBadge from "./AttachmentBadge";
import { useEntityAttachmentCounts } from "../hooks/useEntityAttachmentCounts";
import { getEntityAttachmentCounts } from "../api/attachmentApi";

const perms = { view: true };
vi.mock("../api/attachmentApi", () => ({ getEntityAttachmentCounts: vi.fn() }));
vi.mock("../contexts/PermissionsContext", () => ({ usePermissions: () => ({ has: (k) => k === "attachments.list.view" && perms.view }) }));

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); perms.view = true; });

it("renders nothing at zero and a clickable count otherwise, without bubbling to the row", () => {
  const { container, rerender } = render(<AttachmentBadge count={0} />);
  expect(container.innerHTML).toBe("");
  const onClick = vi.fn(); const onRow = vi.fn();
  rerender(<div onClick={onRow}><AttachmentBadge count={3} onClick={onClick} /></div>);
  fireEvent.click(screen.getByRole("button", { name: /3/ }));
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(onRow).not.toHaveBeenCalled();
});

it("fetches one batch per page and ignores an SPA-fallback HTML body", async () => {
  getEntityAttachmentCounts.mockResolvedValueOnce({ data: { 5: 2 } });
  const { result } = renderHook(() => useEntityAttachmentCounts(7, "DeliveryChallan", [5, 6]));
  await waitFor(() => expect(result.current.counts).toEqual({ 5: 2 }));
  expect(getEntityAttachmentCounts).toHaveBeenCalledWith(7, "DeliveryChallan", ["5", "6"]);

  getEntityAttachmentCounts.mockResolvedValueOnce({ data: "<!doctype html>" });
  await result.current.refresh();
  await waitFor(() => expect(result.current.counts).toEqual({}));
});

it("makes no call without the view permission or without a company", async () => {
  perms.view = false;
  renderHook(() => useEntityAttachmentCounts(7, "Invoice", [1]));
  perms.view = true;
  renderHook(() => useEntityAttachmentCounts(null, "Invoice", [1]));
  await new Promise((r) => setTimeout(r, 0));
  expect(getEntityAttachmentCounts).not.toHaveBeenCalled();
});

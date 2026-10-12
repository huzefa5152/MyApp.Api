// @vitest-environment jsdom
import React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import EmailConversation from "./EmailConversation";
import http from "../api/httpClient";
vi.mock("../api/httpClient", () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
vi.mock("./LineItemsEditor", () => ({ default: () => <div>Quoted item editor</div> }));
vi.mock("./EmailHtmlBody", () => ({ default: ({ html }) => <div>{html}</div> }));
const root = "/email-workspace/company/1";
const message = { id: 3, subject: "Sample enquiry", providerMessageId: "incoming" };
const thread = { canReply: true, canChangeRead: true, messages: [{ providerId: "incoming", sender: "buyer@example.com", receivedAt: "2026-10-12T12:00:00Z", isCurrent: true, isUnread: true, text: "Current enquiry", suggestedItems: [] }] };
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear();
  http.get.mockResolvedValue({ data: thread });
  http.put.mockResolvedValue({ data: {} });
});
afterEach(cleanup);
it("requires a preview and explicit send, without exposing compose", async () => {
  http.post.mockImplementation(url => Promise.resolve({ data: url.endsWith("reply-preview") ? { id: "attempt", to: ["buyer@example.com"], cc: [], subject: message.subject, html: "Safe preview" } : { status: "Sent" } }));
  render(<EmailConversation root={root} message={message} />);
  fireEvent.click(await screen.findByRole("button", { name: "Reply all", exact: true }));
  expect(http.post).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /compose/i })).toBeNull();
  fireEvent.change(screen.getByLabelText("Additional lines / availability / delivery"), { target: { value: "Available tomorrow" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview reply" }));
  await screen.findByText("Safe preview");
  expect(http.post).toHaveBeenCalledWith(`${root}/messages/3/reply-preview`, expect.objectContaining({ replyAll: true, notes: "Available tomorrow" }));
  expect(http.post.mock.calls.some(([url]) => url.endsWith("/send"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Send reply to all" }));
  await screen.findByText("Reply sent in this Gmail conversation.");
  expect(http.post).toHaveBeenCalledWith(`${root}/replies/attempt/send`);
});
it("blocks another send after an uncertain result until status is checked", async () => {
  sessionStorage.setItem(`email-reply:undefined:${root}:3`, "pending");
  http.post.mockResolvedValue({ data: { status: "Uncertain" } });
  render(<EmailConversation root={root} message={message} />);
  fireEvent.click(await screen.findByRole("button", { name: "Check reply status" }));
  await waitFor(() => expect(http.post).toHaveBeenCalledWith(`${root}/replies/pending/check`));
  expect(screen.queryByRole("button", { name: "Reply", exact: true })).toBeNull();
  expect(screen.queryByRole("button", { name: /Send reply/ })).toBeNull();
});
it("hides Gmail writes for read-only access", async () => {
  http.get.mockResolvedValue({ data: { ...thread, canReply: false, canChangeRead: false, limitedToSharedMessages: true } });
  render(<EmailConversation root={root} message={message} />);
  await screen.findByText("Current enquiry");
  expect(screen.queryByRole("button", { name: /Reply/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Mark as/ })).toBeNull();
  expect(http.put).not.toHaveBeenCalled();
});
it("opening an authorized unread message updates Gmail read status", async () => {
  render(<EmailConversation root={root} message={message} />);
  await waitFor(() => expect(http.put).toHaveBeenCalledWith(`${root}/messages/3/read-status`, { isUnread: false }));
  await screen.findByText("Read", { exact: true });
});
it("recovers unconfirmed sends from the server without session storage", async () => {
  http.get.mockResolvedValue({ data: { ...thread, pendingReplyId: "server-attempt" } });
  http.post.mockResolvedValue({ data: { status: "Uncertain" } });
  render(<EmailConversation root={root} message={message} />);
  fireEvent.click(await screen.findByRole("button", { name: "Check reply status" }));
  await waitFor(() => expect(http.post).toHaveBeenCalledWith(`${root}/replies/server-attempt/check`));
  expect(screen.queryByRole("button", { name: "Reply", exact: true })).toBeNull();
});

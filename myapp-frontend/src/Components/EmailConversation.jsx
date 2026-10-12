import { useContext, useEffect, useState } from "react";
import AuthContext from "../contexts/AuthContext";
import http from "../api/httpClient";
import LineItemsEditor from "./LineItemsEditor";
import EmailHtmlBody from "./EmailHtmlBody";
import "./EmailConversation.css";

export default function EmailConversation({ companyId, root, message, items = [], refresh }) {
  const user = useContext(AuthContext)?.user;
  const [thread, setThread] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [reply, setReply] = useState(null), [preview, setPreview] = useState(null), [sendStatus, setSendStatus] = useState("");
  const storageKey = `email-reply:${user?.id}:${root}:${message.id}`;
  const [pendingId, setPendingId] = useState(() => sessionStorage.getItem(storageKey));
  const load = async () => { const { data } = await http.get(`${root}/messages/${message.id}/conversation`); setThread(data); };
  useEffect(() => {
    let active = true;
    http.get(`${root}/messages/${message.id}/conversation`).then(async ({ data }) => {
      if (!active) return;
      setThread(data);
      if (data.pendingReplyId) { setPendingId(data.pendingReplyId); sessionStorage.setItem(storageKey, data.pendingReplyId); }
      if (data.canChangeRead && data.messages?.some(m => m.isCurrent && m.isUnread === true)) {
        try {
          await http.put(`${root}/messages/${message.id}/read-status`, { isUnread: false });
          if (active) { setThread(t => ({ ...t, messages: t.messages.map(m => m.isCurrent ? { ...m, isUnread: false } : m) })); await refresh?.(); }
        } catch { if (active) setError("This message opened, but Gmail read status could not update. Use Mark as read to retry."); }
      }
    }).catch(() => { if (active) setError("The conversation could not load. Refresh and check the connection."); });
    return () => { active = false; };
  }, [root, message.id]);
  const run = async action => { setBusy(true); setError(""); try { await action(); } catch (e) { setError(e.response?.data?.message || "The Gmail action could not finish. Please try again."); } finally { setBusy(false); } };
  const edit = (key, value) => { setReply(r => ({ ...r, [key]: value })); setPreview(null); };
  const start = (all, target = null) => { setReply({ targetProviderMessageId: target, replyAll: all, introduction: "Please find our quotation below.", notes: "", includeCurrentMessage: true, items: (items.length && (!target || thread?.messages?.find(m => m.providerId === target)?.isCurrent) ? items : thread?.messages?.find(m => m.providerId === (target || message.providerMessageId) || (!target && m.isCurrent))?.suggestedItems || []).map(i => ({ ...i })) }); setPreview(null); setSendStatus(""); };
  const check = () => run(async () => {
    const { data } = await http.post(`${root}/replies/${pendingId}/check`);
    setSendStatus(data.status);
    if (data.status === "Sent") { sessionStorage.removeItem(storageKey); setPendingId(null); setReply(null); await load(); } else if (data.status === "Draft") { sessionStorage.removeItem(storageKey); setPendingId(null); }
  });
  return <section className="ew-conversation" aria-label="Gmail conversation" aria-busy={busy}>
    <div className="ew-section-heading"><h3>Conversation</h3>{thread && <span>{(thread.messages?.length || 0)} message{(thread.messages?.length || 0) === 1 ? "" : "s"}</span>}</div>
    {error && <p role="alert" className="ew-error">{error}</p>}
    {!thread && !error && <p role="status">Loading conversation from Gmail…</p>}
    {thread?.limitedToSharedMessages && <p className="ew-muted">Only messages shared with this company are shown.</p>}
    {thread?.needsUpgrade && <p className="ew-notice">Your Gmail connection is read-only. Enable replies and read-status access in Connections.</p>}
    {thread?.messages?.map(m => <details key={m.providerId} className="ew-thread-message" open={m.isCurrent}>
      <summary><strong>{m.sender}</strong><span>{new Date(m.receivedAt).toLocaleString()}</span><span>{m.isUnread == null ? "Status syncing" : m.isUnread ? "Unread" : "Read"}</span></summary>
      {thread.canReply && m.canReplyToMessage !== false && !pendingId && <div className="ew-actions"><button disabled={busy} onClick={() => start(false,m.providerId)}>Reply to this message</button><button disabled={busy} onClick={() => start(true,m.providerId)}>Reply all to this message</button></div>}
      <p className="ew-thread-text">{m.text}</p>{m.html?.trim() && <details><summary>Show email formatting</summary><EmailHtmlBody html={m.html} /></details>}
    </details>)}
    {thread?.canChangeRead && <div className="ew-actions"><button disabled={busy} onClick={() => run(async () => { const current = thread.messages?.find(m => m.isCurrent); await http.put(`${root}/messages/${message.id}/read-status`, { isUnread: !current?.isUnread }); await load(); await refresh?.(); })}>Mark as {thread.messages?.find(m => m.isCurrent)?.isUnread ? "read" : "unread"} in Gmail</button></div>}
    {pendingId && <div role="status" className="ew-notice">{sendStatus === "Sent" ? "Reply sent." : "A reply is sending or awaiting confirmation. Check its status before sending another."}<button disabled={busy} onClick={check}>Check reply status</button></div>}
    {sendStatus === "Sent" && !pendingId && <p role="status" className="ew-notice">Reply sent in this Gmail conversation.</p>}
    {thread?.canReply && !pendingId && !reply && <div className="ew-actions"><button disabled={busy} onClick={() => start(false)}>Reply</button><button disabled={busy} onClick={() => start(true)}>Reply all</button></div>}
    {reply && !pendingId && <div className="ew-reply"><h3>{reply.replyAll ? "Reply all" : "Reply"}</h3><p className="ew-muted">Same subject: {message.subject}. Only the current enquiry is included; previous messages are omitted. Preview recipients and content before sending.</p>
      <label>Opening message<textarea maxLength={4000} value={reply.introduction} onChange={e => edit("introduction", e.target.value)} /></label>
      <LineItemsEditor narrowBreakpoint={1000} companyId={companyId} items={reply.items} onItemsChange={value => edit("items", value)} makeBlankItem={() => ({ description: "", quantity: 1, unit: "", unitPrice: null })} showUnitPrice itemsLabel="Quoted items" itemsHint="Enter each unit price. Add an item only if it belongs in this reply." />
      <label>Additional lines / availability / delivery<textarea maxLength={4000} value={reply.notes} onChange={e => edit("notes", e.target.value)} /></label>
      <label className="ew-check"><input type="checkbox" checked={reply.includeCurrentMessage} onChange={e => edit("includeCurrentMessage", e.target.checked)} />Include the current enquiry below my response</label>
      <div className="ew-actions"><button disabled={busy} onClick={() => { setReply(null); setPreview(null); }}>Cancel reply</button><button disabled={busy} onClick={() => run(async () => { const { data } = await http.post(`${root}/messages/${message.id}/reply-preview`, reply); setPreview(data); })}>Preview reply</button></div>
      {preview && <div className="ew-reply-preview"><h4>Ready to send</h4><dl><dt>To</dt><dd>{preview.to.join(", ")}</dd>{preview.cc.length > 0 && <><dt>Cc</dt><dd>{preview.cc.join(", ")}</dd></>}<dt>Subject</dt><dd>{preview.subject}</dd></dl><EmailHtmlBody html={preview.html} /><button className="ew-primary" disabled={busy} onClick={() => run(async () => {
        sessionStorage.setItem(storageKey, preview.id); setPendingId(preview.id);
        const { data } = await http.post(`${root}/replies/${preview.id}/send`);
        setSendStatus(data.status);
        if (data.status === "Sent") { sessionStorage.removeItem(storageKey); setPendingId(null); setReply(null); setPreview(null); await load(); }
      })}>Send {reply.replyAll ? "reply to all" : "reply"}</button></div>}
    </div>}
  </section>;
}

// The hand-off between the Print Templates list and the Template Editor.
//
// The list writes the entry contract into localStorage before navigating to
// /templates/edit; the editor reads it ONCE at mount. On the way back, the
// editor leaves the id of the template it last opened or saved in
// sessionStorage, and the list lands the eye on that card exactly once.

export const ENTRY_TYPE_KEY = "te.type";
export const ENTRY_COMPANY_KEY = "te.companyId";
export const ENTRY_TEMPLATE_KEY = "te.templateId";
export const RECENT_TEMPLATE_KEY = "pt.recentTemplateId";

// Point the editor at a template (or, with no id, at a type's default).
export function setEditorEntry({ type, companyId, templateId = null }) {
  try {
    localStorage.setItem(ENTRY_TYPE_KEY, type);
    localStorage.setItem(ENTRY_COMPANY_KEY, String(companyId));
    if (templateId != null) localStorage.setItem(ENTRY_TEMPLATE_KEY, String(templateId));
    else localStorage.removeItem(ENTRY_TEMPLATE_KEY);
  } catch { /* private mode — the editor falls back to the type's default */ }
}

export function markRecentTemplate(id) {
  try { sessionStorage.setItem(RECENT_TEMPLATE_KEY, String(id)); } catch { /* ignore */ }
}

// Peek and clear are separate so a state initializer can read the id and a
// mount effect can consume it — React's StrictMode runs initializers twice in
// development, and a read-and-clear initializer would hand the second run null.
export function peekRecentTemplate() {
  try { return Number(sessionStorage.getItem(RECENT_TEMPLATE_KEY)) || null; } catch { return null; }
}

// Consumed once per return, so a card is highlighted once, not forever.
export function clearRecentTemplate() {
  try { sessionStorage.removeItem(RECENT_TEMPLATE_KEY); } catch { /* ignore */ }
}

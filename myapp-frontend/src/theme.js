// src/theme.js — Blue/Teal color scheme matching the admin dashboard

// Exported so screens can reference raw palette values directly (e.g. the
// Payments/Receipts cards). Existing screens use the higher-level style objects
// below; this export is purely additive.
export const colors = {
  blue: "#0d47a1",
  blueDark: "#0a3680",
  blueLight: "#1565c0",
  teal: "#00897b",
  tealDark: "#00695c",
  cyan: "#00e5ff",
  dark: "#0a1628",
  cardBg: "#ffffff",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  danger: "#dc3545",
  dangerLight: "#fff0f1",
  success: "#28a745",
};

export const cardHover = {
  transform: "translateY(-4px)",
  boxShadow: "0 12px 28px rgba(13,71,161,0.15)",
};

export const buttonHover = {
  filter: "brightness(1.08)",
};

export const cardStyles = {
  grid: {
    display: "grid",
    // Auto-fit collapses 3 columns → 2 → 1 as the viewport narrows.
    // 280px min keeps each card legible (company / invoice cards have
    // a title + 3-line meta block + buttons, so anything narrower
    // cramps the layout). Was hardcoded `repeat(3, 1fr)` which forced
    // a 3-up grid on phones.
    gridTemplateColumns: "repeat(auto-fit, minmax(var(--admin-card-min, 280px), 1fr))",
    gap: "var(--ui-card-gap, var(--admin-card-gap, 1.25rem))",
  },
  card: {
    backgroundColor: colors.cardBg,
    borderRadius: "var(--ui-card-radius, 14px)",
    border: `1px solid ${colors.cardBorder}`,
    // Layered soft shadow reads cleaner than a single flat blur.
    boxShadow: "var(--ui-card-shadow, 0 1px 3px rgba(16,32,64,0.04), 0 6px 18px rgba(16,32,64,0.06))",
    transition: "transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease",
    cursor: "default",
    overflow: "hidden",
  },
  cardContent: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    height: "100%",
    padding: "var(--ui-card-pad, 1.25rem 1.35rem)",
  },
  title: {
    fontSize: "var(--ui-card-title, 1.12rem)",
    fontWeight: "800",
    marginBottom: "0.5rem",
    color: colors.textPrimary,
    letterSpacing: "-0.01em",
  },
  text: {
    fontSize: "var(--ui-card-text, 0.88rem)",
    color: colors.textSecondary,
    marginBottom: "0.2rem",
    lineHeight: 1.5,
  },
  // ── Richer card building blocks (adopted by the invoice/bill cards; any
  // card can use them for a stronger visual hierarchy) ──────────────────
  cardHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: "0.55rem" },
  cardLead: { fontSize: "0.98rem", fontWeight: 700, color: colors.textPrimary, margin: "0 0 0.65rem", lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  metaGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(120px, 100%), 1fr))", gap: "0.5rem 1rem", marginBottom: "0.7rem" },
  metaLabel: { display: "block", fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textSecondary, marginBottom: 1 },
  metaValue: { fontSize: "0.85rem", fontWeight: 600, color: colors.textPrimary, lineHeight: 1.3, wordBreak: "break-word" },
  amountBox: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "0.5rem 0.7rem", background: "linear-gradient(135deg, rgba(13,71,161,0.06), rgba(0,137,123,0.07))", borderRadius: 10, marginBottom: "0.6rem" },
  amountLabel: { fontSize: "0.66rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textSecondary },
  amount: { fontSize: "1.2rem", fontWeight: 800, color: colors.blue, letterSpacing: "-0.01em" },
  statusRow: { display: "flex", flexWrap: "wrap", gap: "0.4rem", margin: "0.1rem 0 0.2rem" },
  buttonGroup: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem",
    marginTop: "var(--ui-card-actions-gap, 1rem)",
    paddingTop: "var(--ui-card-actions-pad, 0.9rem)",
    borderTop: `1px solid ${colors.cardBorder}`,
  },
  button: {
    minHeight: "var(--ui-btn-h, 44px)",
    padding: "var(--ui-card-btn-pad, 0.45rem 1rem)",
    fontSize: "var(--ui-card-btn-font, 0.82rem)",
    fontWeight: "600",
    borderRadius: "8px",
    cursor: "pointer",
    border: "none",
    transition: "all 0.2s ease",
    letterSpacing: "0.2px",
  },
  edit: {
    background: `var(--ui-card-edit-bg, linear-gradient(135deg, ${colors.blue}, ${colors.blueLight}))`,
    color: "#fff",
  },
  delete: {
    backgroundColor: colors.dangerLight,
    color: colors.danger,
    border: `1px solid ${colors.danger}20`,
  },
};

export const dropdownStyles = {
  base: {
    padding: "var(--ui-select-pad, 0.55rem 1rem)",
    minHeight: "var(--ui-control-h, 0px)",
    borderRadius: "8px",
    border: `1px solid ${colors.inputBorder}`,
    backgroundColor: `var(--ui-input-bg, ${colors.inputBg})`,
    color: colors.textPrimary,
    outline: "none",
    // Was a fixed 250px which forced horizontal overflow on phones
    // (DashboardLayout content area can be ~340px wide on 360px-class
    // devices). `min(250px, 100%)` keeps the desktop look while
    // allowing the dropdown to shrink below 250px on narrow screens.
    minWidth: "min(250px, 100%)",
    maxWidth: "100%",
    cursor: "pointer",
    transition: "border-color 0.25s ease",
    fontSize: "var(--ui-input-size, 0.9rem)",
  },
};

// ────────────────────────────────────────────────────────────────────
// Modal size tiers — every popup in the app picks one of these so widths
// stay consistent. Add to `formStyles.modal.maxWidth` via spread:
//   <div style={{ ...formStyles.modal, maxWidth: modalSizes.lg }}>
// Pick by content:
//   sm  — confirm dialogs, tiny single-field prompts
//   md  — short forms (login, simple create/edit, role assignment)
//   lg  — multi-row forms with a small table (challan view, item type edit)
//   xl  — multi-row forms with a full item-line table (challan create/edit, PO import)
//   xxl — wide tabular workflows (invoice form, bulk FBR results)
// ────────────────────────────────────────────────────────────────────
export const modalSizes = {
  sm: 420,   // confirm dialogs, single-question prompts, delete-confirm
  md: 560,   // short forms (login, simple create/edit, role assignment)
  lg: 820,   // detail viewers + medium forms (ChallanModal, POFormat, BulkFbrResults, SyncWarning)
  xl: 1100,  // multi-row forms with full item-line table (ChallanForm/Edit, POImport)
  xxl: 1280, // wide tabular workflows (InvoiceForm, EditBillForm)
};

export const formStyles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(10,22,40,0.55)",
    // Stronger blur (was 4px) so the backdrop reads as "the rest of the app
    // is suspended" — matches user request for consistent blurred overlay.
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)", // Safari prefix
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2vh 1rem", // guarantees modal never touches viewport edges on any resolution
    // IMPORTANT: sit above the fixed sidebar (z-index: 1040 in DashboardLayout.css)
    // so zoomed / narrow-screen modals don't get hidden behind the nav.
    zIndex: 1100,
    // Fallback: if a modal is somehow taller than viewport (e.g. browser zoomed in),
    // the backdrop itself becomes scrollable so users can still reach the footer.
    overflowY: "auto",
  },
  modal: {
    backgroundColor: colors.cardBg,
    borderRadius: "var(--ui-modal-radius, 16px)",
    width: "100%",
    // Default size = "md". Override per-modal via inline spread:
    //   { ...formStyles.modal, maxWidth: modalSizes.xl }
    maxWidth: `${modalSizes.md}px`,
    maxHeight: "96vh", // cap at 96% of viewport so header + footer always stay visible
    boxShadow: "var(--ui-modal-shadow, 0 20px 60px rgba(13,71,161,0.2))",
    overflow: "hidden",
    color: colors.textPrimary,
    animation: "fadeIn 0.3s ease",
    // Flex column so header / body / footer stack and body can scroll independently
    display: "flex",
    flexDirection: "column",
    // Modals are intentionally NOT movable — centered and pinned. No drag
    // handles anywhere; resize is disabled to keep the layout predictable.
    resize: "none",
  },
  header: {
    background: `var(--ui-modal-head-bg, linear-gradient(135deg, ${colors.blue}, ${colors.teal}))`,
    borderBottom: "var(--ui-modal-head-border, none)",
    // clamp keeps the header tidy on phones (~0.9rem horizontal) while
    // restoring the comfortable 1.5rem on tablet/desktop.
    padding: "var(--ui-modal-head-pad, 1.1rem clamp(0.9rem, 2vw, 1.5rem))",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexShrink: 0, // header never compresses
  },
  title: {
    margin: 0,
    fontSize: "var(--ui-modal-title-size, 1.15rem)",
    fontWeight: "700",
    color: "var(--ui-modal-title-color, #ffffff)",
  },
  closeButton: {
    // Aggressive overrides because index.css applies a global
    //   button { padding: 0.8em 1.6em; box-shadow: ...; background: ...; }
    // rule that would otherwise stretch this to a huge pill and hide the X.
    background: "var(--ui-close-bg, rgba(255,255,255,0.2))",
    backgroundColor: "var(--ui-close-bg, rgba(255,255,255,0.2))",
    border: "none",
    color: "var(--ui-close-color, #fff)",
    fontSize: "1.2rem",
    fontWeight: 500,
    cursor: "pointer",
    width: "var(--ui-close-size, 44px)",
    minWidth: "var(--ui-close-size, 44px)",
    maxWidth: "var(--ui-close-size, 44px)",
    height: "var(--ui-close-size, 44px)",
    minHeight: "var(--ui-close-size, 44px)",
    maxHeight: "var(--ui-close-size, 44px)",
    padding: 0,                 // kills the global 0.8em 1.6em padding
    margin: 0,
    borderRadius: "8px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "none",          // kills the global drop-shadow
    transition: "background 0.2s",
    flexShrink: 0,
    flexGrow: 0,
    lineHeight: 1,
  },
  body: {
    // Padding shrinks on phones via a clamp() — 1rem at narrow widths,
    // 1.5rem on tablet+. Keeps long forms from feeling claustrophobic
    // on a 360px viewport without cramping the desktop look.
    padding: "var(--ui-modal-body-pad, clamp(1rem, 2vw, 1.5rem))",
    // Body takes remaining space and scrolls internally when content exceeds it —
    // this is the key fix for tall modals on high-resolution screens.
    overflowY: "auto",
    flex: "1 1 auto",
    minHeight: 0, // required for flex child to actually shrink
    // Hard cap as a fallback for modals that wrap the body inside a <form> or
    // other non-flex container — without this, flex:1 gets ignored and the
    // body balloons to its natural height, pushing the footer off-screen.
    // Math: 96vh modal cap − ~75px header − ~65px footer ≈ 140px safety room.
    maxHeight: "calc(96vh - 140px)",
  },
  error: {
    backgroundColor: colors.dangerLight,
    color: colors.danger,
    padding: "0.75rem 1rem",
    borderRadius: "8px",
    marginBottom: "1rem",
    fontWeight: "500",
    border: `1px solid ${colors.danger}30`,
    fontSize: "0.88rem",
  },
  formGroup: {
    marginBottom: "var(--ui-group-gap, 1.1rem)",
  },
  label: {
    display: "block",
    marginBottom: "var(--ui-label-gap, 0.35rem)",
    fontWeight: "600",
    fontSize: "var(--ui-label-size, 0.85rem)",
    color: colors.textSecondary,
  },
  input: {
    width: "100%",
    padding: "var(--ui-input-pad, 0.6rem 0.85rem)",
    minHeight: "var(--ui-control-h, 0px)",
    borderRadius: "8px",
    border: `1px solid ${colors.inputBorder}`,
    fontSize: "var(--ui-input-size, 0.95rem)",
    backgroundColor: `var(--ui-input-bg, ${colors.inputBg})`,
    color: colors.textPrimary,
    outline: "none",
    transition: "border-color 0.25s, box-shadow 0.25s",
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    // flexWrap lets long button rows (e.g. Save / Cancel / Delete) wrap
    // to a second line on narrow phones instead of overflowing.
    flexWrap: "wrap",
    padding: "var(--ui-foot-pad, 1rem clamp(0.9rem, 2vw, 1.5rem))",
    gap: "0.6rem",
    backgroundColor: "var(--ui-foot-bg, #f5f7fa)",
    borderTop: `1px solid ${colors.cardBorder}`,
    flexShrink: 0, // footer always visible (buttons like Save/Cancel)
  },
  button: {
    minHeight: "var(--ui-btn-h, 44px)",
    padding: "var(--ui-btn-pad, 0.5rem 1.25rem)",
    fontSize: "var(--ui-btn-size, 0.9rem)",
    fontWeight: "600",
    borderRadius: "8px",
    cursor: "pointer",
    border: "none",
    transition: "all 0.2s ease",
  },
  cancel: {
    backgroundColor: "var(--ui-cancel-bg, #e9ecf1)",
    color: colors.textSecondary,
    border: "var(--ui-cancel-border, none)",
  },
  submit: {
    background: `var(--ui-submit-bg, linear-gradient(135deg, ${colors.blue}, ${colors.teal}))`,
    color: "#fff",
  },
};

/**
 * One palette for every bill screen -- create, edit and view. The three bill
 * forms each kept an identical local copy of these colours, which is how their
 * looks drifted apart; the shared bill pieces read them from here.
 */
export const billColors = {
  blue: "#0d47a1",
  blueSoft: "#f8faff",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  danger: "#dc3545",
  dangerLight: "#fff0f1",
  warn: "#e65100",
  warnLight: "#fff8e1",
  success: "#2e7d32",
  successLight: "#f1f8f2",
  muted: "#8a97a8",
  mutedLight: "#fafbfc",
};

// A bill form wraps its body and footer in a <form>, which is not a flex
// container -- so the modal's flex column never reached the body, each form
// capped it at a guessed 70-75vh, and a footer that wrapped to two rows on a
// phone was pushed out of the modal with the save button in it. The form
// joins the column instead, the body takes whatever is left and scrolls, and
// the footer always shows.
export const billFormShell = { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 };
export const billFormBody = { maxHeight: "none" };

// Accent, header tint and badge colour per step status.
export const stepTone = {
  done:     { accent: billColors.success, tint: billColors.successLight, badge: billColors.success, pill: "Done" },
  todo:     { accent: billColors.blue,    tint: billColors.blueSoft,     badge: billColors.blue,    pill: null },
  warn:     { accent: billColors.warn,    tint: billColors.warnLight,    badge: billColors.warn,    pill: "Needs attention" },
  optional: { accent: billColors.muted,   tint: billColors.mutedLight,   badge: billColors.muted,   pill: "Optional" },
  view:     { accent: billColors.blue,    tint: billColors.blueSoft,     badge: billColors.blue,    pill: null },
};

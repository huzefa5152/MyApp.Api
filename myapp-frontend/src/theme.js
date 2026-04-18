// src/theme.js — Blue/Teal color scheme matching Hakimi Traders dashboard

const colors = {
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
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "1.25rem",
  },
  card: {
    backgroundColor: colors.cardBg,
    borderRadius: "14px",
    border: `1px solid ${colors.cardBorder}`,
    boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
    transition: "transform 0.25s ease, box-shadow 0.25s ease",
    cursor: "default",
    overflow: "hidden",
  },
  cardContent: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    height: "100%",
    padding: "1.4rem 1.5rem",
  },
  title: {
    fontSize: "1.15rem",
    fontWeight: "700",
    marginBottom: "0.5rem",
    color: colors.textPrimary,
  },
  text: {
    fontSize: "0.88rem",
    color: colors.textSecondary,
    marginBottom: "0.2rem",
    lineHeight: 1.5,
  },
  buttonGroup: {
    display: "flex",
    gap: "0.6rem",
    marginTop: "1.1rem",
    paddingTop: "1rem",
    borderTop: `1px solid ${colors.cardBorder}`,
  },
  button: {
    padding: "0.45rem 1rem",
    fontSize: "0.82rem",
    fontWeight: "600",
    borderRadius: "8px",
    cursor: "pointer",
    border: "none",
    transition: "all 0.2s ease",
    letterSpacing: "0.2px",
  },
  edit: {
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.blueLight})`,
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
    padding: "0.55rem 1rem",
    borderRadius: "8px",
    border: `1px solid ${colors.inputBorder}`,
    backgroundColor: colors.inputBg,
    color: colors.textPrimary,
    outline: "none",
    minWidth: "250px",
    cursor: "pointer",
    transition: "border-color 0.25s ease",
    fontSize: "0.9rem",
  },
};

export const formStyles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(10,22,40,0.55)",
    backdropFilter: "blur(4px)",
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
    borderRadius: "16px",
    width: "100%",
    maxWidth: "500px",
    maxHeight: "96vh", // cap at 96% of viewport so header + footer always stay visible
    boxShadow: "0 20px 60px rgba(13,71,161,0.2)",
    overflow: "hidden",
    color: colors.textPrimary,
    animation: "fadeIn 0.3s ease",
    // Flex column so header / body / footer stack and body can scroll independently
    display: "flex",
    flexDirection: "column",
  },
  header: {
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`,
    padding: "1.1rem 1.5rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexShrink: 0, // header never compresses
  },
  title: {
    margin: 0,
    fontSize: "1.15rem",
    fontWeight: "700",
    color: "#ffffff",
  },
  closeButton: {
    background: "rgba(255,255,255,0.2)",
    border: "none",
    color: "#fff",
    fontSize: "1.2rem",
    cursor: "pointer",
    width: "32px",
    height: "32px",
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.2s",
  },
  body: {
    padding: "1.5rem",
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
    marginBottom: "1.1rem",
  },
  label: {
    display: "block",
    marginBottom: "0.35rem",
    fontWeight: "600",
    fontSize: "0.85rem",
    color: colors.textSecondary,
  },
  input: {
    width: "100%",
    padding: "0.6rem 0.85rem",
    borderRadius: "8px",
    border: `1px solid ${colors.inputBorder}`,
    fontSize: "0.95rem",
    backgroundColor: colors.inputBg,
    color: colors.textPrimary,
    outline: "none",
    transition: "border-color 0.25s, box-shadow 0.25s",
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    padding: "1rem 1.5rem",
    gap: "0.6rem",
    backgroundColor: "#f5f7fa",
    borderTop: `1px solid ${colors.cardBorder}`,
    flexShrink: 0, // footer always visible (buttons like Save/Cancel)
  },
  button: {
    padding: "0.5rem 1.25rem",
    fontSize: "0.9rem",
    fontWeight: "600",
    borderRadius: "8px",
    cursor: "pointer",
    border: "none",
    transition: "all 0.2s ease",
  },
  cancel: {
    backgroundColor: "#e9ecf1",
    color: colors.textSecondary,
  },
  submit: {
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`,
    color: "#fff",
  },
};

// src/theme.js

export const cardHover = {
  transform: "translateY(-5px)",
  boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
};

export const buttonHover = {
  filter: "brightness(1.1)",
};

export const cardStyles = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "1.5rem",
    padding: "1rem",
  },
  card: {
    backgroundColor: "#1f1f1f",
    borderRadius: "12px",
    boxShadow: "0 6px 15px rgba(0,0,0,0.2)",
    transition: "transform 0.3s ease, box-shadow 0.3s ease",
    cursor: "pointer",
  },
  cardContent: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    height: "100%",
    padding: "1.5rem",
  },
  title: {
    fontSize: "1.3rem",
    fontWeight: "700",
    marginBottom: "0.5rem",
    color: "#ffffff",
  },
  text: {
    fontSize: "0.95rem",
    color: "#c0c0c0",
    marginBottom: "0.25rem",
  },
  buttonGroup: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: "1rem",
  },
  button: {
    padding: "0.55rem 1.2rem",
    fontSize: "0.9rem",
    fontWeight: "500",
    borderRadius: "8px",
    cursor: "pointer",
    border: "none",
    transition: "all 0.25s ease",
  },
  edit: {
    backgroundColor: "#646cff",
    color: "#fff",
  },
  delete: {
    backgroundColor: "#ff4b5c",
    color: "#fff",
  },
};

export const dropdownStyles = {
  base: {
    padding: "0.5rem 1rem",
    borderRadius: "8px",
    border: "1px solid #ccc",
    backgroundColor: "#2c2c2c",
    color: "#fff",
    outline: "none",
    minWidth: "250px",
    cursor: "pointer",
    transition: "all 0.25s ease",
  },
};

// --- Merged CompanyForm styles ---
export const formStyles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    backgroundColor: "#1f1f1f",
    borderRadius: "12px",
    width: "100%",
    maxWidth: "500px",
    boxShadow: "0 10px 40px rgba(0,0,0,0.4)",
    overflow: "hidden",
    color: "#fff",
    animation: "fadeIn 0.3s ease",
  },
  header: {
    backgroundColor: "#646cff",
    padding: "1rem 1.5rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    margin: 0,
    fontSize: "1.25rem",
    fontWeight: "600",
  },
  closeButton: {
    background: "transparent",
    border: "none",
    color: "#fff",
    fontSize: "1.5rem",
    cursor: "pointer",
  },
  body: {
    padding: "1.5rem",
  },
  error: {
    backgroundColor: "#ff4b5c",
    padding: "0.75rem 1rem",
    borderRadius: "8px",
    marginBottom: "1rem",
    fontWeight: "500",
  },
  formGroup: {
    marginBottom: "1rem",
  },
  label: {
    display: "block",
    marginBottom: "0.25rem",
    fontWeight: "500",
  },
  input: {
    width: "100%",
    padding: "0.5rem 0.75rem",
    borderRadius: "8px",
    border: "1px solid #ccc",
    fontSize: "1rem",
    backgroundColor: "#2c2c2c",
    color: "#fff",
    outline: "none",
    transition: "border-color 0.25s",
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    padding: "1rem 1.5rem",
    gap: "0.5rem",
    backgroundColor: "#1a1a1a",
  },
  button: {
    padding: "0.5rem 1.25rem",
    fontSize: "1rem",
    fontWeight: "500",
    borderRadius: "8px",
    cursor: "pointer",
    border: "none",
    transition: "all 0.25s ease",
  },
  cancel: {
    backgroundColor: "#555",
    color: "#fff",
  },
  submit: {
    backgroundColor: "#646cff",
    color: "#fff",
  },
};

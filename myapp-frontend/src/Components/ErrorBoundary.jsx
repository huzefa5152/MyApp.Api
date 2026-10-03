import React from "react";
import "../ui/kit.css";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, #f5f7fa 0%, #e4e9f0 100%)",
            fontFamily: "Arial, sans-serif",
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: "48px 40px",
              maxWidth: 480,
              width: "90%",
              textAlign: "center",
              boxShadow: "0 8px 32px rgba(0,0,0,0.1)",
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "#fdeded",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 20px",
                fontSize: 28,
              }}
            >
              !
            </div>
            <h2 style={{ margin: "0 0 8px", fontSize: "var(--k-title, 1.5rem)", color: "var(--k-ink, #1a2332)" }}>
              Something Went Wrong
            </h2>
            <p style={{ margin: "0 0 24px", color: "var(--k-muted, #5f6d7e)", fontSize: "0.95rem", lineHeight: 1.5 }}>
              An unexpected error occurred. Please try again or return to the dashboard.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                onClick={this.handleReset}
                className="k-btn k-btn--secondary"
              >
                Try Again
              </button>
              <button
                onClick={() => {
                  this.handleReset();
                  window.location.href = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "") + "/dashboard";
                }}
                className="k-btn k-btn--primary"
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

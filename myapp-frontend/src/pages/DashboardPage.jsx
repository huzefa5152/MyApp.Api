// src/pages/DashboardPage.jsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MdBusiness, MdPeople, MdDescription, MdReceipt, MdArrowForward, MdRefresh, MdFilterList } from "react-icons/md";
import { useAuth } from "../contexts/AuthContext";
import { useCompany } from "../contexts/CompanyContext";
import { getCompanies } from "../api/companyApi";
import { getClientsCount } from "../api/clientApi";
import { getDeliveryChallansCount } from "../api/challanApi";
import { getInvoicesCount } from "../api/invoiceApi";

/* ------------------------------------------------------------------ */
/*  Inline styles – keeps the component self-contained                  */
/* ------------------------------------------------------------------ */
const styles = {
  page: {
    maxWidth: "1100px",
  },
  welcomeCard: {
    background: "linear-gradient(135deg, #0d47a1 0%, #00897b 100%)",
    borderRadius: "16px",
    padding: "2rem 2.25rem",
    color: "#ffffff",
    marginBottom: "2rem",
    boxShadow: "0 8px 32px rgba(13,71,161,0.22)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "1rem",
  },
  welcomeHeading: {
    fontSize: "1.65rem",
    fontWeight: "800",
    margin: "0 0 0.35rem",
    letterSpacing: "0.3px",
  },
  welcomeSub: {
    fontSize: "0.9rem",
    color: "rgba(255,255,255,0.78)",
    margin: 0,
  },
  welcomeBadge: {
    background: "rgba(255,255,255,0.18)",
    border: "1px solid rgba(255,255,255,0.3)",
    borderRadius: "50px",
    padding: "0.45rem 1.1rem",
    fontSize: "0.82rem",
    color: "#fff",
    fontWeight: "600",
    whiteSpace: "nowrap",
  },
  sectionTitle: {
    fontSize: "1rem",
    fontWeight: "700",
    color: "#344054",
    marginBottom: "1rem",
    textTransform: "uppercase",
    letterSpacing: "0.8px",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "1.25rem",
    marginBottom: "2.25rem",
  },
  statCard: (gradient) => ({
    background: gradient,
    borderRadius: "14px",
    padding: "1.5rem 1.6rem",
    color: "#ffffff",
    boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    transition: "transform 0.22s ease, box-shadow 0.22s ease",
    cursor: "default",
  }),
  statIcon: {
    fontSize: "2rem",
    opacity: 0.85,
  },
  statCount: {
    fontSize: "2.6rem",
    fontWeight: "800",
    lineHeight: 1,
    margin: "0.2rem 0",
  },
  statLabel: {
    fontSize: "0.88rem",
    color: "rgba(255,255,255,0.8)",
    fontWeight: "500",
  },
  actionsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "1.25rem",
  },
  actionCard: (borderColor) => ({
    background: "#ffffff",
    borderRadius: "14px",
    padding: "1.4rem 1.5rem",
    border: `2px solid ${borderColor}`,
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
    cursor: "pointer",
  }),
  actionTitle: {
    fontSize: "0.95rem",
    fontWeight: "700",
    color: "#1a1a2e",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  actionDesc: {
    fontSize: "0.82rem",
    color: "#6c757d",
    lineHeight: 1.5,
    flex: 1,
  },
  actionBtn: (color) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    color: color,
    fontWeight: "600",
    fontSize: "0.85rem",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
    transition: "gap 0.15s",
  }),
  errorBox: {
    background: "#fff3f3",
    border: "1px solid #f5c2c7",
    borderRadius: "10px",
    padding: "1rem 1.25rem",
    color: "#842029",
    fontSize: "0.875rem",
    marginBottom: "1.5rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
  },
  filterRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    marginBottom: "1.5rem",
  },
  filterSelect: {
    padding: "0.5rem 0.85rem",
    borderRadius: 10,
    border: "1px solid #d0d7e2",
    backgroundColor: "#f8f9fb",
    fontSize: "0.9rem",
    color: "#1a2332",
    outline: "none",
    cursor: "pointer",
    minWidth: 200,
  },
};

/* ------------------------------------------------------------------ */
/*  DashboardPage                                                       */
/* ------------------------------------------------------------------ */
export default function DashboardPage() {
  const { user } = useAuth();
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const navigate = useNavigate();

  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [counts, setCounts] = useState({ companies: null, clients: null, challans: null, invoices: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const displayName =
    user?.name ?? user?.username ?? user?.email ?? "there";

  const fetchCounts = async (companyId) => {
    setLoading(true);
    setError(null);
    try {
      const cid = companyId || null;
      const [companiesRes, clientsCountRes, challansCountRes, invoicesCountRes] = await Promise.all([
        getCompanies(),
        getClientsCount(cid),
        getDeliveryChallansCount(cid),
        getInvoicesCount(cid),
      ]);
      setCounts({
        companies: Array.isArray(companiesRes.data) ? companiesRes.data.length : 0,
        clients: typeof clientsCountRes.data === "number" ? clientsCountRes.data : 0,
        challans: typeof challansCountRes.data === "number" ? challansCountRes.data : 0,
        invoices: typeof invoicesCountRes.data === "number" ? invoicesCountRes.data : 0,
      });
    } catch (err) {
      console.error("Dashboard fetch error:", err);
      setError("Could not load stats. The API may be unavailable.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchCounts(selectedCompanyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompanyId]);

  /* Card hover handlers */
  const hoverIn = (e) => {
    e.currentTarget.style.transform = "translateY(-4px)";
    e.currentTarget.style.boxShadow = "0 10px 30px rgba(0,0,0,0.18)";
  };
  const hoverOut = (e) => {
    e.currentTarget.style.transform = "";
    e.currentTarget.style.boxShadow = "";
  };

  const actionHoverIn = (e) => {
    e.currentTarget.style.transform = "translateY(-3px)";
    e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.1)";
  };
  const actionHoverOut = (e) => {
    e.currentTarget.style.transform = "";
    e.currentTarget.style.boxShadow = "";
  };

  /* Stat cards config */
  const statCards = [
    {
      label: "Companies",
      count: counts.companies,
      icon: <MdBusiness style={styles.statIcon} />,
      gradient: "linear-gradient(135deg, #0d47a1 0%, #1565c0 100%)",
    },
    {
      label: "Clients",
      count: counts.clients,
      icon: <MdPeople style={styles.statIcon} />,
      gradient: "linear-gradient(135deg, #00695c 0%, #00897b 100%)",
    },
    {
      label: "Challans",
      count: counts.challans,
      icon: <MdDescription style={styles.statIcon} />,
      gradient: "linear-gradient(135deg, #1565c0 30%, #00897b 100%)",
    },
    {
      label: "Bills",
      count: counts.invoices,
      icon: <MdReceipt style={styles.statIcon} />,
      gradient: "linear-gradient(135deg, #6a1b9a 0%, #8e24aa 100%)",
    },
  ];

  /* Quick action cards config */
  const actionCards = [
    {
      title: "Companies",
      icon: <MdBusiness style={{ color: "#0d47a1", fontSize: "1.2rem" }} />,
      desc: "Manage your registered companies, add new branches, or update company details.",
      borderColor: "#bbdefb",
      btnColor: "#0d47a1",
      path: "/companies/list",
      btnLabel: "Go to Companies",
    },
    {
      title: "Clients",
      icon: <MdPeople style={{ color: "#00897b", fontSize: "1.2rem" }} />,
      desc: "View and manage clients, update contact information, and track associations.",
      borderColor: "#b2dfdb",
      btnColor: "#00897b",
      path: "/Clients/list",
      btnLabel: "Go to Clients",
    },
    {
      title: "Challans",
      icon: <MdDescription style={{ color: "#1565c0", fontSize: "1.2rem" }} />,
      desc: "Create and view delivery challans, filter by company, and manage challan items.",
      borderColor: "#c5cae9",
      btnColor: "#1565c0",
      path: "/challans",
      btnLabel: "Go to Challans",
    },
    {
      title: "Bills",
      icon: <MdReceipt style={{ color: "#6a1b9a", fontSize: "1.2rem" }} />,
      desc: "Create bills from pending challans, print bills and submit tax invoices to FBR.",
      borderColor: "#e1bee7",
      btnColor: "#6a1b9a",
      path: "/invoices",
      btnLabel: "Go to Bills",
    },
  ];

  return (
    <div style={styles.page}>
      {/* Welcome Banner */}
      <div style={styles.welcomeCard}>
        <div>
          <h2 style={styles.welcomeHeading}>Welcome back, {displayName}! 👋</h2>
          <p style={styles.welcomeSub}>
            Here&rsquo;s a quick overview of your business today.
          </p>
        </div>
        <span style={styles.welcomeBadge}>
          {new Date().toLocaleDateString("en-GB", {
            weekday: "short",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </span>
      </div>

      {/* Company Filter */}
      {companies.length > 0 && (
        <div style={styles.filterRow}>
          <MdFilterList size={20} color="#0d47a1" />
          <select
            style={styles.filterSelect}
            value={selectedCompanyId}
            onChange={(e) => {
              setSelectedCompanyId(e.target.value);
              const c = companies.find((x) => String(x.id) === e.target.value);
              if (c) setSelectedCompany(c);
            }}
          >
            <option value="">All Companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={styles.errorBox}>
          <span>{error}</span>
          <button
            type="button"
            onClick={() => fetchCounts(selectedCompanyId)}
            style={{ ...styles.actionBtn("#842029"), flexShrink: 0 }}
          >
            <MdRefresh /> Retry
          </button>
        </div>
      )}

      {/* Stats Section */}
      <p style={styles.sectionTitle}>
        <span>Overview</span>
      </p>
      <div style={styles.statsGrid}>
        {statCards.map((card) => (
          <div
            key={card.label}
            style={styles.statCard(card.gradient)}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
          >
            {card.icon}
            <div style={styles.statCount}>
              {loading ? (
                <span style={{ fontSize: "1.2rem", opacity: 0.7 }}>—</span>
              ) : (
                card.count
              )}
            </div>
            <div style={styles.statLabel}>
              {card.label}
              {card.note && (
                <span style={{ display: "block", fontSize: "0.76rem", opacity: 0.7 }}>
                  {card.note}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions Section */}
      <p style={styles.sectionTitle}>
        <span>Quick Actions</span>
      </p>
      <div style={styles.actionsGrid}>
        {actionCards.map((card) => (
          <div
            key={card.title}
            style={styles.actionCard(card.borderColor)}
            onMouseEnter={actionHoverIn}
            onMouseLeave={actionHoverOut}
            onClick={() => navigate(card.path)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && navigate(card.path)}
            aria-label={card.btnLabel}
          >
            <div style={styles.actionTitle}>
              {card.icon}
              {card.title}
            </div>
            <p style={styles.actionDesc}>{card.desc}</p>
            <button
              type="button"
              style={styles.actionBtn(card.btnColor)}
              tabIndex={-1}
              aria-hidden="true"
            >
              {card.btnLabel} <MdArrowForward />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

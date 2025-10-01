// App.jsx
import { useState, useRef, useEffect } from "react";
import { Routes, Route, NavLink, useLocation } from "react-router-dom";
import CompanyPage from "./pages/CompanyPage";
import ChallansPage from "./pages/ChallanPage";
import "./App.css";
import ClientsPage from "./pages/ClientsPage";

export default function App() {
  const [companyOpen, setCompanyOpen] = useState(false);
  const submenuRef = useRef(null);
  const [submenuHeight, setSubmenuHeight] = useState(0);

  const location = useLocation(); // Get current path

  // Check if any company submenu route is active
  const isCompanyActive = location.pathname.startsWith("/companies");

  useEffect(() => {
    if (submenuRef.current) {
      setSubmenuHeight(submenuRef.current.scrollHeight);
    }
  }, [submenuRef]);

  const MainLink = ({ to, label }) => (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        "nav-link mb-2 d-flex justify-content-between align-items-center p-2 rounded " +
        (isActive ? "active bg-white text-primary fw-bold" : "text-white")
      }
    >
      {label}
    </NavLink>
  );

  return (
    <div className="d-flex vh-100">
      {/* Sidebar */}
      <aside
        className="bg-primary text-white p-3 d-flex flex-column"
        style={{ flex: "0 0 20%" }} // 👈 fixed at 20%
        onMouseLeave={() => setCompanyOpen(false)}
      >
        <h3 className="text-center mb-4">MyApp</h3>

        <nav className="nav flex-column">
          <MainLink to="/" label="Dashboard" />

          {/* Companies main menu */}
          <div
            className={
              "nav-link mb-2 d-flex justify-content-between align-items-center p-2 rounded " +
              (isCompanyActive ? "active bg-white text-primary fw-bold" : "text-white")
            }
            style={{ cursor: "pointer" }}
            onMouseEnter={() => setCompanyOpen(!companyOpen)}
          >
            <span>Configuration</span>
            <span className={`arrow ${companyOpen ? "open" : ""}`}>▼</span>
          </div>

          {/* Submenu */}
          <div
            ref={submenuRef}
            className="submenu flex-column ms-3"
            style={{
              maxHeight: companyOpen ? `${submenuHeight}px` : "0px",
              overflow: "hidden",
              transition: "max-height 0.3s ease",
            }}
          >
            <NavLink
              to="/companies/list"
              className={({ isActive }) =>
                "nav-link mb-1 p-2 rounded " +
                (isActive ? "active bg-white text-primary fw-bold" : "text-white")
              }
            >
              Companies List
            </NavLink>
            <NavLink
              to="/Clients/list"
              className={({ isActive }) =>
                "nav-link mb-1 p-2 rounded " +
                (isActive ? "active bg-white text-primary fw-bold" : "text-white")
              }
            >
              Clients List
            </NavLink>
          </div>

          <MainLink to="/challans" label="Challans" />
        </nav>

        <div className="mt-auto text-center">
          <small>© {new Date().getFullYear()} MyApp</small>
        </div>
      </aside>

      {/* Content */}
      <main
        className="bg-light p-4 overflow-auto"
        style={{ flex: "0 0 80%" }} // 👈 fixed at 80%
      >
        <Routes>
          <Route path="/" element={<h2>Welcome to MyApp Dashboard</h2>} />
          <Route path="/companies/*" element={<CompanyPage />} />
          <Route path="/Clients/*" element={<ClientsPage />} />
          <Route path="/challans" element={<ChallansPage />} />
          <Route path="*" element={<h2>Page Not Found</h2>} />
        </Routes>
      </main>
    </div>
  );

}

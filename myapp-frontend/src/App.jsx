// App.jsx
import { Routes, Route } from "react-router-dom";
import DashboardLayout from "./layouts/DashboardLayout";
import PublicLayout from "./layouts/PublicLayout";
import DashboardPage from "./pages/DashboardPage";
import CompanyPage from "./pages/CompanyPage";
import ChallansPage from "./pages/ChallanPage";
import ClientsPage from "./pages/ClientsPage";
import ProfilePage from "./pages/ProfilePage";
import UsersPage from "./pages/UsersPage";
import LoginPage from "./pages/public/LoginPage";
import LandingPage from "./pages/public/LandingPage";
import ProtectedRoute from "./Components/ProtectedRoute";
import "./App.css";

export default function App() {
  return (
    <Routes>
      {/* Public website – wrapped in PublicLayout (sticky nav + footer) */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<LandingPage />} />
      </Route>

      {/* Auth */}
      <Route path="/login" element={<LoginPage />} />

      {/* Protected app routes – auth guard + DashboardLayout */}
      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/companies/*" element={<CompanyPage />} />
          <Route path="/Clients/*" element={<ClientsPage />} />
          <Route path="/challans" element={<ChallansPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/users" element={<UsersPage />} />
        </Route>
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<h2 style={{ padding: "2rem" }}>Page Not Found</h2>} />
    </Routes>
  );
}

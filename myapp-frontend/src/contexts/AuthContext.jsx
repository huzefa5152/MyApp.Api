// src/contexts/AuthContext.jsx
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { loginApi, getCurrentUser } from "../api/authApi";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // On mount: validate existing token via /auth/me.
  //
  // Pass silent=true so the httpClient 401 interceptor doesn't kick in
  // — this probe is internal bookkeeping, not a user-initiated API call.
  // Pre-fix (2026-05-12): a stale token in localStorage caused the
  // mount-time probe to 401, the interceptor saved
  // postLoginReturnTo=<current path> (e.g. "/"), redirected to /login,
  // and after a successful re-login the operator was dropped onto the
  // public landing page instead of /dashboard. The next attempt worked
  // because postLoginReturnTo had been consumed.
  useEffect(() => {
    const storedToken = localStorage.getItem("token");
    if (!storedToken) {
      setLoading(false);
      return;
    }

    getCurrentUser({ silent: true })
      .then((res) => {
        setUser(res.data);
        setToken(storedToken);
      })
      .catch(() => {
        setUser(null);
        setToken(null);
        localStorage.removeItem("token");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await loginApi(username, password);
    const { token: newToken, ...userData } = res.data;

    localStorage.setItem("token", newToken);
    setToken(newToken);
    setUser(userData);

    // Login response carries only basic profile fields; refetch /auth/me so
    // flags like isSeedAdmin are available immediately (without a page reload).
    try {
      const meRes = await getCurrentUser();
      setUser(meRes.data);
    } catch {
      /* non-fatal — /me will be retried on next mount */
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
    navigate("/login");
  }, [navigate]);

  const refreshUser = useCallback(async () => {
    const res = await getCurrentUser();
    setUser(res.data);
  }, []);

  const value = {
    user,
    token,
    setToken,
    login,
    logout,
    refreshUser,
    isAuthenticated: !!token && !!user,
    loading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}

export default AuthContext;

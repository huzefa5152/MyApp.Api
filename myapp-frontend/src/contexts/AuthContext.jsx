// src/contexts/AuthContext.jsx
import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { sameSession } from "../utils/sessionIdentity";
import { loginApi, getCurrentUser, logoutApi } from "../api/authApi";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const [loading, setLoading] = useState(true);
  // Bumps on every refreshUser() / login / explicit invalidate. Consumers
  // append it as ?v=<n> to user.avatarPath so the browser refetches the
  // image after an upload — the server keeps a stable filename
  // (user-{id}.{ext}), so without this the cached copy is shown forever.
  const [avatarVersion, setAvatarVersion] = useState(() => Date.now());
  const navigate = useNavigate();
  const loginAttempt = useRef(0);

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

    let cancelled = false;
    let retryTimer;
    const probe = () => { retryTimer = null; return getCurrentUser({ silent: true })
      .then((res) => {
        if (cancelled) return;
        setUser(res.data);
        setToken(localStorage.getItem("token"));
        setAvatarVersion(Date.now());
      })
      .catch((error) => {
        if (cancelled) return;
        if (error.response?.status !== 401 || (error.config?.headers?.Authorization && error.config.headers.Authorization !== `Bearer ${localStorage.getItem("token")}`)) {
          if (!cancelled) retryTimer = setTimeout(probe, 5000);
          return;
        }
        setUser(null);
        setToken(null);
        localStorage.removeItem("token");
        // UX continuity: if the silent probe failed while the operator
        // is parked on a PROTECTED route, hand off context to LoginPage
        // so the "session expired" banner + return-to URL still work
        // after ProtectedRoute soft-navigates them to /login. We
        // intentionally skip the flags on public routes (`/`, `/login`,
        // anything else not starting with `/`) — landing-page visitors
        // with a stale token shouldn't see the banner or be redirected.
        try {
          // Store ROUTER-relative paths (strip the /admin base) so
          // navigate(returnTo) works under the router basename —
          // mirrors the same logic in httpClient's 401 interceptor.
          const appBase = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
          let here = window.location.pathname + window.location.search + window.location.hash;
          if (appBase && here.startsWith(appBase)) here = here.slice(appBase.length) || "/";
          const isProtected = here.startsWith("/") && here !== "/" && !here.startsWith("/login");
          if (isProtected) {
            sessionStorage.setItem("postLoginReturnTo", here);
            sessionStorage.setItem("loginReason", "expired");
          }
        } catch { /* private mode — non-fatal */ }
      })
      .finally(() => {
        if (!retryTimer && !cancelled) setLoading(false);
      }); };
    probe();
    return () => { cancelled = true; clearTimeout(retryTimer); };
  }, []);

  useEffect(() => {
    if (!token) return;
    const keepAlive = () => { if (document.visibilityState === "visible" && navigator.onLine !== false) getCurrentUser().catch(() => {}); };
    const timer = setInterval(keepAlive, 60 * 1000);
    window.addEventListener("focus", keepAlive);
    return () => { clearInterval(timer); window.removeEventListener("focus", keepAlive); };
  }, [token]);

  useEffect(() => {
    const storageChanged = event => {
      if (event.key === "token" && !sameSession(event.oldValue, event.newValue)) window.location.reload();
    };
    window.addEventListener("storage", storageChanged);
    return () => window.removeEventListener("storage", storageChanged);
  }, []);

  const login = useCallback(async (username, password) => {
    const attempt = ++loginAttempt.current;
    const previousToken = localStorage.getItem("token");
    const res = await loginApi(username, password);
    if (attempt !== loginAttempt.current) return;
    const { token: newToken, ...userData } = res.data;

    localStorage.setItem("token", newToken);
    if (previousToken && !sameSession(previousToken, newToken)) {
      localStorage.removeItem("selectedCompanyId");
      window.location.reload();
      return;
    }
    setToken(newToken);
    setUser(userData);

    // Login response carries only basic profile fields; refetch /auth/me so
    // flags like isSeedAdmin are available immediately (without a page reload).
    try {
      const meRes = await getCurrentUser();
      if (attempt !== loginAttempt.current) return;
      setUser(meRes.data);
      setAvatarVersion(Date.now());
    } catch {
      /* non-fatal — /me will be retried on next mount */
    }
  }, []);

  const logout = useCallback(async () => {
    const signingOutToken = localStorage.getItem("token");
    ++loginAttempt.current;
    try {
      // Keep the token until the request interceptor has sent it, so the
      // server can revoke the session and its private-image cookie.
      await logoutApi();
    } catch {
      // Local sign-out still works if the server cannot be reached.
    } finally {
      if (!sameSession(signingOutToken, localStorage.getItem("token"))) return;
      localStorage.removeItem("token");
      setToken(null);
      setUser(null);
      navigate("/login");
    }
  }, [navigate]);

  const refreshUser = useCallback(async () => {
    const res = await getCurrentUser();
    setUser(res.data);
    // Bump unconditionally — the server reuses the avatar filename, so the
    // path is stable between uploads. Without this bump, the browser keeps
    // serving the cached image even after a successful upload/remove.
    setAvatarVersion(Date.now());
  }, []);

  const value = useMemo(() => ({
    user,
    token,
    setToken,
    login,
    logout,
    refreshUser,
    avatarVersion,
    isAuthenticated: !!token && !!user,
    loading,
  }), [user, token, login, logout, refreshUser, avatarVersion, loading]);

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

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getCompanies } from "../api/companyApi";
import { getCompanyStamps } from "../api/stampApi";
import { setActiveStamps } from "../utils/templateEngine";
import { useAuth } from "./AuthContext";

const CompanyContext = createContext(null);

const STORAGE_KEY = "selectedCompanyId";

export function CompanyProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompanyState] = useState(null);
  const [loading, setLoading] = useState(true);
  // Stamps for the selected company, shared with the Print Templates page + the
  // editor merge-field sidebar, and pushed into the template engine so
  // {{stamps.<slug>}} resolves in every print/preview.
  const [companyStamps, setCompanyStamps] = useState([]);

  const loadStamps = useCallback(async (companyId) => {
    if (!companyId) { setCompanyStamps([]); setActiveStamps({}); return; }
    try {
      const { data } = await getCompanyStamps(companyId);
      const list = data || [];
      setCompanyStamps(list);
      setActiveStamps(Object.fromEntries(list.map((s) => [s.slug, s.url])));
    } catch {
      // No view permission or transient error — clear rather than leave stale.
      setCompanyStamps([]);
      setActiveStamps({});
    }
  }, []);

  const fetchCompanies = useCallback(async () => {
    try {
      const res = await getCompanies();
      const list = res.data;
      setCompanies(list);

      const savedId = parseInt(localStorage.getItem(STORAGE_KEY));
      const saved = savedId ? list.find((c) => c.id === savedId) : null;
      // A saved id the server no longer returns is not merely ignored, it is
      // CLEARED: the list is the authorisation answer, so a revoked company
      // must not sit in storage waiting for a grant to come back.
      if (savedId && !saved) localStorage.removeItem(STORAGE_KEY);
      const next = saved || list[0] || null;
      if (next?.id) localStorage.setItem(STORAGE_KEY, next.id);
      setSelectedCompanyState(next);
    } catch {
      setCompanies([]);
      setSelectedCompanyState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) fetchCompanies();
    else {
      setCompanies([]);
      setSelectedCompanyState(null);
      setLoading(false);
    }
  }, [isAuthenticated, fetchCompanies]);

  const setSelectedCompany = useCallback((company) => {
    setSelectedCompanyState(company);
    if (company?.id) localStorage.setItem(STORAGE_KEY, company.id);
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  // (Re)load stamps whenever the selected company changes.
  useEffect(() => { loadStamps(selectedCompany?.id || null); }, [selectedCompany?.id, loadStamps]);

  // Called by the Stamps tab after an upload / rename / delete so pickers +
  // the merge engine reflect the change without a full reload.
  const refreshStamps = useCallback(() => loadStamps(selectedCompany?.id || null), [selectedCompany?.id, loadStamps]);

  const refreshCompanies = useCallback(async () => {
    const res = await getCompanies();
    const list = res.data;
    setCompanies(list);
    if (selectedCompany) {
      // Re-point selectedCompany at the FRESH object so callers see updated
      // fields (e.g. inventoryFlowVersion after a V1/V2 switch), not the stale
      // reference. Falls back to the first company if it was removed.
      const still = list.find((c) => c.id === selectedCompany.id);
      const next = still || list[0] || null;
      // Same rule on a refresh: access revoked mid-session drops the stored id
      // rather than leaving it to be re-selected later.
      if (next?.id) localStorage.setItem(STORAGE_KEY, next.id);
      else localStorage.removeItem(STORAGE_KEY);
      setSelectedCompanyState(next);
    }
  }, [selectedCompany]);

  // -- Access revalidation (ported from Trader d1049b0) --
  // /api/companies is the server's answer to "which companies may this
  // account use right now". A grant revoked while the tab is open must not
  // survive on a stale selectedCompanyId in localStorage, so re-ask:
  //   * when the tab regains focus / becomes visible again, and
  //   * whenever any request is refused for the company (httpClient raises
  //     "company-access-denied" on that 403).
  // If the selected company is gone it is dropped and the first company still
  // allowed takes over; with none left the layout shows "No Company
  // Configured".
  useEffect(() => {
    if (!isAuthenticated) return;
    const revalidate = () => { refreshCompanies().catch(() => { /* transient */ }); };
    const onVisible = () => { if (document.visibilityState === "visible") revalidate(); };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("company-access-denied", revalidate);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("company-access-denied", revalidate);
    };
  }, [isAuthenticated, refreshCompanies]);

  return (
    <CompanyContext.Provider
      value={{ companies, selectedCompany, setSelectedCompany, refreshCompanies, loading, companyStamps, refreshStamps }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used inside <CompanyProvider>");
  return ctx;
}

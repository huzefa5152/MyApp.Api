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
      setSelectedCompanyState(saved || list[0] || null);
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
      setSelectedCompanyState(still || list[0] || null);
    }
  }, [selectedCompany]);

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

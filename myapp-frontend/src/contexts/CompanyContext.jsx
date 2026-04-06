import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getCompanies } from "../api/companyApi";
import { useAuth } from "./AuthContext";

const CompanyContext = createContext(null);

const STORAGE_KEY = "selectedCompanyId";

export function CompanyProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompanyState] = useState(null);
  const [loading, setLoading] = useState(true);

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

  const refreshCompanies = useCallback(async () => {
    const res = await getCompanies();
    const list = res.data;
    setCompanies(list);
    if (selectedCompany) {
      const still = list.find((c) => c.id === selectedCompany.id);
      if (!still) setSelectedCompany(list[0] || null);
    }
  }, [selectedCompany, setSelectedCompany]);

  return (
    <CompanyContext.Provider
      value={{ companies, selectedCompany, setSelectedCompany, refreshCompanies, loading }}
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

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { getCompanies } from "../api/companyApi";
import { getCompanyStamps } from "../api/stampApi";
import { setActiveStamps } from "../utils/templateEngine";
import { loadStampImage, stampImageSrc } from "../utils/stampImages";
import { useAuth } from "./AuthContext";
import { usePermissions } from "./PermissionsContext";

const CompanyContext = createContext(null);

const STORAGE_KEY = "selectedCompanyId";

export function CompanyProvider({ children }) {
  const { isAuthenticated, token } = useAuth();
  const { has } = usePermissions();
  const canViewStamps = has("printtemplates.stamps.view");
  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompanyState] = useState(null);
  const [loading, setLoading] = useState(true);
  // Stamps for the selected company, shared with the Print Templates page + the
  // editor merge-field sidebar, and pushed into the template engine so
  // {{stamps.<slug>}} resolves in every print/preview.
  const [companyStamps, setCompanyStamps] = useState([]);

  const stampRequest = useRef(0);
  // Images held in memory for this login only (see utils/stampImages.js).
  const stampImages = useRef({ token: null, cache: new Map() });
  const companyRequest = useRef(0);

  const loadStamps = useCallback(
    async (companyId) => {
      const request = ++stampRequest.current;
      setCompanyStamps([]);
      setActiveStamps({});
      if (!companyId || !canViewStamps) {
        setCompanyStamps([]);
        setActiveStamps({});
        return;
      }
      try {
        const { data } = await getCompanyStamps(companyId);
        if (request !== stampRequest.current) return;
        const list = data || [];
        const publish = (stamps) => {
          setCompanyStamps(stamps);
          setActiveStamps(Object.fromEntries(stamps.map((s) => [s.slug, stampImageSrc(s)])));
        };
        // Usable at once by URL; a print started now must not lose its stamp to the wait below.
        publish(list);
        if (stampImages.current.token !== token) stampImages.current = { token, cache: new Map() };
        const { cache } = stampImages.current;
        const images = await Promise.all(list.map((s) => loadStampImage(s, cache)));
        if (request !== stampRequest.current) return;
        publish(list.map((s, i) => (images[i] ? { ...s, image: images[i] } : s)));
      } catch {
        if (request !== stampRequest.current) return;
        // No view permission or transient error — clear rather than leave stale.
        setCompanyStamps([]);
        setActiveStamps({});
      }
    },
    [canViewStamps, token],
  );

  const fetchCompanies = useCallback(async () => {
    const request = ++companyRequest.current;
    try {
      const res = await getCompanies();
      if (request !== companyRequest.current) return;
      const list = res.data;
      setCompanies(list);

      const savedId = parseInt(localStorage.getItem(STORAGE_KEY));
      const saved = savedId ? list.find((c) => c.id === savedId) : null;
      const selected = saved || list[0] || null;
      if (selected) localStorage.setItem(STORAGE_KEY, selected.id);
      else localStorage.removeItem(STORAGE_KEY);
      setSelectedCompanyState(selected);
    } catch {
      if (request !== companyRequest.current) return;
      setCompanies([]);
      setSelectedCompanyState(null);
    } finally {
      if (request === companyRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) fetchCompanies();
    else {
      ++companyRequest.current;
      setCompanies([]);
      setSelectedCompanyState(null);
      setLoading(false);
    }
    return () => {
      ++companyRequest.current;
    };
  }, [isAuthenticated, token, fetchCompanies]);

  const setSelectedCompany = useCallback((company) => {
    ++stampRequest.current;
    setCompanyStamps([]);
    setActiveStamps({});
    setSelectedCompanyState(company);
    if (company?.id) localStorage.setItem(STORAGE_KEY, company.id);
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  // (Re)load stamps whenever the selected company changes.
  useEffect(() => {
    loadStamps(isAuthenticated ? selectedCompany?.id || null : null);
    return () => {
      ++stampRequest.current;
    };
  }, [selectedCompany?.id, isAuthenticated, loadStamps]);

  // Called by the Stamps tab after an upload / rename / delete so pickers +
  // the merge engine reflect the change without a full reload.
  const refreshStamps = useCallback(
    () => loadStamps(selectedCompany?.id || null),
    [selectedCompany?.id, loadStamps],
  );

  const refreshCompanies = useCallback(async () => {
    const request = ++companyRequest.current;
    const res = await getCompanies();
    if (request !== companyRequest.current) return;
    const list = res.data;
    setCompanies(list);
    if (selectedCompany) {
      const still = list.find((c) => c.id === selectedCompany.id);
      if (!still) setSelectedCompany(list[0] || null);
    }
  }, [selectedCompany, setSelectedCompany]);

  // ── Access revalidation (2026-09-11) ──
  // /api/companies is the server's answer to "which companies may this
  // account use right now". A grant revoked while the tab is open must
  // not survive on a stale selectedCompanyId in localStorage, so re-ask:
  //   • when the tab regains focus / becomes visible again, and
  //   • whenever any request is refused for the company (httpClient
  //     raises "company-access-denied" on that 403).
  // If the selected company is gone it is dropped and the first company
  // still allowed takes over; with none left the layout shows the
  // "No Company Configured" screen.
  useEffect(() => {
    if (!isAuthenticated) return;
    const revalidate = () => {
      refreshCompanies().catch(() => {
        /* transient */
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("company-access-denied", revalidate);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("company-access-denied", revalidate);
    };
  }, [isAuthenticated, refreshCompanies]);

  const value = useMemo(
    () => ({
      companies,
      selectedCompany,
      setSelectedCompany,
      refreshCompanies,
      loading,
      companyStamps,
      refreshStamps,
    }),
    [
      companies,
      selectedCompany,
      setSelectedCompany,
      refreshCompanies,
      loading,
      companyStamps,
      refreshStamps,
    ],
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used inside <CompanyProvider>");
  return ctx;
}

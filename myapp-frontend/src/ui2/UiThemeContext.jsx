import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { DEFAULT_THEME, THEMES, getTheme } from "./themes";

const UiThemeContext = createContext({ theme: getTheme(DEFAULT_THEME), setTheme: () => {}, themes: THEMES });

const LAST = "ui.theme:last"; // this device's most recent choice: used before sign-in finishes, so there is no flash
const keyFor = (user) => (user ? `ui.theme:${user.id ?? user.userId ?? user.username}` : null);
const read = (key) => { try { return key ? localStorage.getItem(key) : null; } catch { return null; } };
// A signed-in user gets exactly what they chose on this device (default if never chosen);
// before sign-in resolves, show the device's last theme.
const resolve = (key) => getTheme(key ? read(key) : read(LAST)).id;

/**
 * Per-user, per-device interface theme. The choice is stored in this browser under the signed-in
 * user's id and stays until that user picks another one; other users on the same browser keep theirs.
 */
export function UiThemeProvider({ children }) {
  const { user } = useAuth();
  const key = keyFor(user);
  const [id, setId] = useState(() => resolve(key));

  // A different user signing in on the same browser gets their own choice.
  useEffect(() => { setId(resolve(key)); }, [key]);

  const theme = getTheme(id);
  useEffect(() => {
    document.documentElement.dataset.uiTheme = theme.id;
    document.documentElement.dataset.uiLayout = theme.layout;
  }, [theme]);

  const setTheme = useCallback((next) => {
    const t = getTheme(next);
    setId(t.id);
    try { if (key) localStorage.setItem(key, t.id); localStorage.setItem(LAST, t.id); } catch { /* private mode: still applies for this session */ }
  }, [key]);

  const value = useMemo(() => ({ theme, setTheme, themes: THEMES }), [theme, setTheme]);
  return <UiThemeContext.Provider value={value}>{children}</UiThemeContext.Provider>;
}

export const useUiTheme = () => useContext(UiThemeContext);

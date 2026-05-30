import type React from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  applyThemePreference,
  getStoredThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "../utils/themePreference";

type ThemeContextType = {
  theme: ResolvedTheme;
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>("light");
  const [theme, setTheme] = useState<ResolvedTheme>("light");
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const pref = getStoredThemePreference() ?? "light";
    const resolved = applyThemePreference(pref);
    setThemePreferenceState(pref);
    setTheme(resolved);
    setIsInitialized(true);
  }, []);

  useEffect(() => {
    if (!isInitialized || themePreference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const resolved = applyThemePreference("system");
      setTheme(resolved);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [isInitialized, themePreference]);

  const setThemePreference = useCallback((preference: ThemePreference) => {
    const resolved = applyThemePreference(preference);
    setThemePreferenceState(preference);
    setTheme(resolved);
  }, []);

  const toggleTheme = useCallback(() => {
    const next: ThemePreference = theme === "light" ? "dark" : "light";
    setThemePreference(next);
  }, [theme, setThemePreference]);

  return (
    <ThemeContext.Provider value={{ theme, themePreference, setThemePreference, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};

/** Apply saved user theme from API (light / dark / system). */
export function syncThemeFromUserSettings(theme: string) {
  const pref: ThemePreference =
    theme === "dark" || theme === "system" ? theme : "light";
  applyThemePreference(pref);
}

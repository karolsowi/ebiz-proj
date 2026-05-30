export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const PREF_KEY = 'themePreference';

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return preference;
}

export function getStoredThemePreference(): ThemePreference | null {
  const stored = localStorage.getItem(PREF_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return null;
}

/** Apply saved user theme from API (light / dark / system). */
export function syncThemeFromUserSettings(theme: string): ResolvedTheme {
  const pref: ThemePreference =
    theme === "dark" || theme === "system" ? theme : "light";
  return applyThemePreference(pref);
}

export function applyThemePreference(preference: ThemePreference): ResolvedTheme {
  localStorage.setItem(PREF_KEY, preference);
  const resolved = resolveTheme(preference);
  localStorage.setItem('theme', resolved);
  if (resolved === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  return resolved;
}

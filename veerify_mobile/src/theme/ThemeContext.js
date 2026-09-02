// src/theme/ThemeContext.js
//
// ThemeProvider + useTheme() hook + AsyncStorage persistence.
//
// Contract:
//   const { mode, palette, setMode, toggleMode, ready } = useTheme();
//
//   mode        — 'light' | 'dark'
//   palette     — resolved token bag; SAME shape as the legacy
//                 export from src/theme.js so a screen migrated to
//                 useTheme() gets the identical keys (palette.text,
//                 palette.surface, palette.purple.vivid, …).
//   setMode(m)  — persist + apply a specific mode.
//   toggleMode()— flip between light and dark.
//   ready       — false while we're hydrating from AsyncStorage on
//                 boot; the app root gates first render on this so
//                 the wrong theme never flashes.
//
// Storage: 'veerify_theme_mode' → 'light' | 'dark'. Missing / any
// other value defaults to 'light'.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { lightTheme, darkTheme, themeByMode } from './themes';

const STORAGE_KEY = 'veerify_theme_mode';

const ThemeContext = createContext({
  mode:    'light',
  palette: lightTheme.palette,
  setMode: () => {},
  toggleMode: () => {},
  ready:   true,
});

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState('light');
  const [ready, setReady] = useState(false);

  // Hydrate from storage on mount. Runs exactly once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (cancelled) return;
        if (raw === 'dark' || raw === 'light') setModeState(raw);
      } catch (_) { /* fall through to default 'light' */ }
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const setMode = useCallback(async (next) => {
    const safe = next === 'dark' ? 'dark' : 'light';
    setModeState(safe);
    try { await AsyncStorage.setItem(STORAGE_KEY, safe); }
    catch (_) { /* best-effort — the in-memory switch still applies */ }
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  const value = useMemo(() => {
    const theme = themeByMode(mode);
    return {
      mode,
      palette: theme.palette,
      setMode,
      toggleMode,
      ready,
    };
  }, [mode, ready, setMode, toggleMode]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

// Also export the resolved default so any module-load call site
// (StyleSheet.create) has something sensible until it migrates to
// useTheme(). The legacy `src/theme.js#palette` continues to work
// unchanged — this hook is purely additive.
export { lightTheme, darkTheme };

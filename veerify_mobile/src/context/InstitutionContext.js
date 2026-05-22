import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../api/client';

// ─────────────────────────────────────────────────────────────────────────────
// InstitutionContext
//
// Holds the currently-selected institution for the student-facing experience.
// Persisted in AsyncStorage so a returning user lands back at the same academy.
//
// Available everywhere via useInstitution():
//   selectedInstitution   the current institution object (or null on first run)
//   loading               true while we're hydrating from storage on mount
//   institutions          cached list of browsable institutions (for the picker)
//   fetchingList          true while institutions[] is loading
//   selectInstitution(i)  switch + persist
//   clearInstitution()    forget the saved choice (used by "Change academy" flow)
//   refreshList(lat,lng)  pull a fresh nearby list; lat/lng optional
//
// Guest vs logged-in: same context — institution choice is independent of auth.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'veerify_selected_institution_v1';

const InstitutionContext = createContext(null);

export function InstitutionProvider({ children }) {
  const [selectedInstitution, setSelectedInstitution] = useState(null);
  const [loading, setLoading] = useState(true);
  const [institutions, setInstitutions] = useState([]);
  const [fetchingList, setFetchingList] = useState(false);
  const [listError, setListError] = useState(null);

  // Hydrate from AsyncStorage on app boot.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.id) setSelectedInstitution(parsed);
        }
      } catch (err) {
        console.log('[INST] hydrate failed:', err?.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch the institutions list. Pass lat/lng for nearest-sorted, omit for
  // the date-sorted fallback. Result lives in `institutions` for the picker UI.
  const refreshList = useCallback(async (lat, lng) => {
    setFetchingList(true);
    setListError(null);
    try {
      const params = new URLSearchParams();
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        params.set('lat', String(lat));
        params.set('lng', String(lng));
      }
      params.set('limit', '50');
      const res = await apiClient.get(`/institutions/nearby?${params.toString()}`);
      const list = res.data.institutions || [];
      setInstitutions(list);
      return list;
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to load institutions';
      console.log('[INST] refreshList failed:', msg);
      setListError(msg);
      return [];
    } finally {
      setFetchingList(false);
    }
  }, []);

  // Persist the user's choice. We store the FULL institution object so the
  // UI can render name/logo/city instantly on next launch, before any network.
  const selectInstitution = useCallback(async (inst) => {
    if (!inst) return;
    setSelectedInstitution(inst);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(inst));
    } catch (err) {
      console.log('[INST] persist failed:', err?.message);
    }
  }, []);

  const clearInstitution = useCallback(async () => {
    setSelectedInstitution(null);
    try { await AsyncStorage.removeItem(STORAGE_KEY); } catch {}
  }, []);

  // Best-effort auto-select: if no institution is saved yet, pick the first
  // from a fresh list. Called by screens that don't want to force the user
  // through the picker on every launch.
  const autoSelectFirstAvailable = useCallback(async (lat, lng) => {
    if (selectedInstitution) return selectedInstitution;
    const list = await refreshList(lat, lng);
    if (list.length > 0) {
      await selectInstitution(list[0]);
      return list[0];
    }
    return null;
  }, [selectedInstitution, refreshList, selectInstitution]);

  return (
    <InstitutionContext.Provider
      value={{
        selectedInstitution,
        loading,
        institutions,
        fetchingList,
        listError,
        selectInstitution,
        clearInstitution,
        refreshList,
        autoSelectFirstAvailable,
      }}
    >
      {children}
    </InstitutionContext.Provider>
  );
}

export function useInstitution() {
  const ctx = useContext(InstitutionContext);
  if (!ctx) {
    // Safe default so a screen that mounts outside the provider (impossible
    // in our setup but defensive) gets sensible no-ops instead of crashes.
    return {
      selectedInstitution: null,
      loading: false,
      institutions: [],
      fetchingList: false,
      listError: null,
      selectInstitution: async () => {},
      clearInstitution: async () => {},
      refreshList: async () => [],
      autoSelectFirstAvailable: async () => null,
    };
  }
  return ctx;
}

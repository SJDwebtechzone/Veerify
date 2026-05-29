// src/context/ChildContext.js
//
// Parent role's "currently active child" state. Every parent screen reads
// from this context to know which child's data to show. The parent can
// switch between linked children at any time via LinkedChildrenScreen.
//
// Persistence: the chosen active child id is stored in AsyncStorage so the
// parent doesn't have to re-pick on every app open. On boot we hydrate, then
// re-fetch the children list and reconcile.

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../api/client';
import { useAuth } from './AuthContext';

const STORAGE_KEY = 'veerify_parent_active_child_id';

const ChildContext = createContext(null);

export function ChildProvider({ children }) {
  const { user } = useAuth();
  const [list, setList] = useState([]);             // [{ child_id, child_name, ... }]
  const [activeChildId, setActiveChildId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState(null);

  // Hydrate the persisted active-child id once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && raw) setActiveChildId(Number(raw) || null);
      } catch (err) {
        console.log('[CHILD] hydrate failed:', err?.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch the parent's linked children. Auto-select the first active one
  // when nothing is selected yet (first-time experience).
  const refresh = useCallback(async () => {
    if (!user || user.role !== 'parent') {
      setList([]); setActiveChildId(null); setFetching(false);
      return [];
    }
    setFetching(true);
    setError(null);
    try {
      const res = await apiClient.get('/parents/children').catch(() => ({ data: { children: [] } }));
      const rows = res.data?.children || [];
      setList(rows);

      // Auto-pick a sensible default: first active child if no active id, or
      // current active id is no longer valid.
      const active = rows.find((c) => c.child_id === activeChildId && c.status === 'active');
      if (!active) {
        const firstActive = rows.find((c) => c.status === 'active');
        if (firstActive) {
          setActiveChildId(firstActive.child_id);
          AsyncStorage.setItem(STORAGE_KEY, String(firstActive.child_id)).catch(() => {});
        } else {
          setActiveChildId(null);
          AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
        }
      }
      return rows;
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to load children';
      setError(msg);
      return [];
    } finally {
      setFetching(false);
    }
  }, [user, activeChildId]);

  // Re-fetch whenever auth state changes (login / logout / role).
  useEffect(() => {
    if (!loading && user?.role === 'parent') refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role, loading]);

  const switchChild = useCallback(async (childId) => {
    const target = list.find((c) => c.child_id === childId && c.status === 'active');
    if (!target) return false;
    setActiveChildId(childId);
    try { await AsyncStorage.setItem(STORAGE_KEY, String(childId)); } catch {}
    return true;
  }, [list]);

  const activeChild = list.find((c) => c.child_id === activeChildId) || null;

  return (
    <ChildContext.Provider value={{
      list,                  // every linked child (active + pending)
      activeChild,           // current selection (may be null)
      activeChildId,
      switchChild,
      refresh,
      loading,
      fetching,
      error,
    }}>
      {children}
    </ChildContext.Provider>
  );
}

export function useChild() {
  const ctx = useContext(ChildContext);
  if (!ctx) {
    // Safe default when used outside the provider (e.g. login screen).
    return {
      list: [], activeChild: null, activeChildId: null,
      switchChild: async () => false, refresh: async () => [],
      loading: false, fetching: false, error: null,
    };
  }
  return ctx;
}

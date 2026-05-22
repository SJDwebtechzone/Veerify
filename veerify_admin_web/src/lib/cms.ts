import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/**
 * useCmsCollection — talks to /api/cms/<resource> on the backend.
 *
 * Keeps the same return shape as the older localStorage version
 * (items / create / update / remove / move / reset), so the CMS pages
 * don't need to change.
 *
 * `resource` is one of: 'banners' | 'categories' | 'videos' | 'events'.
 * Backend uses snake_case columns; we translate transparently below.
 */

// camelCase fields used inside the admin app
type Camel = Record<string, unknown>;
// snake_case rows coming back from postgres
type Snake = Record<string, unknown>;

function camel(s: string) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
function snake(s: string) {
  return s.replace(/([A-Z])/g, (_, c: string) => `_${c.toLowerCase()}`);
}

function fromApi(row: Snake): Camel {
  const out: Camel = {};
  for (const k of Object.keys(row)) {
    let v = row[k];
    // Postgres dates come back as ISO timestamps; trim to YYYY-MM-DD
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && (k === 'event_date' || k === 'registration_closing_date')) {
      v = v.slice(0, 10);
    }
    // Map snake fields to camel: event_date -> date,
    // registration_closing_date -> registrationClosingDate, etc.
    let key = camel(k);
    if (k === 'event_date') key = 'date';
    out[key] = v;
  }
  // backend ids are numbers — keep as strings for the frontend
  if (out.id !== undefined) out.id = String(out.id);
  return out;
}

function toApi(patch: Camel): Snake {
  const out: Snake = {};
  for (const k of Object.keys(patch)) {
    if (k === 'id') continue;
    let key = snake(k);
    if (k === 'date') key = 'event_date';
    out[key] = patch[k];
  }
  return out;
}

export function useCmsCollection<T extends { id: string; sortOrder?: number }>(
  resource: string,
  seed: T[],
) {
  const [items, setItems] = useState<T[]>(seed);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get(`/cms/${resource}`);
      const rows = (res.data?.items ?? []) as Snake[];
      const mapped = rows.map(fromApi) as unknown as T[];
      setItems(mapped);
      setError(null);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e?.message ?? 'Failed to load');
      // If backend is unreachable, fall back to the seed so the UI still renders
      console.warn(`[cms] ${resource} fetch failed — using seed data`);
    } finally {
      setLoading(false);
    }
  }, [resource]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = async (input: Omit<T, 'id' | 'sortOrder'> & Partial<Pick<T, 'sortOrder'>>) => {
    try {
      const body = toApi(input as Camel);
      const res = await api.post(`/cms/${resource}`, body);
      const created = fromApi(res.data.item) as unknown as T;
      setItems((prev) => [...prev, created].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
      return created;
    } catch (err) {
      console.error('[cms.create]', err);
      throw err;
    }
  };

  const update = async (id: string, patch: Partial<T>) => {
    try {
      const body = toApi(patch as Camel);
      const res = await api.put(`/cms/${resource}/${id}`, body);
      const updated = fromApi(res.data.item) as unknown as T;
      setItems((prev) => prev.map((it) => (it.id === id ? updated : it)));
    } catch (err) {
      console.error('[cms.update]', err);
      throw err;
    }
  };

  const remove = async (id: string) => {
    try {
      await api.delete(`/cms/${resource}/${id}`);
      setItems((prev) => prev.filter((it) => it.id !== id));
    } catch (err) {
      console.error('[cms.remove]', err);
      throw err;
    }
  };

  const move = async (id: string, direction: 'up' | 'down') => {
    const sorted = [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const idx = sorted.findIndex((it) => it.id === id);
    const swap = direction === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || swap < 0 || swap >= sorted.length) return;
    const reordered = [...sorted];
    [reordered[idx], reordered[swap]] = [reordered[swap], reordered[idx]];
    const order = reordered.map((it) => it.id);
    // optimistic UI
    setItems(reordered.map((it, i) => ({ ...it, sortOrder: i + 1 })));
    try {
      await api.post(`/cms/${resource}/reorder`, { order });
    } catch (err) {
      console.error('[cms.move]', err);
      refresh();
    }
  };

  const reset = () => refresh();

  const sorted = [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return { items: sorted, loading, error, create, update, remove, reset, move, refresh };
}

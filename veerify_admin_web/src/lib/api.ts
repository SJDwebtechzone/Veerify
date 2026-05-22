import axios from 'axios';

// Backend base URL. Override via VITE_API_URL in .env if needed.
const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:5000/api';

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
     if (err.response) {
      console.warn('[API]', err.response.status, err.config?.url, err.response.data);
      // ← ADD THIS:
      if (err.response.status === 401) {
        localStorage.removeItem('veerify-admin-token');
        localStorage.removeItem('veerify-admin-user');
        window.location.href = '/login';
      }
    } else {
      console.warn('[API] Network error', err.config?.url, err.message);
    }
    return Promise.reject(err);
  },
);

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('veerify-admin-token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Upload an image file to the backend.
 * Returns the RELATIVE path so the same record works for the browser admin
 * (localhost:5000) and the mobile emulator (10.0.2.2:5000).
 * Use `resolveImageUrl(path)` to render it in the admin UI.
 */
export async function uploadImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await api.post('/uploads', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  // Prefer the relative path; fall back to the full URL on older responses.
  return (res.data.path as string) || (res.data.url as string);
}

/**
 * Turn a stored image value (could be relative `/uploads/...`, a full
 * `localhost:5000/...` URL from older records, or any other absolute URL)
 * into something the admin browser can render.
 */
const ASSET_BASE = ((import.meta as any).env?.VITE_API_URL || 'http://localhost:5000/api').replace(/\/api\/?$/, '');

export function resolveImageUrl(src: string | null | undefined): string {
  if (!src) return '';
  if (src.startsWith('data:')) return src;
  if (src.startsWith('/uploads/')) return ASSET_BASE + src;
  return src;
}

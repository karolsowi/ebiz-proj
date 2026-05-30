/** Empty VITE_API_URL → same-origin `/api/...` (Vite dev proxy). Otherwise absolute base without trailing slash. */
export function apiUrl(path: string): string {
  const root = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${root}${p}`;
}

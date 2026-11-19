// Central API client. Handles JWT access/refresh tokens, auto-refresh on 401,
// and consistent error surfacing. Tokens kept in memory + localStorage (access
// short-lived; refresh rotated server-side).

const ACCESS = 'pacs_access';
const REFRESH = 'pacs_refresh';

export function getAccess() { return localStorage.getItem(ACCESS); }
export function getRefresh() { return localStorage.getItem(REFRESH); }
export function setTokens(access: string, refresh: string) {
  localStorage.setItem(ACCESS, access);
  localStorage.setItem(REFRESH, refresh);
}
export function clearTokens() {
  localStorage.removeItem(ACCESS);
  localStorage.removeItem(REFRESH);
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: any) {
    super(message);
  }
}

async function raw(path: string, options: RequestInit = {}, retry = true): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  const token = getAccess();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...options, headers });

  if (res.status === 401 && retry && getRefresh()) {
    const refreshed = await tryRefresh();
    if (refreshed) return raw(path, options, false);
  }

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = body?.message
      ? (Array.isArray(body.message) ? body.message.join(', ') : body.message)
      : `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, body);
  }
  return body;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: getRefresh() }),
    });
    if (!res.ok) { clearTokens(); return false; }
    const data = await res.json();
    setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    clearTokens();
    return false;
  }
}

export const api = {
  get: (p: string) => raw(p, { method: 'GET' }),
  post: (p: string, body?: any) => raw(p, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: (p: string, body?: any) => raw(p, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
};

export interface Paginated<T> {
  data: T[]; total: number; page: number; pageSize: number; totalPages: number;
}

export function qs(params: Record<string, any>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

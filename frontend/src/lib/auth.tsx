import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, setTokens, clearTokens, getAccess } from './api';

interface Me {
  id: string; username: string; roles: string[];
  isSuperAdmin: boolean; permissions: string[];
}

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (perm: string) => boolean;
}

const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  // On load, derive identity from the access token + fetch effective permissions
  // by probing. We store permissions client-side only for UI gating (server still enforces).
  useEffect(() => {
    const t = getAccess();
    if (!t) { setLoading(false); return; }
    hydrate().finally(() => setLoading(false));
  }, []);

  async function hydrate() {
    try {
      const who = await api.get('/auth/me');
      setMe({
        id: who.id, username: who.username, roles: who.roles,
        isSuperAdmin: who.isSuperAdmin, permissions: who.permissions,
      });
      // Persist identity claims used for Socket.IO room membership (Phase 8).
      try {
        localStorage.setItem('pacs_me', JSON.stringify({
          organizationId: who.organizationId ?? null, roles: who.roles ?? [],
        }));
      } catch { /* ignore */ }
    } catch {
      clearTokens();
      setMe(null);
    }
  }

  async function login(username: string, password: string) {
    const res = await api.post('/auth/login', { username, password });
    setTokens(res.accessToken, res.refreshToken);
    await hydrate();
  }

  async function logout() {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    clearTokens();
    setMe(null);
  }

  // Server is authoritative; this gates UI affordances only.
  const can = (perm: string) =>
    !!me && (me.isSuperAdmin || me.permissions.includes(perm));

  return (
    <Ctx.Provider value={{ me, loading, login, logout, can }}>
      {children}
    </Ctx.Provider>
  );
}

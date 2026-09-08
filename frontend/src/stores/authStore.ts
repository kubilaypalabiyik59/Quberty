import { create } from 'zustand';
import { api, setAccessToken, getAccessToken } from '@/lib/api';

interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
}

interface AuthState {
  user: User | null;
  /**
   * The tenant this session is authenticated against — the same value the API
   * client sends as `X-Tenant-ID`, mirrored into reactive state.
   *
   * It exists because `localStorage` is not reactive and because a cache keyed
   * without it is not tenant-safe. The QueryClient is created once at module
   * scope in `components/Providers.tsx` and survives a client-side
   * logout/login, so a cached answer computed for one tenant can be handed to
   * the next one inside its `staleTime` window unless the tenant is part of the
   * cache identity. `lib/useTaxPreview.ts` reads this for exactly that reason.
   *
   * It is an identifier, not a credential: it is already stored in
   * `localStorage` and sent as a plain request header. The access token is NOT
   * here and must never be put in a cache key.
   *
   * Null means "not resolved yet" (first render, before `loadUser` runs) or
   * "signed out". Both are states in which a tenant-scoped query must not run.
   */
  tenantId: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  loadUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  // Deliberately not seeded from localStorage here: this store is constructed at
  // module scope, where `window` does not exist during server rendering.
  // `loadUser` resolves it on the client.
  tenantId: null,
  isLoading: true,

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    const { access_token, user, tenant_id } = data.data;
    // refresh_token is set as httpOnly cookie by the server — not stored here
    setAccessToken(access_token);
    localStorage.setItem('tenant_id', tenant_id);
    set({ user, tenantId: tenant_id });
  },

  logout: () => {
    setAccessToken(null);
    localStorage.removeItem('tenant_id');
    // Cleared with the session. Tenant-scoped queries key on this, so dropping
    // it also stops them the moment the user signs out.
    set({ user: null, tenantId: null });
  },

  loadUser: async () => {
    try {
      // No token in memory (e.g. page refresh) — attempt silent refresh via httpOnly cookie
      if (!getAccessToken()) {
        const tenantId = localStorage.getItem('tenant_id');
        if (!tenantId) { set({ isLoading: false }); return; }
        const { data: rd } = await api.post('/auth/refresh', {});
        setAccessToken(rd.data.access_token);
      }
      const { data } = await api.get('/auth/me');
      // `/auth/me` returns the user only, so the tenant comes from the same
      // place the API client reads it — that is the point: the cache identity
      // must match the tenant the request is actually made against.
      set({ user: data.data, tenantId: localStorage.getItem('tenant_id'), isLoading: false });
    } catch {
      setAccessToken(null);
      set({ user: null, tenantId: null, isLoading: false });
    }
  },
}));

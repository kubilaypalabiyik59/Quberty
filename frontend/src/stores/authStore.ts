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
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  loadUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    const { access_token, user, tenant_id } = data.data;
    // refresh_token is set as httpOnly cookie by the server — not stored here
    setAccessToken(access_token);
    localStorage.setItem('tenant_id', tenant_id);
    set({ user });
  },

  logout: () => {
    setAccessToken(null);
    localStorage.removeItem('tenant_id');
    set({ user: null });
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
      set({ user: data.data, isLoading: false });
    } catch {
      setAccessToken(null);
      set({ user: null, isLoading: false });
    }
  },
}));

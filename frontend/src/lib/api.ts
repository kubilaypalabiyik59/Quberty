import axios from 'axios';

// Access token lives in memory only — never written to localStorage (XSS protection)
let _accessToken: string | null = null;
export function setAccessToken(t: string | null) { _accessToken = t; }
export function getAccessToken() { return _accessToken; }

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true, // sends httpOnly refresh_token cookie automatically
});

// Attach JWT + tenant headers automatically
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const tenantId = localStorage.getItem('tenant_id');
    if (_accessToken) config.headers.Authorization = `Bearer ${_accessToken}`;
    if (tenantId) config.headers['X-Tenant-ID'] = tenantId;
  }
  return config;
});

// Auto-refresh on 401 — uses httpOnly cookie, no localStorage token needed
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;

    // A 401 from the auth endpoints themselves means "wrong credentials" or
    // "no/expired refresh token" — NOT an expired access token. Don't try to
    // refresh or bounce to /login; let the calling page show its own error.
    const reqUrl: string = original?.url ?? '';
    const isAuthEndpoint = /\/auth\/(login|register|refresh)/.test(reqUrl);

    if (err.response?.status === 401 && !original._retry && !isAuthEndpoint) {
      original._retry = true;
      try {
        const { data } = await axios.post(
          `${BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true }
        );
        setAccessToken(data.data.access_token);
        original.headers.Authorization = `Bearer ${data.data.access_token}`;
        return api(original);
      } catch {
        setAccessToken(null);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('tenant_id');
          window.location.href = '/login';
        }
      }
    }

    return Promise.reject(err);
  }
);

/**
 * Workforce idle timeout, shared by every tab of the browser.
 *
 * The last-activity time lives in localStorage rather than in memory so that
 * working in one tab keeps the others alive, and so that coming back to a
 * browser that sat idle past the limit — even closed — asks for a sign-in
 * instead of silently restoring the session from the refresh cookie.
 *
 * Only workforce (ERP) sessions write the activity key. A storefront shopper
 * never does, so their session is not subject to the workforce timeout.
 *
 * These values are an identifier and a timestamp, not credentials.
 */

const ACTIVITY_KEY = 'quberty.session.last_activity';
const TIMEOUT_KEY = 'quberty.session.idle_timeout_minutes';
const DEFAULT_TIMEOUT_MINUTES = 10;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the in-tab timer still enforces the limit */
  }
}

/** The policy the server last sent; kept so a reload can judge expiry before refreshing. */
export function setIdleTimeoutMinutes(minutes: number | undefined) {
  if (minutes && Number.isFinite(minutes) && minutes > 0) write(TIMEOUT_KEY, String(minutes));
}

export function idleTimeoutMs(): number {
  const m = Number(read(TIMEOUT_KEY));
  return (Number.isFinite(m) && m > 0 ? m : DEFAULT_TIMEOUT_MINUTES) * 60_000;
}

export function markActivity(now = Date.now()) {
  write(ACTIVITY_KEY, String(now));
}

export function lastActivity(): number | null {
  const v = Number(read(ACTIVITY_KEY));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** True when a workforce session exists and has been idle past the limit. */
export function isIdleExpired(now = Date.now()): boolean {
  const last = lastActivity();
  return last !== null && now - last >= idleTimeoutMs();
}

export function clearActivity() {
  write(ACTIVITY_KEY, null);
}

export const ACTIVITY_STORAGE_KEY = ACTIVITY_KEY;

const SIGNOUT_REASON_KEY = 'quberty.session.signout_reason';

/**
 * Why this tab's session ended, for the sign-in page to explain. Kept in
 * sessionStorage rather than the URL because more than one redirect to
 * /login can race when a session ends, and only one of them carries a query.
 */
export function setSignoutReason(reason: 'idle') {
  try { sessionStorage.setItem(SIGNOUT_REASON_KEY, reason); } catch { /* ignore */ }
}

export function takeSignoutReason(): string | null {
  try {
    const r = sessionStorage.getItem(SIGNOUT_REASON_KEY);
    sessionStorage.removeItem(SIGNOUT_REASON_KEY);
    return r;
  } catch {
    return null;
  }
}

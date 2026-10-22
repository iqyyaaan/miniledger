import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { authApi } from '@/lib/endpoints';
import {
  consumePendingTokens,
  currentRefreshToken,
  getSessionState,
  hydrateSession,
  setSignedIn,
  setSignedOut,
  subscribeToSession,
  type SessionState,
} from '@/lib/session-store';

/**
 * Bridges the plain `session-store` into React via `useSyncExternalStore` —
 * the store is the source of truth (and what the API client reads directly);
 * this hook just makes components re-render when it changes.
 */
export function useAuth() {
  const session = useSyncExternalStore(subscribeToSession, getSessionState);

  // Runs once per app launch: pull tokens out of the keychain, then confirm
  // they still work by asking the API who they belong to. A token that was
  // revoked server-side (e.g. the device was signed out elsewhere) fails
  // here rather than the app believing a session that is already dead.
  useEffect(() => {
    if (session.status !== 'loading') return;

    let cancelled = false;
    (async () => {
      await hydrateSession();
      const tokens = consumePendingTokens();
      if (!tokens) return; // hydrateSession already moved to 'signedOut'.

      try {
        const { user } = await authApi.me();
        if (!cancelled) await setSignedIn(tokens, user);
      } catch {
        if (!cancelled) await setSignedOut();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session.status]);

  const requestOtp = useCallback((phone: string) => authApi.requestOtp(phone), []);

  const verifyOtp = useCallback(async (phone: string, code: string) => {
    const result = await authApi.verifyOtp(phone, code);
    await setSignedIn({ accessToken: result.accessToken, refreshToken: result.refreshToken }, result.user);
    return result;
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = currentRefreshToken();
    // Best-effort: whether or not the server-side revoke succeeds, the device
    // forgets its tokens either way — a flaky connection shouldn't trap the
    // user in a signed-in state they can't get out of.
    if (refreshToken) await authApi.logout(refreshToken).catch(() => undefined);
    await setSignedOut();
  }, []);

  return { session, requestOtp, verifyOtp, logout };
}

export type { SessionState };

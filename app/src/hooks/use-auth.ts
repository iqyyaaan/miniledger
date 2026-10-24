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

// bridges the plain session-store into React via useSyncExternalStore —
// the store is the actual source of truth (and what the API client reads
// directly), this hook just makes components re-render when it changes
export function useAuth() {
  const session = useSyncExternalStore(subscribeToSession, getSessionState);

  // runs once per app launch — pull tokens out of the keychain, then
  // confirm they still actually work by asking the API who they belong to.
  // a token revoked server-side (device got signed out elsewhere, say)
  // fails right here instead of the app believing a session that's dead.
  useEffect(() => {
    if (session.status !== 'loading') return;

    let cancelled = false;
    (async () => {
      await hydrateSession();
      const tokens = consumePendingTokens();
      if (!tokens) return; // hydrateSession already moved us to 'signedOut'

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
    // best-effort — the device forgets its tokens regardless of whether the
    // server-side revoke actually succeeds. a flaky connection shouldn't
    // trap someone in a signed-in state they can't get out of.
    if (refreshToken) await authApi.logout(refreshToken).catch(() => undefined);
    await setSignedOut();
  }, []);

  return { session, requestOtp, verifyOtp, logout };
}

export type { SessionState };

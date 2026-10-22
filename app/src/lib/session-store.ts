import type { AuthUser } from './api-types';
import { clearTokens, loadTokens, saveTokens, type StoredTokens } from './token-storage';

/**
 * The single source of truth for "who is signed in", held outside React.
 *
 * The API client (`api-client.ts`) needs to read the current access token on
 * every request and silently rotate it on a 401 — including from contexts
 * that are not React components (e.g. a retry inside a fetch wrapper). Making
 * that depend on a React context would mean threading a token through props
 * or reaching for context outside a component, neither of which is clean.
 *
 * A plain subscribable store is the standard way to share state between
 * "plumbing" code and the component tree: the API client reads/writes it
 * directly, and `useAuth` (api-client.tsx's sibling hook) subscribes so React
 * re-renders when it changes. This is exactly the shape `useSyncExternalStore`
 * is for.
 */

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; tokens: StoredTokens; user: AuthUser };

type Listener = () => void;

let state: SessionState = { status: 'loading' };
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getSessionState(): SessionState {
  return state;
}

export function subscribeToSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Runs once at app start: restore whatever was in the keychain, if anything. */
export async function hydrateSession(): Promise<void> {
  const tokens = await loadTokens();
  // No cached user yet — the caller (AuthProvider) follows up with `GET /me`
  // and calls `setSignedIn` again once that resolves, or `setSignedOut` if
  // the tokens turn out to be stale.
  state = tokens ? { status: 'loading' } : { status: 'signedOut' };
  emit();
  if (tokens) pendingTokens = tokens;
}

/** Tokens restored from the keychain, held here until a user profile arrives. */
let pendingTokens: StoredTokens | null = null;
export function consumePendingTokens(): StoredTokens | null {
  const tokens = pendingTokens;
  pendingTokens = null;
  return tokens;
}

export async function setSignedIn(tokens: StoredTokens, user: AuthUser): Promise<void> {
  await saveTokens(tokens);
  state = { status: 'signedIn', tokens, user };
  emit();
}

/** Called by the API client after a silent refresh — no user re-fetch needed. */
export async function updateTokens(tokens: StoredTokens): Promise<void> {
  await saveTokens(tokens);
  if (state.status === 'signedIn') {
    state = { ...state, tokens };
    emit();
  }
}

export async function setSignedOut(): Promise<void> {
  await clearTokens();
  state = { status: 'signedOut' };
  emit();
}

export function currentAccessToken(): string | null {
  return state.status === 'signedIn' ? state.tokens.accessToken : null;
}

export function currentRefreshToken(): string | null {
  if (state.status === 'signedIn') return state.tokens.refreshToken;
  return pendingTokens?.refreshToken ?? null;
}

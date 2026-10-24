import type { AuthUser } from './api-types';
import { clearTokens, loadTokens, saveTokens, type StoredTokens } from './token-storage';

// the single source of truth for "who's signed in," kept outside React on
// purpose. api-client.ts needs to read the current access token on every
// request and silently rotate it on a 401 — including from places that
// aren't React components at all (a retry inside a plain fetch wrapper).
// making that depend on a React context would mean threading a token
// through props or reaching for context from outside a component, and
// neither of those is clean.
//
// a plain subscribable store is the normal way to share state between
// "plumbing" code and the component tree — the API client reads/writes it
// directly, and useAuth subscribes so React re-renders when it changes.
// basically what useSyncExternalStore exists for.

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

// runs once at app start — pulls back whatever was sitting in the keychain, if anything
export async function hydrateSession(): Promise<void> {
  const tokens = await loadTokens();
  // no cached user yet — useAuth follows up with GET /me and calls
  // setSignedIn again once that resolves, or setSignedOut if the tokens
  // turned out to be stale
  state = tokens ? { status: 'loading' } : { status: 'signedOut' };
  emit();
  if (tokens) pendingTokens = tokens;
}

// tokens pulled from the keychain, held here until a user profile actually shows up
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

// called by the API client after a silent token refresh — no need to re-fetch the user
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

import { API_BASE_URL } from './config';
import { ApiError, type ApiErrorBody } from './api-types';
import {
  currentAccessToken,
  currentRefreshToken,
  setSignedOut,
  updateTokens,
} from './session-store';

// one in-flight refresh promise, shared by every caller. without this,
// three screens whose queries all 401 at the same moment would each fire
// their own /auth/refresh — and since a refresh token is single-use (the
// server rotates it), only the first would actually succeed. the other two
// would hit the reuse-detection path and get the WHOLE session revoked.
// collapsing concurrent refreshes into one isn't an optimization here,
// it's the only way concurrent requests work at all.
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = currentRefreshToken();
    if (!refreshToken) return null;

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        await setSignedOut();
        return null;
      }

      const body = (await response.json()) as { accessToken: string; refreshToken: string };
      await updateTokens({ accessToken: body.accessToken, refreshToken: body.refreshToken });
      return body.accessToken;
    } catch {
      // a network blip during the refresh itself shouldn't sign anyone out —
      // the original request just fails and the caller can retry
      return null;
    }
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  skipAuth?: boolean; // auth endpoints (login, refresh) must never trigger the refresh-and-retry dance
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${API_BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function parseErrorBody(response: Response): Promise<ApiErrorBody | null> {
  try {
    return (await response.json()) as ApiErrorBody;
  } catch {
    return null;
  }
}

// the one function every API call in the app funnels through. allowRetry
// guards against an infinite loop — a request retried after a token
// refresh that itself still 401s has to just fail, not refresh again forever.
async function request<T>(path: string, options: RequestOptions = {}, allowRetry = true): Promise<T> {
  const { method = 'GET', body, query, skipAuth, signal } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const token = skipAuth ? null : currentAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  if (response.status === 401 && !skipAuth && allowRetry) {
    const newToken = await refreshAccessToken();
    if (newToken) return request<T>(path, options, false);
  }

  if (response.status === 204) return undefined as T;

  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorBody(response));
  }

  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) =>
    request<T>(path, { method: 'GET', query, signal }),

  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),

  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),

  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),

  delete: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { method: 'DELETE', query }),
};

// the receipt upload can't go through request() — it must NOT set
// Content-Type itself, since fetch needs to generate the multipart
// boundary on its own. the 401-retry logic ends up duplicated instead of
// shared because a JSON body and a FormData body aren't safely re-sendable
// through the same code path once either one's been consumed.
export async function apiUpload<T>(
  path: string,
  form: FormData,
  allowRetry = true,
): Promise<T> {
  const token = currentAccessToken();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(buildUrl(path), { method: 'PUT', headers, body: form });

  if (response.status === 401 && allowRetry) {
    const newToken = await refreshAccessToken();
    if (newToken) return apiUpload<T>(path, form, false);
  }

  if (!response.ok) throw new ApiError(response.status, await parseErrorBody(response));
  return (await response.json()) as T;
}

// for expo-image's source.headers — the receipt endpoint needs auth too
export function authHeaders(): Record<string, string> {
  const token = currentAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function absoluteApiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

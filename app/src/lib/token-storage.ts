import * as SecureStore from 'expo-secure-store';

/**
 * Tokens live in the OS keychain/keystore via `expo-secure-store`, not
 * `AsyncStorage`. AsyncStorage on Android is unencrypted (and on iOS is a
 * plain plist-backed file) — fine for "which tab was open", wrong for a
 * refresh token that is a long-lived bearer credential for the account.
 */
const ACCESS_TOKEN_KEY = 'miniledger.accessToken';
const REFRESH_TOKEN_KEY = 'miniledger.refreshToken';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

export async function loadTokens(): Promise<StoredTokens | null> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  ]);
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ]);
}

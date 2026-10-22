import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Where the API lives.
 *
 * `localhost` means something different depending on where the JS is
 * actually running:
 *   - iOS Simulator shares the Mac's network namespace, so `localhost` reaches
 *     a server running on the Mac directly.
 *   - Android Emulator is a separate VM; its `localhost` is the emulator
 *     itself, so the host machine must be addressed as `10.0.2.2`.
 *   - A physical device is on the LAN, not the Mac, so neither works — it
 *     needs the Mac's LAN IP, which `expo start` prints and Expo exposes via
 *     `Constants.expoConfig.hostUri`.
 *
 * `EXPO_PUBLIC_API_URL` (an `.env` file read at build time) always wins when
 * set, so pointing the app at a deployed API is a one-line change.
 */
function resolveApiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');

  const hostUri = Constants.expoConfig?.hostUri;
  const lanHost = hostUri?.split(':')[0];

  if (lanHost && lanHost !== 'localhost' && lanHost !== '127.0.0.1') {
    return `http://${lanHost}:4000`;
  }

  if (Platform.OS === 'android') return 'http://10.0.2.2:4000';
  return 'http://localhost:4000';
}

export const API_BASE_URL = resolveApiBaseUrl();

/** Keep the UI's idea of "overdue" and "due soon" in lockstep with the API's. */
export const DUE_SOON_WINDOW_DAYS = 7;

export const DEFAULT_CURRENCY = 'INR';
export const DEFAULT_COUNTRY_CODE = '+91';

import Constants from 'expo-constants';
import { Platform } from 'react-native';

// figures out where the API actually lives. "localhost" means a different
// thing depending on where this JS is running:
//   - iOS Simulator shares the Mac's network namespace, so localhost just
//     reaches a server running on the Mac directly
//   - Android Emulator is its own VM, so its localhost is itself — the host
//     machine has to be addressed as 10.0.2.2 instead
//   - a physical device is on the LAN, not the Mac, so neither of those
//     work — needs the Mac's actual LAN IP, which Expo happens to expose
//     via Constants.expoConfig.hostUri since expo start already prints it
//
// EXPO_PUBLIC_API_URL always wins if it's set, so pointing this at a real
// deployed API later is a one-line .env change, not a code change.
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

export const DUE_SOON_WINDOW_DAYS = 7; // keep this in sync with the API's own due-soon window

export const DEFAULT_CURRENCY = 'INR';
export const DEFAULT_COUNTRY_CODE = '+91';

import { useColorScheme } from 'react-native';

/**
 * One palette, defined for light and dark, rather than per-component
 * light/dark branches. Every screen pulls colors from `useTheme()` so the
 * app follows the OS appearance setting automatically.
 */
const light = {
  background: '#F7F8FA',
  surface: '#FFFFFF',
  surfaceAlt: '#F0F2F5',
  border: '#E3E6EA',
  text: '#15181D',
  textMuted: '#6B7280',
  textFaint: '#9AA1AB',
  primary: '#0E7C66',
  primaryText: '#FFFFFF',
  primarySoft: '#E3F3EE',
  danger: '#C0372B',
  dangerSoft: '#FBE9E7',
  warning: '#B5750A',
  warningSoft: '#FDF1DC',
  success: '#0E7C66',
  successSoft: '#E3F3EE',
  overlay: 'rgba(15, 18, 21, 0.5)',
  tabBarInactive: '#9AA1AB',
};

const dark = {
  background: '#0F1216',
  surface: '#191D23',
  surfaceAlt: '#20252C',
  border: '#2B313A',
  text: '#F2F4F7',
  textMuted: '#9AA3AE',
  textFaint: '#6C7480',
  primary: '#36C8A4',
  primaryText: '#06231C',
  primarySoft: '#17352D',
  danger: '#F2887C',
  dangerSoft: '#3A1E1C',
  warning: '#F0B541',
  warningSoft: '#3A2D14',
  success: '#36C8A4',
  successSoft: '#17352D',
  overlay: 'rgba(0, 0, 0, 0.6)',
  tabBarInactive: '#6C7480',
};

export type Palette = typeof light;

export function useTheme(): { colors: Palette; dark: boolean } {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  return { colors: isDark ? dark : light, dark: isDark };
}

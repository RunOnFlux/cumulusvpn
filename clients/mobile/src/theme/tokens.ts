/**
 * CumulusVPN design tokens — a direct mirror of `design/mockups.html`.
 *
 * The mobile app renders on the phone "sky" gradient from the mockup, so the
 * primary palette here is the dark-on-sky variant. Colours are plain strings
 * (React Native has no CSS variables); values match the mockup byte-for-byte.
 */

export const color = {
  // Brand — cyan is "connect", amber is "premium" (per docs/05 + mockup).
  cyan: '#34E4DA', // --cyan-glow, the connected orb / primary action
  cyanDeep: '#0FB9AE', // --cyan (light-mode brand)
  amber: '#F5B23D', // --amber-2, premium pill + upgrade accents
  amberDeep: '#C77F17', // --amber (light-mode)
  green: '#34D399', // healthy latency dot
  greenDeep: '#1F9D6B',
  red: '#EF6A5A', // slow latency dot

  // Phone "sky" gradient stops (connected screens).
  sky1: '#10203A',
  sky2: '#1D3A63',
  sky3: '#2F6F9E',

  // Discovery / disconnected screen gradient stops.
  disc1: '#0D1622',
  disc2: '#16202E',
  disc3: '#202C3C',

  // Ink on the sky background.
  ink: '#EAF3FA',
  inkDim: 'rgba(203,224,238,0.70)', // conn-loc .ip
  inkFaint: 'rgba(203,224,238,0.65)', // stat .k
  inkMuted: '#C3D3E2',

  // Surfaces / hairlines on the sky.
  glass: 'rgba(255,255,255,0.07)', // .stat, cards
  glassStrong: 'rgba(255,255,255,0.12)', // free tier pill
  hairline: 'rgba(255,255,255,0.08)',
  hairlineStrong: 'rgba(255,255,255,0.14)', // orb ring (off)

  // Premium pill.
  premiumBg: '#F5B23D',
  premiumInk: '#3A2606',
  // Connected orb inner tint.
  orbCoreOn: 'rgba(9,20,26,0.5)',
  orbCoreOff: 'rgba(255,255,255,0.05)',
} as const;

/**
 * Gradient stop arrays for a future `react-native-linear-gradient` pass.
 * POC: RN has no native gradient primitive; screens currently fall back to a
 * single solid colour (`skyGradient[0]` / `discGradient[0]`).
 */
export const skyGradient = [color.sky1, color.sky2, color.sky3] as const;
export const discGradient = [color.disc1, color.disc2, color.disc3] as const;

export const radius = {
  sm: 12,
  md: 18, // --radius
  pill: 20,
  orb: 84, // 168 / 2
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 18,
  xxl: 24,
} as const;

export const font = {
  // Matches --mono / --sans from the mockup. RN maps these to platform faces.
  mono: 'Menlo',
  sans: 'System',
} as const;

export type ThemeColor = (typeof color)[keyof typeof color];

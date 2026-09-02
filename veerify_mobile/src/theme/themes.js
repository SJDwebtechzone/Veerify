// src/theme/themes.js
//
// Light + dark palettes for the entire Veerify mobile app. Both
// export the SAME shape as the legacy `src/theme.js#palette` so any
// screen migrated to `useTheme()` reads the exact same keys — only
// the values swap when the mode flips.
//
// Brand accents (purple/red, blue, green, orange, teal, rose, pink)
// stay identical across both modes so the CTA / status colours the
// admin recognises don't change with the theme. Only surfaces
// (backgrounds, cards, borders, text) shift for contrast + comfort.

const BRAND_ACCENTS = {
  purple:    { soft: '#FEE2E2', vivid: '#EF4444', on: '#991B1B' },
  blue:      { soft: '#DBEAFE', vivid: '#3B82F6', on: '#1D4ED8' },
  green:     { soft: '#D1FAE5', vivid: '#10B981', on: '#065F46' },
  orange:    { soft: '#FEF3C7', vivid: '#F59E0B', on: '#92400E' },
  pink:      { soft: '#FCE7F3', vivid: '#EC4899', on: '#9D174D' },
  teal:      { soft: '#CFFAFE', vivid: '#06B6D4', on: '#155E75' },
  rose:      { soft: '#FFE4E6', vivid: '#F43F5E', on: '#9F1239' },
  red:       { soft: '#FEE2E2', vivid: '#EF4444', on: '#991B1B' },
  success:   '#10B981',
  danger:    '#EF4444',
  warning:   '#F59E0B',
};

// Dark-mode brand accents keep the vivid stroke identical (that's
// the CTA colour every admin has learned) but shift `soft` (used as
// pill / chip backgrounds) to lower-lightness variants so they read
// well against the near-black card background instead of glowing.
const BRAND_ACCENTS_DARK = {
  purple:    { soft: 'rgba(239, 68, 68, 0.18)',  vivid: '#EF4444', on: '#FCA5A5' },
  blue:      { soft: 'rgba(59, 130, 246, 0.18)', vivid: '#60A5FA', on: '#93C5FD' },
  green:     { soft: 'rgba(16, 185, 129, 0.18)', vivid: '#34D399', on: '#6EE7B7' },
  orange:    { soft: 'rgba(245, 158, 11, 0.18)', vivid: '#FBBF24', on: '#FCD34D' },
  pink:      { soft: 'rgba(236, 72, 153, 0.18)', vivid: '#F472B6', on: '#F9A8D4' },
  teal:      { soft: 'rgba(6, 182, 212, 0.18)',  vivid: '#22D3EE', on: '#67E8F9' },
  rose:      { soft: 'rgba(244, 63, 94, 0.18)',  vivid: '#FB7185', on: '#FDA4AF' },
  red:       { soft: 'rgba(239, 68, 68, 0.18)',  vivid: '#EF4444', on: '#FCA5A5' },
  success:   '#34D399',
  danger:    '#F87171',
  warning:   '#FBBF24',
};

export const lightPalette = {
  bg:        '#FAFAFC',   // app background — barely-not-white
  surface:   '#FFFFFF',   // card background
  border:    '#EEF0F4',
  borderSoft:'#F2F4F8',
  text:      '#0F172A',
  textMuted: '#64748B',
  textLight: '#94A3B8',
  overlay:   'rgba(15, 23, 42, 0.5)',
  ...BRAND_ACCENTS,
};

export const darkPalette = {
  // Near-black canvas + slightly-lighter cards so a card visually
  // lifts off the background. Both stay warm-neutral (touch of blue)
  // to feel modern rather than flat greyscale.
  bg:        '#0B0F17',
  surface:   '#151A24',
  border:    '#232937',
  borderSoft:'#1B2130',
  text:      '#F8FAFC',
  textMuted: '#94A3B8',
  textLight: '#64748B',
  overlay:   'rgba(0, 0, 0, 0.7)',
  ...BRAND_ACCENTS_DARK,
};

export const lightTheme = {
  mode:    'light',
  palette: lightPalette,
};

export const darkTheme = {
  mode:    'dark',
  palette: darkPalette,
};

// Convenience alias — the theme module is symmetric, but callers
// occasionally want to pick a theme by name from AsyncStorage.
export function themeByMode(mode) {
  return mode === 'dark' ? darkTheme : lightTheme;
}

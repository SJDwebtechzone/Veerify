// src/theme.js
//
// Design tokens for the institution-admin mobile experience.
// Pastel palette, generous spacing, soft shadows. All six admin screens
// (Dashboard, Students, Student Detail, Batches, Payments, More) import
// from here so the look stays consistent.

import { Platform, StyleSheet } from 'react-native';

// ─────────────────────────────────────────────────────────────────────────────
// Colors
// Each accent has a "soft" tint for backgrounds and a "vivid" stroke for
// icons/text. Background app surface stays near-white for the premium feel.
// ─────────────────────────────────────────────────────────────────────────────
export const palette = {
  // App surfaces
  bg:        '#FAFAFC',     // app background — barely-not-white
  surface:   '#FFFFFF',     // card background
  border:    '#EEF0F4',     // hairline borders / dividers
  borderSoft:'#F2F4F8',

  // Text
  text:      '#0F172A',     // primary text
  textMuted: '#64748B',     // secondary
  textLight: '#94A3B8',     // tertiary / placeholders

  // Pastel accents — pair {soft, vivid, on}
  //
  // ⚠ The variable is still named `purple` for backwards compatibility (every
  // existing screen imports it by that name), but the values are now the
  // red/coral primary from the course-detail mockup. `palette.red` below is
  // an explicit alias new code can use to make the intent clearer.
  purple:    { soft: '#FEE2E2', vivid: '#EF4444', on: '#991B1B' },  // ← red primary
  blue:      { soft: '#DBEAFE', vivid: '#3B82F6', on: '#1D4ED8' },
  green:     { soft: '#D1FAE5', vivid: '#10B981', on: '#065F46' },
  orange:    { soft: '#FEF3C7', vivid: '#F59E0B', on: '#92400E' },
  pink:      { soft: '#FCE7F3', vivid: '#EC4899', on: '#9D174D' },
  teal:      { soft: '#CFFAFE', vivid: '#06B6D4', on: '#155E75' },
  rose:      { soft: '#FFE4E6', vivid: '#F43F5E', on: '#9F1239' },

  // Explicit primary alias — same values as palette.purple above. New code
  // should reach for palette.red so future maintainers don't get confused.
  red:       { soft: '#FEE2E2', vivid: '#EF4444', on: '#991B1B' },

  // Status / semantic
  success:   '#10B981',
  danger:    '#EF4444',
  warning:   '#F59E0B',
};

// Aliases used throughout the app for quick reference.
export const colors = {
  primary:   palette.red.vivid,        // primary CTA / brand red
  primarySoft: palette.red.soft,
  primaryOn: palette.red.on,
  white:     palette.surface,
  dark:      palette.text,
  text:      palette.text,
  textLight: palette.textMuted,
  lightGray: palette.border,
  ...palette,
};

// ─────────────────────────────────────────────────────────────────────────────
// Spacing scale (4-pt baseline).
// ─────────────────────────────────────────────────────────────────────────────
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

// ─────────────────────────────────────────────────────────────────────────────
// Radius
// ─────────────────────────────────────────────────────────────────────────────
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
};

// ─────────────────────────────────────────────────────────────────────────────
// Typography
// ─────────────────────────────────────────────────────────────────────────────
export const type = {
  // Sizes
  display:  { fontSize: 28, lineHeight: 34, fontWeight: '800' },
  h1:       { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  h2:       { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  h3:       { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  body:     { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  bodyBold: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  caption:  { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  micro:    { fontSize: 10, lineHeight: 14, fontWeight: '600', letterSpacing: 0.5 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Shadows — iOS uses real shadow props, Android falls back to elevation.
// ─────────────────────────────────────────────────────────────────────────────
function shadow(level) {
  if (Platform.OS === 'android') return { elevation: level };
  const map = {
    1: { shadowColor: '#0F172A', shadowOpacity: 0.04, shadowRadius: 6,  shadowOffset: { width: 0, height: 2 } },
    2: { shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
    3: { shadowColor: '#0F172A', shadowOpacity: 0.10, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
    4: { shadowColor: '#0F172A', shadowOpacity: 0.14, shadowRadius: 22, shadowOffset: { width: 0, height: 12 } },
  };
  return map[level] || map[2];
}

export const shadows = {
  card:  shadow(1),
  raised: shadow(2),
  fab:   shadow(3),
  modal: shadow(4),
};

// ─────────────────────────────────────────────────────────────────────────────
// Common reusable style fragments.
// ─────────────────────────────────────────────────────────────────────────────
export const common = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow(1),
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hairline: {
    height: 1,
    backgroundColor: palette.border,
  },
});

export default {
  palette, colors, spacing, radius, type, shadows, common,
};

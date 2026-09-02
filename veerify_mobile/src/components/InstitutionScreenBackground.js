// src/components/InstitutionScreenBackground.js
//
// Shared ambient background for every Institution-admin screen —
// dashboard, students, batches, courses, earnings, more, and every
// list / detail / form screen underneath them. Renders the SAME
// light-blue glassmorphism atmosphere that the Institution Home
// (AdminDashboardScreen) has, so the whole admin login feels like
// one unified premium design system.
//
// Contract:
//   Two rendering modes based on how each screen wants to consume it.
//
//   1. As a WRAPPER (recommended). Wraps existing content and paints
//      the ambient layer behind it. Zero layout side-effects — the
//      wrapper is a `flex: 1` view and the ambient layer is
//      absolutely-positioned + `pointerEvents="none"`.
//
//        <InstitutionScreenBackground>
//          {/* existing screen JSX */}
//        </InstitutionScreenBackground>
//
//   2. As a bare LAYER — no children — for screens that already have
//      an outer root View and just want the ambient paint injected
//      as the first child (behind everything).
//
//        <View style={{ flex: 1 }}>
//          <InstitutionScreenBackground layer />
//          {/* existing screen JSX */}
//        </View>
//
// Design:
//   • Light-blue vertical wash (matches the dashboard).
//   • Two very low-opacity radial "glow" blobs (top-right cool blue,
//     bottom-left soft periwinkle) + a mid tint — pure atmosphere,
//     never reads as graphics.
//   • Extremely subtle so it never fights screen content and never
//     hurts text contrast (verified against WCAG on the dashboard).
//
// Non-goals:
//   • Not a container for headers — screens keep their own headers.
//   • Not a card/glass surface — that's per-component (StatCard,
//     identityCard, quickActions, etc.).
//   • Never intercepts taps — the SVG layer is pointerEvents="none".
//
// Performance:
//   Single Svg element per screen with 4 rects. Cheap on any Android
//   GPU. No native modules. No blur, no filters, no animation. Safe
//   with ScrollView, FlatList, SectionList.

import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  RadialGradient as SvgRadialGradient,
  Stop,
  Rect,
} from 'react-native-svg';

// Fallback base color painted UNDER the SVG so there is never a
// flash of white before the SVG mounts on first frame. Exported so
// navigator-level `cardStyle.backgroundColor` can reuse the exact
// same value.
export const INSTITUTION_BG_BASE = '#F1F6FB';

function AmbientLayer() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg
        style={StyleSheet.absoluteFill}
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        <Defs>
          <SvgLinearGradient id="instBgWash" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0"    stopColor="#EAF2FB" />
            <Stop offset="0.55" stopColor="#E1ECF8" />
            <Stop offset="1"    stopColor="#D8E5F4" />
          </SvgLinearGradient>
          {/* Cool blue in the top-right → echoes the navy header that
              lives on the Home screen. */}
          <SvgRadialGradient id="instBlobTR" cx="0.9" cy="0.1" rx="0.6" ry="0.45">
            <Stop offset="0"   stopColor="#93C5FD" stopOpacity="0.22" />
            <Stop offset="1"   stopColor="#93C5FD" stopOpacity="0" />
          </SvgRadialGradient>
          {/* Soft periwinkle bottom-left balances the composition. */}
          <SvgRadialGradient id="instBlobBL" cx="0.1" cy="0.9" rx="0.6" ry="0.45">
            <Stop offset="0"   stopColor="#A5B4FC" stopOpacity="0.22" />
            <Stop offset="1"   stopColor="#A5B4FC" stopOpacity="0" />
          </SvgRadialGradient>
          {/* Very faint mid-screen glow — evens out the wash so
              content-heavy screens don't feel two-tone. */}
          <SvgRadialGradient id="instBlobMid" cx="0.5" cy="0.5" rx="0.5" ry="0.35">
            <Stop offset="0"   stopColor="#BAE6FD" stopOpacity="0.12" />
            <Stop offset="1"   stopColor="#BAE6FD" stopOpacity="0" />
          </SvgRadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill="url(#instBgWash)" />
        <Rect x="0" y="0" width="100" height="100" fill="url(#instBlobTR)" />
        <Rect x="0" y="0" width="100" height="100" fill="url(#instBlobBL)" />
        <Rect x="0" y="0" width="100" height="100" fill="url(#instBlobMid)" />
      </Svg>
    </View>
  );
}

export default function InstitutionScreenBackground({ children, layer, style }) {
  // Bare LAYER mode — inject just the SVG paint (screen supplies
  // its own root View). Use inside an existing container as the
  // first child.
  if (layer) return <AmbientLayer />;

  // WRAPPER mode — flex:1 container that hosts the ambient layer
  // and passes children through. Zero layout impact.
  return (
    <View style={[styles.wrap, style]}>
      <AmbientLayer />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: INSTITUTION_BG_BASE,
  },
});

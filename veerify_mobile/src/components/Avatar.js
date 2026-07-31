// src/components/Avatar.js
//
// Shared circular avatar used for institution, trainer, student,
// branch, parent, staff and admin profile pictures across the app.
//
// Behavior (per product spec — "Improve image rendering"):
//   • Circular container with strict clipping (borderRadius + overflow
//     hidden) so the photo never spills out on any device.
//   • `resizeMode='cover'` fills the circle without distortion; the
//     source photo's aspect ratio is preserved. For portrait selfies
//     (the overwhelmingly common case) the face stays visible because
//     the image is centered inside the container. For rare landscape /
//     group shots, cover is still preferable to `contain` — an empty
//     ring around a photo inside a circular badge reads as broken UI.
//   • When no uri is provided (or the image errors), we render a
//     placeholder — either the person's initial on a coloured disc,
//     or a `User` glyph — so the avatar slot never renders as an
//     empty circle.
//   • `size` fully drives dimensions + fontSize + glyph size so a
//     caller only has to pass one number.
//
// Usage:
//   <Avatar uri={u.photo_url} name={u.name} size={64} />
//   <Avatar uri={photo} name="Priya" size={40} tone="purple" />
//   <Avatar size={96} icon /* forces the glyph placeholder */ />

import React, { useState } from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import { User } from 'lucide-react-native';

import resolveAssetUrl from '../utils/assetUrl';

// Palette used by the initial-on-disc placeholder. Chosen for legible
// contrast against white text.
const TONES = {
  brand:  { bg: '#E63946', fg: '#FFFFFF' },
  purple: { bg: '#6D28D9', fg: '#FFFFFF' },
  blue:   { bg: '#2563EB', fg: '#FFFFFF' },
  green:  { bg: '#059669', fg: '#FFFFFF' },
  amber:  { bg: '#D97706', fg: '#FFFFFF' },
  slate:  { bg: '#475569', fg: '#FFFFFF' },
  pink:   { bg: '#DB2777', fg: '#FFFFFF' },
};

function pickTone(name, explicit) {
  if (explicit && TONES[explicit]) return TONES[explicit];
  if (!name) return TONES.slate;
  // Deterministic pick from the name so re-renders keep the same
  // colour for the same person.
  const key = String(name).charCodeAt(0) % Object.keys(TONES).length;
  return TONES[Object.keys(TONES)[key]];
}

/**
 * @param {object} props
 * @param {string|null} props.uri            Remote / relative image URL
 * @param {string}      props.name           Person / entity name (for initial)
 * @param {number}      props.size           Diameter in dp (default 48)
 * @param {string}      [props.tone]         Colour key when no image
 * @param {boolean}     [props.icon]         Force the glyph placeholder
 * @param {object}      [props.style]        Extra style on the container
 * @param {object}      [props.imageStyle]   Extra style on the image
 * @param {'cover'|'contain'} [props.fit='cover'] Resize mode. Use
 *   'contain' for institution/brand logos where the whole mark must
 *   stay visible; default 'cover' for portrait photos.
 */
export default function Avatar({
  uri,
  name,
  size = 48,
  tone,
  icon = false,
  style,
  imageStyle,
  fit = 'cover',
}) {
  const [failed, setFailed] = useState(false);

  const resolved = uri ? resolveAssetUrl(uri) : null;
  const showImage = !!resolved && !failed && !icon;

  const dim = {
    width:  size,
    height: size,
    borderRadius: size / 2,
  };

  if (showImage) {
    return (
      <View style={[styles.wrap, dim, style]}>
        <Image
          source={{ uri: resolved }}
          style={[dim, imageStyle]}
          resizeMode={fit}
          onError={() => setFailed(true)}
        />
      </View>
    );
  }

  // Placeholder — initial on coloured disc, or a User glyph.
  const t = pickTone(name, tone);
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const showGlyph = icon || !name || initial === '?';

  return (
    <View style={[styles.wrap, styles.placeholder, dim, { backgroundColor: t.bg }, style]}>
      {showGlyph ? (
        <User size={Math.round(size * 0.5)} color={t.fg} strokeWidth={2} />
      ) : (
        <Text style={[styles.initial, { color: t.fg, fontSize: Math.round(size * 0.42) }]}>
          {initial}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontWeight: '700',
    letterSpacing: -0.5,
    textAlign: 'center',
    includeFontPadding: false,
  },
});

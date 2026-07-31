// src/components/CourseImage.js
//
// Shared cover image used for course cards, course detail heroes,
// event covers, plan badges — anywhere we render a piece of
// user-uploaded cover art inside a container.
//
// Behavior (per product spec — "Improve image rendering"):
//   • `resizeMode='contain'` guarantees the FULL image is visible
//     inside the container. Nothing gets cropped, even for tall
//     portrait posters or wide landscape banners.
//   • The container has a soft neutral background so any letterbox
//     around the image reads as intentional padding, not a broken
//     load. Combined with `overflow: 'hidden'` + rounded corners
//     the result matches card chrome consistently.
//   • Callers pass either `size` (both dimensions) or an
//     `aspectRatio`. When neither is set we default to a 16:9
//     rectangle that matches most of our card layouts.
//   • On error / no source we render a placeholder glyph in the
//     same slot so cards don't collapse.
//
// Usage:
//   <CourseImage uri={course.image_url} />                     // 16:9 card
//   <CourseImage uri={course.image_url} size={72} rounded />   // square thumb
//   <CourseImage uri={hero} aspectRatio={4/3} />

import React, { useState } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { GraduationCap, ImageIcon } from 'lucide-react-native';

import resolveAssetUrl from '../utils/assetUrl';

/**
 * @param {object} props
 * @param {string|null} props.uri              Remote / relative image URL
 * @param {number}      [props.size]           Force width AND height (square)
 * @param {number}      [props.width]          Explicit width
 * @param {number}      [props.height]         Explicit height
 * @param {number}      [props.aspectRatio=16/9] Aspect ratio when height not set
 * @param {number}      [props.radius=12]      Corner radius on the container
 * @param {boolean}     [props.rounded=false]  Force fully-rounded (pill/square)
 * @param {'contain'|'cover'} [props.fit='contain'] Resize mode
 * @param {'course'|'image'} [props.icon='course'] Placeholder glyph
 * @param {object}      [props.style]          Extra style on container
 */
export default function CourseImage({
  uri,
  size,
  width,
  height,
  aspectRatio = 16 / 9,
  radius = 12,
  rounded = false,
  fit = 'contain',
  icon = 'course',
  style,
}) {
  const [failed, setFailed] = useState(false);
  const resolved = uri ? resolveAssetUrl(uri) : null;
  const hasImage = !!resolved && !failed;

  const boxStyle = {
    width:  size ?? width ?? '100%',
    height: size ?? height,
    aspectRatio: (size || height) ? undefined : aspectRatio,
    borderRadius: rounded && size ? size / 2 : radius,
  };

  const Placeholder = icon === 'image' ? ImageIcon : GraduationCap;

  return (
    <View style={[styles.wrap, boxStyle, style]}>
      {hasImage ? (
        <Image
          source={{ uri: resolved }}
          style={StyleSheet.absoluteFill}
          resizeMode={fit}
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={styles.placeholder}>
          <Placeholder size={28} color="#9CA3AF" strokeWidth={1.6} />
        </View>
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
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

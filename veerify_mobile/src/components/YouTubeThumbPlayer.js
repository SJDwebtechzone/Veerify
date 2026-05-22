// src/components/YouTubeThumbPlayer.js
//
// Inline YouTube intro-video player capped at 90 seconds.
//
// Behaviour:
//   1. Until tapped, shows the official YouTube thumbnail (max-res then high-
//      quality fallback) with a play bubble overlay — exactly like the
//      teaser card on Course Details.
//   2. On tap, swaps the thumbnail for a WebView pointing at YouTube's
//      embed URL with `end=90` so the video auto-pauses at the 90-second
//      mark. `autoplay=1` makes it start immediately.
//   3. We extract the video id from every common YouTube URL form (watch,
//      youtu.be, shorts, embed) so the admin can paste whichever they
//      copied.
//
// Requires the `react-native-webview` peer module. If the package is missing
// (e.g. fresh clone with `npm install` not yet run), we fall back to a
// "Tap to open in YouTube" card so the screen still works.

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet, Linking, Alert,
} from 'react-native';
import { PlayCircle, ExternalLink } from 'lucide-react-native';

import { palette, radius, spacing, type, shadows } from '../theme';

// Try to load WebView at module-eval time. If the user hasn't installed it
// yet we don't want to crash the screen — we degrade to external launch.
let WebView = null;
try {
  // eslint-disable-next-line global-require
  WebView = require('react-native-webview').WebView;
} catch (e) {
  WebView = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pull the 11-char YouTube video id from any URL shape we've seen in the wild.
// Returns null when the URL isn't a YouTube link.
// ─────────────────────────────────────────────────────────────────────────────
export function youtubeIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  const m = trimmed.match(
    /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  return m ? m[1] : null;
}

// Best-quality YouTube thumbnail. `maxresdefault` doesn't exist for every
// video (older / unprocessed ones) so the <Image> falls back to `hqdefault`
// via the onError handler.
function thumbUrls(id) {
  return {
    primary:  `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    fallback: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}

// HTML page for the WebView. We load the YouTube IFrame Player API instead of
// a bare <iframe> so we can subscribe to its `onError` event and detect 100,
// 101, 150 (and the rare 153) embed-blocked codes — when those fire we
// postMessage back to React Native and the host component falls back to
// opening the video externally in the real YouTube app.
//
// `end=90` is YouTube's official IFrame Player parameter that auto-stops
// playback at 90 seconds. No JS polling needed.
function buildEmbedHtml(videoId) {
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <style>
          html, body { margin: 0; padding: 0; background: #000; height: 100%; }
          #player { width: 100%; height: 100%; }
        </style>
      </head>
      <body>
        <div id="player"></div>
        <script src="https://www.youtube.com/iframe_api"></script>
        <script>
          function send(msg) {
            try { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch (e) {}
          }
          function onYouTubeIframeAPIReady() {
            new YT.Player('player', {
              videoId: '${videoId}',
              // Plain youtube.com host — youtube-nocookie was rejecting some
              // embeds with the undocumented 152 error.
              host: 'https://www.youtube.com',
              playerVars: {
                autoplay: 1,
                playsinline: 1,
                end: 90,
                rel: 0,
                modestbranding: 1,
                controls: 1,
                origin: 'https://www.youtube.com',
              },
              events: {
                onReady:  () => send({ type: 'ready' }),
                onError:  (e) => send({ type: 'error', code: e.data }),
                onStateChange: (e) => {
                  // YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused,
                  // 3 buffering, 5 cued. We notify on every change so the host
                  // component's "did we ever reach playing?" guard can clear.
                  send({ type: 'state', state: e.data });
                },
              },
            });
          }
          // If YouTube's own error UI renders inside the iframe (e.g. region
          // blocks that don't fire onError to the JS API), scan the DOM every
          // second for the standard error marker and post it back.
          setInterval(function () {
            try {
              var p = document.querySelector('.ytp-error');
              if (p) send({ type: 'iframe-error' });
            } catch (_) {}
          }, 1000);
        </script>
      </body>
    </html>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export default function YouTubeThumbPlayer({ url, fallbackImage }) {
  const [playing, setPlaying] = useState(false);
  const [thumbError, setThumbError] = useState(false);

  const videoId = useMemo(() => youtubeIdFromUrl(url), [url]);
  const isYouTube = !!videoId;
  const thumbs = videoId ? thumbUrls(videoId) : null;

  // Non-YouTube URL (or no URL) — degrade to external launch.
  const openExternal = async () => {
    try {
      const raw = (url || '').trim();
      if (!raw) {
        Alert.alert('Coming soon', 'The intro video for this program is not yet available.');
        return;
      }
      const final = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw;
      const ok = await Linking.canOpenURL(final);
      if (!ok) {
        Alert.alert('Cannot open video', `No app on this device can open this link.\n\n${final}`);
        return;
      }
      await Linking.openURL(final);
    } catch (err) {
      Alert.alert('Could not open video', err?.message || 'Try again.');
    }
  };

  // YouTube IFrame Player error codes that mean "we can't embed this video":
  //   2   invalid id (rare)
  //   5   HTML5 player can't play it
  //   100 video private / removed
  //   101 owner disabled embed
  //   150 same as 101 (different surface)
  //   152 undocumented playback error (Android WebView, regional, copyright)
  //   153 same family — has been seen on Shorts / region-locked content
  // We treat any of these as "give up and open YouTube app".
  const EMBED_BLOCKED = new Set([2, 5, 100, 101, 150, 152, 153]);

  // Watchdog: if the player never reports a "playing" state within 6s of
  // mount, YouTube has almost certainly silently failed (shows its own
  // "video unavailable" UI without firing onError to the JS API). We fall
  // back to opening externally.
  const watchdogRef = useRef(null);
  const reachedPlayingRef = useRef(false);

  useEffect(() => {
    if (!playing) {
      reachedPlayingRef.current = false;
      if (watchdogRef.current) {
        clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
      return;
    }
    watchdogRef.current = setTimeout(() => {
      if (!reachedPlayingRef.current) {
        setPlaying(false);
        Alert.alert(
          'Cannot play inline',
          'This video did not start playing. Opening in YouTube.',
          [{ text: 'OK', onPress: () => openExternal() }],
        );
      }
    }, 6000);
    return () => {
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const handleWebViewMessage = (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data || '{}');

      if (msg.type === 'state') {
        // 1 = playing; clear the watchdog the first time we see it.
        if (msg.state === 1) {
          reachedPlayingRef.current = true;
          if (watchdogRef.current) {
            clearTimeout(watchdogRef.current);
            watchdogRef.current = null;
          }
        }
        if (msg.state === 0) {
          setPlaying(false);  // ended → collapse to thumbnail
        }
        return;
      }

      if (msg.type === 'iframe-error' || (msg.type === 'error' && EMBED_BLOCKED.has(Number(msg.code)))) {
        setPlaying(false);
        Alert.alert(
          'Cannot play inline',
          'This video can\'t be played inside the app. Opening in YouTube.',
          [{ text: 'OK', onPress: () => openExternal() }],
        );
      } else if (msg.type === 'ended') {
        setPlaying(false);
      }
    } catch (e) {
      // Non-JSON message — ignore.
    }
  };

  // ── Inline play state ──
  if (playing && isYouTube && WebView) {
    return (
      <View style={styles.player}>
        <WebView
          source={{ html: buildEmbedHtml(videoId), baseUrl: 'https://www.youtube.com' }}
          style={StyleSheet.absoluteFill}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="always"
          onMessage={handleWebViewMessage}
          onError={(syntheticEvent) => {
            // Network or HTTP error loading the iframe itself.
            const { nativeEvent } = syntheticEvent;
            console.log('[YouTubeThumbPlayer] WebView error', nativeEvent);
            setPlaying(false);
            openExternal();
          }}
          // Block all navigation away from the embed iframe — keeps user inside the app.
          onShouldStartLoadWithRequest={(req) => {
            return req.url.startsWith('https://www.youtube-nocookie.com')
              || req.url.startsWith('https://www.youtube.com')
              || req.url.startsWith('about:blank');
          }}
        />
        <TouchableOpacity
          style={styles.closeBubble}
          onPress={() => setPlaying(false)}
          activeOpacity={0.8}
        >
          <Text style={styles.closeText}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Thumbnail / tap-to-play state ──
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={() => {
        if (isYouTube && WebView) setPlaying(true);
        else openExternal();
      }}
      style={styles.player}
    >
      {isYouTube ? (
        <Image
          source={{ uri: thumbError ? thumbs.fallback : thumbs.primary }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setThumbError(true)}
        />
      ) : fallbackImage ? (
        <Image source={{ uri: fallbackImage }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.purple.soft }]} />
      )}

      <View style={styles.overlay} />

      <View style={styles.playBubble}>
        <PlayCircle size={44} color="#fff" strokeWidth={2.2} />
      </View>

      <View style={styles.captionRow}>
        <Text style={styles.caption}>
          {isYouTube && WebView ? 'Watch a 90s preview' : (isYouTube ? 'Tap to watch (install required)' : 'Open intro video')}
        </Text>
        {!WebView && isYouTube ? (
          <ExternalLink size={14} color="#fff" strokeWidth={2.2} />
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  player: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#000',
    ...shadows.card,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  playBubble: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -22,
    marginTop: -22,
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captionRow: {
    position: 'absolute',
    left: spacing.md,
    bottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  caption: { ...type.bodyBold, color: '#fff' },
  closeBubble: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  closeText: { ...type.caption, color: '#fff', fontWeight: '700' },
});

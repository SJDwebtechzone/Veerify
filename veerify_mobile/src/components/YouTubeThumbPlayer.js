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
  View, Text, Image, TouchableOpacity, StyleSheet, Linking,
  Clipboard, Platform,
} from 'react-native';
import { PlayCircle, ExternalLink } from 'lucide-react-native';

import { palette, radius, spacing, type, shadows } from '../theme';
import { confirm } from './ConfirmDialog';

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
                // mute=1 lets autoplay succeed under Android WebView's
                // autoplay policy even when the user hasn't directly
                // gestured on the iframe yet. The viewer can tap the
                // speaker icon in the YouTube controls to un-mute, which
                // is exactly how every other muted-autoplay site works.
                mute: 1,
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
          // (The .ytp-error DOM scanner used to live here. It was firing on
          // transient "loading..." UI even for videos that ended up playing
          // fine, so we now rely on the JS-API onError + the host-side
          // watchdog instead. Don't reintroduce without verifying that
          // YouTube hasn't started reusing .ytp-error for non-fatal states.)
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
  //
  // We deliberately do NOT call Linking.canOpenURL() for http/https URLs.
  // On Android 11+ the system requires every app you want to introspect
  // to be declared in <queries> in AndroidManifest.xml, so canOpenURL()
  // returns false on a plain emulator even when Chrome IS installed.
  // openURL() itself works fine — it asks the OS to resolve the intent
  // and the user's default browser (or YouTube app) opens.
  //
  // If openURL itself rejects (genuinely no handler), we fall back to
  // copying the URL to the clipboard so the user can paste it into any
  // browser manually.
  const openExternal = async () => {
    const raw = (url || '').trim();
    if (!raw) {
      confirm({
        title:       'Coming soon',
        message:     'The intro video for this program is not yet available.',
        variant:     'info',
        confirmText: 'OK',
        hideCancel:  true,
      });
      return;
    }
    const final = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw;
    try {
      await Linking.openURL(final);
    } catch (err) {
      // Last-ditch — stash the link on the clipboard so the user has
      // something to paste somewhere that works.
      try { Clipboard.setString(final); } catch (_e) { /* ignore */ }
      confirm({
        title:       "Couldn't open the video",
        message:     Platform.OS === 'android'
          ? `We've copied the link to your clipboard so you can paste it into any browser:\n\n${final}`
          : `We've copied the link so you can paste it into any browser:\n\n${final}`,
        variant:     'warning',
        confirmText: 'OK',
        hideCancel:  true,
      });
    }
  };

  // YouTube IFrame Player error codes — only the ones we KNOW are fatal:
  //   2   invalid id (rare)
  //   100 video private / removed
  //   101 owner disabled embed
  //
  // Previously we also treated 5 / 150 / 152 / 153 as fatal, but those
  // fire even for videos where "Allow embedding" is on — typically when
  // the video has copyrighted music, is age-restricted, was marked
  // "Made for kids", or sits behind a regional block. Bailing the moment
  // we see them means perfectly playable videos get bounced to YouTube.
  // We let the watchdog (18s) catch genuine non-starters instead.
  const EMBED_BLOCKED = new Set([2, 100, 101]);

  // Watchdog — only triggers when the IFrame Player API never wires up
  // at all (network failure, blocked region, etc.). Bumped from 6s to
  // 18s because the emulator can take 10+ seconds to spin up the YouTube
  // IFrame API on a cold WebView, and we want to keep the user in-app.
  //
  // On timeout we DON'T auto-bounce to the YouTube app any more — we just
  // collapse to the thumbnail with a friendly retry prompt. The user can
  // tap again to retry, or fall through to "Open in YouTube" themselves.
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
        // Styled confirm — two clear paths (Retry / Open in YouTube)
        // plus a Cancel via the close X. A third-button "destructive"
        // link on the bottom lets the user fall through to the external
        // app without making it the primary action.
        confirm({
          title:           'Taking too long',
          message:         'The video is slow to load. Tap Retry to try again, or open it in YouTube.',
          variant:         'warning',
          confirmText:     'Retry',
          cancelText:      'Cancel',
          destructiveText: 'Open in YouTube',
          onConfirm:       () => setPlaying(true),
          onDestructive:   () => openExternal(),
        });
      }
    }, 18000);
    return () => {
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const handleWebViewMessage = (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data || '{}');

      // Diagnostic — Metro logs show exactly what YouTube reports so we
      // can tell "embed blocked" apart from "copyrighted music" etc.
      if (msg.type === 'error') {
        // eslint-disable-next-line no-console
        console.log('[YouTubeThumbPlayer] IFrame Player error code:', msg.code);
      }

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
        // YouTube refused to embed this video. The institution who
        // uploaded the link IS the channel owner, so this is almost
        // always because they haven't enabled "Allow embedding" on the
        // video itself (YouTube Studio → Video → Visibility → "Allow
        // embedding"). We surface that fix in the dialog so the admin
        // can tap "Open in YouTube" and toggle it on their own.
        confirm({
          title:       'Embedding is off for this video',
          message:     'YouTube blocked the preview from playing in-app. Open it in YouTube and turn on “Allow embedding” in YouTube Studio so guests can watch it here.',
          variant:     'warning',
          confirmText: 'Open in YouTube',
          cancelText:  'Cancel',
          onConfirm:   () => openExternal(),
        });
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

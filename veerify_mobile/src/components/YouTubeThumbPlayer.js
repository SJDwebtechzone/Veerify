// src/components/YouTubeThumbPlayer.js
//
// Inline intro-video player used on Course Details. Behaviour depends
// on the viewer's relationship to the course:
//
//   viewerMode = 'enrolled'  → uncapped, full playback
//   viewerMode = 'unenrolled' → 60s preview, then "Buy this course" dialog
//   viewerMode = 'guest'     → 60s preview, then "Login to continue" dialog
//
// Playback happens INSIDE the app in a WebView — we never open the OS
// browser or YouTube app for enrolled students, and even the paywalled
// preview stays in-app so the branded upsell dialog can catch it.
//
// URL support: any YouTube URL shape (watch, youtu.be, shorts, embed)
// runs through the IFrame Player API. Direct .mp4 / .webm / .mov URLs
// play via a WebView-hosted <video> element with the same 60s cap
// enforced client-side. If neither shape matches, we fall back to
// external launch.
//
// Seek defense: the 60s cap isn't just `end=60` in the query string
// (which YouTube can be scrubbed past). A tick loop calls
// player.getCurrentTime() every 500ms and, when the preview quota is
// active, snaps the player back to 60 + pauses + fires the dialog if
// the viewer scrubs beyond the limit.

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

// Free preview window for guest + unenrolled viewers. Enrolled students
// bypass the cap entirely.
const PREVIEW_SECONDS = 60;

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

// Detect direct video files so we can embed them in a plain <video>
// element inside the WebView.
function isDirectVideoUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /\.(mp4|m4v|mov|webm)(\?|#|$)/i.test(url.trim());
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

// HTML for the YouTube IFrame Player. Two behaviours:
//   • capped=false → no `end`, no tick-loop enforcement, full playback.
//   • capped=true  → `end=60` plus a 500ms tick loop that snaps back +
//     pauses + posts 'limit-reached' when currentTime exceeds 60. The
//     tick loop guards against seek-bar scrubs that YouTube's own
//     `end` param can't intercept.
function buildYouTubeHtml(videoId, capped) {
  const capJs = capped
    ? `
      var TICK_MS = 500;
      var LIMIT = ${PREVIEW_SECONDS};
      var limitFired = false;
      setInterval(function () {
        if (!window.__player) return;
        try {
          var t = window.__player.getCurrentTime();
          if (typeof t === 'number' && t > LIMIT + 0.15) {
            window.__player.seekTo(LIMIT, true);
            window.__player.pauseVideo();
            if (!limitFired) {
              limitFired = true;
              send({ type: 'limit-reached' });
            }
          }
        } catch (e) {}
      }, TICK_MS);
    `
    : '';
  const endParam = capped ? `, end: ${PREVIEW_SECONDS}` : '';

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
            window.__player = new YT.Player('player', {
              videoId: '${videoId}',
              host: 'https://www.youtube.com',
              playerVars: {
                autoplay: 1,
                mute: 1,
                playsinline: 1${endParam},
                rel: 0,
                modestbranding: 1,
                controls: 1,
                origin: 'https://www.youtube.com',
              },
              events: {
                onReady:  () => send({ type: 'ready' }),
                onError:  (e) => send({ type: 'error', code: e.data }),
                onStateChange: (e) => {
                  send({ type: 'state', state: e.data });
                  // state === 0 (ended) after the end= truncation is our
                  // second signal that the preview window is done. The
                  // seek-guard's 'limit-reached' catches manual scrubs;
                  // this catches the natural end of the preview.
                  if (e.data === 0) {
                    send({ type: 'limit-reached' });
                  }
                },
              },
            });
          }
          ${capJs}
        </script>
      </body>
    </html>
  `;
}

// HTML for direct video files (mp4/webm/mov). We render a native
// <video> and, when the preview quota is active, listen for
// timeupdate and pause the moment currentTime crosses 60. Seek
// attempts past 60 are snapped back to 60 via the seeking event.
function buildDirectVideoHtml(url, capped) {
  const guard = capped
    ? `
      var LIMIT = ${PREVIEW_SECONDS};
      var limitFired = false;
      var v = document.getElementById('v');
      v.addEventListener('timeupdate', function () {
        if (v.currentTime > LIMIT) {
          v.currentTime = LIMIT;
          v.pause();
          if (!limitFired) { limitFired = true; send({ type: 'limit-reached' }); }
        }
      });
      v.addEventListener('seeking', function () {
        if (v.currentTime > LIMIT) {
          v.currentTime = LIMIT;
          v.pause();
          if (!limitFired) { limitFired = true; send({ type: 'limit-reached' }); }
        }
      });
      v.addEventListener('ended', function () {
        if (!limitFired) { limitFired = true; send({ type: 'limit-reached' }); }
      });
    `
    : '';
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <style>
          html, body { margin: 0; padding: 0; background: #000; height: 100%; }
          video { width: 100%; height: 100%; background: #000; }
        </style>
      </head>
      <body>
        <video id="v" src="${url}" autoplay muted playsinline controls></video>
        <script>
          function send(msg) {
            try { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch (e) {}
          }
          send({ type: 'ready' });
          ${guard}
        </script>
      </body>
    </html>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export default function YouTubeThumbPlayer({
  url,
  fallbackImage,
  viewerMode = 'guest', // 'guest' | 'unenrolled' | 'enrolled'
  onLoginPress,
  onBuyPress,
}) {
  const [playing, setPlaying] = useState(false);
  const [thumbError, setThumbError] = useState(false);
  const dialogFiredRef = useRef(false);

  const videoId = useMemo(() => youtubeIdFromUrl(url), [url]);
  const isYouTube = !!videoId;
  const isDirect  = useMemo(() => isDirectVideoUrl(url), [url]);
  const thumbs = videoId ? thumbUrls(videoId) : null;

  // Only enrolled students get uncapped playback. Guests and
  // logged-in non-enrolled viewers share the 60s preview quota.
  const capped = viewerMode !== 'enrolled';

  // Reset the "limit dialog already shown for this session" flag
  // whenever the player is re-opened.
  useEffect(() => {
    if (!playing) dialogFiredRef.current = false;
  }, [playing]);

  // Non-embeddable (or missing WebView) fallback — open externally.
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

  const EMBED_BLOCKED = new Set([2, 100, 101]);

  // Watchdog — only triggers when the IFrame Player API never wires up
  // at all (network failure, blocked region, etc.). Only used for
  // YouTube; direct <video> reports 'ready' immediately.
  const watchdogRef = useRef(null);
  const reachedPlayingRef = useRef(false);

  useEffect(() => {
    if (!playing || !isYouTube) {
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
  }, [playing, isYouTube]);

  // Fire the correct dialog per viewer mode, exactly once per playback
  // session. `guest` and `unenrolled` are the only capped modes.
  const fireLimitDialog = () => {
    if (dialogFiredRef.current) return;
    dialogFiredRef.current = true;
    // Collapse the player so the paywall dialog isn't fighting the
    // WebView underneath for focus.
    setPlaying(false);
    if (viewerMode === 'guest') {
      confirm({
        title:       'Login to continue exploring this course.',
        message:     'You\'ve reached the free preview. Sign in to keep exploring — or close and browse other courses.',
        variant:     'destructive',
        confirmText: 'Login',
        cancelText:  'Close',
        onConfirm:   () => { try { onLoginPress && onLoginPress(); } catch (_) {} },
      });
    } else if (viewerMode === 'unenrolled') {
      confirm({
        title:       'Purchase this course to watch the full video.',
        message:     'The free preview ends here. Enroll to unlock the full intro video and every lesson.',
        variant:     'destructive',
        confirmText: 'Buy Now',
        cancelText:  'Close',
        onConfirm:   () => { try { onBuyPress && onBuyPress(); } catch (_) {} },
      });
    }
  };

  const handleWebViewMessage = (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data || '{}');

      if (msg.type === 'error') {
        // eslint-disable-next-line no-console
        console.log('[YouTubeThumbPlayer] IFrame Player error code:', msg.code);
      }

      if (msg.type === 'state') {
        if (msg.state === 1) {
          reachedPlayingRef.current = true;
          if (watchdogRef.current) {
            clearTimeout(watchdogRef.current);
            watchdogRef.current = null;
          }
        }
        // state===0 (ended) is handled by 'limit-reached' emit from
        // the same event on the HTML side, so we don't collapse here
        // for capped playback — the dialog fires and does that itself.
        if (msg.state === 0 && !capped) {
          setPlaying(false);
        }
        return;
      }

      if (msg.type === 'limit-reached') {
        fireLimitDialog();
        return;
      }

      if (msg.type === 'iframe-error' || (msg.type === 'error' && EMBED_BLOCKED.has(Number(msg.code)))) {
        setPlaying(false);
        confirm({
          title:       'Embedding is off for this video',
          message:     'YouTube blocked the preview from playing in-app. Open it in YouTube and turn on "Allow embedding" in YouTube Studio so guests can watch it here.',
          variant:     'warning',
          confirmText: 'Open in YouTube',
          cancelText:  'Cancel',
          onConfirm:   () => openExternal(),
        });
      } else if (msg.type === 'ended') {
        if (capped) fireLimitDialog();
        else setPlaying(false);
      }
    } catch (e) {
      // Non-JSON message — ignore.
    }
  };

  // ── Inline play state ──
  if (playing && (isYouTube || isDirect) && WebView) {
    const html = isYouTube
      ? buildYouTubeHtml(videoId, capped)
      : buildDirectVideoHtml((url || '').trim(), capped);
    return (
      <View style={styles.player}>
        <WebView
          source={{ html, baseUrl: 'https://www.youtube.com' }}
          style={StyleSheet.absoluteFill}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="always"
          onMessage={handleWebViewMessage}
          onError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            console.log('[YouTubeThumbPlayer] WebView error', nativeEvent);
            setPlaying(false);
            if (isYouTube) openExternal();
          }}
          onShouldStartLoadWithRequest={(req) => {
            return req.url.startsWith('https://www.youtube-nocookie.com')
              || req.url.startsWith('https://www.youtube.com')
              || req.url.startsWith('about:blank')
              || req.url.startsWith('http://')
              || req.url.startsWith('https://');
          }}
        />
        <TouchableOpacity
          style={styles.closeBubble}
          onPress={() => setPlaying(false)}
          activeOpacity={0.8}
        >
          <Text style={styles.closeText}>Close</Text>
        </TouchableOpacity>
        {capped ? (
          <View style={styles.previewPill}>
            <Text style={styles.previewPillText}>Free preview · {PREVIEW_SECONDS}s</Text>
          </View>
        ) : null}
      </View>
    );
  }

  // ── Thumbnail / tap-to-play state ──
  const canEmbed = (isYouTube || isDirect) && !!WebView;
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={() => {
        if (canEmbed) setPlaying(true);
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
          {!canEmbed
            ? (isYouTube ? 'Tap to watch (install required)' : 'Open intro video')
            : capped ? `Watch a ${PREVIEW_SECONDS}s preview` : 'Watch intro video'}
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
  previewPill: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  previewPillText: { ...type.caption, color: '#fff', fontWeight: '700' },
});

// src/components/bellScrollBus.js
//
// Tiny event bus that lets any scrollable screen tell the floating
// GlobalNotificationBell whether the viewer is scrolling down (hide
// the bell to reclaim screen space) or up (show it again).
//
// Screens plug in with:
//   import { useBellScrollHandler } from '../components/bellScrollBus';
//   const onScroll = useBellScrollHandler();
//   <ScrollView onScroll={onScroll} scrollEventThrottle={16}>
//
// The bell subscribes to the bus and animates its own translateY. We
// deliberately keep the bus stateless (no React context, no re-render
// churn) — it's a lightweight subscribe/emit pair that only fires when
// the direction actually flips, so the bell's animation runs at most
// a couple of times per swipe.

const listeners = new Set();
// 'up' | 'down' — last-known scroll direction. 'up' also covers "at
// the top" so a screen that hasn't been scrolled shows the bell.
let lastDirection = 'up';
// Minimum vertical distance between two frames before we consider it
// a direction change. Small nudges (rubber-banding, inertia settle)
// don't flip the bell — that would look like a nervous flicker.
const THRESHOLD_PX = 6;
// Anchor position on the most recent direction change, used to gate
// tiny reversals below THRESHOLD_PX from re-emitting.
let anchorY = 0;
let lastY = 0;

function emit(direction) {
  if (direction === lastDirection) return;
  lastDirection = direction;
  listeners.forEach((fn) => {
    try { fn(direction); } catch (_) { /* ignore */ }
  });
}

/**
 * Feed a scroll offset into the bus. Direction is derived from the
 * delta since the last emit. Callers pass the raw contentOffset.y.
 */
export function reportScroll(y) {
  const numeric = Number(y) || 0;
  const delta   = numeric - anchorY;
  if (numeric <= 0) {
    // Rubber-banded or at the very top — always show.
    anchorY = 0;
    lastY   = numeric;
    emit('up');
    return;
  }
  if (delta > THRESHOLD_PX) {
    anchorY = numeric;
    lastY   = numeric;
    emit('down');
  } else if (delta < -THRESHOLD_PX) {
    anchorY = numeric;
    lastY   = numeric;
    emit('up');
  } else {
    lastY = numeric;
  }
}

/** Subscribe to direction changes. Returns an unsubscribe fn. */
export function subscribe(listener) {
  listeners.add(listener);
  // Fire the current direction so a late subscriber (the bell mounting
  // after a screen has already scrolled) picks up the right state.
  try { listener(lastDirection); } catch (_) { /* noop */ }
  return () => listeners.delete(listener);
}

/** Reset the bus (route change, sign-out) — bell defaults to visible. */
export function reset() {
  anchorY = 0;
  lastY   = 0;
  emit('up');
}

/**
 * React hook: returns an onScroll handler you can drop straight onto
 * any ScrollView / FlatList / SectionList. Coalesces at raw layout
 * events — cheap, no re-renders.
 */
export function useBellScrollHandler() {
  return (event) => {
    const y = event?.nativeEvent?.contentOffset?.y;
    if (typeof y === 'number') reportScroll(y);
  };
}

// src/components/DateField.js
//
// Wheel-style date picker with three independent columns — Day, Month,
// Year — each scrollable + tappable. Pattern users already know from
// iOS UIDatePicker and most Android wheel pickers, so no calendar
// navigation is needed. Tapping the trigger opens a bottom sheet with
// the three wheels stacked side by side and a "Done" CTA.
//
// Props (backwards-compatible with the old inline calendar):
//   value        ISO 'YYYY-MM-DD' (empty string = unset)
//   onChange     (iso: string) => void  ('' when cleared)
//   placeholder  text shown when value is empty
//   accent       hex string for the brand color, defaults to red
//   minYear      smallest selectable year (default today - 80)
//   maxYear      largest selectable year (default today + 10)
//   minDate      ignored — kept for backwards-compat with existing
//                callers that pass `minDate={new Date()}`. The backend
//                validates real cut-offs (event_date >= today, etc).
//
// Value semantics: same ISO date string the old DateField produced, so
// callers can swap this in without touching their submit payload.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, FlatList, StyleSheet,
} from 'react-native';
import { Calendar, X, Check } from 'lucide-react-native';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Each wheel row is 44px tall, and we render 5 visible rows so the user
// sees 2 items above + the centered selection + 2 below. The center band
// lines up exactly with row index 2 (offset = ITEM_HEIGHT * 2).
const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;

function pad2(n) { return String(n).padStart(2, '0'); }
function isoFor(y, m, d) { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }
function parseIso(s) {
  if (!s) return null;
  const [y, m, d] = String(s).split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
}
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

/* ──────────────────────────────────────────────────────────────────
   <Wheel /> — one scrollable column. Snaps to nearest item on release
   and tells the parent which index is centered.
   ────────────────────────────────────────────────────────────── */
function Wheel({ items, labelFor, selectedIndex, onChange }) {
  const ref = useRef(null);

  // Keep the wheel scrolled to whichever index the parent says is
  // active. We use scrollToOffset because scrollToIndex can throw if
  // the index lies inside the padding rows we add at the top/bottom.
  useEffect(() => {
    if (ref.current && selectedIndex >= 0) {
      ref.current.scrollToOffset({
        offset: selectedIndex * ITEM_HEIGHT,
        animated: false,
      });
    }
  }, [selectedIndex]);

  const handleMomentumEnd = (e) => {
    const y = e.nativeEvent.contentOffset.y;
    const idx = Math.round(y / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(items.length - 1, idx));
    if (clamped !== selectedIndex) onChange(clamped);
  };

  return (
    <View style={{ flex: 1, height: WHEEL_HEIGHT }}>
      <FlatList
        ref={ref}
        data={items}
        keyExtractor={(_, i) => String(i)}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        onMomentumScrollEnd={handleMomentumEnd}
        getItemLayout={(_, i) => ({
          length: ITEM_HEIGHT,
          offset: i * ITEM_HEIGHT,
          index: i,
        })}
        // Top + bottom padding so the FIRST and LAST items can reach
        // the centered selection band. Without this you can't pick e.g.
        // the year 1945 because it can't scroll into the centre row.
        contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
        renderItem={({ item, index }) => {
          const isActive = index === selectedIndex;
          const distance = Math.abs(index - selectedIndex);
          return (
            <TouchableOpacity
              style={styles.wheelItem}
              activeOpacity={0.7}
              onPress={() => {
                if (ref.current) {
                  ref.current.scrollToOffset({
                    offset: index * ITEM_HEIGHT,
                    animated: true,
                  });
                }
                onChange(index);
              }}
            >
              <Text
                style={[
                  styles.wheelText,
                  isActive && styles.wheelTextActive,
                  // Fade items further from the selection so the centre
                  // line reads clearly even on a busy background.
                  !isActive && distance === 1 && { opacity: 0.55 },
                  !isActive && distance >= 2 && { opacity: 0.3 },
                ]}
              >
                {labelFor ? labelFor(item) : String(item)}
              </Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

export default function DateField({
  value,
  onChange,
  placeholder = 'Pick a date',
  accent = '#E63946',
  minYear,
  maxYear,
  // minDate kept for prop compatibility but enforced server-side.
  // eslint-disable-next-line no-unused-vars
  minDate,
}) {
  const today = new Date();
  const parsed = parseIso(value);

  const [open, setOpen] = useState(false);

  // Working state inside the sheet. We only commit to the parent's
  // `value` when the user taps Done — that way scrolling around
  // without confirming doesn't accidentally clobber their stored value.
  const [yIdx, setYIdx] = useState(0);
  const [mIdx, setMIdx] = useState(0);
  const [dIdx, setDIdx] = useState(0);

  const yMin = minYear ?? (today.getFullYear() - 80);
  const yMax = maxYear ?? (today.getFullYear() + 10);
  const years = useMemo(
    () => Array.from({ length: yMax - yMin + 1 }, (_, i) => yMin + i),
    [yMin, yMax],
  );

  const selectedYear  = years[yIdx] ?? today.getFullYear();
  const selectedMonth = mIdx;
  const days = useMemo(() => {
    const total = daysInMonth(selectedYear, selectedMonth);
    return Array.from({ length: total }, (_, i) => i + 1);
  }, [selectedYear, selectedMonth]);

  // When month/year changes to a shorter month (e.g. Feb 29 → Feb), the
  // selected day index may exceed the new day count. Clamp it down so
  // we never show "31" while February is selected.
  useEffect(() => {
    if (dIdx >= days.length) setDIdx(days.length - 1);
  }, [days.length, dIdx]);

  const openPicker = () => {
    const init = parsed || {
      y: today.getFullYear(),
      m: today.getMonth(),
      d: today.getDate(),
    };
    const yi = years.indexOf(init.y);
    setYIdx(yi >= 0 ? yi : years.indexOf(today.getFullYear()));
    setMIdx(init.m);
    setDIdx(init.d - 1);
    setOpen(true);
  };

  const confirm = () => {
    const iso = isoFor(years[yIdx], mIdx, days[dIdx]);
    onChange(iso);
    setOpen(false);
  };

  const clear = (e) => {
    e?.stopPropagation?.();
    onChange('');
  };

  const display = parsed
    ? `${pad2(parsed.d)} ${MONTH_NAMES[parsed.m].slice(0, 3)} ${parsed.y}`
    : placeholder;

  // Live preview at the top of the sheet — updates as the user spins
  // the wheels so they can see the date they're about to confirm.
  const previewDay = days[dIdx] || 1;
  const previewMonth = MONTH_NAMES[mIdx] || '';
  const previewYear = years[yIdx] || today.getFullYear();

  return (
    <View>
      <TouchableOpacity
        style={styles.trigger}
        onPress={openPicker}
        activeOpacity={0.85}
      >
        <Calendar size={16} color={accent} strokeWidth={2.2} />
        <Text style={[styles.triggerText, !parsed && { color: '#9CA3AF' }]}>
          {display}
        </Text>
        {parsed ? (
          <TouchableOpacity onPress={clear} style={styles.clearBtn} hitSlop={8}>
            <X size={14} color="#6B7280" strokeWidth={2.2} />
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <View style={styles.backdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setOpen(false)}
          />

          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />

            <Text style={styles.sheetTitle}>Select date</Text>
            <Text style={styles.sheetPreview}>
              {pad2(previewDay)} {previewMonth} {previewYear}
            </Text>

            {/* Wheel header — labels above each column */}
            <View style={styles.wheelHeaderRow}>
              <Text style={styles.wheelHeaderText}>Day</Text>
              <Text style={styles.wheelHeaderText}>Month</Text>
              <Text style={styles.wheelHeaderText}>Year</Text>
            </View>

            {/* Three wheels side-by-side with a centred highlight band */}
            <View style={styles.wheelRow}>
              <View
                pointerEvents="none"
                style={[
                  styles.highlightBar,
                  { backgroundColor: accent + '14', borderColor: accent },
                ]}
              />
              <Wheel
                items={days}
                selectedIndex={dIdx}
                onChange={setDIdx}
                labelFor={(d) => pad2(d)}
              />
              <Wheel
                items={Array.from({ length: 12 }, (_, i) => i)}
                labelFor={(i) => MONTH_NAMES[i]}
                selectedIndex={mIdx}
                onChange={setMIdx}
              />
              <Wheel
                items={years}
                selectedIndex={yIdx}
                onChange={setYIdx}
              />
            </View>

            <View style={styles.sheetFooter}>
              <TouchableOpacity
                style={styles.ghostBtn}
                onPress={() => setOpen(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.ghostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: accent, shadowColor: accent }]}
                onPress={confirm}
                activeOpacity={0.88}
              >
                <Check size={16} color="#fff" strokeWidth={2.6} />
                <Text style={styles.primaryText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Trigger row (same look as before so existing forms don't shift) ──
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1, borderColor: '#E5E7EB',
    paddingHorizontal: 12, paddingVertical: 11,
  },
  triggerText: { flex: 1, fontSize: 14, color: '#111827', fontWeight: '600' },
  clearBtn: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F4F4F8',
  },

  // ── Bottom sheet ────────────────────────────────────────────────
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 15, 30, 0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44, height: 4, borderRadius: 2,
    backgroundColor: '#E5E7EB',
    marginBottom: 14,
  },
  sheetTitle: {
    fontSize: 16, fontWeight: '800', color: '#111827',
    textAlign: 'center',
  },
  sheetPreview: {
    fontSize: 18, fontWeight: '900', color: '#0F172A',
    textAlign: 'center',
    marginTop: 4, marginBottom: 12,
    letterSpacing: 0.3,
  },

  // ── Wheels ──────────────────────────────────────────────────────
  wheelHeaderRow: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    marginBottom: 4,
  },
  wheelHeaderText: {
    flex: 1, textAlign: 'center',
    fontSize: 10, fontWeight: '700',
    color: '#9CA3AF', letterSpacing: 1,
  },
  wheelRow: {
    flexDirection: 'row',
    position: 'relative',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    overflow: 'hidden',
    height: WHEEL_HEIGHT,
  },
  highlightBar: {
    position: 'absolute',
    left: 8, right: 8,
    // Centre row sits at offset = ITEM_HEIGHT * 2 (two rows above the centre).
    top: ITEM_HEIGHT * 2,
    height: ITEM_HEIGHT,
    borderRadius: 10,
    borderWidth: 1.5,
    zIndex: 1,
  },
  wheelItem: {
    height: ITEM_HEIGHT,
    justifyContent: 'center', alignItems: 'center',
  },
  wheelText: {
    fontSize: 15, color: '#111827', fontWeight: '500',
  },
  wheelTextActive: {
    fontSize: 18, fontWeight: '800', color: '#0F172A',
  },

  // ── Footer ──────────────────────────────────────────────────────
  sheetFooter: {
    flexDirection: 'row', gap: 10, marginTop: 18,
  },
  ghostBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  ghostText: { fontSize: 14, fontWeight: '700', color: '#475569' },
  primaryBtn: {
    flex: 1.6, paddingVertical: 14, borderRadius: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  primaryText: { fontSize: 14, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
});

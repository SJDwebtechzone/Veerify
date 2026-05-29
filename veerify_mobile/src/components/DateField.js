// src/components/DateField.js
//
// Reusable inline calendar picker. Tapping the trigger row reveals a
// Material-style month grid with arrow navigation, tappable month/year
// headers to flip to month-grid / year-grid views, "Today" jump, and
// X to clear. Value is an ISO YYYY-MM-DD string so it serialises
// cleanly to a Postgres DATE column.
//
// Props:
//   value         current ISO date string ('' = unset)
//   onChange      (iso: string) => void  ('' when cleared)
//   minYear       smallest selectable year (default 1900)
//   maxYear       largest selectable year (default today + 10)
//   placeholder   text shown when value is empty
//   accent        hex string for the brand color, defaults to red

import React, { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import {
  Calendar, ChevronLeft, ChevronRight, X,
} from 'lucide-react-native';

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAY_HEADERS = ['S','M','T','W','T','F','S'];

function pad2(n) { return String(n).padStart(2, '0'); }
function isoFor(y, m, d) { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }
function parseIso(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
}
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function firstWeekday(y, m) { return new Date(y, m, 1).getDay(); }

export default function DateField({
  value,
  onChange,
  minYear,
  maxYear,
  placeholder = 'Pick a date',
  accent = '#E63946',
}) {
  const today = new Date();
  const parsed = parseIso(value);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('day'); // 'day' | 'month' | 'year'
  const [cursor, setCursor] = useState({
    y: parsed?.y || today.getFullYear(),
    m: parsed?.m ?? today.getMonth(),
  });
  const [yearAnchor, setYearAnchor] = useState(parsed?.y || today.getFullYear());

  const yMin = minYear ?? 1900;
  const yMax = maxYear ?? today.getFullYear() + 10;

  const display = parsed
    ? `${pad2(parsed.d)} ${MONTH_NAMES[parsed.m].slice(0, 3)} ${parsed.y}`
    : placeholder;

  const grid = useMemo(() => {
    const cells = [];
    const offset = firstWeekday(cursor.y, cursor.m);
    const total = daysInMonth(cursor.y, cursor.m);
    for (let i = 0; i < offset; i += 1) cells.push(null);
    for (let d = 1; d <= total; d += 1) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const stepMonth = (delta) => {
    let y = cursor.y;
    let m = cursor.m + delta;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    if (y < yMin) { y = yMin; m = 0; }
    if (y > yMax) { y = yMax; m = 11; }
    setCursor({ y, m });
  };

  const pickDay = (d) => {
    if (!d) return;
    onChange(isoFor(cursor.y, cursor.m, d));
    setOpen(false);
    setView('day');
  };

  const clear = () => {
    onChange('');
    setOpen(false);
    setView('day');
  };

  return (
    <View>
      <TouchableOpacity
        style={[styles.trigger, { borderColor: '#E5E7EB' }]}
        onPress={() => setOpen((o) => !o)}
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
        ) : (
          <ChevronRight
            size={16}
            color="#9CA3AF"
            strokeWidth={2}
            style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}
          />
        )}
      </TouchableOpacity>

      {open ? (
        <View style={styles.card}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => view === 'day' ? stepMonth(-1) : setYearAnchor(yearAnchor - 12)}
              style={styles.navBtn}
              activeOpacity={0.7}
            >
              <ChevronLeft size={16} color="#111827" strokeWidth={2.4} />
            </TouchableOpacity>

            <View style={{ flexDirection: 'row', gap: 6, flex: 1, justifyContent: 'center' }}>
              <TouchableOpacity
                style={styles.labelBtn}
                onPress={() => setView(view === 'month' ? 'day' : 'month')}
                activeOpacity={0.7}
              >
                <Text style={styles.labelText}>
                  {view === 'year'
                    ? `${yearAnchor} – ${yearAnchor + 11}`
                    : MONTH_NAMES[cursor.m]}
                </Text>
              </TouchableOpacity>
              {view !== 'year' ? (
                <TouchableOpacity
                  style={styles.labelBtn}
                  onPress={() => { setView('year'); setYearAnchor(cursor.y - 5); }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.labelText}>{cursor.y}</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <TouchableOpacity
              onPress={() => view === 'day' ? stepMonth(+1) : setYearAnchor(yearAnchor + 12)}
              style={styles.navBtn}
              activeOpacity={0.7}
            >
              <ChevronRight size={16} color="#111827" strokeWidth={2.4} />
            </TouchableOpacity>
          </View>

          {view === 'day' && (
            <>
              <View style={styles.dayHeaderRow}>
                {DAY_HEADERS.map((d, i) => (
                  <View key={i} style={styles.dayHeader}>
                    <Text style={styles.dayHeaderText}>{d}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.grid}>
                {grid.map((d, i) => {
                  const isSelected = parsed
                    && parsed.y === cursor.y
                    && parsed.m === cursor.m
                    && parsed.d === d;
                  const isToday = !isSelected
                    && d
                    && today.getFullYear() === cursor.y
                    && today.getMonth() === cursor.m
                    && today.getDate() === d;
                  return (
                    <TouchableOpacity
                      key={i}
                      style={styles.cell}
                      disabled={!d}
                      onPress={() => pickDay(d)}
                      activeOpacity={0.7}
                    >
                      {d ? (
                        <View style={[
                          styles.cellInner,
                          isSelected && { backgroundColor: accent },
                          isToday && { borderWidth: 1.5, borderColor: accent },
                        ]}>
                          <Text style={[
                            styles.cellText,
                            isSelected && { color: '#fff', fontWeight: '800' },
                            isToday && !isSelected && { color: accent, fontWeight: '800' },
                          ]}>
                            {d}
                          </Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {view === 'month' && (
            <View style={styles.monthGrid}>
              {MONTH_NAMES.map((name, i) => {
                const isSel = parsed && parsed.y === cursor.y && parsed.m === i;
                return (
                  <TouchableOpacity
                    key={name}
                    style={[styles.monthCell, isSel && { backgroundColor: accent }]}
                    onPress={() => { setCursor({ y: cursor.y, m: i }); setView('day'); }}
                    activeOpacity={0.85}
                  >
                    <Text style={[
                      styles.monthCellText,
                      isSel && { color: '#fff', fontWeight: '800' },
                    ]}>
                      {name.slice(0, 3)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {view === 'year' && (
            <View style={styles.monthGrid}>
              {Array.from({ length: 12 }, (_, i) => yearAnchor + i).map((y) => {
                const disabled = y < yMin || y > yMax;
                const isSel = cursor.y === y;
                return (
                  <TouchableOpacity
                    key={y}
                    style={[
                      styles.monthCell,
                      isSel && { backgroundColor: accent },
                      disabled && { opacity: 0.3 },
                    ]}
                    disabled={disabled}
                    onPress={() => { setCursor({ y, m: cursor.m }); setView('month'); }}
                    activeOpacity={0.85}
                  >
                    <Text style={[
                      styles.monthCellText,
                      isSel && { color: '#fff', fontWeight: '800' },
                    ]}>
                      {y}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <View style={styles.footer}>
            <TouchableOpacity
              onPress={() => {
                const t = new Date();
                if (t.getFullYear() < yMin || t.getFullYear() > yMax) return;
                setCursor({ y: t.getFullYear(), m: t.getMonth() });
                setView('day');
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.footerText, { color: accent }]}>Today</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={() => setOpen(false)} activeOpacity={0.7}>
              <Text style={[styles.footerText, { color: accent }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 11,
  },
  triggerText: { flex: 1, fontSize: 14, color: '#111827', fontWeight: '600' },
  clearBtn: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F4F4F8',
  },
  card: {
    marginTop: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1, borderColor: '#E5E7EB',
    padding: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  navBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#F4F4F8',
    alignItems: 'center', justifyContent: 'center',
  },
  labelBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  labelText: { fontSize: 14, fontWeight: '800', color: '#111827' },

  dayHeaderRow: { flexDirection: 'row', marginBottom: 4 },
  dayHeader: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  dayHeaderText: { fontSize: 10, color: '#9CA3AF', fontWeight: '700' },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: '14.2857%',
    aspectRatio: 1,
    alignItems: 'center', justifyContent: 'center',
    padding: 2,
  },
  cellInner: {
    width: '92%', aspectRatio: 1,
    borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
  },
  cellText: { fontSize: 13, color: '#111827', fontWeight: '600' },

  monthGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  monthCell: {
    width: '25%', paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 8,
  },
  monthCellText: { fontSize: 13, color: '#111827', fontWeight: '700' },

  footer: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 8, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: '#E5E7EB',
  },
  footerText: { fontSize: 12, fontWeight: '800', paddingVertical: 4, paddingHorizontal: 4 },
});

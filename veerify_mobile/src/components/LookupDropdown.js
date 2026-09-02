// src/components/LookupDropdown.js
//
// Reusable single-select dropdown backed by a static array of string
// options. Used across the admin forms (Create Trainer → Skill /
// Belt, Create Course → Category, etc.) so every "pick one from a
// canonical list" surface renders identically.
//
// Behaviour:
//   • Trigger looks + feels like the plain <TextInput /> it replaces
//     (pill background, placeholder colour, chevron on the right)
//     so the form's visual rhythm stays put.
//   • Tap → expands an inline panel below the trigger with a search
//     field at the top and the filtered options underneath.
//   • Nested scroll on the option list so long lists (16 skills, 13
//     belts, N categories) are fully reachable — no silent clipping.
//   • Any value not in the canonical `options` array (e.g. a legacy
//     saved value) is merged in as an extra option so existing rows
//     keep displaying + filtering correctly.
//   • Selected row shows a brand-red background + red text + check.
//   • Controlled — the parent owns the current value; the dropdown
//     emits onSelect(value) when a row is tapped.

import React, { useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { ChevronDown, Check } from 'lucide-react-native';

const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFE4E6';
const TEXT        = '#111827';
const TEXT_MUTED  = '#6B7280';
const TEXT_LIGHT  = '#9CA3AF';
const SURFACE     = '#FFFFFF';
const BG          = '#F4F4F8';
const BORDER      = '#E5E7EB';

export default function LookupDropdown({
  value,
  options,
  onSelect,
  placeholder = 'Select…',
  emptyText   = 'No matches.',
  inputStyle,
}) {
  const [open, setOpen]     = useState(false);
  const [query, setQuery]   = useState('');

  // Merge canonical options + any legacy value that isn't in the
  // canonical list. Preserves saved rows created before the enum
  // list existed / was updated.
  const merged = useMemo(() => {
    const canonical = Array.isArray(options) ? options.map(String) : [];
    const has = new Set(canonical);
    const legacy = value && !has.has(String(value)) ? [String(value)] : [];
    return [...canonical, ...legacy];
  }, [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter((o) => o.toLowerCase().includes(q));
  }, [merged, query]);

  return (
    <View>
      <TouchableOpacity
        style={[styles.trigger, inputStyle]}
        onPress={() => setOpen((o) => !o)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={placeholder}
      >
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            color: value ? TEXT : TEXT_LIGHT,
            fontSize: 14,
          }}
        >
          {value || placeholder}
        </Text>
        <ChevronDown
          size={16}
          color={TEXT_MUTED}
          strokeWidth={2}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </TouchableOpacity>

      {open ? (
        <View style={styles.panel}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search…"
            placeholderTextColor={TEXT_LIGHT}
            style={styles.search}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {filtered.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>{emptyText}</Text>
            </View>
          ) : (
            // nestedScrollEnabled so touches pass through the outer
            // form ScrollView on Android — without it, users can't
            // scroll a long list inside the dropdown.
            <ScrollView
              style={styles.list}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              {filtered.map((opt, idx) => {
                const selected = opt === value;
                return (
                  <TouchableOpacity
                    key={`${opt}-${idx}`}
                    style={[
                      styles.row,
                      idx > 0 && styles.rowSep,
                      selected && styles.rowSelected,
                    ]}
                    onPress={() => {
                      onSelect(opt);
                      setQuery('');
                      setOpen(false);
                    }}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        styles.rowText,
                        selected && styles.rowTextSelected,
                      ]}
                      numberOfLines={1}
                    >
                      {opt}
                    </Text>
                    {selected ? (
                      <Check size={14} color={BRAND} strokeWidth={2.6} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Trigger — mirrors the styling of the form inputs it sits next to.
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  panel: {
    marginTop: 6,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingVertical: 6,
    maxHeight: 240,
    overflow: 'hidden',
  },
  search: {
    marginHorizontal: 8,
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: BG,
    fontSize: 13,
    color: TEXT,
  },
  list: {
    // Leave room for the search field above so rows never cramp.
    maxHeight: 190,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowSep: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  rowSelected: {
    backgroundColor: BRAND_SOFT,
  },
  rowText: {
    flex: 1,
    fontSize: 14,
    color: TEXT,
  },
  rowTextSelected: {
    color: BRAND,
    fontWeight: '700',
  },
  emptyRow: {
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  emptyText: {
    fontSize: 13,
    color: TEXT_LIGHT,
    fontStyle: 'italic',
  },
});

// Canonical Skill list fallback — kept alongside the component for
// callers that need something to render before /config/enums has
// answered. Must stay byte-identical to backend/src/config/enums.js.
export const FALLBACK_SKILLS = [
  'Karate',
  'Taekwondo',
  'Kung Fu',
  'Judo',
  'Boxing',
  'Muay Thai',
  'Brazilian Jiu-Jitsu (BJJ)',
  'MMA',
  'Yoga',
  'Silambam',
  'Kalaripayattu',
  'Adimurai',
  'Aikido',
  'Krav Maga',
  'Kickboxing',
  'Self Defense',
];

// Canonical Belt list fallback — same rule as FALLBACK_SKILLS.
export const FALLBACK_BELTS = [
  'White',
  'Yellow',
  'Orange',
  'Green',
  'Blue',
  'Blue I',
  'Blue II',
  'Gray',
  'Brown I',
  'Brown II',
  'Brown III',
  'Black',
  'Other',
];

// src/components/TrainerPicker.js
//
// Searchable trainer dropdown used on the Create / Edit Course form.
// Renders inline — the list expands RIGHT UNDER the trigger button
// so the admin doesn't lose visual context. Options display as
// "Trainer Name – Skill" (e.g. "John David – Karate"). Multiple
// skills render comma-separated up to a sensible max. Selection saves
// only the trainer_id upstream; the formatted label is derived at
// render time from the current trainer list so admin edits (renaming
// a trainer or changing their primary skill) always show the freshest
// label.
//
// Refresh behaviour — the parent screen re-fires the load whenever
// it regains focus via useFocusEffect, so newly-added trainers
// appear in this list the next time the admin opens Create Course.

import React, { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput,
  ActivityIndicator, StyleSheet, ScrollView,
} from 'react-native';
import { Search, ChevronDown, Check, User, X as XIcon } from 'lucide-react-native';

import { palette, spacing, radius, shadows, type } from '../theme';

// Build the "Name – Skill" label. Reads skills in this order:
//   1. structured skills[] JSONB (migration 046): [{ name, ... }]
//   2. legacy `specialization` VARCHAR (migration 016)
//   3. falls back to the user's name only
function formatTrainerLabel(t) {
  const name = t?.name || t?.user?.name || 'Trainer';
  const skills = [];
  if (Array.isArray(t?.skills) && t.skills.length > 0) {
    for (const s of t.skills) {
      if (typeof s === 'string') skills.push(s);
      else if (s && s.name) skills.push(String(s.name));
    }
  } else if (t?.specialization) {
    skills.push(String(t.specialization));
  }
  const skillLabel = skills.slice(0, 3).join(', ');
  return skillLabel ? `${name} – ${skillLabel}` : name;
}

export default function TrainerPicker({
  value,           // trainer_id (number) or null
  onChange,        // (trainerId | null) => void
  trainers,        // array from /trainers – parent hoists so refresh is on-focus
  loading = false,
  placeholder = 'Select a trainer',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Find the currently-selected trainer inside the freshest list so
  // the trigger label reflects any renames / skill edits automatically.
  const selected = useMemo(
    () => trainers.find((t) => Number(t.id) === Number(value)) || null,
    [trainers, value],
  );

  // Case-insensitive substring match on name and skill(s). Cheap
  // enough to run per-keystroke on typical academy rosters (< 200
  // trainers) without memoisation gymnastics.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return trainers;
    return trainers.filter((t) => {
      const label = formatTrainerLabel(t).toLowerCase();
      return label.includes(q);
    });
  }, [trainers, query]);

  return (
    <View>
      <TouchableOpacity
        style={[styles.trigger, open && styles.triggerOpen]}
        onPress={() => setOpen((o) => !o)}
        activeOpacity={0.85}
      >
        <View style={styles.triggerIcon}>
          <User size={13} color={palette.purple.vivid} strokeWidth={2.4} />
        </View>
        <Text
          style={[styles.triggerText, !selected && styles.triggerPlaceholder]}
          numberOfLines={1}
        >
          {selected ? formatTrainerLabel(selected) : placeholder}
        </Text>
        <ChevronDown
          size={16}
          color={palette.textMuted}
          strokeWidth={2.2}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </TouchableOpacity>

      {open ? (
        <View style={styles.panel}>
          {/* Search input — always visible so the admin can filter
              even long rosters right where they clicked. */}
          <View style={styles.searchWrap}>
            <Search size={13} color={palette.textMuted} strokeWidth={2.4} />
            <TextInput
              placeholder="Search by name or skill…"
              placeholderTextColor={palette.textLight}
              value={query}
              onChangeText={setQuery}
              style={styles.searchInput}
              returnKeyType="search"
              autoFocus
            />
            {query ? (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                <XIcon size={13} color={palette.textMuted} strokeWidth={2.4} />
              </TouchableOpacity>
            ) : null}
          </View>

          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={palette.purple.vivid} />
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>
                {query
                  ? `No trainers match "${query}".`
                  : 'No trainers yet. Add one from More → Trainers, then come back here.'}
              </Text>
            </View>
          ) : (
            // ScrollView keeps everything inline in the parent
            // form's ScrollView. maxHeight bounds it so a huge
            // roster doesn't push the rest of the form off-screen.
            <ScrollView
              style={styles.listScroll}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {filtered.map((item, idx) => {
                const isSel = Number(item.id) === Number(value);
                return (
                  <View key={item.id}>
                    <TouchableOpacity
                      style={[styles.optionRow, isSel && styles.optionRowSelected]}
                      onPress={() => {
                        onChange?.(item.id);
                        setOpen(false);
                        setQuery('');
                      }}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.optionLabel} numberOfLines={2}>
                        {formatTrainerLabel(item)}
                      </Text>
                      {isSel ? (
                        <Check size={16} color={palette.purple.vivid} strokeWidth={2.6} />
                      ) : null}
                    </TouchableOpacity>
                    {idx < filtered.length - 1 ? (
                      <View style={styles.optionDivider} />
                    ) : null}
                  </View>
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
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  // Visually flatten the trigger's bottom edge when the inline panel
  // is showing so the two read as one connected component.
  triggerOpen: {
    borderColor: palette.purple.vivid,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  triggerIcon: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.purple.soft,
  },
  triggerText: {
    flex: 1,
    ...type.body,
    color: palette.text,
    fontWeight: '700',
    fontSize: 14,
  },
  triggerPlaceholder: {
    color: palette.textLight,
    fontWeight: '500',
  },

  // Inline dropdown panel sitting right below the trigger.
  panel: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: palette.purple.vivid,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    paddingVertical: 8,
    ...shadows.card,
  },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 10,
    marginBottom: 6,
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.borderSoft,
  },
  searchInput: {
    flex: 1,
    ...type.body,
    color: palette.text,
    fontSize: 13,
    padding: 0,
  },

  centered: {
    padding: spacing.md,
    alignItems: 'center',
  },

  emptyBox: {
    marginHorizontal: 10,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: palette.bg,
  },
  emptyText: {
    ...type.caption,
    color: palette.textMuted,
    textAlign: 'center',
    fontWeight: '600',
    lineHeight: 18,
  },

  // Cap the list height so on a small screen the picker doesn't
  // push the rest of the form off-view.
  listScroll: {
    maxHeight: 240,
  },

  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optionRowSelected: {
    backgroundColor: palette.purple.soft,
  },
  optionLabel: {
    flex: 1,
    ...type.bodyBold,
    color: palette.text,
    fontSize: 13,
  },
  optionDivider: { height: 1, backgroundColor: palette.borderSoft, marginHorizontal: 12 },
});

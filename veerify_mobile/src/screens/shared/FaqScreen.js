// src/screens/shared/FaqScreen.js
//
// Dynamic FAQ browser. Reached from Support (More / Profile) on every
// role. Behaviour:
//
//   • Fetches GET /api/faqs on mount. The backend filters by the
//     caller's role (via JWT) — guests still get their guest bucket.
//   • Groups the result by category and renders one collapsible
//     section per group.
//   • Search bar at the top filters by question OR keyword in the
//     stripped-plain-text answer, case-insensitively.
//   • Every question is a tap-to-expand row. Only one row per group
//     is expanded at a time by default (tap another to swap); tapping
//     an already-open row collapses it.
//
// Rich text answer:
//   The admin edits answers with RichTextEditor on the web (HTML).
//   To avoid pulling in a heavy WebView here we do a small
//   HTML→plain-text conversion for the render, preserving <br>, <p>,
//   and <li> as line breaks. Bold / italic / lists survive as bullet
//   markers so the answer stays readable without needing an HTML
//   engine.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, TextInput,
  StyleSheet, RefreshControl, LayoutAnimation, UIManager, Platform,
} from 'react-native';
import {
  ArrowLeft, Search, ChevronDown, HelpCircle, Sparkles,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Compact HTML → plain text. Not a full parser — just the tags the
// admin's rich text editor emits (p, br, strong, em, ul, ol, li). We
// keep bullet points and line breaks so the answer is still readable
// when we render it as a single <Text>.
function htmlToPlainText(html) {
  if (!html) return '';
  let s = String(html);
  // Normalise self-closing / block breaks to newlines.
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n');
  s = s.replace(/<p[^>]*>/gi, '');
  s = s.replace(/<\/p>/gi, '\n');
  // Lists → bullet markers on their own line.
  s = s.replace(/<li[^>]*>/gi, '\n• ');
  s = s.replace(/<\/li>/gi, '');
  s = s.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');
  // Strip every remaining tag; whitespace-collapse the tail.
  s = s.replace(/<[^>]+>/g, '');
  // Common HTML entities.
  s = s.replace(/&nbsp;/gi, ' ')
       .replace(/&amp;/gi, '&')
       .replace(/&lt;/gi, '<')
       .replace(/&gt;/gi, '>')
       .replace(/&quot;/gi, '"')
       .replace(/&#39;/gi, "'");
  // Collapse >2 consecutive blank lines.
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

export default function FaqScreen({ navigation }) {
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [faqs, setFaqs]           = useState([]);
  const [query, setQuery]         = useState('');
  // Map keyed by faq.id → boolean. Only one FAQ per category is open
  // at a time; opening a second one closes the first.
  const [openMap, setOpenMap]     = useState({});

  const load = useCallback(async () => {
    try {
      // Public endpoint — the backend derives the caller's role from
      // the JWT (or defaults to 'guest') and returns only the FAQs
      // whose audience[] contains that role. No client-side filter
      // needed beyond search.
      const r = await apiClient.get('/faqs');
      setFaqs(Array.isArray(r.data?.faqs) ? r.data.faqs : []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('[FAQ] load error:', err?.response?.data || err?.message);
      setFaqs([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Search + group. Query matches on question OR keyword in the
  // stripped-plain-text answer, case-insensitive.
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? faqs.filter((f) => {
          const question = String(f.question || '').toLowerCase();
          const answer   = htmlToPlainText(f.answer).toLowerCase();
          return question.includes(q) || answer.includes(q);
        })
      : faqs;

    // Group by category, preserving backend's display_order (already
    // sorted). Categories appear in the order they first show up in
    // the filtered list.
    const map = new Map();
    for (const f of filtered) {
      const cat = f.category || 'General';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(f);
    }
    return Array.from(map.entries()).map(([category, items]) => ({
      category, items,
    }));
  }, [faqs, query]);

  const toggle = (category, id) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenMap((prev) => {
      const currentlyOpenInCategory = Object.keys(prev)
        .filter((k) => prev[k])
        .find((k) => {
          const parts = k.split(':');
          return parts[0] === category;
        });
      const key = `${category}:${id}`;
      const wasOpen = !!prev[key];
      const next = { ...prev };
      // Close the previously open row in this category.
      if (currentlyOpenInCategory) next[currentlyOpenInCategory] = false;
      // Toggle the tapped row.
      next[key] = !wasOpen;
      return next;
    });
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8}>
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>FAQs</Text>
          <Text style={styles.subtitle}>Quick answers to common questions</Text>
        </View>
        <View style={styles.headerIcon}>
          <HelpCircle size={18} color={palette.purple.vivid} strokeWidth={2.2} />
        </View>
      </View>

      {/* Search bar */}
      <View style={styles.searchWrap}>
        <Search size={18} color={palette.textMuted} strokeWidth={2.2} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search questions or keywords"
          placeholderTextColor={palette.textLight}
          style={styles.searchInput}
          returnKeyType="search"
        />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={palette.purple.vivid} />
        </View>
      ) : grouped.length === 0 ? (
        <View style={styles.emptyCard}>
          <Sparkles size={30} color={palette.textLight} strokeWidth={1.8} />
          <Text style={styles.emptyTitle}>
            {query ? 'No matches' : 'No FAQs yet'}
          </Text>
          <Text style={styles.emptySub}>
            {query
              ? 'Try a different keyword or clear the search.'
              : 'Content is on the way — check back soon.'}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={palette.purple.vivid}
            />
          }
        >
          {grouped.map(({ category, items }) => (
            <View key={category} style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>{category}</Text>
              </View>

              {items.map((f) => {
                const key = `${category}:${f.id}`;
                const open = !!openMap[key];
                return (
                  <View key={f.id} style={styles.qaCard}>
                    <TouchableOpacity
                      onPress={() => toggle(category, f.id)}
                      activeOpacity={0.85}
                      style={styles.qaHead}
                    >
                      <Text style={styles.question} numberOfLines={open ? 0 : 3}>
                        {f.question}
                      </Text>
                      <View style={[
                        styles.chevWrap,
                        open && styles.chevWrapOpen,
                      ]}>
                        <ChevronDown
                          size={18}
                          color={open ? '#fff' : palette.purple.vivid}
                          strokeWidth={2.4}
                          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
                        />
                      </View>
                    </TouchableOpacity>
                    {open ? (
                      <View style={styles.qaBody}>
                        <Text style={styles.answer}>
                          {htmlToPlainText(f.answer)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    ...shadows.card,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },
  title:    { ...type.h1, color: palette.text, fontSize: 18 },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 1 },
  headerIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.purple.soft,
  },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    height: 48,
    ...shadows.card,
  },
  searchInput: { flex: 1, ...type.body, color: palette.text, padding: 0 },

  emptyCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    padding: spacing.xxl,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    alignItems: 'center',
    gap: 6,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 6 },
  emptySub:   { ...type.caption, color: palette.textMuted, textAlign: 'center' },

  section: { marginBottom: spacing.lg },
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  sectionTitle: { ...type.h2, color: palette.text, fontSize: 15, fontWeight: '800' },
  countPill: {
    backgroundColor: palette.purple.soft,
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: radius.pill,
  },
  countPillText: { ...type.micro, color: palette.purple.on, fontWeight: '800' },

  qaCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    ...shadows.card,
  },
  qaHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.md,
  },
  question: {
    flex: 1,
    ...type.bodyBold, color: palette.text, fontSize: 14, fontWeight: '700',
    lineHeight: 20,
  },
  chevWrap: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.purple.soft,
  },
  chevWrapOpen: {
    backgroundColor: palette.purple.vivid,
  },
  qaBody: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  answer: {
    ...type.body,
    color: palette.textMuted,
    lineHeight: 22,
    fontSize: 13,
  },
});

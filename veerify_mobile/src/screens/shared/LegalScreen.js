// src/screens/shared/LegalScreen.js
//
// Role-scoped read-only legal viewer. One screen serves student,
// trainer, parent, and admin — the backend's /legal-pages/me/*
// endpoints already return only the slugs the caller's role is
// allowed to see, so we don't need any client-side filtering.
//
// UX:
//   • Two "shelves" — Platform policies (rendered first, always
//     visible for logged-in users) and Academy policies (only when
//     the user has an academy selected).
//   • Tap a tile → opens the full-page reader (inline, no modal so
//     back-button behavior is native).
//   • Renderer treats content as multi-paragraph plain text with
//     preserved line breaks. Admins on the web can paste markdown
//     if they like — future work can add a proper markdown renderer.
//
// Reached from:
//   • Student → More → Legal   (StudentTabs stack)
//   • Trainer → Profile → Legal (StaffTabs stack)

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl,
} from 'react-native';
import {
  ArrowLeft, ChevronRight, FileText, ShieldCheck, Building2,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { useInstitution } from '../../context/InstitutionContext';
import { palette, spacing, radius, shadows, type } from '../../theme';
import HtmlRenderer from '../../components/HtmlRenderer';

// Nice display titles for slugs the backend returns as machine keys.
// Falls back to the row's own `title` field when present.
const SLUG_LABEL = {
  terms_and_conditions:            'Terms & Conditions',
  privacy_policy:                  'Privacy Policy',
  refund_and_cancellation_policy:  'Refund & Cancellation Policy',
  child_safety_policy:             'Child Safety Policy',
  contact_and_support:             'Contact & Support',
  about_academy:                   'About Academy',
  academy_rules:                   'Academy Rules',
  attendance_policy:               'Attendance Policy',
  belt_test_policy:                'Belt Test Policy',
};

function labelFor(page) {
  if (page.title && page.title.trim()) return page.title;
  return SLUG_LABEL[page.slug] || page.slug;
}

export default function LegalScreen({ route, navigation }) {
  const { selectedInstitution } = useInstitution();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [platform, setPlatform] = useState([]);
  const [institution, setInstitution] = useState([]);
  const [open, setOpen] = useState(null); // page currently being viewed

  // Institution admin's "Platform Information" entry passes
  // platformOnly=true so we hide the Academy shelf entirely — those
  // policies are ones the institution manages themselves, so
  // duplicating them here would just be noise. Custom title/subtitle
  // route params override the defaults so the header can read
  // "Platform Information" instead of "Legal" when appropriate.
  const platformOnly     = !!route?.params?.platformOnly;
  const headerTitle      = route?.params?.pageTitle    || 'Legal';
  const headerSubtitle   = route?.params?.pageSubtitle || 'Policies and terms that apply to you.';

  const load = useCallback(async () => {
    try {
      const pRes = await apiClient.get('/legal-pages/me/platform')
        .catch(() => ({ data: { pages: [] } }));
      setPlatform(pRes.data?.pages || []);

      // Skip the institution-scoped fetch entirely when the caller
      // asked for platform-only mode. Saves a network round-trip and
      // guarantees the Academy shelf never surfaces.
      if (platformOnly) {
        setInstitution([]);
      } else {
        const iRes = await apiClient
          .get('/legal-pages/me/institution' +
            (selectedInstitution?.id ? `?institution_id=${selectedInstitution.id}` : ''))
          .catch(() => ({ data: { pages: [] } }));
        setInstitution(iRes.data?.pages || []);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedInstitution?.id, platformOnly]);

  useEffect(() => { load(); }, [load]);

  // ── Full-page reader ─────────────────────────────────────────────
  if (open) {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => setOpen(null)}
            style={styles.iconBtn}
            hitSlop={8}
          >
            <ArrowLeft size={20} color={palette.text} strokeWidth={2.4} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>{labelFor(open)}</Text>
            {open.updated_at ? (
              <Text style={styles.subtitle}>
                Last updated {new Date(open.updated_at).toLocaleDateString('en-IN', {
                  day: '2-digit', month: 'short', year: 'numeric',
                })}
              </Text>
            ) : null}
          </View>
        </View>
        <ScrollView
          contentContainerStyle={styles.readerBody}
          showsVerticalScrollIndicator={false}
        >
          {/* Prefer the structured sections array (new writes). Fall
              back to the legacy `content` blob when sections is empty
              — that covers rows saved before the sections migration. */}
          {Array.isArray(open.sections) && open.sections.length > 0 ? (
            open.sections.map((s) => (
              <View key={s.key} style={styles.readerSection}>
                <Text style={styles.readerSectionTitle}>{s.title}</Text>
                {(s.content || '').trim() ? (
                  <HtmlRenderer html={s.content} />
                ) : (
                  <Text style={styles.readerSectionEmpty}>— not provided</Text>
                )}
              </View>
            ))
          ) : (open.content || '').trim() ? (
            <HtmlRenderer html={open.content} />
          ) : (
            <Text style={styles.readerText}>This policy has no content yet.</Text>
          )}
        </ScrollView>
      </View>
    );
  }

  // ── Landing view — two shelves of tiles ──────────────────────────
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.iconBtn}
          hitSlop={8}
        >
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{headerTitle}</Text>
          <Text style={styles.subtitle}>{headerSubtitle}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={palette.purple.vivid} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={palette.purple.vivid}
            />
          }
        >
          {/* Platform shelf — always visible. When platformOnly=true
              this is the only shelf on the screen, which is exactly
              what the institution admin's "Platform Information" tile
              wants. */}
          <ShelfHeader
            icon={ShieldCheck}
            title={platformOnly ? 'Read-only · Managed by Veerify' : 'Platform policies'}
            subtitle={
              platformOnly
                ? 'These policies apply platform-wide. Updates by Veerify appear here automatically.'
                : 'Managed by Veerify — applies to every academy.'
            }
          />
          {platform.length === 0 ? (
            <EmptyRow text="No platform policies have been published yet." />
          ) : (
            <View style={styles.tileList}>
              {platform.map((p) => (
                <Tile key={`platform-${p.slug}`} page={p} onPress={() => setOpen(p)} />
              ))}
            </View>
          )}

          {/* Institution shelf — hidden when the caller requested a
              platform-only view (e.g. institution admin's "Platform
              Information"). Everyone else still sees both shelves. */}
          {!platformOnly && (
          <>
          <ShelfHeader
            icon={Building2}
            title="Academy policies"
            subtitle={
              selectedInstitution?.name
                ? `Managed by ${selectedInstitution.name}`
                : 'Managed by your academy'
            }
          />
          {institution.length === 0 ? (
            <EmptyRow text="Your academy hasn't published these policies yet." />
          ) : (
            <View style={styles.tileList}>
              {institution.map((p) => (
                <Tile key={`inst-${p.slug}`} page={p} onPress={() => setOpen(p)} />
              ))}
            </View>
          )}
          </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ── Sub-components ───────────────────────────────────────────────────
function ShelfHeader({ icon: Icon, title, subtitle }) {
  return (
    <View style={styles.shelfHeader}>
      <View style={styles.shelfIcon}>
        <Icon size={14} color={palette.purple.vivid} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.shelfTitle}>{title}</Text>
        {subtitle ? <Text style={styles.shelfSub}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

function Tile({ page, onPress }) {
  return (
    <TouchableOpacity style={styles.tile} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.tileIcon}>
        <FileText size={14} color={palette.purple.vivid} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.tileTitle} numberOfLines={1}>{labelFor(page)}</Text>
        {page.updated_at ? (
          <Text style={styles.tileSub}>
            Updated {new Date(page.updated_at).toLocaleDateString('en-IN', {
              day: '2-digit', month: 'short', year: 'numeric',
            })}
          </Text>
        ) : null}
      </View>
      <ChevronRight size={16} color={palette.textMuted} strokeWidth={2.4} />
    </TouchableOpacity>
  );
}

function EmptyRow({ text }) {
  return (
    <View style={styles.emptyRow}>
      <Text style={styles.emptyRowText}>{text}</Text>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
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
  title: { ...type.h1, color: palette.text, fontSize: 20 },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 2 },

  shelfHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: 6,
  },
  shelfIcon: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  shelfTitle: {
    ...type.h2, color: palette.text, fontSize: 14, fontWeight: '800',
  },
  shelfSub: { ...type.caption, color: palette.textMuted, marginTop: 1 },

  tileList: {
    marginHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    overflow: 'hidden',
    ...shadows.card,
  },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  tileIcon: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  tileTitle: { ...type.bodyBold, color: palette.text, fontSize: 14 },
  tileSub: { ...type.caption, color: palette.textMuted, marginTop: 2 },

  emptyRow: {
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    ...shadows.card,
  },
  emptyRowText: {
    ...type.caption,
    color: palette.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
  },

  readerBody: {
    padding: spacing.lg,
    paddingBottom: 40,
  },
  readerText: {
    ...type.body,
    color: palette.text,
    lineHeight: 22,
  },
  readerSection: {
    marginBottom: spacing.lg,
  },
  readerSectionTitle: {
    ...type.h2,
    color: palette.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  readerSectionEmpty: {
    ...type.caption,
    color: palette.textLight,
    fontStyle: 'italic',
  },
});

// src/screens/admin/InstitutionLegalScreen.js
//
// Institution admin's per-academy policy editor. Reached from the
// admin's More tab tiles: About Academy, Academy Rules, Attendance
// Policy, Belt Test Policy.
//
// The page is a STRUCTURED document — one section per outline entry
// (see legalSectionSchemas.js). Each section has:
//   • fixed title (from the outline)
//   • plain-text content input that supports lightweight formatting
//     via inline HTML the admin types directly (bold: <b>x</b>, list:
//     <ul><li>x</li></ul>). Rich-text-on-mobile without pulling in a
//     WebView-based editor was a deliberate trade-off — the web admin
//     ships a full rich-text editor for platform pages, and institution
//     admins mostly paste short paragraphs / bullet lists here.
//
// Behavior:
//   • Load /api/legal-pages/institution → find the requested slug.
//   • Merge saved sections with the canonical outline (new outline
//     entries appear with empty content; unknown saved keys drop).
//   • Preview toggle flips to a read-only render using HtmlRenderer.
//   • Save Draft persists is_published=false.
//   • Publish persists is_published=true — visible to students/trainers.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import {
  ArrowLeft, Save, CheckCircle2, Eye, EyeOff, PenLine, FileText,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import HtmlRenderer from '../../components/HtmlRenderer';
import {
  sectionsForSlug, mergeSectionsWithSchema,
} from '../../utils/legalSectionSchemas';
import { palette, spacing, radius, shadows, type } from '../../theme';
import { confirm } from '../../components/ConfirmDialog';

const SLUG_LABEL = {
  about_academy:      'About Academy',
  academy_rules:      'Academy Rules',
  attendance_policy:  'Attendance Policy',
  belt_test_policy:   'Belt Test Policy',
};
const SLUG_HINT = {
  about_academy:
    "A one-paragraph introduction to your academy — history, philosophy, what makes you different.",
  academy_rules:
    "Ground rules students agree to before joining — dress code, punctuality, respect protocols.",
  attendance_policy:
    "How you handle absences, make-up classes, and leave requests.",
  belt_test_policy:
    "What a student needs to demonstrate to test for the next belt — attendance minimums, curriculum coverage, retest rules.",
};

export default function InstitutionLegalScreen({ route, navigation }) {
  const slug = route?.params?.slug;
  const outline = sectionsForSlug(slug);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState('edit'); // 'edit' | 'preview'
  const [title, setTitle] = useState(SLUG_LABEL[slug] || slug || '');
  const [sections, setSections] = useState([]);
  const [isPublished, setIsPublished] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get('/legal-pages/institution');
      const page = (r.data?.pages || []).find((p) => p.slug === slug);
      setTitle(page?.title || SLUG_LABEL[slug] || slug);
      setSections(mergeSectionsWithSchema(outline, page?.sections));
      setIsPublished(!!page?.is_published);
      setSavedAt(page?.updated_at || null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('[InstitutionLegal] load error:', err?.message);
      // Still show the outline so the admin can start typing offline.
      setSections(mergeSectionsWithSchema(outline, []));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);
  useEffect(() => { load(); }, [load]);

  const updateSectionContent = (key, content) => {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, content } : s)));
  };

  const save = async (publish) => {
    if (!slug) return;
    setSaving(true);
    try {
      // Legacy fallback — build a flat blob so any older reader hitting
      // the `content` field still gets meaningful text.
      const flatContent = sections
        .map((s) => `<h2>${escapeHtml(s.title)}</h2>${s.content || ''}`)
        .join('\n');
      const r = await apiClient.post('/legal-pages/institution', {
        slug,
        title:        (title || SLUG_LABEL[slug] || slug).trim(),
        content:      flatContent,
        sections,
        is_published: publish,
      });
      setSavedAt(r.data?.page?.updated_at || new Date().toISOString());
      setIsPublished(publish);
      confirm({
        title: publish ? 'Published' : 'Draft saved',
        message: publish
          ? `${SLUG_LABEL[slug] || 'Policy'} is now visible to your students and trainers.`
          : "Saved as a draft. Tap Publish when you're ready to share it.",
        variant: 'success',
        confirmText: 'Done',
        hideCancel: true,
      });
    } catch (err) {
      confirm({
        title: 'Save failed',
        message: err?.response?.data?.message || 'Could not save. Please try again.',
        variant: 'warning',
        confirmText: 'OK',
        hideCancel: true,
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={palette.purple.vivid} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.iconBtn}
          hitSlop={8}
        >
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{SLUG_LABEL[slug] || 'Policy'}</Text>
          <View style={styles.statusRow}>
            {isPublished ? (
              <View style={[styles.statusPill, styles.statusPillPublished]}>
                <Eye size={10} color={palette.green.on} strokeWidth={2.4} />
                <Text style={[styles.statusPillText, { color: palette.green.on }]}>PUBLISHED</Text>
              </View>
            ) : (
              <View style={[styles.statusPill, styles.statusPillDraft]}>
                <EyeOff size={10} color={palette.textMuted} strokeWidth={2.4} />
                <Text style={[styles.statusPillText, { color: palette.textMuted }]}>DRAFT</Text>
              </View>
            )}
            {savedAt ? (
              <Text style={styles.savedAt}>
                {new Date(savedAt).toLocaleDateString('en-IN', {
                  day: '2-digit', month: 'short', year: 'numeric',
                })}
              </Text>
            ) : null}
          </View>
        </View>
      </View>

      {/* Mode toggle + save */}
      <View style={styles.modeBar}>
        <View style={styles.modeToggle}>
          <ModePill
            active={mode === 'edit'}
            onPress={() => setMode('edit')}
            icon={PenLine}
            label="Edit"
          />
          <ModePill
            active={mode === 'preview'}
            onPress={() => setMode('preview')}
            icon={Eye}
            label="Preview"
          />
        </View>
        <TouchableOpacity
          onPress={() => save(false)}
          disabled={saving}
          style={[styles.actionBtn, styles.actionGhost]}
          activeOpacity={0.85}
        >
          <Save size={12} color={palette.text} strokeWidth={2.4} />
          <Text style={styles.actionGhostText}>Draft</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => save(true)}
          disabled={saving}
          style={[styles.actionBtn, styles.actionPrimary, saving && { opacity: 0.6 }]}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <CheckCircle2 size={12} color="#fff" strokeWidth={2.4} />
              <Text style={styles.actionPrimaryText}>
                {isPublished ? 'Republish' : 'Publish'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {mode === 'edit' ? (
          <>
            {SLUG_HINT[slug] ? (
              <View style={styles.hintCard}>
                <FileText size={13} color={palette.purple.vivid} strokeWidth={2.4} />
                <Text style={styles.hintText}>{SLUG_HINT[slug]}</Text>
              </View>
            ) : null}

            <Text style={styles.label}>Display Title</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder={SLUG_LABEL[slug] || 'Title'}
              placeholderTextColor={palette.textLight}
              maxLength={200}
            />

            {sections.map((s, i) => (
              <View key={s.key} style={{ marginTop: spacing.md }}>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionLabel}>
                    Section {i + 1} · {s.title}
                  </Text>
                  {(s.content || '').trim() ? (
                    <View style={styles.writtenPill}>
                      <Text style={styles.writtenPillText}>WRITTEN</Text>
                    </View>
                  ) : (
                    <View style={styles.emptyPill}>
                      <Text style={styles.emptyPillText}>EMPTY</Text>
                    </View>
                  )}
                </View>
                <TextInput
                  style={[styles.input, styles.textarea]}
                  value={s.content}
                  onChangeText={(v) => updateSectionContent(s.key, v)}
                  placeholder={`Write the ${s.title} content. Line breaks preserved. Use <b>text</b> for bold, <i>italic</i>, <ul><li>bullet</li></ul>.`}
                  placeholderTextColor={palette.textLight}
                  multiline
                  textAlignVertical="top"
                />
              </View>
            ))}

            <View style={{ height: 40 }} />
          </>
        ) : (
          <PreviewPane title={title} sections={sections} />
        )}
      </ScrollView>
    </View>
  );
}

// ── Read-only preview — mirrors the student / trainer render ────────
function PreviewPane({ title, sections }) {
  const hasContent = sections.some((s) => (s.content || '').trim());
  return (
    <View style={styles.previewCard}>
      <Text style={styles.previewTitle}>{title}</Text>
      <View style={styles.previewDivider} />
      {!hasContent ? (
        <Text style={styles.previewEmpty}>
          Nothing written yet. Switch back to Edit to add content.
        </Text>
      ) : (
        sections.map((s) => (
          <View key={s.key} style={styles.previewSection}>
            <Text style={styles.previewSectionTitle}>{s.title}</Text>
            {(s.content || '').trim() ? (
              <HtmlRenderer html={s.content} />
            ) : (
              <Text style={styles.previewSectionEmpty}>— empty</Text>
            )}
          </View>
        ))
      )}
    </View>
  );
}

// ── Small bits ───────────────────────────────────────────────────────
function ModePill({ active, onPress, icon: Icon, label }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.modePill, active && styles.modePillActive]}
      activeOpacity={0.85}
    >
      <Icon size={11} color={active ? '#fff' : palette.text} strokeWidth={2.4} />
      <Text style={[styles.modePillText, active && { color: '#fff' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.sm,
    backgroundColor: palette.surface,
    ...shadows.card,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },
  title: { ...type.h1, color: palette.text, fontSize: 18 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 999,
  },
  statusPillPublished: { backgroundColor: palette.green.soft },
  statusPillDraft:     { backgroundColor: palette.borderSoft },
  statusPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
  savedAt: { ...type.caption, color: palette.textMuted },

  modeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
  },
  modeToggle: {
    flexDirection: 'row',
    borderRadius: 999,
    backgroundColor: palette.borderSoft,
    padding: 3,
    marginRight: 'auto',
  },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999,
  },
  modePillActive: { backgroundColor: palette.purple.vivid },
  modePillText: { fontSize: 11, fontWeight: '700', color: palette.text },

  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11, paddingVertical: 8,
    borderRadius: 999,
  },
  actionGhost: {
    backgroundColor: palette.borderSoft,
  },
  actionGhostText: { fontSize: 11, fontWeight: '800', color: palette.text },
  actionPrimary: { backgroundColor: palette.purple.vivid },
  actionPrimaryText: { color: '#fff', fontSize: 11, fontWeight: '800' },

  body: { padding: spacing.lg, paddingBottom: 40 },

  hintCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: palette.purple.soft,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  hintText: {
    flex: 1,
    ...type.caption,
    color: palette.purple.on,
    lineHeight: 18,
  },

  label: {
    ...type.micro,
    color: palette.textMuted,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  input: {
    backgroundColor: palette.surface,
    borderRadius: 10,
    borderWidth: 1, borderColor: palette.borderSoft,
    paddingHorizontal: 12, paddingVertical: 11,
    fontSize: 14, color: palette.text,
  },
  textarea: {
    minHeight: 130,
    paddingTop: 11,
    lineHeight: 20,
  },

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sectionLabel: {
    ...type.micro,
    color: palette.textMuted,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  writtenPill: {
    backgroundColor: palette.green.soft,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 999,
  },
  writtenPillText: {
    fontSize: 9, fontWeight: '800', color: palette.green.on, letterSpacing: 0.4,
  },
  emptyPill: {
    backgroundColor: palette.borderSoft,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 999,
  },
  emptyPillText: {
    fontSize: 9, fontWeight: '800', color: palette.textMuted, letterSpacing: 0.4,
  },

  // Preview
  previewCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  previewTitle: {
    ...type.h1,
    color: palette.text,
    fontSize: 20,
    fontWeight: '900',
  },
  previewDivider: {
    height: 1,
    backgroundColor: palette.borderSoft,
    marginVertical: spacing.md,
  },
  previewSection: {
    marginBottom: spacing.md,
  },
  previewSectionTitle: {
    ...type.bodyBold,
    color: palette.text,
    fontSize: 15,
    marginBottom: 6,
  },
  previewSectionEmpty: {
    ...type.caption,
    color: palette.textLight,
    fontStyle: 'italic',
  },
  previewEmpty: {
    ...type.body,
    color: palette.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
});

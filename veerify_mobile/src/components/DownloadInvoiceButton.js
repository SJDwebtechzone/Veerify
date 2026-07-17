// src/components/DownloadInvoiceButton.js
//
// Reusable "Download Invoice" chip. Handles the whole flow:
//   1. Fetches the invoice metadata via kind + id.
//   2. Builds the auth-gated PDF URL (with the caller's JWT so the
//      backend's ownership check succeeds).
//   3. Opens it in the OS browser via Linking.openURL — this triggers
//      the native download prompt on both Android and iOS.
//
// Props:
//   kind       — 'enrollment' | 'subscription'
//   refId      — enrollment_id when kind='enrollment',
//                institution_id when kind='subscription'
//   label      — optional override (defaults to "Download Invoice")
//   compact    — optional smaller pill style
//
// The button renders a subtle inline loading state during the initial
// metadata fetch and disables itself if the backend responds with 404
// (no invoice yet — payment either wasn't via the platform or the
// webhook hasn't landed).

import React, { useState } from 'react';
import { TouchableOpacity, Text, ActivityIndicator, Linking, Alert, StyleSheet } from 'react-native';
import { Download } from 'lucide-react-native';

import apiClient from '../api/client';
import { getToken } from '../utils/storage';
import { palette, spacing, type } from '../theme';

export default function DownloadInvoiceButton({
  kind, refId, label = 'Download Invoice', compact = false,
}) {
  const [busy, setBusy] = useState(false);

  const download = async () => {
    if (!refId || busy) return;
    setBusy(true);
    try {
      // Fetch the invoice metadata first — this returns 404 when no
      // invoice exists yet (offline sale not marked, webhook not
      // received, etc.) so we can surface a friendly message.
      const url = kind === 'enrollment'
        ? `/invoices/enrollment/${refId}`
        : `/invoices/subscription/${refId}`;
      const res = await apiClient.get(url);
      const invoice = res.data?.invoice;
      if (!invoice?.id) throw new Error('No invoice found');

      // Build the auth-gated PDF URL. The backend enforces the JWT
      // check on this route; we can't just link to /uploads/... because
      // that would bypass ownership verification.
      const token = await getToken();
      const base = (apiClient.defaults.baseURL || '').replace(/\/api\/?$/, '');
      // Include the token as a query param so the browser's GET (which
      // won't send our Authorization header) still authenticates. The
      // backend already reads Bearer tokens from both header and query.
      const pdfUrl = `${base}/api/invoices/${invoice.id}/pdf?token=${encodeURIComponent(token)}`;
      const supported = await Linking.canOpenURL(pdfUrl);
      if (!supported) throw new Error('Cannot open PDF viewer');
      await Linking.openURL(pdfUrl);
    } catch (err) {
      const msg = err?.response?.status === 404
        ? 'Invoice will be available once the payment is confirmed.'
        : err?.response?.data?.message || err?.message || 'Could not download invoice.';
      Alert.alert('Invoice unavailable', msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchableOpacity
      onPress={download}
      disabled={busy}
      activeOpacity={0.85}
      style={[styles.btn, compact && styles.btnCompact, busy && { opacity: 0.65 }]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={palette.purple.vivid} />
      ) : (
        <Download size={compact ? 12 : 14} color={palette.purple.vivid} strokeWidth={2.4} />
      )}
      <Text style={[styles.text, compact && styles.textCompact]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.purple.vivid,
    backgroundColor: palette.purple.soft,
    alignSelf: 'flex-start',
  },
  btnCompact: { paddingHorizontal: spacing.sm, paddingVertical: 6 },
  text: { ...type.bodyBold, color: palette.purple.on, fontSize: 12 },
  textCompact: { fontSize: 11 },
});

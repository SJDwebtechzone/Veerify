import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import apiClient from '../../api/client';
import { colors } from '../../utils/styles';
import { confirm } from '../../components/ConfirmDialog';

export default function PendingApprovalScreen({ navigation }) {
  const { logout } = useAuth();
  const [status, setStatus] = useState('pending_approval');
  const [rejectionReason, setRejectionReason] = useState('');

  // Poll status every 10 seconds
  useFocusEffect(
    useCallback(() => {
      const checkStatus = async () => {
        try {
          const res = await apiClient.get('/onboarding/my-status');
          const newStatus = res.data.status;
          setStatus(newStatus);
          setRejectionReason(res.data.rejection_reason || '');

          if (newStatus === 'approved') {
            navigation.replace('PaymentScreen');
          } else if (newStatus === 'active') {
            navigation.replace('AdminDashboard');
          }
        } catch (err) {
          console.log('Status check error:', err.message);
        }
      };

      checkStatus();
      const interval = setInterval(checkStatus, 10000);
      return () => clearInterval(interval);
    }, [])
  );

  const handleLogout = () => {
    confirm({
      title: 'Log out?',
      message: 'You can sign back in any time to check your approval status.',
      variant: 'destructive',
      confirmText: 'Log out',
      cancelText: 'Stay signed in',
      onConfirm: () => {
        // eslint-disable-next-line no-console
        console.log('[PendingApproval] Logout confirmed');
        try {
          const result = logout && logout();
          if (result && typeof result.catch === 'function') {
            result.catch((e) =>
              // eslint-disable-next-line no-console
              console.warn('[PendingApproval] logout error', e?.message),
            );
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[PendingApproval] logout threw', e?.message);
        }
      },
    });
  };

  if (status === 'rejected') {
    return (
      <View style={styles.screen}>
        <View style={styles.card}>
          <Text style={styles.rejectedEmoji}>❌</Text>
          <Text style={styles.rejectedTitle}>Application Rejected</Text>
          <Text style={styles.rejectedSubtitle}>
            Unfortunately, your academy application was not approved.
          </Text>

          {rejectionReason ? (
            <View style={styles.reasonBox}>
              <Text style={styles.reasonLabel}>Reason:</Text>
              <Text style={styles.reasonText}>{rejectionReason}</Text>
            </View>
          ) : null}

          <Text style={styles.resubmitHint}>
            Please fix the issues and resubmit your application.
          </Text>

          <TouchableOpacity
            style={styles.resubmitButton}
            onPress={() => navigation.replace('SetupInstitution')}
          >
            <Text style={styles.resubmitButtonText}>Resubmit Application</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={handleLogout} style={{ marginTop: 16 }}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.emoji}>⏳</Text>
       <Text style={styles.title}>Request Submitted! 🎉</Text>
<Text style={styles.subtitle}>
  Your academy details have been sent to our admin team for review.
</Text>
{/* Submitted banner */}
<View style={styles.submittedBanner}>
  <Text style={styles.submittedText}>
    "Your request is submitted.{'\n'}We'll get back to you soon! 🙏"
  </Text>
</View>
<View style={styles.infoBox}>
  <Text style={styles.infoTitle}>What happens next?</Text>
  <View style={styles.stepRow}>
    <View style={[styles.stepDot, { backgroundColor: colors.success }]} />
    <Text style={styles.stepText}>✅ Your request has been submitted</Text>
  </View>
  <View style={styles.stepRow}>
    <View style={[styles.stepDot, { backgroundColor: colors.warning }]} />
    <Text style={styles.stepText}>⏳ Admin review (24-48 hours)</Text>
  </View>
  <View style={styles.stepRow}>
    <View style={[styles.stepDot, { backgroundColor: colors.lightGray }]} />
    <Text style={[styles.stepText, { color: colors.textLight }]}>
      📧 You'll be notified once approved
    </Text>
  </View>
  <View style={styles.stepRow}>
    <View style={[styles.stepDot, { backgroundColor: colors.lightGray }]} />
    <Text style={[styles.stepText, { color: colors.textLight }]}>
      💳 Complete payment to go live
    </Text>
  </View>
</View>


        <View style={styles.contactBox}>
          <Text style={styles.contactText}>
            Have questions? Email us at{'\n'}
            <Text style={styles.contactEmail}>support@veerify.com</Text>
          </Text>
        </View>

        {/* Edit details — admin can still tweak the submitted form
            until the super admin approves it. Tapping reopens the
            5-step wizard with the previously-submitted values prefilled. */}
        <TouchableOpacity
          style={styles.editButton}
          onPress={() => navigation.replace('SetupInstitution')}
          activeOpacity={0.85}
        >
          <Text style={styles.editButtonText}>Edit my details</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleLogout} style={{ marginTop: 16 }}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>
      
    </View>
    
  );
  
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f4f4f8',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.lightGray,
  },

  emoji: { fontSize: 56, marginBottom: 16 },
  title: {
    fontSize: 22, fontWeight: '700',
    color: colors.dark, marginBottom: 8
  },
  subtitle: {
    fontSize: 14, color: colors.textLight,
    textAlign: 'center', lineHeight: 20, marginBottom: 24
  },

  infoBox: {
    backgroundColor: '#f4f4f8',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    marginBottom: 20,
    gap: 12,
  },
  infoTitle: {
    fontSize: 13, fontWeight: '600',
    color: colors.dark, marginBottom: 8
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepDot: { width: 8, height: 8, borderRadius: 4 },
  stepText: { fontSize: 13, color: colors.text },

  contactBox: {
    backgroundColor: '#e6f1fb',
    borderRadius: 10,
    padding: 14,
    width: '100%',
    alignItems: 'center',
  },
  contactText: {
    fontSize: 13, color: '#185fa5',
    textAlign: 'center', lineHeight: 20
  },
  contactEmail: { fontWeight: '700' },

  logoutText: { fontSize: 14, color: colors.danger },

  // "Edit my details" CTA on the pending screen — visible while the
  // institution is still waiting on super-admin approval.
  editButton: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    width: '100%',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  editButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },

  // Rejected styles
  rejectedEmoji: { fontSize: 56, marginBottom: 16 },
  rejectedTitle: {
    fontSize: 22, fontWeight: '700',
    color: colors.danger, marginBottom: 8
  },
  rejectedSubtitle: {
    fontSize: 14, color: colors.textLight,
    textAlign: 'center', marginBottom: 16
  },
  reasonBox: {
    backgroundColor: '#fff5f5',
    borderRadius: 10,
    padding: 14,
    width: '100%',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  reasonLabel: {
    fontSize: 12, fontWeight: '700',
    color: colors.danger, marginBottom: 4
  },
  reasonText: { fontSize: 13, color: colors.text },
  resubmitHint: {
    fontSize: 12, color: colors.textLight,
    textAlign: 'center', marginBottom: 20
  },
  resubmitButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14, paddingHorizontal: 32,
    borderRadius: 12, width: '100%', alignItems: 'center'
  },
  resubmitButtonText: {
    color: colors.white, fontSize: 15, fontWeight: '700'
  },
  submittedBanner: {
  backgroundColor: colors.dark,
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
  alignItems: 'center',
},
submittedText: {
  color: colors.white,
  fontSize: 15,
  fontWeight: '600',
  textAlign: 'center',
  lineHeight: 24,
  fontStyle: 'italic',
},
});
import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import apiClient from '../../api/client';
import { colors, commonStyles } from '../../utils/styles';
import { confirm } from '../../components/ConfirmDialog';
import { formatBatchTime } from '../../utils/formatTime';

export default function MyEnrollmentsScreen() {
  const navigation = useNavigation();
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/enrollments/my');
      setEnrollments(res.data.enrollments);
    } catch (err) { console.log(err.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Pay Now — hands the enrolment off to EnrollmentPaymentScreen,
  // which opens Razorpay and polls the backend for the webhook. We
  // NEVER touch payment_status here; the old client-side PATCH to
  // /enrollments/:id/payment has been removed because it flipped the
  // row to paid without any real charge going through.
  const handlePay = (enrollment) => {
    // Build the payload EnrollmentPaymentScreen expects. It reads
    // enrollment.id + enrollment.payment_amount, batch.course_name +
    // batch.course_price for the summary, and course.name for the
    // success screen copy.
    const payload = {
      enrollment: {
        id:             enrollment.id,
        payment_amount: enrollment.payment_amount ?? enrollment.course_price,
      },
      batch: {
        id:              enrollment.batch_id,
        name:            enrollment.batch_name,
        course_id:       enrollment.course_id,
        course_name:     enrollment.course_name,
        course_price:    enrollment.course_price,
        institution_name:enrollment.institution_name,
        days_of_week:    enrollment.days_of_week,
        start_time:      enrollment.start_time,
        end_time:        enrollment.end_time,
      },
      course: {
        id:               enrollment.course_id,
        name:             enrollment.course_name,
        price:            enrollment.course_price,
        institution_name: enrollment.institution_name,
      },
      amount: enrollment.payment_amount ?? enrollment.course_price,
    };

    // Belt-and-braces guard: if we somehow don't know the price we
    // stop instead of routing into a payment screen with amount 0
    // (which the payment screen would reject anyway).
    if (!payload.amount || Number(payload.amount) <= 0) {
      confirm({
        title:       'No amount to pay',
        message:     'This enrolment has no price set. Please contact your academy.',
        variant:     'warning',
        confirmText: 'Got it',
        hideCancel:  true,
      });
      return;
    }

    try {
      navigation.navigate('EnrollmentPayment', payload);
    } catch (err) {
      // Fallback for nested navigators — try the parent stack.
      try {
        navigation.getParent()?.navigate('EnrollmentPayment', payload);
      } catch (_) {
        confirm({
          title:       'Could not open payment',
          message:     'Please open this enrolment from Home and tap Pay Now again.',
          variant:     'warning',
          confirmText: 'Got it',
          hideCancel:  true,
        });
      }
    }
  };

  const handleCancel = (enrollment) => {
    Alert.alert(
      'Cancel Enrollment',
      `Cancel your enrollment in "${enrollment.batch_name}"?`,
      [
        { text: 'Keep Enrollment', style: 'cancel' },
        {
          text: 'Cancel Enrollment', style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.delete(`/enrollments/${enrollment.id}`);
              load();
            } catch (err) {
              Alert.alert('Error', err.response?.data?.message || 'Failed');
            }
          }
        }
      ]
    );
  };

  if (loading) return <View style={[commonStyles.screen, { justifyContent: 'center' }]}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <View style={commonStyles.screen}>
      <View style={commonStyles.header}>
        <Text style={commonStyles.headerTitle}>My Enrollments</Text>
        <Text style={commonStyles.headerSubtitle}>{enrollments.length} active</Text>
      </View>

      <FlatList
        data={enrollments}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={{ padding: 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListEmptyComponent={
          <View style={commonStyles.emptyState}>
            <Text style={{ fontSize: 60 }}>📚</Text>
            <Text style={commonStyles.emptyText}>No enrollments yet.{'\n'}Browse academies and enroll in a course.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={commonStyles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={commonStyles.cardTitle}>{item.course_name}</Text>
                <Text style={{ fontSize: 13, color: colors.primary, marginTop: 2 }}>{item.batch_name}</Text>
                <Text style={{ fontSize: 12, color: colors.textLight, marginTop: 6 }}>🏫 {item.institution_name}</Text>
                <Text style={{ fontSize: 12, color: colors.textLight, marginTop: 2 }}>👨‍🏫 {item.trainer_name || 'TBA'}</Text>
                <Text style={{ fontSize: 12, color: colors.textLight, marginTop: 2 }}>📆 {item.days_of_week} • {formatBatchTime(item.start_time)}</Text>
              </View>
              <View style={{ 
                paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
                backgroundColor: item.payment_status === 'paid' ? colors.success : colors.warning 
              }}>
                <Text style={{ color: colors.white, fontSize: 11, fontWeight: '600', textTransform: 'uppercase' }}>
                  {item.payment_status}
                </Text>
              </View>
            </View>

            <Text style={{ fontSize: 16, fontWeight: 'bold', color: colors.primary, marginTop: 10 }}>
              ₹{item.course_price}
            </Text>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              {item.payment_status !== 'paid' && (
                <TouchableOpacity 
                  style={{ flex: 1, backgroundColor: colors.success, padding: 10, borderRadius: 8, alignItems: 'center' }}
                  onPress={() => handlePay(item)}
                >
                  <Text style={{ color: colors.white, fontWeight: '600' }}>Pay Now</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity 
                style={{ flex: 1, padding: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.danger }}
                onPress={() => handleCancel(item)}
              >
                <Text style={{ color: colors.danger, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    </View>
  );
}
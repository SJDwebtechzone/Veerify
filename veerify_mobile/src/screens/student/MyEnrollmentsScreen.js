import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import apiClient from '../../api/client';
import { colors, commonStyles } from '../../utils/styles';

export default function MyEnrollmentsScreen() {
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

  const handlePay = (enrollment) => {
    Alert.alert(
      'Confirm Payment',
      `Pay ₹${enrollment.course_price} for "${enrollment.course_name}"?\n\n(Demo: this simulates a successful payment)`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Pay Now',
          onPress: async () => {
            try {
              await apiClient.patch(`/enrollments/${enrollment.id}/payment`);
              Alert.alert('Payment Successful! 🎉', 'Your enrollment is now confirmed.');
              load();
            } catch (err) {
              Alert.alert('Error', err.response?.data?.message || 'Payment failed');
            }
          }
        }
      ]
    );
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
                <Text style={{ fontSize: 12, color: colors.textLight, marginTop: 2 }}>📆 {item.days_of_week} • {item.start_time?.slice(0,5)}</Text>
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
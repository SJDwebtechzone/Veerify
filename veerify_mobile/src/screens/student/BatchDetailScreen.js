import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import apiClient from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { colors, commonStyles } from '../../utils/styles';

export default function BatchDetailScreen({ route, navigation }) {
  const { batchId } = route.params;
  const { user } = useAuth();
  const [batch, setBatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get(`/batches/${batchId}`);
        setBatch(res.data.batch);
      } catch (err) { console.log(err.message); }
      finally { setLoading(false); }
    })();
  }, [batchId]);

  const handleEnroll = () => {
    if (!user) {
      Alert.alert('Login Required', 'Please log in or create an account to enroll', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => navigation.replace('Login') }
      ]);
      return;
    }
    // Open the 14-field enrollment form. On submit it posts to /enrollments
    // and replaces itself with the payment screen.
    navigation.navigate('EnrollmentForm', {
      batch,
      course: {
        id: batch.course_id,
        name: batch.course_name,
        price: batch.course_price,
        institution_name: batch.institution_name,
      },
    });
  };

  if (loading) return <View style={[commonStyles.screen, { justifyContent: 'center' }]}><ActivityIndicator size="large" color={colors.primary} /></View>;
  if (!batch) return <View style={[commonStyles.screen, { padding: 24 }]}><Text>Not found</Text></View>;

  const isFull = parseInt(batch.enrolled_count) >= batch.capacity;

  return (
    <View style={commonStyles.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        <View style={commonStyles.header}>
          <Text style={commonStyles.headerTitle}>{batch.name}</Text>
          <Text style={commonStyles.headerSubtitle}>{batch.course_name}</Text>
        </View>

        <View style={{ padding: 20 }}>
          <View style={{ backgroundColor: colors.light, padding: 16, borderRadius: 12, marginBottom: 20 }}>
            <Text style={{ fontSize: 28, fontWeight: 'bold', color: colors.primary, textAlign: 'center' }}>₹{batch.course_price}</Text>
            <Text style={{ textAlign: 'center', color: colors.textLight, marginTop: 4 }}>Total Course Fee</Text>
          </View>

          <Text style={commonStyles.label}>Schedule</Text>
          <Text style={{ color: colors.text, marginBottom: 4 }}>📆 {batch.days_of_week || 'Not set'}</Text>
          <Text style={{ color: colors.text, marginBottom: 16 }}>⏰ {batch.start_time?.slice(0,5)} - {batch.end_time?.slice(0,5)}</Text>

          <Text style={commonStyles.label}>Trainer</Text>
          <Text style={{ color: colors.text, marginBottom: 16 }}>👨‍🏫 {batch.trainer_name || 'Not assigned'}</Text>

          <Text style={commonStyles.label}>Mode</Text>
          <Text style={{ color: colors.text, marginBottom: 16, textTransform: 'capitalize' }}>{batch.mode}</Text>

          <Text style={commonStyles.label}>Capacity</Text>
          <Text style={{ color: colors.text, marginBottom: 16 }}>
            👥 {batch.enrolled_count} / {batch.capacity} students enrolled
          </Text>

          <Text style={commonStyles.label}>Academy</Text>
          <Text style={{ color: colors.text }}>🏫 {batch.institution_name}</Text>
        </View>
      </ScrollView>

      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.lightGray }}>
        {isFull ? (
          <View style={[commonStyles.button, { backgroundColor: colors.gray }]}>
            <Text style={commonStyles.buttonText}>Batch is Full</Text>
          </View>
        ) : (
          <TouchableOpacity 
            style={[commonStyles.button, enrolling && commonStyles.buttonDisabled]}
            onPress={handleEnroll}
            disabled={enrolling}
          >
            {enrolling ? <ActivityIndicator color="#fff" /> : (
              <Text style={commonStyles.buttonText}>
                {user ? 'Enroll Now' : 'Sign Up to Enroll'}
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import apiClient from '../../api/client';
import { colors, commonStyles } from '../../utils/styles';

export default function BatchStudentsScreen({ route, navigation }) {
  const { batchId, batchName } = route.params;
  const [students, setStudents] = useState([]);
  const [attendance, setAttendance] = useState({});  // { studentId: 'present' | 'absent' | 'late' }
  const [date] = useState(new Date().toISOString().split('T')[0]);  // today's date
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get(`/enrollments/batch/${batchId}`);
      setStudents(res.data.enrollments);

      // Default everyone to 'present'
      const initial = {};
      res.data.enrollments.forEach(e => { initial[e.student_id] = 'present'; });
      setAttendance(initial);
    } catch (err) { console.log(err.message); }
    finally { setLoading(false); }
  }, [batchId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setStatus = (studentId, status) => {
    setAttendance(prev => ({ ...prev, [studentId]: status }));
  };

  const submit = async () => {
    setSaving(true);
    try {
      const records = Object.entries(attendance).map(([studentId, status]) => ({
        student_id: parseInt(studentId),
        status
      }));

      await apiClient.post('/attendance/bulk', {
        batch_id: batchId,
        date,
        records
      });

      Alert.alert('Saved! ✅', `Attendance marked for ${records.length} students on ${date}`, [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <View style={[commonStyles.screen, { justifyContent: 'center' }]}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <View style={commonStyles.screen}>
    <View style={commonStyles.header}>
  <Text style={commonStyles.headerTitle}>{batchName}</Text>
  <Text style={commonStyles.headerSubtitle}>📅 {date} • {students.length} students</Text>
  <TouchableOpacity 
    style={{ position: 'absolute', top: 60, right: 20 }}
    onPress={() => navigation.navigate('AttendanceHistory', { batchId, batchName })}
  >
    <Text style={{ color: colors.white, fontSize: 12, textDecorationLine: 'underline' }}>View History</Text>
  </TouchableOpacity>
</View>

      <FlatList
        data={students}
        keyExtractor={(item) => item.student_id.toString()}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        ListEmptyComponent={
          <View style={commonStyles.emptyState}>
            <Text style={commonStyles.emptyText}>No students enrolled yet</Text>
          </View>
        }
        renderItem={({ item }) => {
          const status = attendance[item.student_id] || 'present';
          return (
            <View style={commonStyles.card}>
              <Text style={commonStyles.cardTitle}>{item.student_name}</Text>
              <Text style={commonStyles.cardSubtitle}>{item.student_email}</Text>

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                {['present', 'absent', 'late'].map((s) => {
                  const isActive = status === s;
                  const bgColor = s === 'present' ? colors.success : s === 'absent' ? colors.danger : colors.warning;
                  return (
                    <TouchableOpacity
                      key={s}
                      style={{
                        flex: 1, padding: 10, borderRadius: 8, alignItems: 'center',
                        backgroundColor: isActive ? bgColor : colors.light,
                        borderWidth: 1, borderColor: isActive ? bgColor : colors.lightGray
                      }}
                      onPress={() => setStatus(item.student_id, s)}
                    >
                      <Text style={{ 
                        color: isActive ? colors.white : colors.text, 
                        fontWeight: '600', textTransform: 'capitalize', fontSize: 13
                      }}>
                        {s}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        }}
      />

      {students.length > 0 && (
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.lightGray }}>
          <TouchableOpacity 
            style={[commonStyles.button, saving && commonStyles.buttonDisabled, { marginTop: 0 }]}
            onPress={submit}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={commonStyles.buttonText}>Save Attendance</Text>}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
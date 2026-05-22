import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import apiClient from '../../api/client';
import { colors, commonStyles } from '../../utils/styles';

export default function CreateBatchScreen({ navigation }) {
  const [courses, setCourses] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [form, setForm] = useState({
    course_id: null, trainer_id: null, name: '', days_of_week: 'Mon,Wed,Fri',
    start_time: '06:00', end_time: '07:00', capacity: '20', mode: 'offline'
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [c, t] = await Promise.all([apiClient.get('/courses'), apiClient.get('/trainers')]);
        setCourses(c.data.courses);
        setTrainers(t.data.trainers);
      } catch (err) { console.log(err.message); }
    })();
  }, []);

  const update = (k, v) => setForm({ ...form, [k]: v });

  const submit = async () => {
    if (!form.course_id || !form.name) {
      Alert.alert('Required', 'Course and batch name are required');
      return;
    }
    setLoading(true);
    try {
      await apiClient.post('/batches', { ...form, capacity: parseInt(form.capacity) || 20 });
      Alert.alert('Success', 'Batch created!', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={{ padding: 24 }}>
      <Text style={commonStyles.title}>New Batch</Text>
      <Text style={commonStyles.subtitle}>Schedule a class under a course</Text>

      <Text style={commonStyles.label}>Course *</Text>
      {courses.length === 0 ? (
        <Text style={{ color: colors.danger, marginTop: 8 }}>⚠️ Create a course first</Text>
      ) : (
        <View style={{ gap: 8, marginTop: 8 }}>
          {courses.map((c) => (
            <TouchableOpacity 
              key={c.id} 
              style={[
                { padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.lightGray }, 
                form.course_id === c.id && { backgroundColor: colors.primary, borderColor: colors.primary }
              ]} 
              onPress={() => update('course_id', c.id)}
            >
              <Text style={form.course_id === c.id ? { color: colors.white, fontWeight: '600' } : { color: colors.text }}>
                {c.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Text style={commonStyles.label}>Trainer (optional)</Text>
      <View style={{ gap: 8, marginTop: 8 }}>
        <TouchableOpacity style={[{ padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.lightGray }, !form.trainer_id && { backgroundColor: colors.primary, borderColor: colors.primary }]} onPress={() => update('trainer_id', null)}>
          <Text style={!form.trainer_id ? { color: colors.white, fontWeight: '600' } : { color: colors.text }}>None</Text>
        </TouchableOpacity>
        {trainers.map((t) => (
          <TouchableOpacity 
            key={t.id} 
            style={[{ padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.lightGray }, form.trainer_id === t.id && { backgroundColor: colors.primary, borderColor: colors.primary }]} 
            onPress={() => update('trainer_id', t.id)}
          >
            <Text style={form.trainer_id === t.id ? { color: colors.white, fontWeight: '600' } : { color: colors.text }}>{t.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={commonStyles.label}>Batch Name *</Text>
      <TextInput style={commonStyles.input} value={form.name} onChangeText={(v) => update('name', v)} placeholder="e.g., Morning Batch A" placeholderTextColor={colors.gray} />

      <Text style={commonStyles.label}>Days (comma-separated)</Text>
      <TextInput style={commonStyles.input} value={form.days_of_week} onChangeText={(v) => update('days_of_week', v)} placeholder="Mon,Wed,Fri" placeholderTextColor={colors.gray} />

      <Text style={commonStyles.label}>Start Time (HH:MM)</Text>
      <TextInput style={commonStyles.input} value={form.start_time} onChangeText={(v) => update('start_time', v)} placeholder="06:00" placeholderTextColor={colors.gray} />

      <Text style={commonStyles.label}>End Time (HH:MM)</Text>
      <TextInput style={commonStyles.input} value={form.end_time} onChangeText={(v) => update('end_time', v)} placeholder="07:00" placeholderTextColor={colors.gray} />

      <Text style={commonStyles.label}>Capacity</Text>
      <TextInput style={commonStyles.input} value={form.capacity} onChangeText={(v) => update('capacity', v)} keyboardType="number-pad" />

      <Text style={commonStyles.label}>Mode</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        {['offline', 'online', 'hybrid'].map((m) => (
          <TouchableOpacity 
            key={m} 
            style={[{ flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.lightGray, alignItems: 'center' }, form.mode === m && { backgroundColor: colors.primary, borderColor: colors.primary }]} 
            onPress={() => update('mode', m)}
          >
            <Text style={form.mode === m ? { color: colors.white, fontWeight: '600' } : { color: colors.text }}>{m}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={[commonStyles.button, loading && commonStyles.buttonDisabled]} onPress={submit} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={commonStyles.buttonText}>Create Batch</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import apiClient from '../../api/client';
import { colors, commonStyles } from '../../utils/styles';

export default function CreateTrainerScreen({ navigation }) {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', password: '',
    specialization: '', belt_level: '', experience_years: '0', bio: ''
  });
  const [loading, setLoading] = useState(false);
  const update = (k, v) => setForm({ ...form, [k]: v });

  const submit = async () => {
    if (!form.name || !form.email || !form.password) {
      Alert.alert('Required', 'Name, email, and password are required');
      return;
    }
    setLoading(true);
    try {
      await apiClient.post('/trainers', { ...form, experience_years: parseInt(form.experience_years) || 0 });
      Alert.alert('Success', 'Trainer added! Share login details with them.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={{ padding: 24 }}>
      <Text style={commonStyles.title}>Add Trainer</Text>
      <Text style={commonStyles.subtitle}>Trainer will use email + password to log in</Text>

      <Text style={commonStyles.label}>Full Name *</Text>
      <TextInput style={commonStyles.input} value={form.name} onChangeText={(v) => update('name', v)} placeholder="Trainer's name" placeholderTextColor={colors.gray} />

      <Text style={commonStyles.label}>Email *</Text>
      <TextInput style={commonStyles.input} value={form.email} onChangeText={(v) => update('email', v)} placeholder="trainer@example.com" placeholderTextColor={colors.gray} keyboardType="email-address" autoCapitalize="none" />

      <Text style={commonStyles.label}>Phone</Text>
      <TextInput style={commonStyles.input} value={form.phone} onChangeText={(v) => update('phone', v)} placeholder="9876543210" placeholderTextColor={colors.gray} keyboardType="phone-pad" />

      <Text style={commonStyles.label}>Temporary Password *</Text>
      <TextInput style={commonStyles.input} value={form.password} onChangeText={(v) => update('password', v)} placeholder="At least 6 chars" placeholderTextColor={colors.gray} secureTextEntry />

      <Text style={commonStyles.label}>Specialization</Text>
      <TextInput style={commonStyles.input} value={form.specialization} onChangeText={(v) => update('specialization', v)} placeholder="e.g., Karate" placeholderTextColor={colors.gray} />

      <Text style={commonStyles.label}>Belt Level</Text>
      <TextInput style={commonStyles.input} value={form.belt_level} onChangeText={(v) => update('belt_level', v)} placeholder="e.g., Black Belt 3rd Dan" placeholderTextColor={colors.gray} />

      <Text style={commonStyles.label}>Experience (years)</Text>
      <TextInput style={commonStyles.input} value={form.experience_years} onChangeText={(v) => update('experience_years', v)} keyboardType="number-pad" />

      <Text style={commonStyles.label}>Bio</Text>
      <TextInput style={[commonStyles.input, commonStyles.textarea]} value={form.bio} onChangeText={(v) => update('bio', v)} placeholder="Brief background..." placeholderTextColor={colors.gray} multiline />

      <TouchableOpacity style={[commonStyles.button, loading && commonStyles.buttonDisabled]} onPress={submit} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={commonStyles.buttonText}>Add Trainer</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}
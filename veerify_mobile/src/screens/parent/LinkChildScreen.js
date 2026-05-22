import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView } from 'react-native';
import apiClient from '../../api/client';
import { colors, commonStyles } from '../../utils/styles';

export default function LinkChildScreen({ navigation }) {
  const [searchType, setSearchType] = useState('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLink = async () => {
    if (searchType === 'phone' && !phone) {
      Alert.alert('Required', 'Please enter the phone number');
      return;
    }
    if (searchType === 'email' && !email) {
      Alert.alert('Required', 'Please enter the email address');
      return;
    }

    setLoading(true);
    try {
      const body = searchType === 'phone' ? { phone } : { email };
      const res = await apiClient.post('/parents/link-child', body);
      
 Alert.alert(
        'Request Sent! 📨',
        `A link request has been sent to ${res.data.child.name}. They'll need to approve it in their app before you can see their data.\n\nAsk them to log in and approve your request.`,
        [{ text: 'Got it', onPress: () => navigation.goBack() }]
      );
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to link child');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 24 }}>
      <Text style={styles.title}>Link Your Child 👨‍👩‍👧</Text>
      <Text style={styles.subtitle}>
        Enter your child's registered phone number or email to link their account.
      </Text>

      {/* Search type toggle */}
      <Text style={styles.label}>Search by</Text>
      <View style={styles.toggleRow}>
        <TouchableOpacity 
          style={[styles.toggleBtn, searchType === 'phone' && styles.toggleBtnActive]}
          onPress={() => setSearchType('phone')}
        >
          <Text style={[styles.toggleText, searchType === 'phone' && styles.toggleTextActive]}>
            📱 Phone
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.toggleBtn, searchType === 'email' && styles.toggleBtnActive]}
          onPress={() => setSearchType('email')}
        >
          <Text style={[styles.toggleText, searchType === 'email' && styles.toggleTextActive]}>
            ✉️ Email
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search input */}
      <Text style={styles.label}>
        {searchType === 'phone' ? 'Phone Number' : 'Email Address'}
      </Text>
      {searchType === 'phone' ? (
        <View style={styles.inputWrapper}>
          <Text style={styles.inputIcon}>📱</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="9876543210"
            placeholderTextColor={colors.gray}
            keyboardType="phone-pad"
            maxLength={10}
          />
        </View>
      ) : (
        <View style={styles.inputWrapper}>
          <Text style={styles.inputIcon}>✉️</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="child@example.com"
            placeholderTextColor={colors.gray}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>
      )}

      {/* Info card */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>ℹ️ How it works</Text>
        <Text style={styles.infoText}>
          • Your child must already be registered as a Student{'\n'}
          • Use the phone or email they signed up with{'\n'}
          • Once linked, you can view their attendance, classes, and payments{'\n'}
          • You can link multiple children if you have more than one
        </Text>
      </View>

      <TouchableOpacity 
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleLink}
        disabled={loading}
        activeOpacity={0.85}
      >
        {loading ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.buttonText}>Link Child</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.textLight, marginBottom: 24, lineHeight: 20 },
  
  label: { fontSize: 13, color: colors.text, fontWeight: '600', marginTop: 16, marginBottom: 8 },

  toggleRow: { flexDirection: 'row', gap: 10 },
  toggleBtn: { 
    flex: 1, 
    padding: 14, 
    borderRadius: 12, 
    borderWidth: 1.5, 
    borderColor: colors.lightGray, 
    alignItems: 'center', 
    backgroundColor: colors.white 
  },
  toggleBtnActive: { backgroundColor: '#fff5f5', borderColor: colors.primary },
  toggleText: { color: colors.textLight, fontWeight: '600', fontSize: 14 },
  toggleTextActive: { color: colors.primary },

  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.light,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.lightGray,
  },
  inputIcon: { fontSize: 16, marginRight: 8 },
  input: { flex: 1, paddingVertical: 14, fontSize: 15, color: colors.text },

  infoCard: {
    backgroundColor: '#e6f1fb',
    borderRadius: 10,
    padding: 14,
    marginTop: 24,
  },
  infoTitle: { fontSize: 13, fontWeight: '600', color: '#185fa5', marginBottom: 8 },
  infoText: { fontSize: 12, color: '#185fa5', lineHeight: 18 },

  button: { 
    backgroundColor: colors.primary, 
    paddingVertical: 16, 
    borderRadius: 12, 
    alignItems: 'center', 
    marginTop: 24
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '700' },
});
import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Alert, TextInput } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import apiClient from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { colors, commonStyles } from '../../utils/styles';

export default function StudentDashboardScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [institutions, setInstitutions] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isGuest = !user;

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/institutions');
      setInstitutions(res.data.institutions);
      setFiltered(res.data.institutions);
    } catch (err) {
      console.log('Load institutions error:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onSearch = (text) => {
    setSearch(text);
    if (!text) { setFiltered(institutions); return; }
    const lower = text.toLowerCase();
    setFiltered(institutions.filter(i => 
      i.name.toLowerCase().includes(lower) || 
      (i.city && i.city.toLowerCase().includes(lower))
    ));
  };

  const confirmLogout = () => {
    Alert.alert('Logout', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', onPress: logout, style: 'destructive' }
    ]);
  };

  if (loading) {
    return <View style={[commonStyles.screen, { justifyContent: 'center' }]}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <View style={commonStyles.screen}>
      <View style={commonStyles.header}>
        <Text style={commonStyles.headerTitle}>
          {isGuest ? 'Browse Academies' : `Hi, ${user.name.split(' ')[0]}!`}
        </Text>
        <Text style={commonStyles.headerSubtitle}>
          {isGuest ? 'Sign up to enroll' : 'Find your perfect class'}
        </Text>
      </View>

      <View style={{ padding: 16, paddingBottom: 0 }}>
        <TextInput
          style={commonStyles.input}
          value={search}
          onChangeText={onSearch}
          placeholder="🔍 Search by academy or city..."
          placeholderTextColor={colors.gray}
        />
      </View>

      {!isGuest && (
        <View style={{ flexDirection: 'row', padding: 16, gap: 8 }}>
          <TouchableOpacity 
            style={{ flex: 1, backgroundColor: colors.primary, padding: 12, borderRadius: 8, alignItems: 'center' }}
            onPress={() => navigation.navigate('MyEnrollments')}
          >
            <Text style={{ color: colors.white, fontWeight: '600' }}>📚 My Enrollments</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={{ flex: 1, backgroundColor: colors.dark, padding: 12, borderRadius: 8, alignItems: 'center' }}
            onPress={() => navigation.navigate('MyAttendance')}
          >
            <Text style={{ color: colors.white, fontWeight: '600' }}>✓ My Attendance</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListEmptyComponent={
          <View style={commonStyles.emptyState}>
            <Text style={{ fontSize: 60 }}>🏫</Text>
            <Text style={commonStyles.emptyText}>No academies found</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity 
            style={commonStyles.card}
            onPress={() => navigation.navigate('InstitutionDetail', { institutionId: item.id })}
          >
            <Text style={commonStyles.cardTitle}>🥋 {item.name}</Text>
            {item.city ? <Text style={{ fontSize: 13, color: colors.primary, marginTop: 4 }}>📍 {item.city}</Text> : null}
            {item.description ? (
              <Text style={[commonStyles.cardSubtitle, { marginTop: 6 }]} numberOfLines={2}>
                {item.description}
              </Text>
            ) : null}
            <Text style={{ marginTop: 8, color: colors.primary, fontWeight: '600' }}>View Details ›</Text>
          </TouchableOpacity>
        )}
      />

      {!isGuest && (
        <TouchableOpacity 
          style={{ position: 'absolute', top: 70, right: 20 }}
          onPress={confirmLogout}
        >
          <Text style={{ color: colors.white, fontSize: 12 }}>Logout</Text>
        </TouchableOpacity>
      )}

      {isGuest && (
        <View style={{ padding: 16, backgroundColor: colors.dark }}>
          <TouchableOpacity 
            style={{ backgroundColor: colors.primary, padding: 14, borderRadius: 10, alignItems: 'center' }}
            onPress={() => navigation.replace('Login')}
          >
            <Text style={{ color: colors.white, fontWeight: '600' }}>Sign Up to Enroll</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
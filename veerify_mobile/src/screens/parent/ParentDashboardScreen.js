import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import apiClient from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { colors, commonStyles } from '../../utils/styles';

export default function ParentDashboardScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/parents/children');
      setChildren(res.data.children);
    } catch (err) { 
      console.log('Load children error:', err.message); 
    } finally { 
      setLoading(false); 
      setRefreshing(false); 
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const confirmLogout = () => {
    Alert.alert('Logout', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', onPress: logout, style: 'destructive' }
    ]);
  };

  const handleUnlink = (child) => {
    Alert.alert(
      'Unlink Child',
      `Remove ${child.child_name} from your account? You can re-link them later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Unlink', 
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.delete(`/parents/children/${child.child_id}`);
              load();
            } catch (err) {
              Alert.alert('Error', err.response?.data?.message || 'Failed to unlink');
            }
          }
        }
      ]
    );
  };

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Welcome back</Text>
          <Text style={styles.userName}>Hi, {user?.name?.split(' ')[0]}! 👋</Text>
        </View>
        <TouchableOpacity onPress={confirmLogout}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={children}
        keyExtractor={(item) => item.child_id.toString()}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListHeaderComponent={
          <View>
            <View style={styles.statsCard}>
              <Text style={styles.statsLabel}>Linked Children</Text>
              <Text style={styles.statsNumber}>{children.length}</Text>
            </View>

            <Text style={styles.sectionTitle}>My Children</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>👨‍👩‍👧</Text>
            <Text style={styles.emptyTitle}>No children linked yet</Text>
            <Text style={styles.emptyText}>
              Tap the button below to link your child's account
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const isPending = item.status === 'pending';
          
          return (
            <TouchableOpacity 
              style={[styles.childCard, isPending && styles.pendingCard]}
              onPress={() => {
                if (isPending) {
                  // Don't navigate to detail for pending — just show info
                  return;
                }
                navigation.navigate('ChildDetail', { 
                  childId: item.child_id, 
                  childName: item.child_name 
                });
              }}
              activeOpacity={isPending ? 1 : 0.85}
            >
              <View style={[styles.avatar, isPending && { backgroundColor: colors.warning }]}>
                <Text style={styles.avatarText}>
                  {item.child_name?.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.childName}>{item.child_name}</Text>
                {isPending ? (
                  <>
                    <Text style={styles.pendingText}>⏳ Waiting for approval</Text>
                    <Text style={styles.pendingHint}>Ask {item.child_name?.split(' ')[0]} to approve in their app</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.childInfo}>📞 {item.child_phone || 'No phone'}</Text>
                    {item.institution_name ? (
                      <Text style={styles.childInst}>🏫 {item.institution_name}</Text>
                    ) : (
                      <Text style={styles.childInstNone}>Not enrolled in any academy</Text>
                    )}
                  </>
                )}
              </View>
              <View>
                {!isPending && <Text style={styles.chevron}>›</Text>}
                <TouchableOpacity 
                  onPress={() => handleUnlink(item)}
                  style={{ marginTop: 4 }}
                >
                  <Text style={styles.unlinkText}>Unlink</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        }}
      />

      {/* Floating + button */}
      <TouchableOpacity 
        style={styles.fab}
        onPress={() => navigation.navigate('LinkChild')}
        activeOpacity={0.85}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.light },
  
  header: {
    backgroundColor: colors.dark,
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greeting: { fontSize: 12, color: '#a0a0c0' },
  userName: { fontSize: 22, fontWeight: '700', color: colors.white, marginTop: 2 },
  logoutText: { color: '#a0a0c0', fontSize: 13 },

  statsCard: {
    backgroundColor: colors.primary,
    padding: 20,
    borderRadius: 14,
    marginBottom: 20,
    alignItems: 'center',
  },
  statsLabel: { color: colors.white, fontSize: 13, opacity: 0.9 },
  statsNumber: { color: colors.white, fontSize: 36, fontWeight: '700', marginTop: 4 },

  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },

  childCard: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.lightGray,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.white, fontSize: 22, fontWeight: '700' },
  childName: { fontSize: 15, fontWeight: '600', color: colors.text },
  childInfo: { fontSize: 12, color: colors.textLight, marginTop: 2 },
  childInst: { fontSize: 12, color: colors.primary, marginTop: 2 },
  childInstNone: { fontSize: 12, color: colors.gray, marginTop: 2, fontStyle: 'italic' },
  chevron: { fontSize: 22, color: colors.gray, textAlign: 'center' },
  unlinkText: { fontSize: 11, color: colors.danger, textAlign: 'center' },

  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyEmoji: { fontSize: 60, marginBottom: 16 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 8 },
  emptyText: { fontSize: 13, color: colors.textLight, textAlign: 'center', paddingHorizontal: 40 },

  fab: {
    position: 'absolute',
    right: 20,
    bottom: 30,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
  },
  fabText: { fontSize: 28, color: colors.white, fontWeight: '300' },
  pendingCard: { 
    backgroundColor: '#fff8e7', 
    borderColor: colors.warning 
  },
  pendingText: { 
    fontSize: 12, 
    color: colors.warning, 
    fontWeight: '600', 
    marginTop: 2 
  },
  pendingHint: { 
    fontSize: 11, 
    color: colors.textLight, 
    marginTop: 2, 
    fontStyle: 'italic' 
  },
});
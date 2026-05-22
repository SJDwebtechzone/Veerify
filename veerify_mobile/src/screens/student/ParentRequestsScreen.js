import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import apiClient from '../../api/client';
import { colors } from '../../utils/styles';

export default function ParentRequestsScreen({ navigation }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/parents/pending-requests');
      setRequests(res.data.requests);
    } catch (err) { 
      console.log(err.message); 
    } finally { 
      setLoading(false); 
      setRefreshing(false); 
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleApprove = (req) => {
    Alert.alert(
      'Approve Parent?',
      `${req.parent_name} will be able to see your attendance, classes, and payments. Are you sure?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            try {
              await apiClient.patch(`/parents/approve/${req.link_id}`);
              Alert.alert('Approved! ✅', `${req.parent_name} can now view your details.`);
              load();
            } catch (err) {
              Alert.alert('Error', err.response?.data?.message || 'Failed');
            }
          }
        }
      ]
    );
  };

  const handleReject = (req) => {
    Alert.alert(
      'Reject Request?',
      `${req.parent_name} will not be able to view your details. They can send another request later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.patch(`/parents/reject/${req.link_id}`);
              Alert.alert('Rejected', 'Request has been declined.');
              load();
            } catch (err) {
              Alert.alert('Error', err.response?.data?.message || 'Failed');
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
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Parent Requests</Text>
        <Text style={styles.headerSubtitle}>{requests.length} pending</Text>
      </View>

      <FlatList
        data={requests}
        keyExtractor={(item) => item.link_id.toString()}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>📭</Text>
            <Text style={styles.emptyTitle}>No pending requests</Text>
            <Text style={styles.emptyText}>
              When someone wants to link as your parent, you'll see their request here.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {item.parent_name?.charAt(0).toUpperCase()}
              </Text>
            </View>
            
            <Text style={styles.parentName}>{item.parent_name}</Text>
            <Text style={styles.parentInfo}>✉️ {item.parent_email}</Text>
            {item.parent_phone && (
              <Text style={styles.parentInfo}>📞 {item.parent_phone}</Text>
            )}

            <View style={styles.warningBox}>
              <Text style={styles.warningTitle}>⚠️ What they'll see if approved:</Text>
              <Text style={styles.warningText}>
                • Your enrolled classes{'\n'}
                • Your attendance history{'\n'}
                • Your payment status
              </Text>
            </View>

            <View style={styles.actions}>
              <TouchableOpacity 
                style={styles.rejectBtn}
                onPress={() => handleReject(item)}
                activeOpacity={0.85}
              >
                <Text style={styles.rejectText}>Reject</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.approveBtn}
                onPress={() => handleApprove(item)}
                activeOpacity={0.85}
              >
                <Text style={styles.approveText}>✓ Approve</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.light },
  header: { backgroundColor: colors.dark, paddingTop: 50, paddingHorizontal: 20, paddingBottom: 24 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: colors.white },
  headerSubtitle: { fontSize: 13, color: '#a0a0c0', marginTop: 4 },

  card: { 
    backgroundColor: colors.white, 
    padding: 20, 
    borderRadius: 14, 
    marginBottom: 12, 
    borderWidth: 1, 
    borderColor: colors.lightGray, 
    alignItems: 'center' 
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  avatarText: { color: colors.white, fontSize: 26, fontWeight: '700' },
  parentName: { fontSize: 18, fontWeight: '700', color: colors.text },
  parentInfo: { fontSize: 12, color: colors.textLight, marginTop: 4 },

  warningBox: { 
    backgroundColor: '#fff8e7', 
    padding: 12, 
    borderRadius: 10, 
    marginTop: 16, 
    width: '100%' 
  },
  warningTitle: { fontSize: 12, fontWeight: '600', color: '#854F0B', marginBottom: 6 },
  warningText: { fontSize: 12, color: '#854F0B', lineHeight: 18 },

  actions: { flexDirection: 'row', gap: 10, marginTop: 16, width: '100%' },
  rejectBtn: { 
    flex: 1, 
    padding: 14, 
    borderRadius: 10, 
    alignItems: 'center', 
    borderWidth: 1.5, 
    borderColor: colors.danger 
  },
  rejectText: { color: colors.danger, fontWeight: '700' },
  approveBtn: { 
    flex: 1, 
    padding: 14, 
    borderRadius: 10, 
    alignItems: 'center', 
    backgroundColor: colors.success 
  },
  approveText: { color: colors.white, fontWeight: '700' },

  emptyState: { alignItems: 'center', padding: 60 },
  emptyEmoji: { fontSize: 60, marginBottom: 16 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 8 },
  emptyText: { fontSize: 13, color: colors.textLight, textAlign: 'center', paddingHorizontal: 30 },
});
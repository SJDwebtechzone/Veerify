import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, RefreshControl, Image,
} from 'react-native';
import apiClient from '../../api/client';
import { colors } from '../../utils/styles';
import { useInstitution } from '../../context/InstitutionContext';

// Resolve a stored image_url to something the emulator can fetch.
const ASSET_HOST = (apiClient.defaults.baseURL || '').replace(/\/api\/?$/, '');
function resolveAssetUrl(src) {
  if (!src) return null;
  if (src.startsWith('data:')) return src;
  if (src.startsWith('/uploads/')) return ASSET_HOST + src;
  if (src.includes('://localhost:') || src.includes('://127.0.0.1:')) {
    return src.replace(/:\/\/(localhost|127\.0\.0\.1)(?=[:\/])/, '://10.0.2.2');
  }
  return src;
}

export default function AllInstitutionsScreen({ navigation }) {
  const { selectInstitution } = useInstitution();
  const [institutions, setInstitutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/institutions');
      setInstitutions(res.data.institutions || []);
    } catch (err) {
      console.log('AllInstitutions load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Client-side filter by name + city.
  const visible = useMemo(() => {
    if (!search.trim()) return institutions;
    const q = search.trim().toLowerCase();
    return institutions.filter(
      (i) =>
        (i.name || '').toLowerCase().includes(q) ||
        (i.city || '').toLowerCase().includes(q),
    );
  }, [institutions, search]);

  const handlePress = (id) => {
    // InstitutionDetail screen has been removed — its content now
    // renders inline on the Home tab. Select the tapped academy so
    // Home re-hydrates with its banner + details + courses, then
    // pop back to the tab navigator root. GuestHome (guest stack)
    // and StudentTabs (student stack) both host StudentTabNavigator,
    // so popToTop works in either case; the try/catch chain is a
    // defensive fallback for older nav trees.
    const picked = institutions.find((i) => i.id === id);
    if (picked) selectInstitution(picked);
    // See CategoryAcademiesScreen for the "don't use popToTop" note —
    // on the guest stack, popToTop lands on Welcome (index 0), not
    // the tab navigator. `navigate` by name is the safe hop.
    try { navigation.navigate('GuestHome'); return; } catch (_) { /* try next */ }
    try { navigation.navigate('StudentTabs'); return; } catch (_) { /* try next */ }
    try { navigation.getParent()?.navigate('GuestHome'); return; } catch (_) { /* noop */ }
    try { navigation.getParent()?.navigate('StudentTabs'); } catch (_) { /* noop */ }
  };

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Search */}
      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search by academy or city..."
          placeholderTextColor="#a0a0c0"
          returnKeyType="search"
        />
      </View>

      <Text style={styles.countLabel}>
        {visible.length} {visible.length === 1 ? 'academy' : 'academies'}
        {search.trim() ? ` matching "${search.trim()}"` : ''}
      </Text>

      <FlatList
        data={visible}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 40 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🏛️</Text>
            <Text style={styles.emptyTitle}>
              {search ? 'No matching academies' : 'No academies yet'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {search ? 'Try a different search term.' : 'Check back soon.'}
            </Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <AcademyRow item={item} index={index} onPress={() => handlePress(item.id)} />
        )}
      />
    </View>
  );
}

function AcademyRow({ item, index, onPress }) {
  const logo = resolveAssetUrl(item.logo_url);
  const palette = [colors.catKarate, colors.catTaekwondo, colors.catBoxing, colors.catBJJ];
  const emojiMap = ['🥋', '🦵', '🥊', '🤼'];
  const bg = palette[index % 4] || colors.primary;
  const emoji = emojiMap[index % 4] || '🏛️';

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.85}>
      {logo ? (
        <Image source={{ uri: logo }} style={styles.logo} resizeMode="cover" />
      ) : (
        <View style={[styles.logo, { backgroundColor: bg, justifyContent: 'center', alignItems: 'center' }]}>
          <Text style={{ fontSize: 26 }}>{emoji}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.location} numberOfLines={1}>
          📍 {item.city || 'India'}{item.pincode ? ` • ${item.pincode}` : ''}
        </Text>
        {item.description ? (
          <Text style={styles.description} numberOfLines={2}>{item.description}</Text>
        ) : null}
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f5f9' },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    paddingHorizontal: 14,
    height: 46,
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.lightGray,
  },
  searchIcon: { fontSize: 16, marginRight: 8, color: '#888' },
  searchInput: { flex: 1, fontSize: 14, color: colors.text, padding: 0 },

  countLabel: {
    paddingHorizontal: 20,
    paddingBottom: 4,
    fontSize: 12,
    color: colors.textLight,
    fontWeight: '600',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.lightGray,
    gap: 12,
  },
  logo: {
    width: 54,
    height: 54,
    borderRadius: 12,
    backgroundColor: '#eef0f5',
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.dark,
    marginBottom: 2,
  },
  location: {
    fontSize: 12,
    color: colors.textLight,
    marginBottom: 2,
  },
  description: {
    fontSize: 12,
    color: '#888',
    lineHeight: 16,
    marginTop: 2,
  },
  chevron: {
    fontSize: 28,
    color: '#cdd2dc',
    marginLeft: 4,
  },

  empty: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyEmoji: { fontSize: 56, marginBottom: 12 },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.dark,
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.textLight,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});

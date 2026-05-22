import { StyleSheet } from 'react-native';

export const colors = {
  primary: '#e63946',
  dark: '#1a1a2e',
  light: '#f4f4f8',
  white: '#fff',
  gray: '#888',
  lightGray: '#e0e0e8',
  border: '#d0d0d8',
  text: '#1a1a2e',
  textLight: '#666',
  success: '#06d6a0',
  warning: '#ffb703',
  danger: '#ef476f',

  // Category card colors
  catKarate: '#fce4e4',
  catTaekwondo: '#e6f1fb',
  catBoxing: '#fae7d3',
  catBJJ: '#e1f5ee',
  catMuayThai: '#f3e6fb',
  catSelfDefense: '#fff3cd',

  // Hero/banner
  heroRed: '#e63946',
  heroDark: '#1a1a2e',

  // Live indicator
  liveRed: '#ef4444',
};

export const commonStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  scrollContainer: { padding: 20 },

  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 20, backgroundColor: colors.dark },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: colors.white },
  headerSubtitle: { fontSize: 14, color: '#a0a0c0', marginTop: 4 },

  title: { fontSize: 24, fontWeight: 'bold', color: colors.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.textLight, marginBottom: 20 },

  label: { fontSize: 14, color: colors.text, fontWeight: '600', marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: colors.light, borderRadius: 10, padding: 14, fontSize: 16,
    borderWidth: 1, borderColor: colors.lightGray, color: colors.text,
  },
  textarea: { minHeight: 80, textAlignVertical: 'top' },

  button: { backgroundColor: colors.primary, padding: 16, borderRadius: 10, alignItems: 'center', marginTop: 16 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '600' },

  card: {
    backgroundColor: colors.white, padding: 16, borderRadius: 12,
    marginBottom: 12, borderWidth: 1, borderColor: colors.lightGray,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 4 },
  cardSubtitle: { fontSize: 13, color: colors.textLight },

  emptyState: { alignItems: 'center', padding: 40 },
  emptyText: { fontSize: 14, color: colors.gray, textAlign: 'center', marginTop: 8 },

  fab: {
    position: 'absolute', right: 20, bottom: 20,
    backgroundColor: colors.primary, width: 56, height: 56,
    borderRadius: 28, alignItems: 'center', justifyContent: 'center',
    elevation: 5, shadowColor: '#000', shadowOpacity: 0.2, shadowOffset: { width: 0, height: 2 }, shadowRadius: 4,
  },
  fabText: { color: colors.white, fontSize: 28, fontWeight: '300' },
});

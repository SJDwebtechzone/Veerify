// src/screens/admin/AdminDashboardScreen.js
//
// Institution admin (academy owner) dashboard.
//
// Layout (top → bottom):
//   1. Header — greeting, name, avatar, bell with unread dot
//   2. Six pastel stat cards (2-column grid):
//        Students, Trainers, Today's Classes, Pending Fees, Revenue, Attendance
//   3. Quick Action row — Add Student, Create Batch, Add Event, Send Notice
//   4. Monthly Revenue line chart (react-native-chart-kit)
//   5. Recent activity teaser (placeholder list)
//   6. Bottom padding so the floating tab bar + FAB don't cover content
//
// All numbers are placeholders for now — we'll wire backend endpoints in a
// follow-up pass once the look is locked across screens.

import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Dimensions, Image, Alert,
} from 'react-native';
import {
  Bell, Users, GraduationCap, Calendar, Wallet,
  TrendingUp, ClipboardCheck, UserPlus, CalendarPlus,
  Megaphone, BellPlus, ChevronRight, BookOpen,
} from 'lucide-react-native';
import { LineChart } from 'react-native-chart-kit';

import { useAuth } from '../../context/AuthContext';
import { palette, spacing, radius, shadows, type } from '../../theme';
import StatCard from '../../components/StatCard';
import QuickAction from '../../components/QuickAction';
import FAB from '../../components/FAB';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CHART_WIDTH = SCREEN_WIDTH - spacing.xl * 2;

// Placeholder revenue series — last 6 months in ₹k.
const REVENUE_DATA = {
  labels: ['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May'],
  datasets: [{
    data: [42, 48, 55, 51, 64, 72],
    color: () => palette.purple.vivid,
    strokeWidth: 3,
  }],
};

const CHART_CONFIG = {
  backgroundGradientFrom: palette.surface,
  backgroundGradientTo: palette.surface,
  decimalPlaces: 0,
  color: (opacity = 1) => `rgba(139, 92, 246, ${opacity})`,
  labelColor: () => palette.textMuted,
  propsForBackgroundLines: { stroke: palette.borderSoft, strokeDasharray: '' },
  propsForDots: { r: '5', strokeWidth: '2', stroke: palette.surface },
  fillShadowGradientFrom: palette.purple.vivid,
  fillShadowGradientFromOpacity: 0.2,
  fillShadowGradientTo: palette.purple.soft,
  fillShadowGradientToOpacity: 0.02,
};

export default function AdminDashboardScreen({ navigation }) {
  const { user, institution } = useAuth();
  const [unread] = useState(3); // placeholder notification count

  // Greeting prefers the academy name; falls back to the owner's first name
  // if for any reason the institution row hasn't loaded yet.
  const academyName = institution?.name || (user?.name || 'Academy').split(' ')[0];
  // Initial used by the avatar fallback (still the owner's initial — that's
  // their personal identity badge).
  const firstName = (user?.name || 'Sensei').split(' ')[0];

  // Placeholder data — we'll wire real APIs in a follow-up pass.
  const stats = [
    { label: 'Total Students',  value: '248', delta: '+12 this week',   accent: palette.purple, icon: Users },
    { label: 'Active Trainers', value: '14',  delta: 'All available',   accent: palette.blue,   icon: GraduationCap },
    { label: "Today's Classes", value: '7',   delta: '3 ongoing',       accent: palette.green,  icon: Calendar },
    { label: 'Pending Fees',    value: '₹38k',delta: '6 students',      accent: palette.orange, icon: Wallet },
    { label: 'Revenue',         value: '₹72k',delta: '+18% MoM',        accent: palette.pink,   icon: TrendingUp },
    { label: 'Attendance',      value: '92%', delta: 'This month',      accent: palette.teal,   icon: ClipboardCheck },
  ];

  const placeholder = (name) =>
    Alert.alert(name, 'We\'ll wire this up as we build out the related screen.');

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ───── Header ───── */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>Welcome back</Text>
            <Text style={styles.userName} numberOfLines={1}>{academyName} 👋</Text>
          </View>
          <TouchableOpacity
            onPress={() => placeholder('Notifications')}
            style={styles.iconButton}
            activeOpacity={0.8}
          >
            <Bell size={20} color={palette.text} strokeWidth={2.2} />
            {unread > 0 && (
              <View style={styles.dot}>
                <Text style={styles.dotText}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => placeholder('Profile')}
            activeOpacity={0.85}
            style={styles.avatarWrap}
          >
            {user?.profile_image ? (
              <Image source={{ uri: user.profile_image }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarText}>
                  {firstName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* ───── Stats grid ───── */}
        <View style={styles.statsGrid}>
          {stats.reduce((rows, stat, idx) => {
            if (idx % 2 === 0) rows.push([stat]);
            else rows[rows.length - 1].push(stat);
            return rows;
          }, []).map((row, ri) => (
            <View key={ri} style={styles.statsRow}>
              {row.map((s) => (
                <StatCard
                  key={s.label}
                  icon={s.icon}
                  label={s.label}
                  value={s.value}
                  delta={s.delta}
                  accent={s.accent}
                />
              ))}
            </View>
          ))}
        </View>

        {/* ───── Quick actions ───── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Quick Actions</Text>
          </View>
          <View style={styles.quickActions}>
            <QuickAction icon={UserPlus}     label="Add Student"   accent={palette.purple} onPress={() => placeholder('Add Student')} />
            <QuickAction icon={BookOpen}     label="Add Course"    accent={palette.teal}   onPress={() => navigation.navigate('CreateCourse')} />
            <QuickAction icon={CalendarPlus} label="Create Batch"  accent={palette.blue}   onPress={() => navigation.navigate('CreateBatch')} />
            <QuickAction icon={BellPlus}     label="Add Event"     accent={palette.green}  onPress={() => placeholder('Add Event')} />
            <QuickAction icon={Megaphone}    label="Send Notice"   accent={palette.orange} onPress={() => placeholder('Send Notice')} />
          </View>
        </View>

        {/* ───── Monthly revenue chart ───── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Monthly Revenue</Text>
              <Text style={styles.sectionSubtitle}>Last 6 months • ₹ in thousands</Text>
            </View>
            <TouchableOpacity onPress={() => placeholder('Revenue Details')} style={styles.linkRow}>
              <Text style={styles.linkText}>Details</Text>
              <ChevronRight size={14} color={palette.purple.vivid} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>
          <View style={styles.chartCard}>
            <LineChart
              data={REVENUE_DATA}
              width={CHART_WIDTH - spacing.lg * 2}
              height={180}
              chartConfig={CHART_CONFIG}
              bezier
              withInnerLines
              withOuterLines={false}
              withVerticalLines={false}
              withDots
              fromZero
              segments={4}
              style={{ marginLeft: -spacing.md }}
            />
          </View>
        </View>

        {/* ───── Recent activity teaser ───── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Activity</Text>
            <TouchableOpacity onPress={() => placeholder('Activity Feed')} style={styles.linkRow}>
              <Text style={styles.linkText}>See all</Text>
              <ChevronRight size={14} color={palette.purple.vivid} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>
          <View style={styles.activityCard}>
            <ActivityRow accent={palette.green}  title="2 new students joined Karate Beginners"  meta="2h ago" />
            <View style={styles.divider} />
            <ActivityRow accent={palette.orange} title="3 fee reminders sent automatically"      meta="Today" />
            <View style={styles.divider} />
            <ActivityRow accent={palette.blue}   title="Trainer Suresh marked Batch B-12 done"   meta="Yesterday" />
          </View>
        </View>

        {/* Footer spacer so content clears the floating tab bar + FAB */}
        <View style={{ height: 110 }} />
      </ScrollView>

      {/* Floating + button — placeholder for now */}
      <FAB
        bottom={92}
        onPress={() => placeholder('Quick Create')}
        accent={palette.purple}
      />
    </View>
  );
}

function ActivityRow({ accent, title, meta }) {
  return (
    <View style={styles.activityRow}>
      <View style={[styles.activityDot, { backgroundColor: accent.vivid }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.activityTitle}>{title}</Text>
        <Text style={styles.activityMeta}>{meta}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  scrollContent: {
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xxl,
    gap: spacing.md,
  },
  greeting: { ...type.caption, color: palette.textMuted, marginBottom: 2 },
  userName: { ...type.display, color: palette.text },
  iconButton: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: palette.surface,
    alignItems: 'center', justifyContent: 'center',
    ...shadows.card,
  },
  dot: {
    position: 'absolute', top: 6, right: 6,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: palette.rose.vivid,
    paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: palette.surface,
  },
  dotText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  avatarWrap: { ...shadows.card, borderRadius: 21 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: palette.purple.soft },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...type.h3, color: palette.purple.on },

  // Stats grid
  statsGrid: { gap: spacing.md, marginBottom: spacing.xxl },
  statsRow: { flexDirection: 'row', gap: spacing.md },

  // Section header
  section: { marginBottom: spacing.xxl },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionTitle: { ...type.h2, color: palette.text },
  sectionSubtitle: { ...type.caption, color: palette.textMuted, marginTop: 2 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  linkText: { ...type.caption, color: palette.purple.vivid, fontWeight: '700' },

  // Quick actions
  quickActions: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: palette.surface,
    padding: spacing.lg,
    borderRadius: radius.lg,
    ...shadows.card,
  },

  // Chart
  chartCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    paddingRight: spacing.sm,
    ...shadows.card,
  },

  // Activity
  activityCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  activityDot: { width: 8, height: 8, borderRadius: 4 },
  activityTitle: { ...type.bodyBold, color: palette.text },
  activityMeta: { ...type.caption, color: palette.textMuted, marginTop: 2 },
  divider: { height: 1, backgroundColor: palette.borderSoft },
});

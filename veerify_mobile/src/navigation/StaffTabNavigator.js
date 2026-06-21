// src/navigation/StaffTabNavigator.js
//
// Bottom tab bar for the Staff (trainer) experience.
// Tabs: Dashboard / Attendance / Students / Notifications / Profile.
// Active tab gets the brand red highlight + filled icon stroke; inactive tabs
// stay muted gray. Tab bar is a floating rounded card sitting above the
// system inset, matching the institution admin's modern tab bar look.

import React from 'react';
import { Platform, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  LayoutDashboard, ClipboardCheck, Users, Video, UserCircle,
} from 'lucide-react-native';

import StaffDashboardScreen     from '../screens/staff/StaffDashboardScreen';
import StaffAttendanceScreen    from '../screens/staff/StaffAttendanceScreen';
import StaffStudentsScreen      from '../screens/staff/StaffStudentsScreen';
import StaffVideosScreen        from '../screens/staff/StaffVideosScreen';
import StaffProfileScreen       from '../screens/staff/StaffProfileScreen';

import { palette, shadows, spacing } from '../theme';

const Tab = createBottomTabNavigator();

function TabLabel({ focused, children }) {
  return (
    <Text
      style={{
        fontSize: 11,
        fontWeight: focused ? '700' : '500',
        color: focused ? palette.purple.vivid : palette.textMuted,
        marginTop: 2,
      }}
    >
      {children}
    </Text>
  );
}

function makeIcon(Icon) {
  return ({ focused }) => (
    <Icon
      size={22}
      strokeWidth={focused ? 2.4 : 2}
      color={focused ? palette.purple.vivid : palette.textMuted}
    />
  );
}

export default function StaffTabNavigator() {
  // Push the floating tab bar above any system gesture / nav bar so
  // it never gets clipped on devices with bottom insets.
  const insets = useSafeAreaInsets();
  const tabBottom = Math.max(insets.bottom, 8);
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarStyle: [styles.tabBar, { bottom: tabBottom }],
        tabBarItemStyle: { paddingTop: 8 },
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tab.Screen
        name="StaffDashboard"
        component={StaffDashboardScreen}
        options={{
          tabBarIcon: makeIcon(LayoutDashboard),
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Dashboard</TabLabel>,
        }}
      />
      <Tab.Screen
        name="StaffAttendance"
        component={StaffAttendanceScreen}
        options={{
          tabBarIcon: makeIcon(ClipboardCheck),
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Attendance</TabLabel>,
        }}
      />
      <Tab.Screen
        name="StaffStudents"
        component={StaffStudentsScreen}
        options={{
          tabBarIcon: makeIcon(Users),
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Students</TabLabel>,
        }}
      />
      <Tab.Screen
        name="StaffVideos"
        component={StaffVideosScreen}
        options={{
          tabBarIcon: makeIcon(Video),
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Sessions</TabLabel>,
        }}
      />
      <Tab.Screen
        name="StaffProfile"
        component={StaffProfileScreen}
        options={{
          tabBarIcon: makeIcon(UserCircle),
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Profile</TabLabel>,
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    // `bottom` is overridden per-render via Math.max(insets.bottom, 8)
    // so the tab bar always sits above gesture / soft nav.
    height: 64,
    borderRadius: 22,
    backgroundColor: palette.surface,
    borderTopWidth: 0,
    paddingHorizontal: spacing.sm,
    ...shadows.raised,
  },
});

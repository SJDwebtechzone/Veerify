// src/navigation/ParentTabNavigator.js
//
// Bottom tab bar for the Parent experience.
// Tabs: Home / Attendance / Progress / Payments / More.
// Active tab gets the brand red highlight + filled icon stroke; inactive tabs
// stay muted gray. Tab bar is a floating rounded card sitting above the
// system inset, matching the staff and admin tab bar look.
//
// Tab-root screens (Attendance / Progress / Payments) read the active
// child id from ChildContext when no route.params are provided, so they
// work seamlessly as tabs without explicit navigation params. Their
// internal back arrows hide when navigation.canGoBack() is false.

import React from 'react';
import { Platform, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  Home, ClipboardCheck, TrendingUp, Wallet, MoreHorizontal,
} from 'lucide-react-native';

import ParentDashboardScreen   from '../screens/parent/ParentDashboardScreen';
import ChildAttendanceScreen   from '../screens/parent/ChildAttendanceScreen';
import ChildProgressScreen     from '../screens/parent/ChildProgressScreen';
import ChildPaymentsScreen     from '../screens/parent/ChildPaymentsScreen';
import ParentMoreScreen        from '../screens/parent/ParentMoreScreen';

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

export default function ParentTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: { paddingTop: 8 },
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tab.Screen
        name="ParentDashboard"
        component={ParentDashboardScreen}
        options={{
          tabBarIcon: makeIcon(Home),
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Home</TabLabel>,
        }}
      />
      <Tab.Screen
        name="ChildAttendanceTab"
        component={ChildAttendanceScreen}
        options={{
          tabBarIcon: makeIcon(ClipboardCheck),
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Attendance</TabLabel>,
        }}
      />
      <Tab.Screen
        name="ChildProgressTab"
        component={ChildProgressScreen}
        options={{
          tabBarIcon: makeIcon(TrendingUp),
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Progress</TabLabel>,
        }}
      />
      <Tab.Screen
        name="ChildPaymentsTab"
        component={ChildPaymentsScreen}
        options={{
          tabBarIcon: makeIcon(Wallet),
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Payments</TabLabel>,
        }}
      />
      <Tab.Screen
        name="ParentMore"
        component={ParentMoreScreen}
        options={{
          tabBarIcon: makeIcon(MoreHorizontal),
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>More</TabLabel>,
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
    bottom: Platform.OS === 'ios' ? 24 : 14,
    height: 64,
    borderRadius: 22,
    backgroundColor: palette.surface,
    borderTopWidth: 0,
    paddingHorizontal: spacing.sm,
    ...shadows.raised,
  },
});

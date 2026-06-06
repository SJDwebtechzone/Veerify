// src/navigation/AdminTabNavigator.js
//
// Bottom tab bar for institution admins (the academy owner / "institution login"
// experience in the mobile app). Five tabs: Dashboard, Students, Batches,
// Earnings, More. Only Dashboard is fully built — the rest render the
// placeholder until we get to them.
//
// Styled as a modern rounded card sitting above the system insets. Active tab
// renders the icon + label in the brand purple; inactive tabs are slate gray.

import React from 'react';
import { Platform, Text, View, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  LayoutDashboard, Users, BookOpen, Wallet, Menu,
} from 'lucide-react-native';

import AdminDashboardScreen from '../screens/admin/AdminDashboardScreen';
import StudentsTabScreen from '../screens/admin/tabs/StudentsTabScreen';
import CoursesListScreen from '../screens/admin/CoursesListScreen';
import PaymentsTabScreen from '../screens/admin/tabs/PaymentsTabScreen';
import MoreTabScreen from '../screens/admin/tabs/MoreTabScreen';
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

export default function AdminTabNavigator() {
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
        name="Dashboard"
        component={AdminDashboardScreen}
        options={{
          tabBarIcon: makeIcon(LayoutDashboard),
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Dashboard</TabLabel>,
        }}
      />
      <Tab.Screen
        name="Students"
        component={StudentsTabScreen}
        options={{
          tabBarIcon: makeIcon(Users),
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Students</TabLabel>,
        }}
      />
      <Tab.Screen
        name="Courses"
        component={CoursesListScreen}
        options={{
          tabBarIcon: makeIcon(BookOpen),
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Courses</TabLabel>,
        }}
      />
      <Tab.Screen
        name="Earnings"
        component={PaymentsTabScreen}
        options={{
          tabBarIcon: makeIcon(Wallet),
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Earnings</TabLabel>,
        }}
      />
      <Tab.Screen
        name="More"
        component={MoreTabScreen}
        options={{
          tabBarIcon: makeIcon(Menu),
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
    bottom: 0,
    height: 64,
    borderRadius: 22,
    backgroundColor: palette.surface,
    borderTopWidth: 0,
    paddingHorizontal: spacing.sm,
    ...shadows.raised,
  },
});

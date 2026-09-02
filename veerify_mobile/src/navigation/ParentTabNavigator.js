// src/navigation/ParentTabNavigator.js
//
// Bottom tab bar for the Parent experience.
// Tabs: Home / Attendance / Progress / Payments / More.
//
// Uses the shared <BottomNavigation/> component so the parent bar
// looks and behaves identically to admin / trainer / student.
//
// Tab-root screens (Attendance / Progress / Payments) read the
// active child id from ChildContext when no route.params are
// provided, so they work seamlessly as tabs without explicit
// navigation params. Their internal back arrows hide when
// navigation.canGoBack() is false.

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  House, ClipboardCheck, TrendingUp, Wallet, Menu,
} from 'lucide-react-native';

import ParentDashboardScreen   from '../screens/parent/ParentDashboardScreen';
import ChildAttendanceScreen   from '../screens/parent/ChildAttendanceScreen';
import ChildProgressScreen     from '../screens/parent/ChildProgressScreen';
import ChildPaymentsScreen     from '../screens/parent/ChildPaymentsScreen';
import ParentMoreScreen        from '../screens/parent/ParentMoreScreen';
import BottomNavigation        from '../components/BottomNavigation';

const Tab = createBottomTabNavigator();

export default function ParentTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
      }}
      tabBar={(props) => <BottomNavigation {...props} />}
    >
      <Tab.Screen
        name="ParentDashboard"
        component={ParentDashboardScreen}
        options={{ tabBarLabel: 'Home', iconComponent: House }}
      />
      <Tab.Screen
        name="ChildAttendanceTab"
        component={ChildAttendanceScreen}
        options={{ tabBarLabel: 'Attendance', iconComponent: ClipboardCheck }}
      />
      <Tab.Screen
        name="ChildProgressTab"
        component={ChildProgressScreen}
        options={{ tabBarLabel: 'Progress', iconComponent: TrendingUp }}
      />
      <Tab.Screen
        name="ChildPaymentsTab"
        component={ChildPaymentsScreen}
        options={{ tabBarLabel: 'Payments', iconComponent: Wallet }}
      />
      <Tab.Screen
        name="ParentMore"
        component={ParentMoreScreen}
        options={{ tabBarLabel: 'More', iconComponent: Menu }}
      />
    </Tab.Navigator>
  );
}

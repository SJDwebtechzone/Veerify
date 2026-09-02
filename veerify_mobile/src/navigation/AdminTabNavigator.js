// src/navigation/AdminTabNavigator.js
//
// Bottom tab bar for institution admins (the academy owner /
// "institution login" experience in the mobile app). Five tabs:
// Dashboard, Students, Courses, Earnings, More.
//
// Uses the shared <BottomNavigation/> component so the visual
// language stays consistent with the trainer, student, and parent
// tab bars. Icons are picked from lucide-react-native only — no new
// icon libraries.

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  LayoutDashboard, UsersRound, Layers3, Wallet, Menu,
} from 'lucide-react-native';

import AdminDashboardScreen from '../screens/admin/AdminDashboardScreen';
import StudentsTabScreen from '../screens/admin/tabs/StudentsTabScreen';
import CoursesListScreen from '../screens/admin/CoursesListScreen';
import PaymentsTabScreen from '../screens/admin/tabs/PaymentsTabScreen';
import MoreTabScreen from '../screens/admin/tabs/MoreTabScreen';
import BottomNavigation from '../components/BottomNavigation';

const Tab = createBottomTabNavigator();

export default function AdminTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        // Light-blue base for every admin tab screen — matches the
        // Institution Home ambient background so tabs read as one
        // unified glassmorphism environment even before the SVG
        // atmosphere paints on top.
        sceneStyle: { backgroundColor: '#F1F6FB' },
        // React Navigation v6 fallback (some versions read this
        // property name instead of sceneStyle).
        sceneContainerStyle: { backgroundColor: '#F1F6FB' },
      }}
      tabBar={(props) => <BottomNavigation {...props} />}
    >
      <Tab.Screen
        name="Dashboard"
        component={AdminDashboardScreen}
        options={{ tabBarLabel: 'Dashboard', iconComponent: LayoutDashboard }}
      />
      <Tab.Screen
        name="Students"
        component={StudentsTabScreen}
        options={{ tabBarLabel: 'Students', iconComponent: UsersRound }}
      />
      <Tab.Screen
        name="Courses"
        component={CoursesListScreen}
        options={{ tabBarLabel: 'Courses', iconComponent: Layers3 }}
      />
      <Tab.Screen
        name="Earnings"
        component={PaymentsTabScreen}
        options={{ tabBarLabel: 'Earnings', iconComponent: Wallet }}
      />
      <Tab.Screen
        name="More"
        component={MoreTabScreen}
        options={{ tabBarLabel: 'More', iconComponent: Menu }}
      />
    </Tab.Navigator>
  );
}

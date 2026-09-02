// src/navigation/StaffTabNavigator.js
//
// Bottom tab bar for the Staff (trainer) experience.
// Tabs: Dashboard / Attendance / Students / Sessions / Profile.
//
// Uses the shared <BottomNavigation/> component so the trainer bar
// looks and behaves identically to the institution admin, student,
// and parent bars.

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  LayoutDashboard, ClipboardCheck, UsersRound, PlayCircle, CircleUserRound,
} from 'lucide-react-native';

import StaffDashboardScreen     from '../screens/staff/StaffDashboardScreen';
import StaffAttendanceScreen    from '../screens/staff/StaffAttendanceScreen';
import StaffStudentsScreen      from '../screens/staff/StaffStudentsScreen';
import StaffVideosScreen        from '../screens/staff/StaffVideosScreen';
import StaffProfileScreen       from '../screens/staff/StaffProfileScreen';
import BottomNavigation         from '../components/BottomNavigation';

const Tab = createBottomTabNavigator();

export default function StaffTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
      }}
      tabBar={(props) => <BottomNavigation {...props} />}
    >
      <Tab.Screen
        name="StaffDashboard"
        component={StaffDashboardScreen}
        options={{ tabBarLabel: 'Dashboard', iconComponent: LayoutDashboard }}
      />
      <Tab.Screen
        name="StaffAttendance"
        component={StaffAttendanceScreen}
        options={{ tabBarLabel: 'Attendance', iconComponent: ClipboardCheck }}
      />
      <Tab.Screen
        name="StaffStudents"
        component={StaffStudentsScreen}
        options={{ tabBarLabel: 'Students', iconComponent: UsersRound }}
      />
      <Tab.Screen
        name="StaffVideos"
        component={StaffVideosScreen}
        options={{ tabBarLabel: 'Sessions', iconComponent: PlayCircle }}
      />
      <Tab.Screen
        name="StaffProfile"
        component={StaffProfileScreen}
        options={{ tabBarLabel: 'Profile', iconComponent: CircleUserRound }}
      />
    </Tab.Navigator>
  );
}

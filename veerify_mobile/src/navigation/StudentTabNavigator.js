// src/navigation/StudentTabNavigator.js
//
// Student bottom tab bar. Tabs: Home / Courses / Batches /
// Sessions / Profile.
//
// Uses the shared <BottomNavigation/> component so the student bar
// stays visually identical to admin / trainer / parent. Icons are
// picked from lucide-react-native only — no emoji, no extra icon
// libraries.

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  House, Layers3, CalendarClock, PlayCircle, CircleUserRound,
} from 'lucide-react-native';

import HomeTabScreen     from '../screens/student/tabs/HomeTabScreen';
import ProgramsTabScreen from '../screens/student/tabs/ProgramsTabScreen';
import BatchesTabScreen  from '../screens/student/tabs/BatchesTabScreen';
import LiveTabScreen     from '../screens/student/tabs/LiveTabScreen';
import ProfileTabScreen  from '../screens/student/tabs/ProfileTabScreen';
import BottomNavigation  from '../components/BottomNavigation';

const Tab = createBottomTabNavigator();

export default function StudentTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
      }}
      tabBar={(props) => <BottomNavigation {...props} />}
    >
      <Tab.Screen
        name="Home"
        component={HomeTabScreen}
        options={{ tabBarLabel: 'Home', iconComponent: House }}
      />
      <Tab.Screen
        name="Programs"
        component={ProgramsTabScreen}
        // Route name stays "Programs" so existing navigation.jumpTo('Programs')
        // calls keep working; only the visible label is "Courses".
        options={{ tabBarLabel: 'Courses', iconComponent: Layers3 }}
      />
      <Tab.Screen
        name="Batches"
        component={BatchesTabScreen}
        options={{ tabBarLabel: 'Batches', iconComponent: CalendarClock }}
      />
      <Tab.Screen
        name="Sessions"
        component={LiveTabScreen}
        options={{ tabBarLabel: 'Sessions', iconComponent: PlayCircle }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileTabScreen}
        options={{ tabBarLabel: 'Profile', iconComponent: CircleUserRound }}
      />
    </Tab.Navigator>
  );
}

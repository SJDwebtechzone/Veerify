import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View } from 'react-native';

import HomeTabScreen from '../screens/student/tabs/HomeTabScreen';
import ProgramsTabScreen from '../screens/student/tabs/ProgramsTabScreen';
import BatchesTabScreen from '../screens/student/tabs/BatchesTabScreen';
import LiveTabScreen from '../screens/student/tabs/LiveTabScreen';
import ProfileTabScreen from '../screens/student/tabs/ProfileTabScreen';

import { colors } from '../utils/styles';

const Tab = createBottomTabNavigator();

// Simple emoji-based tab icon (no need for vector-icons setup)
const TabIcon = ({ emoji, focused }) => (
  <View style={{ alignItems: 'center', justifyContent: 'center' }}>
    <Text style={{ fontSize: focused ? 26 : 22 }}>{emoji}</Text>
  </View>
);

export default function StudentTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.gray,
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopColor: colors.lightGray,
          height: 64,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tab.Screen 
        name="Home" 
        component={HomeTabScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon emoji="🏠" focused={focused} />,
        }}
      />
      <Tab.Screen 
        name="Programs" 
        component={ProgramsTabScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon emoji="📚" focused={focused} />,
        }}
      />
      <Tab.Screen 
        name="Batches" 
        component={BatchesTabScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon emoji="🕒" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Sessions"
        component={LiveTabScreen}
        options={{
          // Covers BOTH recorded videos (📺) and live sessions — the screen
          // itself has a toggle to switch between the two views.
          tabBarIcon: ({ focused }) => <TabIcon emoji="📺" focused={focused} />,
        }}
      />
      <Tab.Screen 
        name="Profile" 
        component={ProfileTabScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}
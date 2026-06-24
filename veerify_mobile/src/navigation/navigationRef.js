// src/navigation/navigationRef.js
//
// Singleton ref so non-React code (axios interceptors, in particular)
// can navigate without holding onto the navigation prop from a screen.
//
// Usage:
//   1. Wire <NavigationContainer ref={navigationRef}> in AppNavigator.
//   2. Import { navigate } from './navigationRef' anywhere — including
//      modules outside the React tree (api/client.js).

import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

export function navigate(name, params) {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name, params);
  }
}

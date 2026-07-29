/**
 * @format
 */

import { AppRegistry } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import App from './App';
import { name as appName } from './app.json';

// Firebase requires the background message handler to be registered
// at the module top level so it survives an app cold-start from the
// notification tray. Keep the body TINY — we let the OS render the
// tray notification via the `notification` payload, and rely on
// onNotificationOpenedApp / getInitialNotification (inside App) to
// route on tap.
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  // eslint-disable-next-line no-console
  console.log('[fcm][bg] message received:', remoteMessage?.messageId);
});

AppRegistry.registerComponent(appName, () => App);

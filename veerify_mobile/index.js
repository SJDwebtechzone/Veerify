/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// Firebase requires the background message handler to be registered
// at the module top level so it survives an app cold-start from the
// notification tray. The require() is wrapped in a try/catch because
// the @react-native-firebase native module isn't part of the JS
// bundle until the Android/iOS binary is rebuilt after `npm install`
// — without this guard the entirae app red-boxes with
// "Native module RNFBAppModule not found" on Metro reload even
// though the JS package is present. When the native side is missing
// we log once and skip; the in-app notification bell keeps working
// regardless.
try {
  // eslint-disable-next-line global-require
  const messaging = require('@react-native-firebase/messaging').default;
  messaging().setBackgroundMessageHandler(async (remoteMessage) => {
    // eslint-disable-next-line no-console
    console.log('[fcm][bg] message received:', remoteMessage?.messageId);
  });
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn(
    '[fcm][bg] background handler NOT registered — @react-native-firebase '
    + 'native module missing. Rebuild the Android/iOS app after installing '
    + 'the package. Detail:', err && err.message,
  );
}

AppRegistry.registerComponent(appName, () => App);

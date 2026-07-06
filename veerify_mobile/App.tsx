import React from 'react';
import { LogBox } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { InstitutionProvider } from './src/context/InstitutionContext';
import { ChildProvider } from './src/context/ChildContext';
import { NotificationAlertProvider } from './src/context/NotificationAlertContext';
import AppNavigator from './src/navigation/AppNavigator';
import { ConfirmDialogHost } from './src/components/ConfirmDialog';

// React Navigation fires a dev-only warning whenever a GO_BACK / CLOSE_DRAWER
// action bubbles up to the root without being handled — most commonly when
// the user hits Android's hardware back button on a root screen (Welcome,
// Login, etc.). The app behaves correctly (the OS closes the screen / app),
// but the red overlay is noisy. Production builds never see this warning;
// silencing it in dev keeps the LogBox clean while debugging.
LogBox.ignoreLogs([
  "The action 'GO_BACK' was not handled by any navigator.",
]);

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <InstitutionProvider>
          <ChildProvider>
            {/* Polls /api/notifications while signed in. On every new
                arrival it vibrates, plays an optional tone, and slides
                an in-app banner down from the top of the screen. */}
            <NotificationAlertProvider>
              <AppNavigator />
              {/* Imperative styled confirm() dialog host — must be inside
                  SafeAreaProvider so its statusBar overlay sits right. */}
              <ConfirmDialogHost />
            </NotificationAlertProvider>
          </ChildProvider>
        </InstitutionProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

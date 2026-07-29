import React, { useEffect } from 'react';
import { LogBox } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { InstitutionProvider } from './src/context/InstitutionContext';
import { ChildProvider } from './src/context/ChildContext';
import { NotificationAlertProvider } from './src/context/NotificationAlertContext';
import AppNavigator from './src/navigation/AppNavigator';
import { ConfirmDialogHost } from './src/components/ConfirmDialog';
import GlobalNotificationBell from './src/components/GlobalNotificationBell';
// FCM tap handlers — foreground alert, background tap navigation,
// and terminated-launch tap navigation. Reads the shared navigation
// ref set inside AppNavigator, so it's safe to attach once at root.
import { attachHandlers as attachFcmHandlers } from './src/services/fcm.service';
// Top-level error boundary — contains first-launch crashes so the
// user sees a Retry card instead of the OS killing the app back to
// the launcher. Only rendered outside every provider so a provider
// failing to mount can never bring the boundary down with it.
import ErrorBoundary from './src/components/ErrorBoundary';

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
  useEffect(() => {
    // Attach foreground / background / terminated-tap listeners
    // once. The service latches internally so a re-mount from
    // hot-reload doesn't stack duplicate subscriptions.
    attachFcmHandlers();
  }, []);

  return (
    <ErrorBoundary>
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
                {/* Floating notification bell that stays visible on every
                    screen (guest + all logged-in roles). Rendered outside
                    AppNavigator so it doesn't have to be plumbed through
                    each screen's header. Hides itself on auth screens and
                    on the notifications screen itself. */}
                <GlobalNotificationBell />
              </NotificationAlertProvider>
            </ChildProvider>
          </InstitutionProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

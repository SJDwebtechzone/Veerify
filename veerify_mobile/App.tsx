import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { InstitutionProvider } from './src/context/InstitutionContext';
import { ChildProvider } from './src/context/ChildContext';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <InstitutionProvider>
          <ChildProvider>
            <AppNavigator />
          </ChildProvider>
        </InstitutionProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

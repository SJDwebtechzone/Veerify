import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ThemeProvider } from './lib/theme';
import { AuthProvider } from './lib/auth';
import { NotificationsProvider } from './lib/notifications';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <NotificationsProvider>
         <BrowserRouter basename="/admin">
  <App />
</BrowserRouter>
        </NotificationsProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
);

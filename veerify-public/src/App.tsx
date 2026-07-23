// src/App.tsx

import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import LandingPage from './pages/LandingPage';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsAndConditions from './pages/TermsAndConditions';
import RefundCancellationPolicy from './pages/RefundCancellationPolicy';
import ChildSafety from './pages/ChildSafety';
import AccountDeletion from './pages/AccountDeletion';
import Contact from './pages/Contact';

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Marketing */}
        <Route path="/" element={<LandingPage />} />

        {/* Legal Pages */}
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route
          path="/terms-and-conditions"
          element={<TermsAndConditions />}
        />
        <Route
          path="/refund-cancellation-policy"
          element={<RefundCancellationPolicy />}
        />
        <Route path="/child-safety" element={<ChildSafety />} />
        <Route path="/account-deletion" element={<AccountDeletion />} />
        <Route path="/contact" element={<Contact />} />

        {/* Redirect to Admin */}
        <Route path="/admin/*" element={<HardRedirect to="/admin" />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

interface HardRedirectProps {
  to: string;
}

const HardRedirect: React.FC<HardRedirectProps> = ({ to }) => {
  useEffect(() => {
    window.location.href = to;
  }, [to]);

  return null;
};

export default App;
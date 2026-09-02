import { Routes, Route } from 'react-router-dom';
import {
  BookOpen,
  Wallet,
  Bell,
  Star,
  Settings,
} from 'lucide-react';
import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { Banners } from './pages/cms/Banners';
import { Categories } from './pages/cms/Categories';
import { Videos } from './pages/cms/Videos';
import { Events } from './pages/cms/Events';
// Super-admin review queue for Intra-Level (cross-institution)
// events submitted from the mobile app. See
// src/pages/events/EventApprovals.tsx.
import { EventApprovals } from './pages/events/EventApprovals';
import { InstitutionsPending } from './pages/institutions/InstitutionsPending';
import { InstitutionDetail } from './pages/institutions/InstitutionDetail';
import { InstitutionsList } from './pages/institutions/InstitutionsList';
import { Broadcasts } from './pages/notifications/Broadcasts';
import { TrainersList } from './pages/trainers/TrainersList';
import { StudentsList } from './pages/students/StudentsList';
import { InstitutionMarketplaceSettings } from './pages/settings/InstitutionMarketplaceSettings';
import { MarketplaceSettings } from './pages/settings/MarketplaceSettings';
import { Plans } from './pages/settings/Plans';
import { InstitutionPayouts } from './pages/payments/InstitutionPayouts';
import { SubscriptionPayments } from './pages/payments/SubscriptionPayments';
import { ReferralSettings } from './pages/settings/ReferralSettings';
import { Profile } from './pages/Profile';
import { AccountSettings } from './pages/AccountSettings';
import { Feedback } from './pages/feedback/Feedback';
import { Faqs } from './pages/faqs/Faqs';
import { SampleCertificates } from './pages/certificates/SampleCertificates';
import { LegalPageEditor } from './pages/legal/LegalPageEditor';
import PrivacyPolicy         from './pages/PrivacyPolicy';
import TermsAndConditions    from './pages/TermsAndConditions';
import RefundCancellationPolicy from './pages/RefundCancellationPolicy';

export default function App() {
  return (
    <Routes>
      {/* Public routes (no auth required) */}
      <Route path="/login" element={<Login />} />
      <Route path="/privacy-policy"             element={<PrivacyPolicy />} />
      <Route path="/terms-and-conditions"       element={<TermsAndConditions />} />
      <Route path="/refund-cancellation-policy" element={<RefundCancellationPolicy />} />

      {/* Protected app shell */}
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />

        {/* Institutions */}

        <Route path="/institutions" element={<InstitutionsList />} />
        <Route path="/institutions/active" element={<InstitutionsList presetFilter="active" pageTitle="Active Institutions" pageSubtitle="Academies currently live on Veerify." />} />
        <Route path="/institutions/expired" element={<InstitutionsList presetFilter="expired" pageTitle="Expired Plans" pageSubtitle="Subscriptions past their end date." />} />
        <Route path="/institutions/pending" element={<InstitutionsPending />} />
        <Route path="/institutions/:id" element={<InstitutionDetail />} />
        <Route path="/institutions/:id/marketplace" element={<InstitutionMarketplaceSettings />} />


        {/* Students */}
        <Route path="/students" element={<StudentsList />} />

        {/* Trainers */}
        <Route path="/trainers" element={<TrainersList />} />

        {/* Courses */}
        <Route path="/courses" element={<PlaceholderPage title="Courses" icon={BookOpen} />} />
        <Route path="/courses/videos" element={<PlaceholderPage title="Videos" icon={BookOpen} />} />
        <Route path="/courses/syllabus" element={<PlaceholderPage title="Syllabus" icon={BookOpen} />} />

        {/* Mobile App CMS */}
        <Route path="/mobile/banners" element={<Banners />} />
        <Route path="/mobile/categories" element={<Categories />} />
        <Route path="/mobile/videos" element={<Videos />} />
        <Route path="/mobile/events" element={<Events />} />

        {/* Event Approvals — Intra-Level events awaiting super-admin
            action before they fan out to every institution's feed. */}
        <Route path="/events/approvals" element={<EventApprovals />} />

        {/* Payments */}
        <Route path="/payments" element={<InstitutionPayouts />} />
        <Route path="/payments/subscriptions" element={<SubscriptionPayments />} />
        <Route path="/payments/pending" element={<PlaceholderPage title="Pending Payments" icon={Wallet} />} />

        {/* Notifications */}
        <Route path="/notifications" element={<Broadcasts />} />
        <Route path="/notifications/push" element={<PlaceholderPage title="Push Notifications" icon={Bell} />} />
        <Route path="/notifications/emails" element={<PlaceholderPage title="Email Templates" icon={Bell} />} />

        {/* Ratings */}
        <Route path="/ratings" element={<PlaceholderPage title="Reviews" icon={Star} />} />
        <Route path="/ratings/trainers" element={<PlaceholderPage title="Trainer Ratings" icon={Star} />} />

        {/* Feedback — user feedback from every mobile role. */}
        <Route path="/feedback" element={<Feedback />} />

        {/* FAQs — dynamic FAQ manager. Super-admin CRUDs entries here;
            mobile app fetches them role-scoped via GET /api/faqs. */}
        <Route path="/faqs" element={<Faqs />} />

        {/* Sample Certificate Templates — super-admin manages the
            global samples every institution can preview + copy. */}
        <Route path="/certificate-templates" element={<SampleCertificates />} />

        {/* Platform-wide Legal / policy pages — super-admin editor.
            One route serves all five policies; the :slug URL param
            selects which page the editor loads and saves. */}
        <Route path="/legal/:slug" element={<LegalPageEditor />} />

        {/* Settings */}
        <Route path="/settings" element={<PlaceholderPage title="General Settings" icon={Settings} />} />
        <Route path="/settings/plans" element={<Plans />} />
        <Route path="/settings/marketplace" element={<MarketplaceSettings />} />
        <Route path="/settings/referral" element={<ReferralSettings />} />

        {/* My Profile — super-admin's own card. Reachable from the navbar
            avatar menu. Persists edits to /api/auth/me/profile. */}
        <Route path="/profile" element={<Profile />} />

        {/* Account Settings — change email (with OTP), change password,
            and view recent account activity. */}
        <Route path="/account/settings" element={<AccountSettings />} />

        {/* Fallback */}
        <Route path="*" element={<PlaceholderPage title="Page not found" description="The page you're looking for doesn't exist." />} />


      </Route>
    </Routes>
  );
}

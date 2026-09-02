import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, Image, ActivityIndicator, StatusBar, StyleSheet, Platform } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { navigationRef } from './navigationRef';
import { palette, type } from '../theme';

// Auth screens
import WelcomeScreen from '../screens/WelcomeScreen';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import ChangePasswordScreen from '../screens/ChangePasswordScreen';
import SendFeedbackScreen from '../screens/SendFeedbackScreen';
import DeleteAccountScreen from '../screens/DeleteAccountScreen';
import SelectInstitutionScreen from '../screens/SelectInstitutionScreen';

// Admin — onboarding
import PlanSelectionScreen from '../screens/admin/PlanSelectionScreen';
import PendingApprovalScreen from '../screens/admin/PendingApprovalScreen';
import PaymentScreen from '../screens/admin/PaymentScreen';

// Admin — dashboard
import AdminTabNavigator from './AdminTabNavigator';
import SetupInstitutionScreen from '../screens/admin/SetupInstitutionScreen';
import AccountDeletedScreen from '../screens/admin/AccountDeletedScreen';
import StudentDetailScreen from '../screens/admin/StudentDetailScreen';
import EditStudentScreen from '../screens/admin/EditStudentScreen';
import CoursesListScreen from '../screens/admin/CoursesListScreen';
import CreateCourseScreen from '../screens/admin/CreateCourseScreen';
import AdminCourseDetailScreen from '../screens/admin/AdminCourseDetailScreen';
import BatchesListScreen from '../screens/admin/BatchesListScreen';
import CreateBatchScreen from '../screens/admin/CreateBatchScreen';
import CreateEventScreen from '../screens/admin/CreateEventScreen';
import EventsListScreen from '../screens/admin/EventsListScreen';
import EventDetailScreen from '../screens/EventDetailScreen';
import InstitutionEventDetailScreen from '../screens/admin/InstitutionEventDetailScreen';
// MODULE 2: Select students for event registration.
import SelectStudentsForEventScreen from '../screens/admin/SelectStudentsForEventScreen';
// MODULE 3 (placeholder): dynamic Registration Form screen — landing
// target for the SelectStudents Continue button.
import EventRegistrationFormScreen from '../screens/admin/EventRegistrationFormScreen';
// MODULE 4: Organizer Registration Management screens.
import EventRegistrationsListScreen  from '../screens/admin/EventRegistrationsListScreen';
import EventRegistrationDetailScreen from '../screens/admin/EventRegistrationDetailScreen';
import EventRegistrationsTableScreen from '../screens/admin/EventRegistrationsTableScreen';
import PricingPlansScreen from '../screens/admin/PricingPlansScreen';
import AdminBatchStudentsScreen from '../screens/admin/AdminBatchStudentsScreen';
import TrainersListScreen from '../screens/admin/TrainersListScreen';
import CreateTrainerScreen from '../screens/admin/CreateTrainerScreen';
import SendAnnouncementScreen from '../screens/admin/SendAnnouncementScreen';
import SentNotificationsScreen from '../screens/SentNotificationsScreen';
import PendingAnnouncementsScreen from '../screens/admin/PendingAnnouncementsScreen';
import PendingAnnouncementDetailScreen from '../screens/PendingAnnouncementDetailScreen';
import AdminTrainerLeavesScreen from '../screens/admin/AdminTrainerLeavesScreen';
import AdminReferEarnScreen from '../screens/admin/AdminReferEarnScreen';
// Recent Activity — full-screen feed opened from the dashboard
// teaser's "See all" link. Uses the shared /admin/recent-activity
// endpoint with the same branch scope as the dashboard.
import RecentActivityScreen from '../screens/admin/RecentActivityScreen';
// Monthly Revenue → Details drill-down. Same revenueScope as the
// dashboard chart, so totals never disagree between the two surfaces.
import RevenueDetailsScreen from '../screens/admin/RevenueDetailsScreen';
import AdminCertificatesScreen from '../screens/admin/AdminCertificatesScreen';
import AdminDispatchedCertificatesScreen from '../screens/admin/AdminDispatchedCertificatesScreen';
import CertificateTemplatesScreen from '../screens/admin/CertificateTemplatesScreen';
import CertificateTemplateEditorScreen from '../screens/admin/CertificateTemplateEditorScreen';
import AdminSalaryScreen from '../screens/admin/AdminSalaryScreen';
import AdminAttendanceSummaryScreen from '../screens/admin/AdminAttendanceSummaryScreen';
// Institution Login → Home → Attendance tile lands on the Overview
// (batch-wise summary); tapping a batch drills into the per-student
// detail for the picked date.
import AdminAttendanceOverviewScreen from '../screens/admin/AdminAttendanceOverviewScreen';
import AdminAttendanceDetailScreen from '../screens/admin/AdminAttendanceDetailScreen';
import InstitutionLegalScreen from '../screens/admin/InstitutionLegalScreen';
import LegalScreen from '../screens/shared/LegalScreen';
import SupportScreen from '../screens/shared/SupportScreen';
import FaqScreen from '../screens/shared/FaqScreen';
import StudentCertificatesScreen from '../screens/student/StudentCertificatesScreen';
import StudentEnrolledProgramsScreen from '../screens/student/StudentEnrolledProgramsScreen';
import StudentAttendanceScreen from '../screens/student/StudentAttendanceScreen';
import StudentPaymentsScreen from '../screens/student/StudentPaymentsScreen';
import StudentEditProfileScreen from '../screens/student/StudentEditProfileScreen';
import SettingsScreen from '../screens/admin/SettingsScreen';
import InstitutionBrandingScreen from '../screens/admin/InstitutionBrandingScreen';
import BranchesListScreen from '../screens/admin/BranchesListScreen';
import CreateBranchScreen from '../screens/admin/CreateBranchScreen';
import BranchDashboardScreen from '../screens/admin/BranchDashboardScreen';
import UpdateLocationScreen from '../screens/admin/UpdateLocationScreen';
import AcademyProfileScreen from '../screens/admin/AcademyProfileScreen';

// Student
import StudentTabNavigator from './StudentTabNavigator';
// InstitutionDetailScreen was removed — its content is now rendered
// inline on the Home tab (banner + academy details + course list) so
// tapping a nearby academy no longer pushes a new screen.
import AllInstitutionsScreen from '../screens/student/AllInstitutionsScreen';
import CategoryAcademiesScreen from '../screens/student/CategoryAcademiesScreen';
import CourseDetailScreen from '../screens/student/CourseDetailScreen';
import PublicTrainerProfileScreen from '../screens/student/PublicTrainerProfileScreen';
import BatchDetailScreen from '../screens/student/BatchDetailScreen';
import MyAttendanceScreen from '../screens/student/MyAttendanceScreen';
import MyEnrollmentsScreen from '../screens/student/MyEnrollmentsScreen';
import ParentRequestsScreen from '../screens/student/ParentRequestsScreen';
import EnrollmentFormScreen from '../screens/student/EnrollmentFormScreen';
import EnrollmentPaymentScreen from '../screens/student/EnrollmentPaymentScreen';
import EnrolledCourseScreen from '../screens/student/EnrolledCourseScreen';

// Trainer / Staff
import StaffTabNavigator from './StaffTabNavigator';
import StaffNotificationsScreen from '../screens/staff/StaffNotificationsScreen';
import StaffAttendanceHistoryScreen from '../screens/staff/StaffAttendanceHistoryScreen';
// Both trainer and branch admin share the same attendance screen —
// route.params.mode swaps the batches endpoint + downstream route
// names. See StaffAttendanceScreen for the mode contract.
import StaffAttendanceScreen from '../screens/staff/StaffAttendanceScreen';
import StaffStudentDetailScreen from '../screens/staff/StaffStudentDetailScreen';
import StaffLeaveRequestsScreen from '../screens/staff/StaffLeaveRequestsScreen';
import StaffCompletedStudentsScreen from '../screens/staff/StaffCompletedStudentsScreen';
import StaffSalaryScreen from '../screens/staff/StaffSalaryScreen';
import StaffVideosScreen from '../screens/staff/StaffVideosScreen';
import TrainerRequestLeaveScreen from '../screens/staff/TrainerRequestLeaveScreen';
import TrainerSendAnnouncementScreen from '../screens/staff/TrainerSendAnnouncementScreen';
import StaffPerformanceReportsScreen from '../screens/staff/StaffPerformanceReportsScreen';
import StaffPerformanceReportFormScreen from '../screens/staff/StaffPerformanceReportFormScreen';
import StudentPerformanceReportsScreen from '../screens/student/StudentPerformanceReportsScreen';
import StudentPerformanceReportDetailScreen from '../screens/student/StudentPerformanceReportDetailScreen';
import StudentBeltJourneyScreen from '../screens/student/StudentBeltJourneyScreen';
import CertificateDetailScreen from '../screens/student/CertificateDetailScreen';
import StaffPromoteStudentScreen from '../screens/staff/StaffPromoteStudentScreen';
import BatchStudentsScreen from '../screens/trainer/BatchStudentsScreen';
import AttendanceHistoryScreen from '../screens/trainer/AttendanceHistoryScreen';

// Parent
import ParentTabNavigator from './ParentTabNavigator';
import LinkChildScreen from '../screens/parent/LinkChildScreen';
import LinkedChildrenScreen from '../screens/parent/LinkedChildrenScreen';
import ChildProgressScreen from '../screens/parent/ChildProgressScreen';
import ChildAchievementsScreen from '../screens/parent/ChildAchievementsScreen';
import InformLeaveScreen from '../screens/parent/InformLeaveScreen';
import ChildEventsScreen from '../screens/parent/ChildEventsScreen';
import ChildDetailScreen from '../screens/parent/ChildDetailScreen';
import ChildAttendanceScreen from '../screens/parent/ChildAttendanceScreen';
import ChildPaymentsScreen from '../screens/parent/ChildPaymentsScreen';
import ChildProfileScreen from '../screens/parent/ChildProfileScreen';

const Stack = createNativeStackNavigator();

// Which screen should admin land on based on onboarding status?
const getAdminInitialRoute = (onboardingStatus) => {
  switch (onboardingStatus) {
    case 'registered':
    case null:
    case undefined:
      return 'PlanSelection';
    case 'plan_selected':
      return 'SetupInstitution';
    case 'setup_complete':
    case 'pending_approval':
    case 'rejected':
      return 'PendingApproval';
    case 'approved':
    case 'payment_pending':
      return 'PaymentScreen';
    case 'active':
      return 'AdminDashboard';
    case 'deleted':
      // Soft-deleted institution. Owner's user account is alive; we show
      // them Restore / Start Fresh on the AccountDeleted screen.
      return 'AccountDeleted';
    default:
      return 'PlanSelection';
  }
};

export default function AppNavigator() {
  const { user, loading, onboardingStatus } = useAuth();

  // ── Splash / loading state ──
  // Rendered while AuthContext restores the saved session from
  // storage. Doubles as the app's JS-level splash: brand logo,
  // "Veerify" wordmark, and the "#1 Martial Arts App" tagline stay
  // visible for the entire duration of the auth-restore step so the
  // viewer never sees a jarring blank screen between the native
  // splash and the first navigator screen.
  //
  // Order (top → bottom):
  //   1. Logo (existing circular mark)
  //   2. "Veerify"  — brand name in the brand red
  //   3. "#1 Martial Arts App" — tagline, tighter tracking
  if (loading) {
    return (
      <View style={splashStyles.screen}>
        {/* Dark status-bar content on the new white background so
            the OS clock / battery icons stay readable. */}
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <View style={splashStyles.logoWrap}>
          <Image
            source={require('../assets/veerify-logo.png')}
            style={splashStyles.logoImage}
            // cover fills the 148×148 circle edge-to-edge. If the
            // logo asset has whitespace baked in and this crops the
            // mark tightly, switch to "contain" — the circular
            // borderRadius on the wrap is what makes it round.
            resizeMode="cover"
          />
        </View>
        <Text style={splashStyles.brand}>Veerify</Text>
        <Text style={splashStyles.tagline}>#1 Martial Arts App</Text>
        <ActivityIndicator
          size="small"
          color={palette.purple.vivid}
          style={splashStyles.spinner}
        />
      </View>
    );
  }

  // ── NOT LOGGED IN ──
  if (!user) {
    return (
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Welcome" component={WelcomeScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
          {/* ForgotPasswordScreen renders its own header, so the stack hides
              the native bar to avoid stacking two. */}
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="GuestHome" component={StudentTabNavigator} />
          <Stack.Screen name="SelectInstitution" component={SelectInstitutionScreen}
            // No nav header at all — the screen body already has a big
            // "Choose your academy" heading, and the user can use the
            // Android hardware back button or iOS swipe-back gesture to
            // return to the previous screen.
            options={{ headerShown: false }} />
          <Stack.Screen name="AllInstitutions" component={AllInstitutionsScreen}
            options={{ headerShown: true, title: 'All Academies' }} />
          {/* CategoryAcademies — list of academies offering a specific
              CMS category. Reached from the Home tab's Categories row. */}
          <Stack.Screen name="CategoryAcademies" component={CategoryAcademiesScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="CourseDetail" component={CourseDetailScreen}
            options={{ headerShown: false }} />
          {/* Public trainer profile — reached from CourseDetail's
              Trainer card. Renders its own header. */}
          <Stack.Screen name="PublicTrainerProfile" component={PublicTrainerProfileScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="BatchDetail" component={BatchDetailScreen}
            options={{ headerShown: true, title: '' }} />
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  // ── ADMIN ──
  if (user.role === 'admin') {
    const initialRoute = getAdminInitialRoute(onboardingStatus);
    console.log('[NAV] admin stack mounting → onboardingStatus=', onboardingStatus, '→ initialRoute=', initialRoute);
    return (
      <NavigationContainer ref={navigationRef}>
        {/* key= forces the navigator to fully remount whenever the onboarding
            status changes, so initialRouteName is re-evaluated. Without this,
            initialRouteName is only honored on the first mount and any later
            status change is ignored. */}
        <Stack.Navigator
          key={`admin-${onboardingStatus || 'unknown'}`}
          screenOptions={{
            headerShown: false,
            // Institution-admin design system: every screen in the
            // admin stack sits on the same light-blue glass base as
            // the Home/Dashboard. This kills the flash of white
            // background between screen transitions and gives the
            // whole Institution Login experience one unified feel.
            // Individual screens can still paint the ambient SVG
            // blobs on top via <InstitutionScreenBackground />.
            contentStyle: { backgroundColor: '#F1F6FB' },
          }}
          initialRouteName={initialRoute}
        >
          {/* Onboarding screens */}
          <Stack.Screen
            name="PlanSelection"
            component={PlanSelectionScreen}
            options={{ headerShown: true, title: 'Choose Your Plan', headerBackVisible: false }}
          />
          {/* SetupInstitution renders its own progress header, so we
              hide the native stack header to avoid stacking two bars. */}
          <Stack.Screen
            name="SetupInstitution"
            component={SetupInstitutionScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="PendingApproval"
            component={PendingApprovalScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="PaymentScreen"
            component={PaymentScreen}
            options={{ headerShown: true, title: 'Complete Payment', headerBackVisible: false }}
          />
          <Stack.Screen
            name="AccountDeleted"
            component={AccountDeletedScreen}
            options={{ headerShown: false }}
          />

          {/* Dashboard screens — accessible only after active */}
          <Stack.Screen name="AdminDashboard" component={AdminTabNavigator} />
          {/* Self-service password change. Auto-opened on first login
              for sub-branch admins (users.must_change_password = TRUE),
              also reachable from More → Account. headerShown=false
              because the screen has its own header bar. */}
          <Stack.Screen
            name="ChangePassword"
            component={ChangePasswordScreen}
            options={{ headerShown: false }}
          />
          {/* SendFeedback — shared screen every role opens from their
              More / Profile tab. Renders its own header. */}
          <Stack.Screen
            name="SendFeedback"
            component={SendFeedbackScreen}
            options={{ headerShown: false }}
          />
          {/* DeleteAccount — self-service permanent deletion. Renders
              its own header. Accessible from every role's stack so a
              future entry point on any tab can reuse this route. */}
          <Stack.Screen
            name="DeleteAccount"
            component={DeleteAccountScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen name="StudentDetail" component={StudentDetailScreen} />
          <Stack.Screen name="EditStudent" component={EditStudentScreen} options={{ headerShown: false }} />
          <Stack.Screen name="CoursesList" component={CoursesListScreen} />
          <Stack.Screen name="CreateCourse" component={CreateCourseScreen}
            options={{ headerShown: true, title: 'New Course' }} />
          {/* AdminCourseDetailScreen renders its own image hero so we hide
              the native stack header to avoid stacking two bars. */}
          <Stack.Screen name="AdminCourseDetail" component={AdminCourseDetailScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="BatchesList" component={BatchesListScreen} />
          {/* BranchesListScreen renders its own header + FAB. */}
          <Stack.Screen name="BranchesList" component={BranchesListScreen}
            options={{ headerShown: false }} />
          {/* Branch Dashboard — read-only aggregated view of one
              sub-branch (students / revenue / attendance). Reached by
              tapping a sub-branch card on the BranchesList. */}
          <Stack.Screen name="BranchDashboard" component={BranchDashboardScreen}
            options={{ headerShown: false }} />
          {/* CreateBranchScreen — add / edit a satellite branch. Renders
              its own header, so the stack header stays hidden. */}
          <Stack.Screen name="CreateBranch" component={CreateBranchScreen}
            options={{ headerShown: false }} />
          {/* UpdateLocationScreen — sub-branch admin updates their branch's
              GPS coords + address. Renders its own header. */}
          <Stack.Screen name="UpdateLocation" component={UpdateLocationScreen}
            options={{ headerShown: false }} />
          {/* AcademyProfileScreen — view + edit modes for the institution's
              full profile. Opened by tapping the name/logo card in More. */}
          <Stack.Screen name="AcademyProfile" component={AcademyProfileScreen}
            options={{ headerShown: false }} />
          {/* Drill into a single batch from BatchesList — shows enrolled
              students, contact chips, payment status, and an Add Student
              FAB pre-bound to the batch. */}
          <Stack.Screen name="AdminBatchStudents" component={AdminBatchStudentsScreen}
            options={{ headerShown: false }} />
          {/* Shared bulk-attendance marking screen. Same component the
              trainer uses — the backend accepts admin role too (branch
              admins mark for their own branch's batches), so we reuse
              it here to avoid duplicating the roster + toggle grid. */}
          {/* BatchStudentsScreen renders its own polished header + sticky
              save bar, so we suppress the stack header to avoid two
              stacked title bars. */}
          <Stack.Screen name="BatchStudents" component={BatchStudentsScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="CreateBatch" component={CreateBatchScreen}
            // CreateBatchScreen renders its own in-page header (back arrow
            // + "New Batch" + subtitle). Hiding the stack header so the
            // title doesn't appear twice.
            options={{ headerShown: false }} />
          {/* CreateEventScreen renders its own header. */}
          <Stack.Screen name="CreateEvent" component={CreateEventScreen}
            options={{ headerShown: false }} />
          {/* EventsListScreen renders its own header. */}
          <Stack.Screen name="EventsList" component={EventsListScreen}
            options={{ headerShown: false }} />
          {/* EventDetailScreen — shared detail view used by admin /
              trainer / student. Renders its own header. */}
          <Stack.Screen name="EventDetail" component={EventDetailScreen}
            options={{ headerShown: false }} />
          {/* InstitutionEventDetailScreen — view-only detail screen
              for institution admins. Shows all event creation fields
              in a clean, read-only layout. */}
          <Stack.Screen name="InstitutionEventDetail" component={InstitutionEventDetailScreen}
            options={{ headerShown: false }} />
          {/* MODULE 2: Select-students flow launched from the
              EventDetail "Register Students" button. Own header. */}
          <Stack.Screen name="SelectStudentsForEvent" component={SelectStudentsForEventScreen}
            options={{ headerShown: false }} />
          {/* MODULE 3: landing screen for the Continue button in
              SelectStudents. Owns its own header. */}
          <Stack.Screen name="EventRegistrationForm" component={EventRegistrationFormScreen}
            options={{ headerShown: false }} />
          {/* MODULE 4: Organizer registration list + detail. */}
          <Stack.Screen name="EventRegistrationsList" component={EventRegistrationsListScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="EventRegistrationDetail" component={EventRegistrationDetailScreen}
            options={{ headerShown: false }} />
          {/* Registered Students TABLE view — launched from
              InstitutionEventDetail's "Registered Students" button.
              Horizontally-scrollable table + CSV export. */}
          <Stack.Screen name="EventRegistrationsTable" component={EventRegistrationsTableScreen}
            options={{ headerShown: false }} />
          {/* PricingPlansScreen — reached from More tab. Renders its own header. */}
          <Stack.Screen name="PricingPlans" component={PricingPlansScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="TrainersList" component={TrainersListScreen} />
          {/* CreateTrainerScreen renders its own header so we hide the
              native stack header to avoid stacking two bars. */}
          <Stack.Screen name="CreateTrainer" component={CreateTrainerScreen}
            options={{ headerShown: false }} />
          {/* SendAnnouncement renders its own header. */}
          <Stack.Screen name="SendAnnouncement" component={SendAnnouncementScreen}
            options={{ headerShown: false }} />
          {/* AdminTrainerLeavesScreen renders its own header. */}
          <Stack.Screen name="AdminTrainerLeaves" component={AdminTrainerLeavesScreen}
            options={{ headerShown: false }} />
          {/* Trainer announcement approval queue — admin reviews drafts. */}
          <Stack.Screen name="PendingAnnouncements" component={PendingAnnouncementsScreen}
            options={{ headerShown: false }} />
          {/* Detail screen for a single trainer-submitted draft. Reached
              from the inbox nudge ("Trainer announcement awaiting approval")
              and from rows in PendingAnnouncementsScreen. */}
          <Stack.Screen name="PendingAnnouncementDetail" component={PendingAnnouncementDetailScreen}
            options={{ headerShown: false }} />
          {/* AdminReferEarnScreen renders its own header. */}
          <Stack.Screen name="AdminReferEarn" component={AdminReferEarnScreen}
            options={{ headerShown: false }} />
          {/* Full Recent Activity feed — opened from the dashboard
              teaser's "See all" link. Screen owns its own header. */}
          <Stack.Screen name="RecentActivity" component={RecentActivityScreen}
            options={{ headerShown: false }} />
          {/* Monthly Revenue Details — opened from the dashboard chart's
              "Details" link. Screen owns its own header. */}
          <Stack.Screen name="RevenueDetails" component={RevenueDetailsScreen}
            options={{ headerShown: false }} />
          {/* Admins reuse the same Notifications inbox as staff/parent —
              it scopes to the calling user via JWT, so it works for every role. */}
          <Stack.Screen name="StaffNotifications" component={StaffNotificationsScreen} />
          <Stack.Screen name="SentNotifications" component={SentNotificationsScreen}
            options={{ headerShown: false }} />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ headerShown: true, title: 'Marketplace Settings' }}
          />
          {/* More → Branding → manage promo banners shown on the
              student & trainer mobile dashboards. */}
          <Stack.Screen
            name="InstitutionBranding"
            component={InstitutionBrandingScreen}
            options={{ headerShown: false }}
          />
          {/* Institution → Certificates queue. Lists students awaiting
              certificate + surfaces the trainer's belt-test remarks. */}
          <Stack.Screen
            name="AdminCertificates"
            component={AdminCertificatesScreen}
            options={{ headerShown: false }}
          />
          {/* Institution → Dispatched Certificates archive. Lists
              every issued cert with a mini preview; tap opens the
              exact artwork via CertificateDetail (student's viewer). */}
          <Stack.Screen
            name="AdminDispatchedCertificates"
            component={AdminDispatchedCertificatesScreen}
            options={{ headerShown: false }}
          />
          {/* Certificate viewer — reused verbatim from the student
              side so the admin sees the exact artwork that was
              dispatched (same template, placeholders, QR link). */}
          <Stack.Screen
            name="CertificateDetail"
            component={CertificateDetailScreen}
            options={{ headerShown: false }}
          />
          {/* Certificate Templates CRUD + editor. Institution admin
              uploads a background, places placeholder pins, saves. */}
          <Stack.Screen
            name="CertificateTemplates"
            component={CertificateTemplatesScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="CertificateTemplateEditor"
            component={CertificateTemplateEditorScreen}
            options={{ headerShown: false }}
          />
          {/* Payroll — institution admin's monthly Salary workflow.
              Reached from More → Salary. Renders its own header so we
              hide the stack bar. */}
          <Stack.Screen
            name="AdminSalary"
            component={AdminSalaryScreen}
            options={{ headerShown: false }}
          />
          {/* Read-only Attendance Summary for institution admins.
              Replaces the trainer's marking screen when opened from
              the Batch Students header — institutions have read-only
              access per spec. */}
          <Stack.Screen
            name="AdminAttendanceSummary"
            component={AdminAttendanceSummaryScreen}
            options={{ headerShown: false }}
          />
          {/* Institution admin's batch-wise Attendance Overview +
              per-batch student detail. Reached from the Home tile. */}
          <Stack.Screen
            name="AdminAttendanceOverview"
            component={AdminAttendanceOverviewScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="AdminAttendanceDetail"
            component={AdminAttendanceDetailScreen}
            options={{ headerShown: false }}
          />
          {/* Branch Login — Attendance module. Reuses the trainer's
              StaffAttendance screens with route.params.mode='branch'.
              Backend /batches auto-scopes to the caller's branch for
              sub-branch admins, so the batch list is already trimmed
              to that branch's batches server-side. */}
          <Stack.Screen
            name="BranchAttendance"
            component={StaffAttendanceScreen}
            initialParams={{ mode: 'branch' }}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="BranchAttendanceHistory"
            component={StaffAttendanceHistoryScreen}
            initialParams={{ mode: 'branch' }}
            options={{ headerShown: false }}
          />
          {/* Institution-scoped policy editor — one screen, four tiles.
              route.params.slug picks the policy being edited. */}
          <Stack.Screen
            name="InstitutionLegal"
            component={InstitutionLegalScreen}
            options={{ headerShown: false }}
          />
          {/* Admin's read-only Platform Information viewer. Reuses
              the shared LegalScreen with platformOnly=true so the
              Academy shelf is hidden — those pages the admin edits
              from the tiles above, not through this read-only view. */}
          <Stack.Screen
            name="Legal"
            component={LegalScreen}
            options={{ headerShown: false }}
          />
          {/* Support — More tab → Support tile. Institution admins see
              only the App Support address (support@veerifyapp.com). */}
          <Stack.Screen
            name="Support"
            component={SupportScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Faq"
            component={FaqScreen}
            options={{ headerShown: false }}
          />
          {/* Admin "Add Student" quick action opens the same enrollment
              form a student fills when buying a course. Both screens
              render their own headers so the native stack bar is hidden
              to avoid stacking two. */}
          <Stack.Screen name="EnrollmentForm" component={EnrollmentFormScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="EnrollmentPayment" component={EnrollmentPaymentScreen}
            options={{ headerShown: false }} />
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  // ── STUDENT ──
  if (user.role === 'student') {
    return (
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="StudentTabs" component={StudentTabNavigator} />
          {/* First-login password change flow — pops a styled dialog
              after sign-in when users.must_change_password is true,
              also reachable from the More/Profile tab "Change Password"
              row. Same screen across every role's stack. */}
          <Stack.Screen
            name="ChangePassword"
            component={ChangePasswordScreen}
            options={{ headerShown: false }}
          />
          {/* SendFeedback — shared screen every role opens from their
              More / Profile tab. Renders its own header. */}
          <Stack.Screen
            name="SendFeedback"
            component={SendFeedbackScreen}
            options={{ headerShown: false }}
          />
          {/* DeleteAccount — self-service permanent deletion. Renders
              its own header. Accessible from every role's stack so a
              future entry point on any tab can reuse this route. */}
          <Stack.Screen
            name="DeleteAccount"
            component={DeleteAccountScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen name="SelectInstitution" component={SelectInstitutionScreen}
            // No nav header at all — the screen body already has a big
            // "Choose your academy" heading, and the user can use the
            // Android hardware back button or iOS swipe-back gesture to
            // return to the previous screen.
            options={{ headerShown: false }} />
          <Stack.Screen name="AllInstitutions" component={AllInstitutionsScreen}
            options={{ headerShown: true, title: 'All Academies' }} />
          {/* CategoryAcademies — list of academies offering a specific
              CMS category. Reached from the Home tab's Categories row. */}
          <Stack.Screen name="CategoryAcademies" component={CategoryAcademiesScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="CourseDetail" component={CourseDetailScreen}
            options={{ headerShown: false }} />
          {/* Public trainer profile — reached from CourseDetail's
              Trainer card by both students and admin-preview flows. */}
          <Stack.Screen name="PublicTrainerProfile" component={PublicTrainerProfileScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="BatchDetail" component={BatchDetailScreen}
            options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="MyAttendance" component={MyAttendanceScreen}
            options={{ headerShown: true, title: 'My Attendance' }} />
          <Stack.Screen name="MyEnrollments" component={MyEnrollmentsScreen}
            options={{ headerShown: true, title: 'My Courses' }} />
          <Stack.Screen name="ParentRequests" component={ParentRequestsScreen}
            options={{ headerShown: true, title: 'Parent Requests' }} />
          {/* Student's read-only Legal viewer. The shared LegalScreen
              lets students see T&C / Privacy / Refund / Child Safety
              from the platform and Academy Rules from their institution. */}
          <Stack.Screen name="Legal" component={LegalScreen}
            options={{ headerShown: false }} />
          {/* Support — Profile tab → Support row. Students see both the
              App Support address and their own institution's registered
              contact email. */}
          <Stack.Screen name="Support" component={SupportScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="Faq" component={FaqScreen}
            options={{ headerShown: false }} />
          {/* Enrollment flow: form -> payment -> back to MyEnrollments. Both
              screens render their own headers so we hide the native stack bar. */}
          <Stack.Screen name="EnrollmentForm" component={EnrollmentFormScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="EnrollmentPayment" component={EnrollmentPaymentScreen}
            options={{ headerShown: false }} />
          {/* EnrolledCourseScreen renders its own image hero + back button. */}
          <Stack.Screen name="EnrolledCourse" component={EnrolledCourseScreen}
            options={{ headerShown: false }} />
          {/* Shared event detail — students reach this by tapping an event
              card on their Home tab / MyDashboard. */}
          <Stack.Screen name="EventDetail" component={EventDetailScreen}
            options={{ headerShown: false }} />
          {/* Students reuse the same Notifications screen the staff module uses —
              the inbox is per-user via the JWT, so it works for every role. */}
          <Stack.Screen name="StaffNotifications" component={StaffNotificationsScreen} />
          <Stack.Screen name="SentNotifications" component={SentNotificationsScreen}
            options={{ headerShown: false }} />
          {/* Performance reports — list + detail, both render their own headers. */}
          <Stack.Screen name="StudentPerformanceReports"
            component={StudentPerformanceReportsScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="StudentPerformanceReportDetail"
            component={StudentPerformanceReportDetailScreen}
            options={{ headerShown: false }} />
          {/* Belt Badges & Certifications */}
          <Stack.Screen name="StudentBeltJourney"
            component={StudentBeltJourneyScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="CertificateDetail"
            component={CertificateDetailScreen}
            options={{ headerShown: false }} />
          {/* Full Certificates screen — awaiting section + issued list
              with View / Download / Share. */}
          <Stack.Screen name="StudentCertificates"
            component={StudentCertificatesScreen}
            options={{ headerShown: false }} />
          {/* More-tab drill-ins */}
          <Stack.Screen name="StudentEnrolledPrograms"
            component={StudentEnrolledProgramsScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="StudentAttendance"
            component={StudentAttendanceScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="StudentPayments"
            component={StudentPaymentsScreen}
            options={{ headerShown: false }} />
          {/* Student self-service profile editor — name / DOB / gender
              / contact / address / emergency / photo / password. */}
          <Stack.Screen name="StudentEditProfile"
            component={StudentEditProfileScreen}
            options={{ headerShown: false }} />
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  // ── TRAINER ──
  // The five primary screens (Dashboard, Attendance, Students, Notifications,
  // Profile) live inside StaffTabNavigator as bottom tabs. Detail screens
  // (history / student detail / leave / salary) sit ABOVE the tabs and get
  // pushed on top — full-screen, no tab bar visible.
  if (user.role === 'trainer') {
    return (
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="StaffTabs" component={StaffTabNavigator} />
          {/* Legacy route name kept so any code that still calls
              navigation.navigate('TrainerDashboard') continues to land on
              the tabbed shell. */}
          <Stack.Screen name="TrainerDashboard" component={StaffTabNavigator} />
          {/* First-login password change — same flow as the admin stack. */}
          <Stack.Screen
            name="ChangePassword"
            component={ChangePasswordScreen}
            options={{ headerShown: false }}
          />
          {/* SendFeedback — shared screen every role opens from their
              More / Profile tab. Renders its own header. */}
          <Stack.Screen
            name="SendFeedback"
            component={SendFeedbackScreen}
            options={{ headerShown: false }}
          />
          {/* DeleteAccount — self-service permanent deletion. Renders
              its own header. Accessible from every role's stack so a
              future entry point on any tab can reuse this route. */}
          <Stack.Screen
            name="DeleteAccount"
            component={DeleteAccountScreen}
            options={{ headerShown: false }}
          />
          {/* Shared event detail — trainers reach this by tapping an event
              card on their dashboard. */}
          <Stack.Screen name="EventDetail" component={EventDetailScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="StaffAttendanceHistory" component={StaffAttendanceHistoryScreen} />
          <Stack.Screen name="StaffStudentDetail" component={StaffStudentDetailScreen} />
          <Stack.Screen name="StaffLeaveRequests" component={StaffLeaveRequestsScreen} />
          {/* Post-curriculum queue — trainer records belt-test remarks
              here after ticking the last curriculum lesson. Renders
              its own header. */}
          <Stack.Screen name="StaffCompletedStudents" component={StaffCompletedStudentsScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="StaffSalary" component={StaffSalaryScreen} />
          {/* Trainer's read-only Legal viewer. Backend already scopes
              the returned pages to the trainer's role (T&C / Privacy
              + Academy Rules / Belt Test Policy). */}
          <Stack.Screen name="Legal" component={LegalScreen}
            options={{ headerShown: false }} />
          {/* Support — Profile → Support row. Trainers see both the
              platform App Support address and their institution's
              registered contact email. */}
          <Stack.Screen name="Support" component={SupportScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="Faq" component={FaqScreen}
            options={{ headerShown: false }} />
          {/* StaffVideosScreen renders its own header. */}
          <Stack.Screen name="StaffVideos" component={StaffVideosScreen}
            options={{ headerShown: false }} />
          {/* TrainerRequestLeaveScreen renders its own header. */}
          <Stack.Screen name="TrainerRequestLeave" component={TrainerRequestLeaveScreen}
            options={{ headerShown: false }} />
          {/* TrainerSendAnnouncement — composer + approval-gated submit.
              The trainer drafts; the institution admin approves it from
              their PendingAnnouncements queue before students see it. */}
          <Stack.Screen name="TrainerSendAnnouncement" component={TrainerSendAnnouncementScreen}
            options={{ headerShown: false }} />
          {/* Trainers tap their "Announcement approved/rejected" inbox
              entry to land here and see the admin's decision + reason. */}
          <Stack.Screen name="PendingAnnouncementDetail" component={PendingAnnouncementDetailScreen}
            options={{ headerShown: false }} />
          {/* Performance report screens render their own headers. */}
          <Stack.Screen name="StaffPerformanceReports" component={StaffPerformanceReportsScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="StaffPerformanceReportForm" component={StaffPerformanceReportFormScreen}
            options={{ headerShown: false }} />
          {/* Promote student → belt + certificate. */}
          <Stack.Screen name="StaffPromoteStudent" component={StaffPromoteStudentScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="StudentBeltJourney" component={StudentBeltJourneyScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="CertificateDetail" component={CertificateDetailScreen}
            options={{ headerShown: false }} />
          {/* BatchStudentsScreen renders its own polished header + sticky
              save bar, so we suppress the stack header to avoid two
              stacked title bars. */}
          <Stack.Screen name="BatchStudents" component={BatchStudentsScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="AttendanceHistory" component={AttendanceHistoryScreen}
            options={{ headerShown: true, title: 'History' }} />
          {/* Trainer notifications inbox — same screen the student /
              admin / parent stacks use. Previously missing, which is
              why the dashboard's bell silently no-op'd. */}
          <Stack.Screen name="StaffNotifications" component={StaffNotificationsScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="SentNotifications" component={SentNotificationsScreen}
            options={{ headerShown: false }} />
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  // ── PARENT ──
  // ParentTabNavigator holds the five primary destinations (Home / Attendance
  // / Progress / Payments / More) as bottom tabs. Detail screens (LinkedChildren,
  // LinkChild, ChildDetail, ChildCertificates, InformLeave, ChildEvents,
  // ChildProfile) sit ABOVE the tabs — pushing them hides the tab bar.
  if (user.role === 'parent') {
    return (
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="ParentTabs" component={ParentTabNavigator} />
          {/* Legacy route — keep so any direct navigate('ParentDashboard')
              still lands on the tabbed shell (which boots into Home). */}
          <Stack.Screen name="ParentDashboard" component={ParentTabNavigator} />
          {/* First-login password change — same flow as every other role. */}
          <Stack.Screen
            name="ChangePassword"
            component={ChangePasswordScreen}
            options={{ headerShown: false }}
          />
          {/* SendFeedback — shared screen every role opens from their
              More / Profile tab. Renders its own header. */}
          <Stack.Screen
            name="SendFeedback"
            component={SendFeedbackScreen}
            options={{ headerShown: false }}
          />
          {/* DeleteAccount — self-service permanent deletion. Renders
              its own header. Accessible from every role's stack so a
              future entry point on any tab can reuse this route. */}
          <Stack.Screen
            name="DeleteAccount"
            component={DeleteAccountScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen name="LinkedChildren" component={LinkedChildrenScreen} />
          <Stack.Screen name="LinkChild" component={LinkChildScreen}
            options={{ headerShown: true, title: 'Link Child' }} />
          <Stack.Screen name="ChildDetail" component={ChildDetailScreen}
            options={{ headerShown: true, title: '' }} />
          {/* The dashboard's Quick Actions push the same screens above the
              tabs (with a back button). Same component, two entry points -
              one in-tab, one stacked. */}
          <Stack.Screen name="ChildAttendance" component={ChildAttendanceScreen} />
          <Stack.Screen name="ChildProgress" component={ChildProgressScreen} />
          <Stack.Screen name="ChildPayments" component={ChildPaymentsScreen} />
          {/* Dashboard's "Certificates" Quick Action routes to this name. */}
          <Stack.Screen name="ChildCertificates" component={ChildAchievementsScreen} />
          <Stack.Screen name="ChildAchievements" component={ChildAchievementsScreen} />
          <Stack.Screen name="InformLeave" component={InformLeaveScreen} />
          <Stack.Screen name="ChildEvents" component={ChildEventsScreen} />
          {/* ChildProfileScreen renders its own red hero/header, so we keep
              the stack header hidden to avoid stacking two bars. */}
          <Stack.Screen name="ChildProfile" component={ChildProfileScreen} />
          {/* Parents reuse the same Notifications screen the staff module uses. */}
          <Stack.Screen name="StaffNotifications" component={StaffNotificationsScreen} />
          {/* Shared Support + FAQ screens — reachable from the parent
              More tab. Roll-your-own headers so the native stack bar
              stays hidden. */}
          <Stack.Screen name="Support" component={SupportScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="Faq" component={FaqScreen}
            options={{ headerShown: false }} />
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  // Fallback — shouldn't reach here if the role gating above exhausts
  // every state, but render Welcome rather than a blank screen if it does.
  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Welcome" component={WelcomeScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// ─── Splash / auth-restore screen styles ──────────────────────────
// Clean white surface with the logo centered and the "#1 Martial Arts
// App" tagline in the brand red. Modern, uncluttered layout — the
// wordmark and heavy card shadow of the previous purple splash have
// been removed so the logo does the talking.
//
// Red used for the tagline is BRAND_RED (#E63946) — the same red the
// student / student-payment surfaces use for primary CTAs so the
// splash reads as an extension of the brand identity, not a one-off
// colour. Letter-spacing + weight = 900 + a small case give the
// tagline a premium wordmark feel without needing a custom font.
const BRAND_RED = '#5462bb';
const splashStyles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
  },
  // Logo container — rendered as a perfect circle. Width === height
  // and borderRadius === width/2. `overflow: 'hidden'` clips the
  // underlying image to the circular mask so a rectangular or
  // rounded-corner logo asset renders as a clean disc.
  //
  // Soft brand-tint background so a logo with a transparent edge
  // still reads as a bounded circle on the white splash. Subtle
  // border keeps the disc defined without needing a shadow.
  logoWrap: {
    width: 148,
    height: 148,
    borderRadius: 74,
    backgroundColor: '#FFF5F6',
    borderWidth: 1,
    borderColor: '#F4E4E6',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Image switches to `cover` so it fills the circular mask edge-to-
  // edge. If your logo asset has whitespace baked in, swap this back
  // to `contain` — the circular mask on the wrap still applies.
  logoImage: {
    width: '100%',
    height: '100%',
  },
  // Brand wordmark — sits between the logo and the tagline. Big,
  // heavy weight, brand red so it reads as the primary identity
  // element. Kept in mixed case (not uppercase) so it stays visually
  // distinct from the smaller, tracked-out tagline underneath.
  brand: {
    fontSize: 32,
    fontWeight: '900',
    color: BRAND_RED,
    marginTop: 28,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  // Tagline — modern, tight tracking, tall weight. Uppercase with
  // measured letter-spacing gives the "premium" character requested
  // without depending on a custom font family (which would need to be
  // linked native-side and ship a new build). Sits just below the
  // "Veerify" wordmark.
  tagline: {
    fontSize: 15,
    fontWeight: '900',
    color: BRAND_RED,
    marginTop: 10,
    textAlign: 'center',
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    // Slight italic on iOS reads as "editorial / premium"; Android's
    // system italic renders less consistently, so we keep upright there.
    ...(Platform.OS === 'ios' ? { fontStyle: 'italic' } : null),
  },
  spinner: {
    marginTop: 40,
  },
});


import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, ActivityIndicator } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { navigationRef } from './navigationRef';

// Auth screens
import WelcomeScreen from '../screens/WelcomeScreen';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import ChangePasswordScreen from '../screens/ChangePasswordScreen';
import SendFeedbackScreen from '../screens/SendFeedbackScreen';
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
import AdminCertificatesScreen from '../screens/admin/AdminCertificatesScreen';
import CertificateTemplatesScreen from '../screens/admin/CertificateTemplatesScreen';
import CertificateTemplateEditorScreen from '../screens/admin/CertificateTemplateEditorScreen';
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
import InstitutionDetailScreen from '../screens/student/InstitutionDetailScreen';
import AllInstitutionsScreen from '../screens/student/AllInstitutionsScreen';
import CategoryAcademiesScreen from '../screens/student/CategoryAcademiesScreen';
import CourseDetailScreen from '../screens/student/CourseDetailScreen';
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

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0a4d8c' }}>
        <ActivityIndicator size="large" color="#ffd60a" />
        <Text style={{ color: 'white', marginTop: 12, fontSize: 14 }}>Loading Veerify…</Text>
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
          <Stack.Screen name="InstitutionDetail" component={InstitutionDetailScreen}
            options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="AllInstitutions" component={AllInstitutionsScreen}
            options={{ headerShown: true, title: 'All Academies' }} />
          {/* CategoryAcademies — list of academies offering a specific
              CMS category. Reached from the Home tab's Categories row. */}
          <Stack.Screen name="CategoryAcademies" component={CategoryAcademiesScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="CourseDetail" component={CourseDetailScreen}
            options={{ headerShown: true, title: '' }} />
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
          screenOptions={{ headerShown: false }}
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
          <Stack.Screen name="SelectInstitution" component={SelectInstitutionScreen}
            // No nav header at all — the screen body already has a big
            // "Choose your academy" heading, and the user can use the
            // Android hardware back button or iOS swipe-back gesture to
            // return to the previous screen.
            options={{ headerShown: false }} />
          <Stack.Screen name="InstitutionDetail" component={InstitutionDetailScreen}
            options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="AllInstitutions" component={AllInstitutionsScreen}
            options={{ headerShown: true, title: 'All Academies' }} />
          {/* CategoryAcademies — list of academies offering a specific
              CMS category. Reached from the Home tab's Categories row. */}
          <Stack.Screen name="CategoryAcademies" component={CategoryAcademiesScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="CourseDetail" component={CourseDetailScreen}
            options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="BatchDetail" component={BatchDetailScreen}
            options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="MyAttendance" component={MyAttendanceScreen}
            options={{ headerShown: true, title: 'My Attendance' }} />
          <Stack.Screen name="MyEnrollments" component={MyEnrollmentsScreen}
            options={{ headerShown: true, title: 'My Courses' }} />
          <Stack.Screen name="ParentRequests" component={ParentRequestsScreen}
            options={{ headerShown: true, title: 'Parent Requests' }} />
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


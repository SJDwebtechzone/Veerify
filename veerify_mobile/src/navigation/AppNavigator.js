import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, ActivityIndicator } from 'react-native';
import { useAuth } from '../context/AuthContext';

// Auth screens
import WelcomeScreen from '../screens/WelcomeScreen';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
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
import CoursesListScreen from '../screens/admin/CoursesListScreen';
import CreateCourseScreen from '../screens/admin/CreateCourseScreen';
import AdminCourseDetailScreen from '../screens/admin/AdminCourseDetailScreen';
import BatchesListScreen from '../screens/admin/BatchesListScreen';
import CreateBatchScreen from '../screens/admin/CreateBatchScreen';
import TrainersListScreen from '../screens/admin/TrainersListScreen';
import CreateTrainerScreen from '../screens/admin/CreateTrainerScreen';
import SendAnnouncementScreen from '../screens/admin/SendAnnouncementScreen';
import AdminTrainerLeavesScreen from '../screens/admin/AdminTrainerLeavesScreen';
import AdminReferEarnScreen from '../screens/admin/AdminReferEarnScreen';
import SettingsScreen from '../screens/admin/SettingsScreen';

// Student
import StudentTabNavigator from './StudentTabNavigator';
import InstitutionDetailScreen from '../screens/student/InstitutionDetailScreen';
import AllInstitutionsScreen from '../screens/student/AllInstitutionsScreen';
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
import StaffSalaryScreen from '../screens/staff/StaffSalaryScreen';
import StaffVideosScreen from '../screens/staff/StaffVideosScreen';
import TrainerRequestLeaveScreen from '../screens/staff/TrainerRequestLeaveScreen';
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
      <NavigationContainer>
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
            options={{ headerShown: true, title: 'Choose Academy' }} />
          <Stack.Screen name="InstitutionDetail" component={InstitutionDetailScreen}
            options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="AllInstitutions" component={AllInstitutionsScreen}
            options={{ headerShown: true, title: 'All Academies' }} />
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
      <NavigationContainer>
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
          <Stack.Screen name="StudentDetail" component={StudentDetailScreen} />
          <Stack.Screen name="CoursesList" component={CoursesListScreen} />
          <Stack.Screen name="CreateCourse" component={CreateCourseScreen}
            options={{ headerShown: true, title: 'New Course' }} />
          {/* AdminCourseDetailScreen renders its own image hero so we hide
              the native stack header to avoid stacking two bars. */}
          <Stack.Screen name="AdminCourseDetail" component={AdminCourseDetailScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="BatchesList" component={BatchesListScreen} />
          <Stack.Screen name="CreateBatch" component={CreateBatchScreen}
            options={{ headerShown: true, title: 'New Batch' }} />
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
          {/* AdminReferEarnScreen renders its own header. */}
          <Stack.Screen name="AdminReferEarn" component={AdminReferEarnScreen}
            options={{ headerShown: false }} />
          {/* Admins reuse the same Notifications inbox as staff/parent —
              it scopes to the calling user via JWT, so it works for every role. */}
          <Stack.Screen name="StaffNotifications" component={StaffNotificationsScreen} />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ headerShown: true, title: 'Marketplace Settings' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  // ── STUDENT ──
  if (user.role === 'student') {
    return (
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="StudentTabs" component={StudentTabNavigator} />
          <Stack.Screen name="SelectInstitution" component={SelectInstitutionScreen}
            options={{ headerShown: true, title: 'Choose Academy' }} />
          <Stack.Screen name="InstitutionDetail" component={InstitutionDetailScreen}
            options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="AllInstitutions" component={AllInstitutionsScreen}
            options={{ headerShown: true, title: 'All Academies' }} />
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
          {/* Students reuse the same Notifications screen the staff module uses —
              the inbox is per-user via the JWT, so it works for every role. */}
          <Stack.Screen name="StaffNotifications" component={StaffNotificationsScreen} />
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
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="StaffTabs" component={StaffTabNavigator} />
          {/* Legacy route name kept so any code that still calls
              navigation.navigate('TrainerDashboard') continues to land on
              the tabbed shell. */}
          <Stack.Screen name="TrainerDashboard" component={StaffTabNavigator} />
          <Stack.Screen name="StaffAttendanceHistory" component={StaffAttendanceHistoryScreen} />
          <Stack.Screen name="StaffStudentDetail" component={StaffStudentDetailScreen} />
          <Stack.Screen name="StaffLeaveRequests" component={StaffLeaveRequestsScreen} />
          <Stack.Screen name="StaffSalary" component={StaffSalaryScreen} />
          {/* StaffVideosScreen renders its own header. */}
          <Stack.Screen name="StaffVideos" component={StaffVideosScreen}
            options={{ headerShown: false }} />
          {/* TrainerRequestLeaveScreen renders its own header. */}
          <Stack.Screen name="TrainerRequestLeave" component={TrainerRequestLeaveScreen}
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
          <Stack.Screen name="BatchStudents" component={BatchStudentsScreen}
            options={{ headerShown: true, title: 'Mark Attendance' }} />
          <Stack.Screen name="AttendanceHistory" component={AttendanceHistoryScreen}
            options={{ headerShown: true, title: 'History' }} />
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
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="ParentTabs" component={ParentTabNavigator} />
          {/* Legacy route — keep so any direct navigate('ParentDashboard')
              still lands on the tabbed shell (which boots into Home). */}
          <Stack.Screen name="ParentDashboard" component={ParentTabNavigator} />
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
          {/* Parents reuse the same Notifications screen the staff module uses -
              the inbox is per-user via the JWT, so it works for every role. */}
          <Stack.Screen name="StaffNotifications" component={StaffNotificationsScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  // Fallback
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Welcome" component={WelcomeScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

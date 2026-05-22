import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, ActivityIndicator } from 'react-native';
import { useAuth } from '../context/AuthContext';

// Auth screens
import WelcomeScreen from '../screens/WelcomeScreen';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
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
import BatchesListScreen from '../screens/admin/BatchesListScreen';
import CreateBatchScreen from '../screens/admin/CreateBatchScreen';
import TrainersListScreen from '../screens/admin/TrainersListScreen';
import CreateTrainerScreen from '../screens/admin/CreateTrainerScreen';

// Student
import StudentTabNavigator from './StudentTabNavigator';
import InstitutionDetailScreen from '../screens/student/InstitutionDetailScreen';
import AllInstitutionsScreen from '../screens/student/AllInstitutionsScreen';
import CourseDetailScreen from '../screens/student/CourseDetailScreen';
import BatchDetailScreen from '../screens/student/BatchDetailScreen';
import MyAttendanceScreen from '../screens/student/MyAttendanceScreen';
import ParentRequestsScreen from '../screens/student/ParentRequestsScreen';

// Trainer
import TrainerDashboardScreen from '../screens/trainer/TrainerDashboardScreen';
import BatchStudentsScreen from '../screens/trainer/BatchStudentsScreen';
import AttendanceHistoryScreen from '../screens/trainer/AttendanceHistoryScreen';

// Parent
import ParentDashboardScreen from '../screens/parent/ParentDashboardScreen';
import LinkChildScreen from '../screens/parent/LinkChildScreen';
import ChildDetailScreen from '../screens/parent/ChildDetailScreen';
import ChildAttendanceScreen from '../screens/parent/ChildAttendanceScreen';
import ChildPaymentsScreen from '../screens/parent/ChildPaymentsScreen';

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
          <Stack.Screen
            name="SetupInstitution"
            component={SetupInstitutionScreen}
            options={{ headerShown: true, title: 'Academy Setup' }}
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
          <Stack.Screen name="BatchesList" component={BatchesListScreen} />
          <Stack.Screen name="CreateBatch" component={CreateBatchScreen}
            options={{ headerShown: true, title: 'New Batch' }} />
          <Stack.Screen name="TrainersList" component={TrainersListScreen} />
          <Stack.Screen name="CreateTrainer" component={CreateTrainerScreen}
            options={{ headerShown: true, title: 'Add Trainer' }} />
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
          <Stack.Screen name="ParentRequests" component={ParentRequestsScreen}
            options={{ headerShown: true, title: 'Parent Requests' }} />
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  // ── TRAINER ──
  if (user.role === 'trainer') {
    return (
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="TrainerDashboard" component={TrainerDashboardScreen} />
          <Stack.Screen name="BatchStudents" component={BatchStudentsScreen}
            options={{ headerShown: true, title: 'Mark Attendance' }} />
          <Stack.Screen name="AttendanceHistory" component={AttendanceHistoryScreen}
            options={{ headerShown: true, title: 'History' }} />
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  // ── PARENT ──
  if (user.role === 'parent') {
    return (
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="ParentDashboard" component={ParentDashboardScreen} />
          <Stack.Screen name="LinkChild" component={LinkChildScreen}
            options={{ headerShown: true, title: 'Link Child' }} />
          <Stack.Screen name="ChildDetail" component={ChildDetailScreen}
            options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="ChildAttendance" component={ChildAttendanceScreen}
            options={{ headerShown: true, title: 'Attendance' }} />
          <Stack.Screen name="ChildPayments" component={ChildPaymentsScreen}
            options={{ headerShown: true, title: 'Payments' }} />
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

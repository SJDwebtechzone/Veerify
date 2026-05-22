import {
  LayoutDashboard,
  Building2,
  GraduationCap,
  UserCog,
  BookOpen,
  CalendarRange,
  Wallet,
  Bell,
  Star,
  Settings,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';

export interface NavChild {
  label: string;
  to: string;
}

export interface NavSection {
  label: string;
  icon: LucideIcon;
  to?: string;
  children?: NavChild[];
}

export const navSections: NavSection[] = [
  {
    label: 'Dashboard',
    icon: LayoutDashboard,
    to: '/',
  },
  {
    label: 'Institutions',
    icon: Building2,
    children: [
      { label: 'All Institutions', to: '/institutions' },
      { label: 'Active Institutions', to: '/institutions/active' },
      { label: 'Expired Plans', to: '/institutions/expired' },
      { label: 'Pending Approvals', to: '/institutions/pending' },
    ],
  },
  {
    label: 'Students',
    icon: GraduationCap,
    children: [
      { label: 'All Students', to: '/students' },
      { label: 'Attendance', to: '/students/attendance' },
      { label: 'Enrollments', to: '/students/enrollments' },
    ],
  },
  {
    label: 'Trainers',
    icon: UserCog,
    children: [
      { label: 'Trainers List', to: '/trainers' },
      { label: 'Skills', to: '/trainers/skills' },
      { label: 'Availability', to: '/trainers/availability' },
    ],
  },
  {
    label: 'Courses',
    icon: BookOpen,
    children: [
      { label: 'Courses', to: '/courses' },
      { label: 'Videos', to: '/courses/videos' },
      { label: 'Syllabus', to: '/courses/syllabus' },
    ],
  },
  {
    label: 'Mobile App',
    icon: Smartphone,
    children: [
      { label: 'Hero Banners', to: '/mobile/banners' },
      { label: 'Categories', to: '/mobile/categories' },
      { label: 'Featured Videos', to: '/mobile/videos' },
      { label: 'Upcoming Events', to: '/mobile/events' },
    ],
  },
  {
    label: 'Batches',
    icon: CalendarRange,
    children: [
      { label: 'Active Batches', to: '/batches' },
      { label: 'Assign Trainers', to: '/batches/assign' },
      { label: 'Capacity', to: '/batches/capacity' },
    ],
  },
  {
    label: 'Payments',
    icon: Wallet,
    children: [
      { label: 'Revenue Analytics', to: '/payments' },
      { label: 'Subscription Payments', to: '/payments/subscriptions' },
      { label: 'Pending Payments', to: '/payments/pending' },
    ],
  },
  {
    label: 'Notifications',
    icon: Bell,
    children: [
      { label: 'Announcements', to: '/notifications' },
      { label: 'Push Notifications', to: '/notifications/push' },
      { label: 'Emails', to: '/notifications/emails' },
    ],
  },
  {
    label: 'Ratings',
    icon: Star,
    children: [
      { label: 'Reviews', to: '/ratings' },
      { label: 'Trainer Ratings', to: '/ratings/trainers' },
    ],
  },
  {
    label: 'Settings',
    icon: Settings,
    children: [
      { label: 'Subscription Plans', to: '/settings/plans' },
      { label: 'Roles & Permissions', to: '/settings/roles' },
      { label: 'General Settings', to: '/settings' },
    ],
  },
];

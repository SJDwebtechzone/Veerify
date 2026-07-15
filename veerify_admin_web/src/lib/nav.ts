import {
  LayoutDashboard,
  Building2,
  GraduationCap,
  UserCog,
  // BookOpen is only referenced by the commented-out Courses section below.
  // Re-import it when restoring that nav entry.
  Wallet,
  Bell,
  Star,
  Settings,
  Smartphone,
  MessageSquare,
  Scale,
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
    to: '/students',
  },
  {
    label: 'Trainers',
    icon: UserCog,
    to: '/trainers',
  },
  // Courses section temporarily hidden by product decision. Routes for
  // /courses, /courses/videos and /courses/syllabus are still mounted in
  // App.tsx so existing direct links don't 404; just the sidebar entry is
  // suppressed. Restore the block below to bring it back.
  // {
  //   label: 'Courses',
  //   icon: BookOpen,
  //   children: [
  //     { label: 'Courses', to: '/courses' },
  //     { label: 'Videos', to: '/courses/videos' },
  //     { label: 'Syllabus', to: '/courses/syllabus' },
  //   ],
  // },
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
    label: 'Payments',
    icon: Wallet,
    children: [
      { label: 'Institution Payout', to: '/payments' },
      { label: 'Subscription Payments', to: '/payments/subscriptions' },
      // Pending Payments hidden from the sidebar — the "Pending" tab
      // pill inside Subscription Payments already surfaces every
      // pending row, so a separate entry was redundant.
      // { label: 'Pending Payments', to: '/payments/pending' },
    ],
  },
  {
    label: 'Notifications',
    icon: Bell,
    children: [
      { label: 'Broadcasts', to: '/notifications' },
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
    label: 'Feedback',
    icon: MessageSquare,
    to: '/feedback',
  },
  // Platform-wide legal / policy pages. Super-admin only. Each entry
  // routes to the same editor screen with a different `slug` param.
  {
    label: 'Legal',
    icon: Scale,
    children: [
      { label: 'Terms & Conditions',           to: '/legal/terms_and_conditions' },
      { label: 'Privacy Policy',               to: '/legal/privacy_policy' },
      { label: 'Refund & Cancellation Policy', to: '/legal/refund_and_cancellation_policy' },
      { label: 'Child Safety Policy',          to: '/legal/child_safety_policy' },
      { label: 'Contact & Support',            to: '/legal/contact_and_support' },
    ],
  },
  {
    label: 'Settings',
    icon: Settings,
    children: [
      { label: 'Subscription Plans', to: '/settings/plans' },
      { label: 'Marketplace Settings', to: '/settings/marketplace' },
      { label: 'Refer & Earn', to: '/settings/referral' },
      { label: 'General Settings', to: '/settings' },
    ],
  },
];

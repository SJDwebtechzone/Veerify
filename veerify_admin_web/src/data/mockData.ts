// Mock data — swap this for real API responses later

export const revenueData = [
  { month: 'Jan', revenue: 145000, subscriptions: 92000 },
  { month: 'Feb', revenue: 168000, subscriptions: 104000 },
  { month: 'Mar', revenue: 192000, subscriptions: 118000 },
  { month: 'Apr', revenue: 215000, subscriptions: 132000 },
  { month: 'May', revenue: 248000, subscriptions: 151000 },
  { month: 'Jun', revenue: 287000, subscriptions: 174000 },
  { month: 'Jul', revenue: 312000, subscriptions: 189000 },
  { month: 'Aug', revenue: 358000, subscriptions: 213000 },
  { month: 'Sep', revenue: 391000, subscriptions: 234000 },
  { month: 'Oct', revenue: 428000, subscriptions: 256000 },
  { month: 'Nov', revenue: 463000, subscriptions: 278000 },
  { month: 'Dec', revenue: 512000, subscriptions: 306000 },
];

export const growthData = [
  { month: 'Jan', institutions: 12, students: 240 },
  { month: 'Feb', institutions: 18, students: 380 },
  { month: 'Mar', institutions: 24, students: 510 },
  { month: 'Apr', institutions: 31, students: 720 },
  { month: 'May', institutions: 38, students: 890 },
  { month: 'Jun', institutions: 47, students: 1140 },
  { month: 'Jul', institutions: 55, students: 1380 },
  { month: 'Aug', institutions: 64, students: 1650 },
  { month: 'Sep', institutions: 72, students: 1920 },
  { month: 'Oct', institutions: 81, students: 2210 },
  { month: 'Nov', institutions: 89, students: 2450 },
  { month: 'Dec', institutions: 97, students: 2780 },
];

export const enrollmentData = [
  { name: 'Karate', value: 842, color: '#6366f1' },
  { name: 'Taekwondo', value: 614, color: '#10b981' },
  { name: 'Boxing', value: 487, color: '#f59e0b' },
  { name: 'BJJ', value: 326, color: '#ec4899' },
  { name: 'Muay Thai', value: 289, color: '#06b6d4' },
  { name: 'Other', value: 222, color: '#8b5cf6' },
];

export const trainerUtilization = [
  { day: 'Mon', booked: 78, capacity: 100 },
  { day: 'Tue', booked: 84, capacity: 100 },
  { day: 'Wed', booked: 91, capacity: 100 },
  { day: 'Thu', booked: 86, capacity: 100 },
  { day: 'Fri', booked: 94, capacity: 100 },
  { day: 'Sat', booked: 97, capacity: 100 },
  { day: 'Sun', booked: 62, capacity: 100 },
];

export interface Institution {
  id: number;
  name: string;
  owner: string;
  email: string;
  phone: string;
  city: string;
  plan: 'Starter' | 'Pro' | 'Enterprise';
  status: 'Active' | 'Trial' | 'Expired' | 'Pending';
  students: number;
  joinedAt: string;
  expiresAt: string;
  revenue: number;
}

export const institutions: Institution[] = [
  { id: 1, name: 'Tiger Martial Arts Academy', owner: 'Vikram Reddy', email: 'vikram@tigermartial.in', phone: '+91 98765 43210', city: 'Bangalore', plan: 'Enterprise', status: 'Active', students: 284, joinedAt: '2025-03-12', expiresAt: '2026-03-12', revenue: 184000 },
  { id: 2, name: 'Dragon Fist Karate', owner: 'Anjali Sharma', email: 'anjali@dragonfist.com', phone: '+91 99876 54321', city: 'Mumbai', plan: 'Pro', status: 'Active', students: 156, joinedAt: '2025-04-22', expiresAt: '2026-04-22', revenue: 92000 },
  { id: 3, name: 'Phoenix Taekwondo School', owner: 'Rahul Verma', email: 'rahul@phoenixtkd.in', phone: '+91 91234 56789', city: 'Hyderabad', plan: 'Pro', status: 'Active', students: 198, joinedAt: '2025-05-08', expiresAt: '2026-05-08', revenue: 118000 },
  { id: 4, name: 'Iron Will Boxing Club', owner: 'Sneha Iyer', email: 'sneha@ironwill.com', phone: '+91 96543 21098', city: 'Chennai', plan: 'Starter', status: 'Trial', students: 42, joinedAt: '2026-04-30', expiresAt: '2026-05-30', revenue: 0 },
  { id: 5, name: 'Samurai BJJ Academy', owner: 'Karthik Menon', email: 'karthik@samuraibjj.in', phone: '+91 99887 76655', city: 'Pune', plan: 'Enterprise', status: 'Active', students: 312, joinedAt: '2024-11-18', expiresAt: '2025-11-18', revenue: 218000 },
  { id: 6, name: 'Lotus Muay Thai Gym', owner: 'Priya Nair', email: 'priya@lotusmt.com', phone: '+91 98123 45670', city: 'Kochi', plan: 'Pro', status: 'Expired', students: 87, joinedAt: '2024-08-04', expiresAt: '2025-08-04', revenue: 64000 },
  { id: 7, name: 'Apex Combat Sports', owner: 'Aditya Kumar', email: 'aditya@apexcombat.in', phone: '+91 90123 45678', city: 'Delhi', plan: 'Enterprise', status: 'Active', students: 421, joinedAt: '2024-09-22', expiresAt: '2025-09-22', revenue: 286000 },
  { id: 8, name: 'Zen Karate Dojo', owner: 'Meera Pillai', email: 'meera@zenkarate.in', phone: '+91 99988 77665', city: 'Coimbatore', plan: 'Starter', status: 'Pending', students: 0, joinedAt: '2026-05-12', expiresAt: '-', revenue: 0 },
  { id: 9, name: 'Warrior Path MMA', owner: 'Sandeep Joshi', email: 'sandeep@warriorpath.com', phone: '+91 91111 22233', city: 'Ahmedabad', plan: 'Pro', status: 'Active', students: 174, joinedAt: '2025-01-15', expiresAt: '2026-01-15', revenue: 104000 },
  { id: 10, name: 'Black Belt Institute', owner: 'Lakshmi Rao', email: 'lakshmi@blackbelt.in', phone: '+91 90909 80808', city: 'Visakhapatnam', plan: 'Starter', status: 'Active', students: 68, joinedAt: '2025-09-03', expiresAt: '2026-09-03', revenue: 34000 },
  { id: 11, name: 'Thunder Karate Center', owner: 'Arjun Bose', email: 'arjun@thunderk.com', phone: '+91 97676 54321', city: 'Kolkata', plan: 'Pro', status: 'Trial', students: 28, joinedAt: '2026-05-01', expiresAt: '2026-06-01', revenue: 0 },
  { id: 12, name: 'Falcon Self Defense', owner: 'Divya Krishnan', email: 'divya@falconsd.in', phone: '+91 98765 12345', city: 'Bangalore', plan: 'Pro', status: 'Active', students: 142, joinedAt: '2025-06-19', expiresAt: '2026-06-19', revenue: 86000 },
];

export interface PaymentRow {
  id: number;
  institution: string;
  plan: string;
  amount: number;
  status: 'Paid' | 'Pending' | 'Failed';
  date: string;
  method: string;
}

export const recentPayments: PaymentRow[] = [
  { id: 1, institution: 'Tiger Martial Arts Academy', plan: 'Enterprise / Annual', amount: 84000, status: 'Paid', date: '2026-05-12', method: 'UPI' },
  { id: 2, institution: 'Dragon Fist Karate', plan: 'Pro / Monthly', amount: 4999, status: 'Paid', date: '2026-05-11', method: 'Card' },
  { id: 3, institution: 'Phoenix Taekwondo School', plan: 'Pro / Annual', amount: 49999, status: 'Pending', date: '2026-05-10', method: 'NEFT' },
  { id: 4, institution: 'Lotus Muay Thai Gym', plan: 'Pro / Renewal', amount: 4999, status: 'Failed', date: '2026-05-09', method: 'UPI' },
  { id: 5, institution: 'Samurai BJJ Academy', plan: 'Enterprise / Annual', amount: 84000, status: 'Paid', date: '2026-05-08', method: 'Card' },
  { id: 6, institution: 'Apex Combat Sports', plan: 'Enterprise / Monthly', amount: 7999, status: 'Paid', date: '2026-05-07', method: 'UPI' },
  { id: 7, institution: 'Warrior Path MMA', plan: 'Pro / Monthly', amount: 4999, status: 'Paid', date: '2026-05-06', method: 'Card' },
  { id: 8, institution: 'Black Belt Institute', plan: 'Starter / Annual', amount: 19999, status: 'Pending', date: '2026-05-05', method: 'NEFT' },
];

export interface EnrollmentRow {
  id: number;
  student: string;
  course: string;
  institution: string;
  batch: string;
  enrolledAt: string;
  status: 'Active' | 'Pending Payment';
}

export const recentEnrollments: EnrollmentRow[] = [
  { id: 1, student: 'Aarav Sharma', course: 'Karate · Yellow Belt', institution: 'Tiger Martial Arts Academy', batch: 'Evening B', enrolledAt: '2026-05-13', status: 'Active' },
  { id: 2, student: 'Ishaani Reddy', course: 'Taekwondo · Beginner', institution: 'Phoenix Taekwondo School', batch: 'Morning A', enrolledAt: '2026-05-13', status: 'Active' },
  { id: 3, student: 'Vihaan Mehta', course: 'Boxing · Intermediate', institution: 'Iron Will Boxing Club', batch: 'Weekend Pro', enrolledAt: '2026-05-12', status: 'Pending Payment' },
  { id: 4, student: 'Ananya Iyer', course: 'BJJ · White Belt', institution: 'Samurai BJJ Academy', batch: 'Evening A', enrolledAt: '2026-05-12', status: 'Active' },
  { id: 5, student: 'Reyansh Kapoor', course: 'Muay Thai · Beginner', institution: 'Lotus Muay Thai Gym', batch: 'Morning B', enrolledAt: '2026-05-11', status: 'Active' },
  { id: 6, student: 'Diya Krishnan', course: 'Karate · Orange Belt', institution: 'Zen Karate Dojo', batch: 'Evening C', enrolledAt: '2026-05-11', status: 'Active' },
  { id: 7, student: 'Kabir Singh', course: 'MMA · Foundations', institution: 'Apex Combat Sports', batch: 'Weekend B', enrolledAt: '2026-05-10', status: 'Active' },
  { id: 8, student: 'Saanvi Pillai', course: 'Self Defense', institution: 'Falcon Self Defense', batch: 'Morning A', enrolledAt: '2026-05-10', status: 'Pending Payment' },
];

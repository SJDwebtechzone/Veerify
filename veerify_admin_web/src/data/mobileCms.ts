// Data shapes for the mobile-app CMS sections.
// `imageUrl` fields hold either a hosted URL or a data: URL.
// `seed*` arrays are only used if the API hasn't replied yet.

export interface BannerItem {
  id: string;
  label: string;
  title: string;
  subtitle: string;
  cta: string;
  imageUrl: string;
  isActive: boolean;
  sortOrder: number;
}

export interface CategoryItem {
  id: string;
  name: string;
  imageUrl: string;
  isActive: boolean;
  sortOrder: number;
}

export interface VideoItem {
  id: string;
  title: string;
  trainer: string;
  duration: string;
  videoUrl: string;
  thumbnailUrl: string;
  isFree: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface EventItem {
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  link?: string;
  location: string;
  date: string; // ISO date string
  registrationClosingDate: string;
  isActive: boolean;
  sortOrder: number;
}

export const defaultBanners: BannerItem[] = [
  { id: 'b1', label: 'FEATURED PROGRAM', title: 'Master Karate in 90 Days', subtitle: 'Join 500+ students this month', cta: 'Explore →', imageUrl: 'https://images.unsplash.com/photo-1555597673-b21d5c935865?w=800', isActive: true, sortOrder: 1 },
  { id: 'b2', label: 'NEW LAUNCH', title: 'Live Taekwondo Classes', subtitle: 'Train with WTF certified masters', cta: 'Join Now →', imageUrl: 'https://images.unsplash.com/photo-1599058917212-d750089bc07e?w=800', isActive: true, sortOrder: 2 },
];

export const defaultCategories: CategoryItem[] = [
  { id: 'c1', name: 'Karate', imageUrl: 'https://images.unsplash.com/photo-1555597673-b21d5c935865?w=400', isActive: true, sortOrder: 1 },
  { id: 'c2', name: 'Taekwondo', imageUrl: 'https://images.unsplash.com/photo-1599058917212-d750089bc07e?w=400', isActive: true, sortOrder: 2 },
  { id: 'c3', name: 'Boxing', imageUrl: 'https://images.unsplash.com/photo-1549719386-74dfcbf7dbed?w=400', isActive: true, sortOrder: 3 },
];

export const defaultVideos: VideoItem[] = [
  { id: 'v1', title: 'Basic Karate Stance Tutorial', trainer: 'Suresh Sensei', duration: '3:45', videoUrl: '', thumbnailUrl: '', isFree: true, isActive: true, sortOrder: 1 },
];

export const defaultEvents: EventItem[] = [
  { id: 'e1', title: 'Belt Examination 2026', location: 'Chennai Karate Academy', date: '2026-12-15', registrationClosingDate: '2026-12-08', isActive: true, sortOrder: 1 },
];

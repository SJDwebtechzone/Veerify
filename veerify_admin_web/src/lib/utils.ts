import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number, currency: string = 'INR'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── 12-hour time formatters (Veerify house style) ─────────────
//
// Every screen that shows a time-of-day should go through one of
// these two so the format stays consistent everywhere. Locked to
// hour12: true regardless of the browser's locale so a user in a
// 24-hour region still sees AM/PM per spec.
//
//   formatTime12h(date)              → "9:30 AM"
//   formatTime12h(isoString)         → "6:45 PM"
//   formatTime12h(null / bad)        → ''
//
//   formatDateTime12h(date)          → "05 Aug 2026, 2:30 PM"
//   formatDateTime12h(null / bad)    → ''
//
// Dates use the existing en-IN short format so the app's date look
// (DD Mon YYYY) stays untouched.
export function formatTime12h(input: string | Date | null | undefined): string {
  if (input == null || input === '') return '';

  // Postgres TIME column surfaces as "HH:MM" or "HH:MM:SS". new Date()
  // can't parse those in isolation, so handle them explicitly before
  // falling through to the generic Date path.
  if (typeof input === 'string') {
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(input.trim());
    if (m) {
      let h = parseInt(m[1], 10);
      const mm = m[2];
      if (!Number.isFinite(h) || h < 0 || h > 23) return '';
      const period = h >= 12 ? 'PM' : 'AM';
      let h12 = h % 12;
      if (h12 === 0) h12 = 12;
      return `${h12}:${mm} ${period}`;
    }
  }

  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export function formatDateTime12h(input: string | Date | null | undefined): string {
  if (input == null || input === '') return '';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const datePart = d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  const timePart = d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
  return `${datePart}, ${timePart}`;
}

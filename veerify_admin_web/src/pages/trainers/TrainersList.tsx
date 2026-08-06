import { useEffect, useMemo, useState } from 'react';
import {
  UserCog, Search, Building2, Award, Mail, Phone, Briefcase,
  Loader2, Filter, X, ChevronDown, Eye, FileText, ExternalLink,
  User, ShieldCheck, CalendarClock, Users,
} from 'lucide-react';
import apiClient from '../../api/client';
import { formatTime12h } from '../../lib/utils';

interface AssignedBatch {
  id:             number;
  name:           string;
  days_of_week:   string | null;
  start_time:     string | null;
  end_time:       string | null;
  course_id:      number | null;
  course_name:    string | null;
  enrolled_count: number;
}

interface TrainerRow {
  id: number;
  user_id: number;
  institution_id: number | null;
  specialization: string | null;
  belt_level: string | null;
  experience_years: number | null;
  bio: string | null;
  gender: string | null;
  date_of_birth: string | null;
  govt_proof_type: string | null;
  govt_proof_number: string | null;
  photo_url: string | null;
  certificate_url: string | null;
  created_at: string;
  name: string;
  email: string;
  phone: string | null;
  user_status: string | null;
  institution_name: string | null;
  institution_city: string | null;
  institution_logo: string | null;
  batches: AssignedBatch[];
}

// Resolve relative /uploads paths to the API origin, and rewrite emulator
// hosts (10.0.2.2) so the browser can actually load images uploaded from
// the mobile dev build.
function resolveAssetUrl(raw: string | null): string | null {
  if (!raw) return null;
  if (raw.startsWith('/')) {
    const apiOrigin = apiClient.defaults.baseURL?.replace(/\/api\/?$/, '') || '';
    return `${apiOrigin}${raw}`;
  }
  return raw.replace(/^http:\/\/10\.0\.2\.2(?::\d+)?/, () => {
    return apiClient.defaults.baseURL?.replace(/\/api\/?$/, '') || raw;
  });
}

// Belt color mapping for the small belt chip in the table.
const BELT_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  white:  { bg: '#FFFFFF', fg: '#111827', border: '#E5E7EB' },
  yellow: { bg: '#FEF3C7', fg: '#92400E', border: '#F59E0B' },
  orange: { bg: '#FFEDD5', fg: '#9A3412', border: '#F97316' },
  green:  { bg: '#DCFCE7', fg: '#166534', border: '#22C55E' },
  blue:   { bg: '#DBEAFE', fg: '#1E40AF', border: '#3B82F6' },
  brown:  { bg: '#FAEDD5', fg: '#7C2D12', border: '#A16207' },
  black:  { bg: '#1F2937', fg: '#FFFFFF', border: '#0F172A' },
};
function beltColors(label: string | null) {
  if (!label) return BELT_COLORS.white;
  const k = label.toLowerCase();
  for (const key of Object.keys(BELT_COLORS)) {
    if (k.includes(key)) return BELT_COLORS[key];
  }
  return BELT_COLORS.white;
}

export function TrainersList() {
  const [trainers, setTrainers] = useState<TrainerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [institutionFilter, setInstitutionFilter] = useState<string>('');
  const [skillFilter, setSkillFilter] = useState<string>('');
  const [beltFilter, setBeltFilter] = useState<string>('');

  // Detail modal
  const [viewing, setViewing] = useState<TrainerRow | null>(null);

  useEffect(() => {
    setLoading(true);
    apiClient
      .get('/trainers/all')
      .then((r) => setTrainers(r.data?.trainers || []))
      .catch((err) =>
        setError(err.response?.data?.message || 'Failed to load trainers'),
      )
      .finally(() => setLoading(false));
  }, []);

  // ── Derive filter option lists from the loaded roster ──
  const institutions = useMemo(() => {
    const set = new Map<number, string>();
    trainers.forEach((t) => {
      if (t.institution_id && t.institution_name) {
        set.set(t.institution_id, t.institution_name);
      }
    });
    return Array.from(set.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [trainers]);

  const skills = useMemo(() => {
    const set = new Set<string>();
    trainers.forEach((t) => {
      if (t.specialization) set.add(t.specialization);
    });
    return Array.from(set).sort();
  }, [trainers]);

  const belts = useMemo(() => {
    const set = new Set<string>();
    trainers.forEach((t) => {
      if (t.belt_level) set.add(t.belt_level);
    });
    return Array.from(set).sort();
  }, [trainers]);

  // ── Apply filters client-side ──
  const filtered = useMemo(() => {
    let out = trainers;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(
        (t) =>
          t.name?.toLowerCase().includes(q) ||
          t.email?.toLowerCase().includes(q) ||
          t.phone?.toLowerCase().includes(q) ||
          t.institution_name?.toLowerCase().includes(q) ||
          t.specialization?.toLowerCase().includes(q),
      );
    }
    if (institutionFilter) {
      out = out.filter(
        (t) => String(t.institution_id) === institutionFilter,
      );
    }
    if (skillFilter) {
      out = out.filter((t) => t.specialization === skillFilter);
    }
    if (beltFilter) {
      out = out.filter((t) => t.belt_level === beltFilter);
    }
    return out;
  }, [trainers, search, institutionFilter, skillFilter, beltFilter]);

  const clearFilters = () => {
    setSearch('');
    setInstitutionFilter('');
    setSkillFilter('');
    setBeltFilter('');
  };

  const anyFilterActive =
    !!search.trim() || !!institutionFilter || !!skillFilter || !!beltFilter;

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
            <UserCog size={20} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">All Trainers</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Platform-wide roster across every institution.
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-gray-900">{filtered.length}</p>
          <p className="text-xs text-gray-500">
            {filtered.length === 1 ? 'trainer' : 'trainers'}
            {anyFilterActive ? ` of ${trainers.length}` : ''}
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-12 md:col-span-5 relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, phone, institution, or skill..."
              className="w-full border border-gray-200 rounded-lg pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="col-span-6 md:col-span-3 relative">
            <select
              value={institutionFilter}
              onChange={(e) => setInstitutionFilter(e.target.value)}
              className="w-full appearance-none border border-gray-200 rounded-lg pl-3 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">All institutions</option>
              {institutions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          <div className="col-span-6 md:col-span-2 relative">
            <select
              value={skillFilter}
              onChange={(e) => setSkillFilter(e.target.value)}
              className="w-full appearance-none border border-gray-200 rounded-lg pl-3 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">All skills</option>
              {skills.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          <div className="col-span-6 md:col-span-2 relative">
            <select
              value={beltFilter}
              onChange={(e) => setBeltFilter(e.target.value)}
              className="w-full appearance-none border border-gray-200 rounded-lg pl-3 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">All belts</option>
              {belts.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {anyFilterActive && (
          <button
            onClick={clearFilters}
            className="mt-3 inline-flex items-center gap-1 text-xs text-blue-600 font-semibold hover:underline"
          >
            <X size={12} />
            Clear filters
          </button>
        )}
      </div>

      {/* Detail modal */}
      {viewing && (
        <TrainerDetailModal
          trainer={viewing}
          onClose={() => setViewing(null)}
        />
      )}

      {/* Error / loading / empty / table */}
      {error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 size={20} className="animate-spin mr-2" />
          Loading trainers...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <Filter size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-600 font-semibold">No trainers match these filters.</p>
          <p className="text-gray-400 text-sm mt-1">
            Try clearing them or broaden your search.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                <tr>
                  <Th>Trainer</Th>
                  <Th>Institution</Th>
                  <Th>Batches</Th>
                  <Th>Skill</Th>
                  <Th>Belt</Th>
                  <Th className="text-center">Experience</Th>
                  <Th>Contact</Th>
                  <Th className="text-center">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((t) => (
                  <TrainerRow
                    key={t.id}
                    trainer={t}
                    onView={() => setViewing(t)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Reusable bits ─────────────────────────────────────────────────────
function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-3 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap ${className}`}
    >
      {children}
    </th>
  );
}

function TrainerRow({ trainer, onView }: { trainer: TrainerRow; onView: () => void }) {
  const photo = resolveAssetUrl(trainer.photo_url);
  const initials =
    (trainer.name || '?')
      .split(' ')
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();
  const belt = beltColors(trainer.belt_level);

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      {/* Trainer: photo + name + gender chip */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3 min-w-[200px]">
          <div
            className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 border-2 flex items-center justify-center"
            style={{ borderColor: belt.border, backgroundColor: belt.bg }}
          >
            {photo ? (
              <img
                src={photo}
                alt={trainer.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <span
                className="text-xs font-bold"
                style={{ color: belt.fg === '#FFFFFF' ? '#111827' : belt.fg }}
              >
                {initials}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 truncate">{trainer.name}</p>
            {trainer.gender ? (
              <p className="text-[11px] text-gray-500 mt-0.5">{trainer.gender}</p>
            ) : null}
          </div>
        </div>
      </td>

      {/* Institution */}
      <td className="px-4 py-3">
        {trainer.institution_name ? (
          <div className="flex items-center gap-2 min-w-[160px]">
            <Building2 size={13} className="text-gray-400 flex-shrink-0" />
            <div className="min-w-0">
              <p className="font-medium text-gray-900 truncate">
                {trainer.institution_name}
              </p>
              {trainer.institution_city ? (
                <p className="text-[11px] text-gray-500 truncate">{trainer.institution_city}</p>
              ) : null}
            </div>
          </div>
        ) : (
          <span className="text-gray-400 text-xs">—</span>
        )}
      </td>

      {/* Assigned batches — first 3 inline; "+N more" overflow indicator. */}
      <td className="px-4 py-3">
        {trainer.batches && trainer.batches.length > 0 ? (
          <div className="flex flex-col gap-1 min-w-[200px]">
            {trainer.batches.slice(0, 3).map((b) => (
              <div key={b.id} className="flex items-center gap-1.5 text-xs">
                <CalendarClock size={11} className="text-gray-400 flex-shrink-0" />
                <span className="font-medium text-gray-900 truncate">{b.name}</span>
                {b.course_name ? (
                  <span className="text-gray-400 truncate">· {b.course_name}</span>
                ) : null}
                {b.enrolled_count > 0 ? (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700 flex-shrink-0">
                    <Users size={9} />
                    {b.enrolled_count}
                  </span>
                ) : null}
              </div>
            ))}
            {trainer.batches.length > 3 ? (
              <span className="text-[11px] text-emerald-600 font-semibold">
                +{trainer.batches.length - 3} more
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-gray-400 text-xs italic">Unassigned</span>
        )}
      </td>

      {/* Skill */}
      <td className="px-4 py-3">
        {trainer.specialization ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700">
            <Briefcase size={10} />
            {trainer.specialization}
          </span>
        ) : (
          <span className="text-gray-400 text-xs">—</span>
        )}
      </td>

      {/* Belt */}
      <td className="px-4 py-3">
        {trainer.belt_level ? (
          <span
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold border whitespace-nowrap"
            style={{
              backgroundColor: belt.bg,
              color: belt.fg,
              borderColor: belt.border,
            }}
          >
            <Award size={10} />
            {trainer.belt_level}
          </span>
        ) : (
          <span className="text-gray-400 text-xs">—</span>
        )}
      </td>

      {/* Experience */}
      <td className="px-4 py-3 text-center">
        {trainer.experience_years != null ? (
          <span className="inline-flex items-center px-2 py-1 rounded-md text-[11px] font-semibold bg-gray-100 text-gray-700">
            {trainer.experience_years} yr{trainer.experience_years === 1 ? '' : 's'}
          </span>
        ) : (
          <span className="text-gray-400 text-xs">—</span>
        )}
      </td>

      {/* Contact: email + phone, tappable */}
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1 min-w-[200px]">
          {trainer.phone ? (
            <a
              href={`tel:${trainer.phone}`}
              className="inline-flex items-center gap-2 text-xs text-gray-700 hover:text-green-600 group"
            >
              <Phone size={11} className="text-green-500 group-hover:text-green-600" />
              <span className="font-medium">{trainer.phone}</span>
            </a>
          ) : null}
          {trainer.email ? (
            <a
              href={`mailto:${trainer.email}`}
              className="inline-flex items-center gap-2 text-xs text-gray-700 hover:text-blue-600 group truncate"
              title={trainer.email}
            >
              <Mail size={11} className="text-blue-500 group-hover:text-blue-600 flex-shrink-0" />
              <span className="font-medium truncate">{trainer.email}</span>
            </a>
          ) : null}
          {!trainer.phone && !trainer.email ? (
            <span className="text-gray-400 text-xs">—</span>
          ) : null}
        </div>
      </td>

      {/* Action: View detail modal */}
      <td className="px-4 py-3 text-center">
        <button
          onClick={onView}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
        >
          <Eye size={12} />
          View
        </button>
      </td>
    </tr>
  );
}

// ── Helpers for the detail modal ──────────────────────────────────────
function isPdfUrl(url: string | null): boolean {
  if (!url) return false;
  return /\.pdf(\?.*)?$/i.test(url);
}

function fmtDate(s?: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function ageFromDob(iso?: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

// ── Detail modal ──────────────────────────────────────────────────────
function TrainerDetailModal({
  trainer,
  onClose,
}: {
  trainer: TrainerRow;
  onClose: () => void;
}) {
  const photo = resolveAssetUrl(trainer.photo_url);
  const certUrl = resolveAssetUrl(trainer.certificate_url);
  const certIsPdf = isPdfUrl(certUrl);
  const belt = beltColors(trainer.belt_level);
  const age = ageFromDob(trainer.date_of_birth);
  const initials =
    (trainer.name || '?')
      .split(' ')
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
      >
        {/* Sticky header with close button */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-lg font-bold text-gray-900">Trainer details</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-500"
          >
            <X size={18} />
          </button>
        </div>

        {/* Hero: photo + name + institution */}
        <div className="px-6 py-5 border-b border-gray-100 bg-gray-50">
          <div className="flex items-start gap-4">
            <div
              className="w-20 h-20 rounded-2xl overflow-hidden flex-shrink-0 border-2 flex items-center justify-center"
              style={{ borderColor: belt.border, backgroundColor: belt.bg }}
            >
              {photo ? (
                <img
                  src={photo}
                  alt={trainer.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span
                  className="text-2xl font-bold"
                  style={{ color: belt.fg === '#FFFFFF' ? '#111827' : belt.fg }}
                >
                  {initials}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-xl font-bold text-gray-900 truncate">{trainer.name}</h3>
              {trainer.specialization && (
                <p className="text-sm text-blue-700 font-semibold mt-0.5 flex items-center gap-1">
                  <Briefcase size={12} />
                  {trainer.specialization}
                </p>
              )}
              {trainer.institution_name && (
                <p className="text-sm text-gray-600 mt-1 flex items-center gap-1">
                  <Building2 size={12} />
                  <span>{trainer.institution_name}</span>
                  {trainer.institution_city ? (
                    <span className="text-gray-400">· {trainer.institution_city}</span>
                  ) : null}
                </p>
              )}
              <div className="flex flex-wrap gap-1.5 mt-3">
                {trainer.belt_level && (
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border"
                    style={{
                      backgroundColor: belt.bg,
                      color: belt.fg,
                      borderColor: belt.border,
                    }}
                  >
                    <Award size={10} />
                    {trainer.belt_level}
                  </span>
                )}
                {trainer.experience_years != null && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-gray-200 text-gray-700">
                    {trainer.experience_years} {trainer.experience_years === 1 ? 'year' : 'years'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Body — sections */}
        <div className="p-6 space-y-6">
          {/* Personal */}
          <Section icon={User} title="Personal Information" accent="blue">
            <KVGrid>
              <KV label="Gender" value={trainer.gender} />
              <KV label="Date of Birth" value={fmtDate(trainer.date_of_birth)} />
              <KV label="Age" value={age != null ? `${age} years` : undefined} />
              <KV label="Joined" value={fmtDate(trainer.created_at)} />
            </KVGrid>
          </Section>

          {/* Contact */}
          <Section icon={Phone} title="Contact" accent="emerald">
            <div className="grid grid-cols-2 gap-3">
              {trainer.phone ? (
                <a
                  href={`tel:${trainer.phone}`}
                  className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:bg-green-50 hover:border-green-200 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-lg bg-green-500 flex items-center justify-center">
                    <Phone size={16} className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Phone</p>
                    <p className="text-sm font-semibold text-gray-900 group-hover:text-green-700 truncate">
                      {trainer.phone}
                    </p>
                  </div>
                </a>
              ) : null}
              {trainer.email ? (
                <a
                  href={`mailto:${trainer.email}`}
                  className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:bg-blue-50 hover:border-blue-200 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-lg bg-blue-500 flex items-center justify-center">
                    <Mail size={16} className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Email</p>
                    <p className="text-sm font-semibold text-gray-900 group-hover:text-blue-700 truncate">
                      {trainer.email}
                    </p>
                  </div>
                </a>
              ) : null}
              {!trainer.phone && !trainer.email ? (
                <p className="text-xs text-gray-400 italic col-span-2">No contact details on file.</p>
              ) : null}
            </div>
          </Section>

          {/* Assigned batches */}
          <Section icon={CalendarClock} title="Assigned Batches" accent="emerald">
            {trainer.batches && trainer.batches.length > 0 ? (
              <div className="space-y-2">
                {trainer.batches.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 hover:bg-emerald-50/40 transition-colors"
                  >
                    <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <CalendarClock size={15} className="text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{b.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        {b.course_name || 'No course linked'}
                      </p>
                      {b.days_of_week || (b.start_time && b.end_time) ? (
                        <p className="text-[11px] text-gray-400 mt-1">
                          {b.days_of_week}
                          {b.days_of_week && (b.start_time || b.end_time) ? ' · ' : ''}
                          {b.start_time && b.end_time
                            ? `${formatTime12h(b.start_time)} – ${formatTime12h(b.end_time)}`
                            : ''}
                        </p>
                      ) : null}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700">
                        <Users size={9} />
                        {b.enrolled_count}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">
                Not assigned to any batch yet.
              </p>
            )}
          </Section>

          {/* Skill */}
          <Section icon={Award} title="Skill & Credentials" accent="violet">
            <KVGrid>
              <KV label="Specialization" value={trainer.specialization} />
              <KV label="Belt level" value={trainer.belt_level} />
              <KV
                label="Experience"
                value={
                  trainer.experience_years != null
                    ? `${trainer.experience_years} ${trainer.experience_years === 1 ? 'year' : 'years'}`
                    : undefined
                }
              />
            </KVGrid>
          </Section>

          {/* Identity */}
          <Section icon={ShieldCheck} title="Identity Verification" accent="orange">
            <KVGrid>
              <KV label="Govt proof type" value={trainer.govt_proof_type} />
              <KV label="Govt proof number" value={trainer.govt_proof_number} mono />
            </KVGrid>
          </Section>

          {/* Documents */}
          <Section icon={FileText} title="Documents" accent="rose">
            <div className="space-y-3">
              {/* Photo */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Profile photo
                </p>
                {photo ? (
                  <a
                    href={photo}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block group"
                    title="Open full size"
                  >
                    <img
                      src={photo}
                      alt="Profile"
                      className="w-32 h-32 object-cover rounded-xl border border-gray-200 group-hover:opacity-90 transition-opacity"
                    />
                    <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                      <ExternalLink size={11} />
                      Click to open full size
                    </p>
                  </a>
                ) : (
                  <p className="text-sm text-gray-400 italic">No photo uploaded.</p>
                )}
              </div>

              {/* Certificate */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Certificate
                </p>
                {certUrl ? (
                  certIsPdf ? (
                    <a
                      href={certUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-red-700 hover:bg-red-100 transition-colors"
                    >
                      <FileText size={18} />
                      <span className="text-sm font-semibold">Open Certificate (PDF)</span>
                      <ExternalLink size={14} />
                    </a>
                  ) : (
                    <a
                      href={certUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block group"
                      title="Open full size"
                    >
                      <img
                        src={certUrl}
                        alt="Certificate"
                        className="max-w-full max-h-64 rounded-xl border border-gray-200 group-hover:opacity-90 transition-opacity"
                      />
                      <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                        <ExternalLink size={11} />
                        Click image to open full size
                      </p>
                    </a>
                  )
                ) : (
                  <p className="text-sm text-gray-400 italic">No certificate uploaded.</p>
                )}
              </div>
            </div>
          </Section>

          {/* Bio */}
          {trainer.bio ? (
            <Section icon={Briefcase} title="About" accent="slate">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
                {trainer.bio}
              </p>
            </Section>
          ) : null}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-6 py-4 rounded-b-2xl flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal sub-components ──────────────────────────────────────────────
const ACCENTS: Record<string, { icon: string; bg: string }> = {
  blue:    { icon: 'text-blue-600',    bg: 'bg-blue-50' },
  emerald: { icon: 'text-emerald-600', bg: 'bg-emerald-50' },
  violet:  { icon: 'text-violet-600',  bg: 'bg-violet-50' },
  orange:  { icon: 'text-orange-600',  bg: 'bg-orange-50' },
  rose:    { icon: 'text-rose-600',    bg: 'bg-rose-50' },
  slate:   { icon: 'text-slate-600',   bg: 'bg-slate-100' },
};

function Section({
  icon: Icon,
  title,
  accent,
  children,
}: {
  icon: any;
  title: string;
  accent: keyof typeof ACCENTS;
  children: React.ReactNode;
}) {
  const a = ACCENTS[accent] || ACCENTS.blue;
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-7 h-7 rounded-lg ${a.bg} flex items-center justify-center`}>
          <Icon size={14} className={a.icon} />
        </span>
        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
      </div>
      <div className="pl-9">{children}</div>
    </div>
  );
}

function KVGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-3">{children}</div>;
}

function KV({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{label}</p>
      <p
        className={`text-sm font-semibold text-gray-900 mt-0.5 break-all ${mono ? 'font-mono' : ''}`}
      >
        {value || '—'}
      </p>
    </div>
  );
}

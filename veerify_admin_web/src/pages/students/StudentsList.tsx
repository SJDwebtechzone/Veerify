import { useEffect, useMemo, useState } from 'react';
import {
  GraduationCap, Search, Building2, Mail, Phone, Loader2, Filter,
  X, ChevronDown, Eye, ExternalLink, User, Calendar, Ruler,
  Briefcase, Users, Heart, MapPin,
} from 'lucide-react';
import apiClient from '../../api/client';

interface InstitutionLite {
  id: number;
  name: string;
  city: string | null;
}

// One enrolment row inside StudentRow.courses — the backend returns a
// jsonb_agg array with this shape.
interface EnrolledCourse {
  enrollment_id:    number;
  course_id:        number;
  course_name:      string;
  course_image:     string | null;
  batch_id:         number;
  batch_name:       string;
  institution_id:   number | null;
  institution_name: string | null;
  payment_status:   'pending' | 'paid' | 'failed';
  payment_amount:   number | string | null;
  enrolled_at:      string;
  paid_at:          string | null;
}

interface StudentRow {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  user_status: string | null;
  joined_at: string;

  profile_full_name: string | null;
  date_of_birth: string | null;
  gender: string | null;
  father_name: string | null;
  mother_name: string | null;
  profile_contact_number: string | null;
  profile_email: string | null;
  address: string | null;
  marital_status: string | null;
  occupation: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  disabilities: string | null;
  photo_url: string | null;

  institutions: InstitutionLite[];
  courses: EnrolledCourse[];
  enrollment_count: number;
  paid_enrollment_count: number;
}

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

export function StudentsList() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [institutionFilter, setInstitutionFilter] = useState<string>('');
  const [genderFilter, setGenderFilter] = useState<string>('');

  // Detail modal
  const [viewing, setViewing] = useState<StudentRow | null>(null);

  useEffect(() => {
    setLoading(true);
    apiClient
      .get('/students/all')
      .then((r) => setStudents(r.data?.students || []))
      .catch((err) =>
        setError(err.response?.data?.message || 'Failed to load students'),
      )
      .finally(() => setLoading(false));
  }, []);

  // ── Derive filter option lists ──
  const institutions = useMemo(() => {
    const map = new Map<number, string>();
    students.forEach((s) => {
      (s.institutions || []).forEach((i) => {
        if (i?.id && i?.name) map.set(i.id, i.name);
      });
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [students]);

  const genders = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => {
      if (s.gender) set.add(s.gender);
    });
    return Array.from(set).sort();
  }, [students]);

  // ── Apply filters client-side ──
  const filtered = useMemo(() => {
    let out = students;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(
        (s) =>
          s.name?.toLowerCase().includes(q) ||
          s.email?.toLowerCase().includes(q) ||
          s.phone?.toLowerCase().includes(q) ||
          (s.institutions || []).some((i) =>
            i.name?.toLowerCase().includes(q),
          ) ||
          s.father_name?.toLowerCase().includes(q) ||
          s.mother_name?.toLowerCase().includes(q),
      );
    }
    if (institutionFilter) {
      const id = Number(institutionFilter);
      out = out.filter((s) => (s.institutions || []).some((i) => i.id === id));
    }
    if (genderFilter) {
      out = out.filter((s) => s.gender === genderFilter);
    }
    return out;
  }, [students, search, institutionFilter, genderFilter]);

  const clearFilters = () => {
    setSearch('');
    setInstitutionFilter('');
    setGenderFilter('');
  };

  const anyFilterActive =
    !!search.trim() || !!institutionFilter || !!genderFilter;

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
            <GraduationCap size={20} className="text-emerald-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">All Students</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Platform-wide roster across every academy.
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-gray-900">{filtered.length}</p>
          <p className="text-xs text-gray-500">
            {filtered.length === 1 ? 'student' : 'students'}
            {anyFilterActive ? ` of ${students.length}` : ''}
          </p>
        </div>
      </div>

      {/* Detail modal */}
      {viewing && (
        <StudentDetailModal
          student={viewing}
          onClose={() => setViewing(null)}
        />
      )}

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-12 md:col-span-6 relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, phone, institution, or parent..."
              className="w-full border border-gray-200 rounded-lg pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="col-span-6 md:col-span-4 relative">
            <select
              value={institutionFilter}
              onChange={(e) => setInstitutionFilter(e.target.value)}
              className="w-full appearance-none border border-gray-200 rounded-lg pl-3 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
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
              value={genderFilter}
              onChange={(e) => setGenderFilter(e.target.value)}
              className="w-full appearance-none border border-gray-200 rounded-lg pl-3 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
            >
              <option value="">All genders</option>
              {genders.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {anyFilterActive && (
          <button
            onClick={clearFilters}
            className="mt-3 inline-flex items-center gap-1 text-xs text-emerald-600 font-semibold hover:underline"
          >
            <X size={12} />
            Clear filters
          </button>
        )}
      </div>

      {/* Error / loading / empty / table */}
      {error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 size={20} className="animate-spin mr-2" />
          Loading students...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <Filter size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-600 font-semibold">No students match these filters.</p>
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
                  <Th>Student</Th>
                  <Th>Institution(s)</Th>
                  <Th>Courses</Th>
                  <Th>Age</Th>
                  <Th>Contact</Th>
                  <Th className="text-center">Enrollments</Th>
                  <Th className="text-center">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((s) => (
                  <StudentRow
                    key={s.id}
                    student={s}
                    onView={() => setViewing(s)}
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

function StudentRow({
  student,
  onView,
}: {
  student: StudentRow;
  onView: () => void;
}) {
  const photo = resolveAssetUrl(student.photo_url);
  const initials =
    (student.name || '?')
      .split(' ')
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();
  const age = ageFromDob(student.date_of_birth);

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      {/* Student: photo + name + gender chip */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3 min-w-[220px]">
          <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 border-2 border-emerald-100 bg-emerald-50 flex items-center justify-center">
            {photo ? (
              <img src={photo} alt={student.name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs font-bold text-emerald-700">{initials}</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 truncate">{student.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              {student.gender ? (
                <span className="text-[11px] text-gray-500">{student.gender}</span>
              ) : null}
              {student.user_status === 'active' ? (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700 uppercase">
                  Active
                </span>
              ) : student.user_status ? (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 uppercase">
                  {student.user_status}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </td>

      {/* Institutions */}
      <td className="px-4 py-3">
        {student.institutions && student.institutions.length > 0 ? (
          <div className="flex flex-col gap-1 min-w-[180px]">
            {student.institutions.slice(0, 2).map((inst) => (
              <div key={inst.id} className="flex items-center gap-1.5 text-xs">
                <Building2 size={11} className="text-gray-400 flex-shrink-0" />
                <span className="font-medium text-gray-900 truncate">{inst.name}</span>
                {inst.city ? (
                  <span className="text-gray-400">· {inst.city}</span>
                ) : null}
              </div>
            ))}
            {student.institutions.length > 2 ? (
              <span className="text-[11px] text-emerald-600 font-semibold">
                +{student.institutions.length - 2} more
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-gray-400 text-xs">No enrollments</span>
        )}
      </td>

      {/* Courses — list each enrolled course with a paid/pending pill so
          super admin can see at a glance what every student signed up for. */}
      <td className="px-4 py-3">
        {student.courses && student.courses.length > 0 ? (
          <div className="flex flex-col gap-1 min-w-[200px]">
            {student.courses.slice(0, 3).map((c) => (
              <div key={c.enrollment_id} className="flex items-center gap-1.5 text-xs">
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    c.payment_status === 'paid'
                      ? 'bg-emerald-500'
                      : c.payment_status === 'failed'
                        ? 'bg-rose-500'
                        : 'bg-amber-500'
                  }`}
                  title={c.payment_status}
                />
                <span className="font-medium text-gray-900 truncate">
                  {c.course_name}
                </span>
                {c.batch_name ? (
                  <span className="text-gray-400 truncate">· {c.batch_name}</span>
                ) : null}
              </div>
            ))}
            {student.courses.length > 3 ? (
              <span className="text-[11px] text-emerald-600 font-semibold">
                +{student.courses.length - 3} more
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-gray-400 text-xs">—</span>
        )}
      </td>

      {/* Age */}
      <td className="px-4 py-3">
        {age != null ? (
          <span className="inline-flex items-center px-2 py-1 rounded-md text-[11px] font-semibold bg-gray-100 text-gray-700">
            {age} yrs
          </span>
        ) : (
          <span className="text-gray-400 text-xs">—</span>
        )}
      </td>

      {/* Contact */}
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1 min-w-[180px]">
          {student.phone ? (
            <a
              href={`tel:${student.phone}`}
              className="inline-flex items-center gap-2 text-xs text-gray-700 hover:text-green-600 group"
            >
              <Phone size={11} className="text-green-500 group-hover:text-green-600" />
              <span className="font-medium">{student.phone}</span>
            </a>
          ) : null}
          {student.email ? (
            <a
              href={`mailto:${student.email}`}
              className="inline-flex items-center gap-2 text-xs text-gray-700 hover:text-blue-600 group truncate"
              title={student.email}
            >
              <Mail size={11} className="text-blue-500 group-hover:text-blue-600 flex-shrink-0" />
              <span className="font-medium truncate">{student.email}</span>
            </a>
          ) : null}
          {!student.phone && !student.email ? (
            <span className="text-gray-400 text-xs">—</span>
          ) : null}
        </div>
      </td>

      {/* Enrollment count */}
      <td className="px-4 py-3 text-center">
        <div className="inline-flex items-center gap-1">
          <span className="text-sm font-bold text-gray-900">{student.enrollment_count}</span>
          {student.paid_enrollment_count > 0 ? (
            <span className="text-[10px] font-semibold text-green-600">
              · {student.paid_enrollment_count} paid
            </span>
          ) : null}
        </div>
      </td>

      {/* Action */}
      <td className="px-4 py-3 text-center">
        <button
          onClick={onView}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
        >
          <Eye size={12} />
          View
        </button>
      </td>
    </tr>
  );
}

// ── Detail modal ──────────────────────────────────────────────────────
function StudentDetailModal({
  student,
  onClose,
}: {
  student: StudentRow;
  onClose: () => void;
}) {
  const photo = resolveAssetUrl(student.photo_url);
  const age = ageFromDob(student.date_of_birth);
  const initials =
    (student.name || '?')
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
        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-lg font-bold text-gray-900">Student details</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-500"
          >
            <X size={18} />
          </button>
        </div>

        {/* Hero: photo + name + institutions */}
        <div className="px-6 py-5 border-b border-gray-100 bg-gray-50">
          <div className="flex items-start gap-4">
            <div className="w-20 h-20 rounded-2xl overflow-hidden flex-shrink-0 border-2 border-emerald-200 bg-emerald-50 flex items-center justify-center">
              {photo ? (
                <img src={photo} alt={student.name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-emerald-700">{initials}</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-xl font-bold text-gray-900 truncate">
                {student.profile_full_name || student.name}
              </h3>
              <p className="text-sm text-gray-600 mt-0.5">
                {age != null ? `${age} years old` : '—'}
                {student.gender ? ` · ${student.gender}` : ''}
              </p>
              {student.institutions && student.institutions.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {student.institutions.map((inst) => (
                    <span
                      key={inst.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700"
                    >
                      <Building2 size={10} />
                      {inst.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Sections */}
        <div className="p-6 space-y-6">
          <Section icon={User} title="Personal Information" accent="blue">
            <KVGrid>
              <KV label="Full Name" value={student.profile_full_name || student.name} />
              <KV label="Date of Birth" value={fmtDate(student.date_of_birth)} />
              <KV label="Age" value={age != null ? `${age} years` : undefined} />
              <KV label="Gender" value={student.gender} />
              <KV label="Marital Status" value={student.marital_status} />
              <KV label="Occupation" value={student.occupation} />
            </KVGrid>
          </Section>

          <Section icon={Users} title="Family" accent="violet">
            <KVGrid>
              <KV label="Father / Guardian" value={student.father_name} />
              <KV label="Mother" value={student.mother_name} />
            </KVGrid>
          </Section>

          <Section icon={Phone} title="Contact" accent="emerald">
            <div className="grid grid-cols-2 gap-3 mb-3">
              {student.phone || student.profile_contact_number ? (
                <a
                  href={`tel:${student.phone || student.profile_contact_number}`}
                  className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:bg-green-50 hover:border-green-200 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-lg bg-green-500 flex items-center justify-center">
                    <Phone size={16} className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Phone</p>
                    <p className="text-sm font-semibold text-gray-900 group-hover:text-green-700 truncate">
                      {student.phone || student.profile_contact_number}
                    </p>
                  </div>
                </a>
              ) : null}
              {student.email || student.profile_email ? (
                <a
                  href={`mailto:${student.email || student.profile_email}`}
                  className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:bg-blue-50 hover:border-blue-200 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-lg bg-blue-500 flex items-center justify-center">
                    <Mail size={16} className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Email</p>
                    <p className="text-sm font-semibold text-gray-900 group-hover:text-blue-700 truncate">
                      {student.email || student.profile_email}
                    </p>
                  </div>
                </a>
              ) : null}
            </div>
            {student.address ? (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-gray-50">
                <MapPin size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Address</p>
                  <p className="text-sm text-gray-900 whitespace-pre-line mt-0.5">{student.address}</p>
                </div>
              </div>
            ) : null}
          </Section>

          <Section icon={Ruler} title="Physical" accent="orange">
            <KVGrid>
              <KV
                label="Height"
                value={student.height_cm ? `${student.height_cm} cm` : undefined}
              />
              <KV
                label="Weight"
                value={student.weight_kg ? `${student.weight_kg} kg` : undefined}
              />
              <KV
                label="Disabilities"
                value={student.disabilities || 'None'}
              />
            </KVGrid>
          </Section>

          <Section icon={Briefcase} title="Enrolled Courses" accent="rose">
            {student.courses && student.courses.length > 0 ? (
              <div className="space-y-2">
                {student.courses.map((c) => (
                  <div
                    key={c.enrollment_id}
                    className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 hover:bg-rose-50/40 transition-colors"
                  >
                    {/* Status dot */}
                    <span
                      className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${
                        c.payment_status === 'paid'
                          ? 'bg-emerald-500'
                          : c.payment_status === 'failed'
                            ? 'bg-rose-500'
                            : 'bg-amber-500'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {c.course_name}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        {c.batch_name}
                        {c.institution_name ? ` · ${c.institution_name}` : ''}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-1">
                        Enrolled {fmtDate(c.enrolled_at)}
                        {c.paid_at ? ` · Paid ${fmtDate(c.paid_at)}` : ''}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                          c.payment_status === 'paid'
                            ? 'bg-emerald-100 text-emerald-700'
                            : c.payment_status === 'failed'
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {c.payment_status}
                      </span>
                      {c.payment_amount ? (
                        <p className="text-xs text-gray-600 font-mono mt-1 tabular-nums">
                          ₹{Number(c.payment_amount).toLocaleString('en-IN')}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">No course enrolments yet.</p>
            )}

            <div className="mt-4 pt-3 border-t border-gray-100">
              <KVGrid>
                <KV label="Total Enrollments" value={String(student.enrollment_count || 0)} />
                <KV label="Paid Enrollments" value={String(student.paid_enrollment_count || 0)} />
                <KV label="Joined" value={fmtDate(student.joined_at)} />
                <KV label="Account status" value={student.user_status} />
              </KVGrid>
            </div>
          </Section>

          {photo ? (
            <Section icon={User} title="Profile Photo" accent="slate">
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
                  className="w-40 h-40 object-cover rounded-xl border border-gray-200 group-hover:opacity-90 transition-opacity"
                />
                <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                  <ExternalLink size={11} />
                  Click to open full size
                </p>
              </a>
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
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div>
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-sm font-semibold text-gray-900 mt-0.5 break-words">{value || '—'}</p>
    </div>
  );
}

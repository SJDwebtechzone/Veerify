import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Building2, User, Phone, Mail, MapPin,
  Globe, Award, Hash, CreditCard, CheckCircle,
  XCircle, Zap, Calendar, BookOpenCheck, Briefcase, ShieldCheck,
  FileText, BarChart3, Users, Clock, Image as ImageIcon,
  ExternalLink, Building, Languages, Send, BookOpen, UserCog,
  GraduationCap, Layers, Wallet, Settings,
} from 'lucide-react';
import apiClient from '../../api/client';

interface CourseRow {
  id: number;
  name: string;
  description: string | null;
  short_description: string | null;
  image_url: string | null;
  price: string | number | null;
  duration_months: number | null;
  mode: 'online' | 'offline' | 'hybrid' | null;
  category: string | null;
  level: string | null;
  status: 'active' | 'inactive' | 'draft' | null;
  badge: 'popular' | 'new' | 'kids_special' | null;
  batch_count: number;
  enrollment_count: number;
  created_at: string;
}

interface StaffRow {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  specialization: string | null;
  belt_level: string | null;
  experience_years: number | null;
  photo_url: string | null;
  gender: string | null;
  created_at: string;
}

interface Branch {
  name?: string;
  address?: string;
  city?: string;
  pincode?: string;
  // Captured on the mobile setup wizard's branches step. Optional so old
  // institutions that pre-date the email/phone fields still render.
  email?: string;
  contact_number?: string;
}

interface Institution {
  id: number;
  // Core
  name: string;
  brand_name?: string | null;
  institution_type: string;
  institution_types?: string[] | null;
  registration_number: string;
  date_of_establishment?: string | null;
  logo_url: string;
  // Skills offered (wizard v2)
  skills?: string[] | null;
  // Contact & Location
  email: string;
  phone: string;
  website_url: string;
  address: string;
  city: string;
  pincode: string;
  no_of_branches?: number | null;
  branches?: Branch[] | null;
  // GPS coordinates of the head office (wizard v2)
  latitude?: number | string | null;
  longitude?: number | string | null;
  // Accreditation
  affiliation_or_board?: string | null;
  accreditation_body_name?: string | null;
  accreditation_expiry_date?: string | null;
  accreditation_certificate_url?: string | null;
  // Operations
  total_student_capacity?: number | null;
  current_enrollment?: number | null;
  medium_of_instruction?: string[] | null;
  operating_hours?: string | null;
  // Structured time-slot arrays (wizard v2) — Mon–Fri and Sat–Sun
  operating_hours_weekday?: Array<{ start?: string; end?: string }> | null;
  operating_hours_weekend?: Array<{ start?: string; end?: string }> | null;
  // Point of contact
  master_name: string;
  master_role?: string | null;
  master_email?: string | null;
  master_phone_number?: string | null;
  // Status + ownership
  onboarding_status: string;
  rejection_reason: string;
  created_at: string;
  approved_at: string;
  subscription_start: string;
  subscription_end: string;
  owner_name: string;
  owner_email: string;
  owner_phone: string;
  // Plan
  plan_name: string;
  plan_price: string;
  plan_features: Record<string, boolean>;
  max_students: number;
  max_trainers: number;
  max_branches: number;
  // Payment
  payment_link_id?: string | null;
  payment_link_url?: string | null;
  payment_link_status?: 'pending' | 'paid' | 'expired' | 'cancelled' | null;
  payment_amount?: number | null;
  payment_reference?: string | null;
  paid_at?: string | null;
}

// Files saved as ABSOLUTE URLs sometimes use the API host (10.0.2.2 from
// the Android emulator) which the browser can't reach. Rewrite known dev
// hosts to whatever host the API client is currently pointed at.
function resolveAssetUrl(raw?: string | null): string | null {
  if (!raw) return null;
  // Relative path? Prepend the API origin (sans /api).
  if (raw.startsWith('/')) {
    const apiOrigin = apiClient.defaults.baseURL?.replace(/\/api\/?$/, '') || '';
    return `${apiOrigin}${raw}`;
  }
  // Replace emulator-only hosts
  return raw.replace(/^http:\/\/10\.0\.2\.2(?::\d+)?/, () => {
    return apiClient.defaults.baseURL?.replace(/\/api\/?$/, '') || raw;
  });
}

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

// Convert a "HH:MM" 24-hour string into a friendlier "9:00 AM" label
// for the operating-hours display.
function formatTime12(value?: string | null): string {
  if (!value) return '—';
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value));
  if (!m) return value;
  const h = Number(m[1]);
  const mm = m[2];
  const isPM = h >= 12;
  const h12 = h % 12 || 12;
  return `${h12}:${mm} ${isPM ? 'PM' : 'AM'}`;
}

export function InstitutionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [institution, setInstitution] = useState<Institution | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  // Super-admin -> institution owner notification modal
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [notifyTitle, setNotifyTitle] = useState('');
  const [notifyMessage, setNotifyMessage] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Courses + staff for this institution, fetched once it loads.
  const [courses, setCourses] = useState<CourseRow[] | null>(null);
  const [staff, setStaff] = useState<StaffRow[] | null>(null);

  useEffect(() => {
    loadInstitution();
  }, [id]);

  // Side-load the courses + staff for this institution. Independent fetches so
  // one slow query doesn't block the other section from rendering.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    apiClient
      .get(`/courses/institution/${id}?include_all=1`)
      .then((r) => { if (!cancelled) setCourses(r.data?.courses || []); })
      .catch(() => { if (!cancelled) setCourses([]); });
    apiClient
      .get(`/trainers/all?institution_id=${id}`)
      .then((r) => { if (!cancelled) setStaff(r.data?.trainers || []); })
      .catch(() => { if (!cancelled) setStaff([]); });
    return () => { cancelled = true; };
  }, [id]);

  const loadInstitution = async () => {
    try {
      const res = await apiClient.get(`/onboarding/${id}`);
      setInstitution(res.data.institution);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load institution');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!window.confirm(`Approve ${institution?.name}? This will notify the academy owner to complete payment.`)) return;
    setActionLoading(true);
    try {
      const res = await apiClient.post(`/onboarding/approve/${id}`);
      setSuccessMessage(res.data.message);
      loadInstitution();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to approve');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      setError('Please provide a rejection reason');
      return;
    }
    setActionLoading(true);
    try {
      await apiClient.post(`/onboarding/reject/${id}`, { reason: rejectReason });
      setShowRejectModal(false);
      setSuccessMessage('Institution rejected successfully');
      loadInstitution();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to reject');
    } finally {
      setActionLoading(false);
    }
  };

  const handleResend = async () => {
    if (!window.confirm('Regenerate the payment link and re-email the owner?')) return;
    setActionLoading(true);
    setError('');
    try {
      const res = await apiClient.post(`/onboarding/resend-payment-link/${id}`);
      setSuccessMessage(res.data.message);
      loadInstitution();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to resend payment link');
    } finally {
      setActionLoading(false);
    }
  };

  const handleActivate = async () => {
    if (!window.confirm(`Mark ${institution?.name} as ACTIVE? This confirms payment received.`)) return;
    setActionLoading(true);
    try {
      const res = await apiClient.post(`/onboarding/activate/${id}`);
      setSuccessMessage(res.data.message);
      loadInstitution();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to activate');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendNotification = async () => {
    if (!notifyTitle.trim()) {
      setError('Title is required');
      return;
    }
    setActionLoading(true);
    setError('');
    try {
      const res = await apiClient.post(`/onboarding/${id}/notify`, {
        title:    notifyTitle.trim(),
        message:  notifyMessage.trim() || null,
        category: 'system',
      });
      setSuccessMessage(res.data?.message || 'Notification sent.');
      setShowNotifyModal(false);
      setNotifyTitle('');
      setNotifyMessage('');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to send notification');
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending_approval: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      approved: 'bg-blue-100 text-blue-800 border-blue-200',
      active: 'bg-green-100 text-green-800 border-green-200',
      rejected: 'bg-red-100 text-red-800 border-red-200',
    };
    return colors[status] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error && !institution) {
    return (
      <div className="text-center py-20">
        <p className="text-red-500">{error}</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-blue-600 hover:underline">
          Go back
        </button>
      </div>
    );
  }

    if (!institution) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Institution data not found.</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-blue-600 hover:underline">Go back</button>
      </div>
    );
  }

  // ── Derived asset URLs (handle relative paths and emulator hosts) ──
  const logoUrl = resolveAssetUrl(institution.logo_url);
  const certUrl = resolveAssetUrl(institution.accreditation_certificate_url);
  const certIsPdf = isPdfUrl(certUrl);

  // Prefer institution_types[] (new), fall back to single institution_type.
  const types =
    Array.isArray(institution.institution_types) && institution.institution_types.length > 0
      ? institution.institution_types
      : (institution.institution_type ? [institution.institution_type] : []);

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Back button + header */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-3 transition-colors"
          >
            <ArrowLeft size={16} />
            <span className="text-sm">Back</span>
          </button>
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={`${institution.name} logo`}
                className="w-12 h-12 rounded-xl border border-gray-100 object-cover"
              />
            ) : null}
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {institution.brand_name || institution.name}
              </h1>
              <p className="text-gray-500 mt-1 text-sm">
                {institution.brand_name && institution.brand_name !== institution.name
                  ? `${institution.name} · `
                  : ''}
                {types.join(' · ') || '—'}
                {institution.city ? ` · ${institution.city}` : ''}
              </p>
            </div>
          </div>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-semibold border ${getStatusColor(institution.onboarding_status)}`}>
          {institution.onboarding_status.replace(/_/g, ' ').toUpperCase()}
        </span>
      </div>

      {/* Success message */}
      {successMessage && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <CheckCircle size={16} />
          {successMessage}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Rejection reason (if rejected) */}
      {institution.onboarding_status === 'rejected' && institution.rejection_reason && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <h3 className="font-semibold text-red-800 mb-1">Rejection Reason</h3>
          <p className="text-red-700">{institution.rejection_reason}</p>
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">

        {/* ────────────────── LEFT COLUMN — Form Details ────────────────── */}
        <div className="col-span-12 lg:col-span-8 space-y-6">

          {/* ── 1. Core Details ── */}
          <Card icon={Building2} accent="blue" title="Core Details">
            <div className="grid grid-cols-2 gap-4">
              <InfoRow icon={Building2} label="Institution Name" value={institution.name} />
              <InfoRow
                icon={Award}
                label="Brand Name"
                value={institution.brand_name || '—'}
              />
              <InfoRow icon={Hash} label="Registration No." value={institution.registration_number} />
              <InfoRow
                icon={Calendar}
                label="Date of Establishment"
                value={fmtDate(institution.date_of_establishment)}
              />
            </div>

            {/* Type chips — multi-select */}
            <div className="mt-4 pt-4 border-t border-gray-50">
              <p className="text-xs text-gray-500 mb-2">Institution Type{types.length !== 1 ? 's' : ''}</p>
              <div className="flex flex-wrap gap-2">
                {types.length > 0 ? (
                  types.map((t, i) => (
                    <span
                      key={`${t}-${i}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-semibold border border-blue-100"
                    >
                      {t}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-gray-400">—</span>
                )}
              </div>
            </div>

            {/* Skills chips — martial-arts disciplines taught (wizard v2) */}
            <div className="mt-4 pt-4 border-t border-gray-50">
              <p className="text-xs text-gray-500 mb-2">Skills Offered</p>
              <div className="flex flex-wrap gap-2">
                {Array.isArray(institution.skills) && institution.skills.length > 0 ? (
                  institution.skills.map((s, i) => (
                    <span
                      key={`${s}-${i}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-50 text-rose-700 rounded-full text-xs font-semibold border border-rose-100"
                    >
                      {s}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-gray-400">—</span>
                )}
              </div>
            </div>
          </Card>

          {/* ── 2. Contact & Location ── */}
          <Card icon={MapPin} accent="emerald" title="Contact & Location">
            <div className="grid grid-cols-2 gap-4">
              <InfoRow icon={Mail} label="Official Email" value={institution.email} />
              <InfoRow icon={Phone} label="Primary Contact" value={institution.phone} />
              {institution.website_url ? (
                <InfoRow icon={Globe} label="Website" value={institution.website_url} isLink />
              ) : (
                <InfoRow icon={Globe} label="Website" value="—" />
              )}
              <InfoRow
                icon={Building}
                label="Branches"
                value={
                  institution.no_of_branches != null && institution.no_of_branches > 0
                    ? `${institution.no_of_branches} branch${institution.no_of_branches === 1 ? '' : 'es'}`
                    : '—'
                }
              />
            </div>

            {/* Head office address */}
            <div className="mt-4 pt-4 border-t border-gray-50">
              <p className="text-xs text-gray-500 mb-1">Head Office Address</p>
              <p className="text-sm text-gray-900">
                {institution.address || '—'}
                {(institution.city || institution.pincode) && (
                  <span className="block text-gray-500 mt-1">
                    {[institution.city, institution.pincode].filter(Boolean).join(' · ')}
                  </span>
                )}
              </p>
            </div>

            {/* Head office GPS — captured via the wizard's "Use my current
                location" button. Click the link to drop a pin on Google Maps. */}
            {(institution.latitude != null && institution.longitude != null) ? (
              <div className="mt-4 pt-4 border-t border-gray-50">
                <p className="text-xs text-gray-500 mb-1">Head Office Coordinates</p>
                <a
                  href={`https://www.google.com/maps?q=${institution.latitude},${institution.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-mono text-emerald-700 hover:text-emerald-800 hover:underline inline-flex items-center gap-1"
                  title="Open in Google Maps"
                >
                  {Number(institution.latitude).toFixed(5)}, {Number(institution.longitude).toFixed(5)}
                  <ExternalLink size={11} />
                </a>
              </div>
            ) : null}

            {/* Branch list */}
            {institution.branches && institution.branches.length > 0 ? (
              <div className="mt-4 pt-4 border-t border-gray-50">
                <p className="text-xs text-gray-500 mb-2">Branch Locations</p>
                <div className="space-y-2">
                  {institution.branches.map((b, i) => (
                    <div
                      key={i}
                      className="border border-gray-100 rounded-lg p-3 bg-gray-50/40"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-semibold text-gray-900">
                          {b.name || `Branch ${i + 1}`}
                        </p>
                        <span className="text-xs text-gray-400">#{i + 1}</span>
                      </div>
                      {b.address ? (
                        <p className="text-xs text-gray-600">{b.address}</p>
                      ) : null}
                      {(b.city || b.pincode) ? (
                        <p className="text-xs text-gray-500 mt-1">
                          {[b.city, b.pincode].filter(Boolean).join(' · ')}
                        </p>
                      ) : null}
                      {(b.email || b.contact_number) ? (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 pt-2 border-t border-gray-100">
                          {b.email ? (
                            <a
                              href={`mailto:${b.email}`}
                              className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
                            >
                              ✉ {b.email}
                            </a>
                          ) : null}
                          {b.contact_number ? (
                            <a
                              href={`tel:${b.contact_number}`}
                              className="text-xs text-gray-700 hover:underline inline-flex items-center gap-1"
                            >
                              ☎ {b.contact_number}
                            </a>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>

          {/* ── 3. Accreditation ── */}
          <Card icon={ShieldCheck} accent="violet" title="Accreditation">
            <div className="grid grid-cols-2 gap-4">
              <InfoRow
                icon={BookOpenCheck}
                label="Affiliation / Board"
                value={institution.affiliation_or_board || '—'}
              />
              <InfoRow
                icon={Award}
                label="Accreditation Body"
                value={institution.accreditation_body_name || '—'}
              />
              <InfoRow
                icon={Calendar}
                label="Certificate Expiry"
                value={fmtDate(institution.accreditation_expiry_date)}
              />
            </div>

            {/* Certificate viewer */}
            <div className="mt-4 pt-4 border-t border-gray-50">
              <p className="text-xs text-gray-500 mb-2">Accreditation Certificate</p>
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
                    className="inline-block"
                    title="Click to open full-size"
                  >
                    <img
                      src={certUrl}
                      alt="Accreditation certificate"
                      className="max-w-full max-h-64 rounded-xl border border-gray-200 hover:opacity-90 transition-opacity"
                    />
                    <div className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                      <ExternalLink size={11} />
                      Click image to open full size
                    </div>
                  </a>
                )
              ) : (
                <p className="text-sm text-gray-400 italic">No certificate uploaded.</p>
              )}
            </div>
          </Card>

          {/* ── 4. Operations ── */}
          <Card icon={BarChart3} accent="orange" title="Operations">
            <div className="grid grid-cols-2 gap-4">
              <InfoRow
                icon={Users}
                label="Total Student Capacity"
                value={
                  institution.total_student_capacity != null
                    ? institution.total_student_capacity.toLocaleString('en-IN')
                    : '—'
                }
              />
              <InfoRow
                icon={Users}
                label="Current Enrollment"
                value={
                  institution.current_enrollment != null
                    ? institution.current_enrollment.toLocaleString('en-IN')
                    : '—'
                }
              />
            </div>

            {/* Structured operating-hour slots (wizard v2). Falls back to
                the legacy text summary if the new arrays are empty. */}
            <div className="mt-4 pt-4 border-t border-gray-50">
              <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                <Clock size={12} />
                Operating Hours
              </p>
              {Array.isArray(institution.operating_hours_weekday) &&
               institution.operating_hours_weekday.length > 0 ||
               Array.isArray(institution.operating_hours_weekend) &&
               institution.operating_hours_weekend.length > 0 ? (
                <div className="space-y-2">
                  {Array.isArray(institution.operating_hours_weekday)
                   && institution.operating_hours_weekday.length > 0 ? (
                    <div className="flex items-start gap-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-orange-700 bg-orange-50 border border-orange-100 px-2 py-0.5 rounded-md mt-0.5">
                        Mon–Fri
                      </span>
                      <p className="text-sm text-gray-900 font-mono">
                        {institution.operating_hours_weekday
                          .map((s) => `${formatTime12(s.start)} – ${formatTime12(s.end)}`)
                          .join(', ')}
                      </p>
                    </div>
                  ) : null}
                  {Array.isArray(institution.operating_hours_weekend)
                   && institution.operating_hours_weekend.length > 0 ? (
                    <div className="flex items-start gap-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-orange-700 bg-orange-50 border border-orange-100 px-2 py-0.5 rounded-md mt-0.5">
                        Sat–Sun
                      </span>
                      <p className="text-sm text-gray-900 font-mono">
                        {institution.operating_hours_weekend
                          .map((s) => `${formatTime12(s.start)} – ${formatTime12(s.end)}`)
                          .join(', ')}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-gray-700">{institution.operating_hours || '—'}</p>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-gray-50">
              <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                <Languages size={12} />
                Medium of Instruction
              </p>
              <div className="flex flex-wrap gap-2">
                {institution.medium_of_instruction && institution.medium_of_instruction.length > 0 ? (
                  institution.medium_of_instruction.map((m, i) => (
                    <span
                      key={`${m}-${i}`}
                      className="px-2.5 py-1 bg-orange-50 text-orange-700 rounded-full text-xs font-semibold border border-orange-100"
                    >
                      {m}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-gray-400">—</span>
                )}
              </div>
            </div>
          </Card>

          {/* ── 5. Point of Contact (Master) ── */}
          <Card icon={Briefcase} accent="rose" title="Master / Point of Contact">
            <div className="grid grid-cols-2 gap-4">
              <InfoRow icon={User} label="Master Name" value={institution.master_name} />
              <InfoRow
                icon={Briefcase}
                label="Role"
                value={institution.master_role || '—'}
              />
              <InfoRow
                icon={Mail}
                label="Email"
                value={institution.master_email || '—'}
              />
              <InfoRow
                icon={Phone}
                label="Phone"
                value={institution.master_phone_number || '—'}
              />
            </div>
          </Card>

          {/* ── Courses Offered ── */}
          <Card
            icon={BookOpen}
            accent="violet"
            title="Courses Offered"
            count={courses?.length}
          >
            {courses === null ? (
              <p className="text-sm text-gray-400 italic py-4">Loading courses…</p>
            ) : courses.length === 0 ? (
              <p className="text-sm text-gray-400 italic py-4">
                This institution hasn't published any courses yet.
              </p>
            ) : (
              <div className="space-y-2">
                {courses.map((c) => (
                  <CourseRowItem key={c.id} course={c} />
                ))}
              </div>
            )}
          </Card>

          {/* ── Staff (Trainers) ── */}
          <Card
            icon={UserCog}
            accent="emerald"
            title="Staff"
            count={staff?.length}
          >
            {staff === null ? (
              <p className="text-sm text-gray-400 italic py-4">Loading staff…</p>
            ) : staff.length === 0 ? (
              <p className="text-sm text-gray-400 italic py-4">
                No trainers enrolled at this institution yet.
              </p>
            ) : (
              <div className="space-y-2">
                {staff.map((s) => (
                  <StaffRowItem key={s.id} staff={s} />
                ))}
              </div>
            )}
          </Card>

          {/* ── Owner / Login (admin context) ── */}
          <Card icon={User} accent="slate" title="Account Owner">
            <div className="grid grid-cols-3 gap-4">
              <InfoRow icon={User} label="Name" value={institution.owner_name} />
              <InfoRow icon={Mail} label="Email" value={institution.owner_email} />
              <InfoRow icon={Phone} label="Phone" value={institution.owner_phone || '—'} />
            </div>
            <p className="text-xs text-gray-400 mt-3">
              This is the user who registered the academy on the platform.
            </p>
          </Card>

          {/* ── Documents (logo) ── */}
          {logoUrl ? (
            <Card icon={ImageIcon} accent="indigo" title="Brand Logo">
              <a
                href={logoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block"
                title="Open full size"
              >
                <img
                  src={logoUrl}
                  alt="Academy Logo"
                  className="w-40 h-40 object-cover rounded-xl border border-gray-100 hover:opacity-90 transition-opacity"
                />
                <div className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                  <ExternalLink size={11} />
                  Click to open full size
                </div>
              </a>
            </Card>
          ) : null}

        </div>

        {/* ────────────────── RIGHT COLUMN — Plan + Actions ────────────────── */}
        <div className="col-span-12 lg:col-span-4 space-y-6">

          {/* Subscription Plan */}
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <CreditCard size={20} className="text-purple-600" />
              Subscription Plan
            </h2>
            <div className={`rounded-xl p-4 mb-4 ${
              institution.plan_name === 'Pro'
                ? 'bg-purple-50 border border-purple-200'
                : 'bg-blue-50 border border-blue-200'
            }`}>
              <p className={`text-xl font-bold ${
                institution.plan_name === 'Pro' ? 'text-purple-700' : 'text-blue-700'
              }`}>
                {institution.plan_name || '—'}
              </p>
              <p className={`text-2xl font-bold mt-1 ${
                institution.plan_name === 'Pro' ? 'text-purple-900' : 'text-blue-900'
              }`}>
                ₹{parseInt(institution.plan_price || '0').toLocaleString()}
                <span className="text-sm font-normal">/month</span>
              </p>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Branches</span>
                <span className="font-medium">
                  {institution.max_branches >= 999 ? 'Unlimited' : institution.max_branches}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Students</span>
                <span className="font-medium">
                  {institution.max_students >= 999 ? 'Unlimited' : `Up to ${institution.max_students}`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Trainers</span>
                <span className="font-medium">
                  {institution.max_trainers >= 999 ? 'Unlimited' : `Up to ${institution.max_trainers}`}
                </span>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Timeline</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Submitted</span>
                <span className="font-medium">{fmtDate(institution.created_at)}</span>
              </div>
              {institution.approved_at && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Approved</span>
                  <span className="font-medium text-green-600">{fmtDate(institution.approved_at)}</span>
                </div>
              )}
              {institution.subscription_start && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Active Since</span>
                  <span className="font-medium">{fmtDate(institution.subscription_start)}</span>
                </div>
              )}
              {institution.subscription_end && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Expires</span>
                  <span className="font-medium text-orange-600">{fmtDate(institution.subscription_end)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Actions</h2>

            {/* Send notification - available at any status so the super
                admin can reach owners about renewals, feature launches,
                or platform-wide announcements regardless of lifecycle. */}
            <button
              onClick={() => setShowNotifyModal(true)}
              disabled={actionLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border-2 border-blue-200 text-blue-700 rounded-xl font-semibold hover:bg-blue-50 transition-colors disabled:opacity-60"
            >
              <Send size={18} />
              Send Notification
            </button>
            <Link
              to={`/institutions/${institution?.id}/marketplace`}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors mt-3"
            >
              <Settings size={18} />
              Marketplace Settings
            </Link>

            {/* PENDING → Show Approve + Reject */}
            {institution.onboarding_status === 'pending_approval' && (
              <>
                <button
                  onClick={handleApprove}
                  disabled={actionLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition-colors disabled:opacity-60"
                >
                  <CheckCircle size={18} />
                  {actionLoading ? 'Processing...' : 'Approve Academy'}
                </button>
                <button
                  onClick={() => setShowRejectModal(true)}
                  disabled={actionLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border-2 border-red-200 text-red-600 rounded-xl font-semibold hover:bg-red-50 transition-colors disabled:opacity-60"
                >
                  <XCircle size={18} />
                  Reject Application
                </button>
              </>
            )}

            {/* APPROVED → Show payment status, payment link, and Activate override */}
            {institution.onboarding_status === 'approved' && (
              <>
                {institution.payment_link_status === 'paid' ? (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800">
                    <p className="font-semibold">✓ Payment received</p>
                    <p className="mt-1">
                      Webhook hasn't auto-activated yet — click below to flip the
                      academy live.
                    </p>
                  </div>
                ) : (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                    <p className="font-semibold">⏳ Waiting for Payment</p>
                    <p className="mt-1">
                      Approval email sent to{' '}
                      <span className="font-semibold">{institution.owner_email}</span>
                      {' '}with a Razorpay link for ₹
                      {parseInt(institution.plan_price || '0').toLocaleString()}/month.
                    </p>
                  </div>
                )}

                {institution.payment_link_url ? (
                  <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                      Payment link
                    </p>
                    <a
                      href={institution.payment_link_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline break-all"
                    >
                      {institution.payment_link_url}
                    </a>
                  </div>
                ) : (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                    <p className="font-semibold">No payment link on file</p>
                    <p className="mt-1">
                      The approval probably ran without Razorpay configured. Click
                      "Resend Payment Link" once env vars are set.
                    </p>
                  </div>
                )}

                <button
                  onClick={() => {
                    const link = institution.payment_link_url;
                    if (!link) {
                      alert('No payment link yet. Click "Resend Payment Link" first.');
                      return;
                    }
                    const message =
                      `Hi ${institution.owner_name},\n\n` +
                      `${institution.name} has been approved on Veerify! ` +
                      `Please complete your ${institution.plan_name} subscription payment ` +
                      `(₹${parseInt(institution.plan_price || '0').toLocaleString()}/month) ` +
                      `at: ${link}\n\n` +
                      `Once payment is done, your academy goes live immediately and you can ` +
                      `sign in to the Veerify mobile app.`;
                    navigator.clipboard.writeText(message);
                    alert('Payment message copied to clipboard.');
                  }}
                  disabled={!institution.payment_link_url}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  📋 Copy Payment Message
                </button>

                <button
                  onClick={handleResend}
                  disabled={actionLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border-2 border-gray-200 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 transition-colors disabled:opacity-60"
                >
                  ↻ {actionLoading ? 'Sending...' : 'Resend Payment Link'}
                </button>

                <button
                  onClick={handleActivate}
                  disabled={actionLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition-colors disabled:opacity-60"
                  title="Use this if you received payment outside Razorpay (UPI / bank transfer) or the webhook didn't fire."
                >
                  <Zap size={18} />
                  {actionLoading ? 'Activating...' : 'Manually Activate'}
                </button>
              </>
            )}

            {/* ACTIVE */}
            {institution.onboarding_status === 'active' && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                <CheckCircle size={32} className="mx-auto text-green-500 mb-2" />
                <p className="font-semibold text-green-800">Academy is LIVE! 🎉</p>
                <p className="text-sm text-green-600 mt-1">
                  {institution.name} is active and can be accessed via the Veerify app.
                </p>
              </div>
            )}

            {/* REJECTED */}
            {institution.onboarding_status === 'rejected' && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
                <XCircle size={32} className="mx-auto text-gray-400 mb-2" />
                <p className="font-semibold text-gray-700">Application Rejected</p>
                <p className="text-sm text-gray-500 mt-1">
                  The academy can resubmit their application.
                </p>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Notify Modal - super admin -> institution owner */}
      {showNotifyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <Send size={18} className="text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Send Notification</h3>
                <p className="text-xs text-gray-500">
                  To {institution.owner_name || institution.name}
                </p>
              </div>
            </div>

            <p className="text-sm text-gray-500 mb-4">
              This appears in the institution owner's mobile inbox the next time
              they open the Veerify app.
            </p>

            <label className="block text-xs font-semibold text-gray-700 mb-1">Title</label>
            <input
              type="text"
              value={notifyTitle}
              onChange={(e) => setNotifyTitle(e.target.value)}
              placeholder="e.g. Renewal due in 7 days"
              maxLength={150}
              className="w-full border border-gray-200 rounded-xl p-3 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <label className="block text-xs font-semibold text-gray-700 mb-1">Message</label>
            <textarea
              value={notifyMessage}
              onChange={(e) => setNotifyMessage(e.target.value)}
              placeholder="Add the details here. Keep it short and clear."
              maxLength={800}
              className="w-full border border-gray-200 rounded-xl p-3 text-sm h-28 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1 text-right">
              {notifyMessage.length}/800
            </p>

            <div className="flex gap-3 mt-4">
              <button
                onClick={() => {
                  setShowNotifyModal(false);
                  setNotifyTitle('');
                  setNotifyMessage('');
                  setError('');
                }}
                className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSendNotification}
                disabled={actionLoading || !notifyTitle.trim()}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-60"
              >
                <Send size={16} />
                {actionLoading ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Reject Application</h3>
            <p className="text-sm text-gray-500 mb-4">
              The academy owner will see this reason and can resubmit after fixing the issues.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Registration number not valid. Please provide a valid federation registration certificate."
              className="w-full border border-gray-200 rounded-xl p-3 text-sm h-28 resize-none focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => {
                  setShowRejectModal(false);
                  setRejectReason('');
                }}
                className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={actionLoading || !rejectReason.trim()}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 disabled:opacity-60"
              >
                {actionLoading ? 'Rejecting...' : 'Reject Application'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Card wrapper — coloured header icon + title ──────────────────────────
const ACCENTS: Record<string, { icon: string; bg: string }> = {
  blue:    { icon: 'text-blue-600',    bg: 'bg-blue-50' },
  emerald: { icon: 'text-emerald-600', bg: 'bg-emerald-50' },
  violet:  { icon: 'text-violet-600',  bg: 'bg-violet-50' },
  orange:  { icon: 'text-orange-600',  bg: 'bg-orange-50' },
  rose:    { icon: 'text-rose-600',    bg: 'bg-rose-50' },
  indigo:  { icon: 'text-indigo-600',  bg: 'bg-indigo-50' },
  slate:   { icon: 'text-slate-600',   bg: 'bg-slate-100' },
};

function Card({
  icon: Icon,
  accent,
  title,
  count,
  children,
}: {
  icon: any;
  accent: keyof typeof ACCENTS;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  const a = ACCENTS[accent] || ACCENTS.blue;
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <span className={`w-8 h-8 rounded-lg ${a.bg} flex items-center justify-center`}>
          <Icon size={16} className={a.icon} />
        </span>
        {title}
        {count != null ? (
          <span className={`ml-1 text-xs font-bold px-2 py-0.5 rounded-full ${a.bg} ${a.icon}`}>
            {count}
          </span>
        ) : null}
      </h2>
      {children}
    </div>
  );
}

// ── Single label + value row ─────────────────────────────────────────────
// ── Course row inside the Courses Offered card ────────────────────────
function CourseRowItem({ course }: { course: CourseRow }) {
  const img = resolveAssetUrl(course.image_url);
  const status = course.status || 'active';
  const statusStyle: Record<string, string> = {
    active:   'bg-green-100 text-green-700',
    draft:    'bg-yellow-100 text-yellow-700',
    inactive: 'bg-gray-100 text-gray-600',
  };
  const modeLabel = course.mode
    ? course.mode.charAt(0).toUpperCase() + course.mode.slice(1)
    : null;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-100">
      <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-violet-50 flex items-center justify-center">
        {img ? (
          <img src={img} alt={course.name} className="w-full h-full object-cover" />
        ) : (
          <BookOpen size={18} className="text-violet-600" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-gray-900 truncate">{course.name}</p>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${statusStyle[status] || statusStyle.active}`}>
            {status}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[11px] text-gray-500">
          {course.category ? <span>{course.category}</span> : null}
          {modeLabel ? <span>· {modeLabel}</span> : null}
          {course.level ? <span>· {course.level}</span> : null}
        </div>
        <div className="flex items-center gap-3 mt-1 text-[11px]">
          {course.price != null ? (
            <span className="inline-flex items-center gap-1 text-violet-700 font-semibold">
              <Wallet size={10} />
              ₹{Number(course.price).toLocaleString('en-IN')}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1 text-gray-500">
            <Layers size={10} />
            {course.batch_count} batch{course.batch_count === 1 ? '' : 'es'}
          </span>
          <span className="inline-flex items-center gap-1 text-gray-500">
            <Users size={10} />
            {course.enrollment_count} enrolled
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Staff (trainer) row inside the Staff card ─────────────────────────
function StaffRowItem({ staff }: { staff: StaffRow }) {
  const photo = resolveAssetUrl(staff.photo_url);
  const initials =
    (staff.name || '?')
      .split(' ')
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-100">
      <div className="w-12 h-12 rounded-full overflow-hidden flex-shrink-0 border-2 border-emerald-100 bg-emerald-50 flex items-center justify-center">
        {photo ? (
          <img src={photo} alt={staff.name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-sm font-bold text-emerald-700">{initials}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-gray-900 truncate">{staff.name}</p>
          {staff.specialization ? (
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
              {staff.specialization}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[11px] text-gray-500">
          {staff.belt_level ? (
            <span className="inline-flex items-center gap-1">
              <Award size={10} />
              {staff.belt_level}
            </span>
          ) : null}
          {staff.experience_years != null ? (
            <span>· {staff.experience_years} yr{staff.experience_years === 1 ? '' : 's'} exp</span>
          ) : null}
          {staff.gender ? <span>· {staff.gender}</span> : null}
        </div>
        <div className="flex items-center gap-3 mt-1 text-[11px]">
          {staff.phone ? (
            <a
              href={`tel:${staff.phone}`}
              className="inline-flex items-center gap-1 text-gray-700 hover:text-green-600"
            >
              <Phone size={10} className="text-green-500" />
              {staff.phone}
            </a>
          ) : null}
          {staff.email ? (
            <a
              href={`mailto:${staff.email}`}
              className="inline-flex items-center gap-1 text-gray-700 hover:text-blue-600 truncate"
              title={staff.email}
            >
              <Mail size={10} className="text-blue-500" />
              {staff.email}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  isLink = false,
}: {
  icon: any;
  label: string;
  value: string;
  isLink?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon size={14} className="text-gray-500" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        {isLink && value && value !== '—' ? (
          <a
            href={value.startsWith('http') ? value : `https://${value}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-blue-600 hover:underline break-all"
          >
            {value}
          </a>
        ) : (
          <p className="text-sm font-medium text-gray-900 break-all">{value || '—'}</p>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Building2, User, Phone, Mail, MapPin,
  Globe, Award, Hash, CreditCard, CheckCircle,
  XCircle, Clock, Zap
} from 'lucide-react';
import apiClient from '../../api/client';

interface Institution {
  id: number;
  name: string;
  institution_type: string;
  website_url: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  pincode: string;
  registration_number: string;
  master_name: string;
  logo_url: string;
  onboarding_status: string;
  rejection_reason: string;
  created_at: string;
  approved_at: string;
  subscription_start: string;
  subscription_end: string;
  owner_name: string;
  owner_email: string;
  owner_phone: string;
  plan_name: string;
  plan_price: string;
  plan_features: Record<string, boolean>;
  max_students: number;
  max_trainers: number;
  max_branches: number;
  // Payment fields (populated after approval).
  payment_link_id?: string | null;
  payment_link_url?: string | null;
  payment_link_status?: 'pending' | 'paid' | 'expired' | 'cancelled' | null;
  payment_amount?: number | null;        // paise
  payment_reference?: string | null;
  paid_at?: string | null;
}

export function InstitutionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [institution, setInstitution] = useState<Institution | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    loadInstitution();
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

  if (!institution) return null;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Back button + header */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-3 transition-colors"
          >
            <ArrowLeft size={16} />
            <span className="text-sm">Back to Pending</span>
          </button>
          <h1 className="text-2xl font-bold text-gray-900">{institution.name}</h1>
          <p className="text-gray-500 mt-1">{institution.institution_type} • {institution.city}</p>
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

      <div className="grid grid-cols-3 gap-6">

        {/* LEFT COLUMN — Academy Details */}
        <div className="col-span-2 space-y-6">

          {/* Academy Information */}
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Building2 size={20} className="text-blue-600" />
              Academy Information
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <InfoRow icon={Building2} label="Institution Name" value={institution.name} />
              <InfoRow icon={Award} label="Type" value={institution.institution_type} />
              <InfoRow icon={User} label="Master Name" value={institution.master_name} />
              <InfoRow icon={Hash} label="Registration No." value={institution.registration_number} />
              <InfoRow icon={Phone} label="Phone" value={institution.phone} />
              <InfoRow icon={Mail} label="Email" value={institution.email} />
              {institution.website_url && (
                <InfoRow icon={Globe} label="Website" value={institution.website_url} isLink />
              )}
              <InfoRow icon={MapPin} label="City" value={`${institution.city}${institution.pincode ? ` - ${institution.pincode}` : ''}`} />
            </div>

            {institution.address && (
              <div className="mt-4 pt-4 border-t border-gray-50">
                <p className="text-xs text-gray-500 mb-1">Physical Address</p>
                <p className="text-sm text-gray-900">{institution.address}</p>
              </div>
            )}
          </div>

          {/* Owner Information */}
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <User size={20} className="text-green-600" />
              Owner / Contact Person
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <InfoRow icon={User} label="Name" value={institution.owner_name} />
              <InfoRow icon={Mail} label="Email" value={institution.owner_email} />
              <InfoRow icon={Phone} label="Phone" value={institution.owner_phone || '—'} />
            </div>
          </div>

          {/* Logo */}
          {institution.logo_url && (
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Academy Logo</h2>
              <img
                src={institution.logo_url}
                alt="Academy Logo"
                className="w-32 h-32 object-cover rounded-xl border border-gray-100"
              />
            </div>
          )}

        </div>

        {/* RIGHT COLUMN — Plan + Actions */}
        <div className="space-y-6">

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
                {institution.plan_name}
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
                <span className="font-medium">
                  {new Date(institution.created_at).toLocaleDateString('en-IN')}
                </span>
              </div>
              {institution.approved_at && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Approved</span>
                  <span className="font-medium text-green-600">
                    {new Date(institution.approved_at).toLocaleDateString('en-IN')}
                  </span>
                </div>
              )}
              {institution.subscription_start && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Active Since</span>
                  <span className="font-medium">
                    {new Date(institution.subscription_start).toLocaleDateString('en-IN')}
                  </span>
                </div>
              )}
              {institution.subscription_end && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Expires</span>
                  <span className="font-medium text-orange-600">
                    {new Date(institution.subscription_end).toLocaleDateString('en-IN')}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Actions</h2>

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
                {/* Status pill */}
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

                {/* The real Razorpay payment link, if we have one */}
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

                {/* Copy payment link button */}
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

                {/* Resend email + regenerate link */}
                <button
                  onClick={handleResend}
                  disabled={actionLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border-2 border-gray-200 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 transition-colors disabled:opacity-60"
                >
                  ↻ {actionLoading ? 'Sending...' : 'Resend Payment Link'}
                </button>

                {/* Manual override */}
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

// Helper component for info rows
function InfoRow({
  icon: Icon,
  label,
  value,
  isLink = false
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
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        {isLink ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            {value}
          </a>
        ) : (
          <p className="text-sm font-medium text-gray-900">{value || '—'}</p>
        )}
      </div>
    </div>
  );
}
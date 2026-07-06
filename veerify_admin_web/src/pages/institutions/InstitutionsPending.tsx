import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Clock, Eye, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import apiClient from '../../api/client';

interface Institution {
  id: number;
  name: string;
  institution_type: string;
  city: string;
  phone: string;
  email: string;
  owner_name: string;
  owner_email: string;
  plan_name: string;
  plan_price: string;
  plan_trial_days?: number | null;
  plan_grace_days?: number | null;
  master_name: string;
  registration_number: string;
  onboarding_status: string;
  created_at: string;
}

export function InstitutionsPending() {
  const navigate = useNavigate();
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/onboarding/pending');
      setInstitutions(res.data.institutions);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load pending institutions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, string> = {
      pending_approval: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-blue-100 text-blue-800',
      active: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
    };
    return badges[status] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pending Approvals</h1>
          <p className="text-gray-500 mt-1">
            Review and approve academy registration requests
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <Clock className="text-yellow-600" size={24} />
            <div>
              <p className="text-2xl font-bold text-yellow-700">{institutions.length}</p>
              <p className="text-sm text-yellow-600">Pending Review</p>
            </div>
          </div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <Building2 className="text-blue-600" size={24} />
            <div>
              <p className="text-2xl font-bold text-blue-700">
                {institutions.filter(i => i.plan_name === 'Basic').length}
              </p>
              <p className="text-sm text-blue-600">Basic Plan</p>
            </div>
          </div>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <Building2 className="text-purple-600" size={24} />
            <div>
              <p className="text-2xl font-bold text-purple-700">
                {institutions.filter(i => i.plan_name === 'Pro').length}
              </p>
              <p className="text-sm text-purple-600">Pro Plan</p>
            </div>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
        </div>
      ) : institutions.length === 0 ? (
        /* Empty state */
        <div className="text-center py-20 bg-white rounded-xl border border-gray-100">
          <CheckCircle size={48} className="mx-auto text-green-400 mb-4" />
          <h3 className="text-lg font-semibold text-gray-700">All caught up!</h3>
          <p className="text-gray-500 mt-1">No pending approval requests right now.</p>
        </div>
      ) : (
        /* Institutions table */
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Academy
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Owner
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Plan
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Submitted
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {institutions.map((inst) => (
                <tr
                  key={inst.id}
                  className="hover:bg-gray-50 transition-colors"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm">
                        {inst.name?.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">{inst.name}</p>
                        <p className="text-sm text-gray-500">
                          {inst.institution_type} • {inst.city}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-gray-900">{inst.owner_name}</p>
                    <p className="text-sm text-gray-500">{inst.owner_email}</p>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1 items-start">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        inst.plan_name === 'Pro'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {inst.plan_name} — ₹{parseInt(inst.plan_price).toLocaleString()}
                      </span>
                      {/* Trial countdown — surfaces "approving will start an
                          N-day trial window" so the super admin understands
                          exactly what they're granting. Trial plan academies
                          still must be approved here before getting access. */}
                      {Number(inst.plan_trial_days) > 0 && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-amber-50 text-amber-700 border border-amber-200">
                          Trial · {inst.plan_trial_days}d free on approval
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-gray-600">{formatDate(inst.created_at)}</p>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${getStatusBadge(inst.onboarding_status)}`}>
                      {inst.onboarding_status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => navigate(`/institutions/${inst.id}`)}
                      className="flex items-center gap-1.5 ml-auto px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      <Eye size={14} />
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
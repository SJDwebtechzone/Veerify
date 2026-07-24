// veerify_admin_web/src/pages/AccountSettings.tsx
//
// Web Admin → Account Settings
//   1. Change Email    — three-step OTP flow (request → verify).
//   2. Change Password — current + new + confirm, with policy hints.
//   3. Account Activity — audit log of recent email / password changes.
//
// Backend contract (see auth.routes.js):
//   POST /auth/change-email/request  { new_email }
//   POST /auth/change-email/resend
//   POST /auth/change-email/verify   { otp }
//   POST /auth/change-password       { current_password, new_password, confirm_password }
//   GET  /auth/account-activity

import { useEffect, useMemo, useState } from 'react';
import {
  Mail, Lock, ShieldCheck, KeyRound, Send, CheckCircle2, XCircle,
  RefreshCw, AlertCircle, Activity, Clock, Eye, EyeOff, ArrowRight,
} from 'lucide-react';

import apiClient from '../api/client';
import { useAuth } from '../lib/auth';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

interface ActivityRow {
  id:          number;
  action:      string;
  ip:          string | null;
  user_agent:  string | null;
  metadata:    Record<string, unknown>;
  created_at:  string;
}

const ACTION_LABEL: Record<string, string> = {
  email_changed:            'Email address changed',
  email_change_requested:   'Email change requested',
  password_changed:         'Password changed',
};

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Password policy — mirrors backend validatePasswordPolicy.
function checkPolicy(pw: string) {
  return {
    length:    pw.length >= 8,
    upper:     /[A-Z]/.test(pw),
    lower:     /[a-z]/.test(pw),
    number:    /[0-9]/.test(pw),
    special:   /[^A-Za-z0-9]/.test(pw),
  };
}

export function AccountSettings() {
  const { user, setUser } = useAuth() as any;
  const currentEmail = user?.email || '';

  // ── Change Email ────────────────────────────────────────────────
  const [newEmail,       setNewEmail]       = useState('');
  const [emailStage,     setEmailStage]     = useState<'idle' | 'otp' | 'done'>('idle');
  const [otp,            setOtp]            = useState('');
  const [emailBusy,      setEmailBusy]      = useState(false);
  const [emailErr,       setEmailErr]       = useState('');
  const [emailNote,      setEmailNote]      = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  // Countdown timer for the resend cooldown chip.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const requestOtp = async () => {
    setEmailErr('');
    setEmailNote('');
    setEmailBusy(true);
    try {
      const r = await apiClient.post('/auth/change-email/request', { new_email: newEmail });
      setEmailStage('otp');
      setEmailNote(r.data?.message || 'Verification code sent.');
      setOtp('');
      setResendCooldown(60);
    } catch (err: any) {
      setEmailErr(err?.response?.data?.message || 'Could not send the code.');
    } finally {
      setEmailBusy(false);
    }
  };

  const resendOtp = async () => {
    if (resendCooldown > 0) return;
    setEmailErr('');
    setEmailBusy(true);
    try {
      const r = await apiClient.post('/auth/change-email/resend');
      setEmailNote(r.data?.message || 'A fresh code was sent.');
      setResendCooldown(60);
    } catch (err: any) {
      setEmailErr(err?.response?.data?.message || 'Could not resend the code.');
    } finally {
      setEmailBusy(false);
    }
  };

  const verifyOtp = async () => {
    setEmailErr('');
    setEmailBusy(true);
    try {
      const r = await apiClient.post('/auth/change-email/verify', { otp });
      setEmailStage('done');
      setEmailNote(r.data?.message || 'Email updated.');
      // Reflect the new email in the auth context so the header shows it.
      if (setUser && user) {
        setUser({ ...user, email: r.data?.new_email || newEmail });
      }
      // After a beat, reset so the user can change it again if they want.
      setTimeout(() => { setEmailStage('idle'); setNewEmail(''); setOtp(''); loadActivity(); }, 4000);
    } catch (err: any) {
      setEmailErr(err?.response?.data?.message || 'Verification failed.');
    } finally {
      setEmailBusy(false);
    }
  };

  const cancelEmailChange = () => {
    setEmailStage('idle');
    setNewEmail('');
    setOtp('');
    setEmailErr('');
    setEmailNote('');
  };

  // ── Change Password ─────────────────────────────────────────────
  const [pwCur,     setPwCur]     = useState('');
  const [pwNew,     setPwNew]     = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [showPw,    setShowPw]    = useState(false);
  const [pwBusy,    setPwBusy]    = useState(false);
  const [pwErr,     setPwErr]     = useState('');
  const [pwNote,    setPwNote]    = useState('');
  const policy = useMemo(() => checkPolicy(pwNew), [pwNew]);
  const policyPasses = Object.values(policy).every(Boolean);
  const matches = pwNew.length > 0 && pwNew === pwConfirm;

  const submitPassword = async () => {
    setPwErr('');
    setPwNote('');
    if (!policyPasses) {
      setPwErr('New password does not meet the requirements below.');
      return;
    }
    if (!matches) {
      setPwErr('New password and confirmation do not match.');
      return;
    }
    setPwBusy(true);
    try {
      const r = await apiClient.post('/auth/change-password', {
        current_password: pwCur,
        new_password:     pwNew,
        confirm_password: pwConfirm,
      });
      setPwNote(r.data?.message || 'Password updated. Use it on your next sign-in.');
      setPwCur(''); setPwNew(''); setPwConfirm('');
      loadActivity();
    } catch (err: any) {
      setPwErr(err?.response?.data?.message || 'Could not change password.');
    } finally {
      setPwBusy(false);
    }
  };

  // ── Activity log ────────────────────────────────────────────────
  const [activity,        setActivity]        = useState<ActivityRow[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);

  const loadActivity = async () => {
    try {
      setActivityLoading(true);
      const r = await apiClient.get('/auth/account-activity');
      setActivity(r.data?.activity || []);
    } catch { /* silent */ }
    finally { setActivityLoading(false); }
  };
  useEffect(() => { loadActivity(); }, []);

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Account Settings</h1>
          <p className="text-sm text-slate-500">Manage your login email, password, and security activity.</p>
        </div>
      </div>

      {/* ── Change Email ───────────────────────────────────────────── */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
        <header className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
            <Mail className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Change email address</h2>
            <p className="text-xs text-slate-500">
              We'll send a 6-digit verification code to your new address.
            </p>
          </div>
        </header>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Current email</label>
            <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-700">
              {currentEmail || '—'}
            </div>
          </div>

          {emailStage === 'idle' ? (
            <>
              <Input
                label="New email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value.trim())}
                placeholder="you@example.com"
              />
              <div className="flex justify-end">
                <Button variant="primary" onClick={requestOtp} disabled={emailBusy || !newEmail}>
                  <Send className="w-4 h-4 mr-1" />
                  {emailBusy ? 'Sending…' : 'Send verification code'}
                </Button>
              </div>
            </>
          ) : emailStage === 'otp' ? (
            <>
              <div className="p-3 rounded-lg bg-blue-50 border border-blue-100 text-xs text-blue-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5" />
                <div>
                  We sent a 6-digit code to <b>{newEmail}</b>. Enter it below to confirm the change.
                  The code expires in <b>10 minutes</b>.
                </div>
              </div>
              <Input
                label="Verification code"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
              />
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={resendOtp}
                  disabled={emailBusy || resendCooldown > 0}
                  className="text-xs text-blue-700 font-semibold hover:underline disabled:text-slate-400 inline-flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                </button>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" onClick={cancelEmailChange} disabled={emailBusy}>Cancel</Button>
                  <Button variant="primary" onClick={verifyOtp} disabled={emailBusy || otp.length !== 6}>
                    <CheckCircle2 className="w-4 h-4 mr-1" />
                    {emailBusy ? 'Verifying…' : 'Verify & update'}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-100 text-sm text-emerald-800 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5" />
              <div>
                <div className="font-semibold">Email updated.</div>
                <div className="text-xs mt-1">
                  Use your new email the next time you sign in. Confirmation
                  emails were sent to both addresses.
                </div>
              </div>
            </div>
          )}

          {emailErr ? (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700 flex items-start gap-2">
              <XCircle className="w-4 h-4 mt-0.5" />
              <span>{emailErr}</span>
            </div>
          ) : emailNote && emailStage !== 'done' ? (
            <div className="text-xs text-slate-500">{emailNote}</div>
          ) : null}
        </div>
      </section>

      {/* ── Change Password ────────────────────────────────────────── */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
        <header className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Change password</h2>
            <p className="text-xs text-slate-500">
              Use a unique password you haven't used elsewhere.
            </p>
          </div>
          <button
            onClick={() => setShowPw((s) => !s)}
            className="ml-auto p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
            title={showPw ? 'Hide passwords' : 'Show passwords'}
          >
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </header>

        <div className="space-y-4">
          <Input
            label="Current password"
            type={showPw ? 'text' : 'password'}
            value={pwCur}
            onChange={(e) => setPwCur(e.target.value)}
          />
          <Input
            label="New password"
            type={showPw ? 'text' : 'password'}
            value={pwNew}
            onChange={(e) => setPwNew(e.target.value)}
          />
          <Input
            label="Confirm new password"
            type={showPw ? 'text' : 'password'}
            value={pwConfirm}
            onChange={(e) => setPwConfirm(e.target.value)}
          />

          {/* Policy checklist */}
          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
            <PolicyItem ok={policy.length}  text="At least 8 characters" />
            <PolicyItem ok={policy.upper}   text="Uppercase letter" />
            <PolicyItem ok={policy.lower}   text="Lowercase letter" />
            <PolicyItem ok={policy.number}  text="Number" />
            <PolicyItem ok={policy.special} text="Special character" />
            <PolicyItem ok={matches}        text="Confirm matches" />
          </div>

          <div className="flex justify-end">
            <Button
              variant="primary"
              onClick={submitPassword}
              disabled={pwBusy || !pwCur || !policyPasses || !matches}
            >
              <KeyRound className="w-4 h-4 mr-1" />
              {pwBusy ? 'Updating…' : 'Update password'}
            </Button>
          </div>

          {pwErr ? (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700 flex items-start gap-2">
              <XCircle className="w-4 h-4 mt-0.5" />
              <span>{pwErr}</span>
            </div>
          ) : pwNote ? (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100 text-xs text-emerald-700 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5" />
              <span>{pwNote}</span>
            </div>
          ) : null}
        </div>
      </section>

      {/* ── Account Activity ────────────────────────────────────────── */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
        <header className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Account activity</h2>
            <p className="text-xs text-slate-500">Recent security-related changes on your account.</p>
          </div>
          <button
            onClick={loadActivity}
            className="ml-auto p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </header>

        {activityLoading ? (
          <div className="text-sm text-slate-500 py-6 text-center">Loading…</div>
        ) : activity.length === 0 ? (
          <div className="text-sm text-slate-500 py-6 text-center">No activity yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {activity.map((row) => {
              const meta = row.metadata as any;
              const label = ACTION_LABEL[row.action] || row.action;
              return (
                <li key={row.id} className="py-3 flex items-start gap-3">
                  <div className="mt-0.5 w-7 h-7 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center">
                    <Clock className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-white">{label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {fmtWhen(row.created_at)}
                      {row.ip ? ` · ${row.ip}` : ''}
                    </div>
                    {row.action === 'email_changed' && meta?.old_email && meta?.new_email ? (
                      <div className="text-xs text-slate-600 mt-1 inline-flex items-center gap-1">
                        <span className="font-mono">{meta.old_email}</span>
                        <ArrowRight className="w-3 h-3" />
                        <span className="font-mono">{meta.new_email}</span>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function PolicyItem({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div className={`inline-flex items-center gap-1.5 ${ok ? 'text-emerald-700' : 'text-slate-500'}`}>
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3 text-slate-300" />}
      <span>{text}</span>
    </div>
  );
}

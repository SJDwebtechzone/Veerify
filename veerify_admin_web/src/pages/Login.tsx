import { useState, FormEvent } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  CheckCircle2,
  Building2,
  GraduationCap,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/utils';
import veerifyLogo from '../assets/veerify-logo.png';

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }

    setLoading(true);
    const result = await login(email, password);
    setLoading(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    const from = (location.state as { from?: string } | null)?.from || '/';
    navigate(from, { replace: true });
  };

  const fillDemo = () => {
    setEmail('admin@veerify.com');
    setPassword('admin123');
    setError(null);
  };

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950">
      {/* Left: Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center px-6 py-12 relative overflow-hidden">
        {/* Background gradient blob */}
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-brand-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -right-16 w-96 h-96 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

        <div className="w-full max-w-md relative animate-fade-in">
          {/* Brand */}
          <div className="flex items-center gap-2.5 mb-10">
            <img
              src={veerifyLogo}
              alt="Veerify"
              className="w-10 h-10 rounded-full object-cover shadow-glow"
            />
            <div>
              <div className="font-bold text-slate-900 dark:text-white text-lg tracking-tight">Veerify</div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-widest">Super Admin</div>
            </div>
          </div>

          {/* Heading */}
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Welcome back</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">
            Sign in to manage every academy on the Veerify platform.
          </p>

          {/* Demo credentials hint */}
          <div className="mt-6 p-3.5 rounded-xl bg-brand-50/60 dark:bg-brand-500/10 border border-brand-200/60 dark:border-brand-500/20 flex items-start gap-3">
            <Sparkles className="w-4 h-4 text-brand-600 dark:text-brand-400 mt-0.5 shrink-0" />
            <div className="flex-1 text-xs">
              <div className="font-semibold text-brand-900 dark:text-brand-200">Demo credentials</div>
              <div className="mt-1 text-brand-700 dark:text-brand-300 font-mono space-y-0.5">
                <div>admin@veerify.com</div>
                <div>admin123</div>
              </div>
            </div>
            <button
              type="button"
              onClick={fillDemo}
              className="text-xs font-semibold text-brand-700 dark:text-brand-300 hover:text-brand-900 dark:hover:text-brand-100 shrink-0"
            >
              Auto-fill →
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {/* Email */}
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Email address
              </label>
              <div className="relative mt-1.5">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@veerify.in"
                  className="w-full h-11 pl-10 pr-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none text-sm transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Password
                </label>
                <button
                  type="button"
                  className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative mt-1.5">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  className="w-full h-11 pl-10 pr-11 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none text-sm transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Remember me */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="text-sm text-slate-600 dark:text-slate-300">Keep me signed in for 30 days</span>
            </label>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200/60 dark:border-rose-500/20 animate-fade-in">
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
                <div className="text-xs font-medium text-rose-800 dark:text-rose-300">{error}</div>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className={cn(
                'w-full h-11 flex items-center justify-center gap-2 rounded-xl font-semibold text-sm transition-all',
                'bg-brand-600 hover:bg-brand-700 text-white shadow-glow',
                'disabled:opacity-60 disabled:pointer-events-none',
              )}
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-8 text-center text-xs text-slate-500 dark:text-slate-400">
            Don't have an account?{' '}
            <button className="font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400">
              Contact sales
            </button>
          </div>
        </div>
      </div>

      {/* Right: Hero panel */}
      <div className="hidden lg:flex w-1/2 relative overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900">
        {/* Decorative blobs */}
        <div className="absolute -top-20 -right-20 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-0 -left-32 w-[500px] h-[500px] rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="absolute top-1/2 right-1/3 w-72 h-72 rounded-full bg-pink-500/15 blur-3xl" />

        {/* Pattern grid */}
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />

        <div className="relative flex flex-col justify-between p-12 xl:p-16 w-full text-white">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur border border-white/20 text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              Trusted by 97+ academies across India
            </div>
            <h2 className="mt-8 text-4xl xl:text-5xl font-bold tracking-tight leading-tight">
              Manage every academy from one
              <br />
              <span className="bg-gradient-to-r from-amber-300 to-pink-300 bg-clip-text text-transparent">
                command center.
              </span>
            </h2>
            <p className="mt-5 text-base text-white/70 max-w-lg leading-relaxed">
              Real-time analytics, subscription tracking, trainer assignments, and student insights — all in one
              place, built for martial arts academies.
            </p>
          </div>

          {/* Stats glass card */}
          <div className="grid grid-cols-3 gap-3">
            <StatPill icon={Building2} label="Academies" value="97" />
            <StatPill icon={GraduationCap} label="Students" value="2,780" />
            <StatPill icon={CheckCircle2} label="Active plans" value="81" />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatPill({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/10 backdrop-blur-xl border border-white/20 p-4">
      <Icon className="w-4 h-4 text-white/80" />
      <div className="mt-3 text-xs text-white/70 uppercase tracking-wider font-medium">{label}</div>
      <div className="mt-0.5 text-2xl font-bold tracking-tight">{value}</div>
    </div>
  );
}

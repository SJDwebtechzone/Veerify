// src/pages/settings/Plans.tsx
//
// Subscription plans CRUD for the platform admin.
//
// Talks to /api/plans. Lists every plan (active + archived), highlights the
// "Most Popular" tier with a brand-tinted card, lets the admin create / edit
// any field, and archives (soft-deletes) tiers we don't want to offer
// anymore — existing institutions on archived plans keep working.
//
// Features are entered as a textarea, one per line. The backend normalises
// to JSON array before storing.

import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Pencil, Star, Archive, ArchiveRestore, Sparkles, CheckCircle2,
  Building2, GraduationCap, UserCog, Layers, Crown, Tag, X,
} from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Textarea, Toggle } from '../../components/ui/Input';
import { formatCurrency, cn } from '../../lib/utils';

interface Plan {
  id: number;
  name: string;
  price: number | string;
  billing_cycle: string;
  max_branches: number;
  max_students: number;
  max_trainers: number;
  features: string[];
  is_popular: boolean;
  is_active: boolean;
  created_at?: string;
}

type Draft = {
  name: string;
  price: string;
  billing_cycle: string;
  max_branches: string;
  max_students: string;
  max_trainers: string;
  features: string;
  is_popular: boolean;
  is_active: boolean;
};

const BLANK: Draft = {
  name: '',
  price: '',
  billing_cycle: 'monthly',
  max_branches: '1',
  max_students: '25',
  max_trainers: '2',
  features: '',
  is_popular: false,
  is_active: true,
};

const BILLING_CYCLES = [
  { key: 'monthly',     label: 'Monthly',      short: 'mo' },
  { key: 'quarterly',   label: 'Quarterly',    short: 'qtr' },
  { key: 'half_yearly', label: 'Half-Yearly',  short: '6mo' },
  { key: 'yearly',      label: 'Yearly',       short: 'yr' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────
function normaliseFeatures(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter(Boolean);
    } catch {
      return value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

// Pick a tier "vibe" for visual variety. We rotate through three accents based
// on price so cheaper plans get a cooler tone and pricier ones look premium.
type Tier = 'basic' | 'pro' | 'premium';
function tierFor(plan: Plan, sortedPrices: number[]): Tier {
  const price = Number(plan.price) || 0;
  const idx = sortedPrices.indexOf(price);
  if (sortedPrices.length === 1) return 'pro';
  if (idx === 0) return 'basic';
  if (idx === sortedPrices.length - 1) return 'premium';
  return 'pro';
}
const TIER_STYLES: Record<Tier, {
  gradient: string;
  accent: string;
  ring: string;
  iconBg: string;
  badge: string;
  icon: typeof Tag;
}> = {
  basic: {
    gradient: 'from-sky-500 to-cyan-500',
    accent: 'text-sky-600 dark:text-sky-400',
    ring: 'hover:ring-sky-300 dark:hover:ring-sky-700',
    iconBg: 'bg-sky-100 dark:bg-sky-500/15 text-sky-600 dark:text-sky-400',
    badge: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
    icon: Tag,
  },
  pro: {
    gradient: 'from-brand-500 to-purple-500',
    accent: 'text-brand-600 dark:text-brand-400',
    ring: 'hover:ring-brand-300 dark:hover:ring-brand-700',
    iconBg: 'bg-brand-100 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400',
    badge: 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-400',
    icon: Sparkles,
  },
  premium: {
    gradient: 'from-amber-500 to-orange-500',
    accent: 'text-amber-600 dark:text-amber-400',
    ring: 'hover:ring-amber-300 dark:hover:ring-amber-700',
    iconBg: 'bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
    icon: Crown,
  },
};

// ─── Component ──────────────────────────────────────────────────────────────
export function Plans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'archived'>('active');

  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const res = await api.get('/plans?include_inactive=true');
      const rows = (res.data?.plans || []) as any[];
      const normalised: Plan[] = rows.map((p) => ({
        ...p,
        features: normaliseFeatures(p.features),
      }));
      setPlans(normalised);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to load plans');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // Stats / filter chips
  const stats = useMemo(() => {
    const active = plans.filter((p) => p.is_active).length;
    const archived = plans.length - active;
    return { active, archived, total: plans.length };
  }, [plans]);

  const visible = useMemo(() => {
    if (filter === 'active') return plans.filter((p) => p.is_active);
    if (filter === 'archived') return plans.filter((p) => !p.is_active);
    return plans;
  }, [plans, filter]);

  // Sorted price list for tier classification.
  const sortedPrices = useMemo(
    () => [...plans].filter((p) => p.is_active).map((p) => Number(p.price) || 0).sort((a, b) => a - b),
    [plans],
  );

  const openNew = () => { setDraft(BLANK); setEditing('new'); };
  const openEdit = (plan: Plan) => {
    setDraft({
      name:          plan.name || '',
      price:         String(plan.price ?? ''),
      billing_cycle: plan.billing_cycle || 'monthly',
      max_branches:  String(plan.max_branches ?? 1),
      max_students:  String(plan.max_students ?? 25),
      max_trainers:  String(plan.max_trainers ?? 2),
      features:      normaliseFeatures(plan.features).join('\n'),
      is_popular:    !!plan.is_popular,
      is_active:     !!plan.is_active,
    });
    setEditing(plan);
  };
  const closeModal = () => { setEditing(null); setSaving(false); };

  const save = async () => {
    if (!draft.name.trim() || !draft.price.trim()) {
      alert('Name and price are required.');
      return;
    }
    setSaving(true);
    try {
      const body = {
        name:          draft.name.trim(),
        price:         parseFloat(draft.price),
        billing_cycle: draft.billing_cycle,
        max_branches:  parseInt(draft.max_branches, 10) || 1,
        max_students:  parseInt(draft.max_students, 10) || 25,
        max_trainers:  parseInt(draft.max_trainers, 10) || 2,
        features:      draft.features.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
        is_popular:    draft.is_popular,
        is_active:     draft.is_active,
      };
      if (editing === 'new') await api.post('/plans', body);
      else if (editing)      await api.put(`/plans/${editing.id}`, body);
      await load();
      closeModal();
    } catch (err: any) {
      alert(err.response?.data?.message || err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const archive = async (plan: Plan) => {
    if (!confirm(`Archive "${plan.name}"? Existing institutions on this plan are unaffected; new admins won't see it.`)) return;
    try { await api.delete(`/plans/${plan.id}`); await load(); }
    catch (err: any) { alert(err.response?.data?.message || err.message || 'Archive failed'); }
  };
  const restore = async (plan: Plan) => {
    try { await api.put(`/plans/${plan.id}`, { is_active: true }); await load(); }
    catch (err: any) { alert(err.response?.data?.message || err.message || 'Restore failed'); }
  };

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in space-y-6">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-500 to-purple-600 p-8 text-white shadow-glow">
        <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-8 -left-8 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur text-[10px] font-bold uppercase tracking-widest mb-3">
              <Crown className="w-3 h-3" /> Pricing & Plans
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Subscription Tiers</h1>
            <p className="mt-1 text-sm text-white/80 max-w-2xl">
              Manage every plan that institutions see on the Choose-a-Plan screen.
              Edit pricing, limits, and perks — changes go live instantly.
            </p>
          </div>
          <Button
            onClick={openNew}
            className="bg-white !text-brand-600 hover:!bg-white/95 hover:!text-brand-700 shadow-lg shrink-0"
            leftIcon={<Plus className="w-4 h-4" />}
          >
            Create plan
          </Button>
        </div>

        {/* Inline stat strip */}
        <div className="relative mt-6 grid grid-cols-3 gap-4 max-w-md">
          <HeroStat label="Total" value={stats.total} />
          <HeroStat label="Active" value={stats.active} />
          <HeroStat label="Archived" value={stats.archived} />
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <FilterChip active={filter === 'active'}   onClick={() => setFilter('active')}>
          Active <span className="ml-1 opacity-60">{stats.active}</span>
        </FilterChip>
        <FilterChip active={filter === 'archived'} onClick={() => setFilter('archived')}>
          Archived <span className="ml-1 opacity-60">{stats.archived}</span>
        </FilterChip>
        <FilterChip active={filter === 'all'}      onClick={() => setFilter('all')}>
          All <span className="ml-1 opacity-60">{stats.total}</span>
        </FilterChip>
      </div>

      {/* Body */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : error ? (
        <div className="card p-6 text-sm text-rose-600 bg-rose-50 dark:bg-rose-500/10 border-rose-200">{error}</div>
      ) : visible.length === 0 ? (
        <div className="card p-16 text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-brand-100 dark:bg-brand-500/15 grid place-items-center mb-4">
            <Sparkles className="w-7 h-7 text-brand-600 dark:text-brand-400" />
          </div>
          <div className="text-base font-semibold text-slate-900 dark:text-white">
            {filter === 'archived' ? 'No archived plans' : 'No plans yet'}
          </div>
          <div className="text-xs text-slate-500 mt-1 mb-5">
            {filter === 'archived'
              ? 'Plans you archive will appear here.'
              : 'Create your first plan to start onboarding institutions.'}
          </div>
          {filter !== 'archived' && (
            <Button onClick={openNew} leftIcon={<Plus className="w-4 h-4" />}>
              Create your first plan
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {visible.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              tier={tierFor(p, sortedPrices)}
              onEdit={() => openEdit(p)}
              onArchive={() => archive(p)}
              onRestore={() => restore(p)}
            />
          ))}
        </div>
      )}

      {/* Add / edit modal */}
      <Modal
        open={editing !== null}
        onClose={closeModal}
        size="lg"
        title={editing === 'new' ? 'Create new plan' : `Edit ${(editing as Plan)?.name || ''}`}
        description="What every institution sees during onboarding."
        footer={
          <>
            <Button variant="outline" onClick={closeModal} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving} leftIcon={saving ? undefined : <CheckCircle2 className="w-4 h-4" />}>
              {saving ? 'Saving...' : (editing === 'new' ? 'Create plan' : 'Save changes')}
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          {/* Section: Basics */}
          <FormSection title="Basics" icon={Tag}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Plan name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Basic / Pro / Enterprise" />
              <div>
                <label className="block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300">Price (₹)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={draft.price}
                    onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                    placeholder="2499"
                    className="w-full pl-7 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300">Billing cycle</label>
              <div className="grid grid-cols-4 gap-2">
                {BILLING_CYCLES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setDraft({ ...draft, billing_cycle: c.key })}
                    className={cn(
                      'px-3 py-2 rounded-lg border text-sm font-medium transition',
                      draft.billing_cycle === c.key
                        ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-400'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600',
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </FormSection>

          {/* Section: Limits */}
          <FormSection title="Limits" icon={Layers}>
            <div className="grid grid-cols-3 gap-3">
              <LimitInput icon={Building2}    label="Max branches" value={draft.max_branches} onChange={(v) => setDraft({ ...draft, max_branches: v })} />
              <LimitInput icon={GraduationCap} label="Max students" value={draft.max_students} onChange={(v) => setDraft({ ...draft, max_students: v })} />
              <LimitInput icon={UserCog}      label="Max trainers" value={draft.max_trainers} onChange={(v) => setDraft({ ...draft, max_trainers: v })} />
            </div>
          </FormSection>

          {/* Section: Features */}
          <FormSection title="What's included" icon={CheckCircle2}>
            <Textarea
              value={draft.features}
              onChange={(e) => setDraft({ ...draft, features: e.target.value })}
              placeholder={'Single branch\nUp to 25 students\nUp to 2 trainers\nFee tracking & receipts\nPush notifications\nBasic attendance\nEmail support'}
              rows={7}
              hint="One feature per line. They render as checkmarked bullets on the plan card."
            />
          </FormSection>

          {/* Section: Visibility */}
          <FormSection title="Visibility" icon={Sparkles}>
            <div className="flex flex-col gap-3">
              <Toggle
                checked={draft.is_popular}
                onChange={(v) => setDraft({ ...draft, is_popular: v })}
                label="Highlight as Most Popular"
              />
              <Toggle
                checked={draft.is_active}
                onChange={(v) => setDraft({ ...draft, is_active: v })}
                label="Visible to institutions"
              />
            </div>
          </FormSection>
        </div>
      </Modal>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function HeroStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white/10 backdrop-blur rounded-xl px-3 py-2.5 border border-white/15">
      <div className="text-[10px] uppercase tracking-wider text-white/70 font-semibold">{label}</div>
      <div className="text-xl font-bold mt-0.5">{value}</div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3.5 py-1.5 rounded-full text-xs font-semibold transition border',
        active
          ? 'bg-slate-900 border-slate-900 text-white dark:bg-white dark:border-white dark:text-slate-900'
          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800',
      )}
    >
      {children}
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className="card p-6 animate-pulse">
      <div className="h-2 w-12 bg-slate-200 dark:bg-slate-700 rounded-full mb-4" />
      <div className="h-5 w-24 bg-slate-200 dark:bg-slate-700 rounded mb-2" />
      <div className="h-8 w-32 bg-slate-200 dark:bg-slate-700 rounded mb-4" />
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-3 bg-slate-100 dark:bg-slate-800 rounded" />)}
      </div>
    </div>
  );
}

function FormSection({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-brand-100 dark:bg-brand-500/15 grid place-items-center text-brand-600 dark:text-brand-400">
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div className="text-sm font-semibold text-slate-900 dark:text-white">{title}</div>
      </div>
      {children}
    </div>
  );
}

function LimitInput({ icon: Icon, label, value, onChange }: { icon: any; label: string; value: string; onChange: (v: string) => void; }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5 text-slate-600 dark:text-slate-400">{label}</label>
      <div className="relative">
        <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
          <Icon className="w-3.5 h-3.5" />
        </div>
        <input
          type="number"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
        />
      </div>
    </div>
  );
}

// ─── Plan card ─────────────────────────────────────────────────────────────
function PlanCard({
  plan, tier, onEdit, onArchive, onRestore,
}: {
  plan: Plan;
  tier: Tier;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const price = Number(plan.price) || 0;
  const styles = TIER_STYLES[tier];
  const billing = BILLING_CYCLES.find((c) => c.key === plan.billing_cycle)?.short || 'mo';
  const TierIcon = styles.icon;

  const featureList = normaliseFeatures(plan.features);

  return (
    <div
      className={cn(
        'group relative card overflow-hidden transition-all duration-300',
        'hover:-translate-y-1 hover:shadow-xl ring-1 ring-transparent',
        styles.ring,
        plan.is_popular && 'ring-2 ring-brand-500/60',
        !plan.is_active && 'opacity-60 grayscale',
      )}
    >
      {/* Gradient accent bar */}
      <div className={cn('absolute inset-x-0 top-0 h-1 bg-gradient-to-r', styles.gradient)} />

      {/* Popular ribbon */}
      {plan.is_popular && (
        <div className="absolute top-3 right-3">
          <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gradient-to-r from-brand-500 to-purple-500 text-white text-[10px] font-bold uppercase tracking-wider shadow-md">
            <Star className="w-3 h-3 fill-current" /> Popular
          </div>
        </div>
      )}
      {!plan.is_active && (
        <div className="absolute top-3 right-3">
          <Badge variant="neutral">Archived</Badge>
        </div>
      )}

      <div className="p-6">
        {/* Tier icon + name */}
        <div className="flex items-center gap-2.5 mb-4">
          <div className={cn('w-10 h-10 rounded-xl grid place-items-center', styles.iconBg)}>
            <TierIcon className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
              {tier === 'basic' ? 'Starter' : tier === 'premium' ? 'Premium' : 'Pro tier'}
            </div>
            <div className="text-base font-bold text-slate-900 dark:text-white leading-tight">{plan.name}</div>
          </div>
        </div>

        {/* Price */}
        <div className="mb-5 flex items-baseline gap-1">
          <span className="text-4xl font-extrabold text-slate-900 dark:text-white tabular-nums">
            {formatCurrency(price)}
          </span>
          <span className="text-sm text-slate-500 dark:text-slate-400">/{billing}</span>
        </div>

        {/* Limits row */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          <LimitPill icon={Building2}     value={plan.max_branches} label="branch" />
          <LimitPill icon={GraduationCap} value={plan.max_students} label="student" />
          <LimitPill icon={UserCog}       value={plan.max_trainers} label="trainer" />
        </div>

        {/* Divider */}
        <div className="h-px bg-slate-100 dark:bg-slate-800 mb-4" />

        {/* Features */}
        <div className="space-y-2 min-h-[120px]">
          {featureList.length === 0 ? (
            <div className="text-xs italic text-slate-400">No features listed yet.</div>
          ) : (
            featureList.map((f, i) => (
              <div key={i} className="flex items-start gap-2">
                <CheckCircle2 className={cn('w-4 h-4 shrink-0 mt-0.5', styles.accent)} />
                <span className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{f}</span>
              </div>
            ))
          )}
        </div>

        {/* Actions */}
        <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex gap-2">
          <Button size="sm" variant="outline" leftIcon={<Pencil className="w-3.5 h-3.5" />} onClick={onEdit} className="flex-1">
            Edit
          </Button>
          {plan.is_active ? (
            <Button size="sm" variant="outline" onClick={onArchive} className="px-3" title="Archive">
              <Archive className="w-3.5 h-3.5" />
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onRestore} className="px-3" title="Restore">
              <ArchiveRestore className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function LimitPill({ icon: Icon, value, label }: { icon: any; value: number; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-800/50 rounded-lg py-2 px-1">
      <Icon className="w-3.5 h-3.5 text-slate-400 mb-0.5" />
      <div className="text-sm font-bold text-slate-900 dark:text-white">{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}{value === 1 ? '' : 's'}</div>
    </div>
  );
}

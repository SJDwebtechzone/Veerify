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
  Clock, Percent, Image as ImageIcon, Upload,
} from 'lucide-react';
import { api, uploadImage, resolveImageUrl } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Textarea, Toggle } from '../../components/ui/Input';
import { formatCurrency, cn } from '../../lib/utils';

interface PricingTerm {
  billing_term: 'monthly' | 'quarterly' | 'half_yearly' | 'annual';
  price:        number;
  is_enabled:   boolean;
}
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
  // Trial + discount fields added by migration 020.
  trial_days?: number;
  grace_days?: number;
  discount_enabled?: boolean;
  discount_percent?: number | string;
  created_at?: string;
  // Per-term pricing (migration 049). Falls back to the legacy singleton
  // when the backend hasn't been redeployed yet.
  pricing_terms?: PricingTerm[];
  // Optional plan image (migration 051). Shown next to the plan name.
  image_url?: string | null;
}

// One row per billing term. Prices are strings while editing (empty
// input allowed) and coerced to numbers on save.
type TermRow = { price: string; is_enabled: boolean };

type Draft = {
  name: string;
  // Per-term pricing replaces the old single `price` + `billing_cycle` pair.
  pricing: Record<'monthly' | 'quarterly' | 'half_yearly' | 'annual', TermRow>;
  max_branches: string;
  max_students: string;
  max_trainers: string;
  features: string;
  is_popular: boolean;
  is_active: boolean;
  trial_days: string;
  grace_days: string;
  discount_enabled: boolean;
  discount_percent: string;
  // Optional image (migration 051). '' means "no image"; a non-empty
  // value is a server-returned path like '/uploads/plan-xyz.jpg'.
  image_url: string;
};

const BLANK: Draft = {
  name: '',
  pricing: {
    monthly:     { price: '', is_enabled: true  },
    quarterly:   { price: '', is_enabled: false },
    half_yearly: { price: '', is_enabled: false },
    annual:      { price: '', is_enabled: false },
  },
  max_branches: '1',
  max_students: '25',
  max_trainers: '2',
  features: '',
  is_popular: false,
  is_active: true,
  trial_days: '30',
  grace_days: '3',
  discount_enabled: false,
  discount_percent: '',
  image_url: '',
};

// Effective price after discount, in rupees.
function effectivePrice(p: Plan | Draft): number {
  const price = typeof p === 'object' && 'price' in p ? Number(p.price) || 0 : 0;
  const enabled = (p as any).discount_enabled;
  const pct = Number((p as any).discount_percent) || 0;
  if (!enabled || pct <= 0) return price;
  return Math.round(price * (1 - pct / 100));
}

const BILLING_CYCLES = [
  { key: 'monthly',     label: 'Monthly',      short: 'mo' },
  { key: 'quarterly',   label: 'Quarterly',    short: 'qtr' },
  { key: 'half_yearly', label: 'Half-Yearly',  short: '6mo' },
  { key: 'annual',      label: 'Annual',       short: 'yr' },
];

// Order matters — the Pricing section renders rows in this sequence.
// Each entry maps directly to a plan_pricing.billing_term.
const PRICING_TERMS: Array<{
  key: 'monthly' | 'quarterly' | 'half_yearly' | 'annual';
  label: string;
  hint: string;
  placeholder: string;
}> = [
  { key: 'monthly',     label: 'Monthly',      hint: 'Billed every month',       placeholder: '999'  },
  { key: 'quarterly',   label: 'Quarterly',    hint: 'Billed every 3 months',    placeholder: '2499' },
  { key: 'half_yearly', label: 'Half-Yearly',  hint: 'Billed every 6 months',    placeholder: '4499' },
  { key: 'annual',      label: 'Annual',       hint: 'Billed once per year',     placeholder: '7999' },
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
    // Seed the per-term pricing from the plan's pricing_terms array.
    // Any term the backend didn't return starts disabled with an empty
    // price so the admin can fill it in.
    const pricing: Draft['pricing'] = {
      monthly:     { price: '', is_enabled: false },
      quarterly:   { price: '', is_enabled: false },
      half_yearly: { price: '', is_enabled: false },
      annual:      { price: '', is_enabled: false },
    };
    (plan.pricing_terms || []).forEach((t) => {
      if (pricing[t.billing_term]) {
        pricing[t.billing_term] = {
          price:      t.price != null ? String(t.price) : '',
          is_enabled: !!t.is_enabled,
        };
      }
    });
    // Legacy fallback: if the plan has no pricing_terms yet (pre-049 backend
    // still deployed) seed the current billing_cycle from the singleton pair.
    if (!plan.pricing_terms || plan.pricing_terms.length === 0) {
      const term = (plan.billing_cycle === 'yearly' ? 'annual' : plan.billing_cycle) as keyof Draft['pricing'];
      if (pricing[term]) {
        pricing[term] = { price: String(plan.price ?? ''), is_enabled: true };
      }
    }

    setDraft({
      name:          plan.name || '',
      pricing,
      max_branches:  String(plan.max_branches ?? 1),
      max_students:  String(plan.max_students ?? 25),
      max_trainers:  String(plan.max_trainers ?? 2),
      features:      normaliseFeatures(plan.features).join('\n'),
      is_popular:    !!plan.is_popular,
      is_active:     !!plan.is_active,
      trial_days:    String(plan.trial_days ?? 0),
      grace_days:    String(plan.grace_days ?? 0),
      discount_enabled: !!plan.discount_enabled,
      discount_percent: plan.discount_percent != null ? String(plan.discount_percent) : '',
      image_url:        plan.image_url || '',
    });
    setEditing(plan);
  };
  const closeModal = () => { setEditing(null); setSaving(false); };

  const save = async () => {
    if (!draft.name.trim()) {
      alert('Plan name is required.');
      return;
    }
    // Build pricing_terms — only enabled rows with a valid price count as
    // "priced". Reject if none are enabled (a plan must offer something).
    const pricingTerms = (Object.keys(draft.pricing) as Array<keyof Draft['pricing']>).map((term) => ({
      billing_term: term,
      price:        parseFloat(draft.pricing[term].price || '0') || 0,
      is_enabled:   !!draft.pricing[term].is_enabled,
    }));
    const anyEnabled = pricingTerms.some(
      (t) => t.is_enabled && Number.isFinite(t.price) && t.price >= 0 && (draft.pricing[t.billing_term].price || '').trim() !== '',
    );
    if (!anyEnabled) {
      alert('Enable at least one billing term and set its price.');
      return;
    }

    setSaving(true);
    try {
      const body = {
        name:          draft.name.trim(),
        pricing_terms: pricingTerms,
        // Preserve exactly what the admin typed. Previously we fell
        // back to || 25 / || 2 when the field was empty, so a cleared
        // limit silently reset to the schema seed values on the mobile
        // "Choose your plan" screen. Now: if the field is blank we send
        // null, which the mobile renders as "Unlimited"; otherwise we
        // send the parsed integer (Math.max(1,…) so 0/negative is at
        // least 1, matching the "at least a single row" guard).
        max_branches:  draft.max_branches.trim() === '' ? null
                        : Math.max(1, parseInt(draft.max_branches, 10) || 1),
        max_students:  draft.max_students.trim() === '' ? null
                        : Math.max(1, parseInt(draft.max_students, 10) || 1),
        max_trainers:  draft.max_trainers.trim() === '' ? null
                        : Math.max(1, parseInt(draft.max_trainers, 10) || 1),
        features:      draft.features.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
        is_popular:    draft.is_popular,
        is_active:     draft.is_active,
        trial_days:    Math.max(0, parseInt(draft.trial_days, 10) || 0),
        grace_days:    Math.max(0, parseInt(draft.grace_days, 10) || 0),
        discount_enabled: draft.discount_enabled,
        discount_percent: draft.discount_enabled
          ? Math.max(0, Math.min(100, parseFloat(draft.discount_percent) || 0))
          : 0,
        // Empty string → null so the backend's present-check clears
        // the column instead of storing "".
        image_url: draft.image_url ? draft.image_url : null,
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
          {/* Section: Basics — plan name + optional image. The image
              renders next to the plan name in the plan list (web) and
              on the mobile PlanSelection cards. Pricing got its own
              section below so admins can price the plan across
              multiple billing terms. */}
          <FormSection title="Basics" icon={Tag}>
            <div className="grid grid-cols-1 sm:grid-cols-[96px,1fr] gap-4 items-start">
              {/* Image upload */}
              <PlanImageUploader
                value={draft.image_url}
                onChange={(next) => setDraft({ ...draft, image_url: next })}
              />
              {/* Plan name */}
              <Input
                label="Plan name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Basic / Pro / Enterprise"
              />
            </div>
          </FormSection>

          {/* Section: Pricing — one row per billing term, each with an
              enable toggle + price. Only enabled terms are surfaced on
              the mobile plan-selection screen. */}
          <FormSection title="Pricing" icon={Tag}>
            <p className="text-xs text-slate-500 mb-3">
              Turn on any billing terms this plan should offer and set the price. Mobile users will pick a term when they proceed to payment.
            </p>
            <div className="space-y-2">
              {PRICING_TERMS.map((t) => {
                const row = draft.pricing[t.key];
                return (
                  <div
                    key={t.key}
                    className={cn(
                      'grid grid-cols-12 items-center gap-3 px-3 py-2.5 rounded-lg border',
                      row.is_enabled
                        ? 'border-brand-300 bg-brand-50/40 dark:bg-brand-500/5'
                        : 'border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40',
                    )}
                  >
                    <div className="col-span-5">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">{t.label}</div>
                      <div className="text-[11px] text-slate-500">{t.hint}</div>
                    </div>
                    <div className="col-span-3">
                      {/* Toggle */}
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={row.is_enabled}
                          onChange={(e) => setDraft({
                            ...draft,
                            pricing: {
                              ...draft.pricing,
                              [t.key]: { ...row, is_enabled: e.target.checked },
                            },
                          })}
                          className="w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          {row.is_enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </label>
                    </div>
                    <div className="col-span-4">
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={row.price}
                          onChange={(e) => setDraft({
                            ...draft,
                            pricing: {
                              ...draft.pricing,
                              [t.key]: { ...row, price: e.target.value },
                            },
                          })}
                          placeholder={t.placeholder}
                          disabled={!row.is_enabled}
                          className={cn(
                            'w-full pl-7 pr-3 py-2 rounded-md border text-sm outline-none',
                            row.is_enabled
                              ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-brand-500 focus:border-transparent'
                              : 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/50 text-slate-400',
                          )}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
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

          {/* Section: Trial + Discount */}
          <FormSection title="Trial & Discount" icon={Clock}>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 block">
                  Trial days
                </label>
                <Input
                  type="number"
                  min="0"
                  value={draft.trial_days}
                  onChange={(e) => setDraft({ ...draft, trial_days: e.target.value.replace(/[^0-9]/g, '') })}
                  placeholder="30"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Institution gets all features free for this many days.
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 block">
                  Grace period (days)
                </label>
                <Input
                  type="number"
                  min="0"
                  value={draft.grace_days}
                  onChange={(e) => setDraft({ ...draft, grace_days: e.target.value.replace(/[^0-9]/g, '') })}
                  placeholder="3"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Window after trial ends to pay before access locks.
                </p>
              </div>
            </div>

            {/* Discount toggle */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-slate-50 dark:bg-slate-900/40">
              <Toggle
                label="Discount"
                description="Apply a percentage discount on the listed price."
                checked={draft.discount_enabled}
                onChange={(v) => setDraft({ ...draft, discount_enabled: v })}
              />

              {draft.discount_enabled && (
                <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 block">
                    Discount percent
                  </label>
                  <div className="relative">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={draft.discount_percent}
                      onChange={(e) => setDraft({ ...draft, discount_percent: e.target.value })}
                      placeholder="10"
                    />
                    <Percent
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
                    />
                  </div>

                  {/* Effective price preview */}
                  {draft.price && draft.discount_percent ? (
                    <div className="mt-3 flex items-baseline gap-2 text-sm">
                      <span className="text-xs text-slate-500">Effective price:</span>
                      <span className="line-through text-slate-400 font-mono">
                        ₹{Number(draft.price).toLocaleString('en-IN')}
                      </span>
                      <span className="font-mono font-bold text-emerald-600">
                        ₹{Math.round(Number(draft.price) * (1 - Number(draft.discount_percent) / 100)).toLocaleString('en-IN')}
                      </span>
                      <span className="text-[11px] text-emerald-600 font-semibold">
                        ({draft.discount_percent}% off)
                      </span>
                    </div>
                  ) : null}
                </div>
              )}
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

// ─────────────────────────────────────────────────────────────────
// PlanImage — renders the plan's thumbnail with a soft-brand placeholder
// fallback when no image is set. Used both in the form (as the upload
// target thumbnail) and next to the plan name in the list card.
// ─────────────────────────────────────────────────────────────────
function PlanImage({
  src, size = 40, className = '',
}: {
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const url = src ? resolveImageUrl(src) : '';
  return (
    <div
      className={cn(
        'shrink-0 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700',
        'bg-brand-50 dark:bg-brand-500/10 grid place-items-center',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <ImageIcon className="w-1/2 h-1/2 text-brand-400/60" />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// PlanImageUploader — used inside the edit modal. Click the tile to
// pick a file; hovering when an image is present reveals a small
// "Remove" chip so admins can clear it.
// ─────────────────────────────────────────────────────────────────
function PlanImageUploader({
  value, onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  const pickFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      const url = await uploadImage(file);
      onChange(url);
    } catch {
      setErr('Upload failed. Try a smaller image.');
    } finally {
      setBusy(false);
    }
  };

  const previewUrl = value ? resolveImageUrl(value) : '';
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300">
        Image
      </label>
      <div className="relative group">
        <label
          htmlFor="plan-image-upload"
          className={cn(
            'flex items-center justify-center w-24 h-24 rounded-lg cursor-pointer border-2 border-dashed',
            'transition-colors',
            previewUrl
              ? 'border-slate-200 dark:border-slate-700'
              : 'border-slate-300 dark:border-slate-600 hover:border-brand-400 hover:bg-brand-50 dark:hover:bg-brand-500/5',
            'overflow-hidden',
          )}
        >
          {busy ? (
            <div className="text-[10px] text-slate-500">Uploading…</div>
          ) : previewUrl ? (
            <img src={previewUrl} alt="Plan" className="w-full h-full object-cover" />
          ) : (
            <div className="text-center px-2">
              <Upload className="w-4 h-4 mx-auto text-slate-400" />
              <div className="text-[10px] text-slate-500 mt-1 leading-tight">
                Click to upload
              </div>
            </div>
          )}
          <input
            id="plan-image-upload"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
            disabled={busy}
          />
        </label>
        {previewUrl && !busy ? (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); onChange(''); }}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-500 text-white grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity"
            title="Remove image"
          >
            <X className="w-3 h-3" />
          </button>
        ) : null}
      </div>
      {err ? <div className="text-[11px] text-rose-500 mt-1">{err}</div> : null}
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

  // Trial / discount derived data.
  const trialDays = Number(plan.trial_days) || 0;
  const graceDays = Number(plan.grace_days) || 0;
  const discountOn = !!plan.discount_enabled;
  const discountPct = Number(plan.discount_percent) || 0;
  const effectivePriceVal = discountOn && discountPct > 0
    ? Math.round(price * (1 - discountPct / 100))
    : price;

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
        {/* Title + pricing block on the left, plan image on the right so
            it visually anchors the whole name+price area at the same
            height. Placeholder tile renders when no image was uploaded. */}
        <div className="flex items-start gap-3 mb-3">
          <div className="min-w-0 flex-1">
            {/* Tier icon + name */}
            <div className="flex items-center gap-2.5 mb-4">
              <div className={cn('w-10 h-10 rounded-xl grid place-items-center', styles.iconBg)}>
                <TierIcon className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                  {tier === 'basic' ? 'Starter' : tier === 'premium' ? 'Premium' : 'Pro tier'}
                </div>
                <div className="text-base font-bold text-slate-900 dark:text-white leading-tight truncate">{plan.name}</div>
              </div>
            </div>

        {/* Price */}
        <div className="mb-3">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            {discountOn && discountPct > 0 ? (
              <>
                <span className="text-2xl font-bold text-slate-400 line-through tabular-nums">
                  {formatCurrency(price)}
                </span>
                <span className="text-4xl font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {formatCurrency(effectivePriceVal)}
                </span>
              </>
            ) : (
              <span className="text-4xl font-extrabold text-slate-900 dark:text-white tabular-nums">
                {formatCurrency(price)}
              </span>
            )}
            <span className="text-sm text-slate-500 dark:text-slate-400">/{billing}</span>
            {discountOn && discountPct > 0 ? (
              <span className="ml-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                {discountPct}% off
              </span>
            ) : null}
          </div>

          {/* Trial + Grace pills */}
          {(trialDays > 0 || graceDays > 0) ? (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {trialDays > 0 ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                  <Clock className="w-3 h-3" />
                  {trialDays}-day free trial
                </span>
              ) : null}
              {graceDays > 0 ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                  +{graceDays}-day grace
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
          </div>
          {/* Right-side plan image — 80px so it visually anchors both the
              plan name and the big price line at the same height. */}
          <PlanImage src={plan.image_url} size={80} />
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

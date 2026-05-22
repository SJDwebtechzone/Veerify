import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Pencil,
  Plus,
  Smartphone,
  Trash2,
  Image as ImageIcon,
} from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Textarea, Toggle } from '../../components/ui/Input';

import { useCmsCollection } from '../../lib/cms';
import { uploadImage, resolveImageUrl } from '../../lib/api';
import { defaultBanners, type BannerItem } from '../../data/mobileCms';
import { cn } from '../../lib/utils';

const blank: Omit<BannerItem, 'id' | 'sortOrder'> = {
  label: '',
  title: '',
  subtitle: '',
  cta: 'Learn more →',
  imageUrl: '',
  isActive: true,
};

export function Banners() {
  const { items, create, update, remove, move } =
    useCmsCollection<BannerItem>('banners', defaultBanners);

  const [editing, setEditing] = useState<BannerItem | 'new' | null>(null);

  const [draft, setDraft] =
    useState<Omit<BannerItem, 'id' | 'sortOrder'>>(blank);

  const [uploading, setUploading] = useState(false);

  const handleFile = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file);
      setDraft((d) => ({ ...d, imageUrl: url }));
    } catch (err) {
      console.error('Upload failed', err);
      alert('Image upload failed. Make sure the backend is running.');
    } finally {
      setUploading(false);
    }
  };

  const openNew = () => {
    setDraft(blank);
    setEditing('new');
  };

  const openEdit = (item: BannerItem) => {
    setDraft({ ...item });
    setEditing(item);
  };

  const save = () => {
    if (editing === 'new') {
      create(draft);
    } else if (editing) {
      update(editing.id, draft);
    }

    setEditing(null);
  };

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Hero Banners
          </h1>

          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Manage the carousel banners that appear at the top
            of the mobile home screen.
          </p>
        </div>

        <Button
          leftIcon={<Plus className="w-4 h-4" />}
          onClick={openNew}
        >
          Add Banner
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Banner List */}
        <div className="lg:col-span-2 space-y-3">
          {items.map((banner, idx) => (
            <div
              key={banner.id}
              className="card p-4 flex gap-4 items-center"
            >
              {/* Mini Preview */}
              <div
                className="relative overflow-hidden rounded-xl w-32 h-20 shrink-0 bg-slate-200"
                style={{
                  backgroundImage: `url(${resolveImageUrl(banner.imageUrl)})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                <div className="absolute inset-0 bg-black/40" />

                <div className="relative z-10 p-2">
                  <div className="text-[8px] text-white font-bold tracking-wider uppercase truncate">
                    {banner.label}
                  </div>

                  <div className="text-[10px] text-white font-semibold leading-tight line-clamp-2 mt-1">
                    {banner.title}
                  </div>
                </div>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-slate-900 dark:text-white text-sm truncate">
                    {banner.title}
                  </h3>

                  <Badge
                    variant={banner.isActive ? 'success' : 'neutral'}
                    dot
                  >
                    {banner.isActive ? 'Active' : 'Hidden'}
                  </Badge>
                </div>

                <div className="text-xs text-slate-500 mt-0.5 truncate">
                  {banner.subtitle}
                </div>

                <div className="text-[11px] text-slate-400 mt-1 font-mono truncate">
                  {banner.label} • CTA: {banner.cta}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-0.5 shrink-0">
                <IconBtn
                  disabled={idx === 0}
                  onClick={() => move(banner.id, 'up')}
                >
                  <ArrowUp className="w-4 h-4" />
                </IconBtn>

                <IconBtn
                  disabled={idx === items.length - 1}
                  onClick={() => move(banner.id, 'down')}
                >
                  <ArrowDown className="w-4 h-4" />
                </IconBtn>

                <IconBtn onClick={() => openEdit(banner)}>
                  <Pencil className="w-4 h-4" />
                </IconBtn>

                <IconBtn
                  destructive
                  onClick={() =>
                    confirm('Delete this banner?') &&
                    remove(banner.id)
                  }
                >
                  <Trash2 className="w-4 h-4" />
                </IconBtn>
              </div>
            </div>
          ))}

          {items.length === 0 && (
            <div className="card p-12 text-center text-sm text-slate-500">
              No banners yet. Click{' '}
              <span className="font-semibold">
                Add Banner
              </span>{' '}
              to create the first one.
            </div>
          )}
        </div>

        {/* Mobile Preview */}
        <div className="lg:sticky lg:top-20 self-start">
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Smartphone className="w-4 h-4 text-slate-400" />

              <h3 className="text-sm font-semibold">
                Mobile preview
              </h3>
            </div>

            <div className="rounded-2xl bg-slate-100 dark:bg-slate-800 p-3 space-y-2">
              {items
                .filter((b) => b.isActive)
                .map((banner) => (
                  <div
                    key={banner.id}
                    className="relative overflow-hidden rounded-xl p-4 h-32"
                    style={{
                      backgroundImage: `url(${resolveImageUrl(banner.imageUrl)})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  >
                    <div className="absolute inset-0 bg-black/40" />

                    <div className="relative z-10">
                      <div className="text-[9px] text-white font-bold tracking-wider opacity-90">
                        {banner.label}
                      </div>

                      <div className="text-sm text-white font-semibold mt-1 leading-tight">
                        {banner.title}
                      </div>

                      <div className="text-[11px] text-white opacity-80 mt-0.5">
                        {banner.subtitle}
                      </div>

                      <div className="inline-block mt-2 bg-white text-[10px] font-semibold px-2.5 py-0.5 rounded-full text-slate-900">
                        {banner.cta}
                      </div>
                    </div>
                  </div>
                ))}

              {items.filter((b) => b.isActive).length === 0 && (
                <div className="text-xs text-slate-500 text-center py-6">
                  No active banners — the carousel will be hidden.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal */}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={
          editing === 'new'
            ? 'Add new banner'
            : 'Edit banner'
        }
        size="lg"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>

            <Button onClick={save}>
              {editing === 'new'
                ? 'Create banner'
                : 'Save changes'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Label (small badge)"
            value={draft.label}
            onChange={(e) =>
              setDraft({
                ...draft,
                label: e.target.value,
              })
            }
            placeholder="FEATURED PROGRAM"
          />

          <Input
            label="CTA button text"
            value={draft.cta}
            onChange={(e) =>
              setDraft({
                ...draft,
                cta: e.target.value,
              })
            }
            placeholder="Explore →"
          />

          <Input
            className="md:col-span-2"
            label="Title"
            value={draft.title}
            onChange={(e) =>
              setDraft({
                ...draft,
                title: e.target.value,
              })
            }
            placeholder="Master Karate in 90 Days"
          />

          <Textarea
            className="md:col-span-2"
            label="Subtitle"
            value={draft.subtitle}
            onChange={(e) =>
              setDraft({
                ...draft,
                subtitle: e.target.value,
              })
            }
            placeholder="Join 500+ students this month"
            rows={2}
          />

          {/* Image Upload */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-2">
              Banner Image
            </label>

            <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-6 text-center">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                id="banner-upload"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />

              <label
                htmlFor="banner-upload"
                className="cursor-pointer flex flex-col items-center gap-2"
              >
                {uploading ? (
                  <>
                    <div className="w-6 h-6 border-2 border-slate-300 border-t-brand-500 rounded-full animate-spin" />
                    <span className="text-sm font-medium">Uploading…</span>
                  </>
                ) : draft.imageUrl ? (
                  <>
                    <img src={resolveImageUrl(draft.imageUrl)} alt="" className="max-h-32 rounded-lg mb-1" />
                    <span className="text-xs text-brand-600 font-semibold">
                      Click to replace
                    </span>
                  </>
                ) : (
                  <>
                    <ImageIcon className="w-8 h-8 text-slate-400" />
                    <span className="text-sm font-medium">
                      Click to upload banner image
                    </span>
                    <span className="text-xs text-slate-500">
                      PNG, JPG, WEBP — up to 10 MB
                    </span>
                  </>
                )}
              </label>
            </div>

            <Input
              className="mt-2"
              label=""
              value={draft.imageUrl}
              onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
              placeholder="…or paste an image URL"
            />
          </div>

          {/* Toggle */}
          <div className="md:col-span-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <Toggle
              checked={draft.isActive}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  isActive: v,
                })
              }
              label="Show on mobile home screen"
            />
          </div>

          {/* Live Preview */}
          <div className="md:col-span-2">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
              Live Preview
            </div>

            <div
              className="relative overflow-hidden rounded-xl p-5 h-40 bg-slate-200"
              style={{
                backgroundImage: `url(${resolveImageUrl(draft.imageUrl)})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              <div className="absolute inset-0 bg-black/40" />

              <div className="relative z-10">
                <div className="text-[10px] text-white font-bold tracking-wider opacity-90">
                  {draft.label || 'LABEL'}
                </div>

                <div className="text-xl text-white font-bold mt-2">
                  {draft.title ||
                    'Banner title goes here'}
                </div>

                <div className="text-sm text-white opacity-80 mt-1">
                  {draft.subtitle || 'Subtitle text'}
                </div>

                <div className="inline-block mt-4 bg-white text-sm font-semibold px-4 py-1 rounded-full text-slate-900">
                  {draft.cta || 'CTA'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
  destructive,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'p-1.5 rounded-lg transition-colors',
        destructive
          ? 'text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10'
          : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800',
        'disabled:opacity-30 disabled:pointer-events-none'
      )}
    >
      {children}
    </button>
  );
}
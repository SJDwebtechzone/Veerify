import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Image as ImageIcon,
  Pencil,
  Plus,
  Smartphone,
  Trash2,
} from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Toggle } from '../../components/ui/Input';

import { useCmsCollection } from '../../lib/cms';
import { uploadImage, resolveImageUrl } from '../../lib/api';
import {
  defaultCategories,
  type CategoryItem,
} from '../../data/mobileCms';

import { cn } from '../../lib/utils';

const blank: Omit<CategoryItem, 'id' | 'sortOrder'> = {
  name: '',
  imageUrl: '',
  isActive: true,
};

export function Categories() {
  const { items, create, update, remove, move } =
    useCmsCollection<CategoryItem>(
      'categories',
      defaultCategories
    );

  const [editing, setEditing] =
    useState<CategoryItem | 'new' | null>(null);

  const [draft, setDraft] =
    useState<Omit<CategoryItem, 'id' | 'sortOrder'>>(
      blank
    );

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

  const openEdit = (it: CategoryItem) => {
    setDraft({ ...it });
    setEditing(it);
  };

  const save = () => {
    if (editing === 'new') create(draft);
    else if (editing) update(editing.id, draft);

    setEditing(null);
  };

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Categories
          </h1>

          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Manage the category grid shown on the
            mobile home screen.
          </p>
        </div>

        <Button
          leftIcon={<Plus className="w-4 h-4" />}
          onClick={openNew}
        >
          Add Category
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Categories Grid */}
        <div className="lg:col-span-2 card p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {items.map((cat, idx) => (
              <div
                key={cat.id}
                className="group relative rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden hover:shadow-soft transition-all"
              >
                {/* Image */}
                <div
                  className="aspect-[3/2] bg-slate-200 bg-cover bg-center"
                  style={{
                    backgroundImage: `url(${resolveImageUrl(cat.imageUrl)})`,
                  }}
                />

                {/* Content */}
                <div className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">
                        {cat.name}
                      </div>

                      <Badge
                        variant={
                          cat.isActive
                            ? 'success'
                            : 'neutral'
                        }
                        dot
                      >
                        {cat.isActive
                          ? 'Active'
                          : 'Hidden'}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 bg-white/90 dark:bg-slate-900/90 backdrop-blur rounded-lg p-0.5">
                  <IconBtn
                    disabled={idx === 0}
                    onClick={() =>
                      move(cat.id, 'up')
                    }
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </IconBtn>

                  <IconBtn
                    disabled={
                      idx === items.length - 1
                    }
                    onClick={() =>
                      move(cat.id, 'down')
                    }
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </IconBtn>

                  <IconBtn
                    onClick={() => openEdit(cat)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </IconBtn>

                  <IconBtn
                    destructive
                    onClick={() =>
                      confirm(
                        'Delete this category?'
                      ) && remove(cat.id)
                    }
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </IconBtn>
                </div>
              </div>
            ))}
          </div>

          {items.length === 0 && (
            <div className="text-center py-12 text-sm text-slate-500">
              No categories yet.
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

            <div className="rounded-2xl bg-slate-100 dark:bg-slate-800 p-3">
              <div className="text-[11px] font-semibold mb-2 text-slate-700 dark:text-slate-300">
                Categories
              </div>

              <div className="grid grid-cols-3 gap-2">
                {items
                  .filter((c) => c.isActive)
                  .map((cat) => (
                    <div
                      key={cat.id}
                      className="flex flex-col items-center"
                    >
                      <div
                        className="w-full aspect-[3/2] rounded-lg bg-cover bg-center bg-slate-200"
                        style={{
                          backgroundImage: `url(${resolveImageUrl(cat.imageUrl)})`,
                        }}
                      />

                      <div className="text-[10px] mt-1 text-center font-medium">
                        {cat.name}
                      </div>
                    </div>
                  ))}
              </div>
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
            ? 'Add new category'
            : 'Edit category'
        }
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
                ? 'Create'
                : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {/* Name */}
          <Input
            label="Category Name"
            value={draft.name}
            onChange={(e) =>
              setDraft({
                ...draft,
                name: e.target.value,
              })
            }
            placeholder="Karate"
          />

          {/* Image Upload */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Category Image
            </label>

            <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-6 text-center">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                id="category-upload"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />

              <label
                htmlFor="category-upload"
                className="cursor-pointer flex flex-col items-center gap-2"
              >
                {uploading ? (
                  <>
                    <div className="w-6 h-6 border-2 border-slate-300 border-t-brand-500 rounded-full animate-spin" />
                    <span className="text-sm font-medium">Uploading…</span>
                  </>
                ) : draft.imageUrl ? (
                  <>
                    <img src={resolveImageUrl(draft.imageUrl)} alt="" className="max-h-24 rounded-lg mb-1" />
                    <span className="text-xs text-brand-600 font-semibold">
                      Click to replace
                    </span>
                  </>
                ) : (
                  <>
                    <ImageIcon className="w-8 h-8 text-slate-400" />
                    <span className="text-sm font-medium">
                      Click to upload image
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
          <Toggle
            checked={draft.isActive}
            onChange={(v) =>
              setDraft({
                ...draft,
                isActive: v,
              })
            }
            label="Show on mobile"
          />

          {/* Preview */}
          <div>
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
              Preview
            </div>

            <div className="w-32">
              <div
                className="aspect-[3/2] rounded-xl bg-cover bg-center bg-slate-200"
                style={{
                  backgroundImage: `url(${resolveImageUrl(draft.imageUrl)})`,
                }}
              />

              <div className="text-sm mt-2 font-medium text-center">
                {draft.name || 'Category'}
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
        'p-1 rounded-md transition-colors',
        destructive
          ? 'text-slate-500 hover:text-rose-600'
          : 'text-slate-500 hover:text-slate-900 dark:hover:text-white',
        'disabled:opacity-30 disabled:pointer-events-none'
      )}
    >
      {children}
    </button>
  );
}
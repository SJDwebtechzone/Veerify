import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Pencil,
  Play,
  Plus,
  Smartphone,
  Trash2,
} from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Toggle } from '../../components/ui/Input';

import { useCmsCollection } from '../../lib/cms';
import { resolveImageUrl } from '../../lib/api';
import {
  defaultVideos,
  type VideoItem,
} from '../../data/mobileCms';

import { cn } from '../../lib/utils';

const blank: Omit<VideoItem, 'id' | 'sortOrder'> = {
  title: '',
  trainer: '',
  duration: '0:00',
  videoUrl: '',
  thumbnailUrl: '',
  isFree: true,
  isActive: true,
};

function getYoutubeThumbnail(url: string) {
  if (!url) return '';

  const regExp =
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([^"&?\/\s]{11})/;

  const match = url.match(regExp);

  if (!match || !match[1]) return '';

  return `https://img.youtube.com/vi/${match[1]}/maxresdefault.jpg`;
}

export function Videos() {
  const { items, create, update, remove, move } =
    useCmsCollection<VideoItem>(
      'videos',
      defaultVideos
    );

  const [editing, setEditing] =
    useState<VideoItem | 'new' | null>(null);

  const [draft, setDraft] =
    useState<Omit<VideoItem, 'id' | 'sortOrder'>>(
      blank
    );

  const openNew = () => {
    setDraft(blank);
    setEditing('new');
  };

  const openEdit = (it: VideoItem) => {
    setDraft({ ...it });
    setEditing(it);
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
            Featured Videos
          </h1>

          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Free intro videos shown on the mobile
            home screen.
          </p>
        </div>

        <Button
          leftIcon={<Plus className="w-4 h-4" />}
          onClick={openNew}
        >
          Add Video
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Video List */}
        <div className="lg:col-span-2 space-y-3">
          {items.map((video, idx) => (
            <div
              key={video.id}
              className="card p-4 flex gap-4 items-center"
            >
              {/* Thumbnail */}
              <div
                className="relative overflow-hidden rounded-xl w-36 h-20 shrink-0 bg-slate-200 bg-cover bg-center"
                style={{
                  backgroundImage: `url(${
                    resolveImageUrl(video.thumbnailUrl) ||
                    getYoutubeThumbnail(video.videoUrl)
                  })`,
                }}
              >
                <div className="absolute inset-0 bg-black/30" />

                <div className="absolute inset-0 grid place-items-center">
                  <div className="w-9 h-9 rounded-full bg-white/95 grid place-items-center">
                    <Play
                      className="w-4 h-4 text-slate-900 ml-0.5"
                      fill="currentColor"
                    />
                  </div>
                </div>

                <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">
                  {video.duration}
                </div>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-slate-900 dark:text-white text-sm truncate">
                    {video.title}
                  </h3>

                  <Badge
                    variant={
                      video.isActive
                        ? 'success'
                        : 'neutral'
                    }
                    dot
                  >
                    {video.isActive
                      ? 'Active'
                      : 'Hidden'}
                  </Badge>

                  {video.isFree && (
                    <Badge variant="info">
                      Free
                    </Badge>
                  )}
                </div>

                <div className="text-xs text-slate-500 mt-0.5">
                  by {video.trainer}
                </div>

                {video.videoUrl && (
                  <div className="text-[11px] text-slate-400 mt-1 font-mono truncate">
                    {video.videoUrl}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-0.5 shrink-0">
                <IconBtn
                  disabled={idx === 0}
                  onClick={() =>
                    move(video.id, 'up')
                  }
                >
                  <ArrowUp className="w-4 h-4" />
                </IconBtn>

                <IconBtn
                  disabled={
                    idx === items.length - 1
                  }
                  onClick={() =>
                    move(video.id, 'down')
                  }
                >
                  <ArrowDown className="w-4 h-4" />
                </IconBtn>

                <IconBtn
                  onClick={() => openEdit(video)}
                >
                  <Pencil className="w-4 h-4" />
                </IconBtn>

                <IconBtn
                  destructive
                  onClick={() =>
                    confirm(
                      'Delete this video?'
                    ) && remove(video.id)
                  }
                >
                  <Trash2 className="w-4 h-4" />
                </IconBtn>
              </div>
            </div>
          ))}

          {items.length === 0 && (
            <div className="card p-12 text-center text-sm text-slate-500">
              No videos yet.
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
              <div className="text-[11px] font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Featured Videos
              </div>

              {items
                .filter((v) => v.isActive)
                .map((video) => (
                  <div
                    key={video.id}
                    className="bg-white dark:bg-slate-900 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700"
                  >
                    <div
                      className="h-20 relative bg-cover bg-center"
                      style={{
                        backgroundImage: `url(${
                          video.thumbnailUrl ||
                          getYoutubeThumbnail(
                            video.videoUrl
                          )
                        })`,
                      }}
                    >
                      <div className="absolute inset-0 bg-black/30" />

                      <div className="absolute inset-0 grid place-items-center">
                        <div className="w-8 h-8 rounded-full bg-white/95 grid place-items-center">
                          <Play
                            className="w-3.5 h-3.5 text-slate-900 ml-0.5"
                            fill="currentColor"
                          />
                        </div>
                      </div>

                      <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] px-1 rounded">
                        {video.duration}
                      </div>
                    </div>

                    <div className="p-2">
                      <div className="text-[11px] font-semibold leading-tight">
                        {video.title}
                      </div>

                      <div className="text-[10px] text-slate-500 mt-0.5">
                        Free intro • {video.trainer}
                      </div>
                    </div>
                  </div>
                ))}

              {items.filter((v) => v.isActive)
                .length === 0 && (
                <div className="text-xs text-slate-500 text-center py-6">
                  No active videos.
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
            ? 'Add new video'
            : 'Edit video'
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
                ? 'Create'
                : 'Save'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Title */}
          <Input
            className="md:col-span-2"
            label="Video title"
            value={draft.title}
            onChange={(e) =>
              setDraft({
                ...draft,
                title: e.target.value,
              })
            }
            placeholder="Basic Karate Stance Tutorial"
          />

          {/* Trainer */}
          <Input
            label="Trainer name"
            value={draft.trainer}
            onChange={(e) =>
              setDraft({
                ...draft,
                trainer: e.target.value,
              })
            }
            placeholder="Suresh Sensei"
          />

          {/* Duration */}
          <Input
            label="Duration (mm:ss)"
            value={draft.duration}
            onChange={(e) =>
              setDraft({
                ...draft,
                duration: e.target.value,
              })
            }
            placeholder="3:45"
          />

          {/* Video URL */}
          <Input
            className="md:col-span-2"
            label="Video URL (YouTube)"
            value={draft.videoUrl}
            onChange={(e) => {
              const url = e.target.value;

              setDraft({
                ...draft,
                videoUrl: url,
                thumbnailUrl:
                  getYoutubeThumbnail(url),
              });
            }}
            placeholder="https://youtu.be/..."
          />

          {/* Thumbnail Preview */}
          <div className="md:col-span-2">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
              Thumbnail Preview
            </div>

            <div
              className="relative rounded-xl overflow-hidden h-44 bg-slate-200 bg-cover bg-center"
              style={{
                backgroundImage: `url(${
                  resolveImageUrl(draft.thumbnailUrl) ||
                  getYoutubeThumbnail(draft.videoUrl)
                })`,
              }}
            >
              <div className="absolute inset-0 bg-black/30" />

              <div className="absolute inset-0 grid place-items-center">
                <div className="w-12 h-12 rounded-full bg-white/95 grid place-items-center">
                  <Play
                    className="w-5 h-5 text-slate-900 ml-0.5"
                    fill="currentColor"
                  />
                </div>
              </div>

              <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                {draft.duration || '0:00'}
              </div>
            </div>
          </div>

          {/* Toggles */}
          <div className="flex flex-col gap-3 md:col-span-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <Toggle
              checked={draft.isFree}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  isFree: v,
                })
              }
              label="This is a free intro video"
            />

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
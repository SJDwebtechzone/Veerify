import { useState } from 'react';
import { ArrowDown, ArrowUp, Image as ImageIcon, MapPin, Pencil, Plus, Smartphone, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Toggle } from '../../components/ui/Input';
import { useCmsCollection } from '../../lib/cms';
import { uploadImage, resolveImageUrl } from '../../lib/api';
import { defaultEvents, type EventItem } from '../../data/mobileCms';
import { cn } from '../../lib/utils';

const blank: Omit<EventItem, 'id' | 'sortOrder'> = {
  title: '',
  subtitle: '',
  imageUrl: '',
  link: '',
  location: '',
  date: new Date().toISOString().slice(0, 10),
  registrationClosingDate: new Date().toISOString().slice(0, 10),
  isActive: true,
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function dayMonth(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { day: '--', month: '---' };
  return { day: String(d.getDate()).padStart(2, '0'), month: MONTHS[d.getMonth()] };
}

function daysUntil(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const diff = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return diff;
}

export function Events() {
  const { items, create, update, remove, move } = useCmsCollection<EventItem>('events', defaultEvents);
  const [editing, setEditing] = useState<EventItem | 'new' | null>(null);
  const [draft, setDraft] = useState<Omit<EventItem, 'id' | 'sortOrder'>>(blank);
  const [uploading, setUploading] = useState(false);

  const openNew = () => {
    setDraft(blank);
    setEditing('new');
  };
  const openEdit = (it: EventItem) => {
    setDraft({ ...it });
    setEditing(it);
  };
  const save = () => {
    if (editing === 'new') create(draft);
    else if (editing) update(editing.id, draft);
    setEditing(null);
  };

  // Upload an image from the admin's computer to /api/uploads and store the
  // returned relative path in draft.imageUrl. Same pattern as Banners.tsx.
  const handleFile = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file);
      setDraft((d) => ({ ...d, imageUrl: url }));
    } catch (err) {
      console.error('Event banner upload failed', err);
      alert('Upload failed. Try again or paste a URL instead.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Upcoming Events</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Tournaments, belt exams, and other events featured on the mobile home screen.
          </p>
        </div>
        <Button leftIcon={<Plus className="w-4 h-4" />} onClick={openNew}>Add Event</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-3">
          {items.map((event, idx) => {
            const { day, month } = dayMonth(event.date);
            const closing = daysUntil(event.registrationClosingDate);
            return (
              <div key={event.id} className="card p-4 flex gap-4 items-center">
                <div className="shrink-0 w-16 h-16 rounded-xl bg-slate-900 dark:bg-slate-800 grid place-items-center text-white">
                  <div className="text-[10px] font-semibold text-slate-400 tracking-wider">{month}</div>
                  <div className="text-xl font-bold leading-none">{day}</div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-slate-900 dark:text-white text-sm truncate">{event.title}</h3>
                    <Badge variant={event.isActive ? 'success' : 'neutral'} dot>{event.isActive ? 'Active' : 'Hidden'}</Badge>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {event.location}
                  </div>
                  {closing !== null && (
                    <div className={cn('text-[11px] mt-1 font-medium', closing >= 0 ? 'text-amber-600' : 'text-rose-600')}>
                      {closing >= 0 ? `Registration closes in ${closing} days` : `Registration closed ${Math.abs(closing)} days ago`}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                  <IconBtn disabled={idx === 0} onClick={() => move(event.id, 'up')}><ArrowUp className="w-4 h-4" /></IconBtn>
                  <IconBtn disabled={idx === items.length - 1} onClick={() => move(event.id, 'down')}><ArrowDown className="w-4 h-4" /></IconBtn>
                  <IconBtn onClick={() => openEdit(event)}><Pencil className="w-4 h-4" /></IconBtn>
                  <IconBtn destructive onClick={() => confirm('Delete this event?') && remove(event.id)}><Trash2 className="w-4 h-4" /></IconBtn>
                </div>
              </div>
            );
          })}
          {items.length === 0 && (
            <div className="card p-12 text-center text-sm text-slate-500">No events yet.</div>
          )}
        </div>

        {/* Mobile preview */}
        <div className="lg:sticky lg:top-20 self-start">
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Smartphone className="w-4 h-4 text-slate-400" />
              <h3 className="text-sm font-semibold">Mobile preview</h3>
            </div>
            <div className="rounded-2xl bg-slate-100 dark:bg-slate-800 p-3 space-y-2">
              <div className="text-[11px] font-semibold mb-1 text-slate-700 dark:text-slate-300">Upcoming Events</div>
              {items.filter((e) => e.isActive).map((event) => {
                const { day, month } = dayMonth(event.date);
                const closing = daysUntil(event.registrationClosingDate);
                return (
                  <div key={event.id} className="bg-slate-900 rounded-xl p-3 flex items-center gap-3">
                    <div className="text-center text-white shrink-0 min-w-[40px]">
                      <div className="text-[9px] text-slate-400 font-semibold tracking-wider">{month}</div>
                      <div className="text-lg font-bold leading-none">{day}</div>
                    </div>
                    <div className="flex-1 min-w-0 text-white">
                      <div className="text-[12px] font-semibold leading-tight truncate">{event.title}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1"><MapPin className="w-2.5 h-2.5" /> {event.location}</div>
                      {closing !== null && closing >= 0 && (
                        <div className="text-[10px] text-amber-400 mt-0.5">Closes in {closing} days</div>
                      )}
                    </div>
                  </div>
                );
              })}
              {items.filter((e) => e.isActive).length === 0 && (
                <div className="text-xs text-slate-500 text-center py-6">No active events.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add new event' : 'Edit event'}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save}>{editing === 'new' ? 'Create' : 'Save'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Event title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Belt Examination 2026" />
          <Input label="Subtitle" value={draft.subtitle ?? ''} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} placeholder="Short tagline shown under the title" />

          {/* Banner image upload — same pattern as Banners.tsx */}
          <div>
            <label className="block text-sm font-medium mb-2">Banner image</label>
            <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-6 text-center">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                id="event-banner-upload"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              <label htmlFor="event-banner-upload" className="cursor-pointer flex flex-col items-center gap-2">
                {uploading ? (
                  <>
                    <div className="w-6 h-6 border-2 border-slate-300 border-t-brand-500 rounded-full animate-spin" />
                    <span className="text-sm font-medium">Uploading…</span>
                  </>
                ) : draft.imageUrl ? (
                  <>
                    <img src={resolveImageUrl(draft.imageUrl)} alt="" className="max-h-32 rounded-lg mb-1" />
                    <span className="text-xs text-brand-600 font-semibold">Click to replace</span>
                  </>
                ) : (
                  <>
                    <ImageIcon className="w-8 h-8 text-slate-400" />
                    <span className="text-sm font-medium">Click to upload event banner</span>
                    <span className="text-xs text-slate-500">PNG or JPG, 16:9 recommended</span>
                  </>
                )}
              </label>
            </div>
            <Input
              className="mt-2"
              label="…or paste an image URL"
              value={draft.imageUrl ?? ''}
              onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
              placeholder="https://..."
            />
          </div>

          <Input label="Registration / info link" value={draft.link ?? ''} onChange={(e) => setDraft({ ...draft, link: e.target.value })} placeholder="https://forms.gle/..." />
          <Input label="Location" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="Chennai Karate Academy" />
          <div className="grid grid-cols-2 gap-4">
            <Input type="date" label="Event date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            <Input type="date" label="Registration closes" value={draft.registrationClosingDate} onChange={(e) => setDraft({ ...draft, registrationClosingDate: e.target.value })} />
          </div>
          <Toggle checked={draft.isActive} onChange={(v) => setDraft({ ...draft, isActive: v })} label="Show on mobile home screen" />
        </div>
      </Modal>
    </div>
  );
}

function IconBtn({ children, onClick, disabled, destructive }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; destructive?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'p-1.5 rounded-lg transition-colors',
        destructive ? 'text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10' : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800',
        'disabled:opacity-30 disabled:pointer-events-none',
      )}
    >
      {children}
    </button>
  );
}

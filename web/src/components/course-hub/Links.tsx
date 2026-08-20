'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addCourseLink, deleteCourseLink, updateCourseLink } from '@/app/actions/course-hub';
import { EditForm, type Field, type FieldValue } from '@/components/ui/EditForm';
import { inputClass, LINK_ICON } from './shared';

export type LinkRow = {
  id: string;
  kind: string;
  label: string;
  url: string;
  passcode: string | null;
};

const KINDS = ['zoom', 'meet', 'lms', 'syllabus', 'textbook', 'drive', 'other'] as const;

const LINK_FIELDS: Field[] = [
  {
    name: 'kind',
    label: 'Type',
    type: 'select',
    options: KINDS.map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) })),
  },
  { name: 'label', label: 'Label', type: 'text', required: true },
  { name: 'url', label: 'URL', type: 'url', required: true, span: 2 },
  { name: 'passcode', label: 'Passcode', type: 'text', span: 2 },
];

export function Links({ courseId, links }: { courseId: string; links: LinkRow[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number]>('zoom');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const refresh = () => startTransition(() => router.refresh());

  return (
    <div className="space-y-2">
      {links.length === 0 && !adding && (
        <p className="text-xs text-[var(--color-muted)]">
          No links yet. Add your Zoom room, the Canvas page, or the syllabus.
        </p>
      )}

      {links.map((link) =>
        editing === link.id ? (
          <EditForm
            key={link.id}
            fields={LINK_FIELDS}
            initial={{
              kind: link.kind,
              label: link.label,
              url: link.url,
              passcode: link.passcode ?? '',
            }}
            onSave={async (v: Record<string, FieldValue>) => {
              const result = await updateCourseLink(link.id, {
                courseId,
                kind: String(v.kind),
                label: String(v.label ?? ''),
                url: String(v.url ?? ''),
                passcode: String(v.passcode ?? ''),
              });

              if (result.ok) {
                setEditing(null);
                refresh();
              }
              return result;
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
        <div
          key={link.id}
          className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
        >
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 text-sm hover:text-[var(--color-accent)]"
          >
            <span aria-hidden className="mr-2">{LINK_ICON[link.kind] ?? '🔗'}</span>
            {link.label}
            {link.passcode && (
              <span className="ml-2 text-xs text-[var(--color-muted)]">
                passcode: {link.passcode}
              </span>
            )}
          </a>
          <span className="flex shrink-0 gap-2 text-xs">
            <button
              onClick={() => setEditing(link.id)}
              className="text-[var(--color-accent)] hover:underline"
            >
              Edit
            </button>
            <button
              onClick={async () => {
                await deleteCourseLink(link.id, courseId);
                refresh();
              }}
              className="text-[var(--color-muted)] hover:text-red-400"
              aria-label={`Remove ${link.label}`}
            >
              ✕
            </button>
          </span>
        </div>
        ),
      )}

      {adding ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await addCourseLink({ courseId, kind, label, url, passcode });

            if (result.ok) {
              setLabel(''); setUrl(''); setPasscode(''); setError(''); setAdding(false);
              refresh();
            } else {
              setError(result.error);
            }
          }}
          className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
              className={inputClass}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>
              ))}
            </select>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" required className={inputClass} />
          </div>

          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            type="url"
            required
            className={inputClass}
          />
          <input
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Passcode (optional)"
            className={inputClass}
          />

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Add link
            </button>
            <button type="button" onClick={() => setAdding(false)} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setAdding(true)} className="text-xs text-[var(--color-accent)] hover:underline">
          + Add link
        </button>
      )}
    </div>
  );
}

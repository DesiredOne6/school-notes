'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { addDocument, deleteDocument, getDocumentUrl } from '@/app/actions/course-hub';
import { inputClass, DOC_ICON, formatBytes } from './shared';

export type DocumentRow = {
  id: string;
  title: string;
  kind: string;
  storage_path: string | null;
  url: string | null;
  byte_size: number | null;
};

const KINDS = ['syllabus', 'slides', 'reading', 'rubric', 'other'] as const;

/** Supabase Storage rejects keys with spaces or non-ASCII characters. */
function safeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 120);
}

export function Documents({
  courseId,
  userId,
  documents,
}: {
  courseId: string;
  userId: string;
  documents: DocumentRow[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]>('syllabus');
  const [file, setFile] = useState<File | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const refresh = () => startTransition(() => router.refresh());

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      let storagePath: string | null = null;
      let mimeType: string | null = null;
      let byteSize: number | null = null;

      if (file) {
        // The first path segment must be the user id — the storage policy
        // confines each user to a folder named after their uid.
        const path = `${userId}/${courseId}/${Date.now()}-${safeFilename(file.name)}`;
        const supabase = createClient();

        // Uploading straight from the browser keeps large files off the server.
        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(path, file, { upsert: false });

        if (uploadError) throw new Error(uploadError.message);

        storagePath = path;
        mimeType = file.type || null;
        byteSize = file.size;
      }

      const result = await addDocument({
        courseId,
        title: title || file?.name || 'Untitled',
        kind,
        storagePath,
        url: linkUrl,
        mimeType,
        byteSize,
      });

      if (!result.ok) throw new Error(result.error);

      setTitle(''); setFile(null); setLinkUrl(''); setAdding(false);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function open(doc: DocumentRow) {
    if (doc.url) {
      window.open(doc.url, '_blank', 'noreferrer');
      return;
    }
    if (!doc.storage_path) return;

    // Documents live in a private bucket, so a short-lived signed URL is
    // minted on demand rather than storing a public link.
    const signed = await getDocumentUrl(doc.storage_path);
    if (signed) window.open(signed, '_blank', 'noreferrer');
    else setError('Could not open that file');
  }

  return (
    <div className="space-y-2">
      {documents.length === 0 && !adding && (
        <p className="text-xs text-[var(--color-muted)]">
          Nothing uploaded. Add the syllabus so it&apos;s always one click away.
        </p>
      )}

      {documents.map((doc) => (
        <div
          key={doc.id}
          className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
        >
          <button onClick={() => open(doc)} className="min-w-0 flex-1 text-left text-sm hover:text-[var(--color-accent)]">
            <span aria-hidden className="mr-2">{DOC_ICON[doc.kind] ?? '📎'}</span>
            {doc.title}
            <span className="ml-2 text-xs text-[var(--color-muted)]">
              {doc.url ? 'link' : formatBytes(doc.byte_size)}
            </span>
          </button>
          <button
            onClick={async () => {
              await deleteDocument(doc.id, courseId, doc.storage_path);
              refresh();
            }}
            className="shrink-0 text-xs text-[var(--color-muted)] hover:text-red-400"
            aria-label={`Remove ${doc.title}`}
          >
            ✕
          </button>
        </div>
      ))}

      {adding ? (
        <form onSubmit={submit} className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className={inputClass} />
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
              className={inputClass}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>
              ))}
            </select>
          </div>

          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-xs text-[var(--color-muted)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--color-accent)] file:px-3 file:py-1.5 file:text-sm file:text-white"
          />

          <p className="text-xs text-[var(--color-muted)]">or link to it instead:</p>
          <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" className={inputClass} />

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || (!file && !linkUrl)}
              className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? 'Uploading…' : 'Add'}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setAdding(true)} className="text-xs text-[var(--color-accent)] hover:underline">
          + Add document
        </button>
      )}
    </div>
  );
}

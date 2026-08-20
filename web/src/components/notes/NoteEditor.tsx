'use client';

import { useState, useEffect, useRef, useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createClient } from '@/lib/supabase/client';
import { updateNote, deleteNote, recordAttachment } from '@/app/actions/notes';
import { wikiLinksToMarkdown, normalizeTitle } from '@/lib/notes/wikilinks';
import { InkCanvas } from './InkCanvas';
import { drawingBounds, type InkDrawing } from '@/lib/ink/strokes';

const inputClass =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]';

/** Long enough to avoid saving mid-word, short enough to feel automatic. */
const AUTOSAVE_MS = 1200;

export type NoteRecord = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  course_id: string | null;
  updated_at: string;
};

export type TitleIndexEntry = { id: string; title: string };
export type BacklinkEntry = { id: string; title: string };

function safeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 120);
}

export function NoteEditor({
  note,
  courses,
  titleIndex,
  backlinks,
  userId,
}: {
  note: NoteRecord;
  courses: Array<{ id: string; code: string | null; title: string }>;
  titleIndex: TitleIndexEntry[];
  backlinks: BacklinkEntry[];
  userId: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [courseId, setCourseId] = useState(note.course_id ?? '');
  const [tagText, setTagText] = useState(note.tags.join(', '));
  const [preview, setPreview] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [inkOpen, setInkOpen] = useState(false);
  const [, startTransition] = useTransition();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Skips the autosave that would otherwise fire immediately on mount.
  const dirty = useRef(false);

  const save = useCallback(async () => {
    setStatus('saving');

    const result = await updateNote({
      id: note.id,
      title,
      body,
      courseId: courseId || null,
      tags: tagText.split(',').map((t) => t.trim()).filter(Boolean),
    });

    if (result.ok) {
      setStatus('saved');
      setError('');
    } else {
      setStatus('error');
      setError(result.error);
    }
  }, [note.id, title, body, courseId, tagText]);

  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(save, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [title, body, courseId, tagText, save]);

  function markDirty() {
    dirty.current = true;
    setStatus('idle');
  }

  /** Uploads an image and inserts a markdown reference at the cursor. */
  const insertImage = useCallback(
    async (file: File) => {
      setUploading(true);
      setError('');

      try {
        const path = `${userId}/${note.id}/${Date.now()}-${safeFilename(file.name || 'image.png')}`;
        const supabase = createClient();

        const { error: uploadError } = await supabase.storage
          .from('notes')
          .upload(path, file, { upsert: false });

        if (uploadError) throw new Error(uploadError.message);

        const recorded = await recordAttachment({
          noteId: note.id,
          storagePath: path,
          filename: file.name || 'image.png',
          mimeType: file.type || 'image/png',
          byteSize: file.size,
        });

        if (!recorded.ok) throw new Error(recorded.error);

        // A stable app URL, not a signed one — signed URLs expire and would
        // leave dead images inside saved markdown. The attachment id keeps it
        // short enough to read while editing.
        const markdown = `\n![${file.name || 'image'}](/api/notes/image?id=${recorded.id})\n`;

        const el = textareaRef.current;
        const at = el?.selectionStart ?? body.length;
        setBody((prev) => prev.slice(0, at) + markdown + prev.slice(at));
        markDirty();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setUploading(false);
      }
    },
    [note.id, userId, body.length],
  );

  /**
   * Saves handwriting as two files: the PNG the markdown embeds, and the
   * vector JSON beside it so the strokes stay editable rather than being
   * flattened into pixels forever.
   */
  const saveInk = useCallback(
    async (drawing: InkDrawing, png: Blob) => {
      const supabase = createClient();
      const stamp = Date.now();
      const base = `${userId}/${note.id}/ink-${stamp}`;

      const { error: pngError } = await supabase.storage
        .from('notes')
        .upload(`${base}.png`, png, { contentType: 'image/png', upsert: false });
      if (pngError) throw new Error(pngError.message);

      const vector = new Blob([JSON.stringify(drawing)], { type: 'application/json' });
      const { error: jsonError } = await supabase.storage
        .from('notes')
        .upload(`${base}.json`, vector, { contentType: 'application/json', upsert: false });
      if (jsonError) throw new Error(jsonError.message);

      const recorded = await recordAttachment({
        noteId: note.id,
        storagePath: `${base}.png`,
        filename: `handwriting-${stamp}.png`,
        mimeType: 'image/png',
        byteSize: png.size,
        kind: 'ink',
        inkMetadata: {
          vector_path: `${base}.json`,
          stroke_count: drawing.strokes.length,
          width: drawing.width,
          height: drawing.height,
          bounds: drawingBounds(drawing),
        },
      });

      if (!recorded.ok) throw new Error(recorded.error);

      const markdown = `\n![handwriting](/api/notes/image?id=${recorded.id})\n`;

      const el = textareaRef.current;
      const at = el?.selectionStart ?? body.length;
      setBody((prev) => prev.slice(0, at) + markdown + prev.slice(at));
      markDirty();
      setInkOpen(false);

      // Drop into preview so the drawing is visible immediately. Landing back
      // on a line of raw markdown after handwriting reads as if it failed.
      setPreview(true);
    },
    [note.id, userId, body.length],
  );

  const resolve = useCallback(
    (target: string) => {
      const key = normalizeTitle(target);
      return titleIndex.find((n) => normalizeTitle(n.title) === key)?.id ?? null;
    },
    [titleIndex],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/notes" className="text-xs text-[var(--color-muted)] hover:text-white">
          ← All notes
        </Link>

        <div className="flex items-center gap-3 text-xs text-[var(--color-muted)]">
          <span>
            {status === 'saving' && 'Saving…'}
            {status === 'saved' && 'Saved'}
            {status === 'error' && <span className="text-red-400">Not saved</span>}
          </span>
          <button
            title={preview ? 'Switch to the markdown source' : 'Render images, drawings, and links'}
            onClick={() => setPreview((p) => !p)}
            className="rounded-lg border border-[var(--color-border)] px-2.5 py-1 hover:border-[var(--color-accent)]"
          >
            {preview ? 'Edit' : 'Preview'}
          </button>
          <button
            onClick={async () => {
              if (!confirm('Delete this note? This cannot be undone.')) return;
              const result = await deleteNote(note.id);
              if (result.ok) {
                router.push('/notes');
                router.refresh();
              } else {
                setError(result.error);
              }
            }}
            className="rounded-lg border border-[var(--color-border)] px-2.5 py-1 hover:border-red-400 hover:text-red-400"
          >
            Delete
          </button>
        </div>
      </div>

      <input
        value={title}
        onChange={(e) => { setTitle(e.target.value); markDirty(); }}
        placeholder="Untitled"
        className="w-full bg-transparent text-2xl font-semibold tracking-tight outline-none"
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <select
          value={courseId}
          onChange={(e) => { setCourseId(e.target.value); markDirty(); }}
          className={inputClass}
        >
          <option value="">No course</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code ? `${c.code} — ${c.title}` : c.title}
            </option>
          ))}
        </select>

        <input
          value={tagText}
          onChange={(e) => { setTagText(e.target.value); markDirty(); }}
          placeholder="tags, comma separated"
          className={inputClass}
        />
      </div>

      {preview ? (
        <div className="min-h-[24rem] rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 text-sm leading-relaxed">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children, title: linkTitle }) => (
                <a
                  href={href}
                  title={linkTitle ?? undefined}
                  className={
                    linkTitle === 'Note not created yet'
                      ? 'text-amber-400 underline decoration-dotted'
                      : 'text-[var(--color-accent)] hover:underline'
                  }
                >
                  {children}
                </a>
              ),
              img: ({ src, alt }) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={typeof src === 'string' ? src : ''}
                  alt={alt ?? ''}
                  className="my-3 max-w-full rounded-lg"
                />
              ),
              h1: ({ children }) => <h1 className="mb-2 mt-4 text-xl font-semibold">{children}</h1>,
              h2: ({ children }) => <h2 className="mb-2 mt-4 text-lg font-semibold">{children}</h2>,
              h3: ({ children }) => <h3 className="mb-1 mt-3 font-semibold">{children}</h3>,
              ul: ({ children }) => <ul className="my-2 list-disc pl-5">{children}</ul>,
              ol: ({ children }) => <ol className="my-2 list-decimal pl-5">{children}</ol>,
              p: ({ children }) => <p className="my-2">{children}</p>,
              code: ({ children }) => (
                <code className="rounded bg-[var(--color-surface)] px-1 py-0.5 text-xs">{children}</code>
              ),
              blockquote: ({ children }) => (
                <blockquote className="my-2 border-l-2 border-[var(--color-border)] pl-3 text-[var(--color-muted)]">
                  {children}
                </blockquote>
              ),
              table: ({ children }) => (
                <div className="my-3 overflow-x-auto">
                  <table className="w-full text-left text-xs">{children}</table>
                </div>
              ),
              th: ({ children }) => <th className="border-b border-[var(--color-border)] p-1.5">{children}</th>,
              td: ({ children }) => <td className="border-b border-[var(--color-border)] p-1.5">{children}</td>,
            }}
          >
            {wikiLinksToMarkdown(body, resolve)}
          </ReactMarkdown>
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => { setBody(e.target.value); markDirty(); }}
          onPaste={(e) => {
            const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'));
            if (file) {
              e.preventDefault();
              void insertImage(file);
            }
          }}
          onDrop={(e) => {
            const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
            if (file) {
              e.preventDefault();
              void insertImage(file);
            }
          }}
          placeholder="Write in markdown. Link other notes with [[double brackets]]. Paste or drop an image to attach it."
          spellCheck
          className="min-h-[24rem] w-full resize-y rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 font-mono text-sm leading-relaxed outline-none focus:border-[var(--color-accent)]"
        />
      )}

      {!preview && !inkOpen && (
        <button
          onClick={() => setInkOpen(true)}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:border-[var(--color-accent)]"
        >
          ✍️ Add handwriting
        </button>
      )}

      {inkOpen && (
        <InkCanvas onSave={saveInk} onCancel={() => setInkOpen(false)} />
      )}

      {uploading && <p className="text-xs text-[var(--color-muted)]">Uploading image…</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={() => { void save(); startTransition(() => router.refresh()); }}
          className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
        >
          Save now
        </button>
        <span className="text-xs text-[var(--color-muted)]">Autosaves as you type.</span>
      </div>

      {backlinks.length > 0 && (
        <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Linked from
          </h2>
          <ul className="mt-2 space-y-1">
            {backlinks.map((b) => (
              <li key={b.id}>
                <Link href={`/notes/${b.id}`} className="text-sm text-[var(--color-accent)] hover:underline">
                  {b.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

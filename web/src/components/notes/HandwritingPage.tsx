'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { InkSurface, type InkSurfaceHandle, type InkBackground } from './InkSurface';
import { InkToolbar, INK_COLORS, INK_WIDTHS } from './InkToolbar';
import { saveInkPage, renameNote } from '@/app/actions/ink';
import { deleteNote } from '@/app/actions/notes';
import {
  emptyDrawing,
  simplifyDrawing,
  estimateSize,
  type InkDrawing,
  type InkStroke,
  type InkTool,
} from '@/lib/ink/strokes';

/** Roughly a screen of writing; the page grows from here. */
const INITIAL_HEIGHT = 1200;
const PAGE_INCREMENT = 800;
const AUTOSAVE_MS = 2000;

export function HandwritingPage({
  noteId,
  initialTitle,
  initialDrawing,
  initialBackground,
  userId,
}: {
  noteId: string;
  initialTitle: string;
  initialDrawing: InkDrawing | null;
  initialBackground: InkBackground;
  userId: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [drawing, setDrawing] = useState<InkDrawing>(
    initialDrawing ?? emptyDrawing(1200, INITIAL_HEIGHT),
  );
  const [height, setHeight] = useState(initialDrawing?.height ?? INITIAL_HEIGHT);
  const [background, setBackground] = useState<InkBackground>(initialBackground);
  const [tool, setTool] = useState<InkTool>('pen');
  const [color, setColor] = useState(INK_COLORS[0]);
  const [width, setWidth] = useState(INK_WIDTHS[1]);
  const [penSeen, setPenSeen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');

  const surface = useRef<InkSurfaceHandle | null>(null);
  const undone = useRef<InkStroke[]>([]);
  const dirty = useRef(false);

  const save = useCallback(async () => {
    setStatus('saving');
    setError('');

    try {
      const supabase = createClient();
      // Fixed paths, overwritten in place: a page has one drawing, and
      // autosave must not accumulate a file per keystroke.
      const base = `${userId}/${noteId}/page`;

      const simplified = simplifyDrawing({ ...drawing, height });
      const png = await surface.current!.toPng();

      const { error: pngError } = await supabase.storage
        .from('notes')
        .upload(`${base}.png`, png, { contentType: 'image/png', upsert: true });
      if (pngError) throw new Error(pngError.message);

      const vector = new Blob([JSON.stringify(simplified)], { type: 'application/json' });
      const { error: jsonError } = await supabase.storage
        .from('notes')
        .upload(`${base}.json`, vector, { contentType: 'application/json', upsert: true });
      if (jsonError) throw new Error(jsonError.message);

      const result = await saveInkPage({
        noteId,
        pngPath: `${base}.png`,
        vectorPath: `${base}.json`,
        strokeCount: simplified.strokes.length,
        width: simplified.width,
        height,
        background,
        byteSize: png.size,
      });

      if (!result.ok) throw new Error(result.error);

      setStatus('saved');
    } catch (err) {
      setStatus('error');
      setError((err as Error).message);
    }
  }, [drawing, height, background, noteId, userId]);

  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(save, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [drawing, height, background, save]);

  // Warn before losing an unsaved stroke on navigation away.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (status === 'saving' || dirty.current) {
        if (status !== 'saved') e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [status]);

  function change(next: InkDrawing) {
    dirty.current = true;
    setStatus('idle');
    undone.current = [];
    setDrawing(next);
  }

  function undo() {
    setDrawing((d) => {
      if (d.strokes.length === 0) return d;
      undone.current.push(d.strokes[d.strokes.length - 1]);
      dirty.current = true;
      setStatus('idle');
      return { ...d, strokes: d.strokes.slice(0, -1) };
    });
  }

  function redo() {
    const stroke = undone.current.pop();
    if (!stroke) return;
    dirty.current = true;
    setStatus('idle');
    setDrawing((d) => ({ ...d, strokes: [...d.strokes, stroke] }));
  }

  return (
    <div className="space-y-3">
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
            onClick={() => void save()}
            className="rounded-lg border border-[var(--color-border)] px-2.5 py-1 hover:border-[var(--color-accent)]"
          >
            Save now
          </button>
          <button
            onClick={async () => {
              if (!confirm('Delete this page? This cannot be undone.')) return;
              const result = await deleteNote(noteId);
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
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => void renameNote(noteId, title)}
        placeholder="Untitled page"
        className="w-full bg-transparent text-2xl font-semibold tracking-tight outline-none"
      />

      {/* Sticky so the tools stay reachable while writing down a long page. */}
      <div className="sticky top-0 z-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-2">
        <InkToolbar
          tool={tool} setTool={setTool}
          color={color} setColor={setColor}
          width={width} setWidth={setWidth}
          onUndo={undo} onRedo={redo}
          background={background}
          setBackground={(b) => { dirty.current = true; setBackground(b); }}
        />
      </div>

      <InkSurface
        drawing={drawing}
        onDrawingChange={change}
        tool={tool}
        color={color}
        width={width}
        height={height}
        background={background}
        handleRef={surface}
        penSeen={penSeen}
        onPenDetected={() => setPenSeen(true)}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--color-muted)]">
          {drawing.strokes.length} stroke{drawing.strokes.length === 1 ? '' : 's'} ·{' '}
          {(estimateSize(drawing) / 1024).toFixed(1)} KB
          {penSeen && ' · pen detected, palm rejection on'}
        </p>

        <button
          onClick={() => { dirty.current = true; setHeight((h) => h + PAGE_INCREMENT); }}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:border-[var(--color-accent)]"
        >
          + Add space
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

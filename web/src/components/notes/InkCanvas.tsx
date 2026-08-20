'use client';

import { useRef, useState } from 'react';
import { InkSurface, type InkSurfaceHandle } from './InkSurface';
import { InkToolbar, INK_COLORS, INK_WIDTHS } from './InkToolbar';
import {
  emptyDrawing,
  simplifyDrawing,
  estimateSize,
  type InkDrawing,
  type InkStroke,
  type InkTool,
} from '@/lib/ink/strokes';

export type InkCanvasProps = {
  initial?: InkDrawing | null;
  height?: number;
  onSave: (drawing: InkDrawing, png: Blob) => Promise<void>;
  onCancel: () => void;
};

/** The inline "insert a drawing into this note" flow. */
export function InkCanvas({ initial, height = 420, onSave, onCancel }: InkCanvasProps) {
  const [drawing, setDrawing] = useState<InkDrawing>(initial ?? emptyDrawing(1200, height));
  const [tool, setTool] = useState<InkTool>('pen');
  const [color, setColor] = useState(INK_COLORS[0]);
  const [width, setWidth] = useState(INK_WIDTHS[1]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [penSeen, setPenSeen] = useState(false);

  const surface = useRef<InkSurfaceHandle | null>(null);
  const undone = useRef<InkStroke[]>([]);

  function change(next: InkDrawing) {
    undone.current = [];
    setDrawing(next);
  }

  function undo() {
    setDrawing((d) => {
      if (d.strokes.length === 0) return d;
      undone.current.push(d.strokes[d.strokes.length - 1]);
      return { ...d, strokes: d.strokes.slice(0, -1) };
    });
  }

  function redo() {
    const stroke = undone.current.pop();
    if (stroke) setDrawing((d) => ({ ...d, strokes: [...d.strokes, stroke] }));
  }

  async function save() {
    setSaving(true);
    setError('');

    try {
      const png = await surface.current!.toPng();
      // Simplify before storing: a pen emits far more points than the shape needs.
      await onSave(simplifyDrawing(drawing), png);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
      <InkToolbar
        tool={tool} setTool={setTool}
        color={color} setColor={setColor}
        width={width} setWidth={setWidth}
        onUndo={undo} onRedo={redo}
      />

      <InkSurface
        drawing={drawing}
        onDrawingChange={change}
        tool={tool}
        color={color}
        width={width}
        height={height}
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

        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={saving || drawing.strokes.length === 0}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Insert drawing'}
          </button>
          <button onClick={onCancel} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm">
            Cancel
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  emptyDrawing,
  pressureToWidth,
  eraseAt,
  simplifyDrawing,
  estimateSize,
  DEFAULT_PRESSURE,
  type InkDrawing,
  type InkStroke,
  type InkTool,
  type InkPoint,
} from '@/lib/ink/strokes';

const COLORS = ['#e9e9f0', '#7c7cf5', '#f59e0b', '#10b981', '#ef4444', '#0ea5e9'];
const WIDTHS = [1.5, 3, 6, 10];
const ERASER_RADIUS = 12;

/** Highlighter needs to sit behind and blend, so it gets its own alpha. */
const HIGHLIGHTER_ALPHA = 0.35;
const HIGHLIGHTER_WIDTH_MULTIPLIER = 4;

export type InkCanvasProps = {
  initial?: InkDrawing | null;
  height?: number;
  onSave: (drawing: InkDrawing, png: Blob) => Promise<void>;
  onCancel: () => void;
};

function drawStroke(ctx: CanvasRenderingContext2D, stroke: InkStroke) {
  const points = stroke.points;
  if (points.length === 0) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke.color;
  ctx.globalAlpha = stroke.tool === 'highlighter' ? HIGHLIGHTER_ALPHA : 1;

  const widthFor = (p: number) =>
    pressureToWidth(p, stroke.width) *
    (stroke.tool === 'highlighter' ? HIGHLIGHTER_WIDTH_MULTIPLIER : 1);

  // A single tap should still leave a dot.
  if (points.length === 1) {
    ctx.fillStyle = stroke.color;
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, widthFor(points[0].p) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // Each segment is drawn separately so its width can follow pressure.
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];

    ctx.beginPath();
    ctx.lineWidth = widthFor((a.p + b.p) / 2);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.restore();
}

export function InkCanvas({ initial, height = 420, onSave, onCancel }: InkCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [drawing, setDrawing] = useState<InkDrawing>(initial ?? emptyDrawing(1200, height));
  const [tool, setTool] = useState<InkTool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [penSeen, setPenSeen] = useState(false);

  // Live stroke lives in a ref: re-rendering React on every pointer sample
  // would drop points and make the line lag behind the pen.
  const active = useRef<InkStroke | null>(null);
  const undone = useRef<InkStroke[]>([]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    // Highlighter first, so ink sits on top of it the way real pens do.
    for (const stroke of drawing.strokes) {
      if (stroke.tool === 'highlighter') drawStroke(ctx, stroke);
    }
    for (const stroke of drawing.strokes) {
      if (stroke.tool !== 'highlighter') drawStroke(ctx, stroke);
    }
    if (active.current) drawStroke(ctx, active.current);
  }, [drawing]);

  // Size the backing store to the device pixel ratio, or lines look soft.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${height}px`;
      setDrawing((d) => ({ ...d, width: Math.round(rect.width), height }));
      redraw();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [height, redraw]);

  useEffect(redraw, [redraw]);

  function toLocal(event: React.PointerEvent): InkPoint {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      // Mice report 0 while down; treat that as neutral rather than invisible.
      p: event.pressure > 0 ? event.pressure : DEFAULT_PRESSURE,
    };
  }

  /**
   * Ignores finger input once a pen has been used, so a palm resting on the
   * screen doesn't draw. Mouse and touch still work on devices without a pen.
   */
  function shouldIgnore(event: React.PointerEvent): boolean {
    return penSeen && event.pointerType === 'touch';
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === 'pen') setPenSeen(true);
    if (shouldIgnore(event)) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toLocal(event);

    if (tool === 'eraser') {
      setDrawing((d) => eraseAt(d, point.x, point.y, ERASER_RADIUS));
      active.current = { tool: 'eraser', color, width, points: [point] };
      return;
    }

    undone.current = [];
    active.current = { tool, color, width, points: [point] };
    redraw();
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!active.current || shouldIgnore(event)) return;

    if (active.current.tool === 'eraser') {
      const point = toLocal(event);
      setDrawing((d) => eraseAt(d, point.x, point.y, ERASER_RADIUS));
      return;
    }

    // Coalesced events expose every sample the digitiser captured between
    // frames — the difference between smooth handwriting and visible corners.
    const events =
      typeof event.nativeEvent.getCoalescedEvents === 'function'
        ? event.nativeEvent.getCoalescedEvents()
        : [event.nativeEvent];

    const rect = canvasRef.current!.getBoundingClientRect();
    for (const sample of events.length > 0 ? events : [event.nativeEvent]) {
      active.current.points.push({
        x: sample.clientX - rect.left,
        y: sample.clientY - rect.top,
        p: sample.pressure > 0 ? sample.pressure : DEFAULT_PRESSURE,
      });
    }

    redraw();
  }

  function onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!active.current) return;

    const finished = active.current;
    active.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (finished.tool === 'eraser' || finished.points.length === 0) {
      redraw();
      return;
    }

    setDrawing((d) => ({ ...d, strokes: [...d.strokes, finished] }));
  }

  function undo() {
    setDrawing((d) => {
      if (d.strokes.length === 0) return d;
      const strokes = d.strokes.slice(0, -1);
      undone.current.push(d.strokes[d.strokes.length - 1]);
      return { ...d, strokes };
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
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('Canvas is not ready');

      // Simplify before storing: a pen emits far more points than the shape needs.
      const simplified = simplifyDrawing(drawing);

      const png = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
      );
      if (!png) throw new Error('Could not render the drawing');

      await onSave(simplified, png);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const buttonClass =
    'rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-xs hover:border-[var(--color-accent)]';
  const activeClass = 'rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent)]/20 px-2.5 py-1 text-xs';

  return (
    <div className="space-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setTool('pen')} className={tool === 'pen' ? activeClass : buttonClass}>
          ✏️ Pen
        </button>
        <button
          onClick={() => setTool('highlighter')}
          className={tool === 'highlighter' ? activeClass : buttonClass}
        >
          🖍 Highlighter
        </button>
        <button onClick={() => setTool('eraser')} className={tool === 'eraser' ? activeClass : buttonClass}>
          ⌫ Eraser
        </button>

        <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />

        {COLORS.map((c) => (
          <button
            key={c}
            aria-label={`Colour ${c}`}
            onClick={() => setColor(c)}
            style={{ background: c }}
            className={`h-5 w-5 rounded-full ${
              color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-[var(--color-panel)]' : ''
            }`}
          />
        ))}

        <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />

        {WIDTHS.map((w) => (
          <button
            key={w}
            aria-label={`Width ${w}`}
            onClick={() => setWidth(w)}
            className={width === w ? activeClass : buttonClass}
          >
            <span
              className="inline-block rounded-full bg-current align-middle"
              style={{ width: w * 2, height: w * 2 }}
            />
          </button>
        ))}

        <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />

        <button onClick={undo} className={buttonClass}>↶ Undo</button>
        <button onClick={redo} className={buttonClass}>↷ Redo</button>
      </div>

      <div ref={wrapRef} className="w-full">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onPointerCancel={onPointerUp}
          // Without this the browser scrolls instead of drawing.
          className="w-full touch-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
          style={{ height }}
        />
      </div>

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

'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, type RefObject } from 'react';
import {
  pressureToWidth,
  eraseAt,
  DEFAULT_PRESSURE,
  type InkDrawing,
  type InkStroke,
  type InkTool,
  type InkPoint,
} from '@/lib/ink/strokes';

const ERASER_RADIUS = 12;
const HIGHLIGHTER_ALPHA = 0.35;
const HIGHLIGHTER_WIDTH_MULTIPLIER = 4;

export type InkBackground = 'blank' | 'ruled' | 'grid';

/** Spacing of ruled lines / grid squares, in CSS pixels. */
const RULE_SPACING = 32;

export type InkSurfaceHandle = {
  /** Renders the current drawing to a PNG blob. */
  toPng: () => Promise<Blob>;
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

function drawBackground(
  ctx: CanvasRenderingContext2D,
  background: InkBackground,
  width: number,
  height: number,
) {
  if (background === 'blank') return;

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;

  for (let y = RULE_SPACING; y < height; y += RULE_SPACING) {
    ctx.beginPath();
    // Half-pixel offset keeps hairlines crisp instead of blurring across two.
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }

  if (background === 'grid') {
    for (let x = RULE_SPACING; x < width; x += RULE_SPACING) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * The drawing surface: pointer capture, stroke rendering, and erasing.
 *
 * Toolbar state and persistence live with the parent, so the same surface backs
 * both the inline insert flow and a full-page handwritten note.
 */
export function InkSurface({
  drawing,
  onDrawingChange,
  tool,
  color,
  width,
  height,
  background = 'blank',
  handleRef,
  onPenDetected,
  penSeen,
}: {
  drawing: InkDrawing;
  onDrawingChange: (next: InkDrawing) => void;
  tool: InkTool;
  color: string;
  width: number;
  height: number;
  background?: InkBackground;
  handleRef?: RefObject<InkSurfaceHandle | null>;
  onPenDetected?: () => void;
  penSeen?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // The live stroke lives in a ref: re-rendering React on every pointer sample
  // would drop points and make the line lag behind the pen.
  const active = useRef<InkStroke | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cssWidth = canvas.width / dpr;
    const cssHeight = canvas.height / dpr;

    ctx.clearRect(0, 0, cssWidth, cssHeight);
    drawBackground(ctx, background, cssWidth, cssHeight);

    // Highlighter first, so ink sits on top of it the way real pens do.
    for (const stroke of drawing.strokes) {
      if (stroke.tool === 'highlighter') drawStroke(ctx, stroke);
    }
    for (const stroke of drawing.strokes) {
      if (stroke.tool !== 'highlighter') drawStroke(ctx, stroke);
    }
    if (active.current) drawStroke(ctx, active.current);
  }, [drawing, background]);

  useImperativeHandle(handleRef, () => ({
    toPng: () =>
      new Promise<Blob>((resolve, reject) => {
        const canvas = canvasRef.current;
        if (!canvas) return reject(new Error('Canvas is not ready'));
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('Could not render the drawing'))),
          'image/png',
        );
      }),
  }));

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
    return Boolean(penSeen) && event.pointerType === 'touch';
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === 'pen') onPenDetected?.();
    if (shouldIgnore(event)) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toLocal(event);

    if (tool === 'eraser') {
      onDrawingChange(eraseAt(drawing, point.x, point.y, ERASER_RADIUS));
      active.current = { tool: 'eraser', color, width, points: [point] };
      return;
    }

    active.current = { tool, color, width, points: [point] };
    redraw();
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!active.current || shouldIgnore(event)) return;

    if (active.current.tool === 'eraser') {
      const point = toLocal(event);
      onDrawingChange(eraseAt(drawing, point.x, point.y, ERASER_RADIUS));
      return;
    }

    // Coalesced events expose every sample the digitiser captured between
    // frames — the difference between smooth handwriting and visible corners.
    const samples =
      typeof event.nativeEvent.getCoalescedEvents === 'function'
        ? event.nativeEvent.getCoalescedEvents()
        : [event.nativeEvent];

    const rect = canvasRef.current!.getBoundingClientRect();
    for (const sample of samples.length > 0 ? samples : [event.nativeEvent]) {
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

    onDrawingChange({ ...drawing, strokes: [...drawing.strokes, finished] });
  }

  return (
    <div ref={wrapRef} className="w-full">
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerCancel={onPointerUp}
        // Without touch-none the browser scrolls instead of drawing.
        className="w-full touch-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
        style={{ height }}
      />
    </div>
  );
}

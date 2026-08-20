/**
 * Stroke model for handwriting.
 *
 * Strokes are stored as vectors rather than pixels: they stay sharp at any
 * zoom, are a fraction of the size of a bitmap, and remain editable later.
 * A PNG is rendered alongside them purely for embedding in markdown.
 *
 * Pressure comes from the Pointer Events API, which surfaces it for the S Pen
 * on Windows Ink and for Apple Pencil in Safari alike — so this works on the
 * Galaxy Book without anything platform-specific.
 */

export type InkPoint = {
  x: number;
  y: number;
  /** Pointer pressure, 0–1. Devices without pressure report 0.5. */
  p: number;
};

export type InkTool = 'pen' | 'highlighter' | 'eraser';

export type InkStroke = {
  tool: InkTool;
  color: string;
  /** Base width in px, before pressure is applied. */
  width: number;
  points: InkPoint[];
};

export type InkDrawing = {
  version: 1;
  width: number;
  height: number;
  strokes: InkStroke[];
};

export const DEFAULT_PRESSURE = 0.5;

export function emptyDrawing(width: number, height: number): InkDrawing {
  return { version: 1, width, height, strokes: [] };
}

/**
 * Width at a point. Pressure modulates between 40% and 140% of the base width,
 * which is enough variation to look like handwriting without the line breaking
 * up when a device reports no pressure at all.
 */
export function pressureToWidth(pressure: number, baseWidth: number): number {
  const clamped = Math.min(1, Math.max(0, pressure));
  return baseWidth * (0.4 + clamped);
}

/** Bounding box of a set of points, or null when there are none. */
export function strokeBounds(
  stroke: InkStroke,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (stroke.points.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  // Half the widest possible line, so the box covers the ink, not just centres.
  const pad = pressureToWidth(1, stroke.width) / 2;

  for (const point of stroke.points) {
    minX = Math.min(minX, point.x - pad);
    minY = Math.min(minY, point.y - pad);
    maxX = Math.max(maxX, point.x + pad);
    maxY = Math.max(maxY, point.y + pad);
  }

  return { minX, minY, maxX, maxY };
}

export function drawingBounds(
  drawing: InkDrawing,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let box: { minX: number; minY: number; maxX: number; maxY: number } | null = null;

  for (const stroke of drawing.strokes) {
    const b = strokeBounds(stroke);
    if (!b) continue;

    box = box
      ? {
          minX: Math.min(box.minX, b.minX),
          minY: Math.min(box.minY, b.minY),
          maxX: Math.max(box.maxX, b.maxX),
          maxY: Math.max(box.maxY, b.maxY),
        }
      : b;
  }

  return box;
}

/** Perpendicular distance from `point` to the line through `a` and `b`. */
function perpendicularDistance(point: InkPoint, a: InkPoint, b: InkPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  // Degenerate segment: fall back to plain distance from the shared endpoint.
  if (dx === 0 && dy === 0) return Math.hypot(point.x - a.x, point.y - a.y);

  const numerator = Math.abs(dy * point.x - dx * point.y + b.x * a.y - b.y * a.x);
  return numerator / Math.hypot(dx, dy);
}

/**
 * Ramer–Douglas–Peucker simplification.
 *
 * A pen emits hundreds of points per second, most of which sit on a line
 * already. Dropping them cuts the stored size dramatically with no visible
 * change. Endpoints are always kept.
 */
export function simplify(points: InkPoint[], tolerance = 0.7): InkPoint[] {
  if (points.length <= 2) return [...points];

  let maxDistance = 0;
  let index = 0;

  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }

  if (maxDistance <= tolerance) {
    return [points[0], points[points.length - 1]];
  }

  const left = simplify(points.slice(0, index + 1), tolerance);
  const right = simplify(points.slice(index), tolerance);

  // `index` appears in both halves; drop the duplicate.
  return [...left.slice(0, -1), ...right];
}

export function simplifyDrawing(drawing: InkDrawing, tolerance = 0.7): InkDrawing {
  return {
    ...drawing,
    strokes: drawing.strokes.map((stroke) => ({
      ...stroke,
      points: simplify(stroke.points, tolerance),
    })),
  };
}

/**
 * True when a stroke passes within `radius` of a point — the hit test the
 * eraser uses. Checks segments, not just recorded points, so erasing works on
 * a long straight line whose middle has been simplified away.
 */
export function strokeIntersects(
  stroke: InkStroke,
  x: number,
  y: number,
  radius: number,
): boolean {
  const points = stroke.points;
  if (points.length === 0) return false;

  if (points.length === 1) {
    return Math.hypot(points[0].x - x, points[0].y - y) <= radius;
  }

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;

    // Project the point onto the segment, clamped to its ends.
    const t =
      lengthSquared === 0
        ? 0
        : Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared));

    const closestX = a.x + t * dx;
    const closestY = a.y + t * dy;

    if (Math.hypot(closestX - x, closestY - y) <= radius) return true;
  }

  return false;
}

/** Removes strokes touched by an eraser at this position. */
export function eraseAt(drawing: InkDrawing, x: number, y: number, radius: number): InkDrawing {
  const kept = drawing.strokes.filter((stroke) => !strokeIntersects(stroke, x, y, radius));
  return kept.length === drawing.strokes.length ? drawing : { ...drawing, strokes: kept };
}

/** Rough byte size of the serialised drawing, for storage feedback. */
export function estimateSize(drawing: InkDrawing): number {
  return JSON.stringify(drawing).length;
}

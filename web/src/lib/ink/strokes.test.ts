import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  pressureToWidth,
  strokeBounds,
  drawingBounds,
  simplify,
  simplifyDrawing,
  strokeIntersects,
  eraseAt,
  emptyDrawing,
  type InkStroke,
  type InkPoint,
} from '@/lib/ink/strokes';

function stroke(points: Array<[number, number, number?]>, overrides: Partial<InkStroke> = {}): InkStroke {
  return {
    tool: 'pen',
    color: '#ffffff',
    width: 2,
    points: points.map(([x, y, p]) => ({ x, y, p: p ?? 0.5 })),
    ...overrides,
  };
}

test('pressure scales width between 40% and 140% of the base', () => {
  assert.equal(pressureToWidth(0, 10), 4);
  assert.equal(pressureToWidth(0.5, 10), 9);
  assert.equal(pressureToWidth(1, 10), 14);
});

test('pressure outside 0-1 is clamped rather than distorting the line', () => {
  assert.equal(pressureToWidth(-3, 10), 4);
  assert.equal(pressureToWidth(99, 10), 14);
});

test('stroke bounds include the line width, not just the centre points', () => {
  const box = strokeBounds(stroke([[10, 10], [20, 20]], { width: 4 }));
  // Widest possible line is 4 * 1.4 = 5.6, so the box grows by 2.8 each side.
  assert.ok(box);
  assert.equal(box.minX, 10 - 2.8);
  assert.equal(box.maxY, 20 + 2.8);
});

test('bounds of an empty stroke are null', () => {
  assert.equal(strokeBounds(stroke([])), null);
  assert.equal(drawingBounds(emptyDrawing(100, 100)), null);
});

test('drawing bounds span every stroke', () => {
  const box = drawingBounds({
    version: 1, width: 500, height: 500,
    strokes: [stroke([[10, 10]], { width: 0 }), stroke([[100, 200]], { width: 0 })],
  });
  assert.deepEqual(box, { minX: 10, minY: 10, maxX: 100, maxY: 200 });
});

test('simplify drops collinear points but keeps the endpoints', () => {
  const line: InkPoint[] = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0, p: 0.5 }));
  const result = simplify(line, 0.7);

  assert.equal(result.length, 2, 'a straight line needs only its endpoints');
  assert.deepEqual(result[0], { x: 0, y: 0, p: 0.5 });
  assert.deepEqual(result[1], { x: 49, y: 0, p: 0.5 });
});

test('simplify preserves a genuine corner', () => {
  const corner: InkPoint[] = [
    { x: 0, y: 0, p: 0.5 },
    { x: 10, y: 0, p: 0.5 },
    { x: 20, y: 0, p: 0.5 },
    { x: 20, y: 20, p: 0.5 },
    { x: 20, y: 40, p: 0.5 },
  ];
  const result = simplify(corner, 0.7);

  assert.equal(result.length, 3, 'both ends plus the corner');
  assert.deepEqual(result[1], { x: 20, y: 0, p: 0.5 });
});

test('simplify never produces duplicate junction points', () => {
  const zigzag: InkPoint[] = [
    { x: 0, y: 0, p: 0.5 }, { x: 10, y: 30, p: 0.5 }, { x: 20, y: 0, p: 0.5 },
    { x: 30, y: 30, p: 0.5 }, { x: 40, y: 0, p: 0.5 },
  ];
  const result = simplify(zigzag, 0.5);

  const seen = new Set(result.map((p) => `${p.x},${p.y}`));
  assert.equal(seen.size, result.length, 'no point should repeat');
});

test('simplify leaves one- and two-point strokes alone', () => {
  assert.equal(simplify([{ x: 1, y: 1, p: 0.5 }]).length, 1);
  assert.equal(simplify([{ x: 1, y: 1, p: 0.5 }, { x: 2, y: 2, p: 0.5 }]).length, 2);
  assert.equal(simplify([]).length, 0);
});

test('simplifyDrawing shrinks a dense capture substantially', () => {
  const dense = {
    version: 1 as const, width: 800, height: 600,
    strokes: [stroke(Array.from({ length: 300 }, (_, i) => [i, Math.round(i / 100)] as [number, number]))],
  };

  const before = dense.strokes[0].points.length;
  const after = simplifyDrawing(dense).strokes[0].points.length;

  assert.equal(before, 300);
  assert.ok(after < 20, `expected heavy reduction, got ${after} points`);
});

test('the eraser hits a segment, not only recorded points', () => {
  // Two points 100px apart: the midpoint is not a recorded point.
  const line = stroke([[0, 0], [100, 0]]);

  assert.equal(strokeIntersects(line, 50, 0, 5), true, 'midpoint of the segment');
  assert.equal(strokeIntersects(line, 50, 3, 5), true, 'just off the line');
  assert.equal(strokeIntersects(line, 50, 40, 5), false, 'far from the line');
});

test('the eraser hits a single-point dot', () => {
  const dot = stroke([[10, 10]]);
  assert.equal(strokeIntersects(dot, 12, 12, 5), true);
  assert.equal(strokeIntersects(dot, 40, 40, 5), false);
});

test('erasing removes only the strokes touched', () => {
  const drawing = {
    version: 1 as const, width: 400, height: 400,
    strokes: [stroke([[0, 0], [100, 0]]), stroke([[0, 200], [100, 200]])],
  };

  const after = eraseAt(drawing, 50, 0, 6);
  assert.equal(after.strokes.length, 1);
  assert.equal(after.strokes[0].points[0].y, 200, 'the far stroke survives');
});

test('erasing nothing returns the same object, avoiding a needless re-render', () => {
  const drawing = {
    version: 1 as const, width: 400, height: 400,
    strokes: [stroke([[0, 0], [100, 0]])],
  };
  assert.equal(eraseAt(drawing, 300, 300, 5), drawing);
});

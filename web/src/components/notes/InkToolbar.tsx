'use client';

import type { InkTool } from '@/lib/ink/strokes';
import type { InkBackground } from './InkSurface';

export const INK_COLORS = ['#e9e9f0', '#7c7cf5', '#f59e0b', '#10b981', '#ef4444', '#0ea5e9'];
export const INK_WIDTHS = [1.5, 3, 6, 10];

const buttonClass =
  'rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-xs hover:border-[var(--color-accent)]';
const activeClass =
  'rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent)]/20 px-2.5 py-1 text-xs';

export function InkToolbar({
  tool, setTool, color, setColor, width, setWidth,
  onUndo, onRedo, background, setBackground,
}: {
  tool: InkTool;
  setTool: (t: InkTool) => void;
  color: string;
  setColor: (c: string) => void;
  width: number;
  setWidth: (w: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  background?: InkBackground;
  setBackground?: (b: InkBackground) => void;
}) {
  return (
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

      {INK_COLORS.map((c) => (
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

      {INK_WIDTHS.map((w) => (
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

      <button onClick={onUndo} className={buttonClass}>↶ Undo</button>
      <button onClick={onRedo} className={buttonClass}>↷ Redo</button>

      {setBackground && (
        <>
          <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
          <select
            value={background}
            onChange={(e) => setBackground(e.target.value as InkBackground)}
            aria-label="Page background"
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs outline-none"
          >
            <option value="blank">Blank</option>
            <option value="ruled">Ruled</option>
            <option value="grid">Grid</option>
          </select>
        </>
      )}
    </div>
  );
}

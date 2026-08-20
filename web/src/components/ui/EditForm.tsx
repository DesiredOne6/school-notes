'use client';

import { useState } from 'react';

/**
 * A small field-driven form, so every editable object gets the same inputs,
 * validation feedback, and keyboard behaviour instead of seven hand-rolled
 * variants that drift apart.
 */

export type FieldValue = string | number | boolean | number[] | null;

export type Field =
  | { name: string; label: string; type: 'text' | 'email' | 'url' | 'time' | 'date'; placeholder?: string; required?: boolean; span?: 1 | 2 }
  | { name: string; label: string; type: 'number'; min?: number; step?: number; required?: boolean; span?: 1 | 2 }
  | { name: string; label: string; type: 'textarea'; placeholder?: string; rows?: number; span?: 1 | 2 }
  | { name: string; label: string; type: 'select'; options: Array<{ value: string; label: string }>; required?: boolean; span?: 1 | 2 }
  | { name: string; label: string; type: 'color'; options: string[]; span?: 1 | 2 }
  | { name: string; label: string; type: 'weekdays'; span?: 1 | 2 }
  | { name: string; label: string; type: 'checkbox'; span?: 1 | 2 };

const inputClass =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]';

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

export function EditForm({
  fields,
  initial,
  onSave,
  onCancel,
  saveLabel = 'Save',
}: {
  fields: Field[];
  initial: Record<string, FieldValue>;
  onSave: (values: Record<string, FieldValue>) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
  saveLabel?: string;
}) {
  const [values, setValues] = useState<Record<string, FieldValue>>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function set(name: string, value: FieldValue) {
    setValues((v) => ({ ...v, [name]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');

    const result = await onSave(values);

    setBusy(false);
    if (!result.ok) setError(result.error ?? 'Could not save');
  }

  return (
    <form
      onSubmit={submit}
      // Escape cancels, which is what anyone expects from an inline editor.
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
      className="space-y-3 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-surface)] p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => {
          const spanClass = field.span === 2 ? 'sm:col-span-2' : '';

          return (
            <label key={field.name} className={`block ${spanClass}`}>
              <span className="mb-1 block text-xs text-[var(--color-muted)]">{field.label}</span>

              {field.type === 'textarea' && (
                <textarea
                  value={String(values[field.name] ?? '')}
                  onChange={(e) => set(field.name, e.target.value)}
                  placeholder={field.placeholder}
                  rows={field.rows ?? 2}
                  className={inputClass}
                />
              )}

              {field.type === 'select' && (
                <select
                  value={String(values[field.name] ?? '')}
                  onChange={(e) => set(field.name, e.target.value)}
                  required={field.required}
                  className={inputClass}
                >
                  {field.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              )}

              {field.type === 'color' && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {field.options.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Colour ${c}`}
                      onClick={() => set(field.name, c)}
                      style={{ background: c }}
                      className={`h-6 w-6 rounded-full ${
                        values[field.name] === c
                          ? 'ring-2 ring-white ring-offset-2 ring-offset-[var(--color-surface)]'
                          : ''
                      }`}
                    />
                  ))}
                </div>
              )}

              {field.type === 'weekdays' && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {DAYS.map((d) => {
                    const current = (values[field.name] as number[]) ?? [];
                    const on = current.includes(d.value);
                    return (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() =>
                          set(
                            field.name,
                            on ? current.filter((v) => v !== d.value) : [...current, d.value],
                          )
                        }
                        className={`rounded-md px-2 py-1 text-xs ${
                          on
                            ? 'bg-[var(--color-accent)] text-white'
                            : 'border border-[var(--color-border)] text-[var(--color-muted)]'
                        }`}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {field.type === 'checkbox' && (
                <input
                  type="checkbox"
                  checked={Boolean(values[field.name])}
                  onChange={(e) => set(field.name, e.target.checked)}
                  className="mt-1 h-4 w-4 accent-[var(--color-accent)]"
                />
              )}

              {['text', 'email', 'url', 'time', 'date', 'number'].includes(field.type) && (
                <input
                  type={field.type}
                  value={String(values[field.name] ?? '')}
                  onChange={(e) =>
                    set(
                      field.name,
                      field.type === 'number'
                        ? e.target.value === ''
                          ? null
                          : Number(e.target.value)
                        : e.target.value,
                    )
                  }
                  placeholder={'placeholder' in field ? field.placeholder : undefined}
                  required={'required' in field ? field.required : undefined}
                  min={field.type === 'number' && 'min' in field ? field.min : undefined}
                  step={field.type === 'number' && 'step' in field ? field.step : undefined}
                  className={inputClass}
                />
              )}
            </label>
          );
        })}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Saving…' : saveLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

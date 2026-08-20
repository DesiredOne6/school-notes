'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import type { ActionResult } from './assignments';

const pageSchema = z.object({
  noteId: z.string().uuid(),
  pngPath: z.string().max(500),
  vectorPath: z.string().max(500),
  strokeCount: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  background: z.enum(['blank', 'ruled', 'grid']),
  byteSize: z.number().int().nonnegative(),
});

/**
 * Records (or updates) the single ink attachment backing a handwritten note.
 *
 * A handwritten page has exactly one drawing, saved to fixed storage paths and
 * overwritten in place, so repeated autosaves don't accumulate files.
 */
export async function saveInkPage(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = pageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const p = parsed.data;
  const supabase = await createServerSupabase();

  const metadata = {
    vector_path: p.vectorPath,
    stroke_count: p.strokeCount,
    width: p.width,
    height: p.height,
    background: p.background,
  };

  const { data: existing } = await supabase
    .from('attachments')
    .select('id')
    .eq('note_id', p.noteId)
    .eq('kind', 'ink')
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('attachments')
      .update({
        storage_path: p.pngPath,
        byte_size: p.byteSize,
        ink_metadata: metadata,
      })
      .eq('id', existing.id);

    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from('attachments').insert({
      user_id: user.id,
      note_id: p.noteId,
      kind: 'ink',
      storage_path: p.pngPath,
      filename: 'page.png',
      mime_type: 'image/png',
      byte_size: p.byteSize,
      ink_metadata: metadata,
    });

    if (error) return { ok: false, error: error.message };
  }

  // Keeps the note's updated_at fresh so it sorts correctly in the list.
  await supabase
    .from('notes')
    .update({ kind: 'handwritten' })
    .eq('id', p.noteId);

  revalidatePath('/notes');
  revalidatePath(`/notes/${p.noteId}`);
  return { ok: true };
}

/** Renames a handwritten note, which has no markdown body to save alongside. */
export async function renameNote(noteId: string, title: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('notes')
    .update({ title: title.trim() || 'Untitled' })
    .eq('id', noteId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/notes');
  return { ok: true };
}

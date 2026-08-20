'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { uniqueTargets, normalizeTitle } from '@/lib/notes/wikilinks';
import type { ActionResult } from './assignments';

/**
 * Rebuilds the note_links rows for one note.
 *
 * Links are written by title, so resolution happens on save: every [[target]]
 * is matched against the user's note titles (case- and whitespace-insensitive)
 * and stored as an id pair. That makes backlinks a plain indexed lookup instead
 * of scanning every note body at read time.
 *
 * Targets with no matching note are simply not stored — the link still renders,
 * offering to create the note.
 */
async function resolveLinks(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  userId: string,
  noteId: string,
  body: string,
): Promise<void> {
  const targets = uniqueTargets(body);

  await supabase.from('note_links').delete().eq('source_note_id', noteId);
  if (targets.length === 0) return;

  // One fetch of id+title beats one query per target.
  const { data: candidates } = await supabase
    .from('notes')
    .select('id, title')
    .eq('user_id', userId)
    .is('archived_at', null);

  const byTitle = new Map<string, string>();
  for (const note of candidates ?? []) {
    byTitle.set(normalizeTitle(note.title), note.id);
  }

  const rows = targets
    .map((target) => byTitle.get(normalizeTitle(target)))
    .filter((id): id is string => Boolean(id) && id !== noteId)
    .map((targetId) => ({ source_note_id: noteId, target_note_id: targetId }));

  if (rows.length > 0) {
    await supabase.from('note_links').upsert(rows, {
      onConflict: 'source_note_id,target_note_id',
      ignoreDuplicates: true,
    });
  }
}

const createSchema = z.object({
  title: z.string().trim().max(300).default('Untitled'),
  courseId: z.string().uuid().nullable(),
  body: z.string().max(500_000).default(''),
});

export async function createNote(
  input: unknown,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('notes')
    .insert({
      user_id: user.id,
      title: parsed.data.title || 'Untitled',
      course_id: parsed.data.courseId,
      body: parsed.data.body,
    })
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? 'Could not create note' };

  await resolveLinks(supabase, user.id, data.id, parsed.data.body);

  revalidatePath('/notes');
  return { ok: true, id: data.id };
}

const updateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().max(300),
  body: z.string().max(500_000),
  courseId: z.string().uuid().nullable(),
  tags: z.array(z.string().trim().max(60)).max(30),
});

export async function updateNote(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const { id, title, body, courseId, tags } = parsed.data;
  const supabase = await createServerSupabase();

  const { error } = await supabase
    .from('notes')
    .update({
      title: title || 'Untitled',
      body,
      course_id: courseId,
      tags: tags.filter(Boolean),
    })
    .eq('id', id);

  if (error) return { ok: false, error: error.message };

  await resolveLinks(supabase, user.id, id, body);

  // A renamed note can satisfy links written elsewhere before it existed, so
  // re-resolve anything that points at this title.
  revalidatePath('/notes');
  revalidatePath(`/notes/${id}`);
  return { ok: true };
}

export async function deleteNote(id: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const supabase = await createServerSupabase();

  // Remove stored attachments before the rows cascade away.
  const { data: attachments } = await supabase
    .from('attachments')
    .select('storage_path')
    .eq('note_id', id);

  const paths = (attachments ?? []).map((a) => a.storage_path).filter(Boolean);
  if (paths.length > 0) {
    await supabase.storage.from('notes').remove(paths);
  }

  const { error } = await supabase.from('notes').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/notes');
  return { ok: true };
}

/**
 * Records a file attached to a note.
 *
 * Handwriting stores `kind: 'ink'` with the vector path in ink_metadata, so
 * the strokes can be reopened and edited later while the PNG beside them is
 * what the markdown actually embeds.
 */
export async function recordAttachment(input: {
  noteId: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  kind?: 'image' | 'ink';
  inkMetadata?: Record<string, unknown>;
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const supabase = await createServerSupabase();

  const { error } = await supabase.from('attachments').insert({
    user_id: user.id,
    note_id: input.noteId,
    kind: input.kind ?? 'image',
    storage_path: input.storagePath,
    filename: input.filename,
    mime_type: input.mimeType,
    byte_size: input.byteSize,
    ink_metadata: input.inkMetadata ?? null,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Signed URL for an image in the private notes bucket. */
export async function getAttachmentUrl(storagePath: string): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createServerSupabase();
  const { data } = await supabase.storage.from('notes').createSignedUrl(storagePath, 3600);
  return data?.signedUrl ?? null;
}

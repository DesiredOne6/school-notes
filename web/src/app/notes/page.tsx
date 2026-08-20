import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { toPlainPreview } from '@/lib/notes/wikilinks';
import { NewNoteButton } from '@/components/notes/NewNoteButton';

export const dynamic = 'force-dynamic';

type NoteRow = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  kind: string;
  updated_at: string;
  courses: { code: string | null; title: string; color: string } | null;
};

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; course?: string }>;
}) {
  const params = await searchParams;
  const query = params.q?.trim() ?? '';
  const supabase = await createServerSupabase();

  let builder = supabase
    .from('notes')
    .select('id, title, body, tags, kind, updated_at, courses(code, title, color)')
    .is('archived_at', null);

  if (query) {
    // websearch_to_tsquery accepts quoted phrases and OR, and never throws on
    // punctuation the way plainto_tsquery can.
    builder = builder.textSearch('search_vector', query, {
      type: 'websearch',
      config: 'english',
    });
  }

  if (params.course) builder = builder.eq('course_id', params.course);

  const { data, error } = await builder
    .order('updated_at', { ascending: false })
    .limit(100);

  const [{ data: courses }] = await Promise.all([
    supabase.from('courses').select('id, code, title').is('archived_at', null).order('code'),
  ]);

  const notes = (data ?? []) as unknown as NoteRow[];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {query
              ? `${notes.length} result${notes.length === 1 ? '' : 's'} for “${query}”`
              : `${notes.length} note${notes.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <NewNoteButton
          courses={courses ?? []}
          lockedCourseId={params.course}
        />
      </div>

      <form className="flex gap-2">
        {/* Preserved so searching inside a course doesn't drop the filter. */}
        {params.course && <input type="hidden" name="course" value={params.course} />}
        <input
          name="q"
          defaultValue={query}
          placeholder="Search titles and content…"
          className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <button
          type="submit"
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-sm hover:border-[var(--color-accent)]"
        >
          Search
        </button>
        {query && (
          <Link
            href={params.course ? `/notes?course=${params.course}` : '/notes'}
            className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted)] hover:text-white"
          >
            Clear
          </Link>
        )}
      </form>

      {(courses ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <Link
            href={query ? `/notes?q=${encodeURIComponent(query)}` : '/notes'}
            className={`rounded-full px-2.5 py-1 text-xs ${
              params.course
                ? 'border border-[var(--color-border)] text-[var(--color-muted)] hover:text-white'
                : 'border border-[var(--color-accent)] bg-[var(--color-accent)]/20'
            }`}
          >
            All courses
          </Link>
          {(courses ?? []).map((c) => {
            const href = query
              ? `/notes?course=${c.id}&q=${encodeURIComponent(query)}`
              : `/notes?course=${c.id}`;
            const active = params.course === c.id;
            return (
              <Link
                key={c.id}
                href={href}
                className={`rounded-full px-2.5 py-1 text-xs ${
                  active
                    ? 'border border-[var(--color-accent)] bg-[var(--color-accent)]/20'
                    : 'border border-[var(--color-border)] text-[var(--color-muted)] hover:text-white'
                }`}
              >
                {c.code ?? c.title}
              </Link>
            );
          })}
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error.message}
        </p>
      )}

      {notes.length === 0 && !error && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-8 text-center text-sm text-[var(--color-muted)]">
          {query ? (
            <p>Nothing matched. Try fewer words.</p>
          ) : (
            <>
              <p className="font-medium text-[#e9e9f0]">No notes yet.</p>
              <p className="mt-2">
                Write in markdown, paste images straight in, and link notes together with{' '}
                <code className="rounded bg-[var(--color-surface)] px-1">[[double brackets]]</code>.
              </p>
            </>
          )}
        </div>
      )}

      <ul className="space-y-2">
        {notes.map((note) => (
          <li key={note.id}>
            <Link
              href={`/notes/${note.id}`}
              className="flex gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3 hover:border-[var(--color-accent)]"
            >
              <span
                aria-hidden
                className="w-1 shrink-0 self-stretch rounded-full"
                style={{ background: note.courses?.color ?? '#3f3f52' }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {note.kind === 'handwritten' && <span aria-hidden className="mr-1.5">✍️</span>}
                  {note.title}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-muted)]">
                  {note.kind === 'handwritten'
                    ? 'Handwritten page'
                    : toPlainPreview(note.body) || 'Empty note'}
                </p>
                <p className="mt-1 text-[10px] text-[var(--color-muted)]">
                  {note.courses?.code ?? note.courses?.title ?? 'No course'} ·{' '}
                  {new Date(note.updated_at).toLocaleDateString()}
                  {note.tags.length > 0 && ` · ${note.tags.map((t) => `#${t}`).join(' ')}`}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

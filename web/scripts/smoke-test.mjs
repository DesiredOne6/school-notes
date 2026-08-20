/**
 * End-to-end verification against the LIVE Supabase project.
 *
 * Creates a throwaway user, exercises the reminder trigger and RLS, then
 * deletes the user (which cascades everything it created). Safe to re-run.
 *
 *   node --env-file=.env.local scripts/smoke-test.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !serviceKey || !anonKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
}

const email = `smoke-${Date.now()}@example.invalid`;
const password = `Pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
let userId = null;

try {
  console.log('\nAuth & profile trigger');

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  check('test user created', !createErr && created?.user, createErr?.message);
  userId = created?.user?.id;
  if (!userId) throw new Error('cannot continue without a user');

  // The on_auth_user_created trigger should have made a profile row.
  const { data: profile } = await admin
    .from('profiles').select('id, timezone, default_reminder_offsets')
    .eq('id', userId).maybeSingle();
  check('profile auto-created by trigger', Boolean(profile));
  check(
    'default reminder offsets are 1 day + 2 hours',
    JSON.stringify(profile?.default_reminder_offsets) === '[1440,120]',
    JSON.stringify(profile?.default_reminder_offsets),
  );

  console.log('\nCourses & assignments');

  const { data: course, error: courseErr } = await admin
    .from('courses')
    .insert({ user_id: userId, code: 'CS 3410', title: 'Computer System Organization' })
    .select('id').single();
  check('course inserted', !courseErr && course, courseErr?.message);

  const dueAt = new Date(Date.now() + 10 * 86_400_000).toISOString();
  const { data: assignment, error: aErr } = await admin
    .from('assignments')
    .insert({ user_id: userId, course_id: course.id, title: 'Problem Set 4', due_at: dueAt })
    .select('id').single();
  check('assignment inserted', !aErr && assignment, aErr?.message);

  console.log('\nReminder generation (database trigger)');

  const { data: reminders } = await admin
    .from('reminders').select('offset_minutes, remind_at, status')
    .eq('assignment_id', assignment.id)
    .order('offset_minutes');

  check('two reminders auto-generated', reminders?.length === 2, `got ${reminders?.length}`);
  check(
    'offsets match the profile defaults',
    JSON.stringify(reminders?.map((r) => r.offset_minutes)) === '[120,1440]',
    JSON.stringify(reminders?.map((r) => r.offset_minutes)),
  );

  const oneDay = reminders?.find((r) => r.offset_minutes === 1440);
  const gapMinutes = oneDay
    ? Math.round((new Date(dueAt) - new Date(oneDay.remind_at)) / 60_000)
    : null;
  check('1-day reminder sits exactly 1440 min before due', gapMinutes === 1440, `${gapMinutes}`);

  // Moving the deadline must move the reminders with it.
  const newDue = new Date(Date.now() + 20 * 86_400_000).toISOString();
  await admin.from('assignments').update({ due_at: newDue }).eq('id', assignment.id);
  const { data: moved } = await admin
    .from('reminders').select('remind_at').eq('assignment_id', assignment.id)
    .eq('offset_minutes', 1440).single();
  check(
    'reminders follow a moved due date',
    Math.round((new Date(newDue) - new Date(moved.remind_at)) / 60_000) === 1440,
  );

  // Submitting should clear pending reminders.
  await admin.from('assignments').update({ status: 'submitted' }).eq('id', assignment.id);
  const { count: afterSubmit } = await admin
    .from('reminders').select('*', { count: 'exact', head: true })
    .eq('assignment_id', assignment.id);
  check('submitting clears pending reminders', afterSubmit === 0, `${afterSubmit} left`);

  console.log('\nSecurity');

  // Anonymous callers must see nothing, even though rows exist.
  const { data: anonCourses } = await anon.from('courses').select('id');
  check('anon cannot read courses', (anonCourses?.length ?? 0) === 0);

  // integration_secrets has RLS on and no policies at all.
  const { data: anonSecrets, error: secretErr } = await anon
    .from('integration_secrets').select('integration_id');
  check(
    'anon cannot read integration_secrets',
    (anonSecrets?.length ?? 0) === 0,
    secretErr?.message ?? '',
  );

  // Canvas dedupe: the partial unique index must reject a repeat import.
  await admin.from('assignments').insert({
    user_id: userId, title: 'From Canvas', canvas_assignment_id: 424242, source: 'canvas',
  });
  const { error: dupeErr } = await admin.from('assignments').insert({
    user_id: userId, title: 'Duplicate', canvas_assignment_id: 424242, source: 'canvas',
  });
  check('duplicate Canvas import rejected', dupeErr?.code === '23505', dupeErr?.code);

  console.log('\nPassword authentication');

  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({
    email, password,
  });
  check('correct password signs in', !signInErr && signIn?.session, signInErr?.message);
  check('session carries the right user', signIn?.user?.id === userId);

  const { error: wrongErr } = await anon.auth.signInWithPassword({
    email, password: 'definitely-not-the-password',
  });
  check('wrong password is rejected', Boolean(wrongErr), wrongErr?.message ?? 'no error raised');

  // A signed-in user must see their own rows, where anon saw none.
  const scoped = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${signIn.session.access_token}` } },
  });
  const { data: ownCourses } = await scoped.from('courses').select('id');
  check('signed-in user sees their own courses via RLS', (ownCourses?.length ?? 0) === 1,
    `${ownCourses?.length}`);

  // Even signed in, the token table stays unreachable.
  const { data: ownSecrets } = await scoped.from('integration_secrets').select('integration_id');
  check('signed-in user still cannot read integration_secrets', (ownSecrets?.length ?? 0) === 0);

  await anon.auth.signOut();

  console.log('\nCourse hub');

  const { data: instructor, error: instErr } = await admin
    .from('instructors')
    .insert({ user_id: userId, course_id: course.id, name: 'Dr. Example', role: 'professor', email: 'prof@example.edu' })
    .select('id').single();
  check('instructor inserted', !instErr && instructor, instErr?.message);

  const { error: ohErr } = await admin.from('office_hours').insert({
    user_id: userId, instructor_id: instructor.id,
    weekday: 3, starts_at: '14:00', ends_at: '16:00', location: 'BBB 2717',
  });
  check('office hours inserted', !ohErr, ohErr?.message);

  const { error: linkErr } = await admin.from('course_links').insert({
    user_id: userId, course_id: course.id, kind: 'zoom',
    label: 'Lecture Zoom', url: 'https://umich.zoom.us/j/123',
  });
  check('course link inserted', !linkErr, linkErr?.message);

  // Deleting an instructor must take their office hours with them.
  await admin.from('instructors').delete().eq('id', instructor.id);
  const { count: orphanHours } = await admin
    .from('office_hours').select('*', { count: 'exact', head: true })
    .eq('instructor_id', instructor.id);
  check('office hours cascade when the instructor is removed', orphanHours === 0, `${orphanHours}`);

  // The course hub matches calendar events to a course by its code appearing
  // in the title, so verify that query shape works against real data.
  const { data: cal } = await admin.from('external_calendars').select('id').limit(1);
  if (cal?.[0]) {
    const { error: evErr } = await admin.from('calendar_events').insert({
      user_id: userId, calendar_id: cal[0].id, external_event_id: `smoke-${Date.now()}`,
      title: 'CS 3410 review session', starts_at: new Date(Date.now() + 86400000).toISOString(),
      ends_at: new Date(Date.now() + 90000000).toISOString(),
    });

    if (!evErr) {
      const { data: matched } = await admin
        .from('calendar_events').select('id, title').ilike('title', '%CS 3410%');
      check('course hub can match events by course code',
        matched?.some((e) => e.title === 'CS 3410 review session'), `${matched?.length} hits`);
      await admin.from('calendar_events').delete().eq('title', 'CS 3410 review session');
    } else {
      check('course hub can match events by course code', false, evErr.message);
    }
  }

  console.log('\nNotes');

  const { data: noteA, error: noteAErr } = await admin.from('notes').insert({
    user_id: userId, course_id: course.id, title: 'Binary Search Trees',
    body: 'A BST keeps keys ordered so lookup is logarithmic.',
    tags: ['data-structures'],
  }).select('id').single();
  check('note inserted', !noteAErr && noteA, noteAErr?.message);

  const { data: noteB } = await admin.from('notes').insert({
    user_id: userId, course_id: course.id, title: 'Lecture 5',
    body: 'Covered [[Binary Search Trees]] and rotations.',
  }).select('id').single();

  // search_vector is generated, so it must be populated without any app work.
  const { data: found } = await admin
    .from('notes').select('id, title')
    .textSearch('search_vector', 'logarithmic', { type: 'websearch', config: 'english' });
  check('full-text search finds body content', found?.some((n) => n.id === noteA.id),
    `${found?.length} hits`);

  const { data: byTitle } = await admin
    .from('notes').select('id')
    .textSearch('search_vector', 'rotations', { type: 'websearch', config: 'english' });
  check('search matches a second note independently', byTitle?.some((n) => n.id === noteB.id));

  const { data: phrase } = await admin
    .from('notes').select('id')
    .textSearch('search_vector', '"binary search"', { type: 'websearch', config: 'english' });
  check('quoted phrase search works', (phrase?.length ?? 0) >= 1, `${phrase?.length}`);

  // Link resolution stores id pairs; backlinks are then an indexed lookup.
  const { error: linkInsertErr } = await admin.from('note_links').insert({
    source_note_id: noteB.id, target_note_id: noteA.id,
  });
  check('note link inserted', !linkInsertErr, linkInsertErr?.message);

  const { data: backlinks, error: backlinkErr } = await admin
    .from('note_links')
    .select('source_note_id, notes!note_links_source_note_id_fkey(id, title)')
    .eq('target_note_id', noteA.id);
  check('backlink query resolves the source note', !backlinkErr &&
    backlinks?.[0]?.notes?.title === 'Lecture 5', backlinkErr?.message);

  // Deleting the source note must not strand its links.
  await admin.from('notes').delete().eq('id', noteB.id);
  const { count: strandedLinks } = await admin
    .from('note_links').select('*', { count: 'exact', head: true })
    .eq('target_note_id', noteA.id);
  check('links cascade when the source note is deleted', strandedLinks === 0, `${strandedLinks}`);

  // Note images go to the notes bucket under the user's own folder.
  const imgPath = `${userId}/${noteA.id}/diagram.png`;
  const { error: imgErr } = await admin.storage
    .from('notes')
    .upload(imgPath, new Blob(['fake-png'], { type: 'image/png' }), { upsert: true });
  check('note image uploads to the user-scoped path', !imgErr, imgErr?.message);
  await admin.storage.from('notes').remove([imgPath]);

  // Handwriting stores a PNG for embedding plus vector JSON for re-editing.
  const inkBase = `${userId}/${noteA.id}/ink-test`;
  await admin.storage.from('notes')
    .upload(`${inkBase}.png`, new Blob(['png'], { type: 'image/png' }), { upsert: true });
  await admin.storage.from('notes')
    .upload(`${inkBase}.json`, new Blob(['{"version":1,"strokes":[]}'], { type: 'application/json' }), { upsert: true });

  const { error: inkErr } = await admin.from('attachments').insert({
    user_id: userId, note_id: noteA.id, kind: 'ink',
    storage_path: `${inkBase}.png`, filename: 'handwriting.png', mime_type: 'image/png',
    byte_size: 3,
    ink_metadata: { vector_path: `${inkBase}.json`, stroke_count: 0, width: 1200, height: 420 },
  });
  check('ink attachment records its vector path', !inkErr, inkErr?.message);

  const { data: inkRow } = await admin
    .from('attachments').select('kind, ink_metadata')
    .eq('note_id', noteA.id).eq('kind', 'ink').maybeSingle();
  check('ink metadata round-trips as jsonb',
    inkRow?.ink_metadata?.vector_path === `${inkBase}.json`,
    JSON.stringify(inkRow?.ink_metadata));

  await admin.storage.from('notes').remove([`${inkBase}.png`, `${inkBase}.json`]);

  // A handwritten page: one note of kind 'handwritten' with a single ink
  // attachment overwritten in place by autosave.
  const { data: penNote } = await admin.from('notes').insert({
    user_id: userId, course_id: course.id, title: 'Lecture 6 (handwritten)',
    kind: 'handwritten',
  }).select('id, kind').single();
  check('handwritten note stores its kind', penNote?.kind === 'handwritten', penNote?.kind);

  const pageBase = `${userId}/${penNote.id}/page`;
  for (const round of [1, 2]) {
    // upsert:true is what makes autosave overwrite rather than accumulate.
    const { error } = await admin.storage.from('notes').upload(
      `${pageBase}.json`,
      new Blob([JSON.stringify({ version: 1, width: 1200, height: 1200, strokes: [] })],
        { type: 'application/json' }),
      { upsert: true },
    );
    check(`autosave round ${round} overwrites in place`, !error, error?.message);
  }

  const { data: pageFiles } = await admin.storage.from('notes').list(`${userId}/${penNote.id}`);
  check('repeated autosaves leave exactly one vector file',
    (pageFiles ?? []).filter((f) => f.name.endsWith('.json')).length === 1,
    (pageFiles ?? []).map((f) => f.name).join(', '));

  await admin.storage.from('notes').remove([`${pageBase}.json`]);

  console.log('\nStorage');
  const { data: buckets } = await admin.storage.listBuckets();
  const names = (buckets ?? []).map((b) => b.name).sort();
  check('notes + documents buckets exist', names.includes('notes') && names.includes('documents'));
  check('buckets are private', (buckets ?? []).every((b) => !b.public));

  // Documents upload to `{uid}/...`, which is what the storage policy requires.
  const docPath = `${userId}/${course.id}/smoke-test.txt`;
  const { error: uploadErr } = await admin.storage
    .from('documents')
    .upload(docPath, new Blob(['syllabus placeholder'], { type: 'text/plain' }), { upsert: true });
  check('document uploads to the user-scoped path', !uploadErr, uploadErr?.message);

  const { data: signed } = await admin.storage.from('documents').createSignedUrl(docPath, 60);
  check('signed download URL is issued', Boolean(signed?.signedUrl));

  if (signed?.signedUrl) {
    const res = await fetch(signed.signedUrl);
    check('signed URL actually serves the file', res.ok && (await res.text()) === 'syllabus placeholder');
  }

  // A private bucket must refuse anonymous reads.
  const { data: pub } = anon.storage.from('documents').getPublicUrl(docPath);
  const anonRes = await fetch(pub.publicUrl);
  check('anon cannot read a private document', !anonRes.ok, `http ${anonRes.status}`);

  await admin.storage.from('documents').remove([docPath]);
} catch (err) {
  console.error('\nFATAL:', err.message);
  failed += 1;
} finally {
  if (userId) {
    // Cascades to every row the test created.
    await admin.auth.admin.deleteUser(userId);
    const { count } = await admin
      .from('courses').select('*', { count: 'exact', head: true }).eq('user_id', userId);
    console.log(`\nCleanup: test user deleted, ${count ?? 0} leftover course rows`);
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

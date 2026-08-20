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
let userId = null;

try {
  console.log('\nAuth & profile trigger');

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
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

  console.log('\nStorage');
  const { data: buckets } = await admin.storage.listBuckets();
  const names = (buckets ?? []).map((b) => b.name).sort();
  check('notes + documents buckets exist', names.includes('notes') && names.includes('documents'));
  check('buckets are private', (buckets ?? []).every((b) => !b.public));
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

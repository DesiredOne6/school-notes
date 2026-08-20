import { test } from 'vitest';
import assert from 'node:assert/strict';
import { bucketFor, groupByUrgency, relativeDue, isoDaysFromNow } from '@/lib/util/dates';

// A fixed "now" keeps these deterministic regardless of when they run.
const NOW = new Date('2026-03-10T14:00:00Z');
const iso = (s: string) => new Date(s).toISOString();

test('bucketFor sorts deadlines into the right urgency bucket', () => {
  assert.equal(bucketFor(iso('2026-03-10T09:00:00Z'), NOW), 'overdue');
  assert.equal(bucketFor(iso('2026-03-10T23:00:00Z'), NOW), 'today');
  assert.equal(bucketFor(iso('2026-03-11T10:00:00Z'), NOW), 'tomorrow');
  assert.equal(bucketFor(iso('2026-03-15T10:00:00Z'), NOW), 'this_week');
  assert.equal(bucketFor(iso('2026-04-20T10:00:00Z'), NOW), 'later');
  assert.equal(bucketFor(null, NOW), 'undated');
});

test('a deadline earlier today is overdue, not "today"', () => {
  // The common failure mode: bucketing by calendar day would call a 9am
  // deadline "today" at 2pm and hide that it has already passed.
  assert.equal(bucketFor(iso('2026-03-10T13:59:00Z'), NOW), 'overdue');
});

test('groupByUrgency orders buckets and sorts within them', () => {
  const items = [
    { id: 'later', due_at: iso('2026-04-01T10:00:00Z') },
    { id: 'late-today', due_at: iso('2026-03-10T22:00:00Z') },
    { id: 'overdue', due_at: iso('2026-03-01T10:00:00Z') },
    { id: 'early-today', due_at: iso('2026-03-10T16:00:00Z') },
    { id: 'undated', due_at: null },
  ];

  const groups = groupByUrgency(items, NOW);

  assert.deepEqual(
    groups.map((g) => g.bucket),
    ['overdue', 'today', 'later', 'undated'],
  );

  const today = groups.find((g) => g.bucket === 'today')!;
  assert.deepEqual(today.items.map((i) => i.id), ['early-today', 'late-today']);
});

test('groupByUrgency omits empty buckets', () => {
  const groups = groupByUrgency([{ due_at: iso('2026-04-01T10:00:00Z') }], NOW);
  assert.deepEqual(groups.map((g) => g.bucket), ['later']);
});

test('relativeDue distinguishes upcoming from late', () => {
  assert.equal(relativeDue(iso('2026-03-10T14:30:00Z'), NOW), 'in 30m');
  assert.equal(relativeDue(iso('2026-03-10T17:00:00Z'), NOW), 'in 3h');
  assert.equal(relativeDue(iso('2026-03-13T14:00:00Z'), NOW), 'in 3d');
  assert.equal(relativeDue(iso('2026-03-10T12:00:00Z'), NOW), '2h late');
  assert.equal(relativeDue(null, NOW), '');
});

test('isoDaysFromNow returns a valid future timestamp', () => {
  const result = isoDaysFromNow(120);
  assert.ok(new Date(result).getTime() > Date.now());
  assert.match(result, /^\d{4}-\d{2}-\d{2}T/);
});

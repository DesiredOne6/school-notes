import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  extractWikiLinks,
  uniqueTargets,
  normalizeTitle,
  wikiLinksToMarkdown,
  toPlainPreview,
} from '@/lib/notes/wikilinks';

test('extracts plain and aliased wiki links', () => {
  const links = extractWikiLinks('See [[Lecture 3]] and [[Big-O Notation|complexity]].');

  assert.equal(links.length, 2);
  assert.deepEqual(links[0], { target: 'Lecture 3', label: 'Lecture 3', raw: '[[Lecture 3]]' });
  assert.equal(links[1].target, 'Big-O Notation');
  assert.equal(links[1].label, 'complexity');
});

test('two links on one line stay separate', () => {
  // A greedy pattern would swallow everything between the first [[ and last ]].
  const links = extractWikiLinks('[[One]] then [[Two]]');
  assert.deepEqual(links.map((l) => l.target), ['One', 'Two']);
});

test('empty and malformed links are ignored', () => {
  assert.deepEqual(extractWikiLinks('[[]] [[   ]] [not a link] [[unclosed'), []);
});

test('targets dedupe case-insensitively, keeping first spelling', () => {
  assert.deepEqual(
    uniqueTargets('[[Lecture 3]] [[lecture 3]] [[LECTURE  3]] [[Other]]'),
    ['Lecture 3', 'Other'],
  );
});

test('normalizeTitle collapses case and whitespace', () => {
  assert.equal(normalizeTitle('  Lecture   3 '), 'lecture 3');
  assert.equal(normalizeTitle('LECTURE 3'), normalizeTitle('lecture 3'));
});

test('resolved links become markdown links to the note', () => {
  const out = wikiLinksToMarkdown('See [[Lecture 3]].', (t) =>
    t === 'Lecture 3' ? 'abc-123' : null,
  );
  assert.equal(out, 'See [Lecture 3](/notes/abc-123).');
});

test('unresolved links offer to create the note', () => {
  const out = wikiLinksToMarkdown('See [[Missing Note]].', () => null);
  assert.match(out, /\/notes\/new\?title=Missing%20Note/);
  assert.match(out, /Note not created yet/);
});

test('an alias is used as the link label', () => {
  const out = wikiLinksToMarkdown('[[Big-O Notation|complexity]]', () => 'id-1');
  assert.equal(out, '[complexity](/notes/id-1)');
});

test('a label cannot contain ] and break out of the markdown link', () => {
  // The pattern excludes ']' from targets and aliases, so this is not a link
  // at all. Leaving it as literal text is safer than guessing where it ends.
  const out = wikiLinksToMarkdown('[[Target|weird ] label]]', () => 'id-1');
  assert.equal(out, '[[Target|weird ] label]]', 'ambiguous input is left alone');
});

test('parentheses in a label survive intact', () => {
  const out = wikiLinksToMarkdown('[[Target|see (this)]]', () => 'id-1');
  assert.equal(out, '[see (this)](/notes/id-1)');
});

test('toPlainPreview strips markdown to readable text', () => {
  const body = [
    '# Heading',
    '',
    'Some **bold** and `code` and [a link](https://example.com).',
    '- bullet one',
    '> quoted',
    '',
    '```',
    'ignored = true',
    '```',
    '',
    'See [[Lecture 3|the lecture]].',
  ].join('\n');

  const preview = toPlainPreview(body);

  assert.equal(preview.includes('#'), false);
  assert.equal(preview.includes('**'), false);
  assert.equal(preview.includes('ignored'), false, 'code blocks are dropped');
  assert.equal(preview.includes('https://'), false);
  assert.match(preview, /the lecture/, 'wiki alias survives as text');
});

test('toPlainPreview truncates with an ellipsis', () => {
  const preview = toPlainPreview('x'.repeat(500), 50);
  assert.equal(preview.length, 50);
  assert.match(preview, /…$/);
});

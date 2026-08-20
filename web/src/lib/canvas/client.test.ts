import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseNextLink } from '@/lib/canvas/client';

test('parseNextLink finds the next page in a Canvas Link header', () => {
  const header =
    '<https://x.instructure.com/api/v1/courses?page=1&per_page=100>; rel="current",' +
    '<https://x.instructure.com/api/v1/courses?page=2&per_page=100>; rel="next",' +
    '<https://x.instructure.com/api/v1/courses?page=1&per_page=100>; rel="first"';

  assert.equal(
    parseNextLink(header),
    'https://x.instructure.com/api/v1/courses?page=2&per_page=100',
  );
});

test('parseNextLink returns null on the last page', () => {
  const header =
    '<https://x.instructure.com/api/v1/courses?page=3>; rel="current",' +
    '<https://x.instructure.com/api/v1/courses?page=1>; rel="first",' +
    '<https://x.instructure.com/api/v1/courses?page=3>; rel="last"';

  assert.equal(parseNextLink(header), null);
});

test('parseNextLink handles a missing header and unquoted rel', () => {
  assert.equal(parseNextLink(null), null);
  assert.equal(parseNextLink('<https://x/api/v1/y?page=2>; rel=next'), 'https://x/api/v1/y?page=2');
});

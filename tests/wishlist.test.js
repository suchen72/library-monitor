const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildOwnedTitleSet } = require('../src/dataStore');

function makeAccount(id, overrides = {}) {
  return {
    id,
    label: id,
    status: 'ok',
    borrowed: [],
    reservations: [],
    ...overrides,
  };
}

describe('buildOwnedTitleSet', () => {
  it('returns empty set for empty data', () => {
    const set = buildOwnedTitleSet({}, { entries: [] });
    assert.equal(set.size, 0);
  });

  it('returns empty set for null/undefined inputs', () => {
    const set = buildOwnedTitleSet(null, null);
    assert.equal(set.size, 0);
  });

  it('includes borrowed titles', () => {
    const data = {
      accounts: [
        makeAccount('a1', { borrowed: [{ title: 'Book A' }, { title: 'Book B' }] }),
      ],
    };
    const set = buildOwnedTitleSet(data, { entries: [] });
    assert.equal(set.size, 2);
    assert.ok(set.has('Book A'));
    assert.ok(set.has('Book B'));
  });

  it('includes reservation titles', () => {
    const data = {
      accounts: [
        makeAccount('a1', { reservations: [{ title: 'Reserved Book' }] }),
      ],
    };
    const set = buildOwnedTitleSet(data, { entries: [] });
    assert.equal(set.size, 1);
    assert.ok(set.has('Reserved Book'));
  });

  it('includes history titles', () => {
    const history = {
      entries: [
        { title: 'Old Book', returnedDate: '2026-01-01' },
      ],
    };
    const set = buildOwnedTitleSet({ accounts: [] }, history);
    assert.equal(set.size, 1);
    assert.ok(set.has('Old Book'));
  });

  it('unions borrowed + reservations + history and dedupes', () => {
    const data = {
      accounts: [
        makeAccount('a1', {
          borrowed: [{ title: 'Book A' }, { title: 'Shared' }],
          reservations: [{ title: 'Book B' }],
        }),
        makeAccount('a2', {
          borrowed: [{ title: 'Shared' }], // duplicate across accounts
        }),
      ],
    };
    const history = {
      entries: [
        { title: 'Book C', returnedDate: '2026-01-01' },
        { title: 'Shared', returnedDate: '2025-12-01' }, // also in borrowed
      ],
    };
    const set = buildOwnedTitleSet(data, history);
    assert.equal(set.size, 4); // Book A, Shared, Book B, Book C
    assert.ok(set.has('Book A'));
    assert.ok(set.has('Book B'));
    assert.ok(set.has('Book C'));
    assert.ok(set.has('Shared'));
  });

  it('skips entries with no title', () => {
    const data = {
      accounts: [
        makeAccount('a1', {
          borrowed: [{ title: 'Good' }, { title: '' }, {}],
          reservations: [{ title: null }],
        }),
      ],
    };
    const history = { entries: [{ title: undefined }] };
    const set = buildOwnedTitleSet(data, history);
    assert.equal(set.size, 1);
    assert.ok(set.has('Good'));
  });
});

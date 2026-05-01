const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildOwnedTitleSet,
  normalizeWishlistTags,
  repairWishlistTags,
  addOrUpdateWishlistItems,
} = require('../src/dataStore');

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

describe('wishlist tag defaults', () => {
  it('defaults empty wishlist tags to 可可貝貝', () => {
    assert.deepEqual(normalizeWishlistTags([]), ['可可貝貝']);
    assert.deepEqual(normalizeWishlistTags(null), ['可可貝貝']);
    assert.deepEqual(normalizeWishlistTags(['', '包包', '包包']), ['包包']);
  });

  it('repairs existing wishlist items with empty tags', () => {
    const data = {
      wishlist: [
        { title: 'No tags', tags: [] },
        { title: 'Missing tags' },
        { title: 'Has tags', tags: ['大人'] },
      ],
    };
    const result = repairWishlistTags(data);

    assert.equal(result.changed, true);
    assert.deepEqual(data.wishlist[0].tags, ['可可貝貝']);
    assert.deepEqual(data.wishlist[1].tags, ['可可貝貝']);
    assert.deepEqual(data.wishlist[2].tags, ['大人']);
  });

  it('adds and updates wishlist items with default tags and catalog fields', () => {
    const data = {
      wishlist: [
        { title: 'Existing', tags: ['包包'], note: '', dateAdded: '2026-01-01T00:00:00.000Z' },
      ],
    };
    const now = new Date('2026-05-01T00:00:00.000Z');
    const result = addOrUpdateWishlistItems(data, [
      { title: 'New Book', tags: [], bookId: '123', dataType: 'common:webpac.dataType.book', holdings: 5 },
      { title: 'Existing', tags: ['大人'], waitingCount: 2 },
      { title: '' },
    ], now);

    assert.equal(result.added, 1);
    assert.equal(result.updated, 1);
    assert.equal(result.skipped, 1);
    assert.deepEqual(data.wishlist.find(w => w.title === 'New Book').tags, ['可可貝貝']);
    assert.equal(data.wishlist.find(w => w.title === 'New Book').bookId, '123');
    assert.deepEqual(data.wishlist.find(w => w.title === 'Existing').tags, ['包包', '大人']);
    assert.equal(data.wishlist.find(w => w.title === 'Existing').waitingCount, 2);
  });
});

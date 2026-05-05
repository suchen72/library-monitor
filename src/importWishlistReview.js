const fs = require('fs');
const path = require('path');
const { parseCsv, BOOK_DATA_TYPE } = require('./generateWishlistReview');
const {
  readWishlist,
  writeWishlist,
  addOrUpdateWishlistItems,
} = require('./dataStore');

const ROOT = path.join(__dirname, '..');
const REVIEW_PATH = path.join(ROOT, 'data', 'wishlist-review.csv');
const WISHLIST_TAGS = ['包包', '閱讀小博士'];

function buildNote(row) {
  const parts = [];
  if (row.author) parts.push(`作者：${row.author}`);
  if (row.imprint) parts.push(`出版：${row.imprint}`);
  return parts.join('；');
}

function rowToWishlistItem(row) {
  return {
    title: row.matchedTitle,
    tags: WISHLIST_TAGS,
    note: buildNote(row),
    bookId: row.bookId,
    author: row.author,
    imprint: row.imprint,
    dataType: row.dataType,
    holdings: Number(row.holdings) || 0,
    available: Number(row.available) || 0,
    reservable: Number(row.reservable) || 0,
    waitingCount: Number(row.waitingCount) || 0,
  };
}

function ensureWishlistTags(data) {
  if (!Array.isArray(data.tags)) data.tags = [];
  for (const tag of WISHLIST_TAGS) {
    if (!data.tags.includes(tag)) data.tags.push(tag);
  }
}

function main() {
  const reviewRows = parseCsv(fs.readFileSync(REVIEW_PATH, 'utf8'));
  const rowsToImport = reviewRows.filter(row =>
    row.reviewDecision === 'add' &&
    row.matchStatus === 'matched' &&
    row.dataType === BOOK_DATA_TYPE &&
    row.matchedTitle
  );

  const skippedAddRows = reviewRows.filter(row =>
    row.reviewDecision === 'add' &&
    (row.matchStatus !== 'matched' || row.dataType !== BOOK_DATA_TYPE || !row.matchedTitle)
  );

  const data = readWishlist();
  ensureWishlistTags(data);
  const result = addOrUpdateWishlistItems(data, rowsToImport.map(rowToWishlistItem));
  writeWishlist(data);

  console.log(JSON.stringify({
    importedRows: rowsToImport.length,
    skippedAddRows: skippedAddRows.length,
    added: result.added,
    updated: result.updated,
    skipped: result.skipped,
    tags: WISHLIST_TAGS,
  }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  WISHLIST_TAGS,
  buildNote,
  rowToWishlistItem,
};

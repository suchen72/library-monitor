const fs = require('fs');
const path = require('path');
const { searchCatalog } = require('./catalogSearch');

const ROOT = path.join(__dirname, '..');
const BOOKLIST_PATH = path.join(ROOT, 'data', 'booklist.csv');
const REVIEW_PATH = path.join(ROOT, 'data', 'wishlist-review.csv');
const BOOK_DATA_TYPE = 'common:webpac.dataType.book';

const REVIEW_COLUMNS = [
  '編號',
  '原始書名',
  '級別',
  'searchKeywords',
  'matchStatus',
  'matchedTitle',
  'bookId',
  'author',
  'imprint',
  'dataType',
  'holdings',
  'available',
  'reservable',
  'waitingCount',
  'reviewDecision',
  'needsAttention',
  'reviewNote',
];

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim() !== '');
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    return row;
  });
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows) {
  const lines = [REVIEW_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(REVIEW_COLUMNS.map(column => csvEscape(row[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function removeParenthetical(text) {
  return text
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '');
}

function normalizeTitle(title) {
  return removeParenthetical(String(title || ''))
    .normalize('NFKC')
    .replace(/新版|初心版|初版/g, '')
    .replace(/您/g, '你')
    .replace(/[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Letter}\p{Number}]/gu, '')
    .toLowerCase();
}

function titleVariants(title) {
  const original = String(title || '').trim();
  const punctuationRemoved = original
    .normalize('NFKC')
    .replace(/[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Letter}\p{Number}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...new Set([original, punctuationRemoved].filter(Boolean))];
}

function resultKey(result) {
  return result.bookId || `${result.title}|${result.author}|${result.imprint}`;
}

function mergeResults(resultGroups) {
  const merged = new Map();
  for (const group of resultGroups) {
    for (const result of group) {
      const key = resultKey(result);
      if (!merged.has(key)) merged.set(key, result);
    }
  }
  return [...merged.values()];
}

function isShortTitle(normalizedTitle) {
  return [...normalizedTitle].length <= 4;
}

function scoreCandidate(sourceTitle, candidate) {
  const source = normalizeTitle(sourceTitle);
  const candidateTitle = normalizeTitle(candidate.title);
  let titleScore = 0;

  if (candidateTitle === source) {
    titleScore = 100;
  } else if (candidateTitle.includes(source) || source.includes(candidateTitle)) {
    titleScore = 70;
  }

  return {
    titleScore,
    waitingScore: -(Number(candidate.waitingCount) || 0),
    holdingsScore: Number(candidate.holdings) || 0,
  };
}

function compareCandidates(sourceTitle, left, right) {
  const a = scoreCandidate(sourceTitle, left);
  const b = scoreCandidate(sourceTitle, right);
  return (
    b.titleScore - a.titleScore ||
    b.waitingScore - a.waitingScore ||
    b.holdingsScore - a.holdingsScore
  );
}

function pickBestCandidate(sourceTitle, candidates) {
  return [...candidates].sort((a, b) => compareCandidates(sourceTitle, a, b))[0] || null;
}

function emptyReviewRow(sourceRow, searchKeywords, status, notes) {
  return {
    '編號': sourceRow['編號'],
    '原始書名': sourceRow['書名'],
    '級別': sourceRow['級別'],
    searchKeywords,
    matchStatus: status,
    matchedTitle: '',
    bookId: '',
    author: '',
    imprint: '',
    dataType: '',
    holdings: '',
    available: '',
    reservable: '',
    waitingCount: '',
    reviewDecision: '',
    needsAttention: notes.length > 0 ? 'true' : 'false',
    reviewNote: notes.join(';'),
  };
}

function matchedReviewRow(sourceRow, searchKeywords, candidate, status, needsAttention, notes) {
  return {
    '編號': sourceRow['編號'],
    '原始書名': sourceRow['書名'],
    '級別': sourceRow['級別'],
    searchKeywords,
    matchStatus: status,
    matchedTitle: candidate.title || '',
    bookId: candidate.bookId || '',
    author: candidate.author || '',
    imprint: candidate.imprint || '',
    dataType: candidate.dataType || '',
    holdings: candidate.holdings ?? '',
    available: candidate.available ?? '',
    reservable: candidate.reservable ?? '',
    waitingCount: candidate.waitingCount ?? '',
    reviewDecision: '',
    needsAttention: needsAttention ? 'true' : 'false',
    reviewNote: notes.join(';'),
  };
}

async function buildReviewRow(sourceRow) {
  const title = sourceRow['書名'];
  const variants = titleVariants(title);
  const searchKeywords = variants.join('|');
  const notes = [];

  try {
    const resultGroups = [];
    for (const keyword of variants) {
      resultGroups.push(await searchCatalog(keyword, 100));
    }

    const results = mergeResults(resultGroups);
    if (results.length === 0) {
      return emptyReviewRow(sourceRow, searchKeywords, 'not_found', ['找不到任何搜尋結果']);
    }

    const bookCandidates = results.filter(result => result.dataType === BOOK_DATA_TYPE);
    const nonBookCount = results.length - bookCandidates.length;
    if (nonBookCount > 0) notes.push(`另排除 ${nonBookCount} 筆非圖書結果`);

    if (bookCandidates.length === 0) {
      return emptyReviewRow(sourceRow, searchKeywords, 'no_book_candidate', [
        '搜尋結果全部不是圖書類別，已排除電子資源/視聽資料',
      ]);
    }

    const sourceNormalized = normalizeTitle(title);
    const matchingCandidates = bookCandidates.filter(candidate => {
      const candidateNormalized = normalizeTitle(candidate.title);
      return candidateNormalized === sourceNormalized ||
        candidateNormalized.includes(sourceNormalized) ||
        sourceNormalized.includes(candidateNormalized);
    });

    if (matchingCandidates.length === 0) {
      return emptyReviewRow(sourceRow, searchKeywords, 'no_match', [
        ...notes,
        '有圖書候選，但書名標準化後無明確匹配',
      ]);
    }

    const best = pickBestCandidate(title, matchingCandidates);
    const bestNormalized = normalizeTitle(best.title);
    const exactMatches = bookCandidates.filter(candidate => normalizeTitle(candidate.title) === sourceNormalized);
    const exactSameTitleCount = exactMatches.length;
    let needsAttention = false;

    if (isShortTitle(sourceNormalized) && exactSameTitleCount > 1) {
      needsAttention = true;
      notes.push('短書名且有多個完全同名圖書候選，需人工確認版本/作者');
    }

    if (bestNormalized !== sourceNormalized) {
      notes.push('最佳候選不是完全同名，只是標準化/包含比對相符');
    }

    return matchedReviewRow(sourceRow, searchKeywords, best, 'matched', needsAttention, notes);
  } catch (err) {
    return emptyReviewRow(sourceRow, searchKeywords, 'error', [err.message || String(err)]);
  }
}

async function main() {
  const limit = Number(process.argv[2] || 10);
  const sourceRows = parseCsv(fs.readFileSync(BOOKLIST_PATH, 'utf8')).slice(0, limit);
  const reviewRows = [];

  for (const row of sourceRows) {
    console.log(`[review] ${row['編號']} ${row['書名']}`);
    reviewRows.push(await buildReviewRow(row));
  }

  fs.writeFileSync(REVIEW_PATH, toCsv(reviewRows), 'utf8');
  console.log(`[review] wrote ${reviewRows.length} rows to ${path.relative(ROOT, REVIEW_PATH)}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  BOOK_DATA_TYPE,
  normalizeTitle,
  titleVariants,
  parseCsv,
  toCsv,
  buildReviewRow,
};

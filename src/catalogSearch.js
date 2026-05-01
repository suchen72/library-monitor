const https = require('https');

const BASE_URL = 'https://book.tpml.edu.tw';
const GRAPHQL_URL = `${BASE_URL}/api/HyLibWS/graphql`;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const SEARCH_QUERY = `query search($searchForm: SearchForm) {
  search(Input: $searchForm) {
    info { total }
    list { values { ref { key value } } }
  }
}`;

// Cache CSRF token + cookies (valid for ~15 minutes)
let tokenCache = { csrf: null, cookies: null, ts: 0 };
const TOKEN_TTL = 10 * 60 * 1000; // 10 min

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      const cookies = res.headers['set-cookie'] || [];
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ body, cookies }));
    }).on('error', reject);
  });
}

function httpPost(url, headers, payload) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', headers }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(JSON.stringify(payload));
    req.end();
  });
}

async function getCsrfToken() {
  if (tokenCache.csrf && Date.now() - tokenCache.ts < TOKEN_TTL) {
    return tokenCache;
  }
  const { body, cookies } = await httpGet(BASE_URL);
  const match = body.match(/"csrfToken":"([^"]+)"/);
  if (!match) throw new Error('Failed to get CSRF token');
  tokenCache = {
    csrf: match[1],
    cookies: cookies.map(c => c.split(';')[0]).join('; '),
    ts: Date.now(),
  };
  return tokenCache;
}

/**
 * Search Taipei Public Library catalog by title keyword via GraphQL API.
 * @param {string} keyword - book title to search
 * @param {number} [maxResults=10] - max results to return
 * @returns {Promise<Array<{title, bookId, holdings, available, reservable, waitingCount}>>}
 */
async function searchCatalog(keyword, maxResults = 10) {
  const { csrf, cookies } = await getCsrfToken();

  const { statusCode, body } = await httpPost(GRAPHQL_URL, {
    'Content-Type': 'application/json',
    'x-csrf-token': csrf,
    'Cookie': cookies,
    'User-Agent': USER_AGENT,
    'Origin': BASE_URL,
  }, {
    operationName: 'search',
    variables: {
      searchForm: {
        searchField: ['TI'],
        searchInput: [keyword],
        op: [],
        keepsite: [],
        cln: [],
        pageNo: 1,
        limit: Math.max(maxResults, 100),
        queryString: `searchField=TI&searchInput=${encodeURIComponent(keyword)}`,
      },
    },
    query: SEARCH_QUERY,
  });

  if (statusCode === 403) {
    // Token expired, clear cache and retry once
    tokenCache = { csrf: null, cookies: null, ts: 0 };
    return searchCatalog(keyword, maxResults);
  }

  const data = JSON.parse(body);
  if (data.errors) {
    throw new Error(`GraphQL error: ${data.errors[0].message}`);
  }

  const values = data.data?.search?.list?.values || [];
  const results = [];

  for (let i = 0; i < Math.min(values.length, maxResults); i++) {
    const refs = values[i].ref || [];
    const kv = {};
    for (const r of refs) kv[r.key] = r.value;

    if (!kv.sid || !kv.title) continue;

    results.push({
      title: kv.title,
      bookId: kv.sid,
      author: kv.author || '',
      imprint: kv.imprint || '',
      dataType: kv.feaName || '', // common:webpac.dataType.book = 圖書, .eresource = 電子資源
      holdings: parseInt(kv.holdNum, 10) || 0,
      available: parseInt(kv.onShelveNum, 10) || 0,
      reservable: parseInt(kv.allowBookingNum, 10) || 0,
      waitingCount: parseInt(kv.waitBookingNum, 10) || 0,
    });
  }

  return results;
}

module.exports = { searchCatalog };

let currentFavorites = [];
let currentTags = ['可可貝貝', '包包', '大人'];
let favFilterTag = null; // null = show all
let currentWishlist = [];
let wishlistFilterTag = null; // null = show all (shared concept, but wishlist has its own)
let ownedTitleSet = new Set();
let currentHistory = [];
let historySearch = '';

const TAG_COLORS = {
  '包包':    { color: '#e53e3e', label: '包' },
  '可可貝貝': { color: '#d69e2e', label: '可' },
  '大人':    { color: '#3182ce', label: '大' },
};

window.addEventListener('DOMContentLoaded', () => {
  loadData();
  document.getElementById('refreshBtn').addEventListener('click', triggerRefresh);

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.getElementById('content').style.display = tab === 'dashboard' ? '' : 'none';
      document.getElementById('emptyState').style.display = 'none';
      document.getElementById('favoritesContent').style.display = tab === 'favorites' ? '' : 'none';
      document.getElementById('historyContent').style.display = tab === 'history' ? '' : 'none';
      if (tab === 'favorites') loadFavorites();
      if (tab === 'history') loadHistory();
    });
  });
});

// --- Load and render ---
async function loadData() {
  try {
    const [dataRes, favRes, wishRes, histRes] = await Promise.all([
      fetch('/api/data'),
      fetch('/api/favorites'),
      fetch('/api/wishlist'),
      fetch('/api/history'),
    ]);
    if (!dataRes.ok) throw new Error('Failed to fetch data');
    const data = await dataRes.json();
    if (favRes.ok) {
      const favData = await favRes.json();
      currentFavorites = favData.favorites || [];
    }
    if (wishRes.ok) {
      const wishData = await wishRes.json();
      currentWishlist = wishData.wishlist || [];
    }
    if (histRes.ok) {
      const histData = await histRes.json();
      currentHistory = histData.entries || [];
    }
    rebuildOwnedTitleSet(data, { entries: currentHistory });
    renderDashboard(data);
  } catch (err) {
    showBanner('error', '無法取得資料：' + err.message);
  }
}

function rebuildOwnedTitleSet(data, history) {
  const set = new Set();
  for (const a of (data?.accounts || [])) {
    for (const b of (a.borrowed || [])) if (b?.title) set.add(b.title);
    for (const r of (a.reservations || [])) if (r?.title) set.add(r.title);
  }
  for (const e of (history?.entries || [])) if (e?.title) set.add(e.title);
  ownedTitleSet = set;
}

// --- Favorites ---
async function loadFavorites() {
  try {
    const [favRes, wishRes] = await Promise.all([
      fetch('/api/favorites'),
      fetch('/api/wishlist'),
    ]);
    if (!favRes.ok) throw new Error('Failed to fetch favorites');
    const data = await favRes.json();
    currentFavorites = data.favorites || [];
    currentTags = data.tags || currentTags;
    if (wishRes.ok) {
      const wishData = await wishRes.json();
      currentWishlist = wishData.wishlist || [];
    }
    renderFavoritesPage();
  } catch (err) {
    showBanner('error', '無法取得最愛清單：' + err.message);
  }
}

async function toggleFavorite(title, tag) {
  const existing = currentFavorites.find(f => f.title === title);
  const hasTag = existing && existing.tags.includes(tag);
  const method = hasTag ? 'DELETE' : 'POST';

  await fetch('/api/favorites', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, tag }),
  });

  // Update local state
  if (hasTag) {
    existing.tags = existing.tags.filter(t => t !== tag);
    if (existing.tags.length === 0) {
      currentFavorites = currentFavorites.filter(f => f.title !== title);
    }
  } else if (existing) {
    existing.tags.push(tag);
  } else {
    currentFavorites.push({ title, tags: [tag], dateAdded: new Date().toISOString() });
  }

  // Update heart button state in borrowed table
  const btn = document.querySelector(`.fav-btn[data-title="${CSS.escape(title)}"][data-tag="${CSS.escape(tag)}"]`);
  if (btn) btn.classList.toggle('fav-active', !hasTag);
}

function renderFavoritesPage() {
  const filteredFav = favFilterTag
    ? currentFavorites.filter(f => f.tags.includes(favFilterTag))
    : currentFavorites;
  const filteredWish = favFilterTag
    ? currentWishlist.filter(w => w.tags.includes(favFilterTag))
    : currentWishlist;

  // Shared filter buttons
  let filterHtml = '<div class="fav-filters">';
  filterHtml += `<button class="filter-btn ${!favFilterTag ? 'active' : ''}" onclick="setFavFilter(null)">全部</button>`;
  for (const tag of currentTags) {
    const tc = TAG_COLORS[tag] || { color: '#718096', label: tag[0] };
    const active = favFilterTag === tag ? ' active' : '';
    filterHtml += `<button class="filter-btn${active}" style="--tag-color:${tc.color}" onclick="setFavFilter('${escHtml(tag)}')">${escHtml(tag)}</button>`;
  }
  filterHtml += '</div>';

  // --- Favorites section ---
  let favHtml;
  if (filteredFav.length === 0) {
    favHtml = '<div class="section"><div class="section-title">我的最愛</div><div class="card-body" style="text-align:center;color:#a0aec0;padding:40px">還沒有最愛的書籍</div></div>';
  } else {
    const favRows = filteredFav.map(f => {
      const tagBadges = (f.tags || []).map(t => {
        const tc = TAG_COLORS[t] || { color: '#718096', label: t[0] };
        return `<span class="tag-badge" style="background:${tc.color}">${escHtml(t)}</span>`;
      }).join(' ');
      return `<tr>
        <td>${escHtml(f.title)}</td>
        <td>${tagBadges}</td>
        <td>${formatDateTime(f.dateAdded)}</td>
      </tr>`;
    }).join('');
    favHtml = `<div class="section">
      <div class="section-title">我的最愛（共 ${filteredFav.length} 本）</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>書名</th><th>誰的最愛</th><th>加入日期</th></tr></thead>
          <tbody>${favRows}</tbody>
        </table>
      </div>
    </div>`;
  }

  // --- Wishlist add form ---
  const tagChecks = currentTags.map(tag => {
    const tc = TAG_COLORS[tag] || { color: '#718096', label: tag[0] };
    return `<label class="wishlist-tag-label" style="--tag-color:${tc.color}"><input type="checkbox" class="wishlist-tag-check" value="${escHtml(tag)}"> ${escHtml(tag)}</label>`;
  }).join(' ');

  const addFormHtml = `<div class="section wishlist-add">
    <div class="section-title">加入願望清單</div>
    <div class="wishlist-form">
      <input id="wishlistTitleInput" type="text" placeholder="書名" />
      <input id="wishlistNoteInput" type="text" placeholder="備註（選填）" />
      <div class="wishlist-tag-picker">${tagChecks}</div>
      <button onclick="addWishlistItem()">加入</button>
    </div>
  </div>`;

  // --- Wishlist section ---
  let wishHtml;
  if (filteredWish.length === 0) {
    wishHtml = '<div class="section"><div class="section-title">願望清單</div><div class="card-body" style="text-align:center;color:#a0aec0;padding:40px">還沒有想借的書</div></div>';
  } else {
    const wishRows = filteredWish.map(w => {
      const tagBadges = (w.tags || []).map(t => {
        const tc = TAG_COLORS[t] || { color: '#718096', label: t[0] };
        return `<span class="tag-badge" style="background:${tc.color}">${escHtml(t)}</span>`;
      }).join(' ');
      const owned = ownedTitleSet.has(w.title)
        ? '<span class="badge-owned">已借過</span>'
        : '—';
      return `<tr>
        <td>${escHtml(w.title)}</td>
        <td>${escHtml(w.note || '')}</td>
        <td>${tagBadges}</td>
        <td>${formatDateTime(w.dateAdded)}</td>
        <td>${owned}</td>
        <td><button class="remove-btn" onclick="removeWishlistItem('${escHtml(w.title)}')">刪除</button></td>
      </tr>`;
    }).join('');
    wishHtml = `<div class="section">
      <div class="section-title">願望清單（共 ${filteredWish.length} 本）</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>書名</th><th>備註</th><th>標籤</th><th>加入日期</th><th>狀態</th><th>操作</th></tr></thead>
          <tbody>${wishRows}</tbody>
        </table>
      </div>
    </div>`;
  }

  document.getElementById('favoritesContent').innerHTML = filterHtml + favHtml + addFormHtml + wishHtml;
}

function setFavFilter(tag) {
  favFilterTag = tag;
  renderFavoritesPage();
}

// --- Wishlist actions ---
async function addWishlistItem() {
  const titleInput = document.getElementById('wishlistTitleInput');
  const noteInput = document.getElementById('wishlistNoteInput');
  const title = titleInput.value.trim();
  if (!title) return;

  const tags = Array.from(document.querySelectorAll('.wishlist-tag-check:checked')).map(cb => cb.value);
  const note = noteInput.value.trim();

  await fetch('/api/wishlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, tags, note }),
  });

  // Update local state
  const existing = currentWishlist.find(w => w.title === title);
  if (existing) {
    for (const t of tags) { if (!existing.tags.includes(t)) existing.tags.push(t); }
    if (note) existing.note = note;
  } else {
    currentWishlist.push({ title, tags, note, dateAdded: new Date().toISOString() });
  }

  titleInput.value = '';
  noteInput.value = '';
  document.querySelectorAll('.wishlist-tag-check').forEach(cb => cb.checked = false);
  renderFavoritesPage();
}

async function removeWishlistItem(title) {
  await fetch('/api/wishlist', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  currentWishlist = currentWishlist.filter(w => w.title !== title);
  renderFavoritesPage();
}

// --- Reading history ---
async function loadHistory() {
  try {
    const res = await fetch('/api/history');
    if (!res.ok) throw new Error('Failed to fetch history');
    const data = await res.json();
    currentHistory = data.entries || [];
    renderHistoryPage();
  } catch (err) {
    showBanner('error', '無法取得閱讀歷史：' + err.message);
  }
}

function setHistorySearch(value) {
  historySearch = value;
  renderHistoryPage();
}

function renderHistoryPage() {
  // 搜尋框（保留輸入狀態）
  const searchHtml = `
    <div class="fav-filters">
      <input
        type="search"
        id="historySearchInput"
        placeholder="搜尋書名..."
        value="${escHtml(historySearch)}"
        oninput="setHistorySearch(this.value)"
        style="padding:6px 10px;border:1px solid #cbd5e0;border-radius:6px;font-size:14px;min-width:220px"
      />
    </div>`;

  const keyword = historySearch.trim().toLowerCase();
  const filtered = keyword
    ? currentHistory.filter(e => (e.title || '').toLowerCase().includes(keyword))
    : currentHistory;

  // 按 returnedDate 降冪（最近歸還在上）
  const sorted = [...filtered].sort((a, b) =>
    (b.returnedDate || '').localeCompare(a.returnedDate || '')
  );

  if (sorted.length === 0) {
    const empty = currentHistory.length === 0
      ? '還沒有閱讀紀錄，有書歸還後會自動記錄'
      : '沒有符合搜尋條件的紀錄';
    document.getElementById('historyContent').innerHTML = searchHtml +
      `<div class="section"><div class="section-title">閱讀歷史</div><div class="card-body" style="text-align:center;color:#a0aec0;padding:40px">${empty}</div></div>`;
    // 保持輸入框 focus
    const input = document.getElementById('historySearchInput');
    if (input && document.activeElement !== input && keyword) input.focus();
    return;
  }

  const rows = sorted.map(e => {
    const period = formatPeriod(e.firstSeen, e.returnedDate);
    const days = computeDaysBetween(e.firstSeen, e.returnedDate);
    const daysLabel = days == null ? '-' : `${days} 天`;
    return `<tr>
      <td>${escHtml(e.title)}</td>
      <td>${period}</td>
      <td>${daysLabel}</td>
    </tr>`;
  }).join('');

  document.getElementById('historyContent').innerHTML = searchHtml + `<div class="section">
    <div class="section-title">閱讀歷史（共 ${sorted.length} 本已讀完${keyword ? ` / 符合搜尋` : ''}）</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>書名</th><th>借閱期間</th><th>天數</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;

  // 搜尋輸入時 innerHTML 重繪，focus 會跑掉，補回來
  const input = document.getElementById('historySearchInput');
  if (input && keyword && document.activeElement !== input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

function formatPeriod(firstSeen, returnedDate) {
  const f = firstSeen ? shortDate(firstSeen) : '?';
  const r = returnedDate ? shortDate(returnedDate) : '?';
  return `${f} ~ ${r}`;
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function computeDaysBetween(firstSeen, returnedDate) {
  if (!firstSeen || !returnedDate) return null;
  const a = new Date(firstSeen);
  const b = new Date(returnedDate);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.max(0, Math.floor((b - a) / 86400000));
}

// --- Trigger refresh ---
async function triggerRefresh() {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>更新中…';
  showBanner('info', '正在更新資料…');

  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    const result = await res.json();
    if (result.status === 'already-refreshing') {
      showBanner('warning', '已有更新正在進行中');
    } else {
      // Listen to SSE for progress
      listenRefreshStatus();
    }
  } catch (err) {
    showBanner('error', '觸發更新失敗：' + err.message);
    btn.disabled = false;
    btn.textContent = '立即更新';
  }
}

function listenRefreshStatus() {
  const es = new EventSource('/api/refresh-status');
  es.onmessage = (e) => {
    const event = JSON.parse(e.data);
    if (event.type === 'complete') {
      es.close();
      showBanner('info', '更新完成！');
      document.getElementById('refreshBtn').disabled = false;
      document.getElementById('refreshBtn').textContent = '立即更新';
      loadData();
    } else if (event.type === 'error-fatal') {
      es.close();
      showBanner('error', '更新失敗：' + (event.message || '未知錯誤'));
      document.getElementById('refreshBtn').disabled = false;
      document.getElementById('refreshBtn').textContent = '立即更新';
    } else if (event.type === 'started' || event.type === 'logging-in') {
      showBanner('info', `正在更新 ${event.label || ''}…`);
    } else if (event.type === 'done') {
      showBanner('info', `${event.label || ''} 更新完成`);
    }
  };
  es.onerror = () => {
    es.close();
    document.getElementById('refreshBtn').disabled = false;
    document.getElementById('refreshBtn').textContent = '立即更新';
    loadData();
  };
}

function renderDashboard(data) {
  const accounts = data.accounts || [];

  document.getElementById('lastUpdated').textContent =
    data.lastUpdated ? '更新時間：' + formatDateTime(data.lastUpdated) : '尚未更新';

  if (accounts.length === 0) {
    document.getElementById('emptyState').style.display = 'block';
    document.getElementById('content').innerHTML = '';
    return;
  }
  document.getElementById('emptyState').style.display = 'none';

  const allBorrowed = accounts.flatMap(a =>
    (a.borrowed || []).map(b => ({ ...b, accountId: a.id, accountLabel: a.label || a.id, accountStatus: a.status }))
  );
  const allReservations = accounts.flatMap(a =>
    (a.reservations || []).map(r => ({ ...r, accountId: a.id, accountLabel: a.label || a.id }))
  );

  const readyReservations = allReservations.filter(r => r.isReady);

  // Sort: 待領(0) > 調撥中(1) > 排隊(2), then by account label
  const sortedReservations = [...allReservations].sort((a, b) => {
    const priority = (r) => r.isReady ? 0 : r.isInTransit ? 1 : 2;
    const pa = priority(a), pb = priority(b);
    if (pa !== pb) return pa - pb;
    // 排隊中：按順位排序
    if (pa === 2) {
      const qa = a.queuePosition ?? Infinity, qb = b.queuePosition ?? Infinity;
      if (qa !== qb) return qa - qb;
    }
    return (a.accountLabel || '').localeCompare(b.accountLabel || '');
  });

  document.getElementById('content').innerHTML =
    renderAccountSummary(accounts) +
    renderReadyBanner(readyReservations) +
    renderBorrowedTable(allBorrowed) +
    renderReservationsTable(sortedReservations);
}

// --- Account summary bar ---
function renderAccountSummary(accounts) {
  const badges = accounts.map(a => {
    const cls = { ok: 'status-ok', error: 'status-error' }[a.status] || 'status-ok';
    const label = { ok: '正常', error: '錯誤' }[a.status] || a.status;
    return `<span class="account-badge">
      ${escHtml(a.label || a.id)}
      <span class="status-badge ${cls}">${label}</span>
    </span>`;
  }).join('');
  return `<div class="account-summary">${badges}</div>`;
}

// --- Ready pickup alert banner ---
function renderReadyBanner(readyItems) {
  if (readyItems.length === 0) return '';
  const titles = readyItems.map(r =>
    `「${escHtml(r.title.substring(0, 20))}${r.title.length > 20 ? '…' : ''}」(${escHtml(r.accountLabel)})`
  ).join('、');
  return `<div class="ready-alert">🔔 有 ${readyItems.length} 本預約書可以領取：${titles}</div>`;
}

// --- Borrowed books table ---
function renderBorrowedTable(books) {
  const sorted = [...books].sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));

  const rows = sorted.length === 0
    ? `<tr class="empty-row"><td colspan="8">目前無借閱書籍</td></tr>`
    : sorted.map(b => {
        const dueClass = getDueClass(b.dueDate);
        const dueLabel = getDueLabel(b.dueDate);
        const effectivelyNonRenewable = !b.canRenew || (b.renewalCount >= 3) || (b.reservationCount > 0);
        const renewCol = effectivelyNonRenewable
          ? '<span class="badge-no">不可續借</span>'
          : `<button class="renew-btn" onclick="doRenew('${escHtml(b.accountId)}', this)" data-title="${escHtml(b.title)}">續借</button>`;
        const reserveCount = (b.reservationCount > 0)
          ? `<span class="badge-overdue">${b.reservationCount} 人</span>`
          : '0';
        const favEntry = currentFavorites.find(f => f.title === b.title);
        const hearts = currentTags.map(tag => {
          const tc = TAG_COLORS[tag] || { color: '#718096', label: tag[0] };
          const active = favEntry && favEntry.tags.includes(tag);
          return `<button class="fav-btn ${active ? 'fav-active' : ''}" data-title="${escHtml(b.title)}" data-tag="${escHtml(tag)}" style="--heart-color:${tc.color}" onclick="toggleFavorite(this.dataset.title, this.dataset.tag)" title="${escHtml(tag)}">&#9829;</button>`;
        }).join('');
        const rowClass = dueClass === 'due-overdue' ? ' class="row-overdue"' : '';
        return `<tr${rowClass}>
          <td><span class="acct-tag">${escHtml(b.accountLabel)}</span></td>
          <td>${escHtml(b.title)}</td>
          <td class="${dueClass}">${b.dueDate || '-'} ${dueLabel}</td>
          <td>${(b.renewalCount ?? 0) >= 3 ? `<span class="badge-overdue">${b.renewalCount} 次</span>` : `${b.renewalCount ?? '-'} 次`}</td>
          <td>${reserveCount}</td>
          <td>${renewCol}</td>
          <td class="fav-col">${hearts}</td>
          <td class="check-col"><input type="checkbox" class="found-check"></td>
        </tr>`;
      }).join('');

  const overdueCount = sorted.filter(b => getDueClass(b.dueDate) === 'due-overdue').length;
  const overdueNote = overdueCount > 0 ? `，<span class="overdue-count">${overdueCount} 本逾期</span>` : '';
  const hasRenewable = sorted.some(b => b.canRenew && (b.renewalCount ?? 0) < 3 && (b.reservationCount ?? 0) === 0);

  return `
    <div class="section">
      <div class="section-title section-title-flex">
        <span>借閱中（共 ${books.length} 本${overdueNote}，依到期日排序）</span>
        ${hasRenewable ? `<span class="renew-before-group"><input type="date" id="renewBeforeDate" class="renew-date-input" value="${defaultRenewDate()}"><button class="renew-all-btn" onclick="doRenewBefore()">續借到期日前的書</button></span>` : ''}
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>帳號</th><th>書名</th><th>到期日</th><th>已續借</th><th>預約</th><th>狀態</th><th>最愛</th><th>找到</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// --- Reservations table ---
function renderReservationsTable(sortedItems) {
  const totalReady = sortedItems.filter(r => r.isReady).length;

  const rows = sortedItems.length === 0
    ? `<tr class="empty-row"><td colspan="4">目前無預約</td></tr>`
    : sortedItems.map(r => {
        let badge = '';
        let rowClass = '';
        let lastCol = '';
        if (r.isReady) {
          badge = '<span class="reserve-badge">待領</span>';
          lastCol = `<td class="${getDueClass(r.pickupDeadline)}">${r.pickupDeadline || '-'}</td>`;
        } else if (r.isInTransit) {
          badge = '<span class="badge-transit">調撥中</span>';
          rowClass = ' class="row-other"';
          lastCol = `<td>${escHtml(r.status ? r.status.substring(0, 40) : '-')}</td>`;
        } else {
          if (r.queuePosition) badge = `<span class="badge-queue">排隊第 ${r.queuePosition} 位</span>`;
          rowClass = ' class="row-other"';
          lastCol = `<td>${escHtml(r.status ? r.status.substring(0, 40) : '-')}</td>`;
        }
        return `<tr${rowClass}>
          <td><span class="acct-tag">${escHtml(r.accountLabel)}</span></td>
          <td>${badge} ${escHtml(r.title)}</td>
          <td>${escHtml(r.pickupBranch || '-')}</td>
          ${lastCol}
        </tr>`;
      }).join('');

  return `
    <div class="section">
      <div class="section-title">我的預約（共 ${sortedItems.length} 本，${totalReady} 本可領取）</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>帳號</th><th>書名</th><th>取書館別</th><th>截止日／狀態</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// --- Banner ---
function showBanner(type, message) {
  const b = document.getElementById('statusBanner');
  b.className = type;
  b.textContent = message;
  b.style.display = 'block';
}

// --- Helpers ---
function getDaysLeft(dateStr) {
  if (!dateStr) return null;
  const due = new Date(dateStr);
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.floor((due - today) / 86400000);
}

function getDueClass(dateStr) {
  const days = getDaysLeft(dateStr);
  if (days === null) return '';
  if (days < 0) return 'due-overdue';
  if (days <= 2) return 'due-red';
  if (days <= 7) return 'due-yellow';
  return 'due-green';
}

function getDueLabel(dateStr) {
  const days = getDaysLeft(dateStr);
  if (days === null) return '';
  if (days < 0) return `<span class="badge-overdue">逾期 ${Math.abs(days)} 天</span>`;
  if (days === 0) return `<span class="badge-today">今天到期</span>`;
  if (days <= 2) return `<span class="badge-urgent">剩 ${days} 天</span>`;
  return '';
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// --- Renew ---
function defaultRenewDate() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

async function doRenew(accountId, btn) {
  const title = btn.dataset.title;
  btn.disabled = true;
  btn.textContent = '續借中…';
  btn.classList.add('renew-loading');
  showBanner('info', `正在續借「${title}」…`);

  try {
    await fetch('/api/renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, accountId }),
    });

    // Listen for result via SSE
    const es = new EventSource('/api/refresh-status');
    const timeout = setTimeout(() => {
      es.close();
      btn.textContent = '逾時';
      btn.classList.remove('renew-loading');
      showBanner('warning', `續借「${title}」逾時，請稍後確認結果`);
    }, 60000);

    es.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === 'renew-result' && event.title === title) {
        clearTimeout(timeout);
        es.close();
        btn.classList.remove('renew-loading');
        if (event.success) {
          btn.textContent = '已續借';
          btn.classList.add('renew-done');
          showBanner('info', event.message);
        } else {
          btn.textContent = '失敗';
          btn.classList.add('renew-failed');
          showBanner('error', event.message);
        }
      }
    };
    es.onerror = () => {
      clearTimeout(timeout);
      es.close();
      btn.textContent = '錯誤';
      btn.classList.remove('renew-loading');
    };
  } catch (err) {
    btn.textContent = '錯誤';
    btn.classList.remove('renew-loading');
    showBanner('error', '觸發續借失敗：' + err.message);
  }
}

async function doRenewBefore() {
  const btn = document.querySelector('.renew-all-btn');
  const dateInput = document.getElementById('renewBeforeDate');
  if (!btn || !dateInput) return;

  const beforeDate = dateInput.value;
  if (!beforeDate) {
    showBanner('warning', '請選擇到期日期');
    return;
  }

  btn.disabled = true;
  btn.textContent = '續借中…';
  showBanner('info', `正在續借 ${beforeDate} 前到期的書…`);

  // Collect unique accountIds from the current data
  const accountIds = [...new Set(
    document.querySelectorAll('.renew-btn:not(:disabled)')
  )].map(b => b.getAttribute('onclick')?.match(/'(account\d+)'/)?.[1]).filter(Boolean);

  const uniqueIds = [...new Set(accountIds)];
  const allResults = [];

  for (const accountId of uniqueIds) {
    try {
      const resp = await fetch('/api/renew-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, beforeDate }),
      });

      const body = await resp.json();
      if (body.status === 'done') continue; // no matching books for this account

      // Wait for renew-all-done SSE event
      await new Promise((resolve) => {
        const es = new EventSource('/api/refresh-status');
        const timeout = setTimeout(() => { es.close(); resolve(); }, 120000);
        es.onmessage = (e) => {
          const event = JSON.parse(e.data);
          if (event.type === 'renew-result' && event.accountId === accountId) {
            allResults.push(event);
            // Update individual buttons
            const btns = document.querySelectorAll(`.renew-btn[data-title="${CSS.escape(event.title)}"]`);
            btns.forEach(b => {
              b.disabled = true;
              b.classList.remove('renew-loading');
              if (event.success) {
                b.textContent = '已續借';
                b.classList.add('renew-done');
              } else if (event.message !== '不可續借') {
                b.textContent = '失敗';
                b.classList.add('renew-failed');
              }
            });
          }
          if (event.type === 'renew-all-done' && event.accountId === accountId) {
            clearTimeout(timeout);
            es.close();
            resolve();
          }
        };
        es.onerror = () => { clearTimeout(timeout); es.close(); resolve(); };
      });
    } catch (err) {
      console.error(`renew-before error for ${accountId}:`, err);
    }
  }

  const succeeded = allResults.filter(r => r.success).length;
  const failed = allResults.filter(r => !r.success && r.message !== '不可續借').length;
  btn.disabled = false;
  btn.textContent = '續借到期日前的書';

  if (succeeded > 0 || failed > 0) {
    showBanner(failed > 0 ? 'warning' : 'info',
      `續借完成：${succeeded} 本成功${failed > 0 ? `，${failed} 本失敗` : ''}`);
  } else {
    showBanner('info', '沒有符合條件的書需要續借');
  }
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let currentFavorites = [];
let currentTags = ['包包', '可可貝貝', '大人'];
let favFilterTag = null; // null = show all

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
      if (tab === 'favorites') loadFavorites();
    });
  });
});

// --- Load and render ---
async function loadData() {
  try {
    const [dataRes, favRes] = await Promise.all([
      fetch('/api/data'),
      fetch('/api/favorites'),
    ]);
    if (!dataRes.ok) throw new Error('Failed to fetch data');
    if (favRes.ok) {
      const favData = await favRes.json();
      currentFavorites = favData.favorites || [];
    }
    renderDashboard(await dataRes.json());
  } catch (err) {
    showBanner('error', '無法取得資料：' + err.message);
  }
}

// --- Favorites ---
async function loadFavorites() {
  try {
    const res = await fetch('/api/favorites');
    if (!res.ok) throw new Error('Failed to fetch favorites');
    const data = await res.json();
    currentFavorites = data.favorites || [];
    currentTags = data.tags || currentTags;
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
  const filtered = favFilterTag
    ? currentFavorites.filter(f => f.tags.includes(favFilterTag))
    : currentFavorites;

  // Filter buttons
  let filterHtml = '<div class="fav-filters">';
  filterHtml += `<button class="filter-btn ${!favFilterTag ? 'active' : ''}" onclick="setFavFilter(null)">全部</button>`;
  for (const tag of currentTags) {
    const tc = TAG_COLORS[tag] || { color: '#718096', label: tag[0] };
    const active = favFilterTag === tag ? ' active' : '';
    filterHtml += `<button class="filter-btn${active}" style="--tag-color:${tc.color}" onclick="setFavFilter('${escHtml(tag)}')">${escHtml(tag)}</button>`;
  }
  filterHtml += '</div>';

  if (filtered.length === 0) {
    document.getElementById('favoritesContent').innerHTML = filterHtml +
      '<div class="section"><div class="section-title">我的最愛</div><div class="card-body" style="text-align:center;color:#a0aec0;padding:40px">還沒有最愛的書籍</div></div>';
    return;
  }

  const rows = filtered.map(f => {
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

  document.getElementById('favoritesContent').innerHTML = filterHtml + `<div class="section">
    <div class="section-title">我的最愛（共 ${filtered.length} 本）</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>書名</th><th>誰的最愛</th><th>加入日期</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function setFavFilter(tag) {
  favFilterTag = tag;
  renderFavoritesPage();
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
        const canRenew = effectivelyNonRenewable
          ? '<span class="badge-no">不可續借</span>'
          : '<span class="badge-yes">可續借</span>';
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
          <td>${canRenew}</td>
          <td class="fav-col">${hearts}</td>
          <td class="check-col"><input type="checkbox" class="found-check"></td>
        </tr>`;
      }).join('');

  const overdueCount = sorted.filter(b => getDueClass(b.dueDate) === 'due-overdue').length;
  const overdueNote = overdueCount > 0 ? `，<span class="overdue-count">${overdueCount} 本逾期</span>` : '';

  return `
    <div class="section">
      <div class="section-title">借閱中（共 ${books.length} 本${overdueNote}，依到期日排序）</div>
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

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let sseSource = null;

window.addEventListener('DOMContentLoaded', () => {
  loadData();
  setInterval(loadData, 60000);
});

// --- Load and render ---
async function loadData() {
  try {
    const res = await fetch('/api/data');
    if (!res.ok) throw new Error('Failed to fetch data');
    renderDashboard(await res.json());
  } catch (err) {
    showBanner('error', '無法取得資料：' + err.message);
  }
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

  // Flatten all borrowed books and reservations with account label attached
  const allBorrowed = accounts.flatMap(a =>
    (a.borrowed || []).map(b => ({ ...b, accountId: a.id, accountLabel: a.label || a.id, accountStatus: a.status }))
  );
  const allReservations = accounts.flatMap(a =>
    (a.reservations || []).map(r => ({ ...r, accountId: a.id, accountLabel: a.label || a.id }))
  );

  const readyReservations = allReservations.filter(r => r.isReady);
  const otherReservations = allReservations.filter(r => !r.isReady);

  document.getElementById('content').innerHTML =
    renderAccountSummary(accounts) +
    renderReadyBanner(readyReservations) +
    renderBorrowedTable(allBorrowed) +
    renderReservationsTable(readyReservations, otherReservations);
}

// --- Account summary bar ---
function renderAccountSummary(accounts) {
  const badges = accounts.map(a => {
    const cls = { ok: 'status-ok', error: 'status-error', refreshing: 'status-refreshing' }[a.status] || 'status-ok';
    const label = { ok: '正常', error: '錯誤', refreshing: '更新中' }[a.status] || a.status;
    return `<span class="account-badge">
      ${escHtml(a.label || a.id)}
      <span class="status-badge ${cls}" id="badge-${escHtml(a.id)}">${label}</span>
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
    ? `<tr class="empty-row"><td colspan="5">目前無借閱書籍</td></tr>`
    : sorted.map(b => {
        const dueClass = getDueClass(b.dueDate);
        const dueLabel = getDueLabel(b.dueDate);
        const canRenew = b.canRenew
          ? '<span class="badge-yes">可續借</span>'
          : '<span class="badge-no">-</span>';
        const rowClass = dueClass === 'due-overdue' ? ' class="row-overdue"' : '';
        return `<tr${rowClass}>
          <td><span class="acct-tag">${escHtml(b.accountLabel)}</span></td>
          <td>${escHtml(b.title)}</td>
          <td class="${dueClass}">${b.dueDate || '-'} ${dueLabel}</td>
          <td>${b.renewalCount ?? '-'} 次</td>
          <td>${canRenew}</td>
        </tr>`;
      }).join('');

  const overdueCount = sorted.filter(b => getDueClass(b.dueDate) === 'due-overdue').length;
  const overdueNote = overdueCount > 0 ? `，<span class="overdue-count">${overdueCount} 本逾期</span>` : '';

  return `
    <div class="section">
      <div class="section-title">借閱中（共 ${books.length} 本${overdueNote}，依到期日排序）</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>帳號</th><th>書名</th><th>到期日</th><th>已續借</th><th>狀態</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// --- Reservations table ---
function renderReservationsTable(readyItems, otherItems) {
  const readyRows = readyItems.length === 0
    ? `<tr class="empty-row"><td colspan="4">目前無待領取預約</td></tr>`
    : readyItems.map(r => `<tr>
        <td><span class="acct-tag">${escHtml(r.accountLabel)}</span></td>
        <td><span class="reserve-badge">待領</span> ${escHtml(r.title)}</td>
        <td>${escHtml(r.pickupBranch || '-')}</td>
        <td class="${getDueClass(r.pickupDeadline)}">${r.pickupDeadline || '-'}</td>
      </tr>`).join('');

  const otherRows = otherItems.map(r => {
    let badge = '';
    if (r.isInTransit) badge = '<span class="badge-transit">調撥中</span>';
    else if (r.queuePosition) badge = `<span class="badge-queue">排隊第 ${r.queuePosition} 位</span>`;
    return `<tr class="row-other">
      <td><span class="acct-tag">${escHtml(r.accountLabel)}</span></td>
      <td>${badge} ${escHtml(r.title)}</td>
      <td>${escHtml(r.pickupBranch || '-')}</td>
      <td>${escHtml(r.status ? r.status.substring(0, 40) : '-')}</td>
    </tr>`;
  }).join('');

  const totalReady = readyItems.length;
  const total = readyItems.length + otherItems.length;

  return `
    <div class="section">
      <div class="section-title">我的預約（共 ${total} 本，${totalReady} 本可領取）</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>帳號</th><th>書名</th><th>取書館別</th><th>截止日／狀態</th></tr></thead>
          <tbody>${readyRows}${otherRows}</tbody>
        </table>
      </div>
    </div>`;
}

// --- Refresh ---
async function triggerRefresh() {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>更新中...';
  showBanner('info', '正在更新借閱資訊，請稍候...');

  try {
    await fetch('/api/refresh', { method: 'POST' });
  } catch (err) {
    showBanner('error', '無法觸發更新：' + err.message);
    resetRefreshBtn();
    return;
  }

  if (sseSource) sseSource.close();
  sseSource = new EventSource('/api/refresh-status');
  sseSource.onmessage = (e) => handleSseEvent(JSON.parse(e.data));
  sseSource.onerror = () => { sseSource.close(); resetRefreshBtn(); loadData(); };
}

function handleSseEvent(event) {
  switch (event.type) {
    case 'started':
      showBanner('info', `正在更新「${event.label}」...`);
      setBadgeStatus(event.accountId, 'refreshing');
      break;
    case 'logging-in':
      showBanner('info', `正在登入「${event.label}」...`);
      break;
    case 'captcha-required':
      showBanner('warning', `⚠️ 「${event.label}」需要輸入驗證碼 — 請查看已開啟的瀏覽器視窗，輸入驗證碼後點擊登入`);
      break;
    case 'done':
      setBadgeStatus(event.accountId, 'ok');
      break;
    case 'error':
      setBadgeStatus(event.accountId, 'error');
      showBanner('error', `「${event.label}」更新失敗：${event.message}`);
      break;
    case 'complete':
    case 'error-fatal':
      if (sseSource) sseSource.close();
      resetRefreshBtn();
      hideBanner();
      loadData();
      break;
  }
}

function setBadgeStatus(accountId, status) {
  const badge = document.getElementById('badge-' + accountId);
  if (!badge) return;
  badge.className = 'status-badge status-' + status;
  badge.textContent = { ok: '正常', error: '錯誤', refreshing: '更新中' }[status] || status;
}

function resetRefreshBtn() {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = false;
  btn.textContent = '立即更新';
}

// --- Banner ---
function showBanner(type, message) {
  const b = document.getElementById('statusBanner');
  b.className = type;
  b.textContent = message;
  b.style.display = 'block';
}
function hideBanner() {
  document.getElementById('statusBanner').style.display = 'none';
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

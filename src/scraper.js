const { chromium } = require('playwright');
const fs = require('fs');
const { readAccounts, writeData, readData, getSessionPath } = require('./dataStore');
const captchaSolver = require('./captchaSolver');

const BASE_URL = 'https://book.tpml.edu.tw';

function getBorrowLimit(cardNumber) {
  if (cardNumber && cardNumber.toUpperCase().startsWith('FA')) return 30;
  return 25;
}

// --- Selectors (discovered from live site) ---
const SEL = {
  loginBtn: 'button.btn.btn-sm',           // "登入" button in header
  username: 'input#username',
  password: 'input#password',
  captchaInput: 'input[name="captcha"]',
  submitBtn: 'input#loginBtn',
  // Member pages (confirmed from live site)
  borrowedPage: '/personal/list?action=getLendFile&form=QueryForm',
  reservePage: '/personal/list?action=getTPMLReadBook&form=QueryForm',
  // Book list items (confirmed from live site)
  bookItem: '.booklist',
  bookTitle: 'h2 a',
  bookStatus: 'span.word_red',
};

// How long to wait for user to solve CAPTCHA (5 minutes)
const CAPTCHA_TIMEOUT_MS = 5 * 60 * 1000;

// Use consistent user-agent across headless and visible modes
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let _emitEvent = () => {};

function setEmitter(fn) {
  _emitEvent = fn;
}

async function scrapeAll(emitEvent) {
  if (emitEvent) _emitEvent = emitEvent;

  const accounts = readAccounts();
  const existing = readData();
  const results = [];

  for (const account of accounts) {
    _emitEvent({ type: 'started', accountId: account.id, label: account.label });
    try {
      const data = await scrapeAccount(account);
      results.push(data);
      _emitEvent({ type: 'done', accountId: account.id, label: account.label });
    } catch (err) {
      console.error(`[${account.id}] Error:`, err.message);
      // Preserve previous data, just update status/error
      const prev = (existing.accounts || []).find(a => a.id === account.id) || {};
      results.push({
        ...prev,
        id: account.id,
        label: account.label,
        status: 'error',
        error: err.message,
        lastScraped: new Date().toISOString(),
      });
      _emitEvent({ type: 'error', accountId: account.id, label: account.label, message: err.message });
    }
  }

  writeData({ lastUpdated: new Date().toISOString(), accounts: results });
  _emitEvent({ type: 'complete' });
  return results;
}

async function scrapeAccount(account) {
  const sessionPath = getSessionPath(account.id);
  const hasSession = fs.existsSync(sessionPath);

  // Try session reuse if we have a saved session (works within same day)
  if (hasSession) {
    try {
      const result = await _scrapeWithSession(account, sessionPath);
      console.log(`[${account.id}] Session reuse succeeded`);
      return result;
    } catch (err) {
      console.log(`[${account.id}] Session expired, will prompt for CAPTCHA`);
      if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
    }
  }

  // No session or expired → interactive login with CAPTCHA
  return await _scrapeWithLogin(account, sessionPath);
}

async function _scrapeWithSession(account, sessionPath) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      storageState: sessionPath,
      locale: 'zh-TW',
      userAgent: USER_AGENT,
    });
    const page = await context.newPage();

    // Navigate to member page directly
    await page.goto(BASE_URL + SEL.borrowedPage, { waitUntil: 'networkidle', timeout: 20000 });

    // Check if still logged in
    const isLoggedIn = await _checkLogin(page);
    if (!isLoggedIn) {
      throw new Error('Session expired');
    }

    const borrowed = await _scrapeBorrowedBooks(page);
    await page.goto(BASE_URL + SEL.reservePage, { waitUntil: 'networkidle', timeout: 20000 });
    const reservations = await _scrapeReservations(page);

    // Save updated session
    await context.storageState({ path: sessionPath });
    await browser.close();

    return {
      id: account.id,
      label: account.label,
      borrowLimit: getBorrowLimit(account.cardNumber),
      status: 'ok',
      error: null,
      lastScraped: new Date().toISOString(),
      borrowed,
      reservations,
    };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

async function _scrapeWithLogin(account, sessionPath) {
  _emitEvent({ type: 'logging-in', accountId: account.id, label: account.label });

  // Auto-solve CAPTCHA with OCR — launch headless
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ locale: 'zh-TW', userAgent: USER_AGENT });
    const page = await context.newPage();

    await _login(page, account);

    // After login, scrape
    await page.goto(BASE_URL + SEL.borrowedPage, { waitUntil: 'networkidle', timeout: 20000 });
    const borrowed = await _scrapeBorrowedBooks(page);
    await page.goto(BASE_URL + SEL.reservePage, { waitUntil: 'networkidle', timeout: 20000 });
    const reservations = await _scrapeReservations(page);

    // Save session for potential same-session reuse
    await context.storageState({ path: sessionPath });
    await browser.close();

    return {
      id: account.id,
      label: account.label,
      borrowLimit: getBorrowLimit(account.cardNumber),
      status: 'ok',
      error: null,
      lastScraped: new Date().toISOString(),
      borrowed,
      reservations,
    };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

async function _login(page, account) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });

  // Click login button
  await page.locator(SEL.loginBtn).filter({ hasText: '登入' }).first().click();
  await page.waitForSelector(SEL.username, { timeout: 10000 });

  // Fill credentials
  await page.fill(SEL.username, account.cardNumber);
  await page.fill(SEL.password, account.password);

  // Wait for login modal to fully render (CAPTCHA image needs time to load)
  await page.waitForTimeout(2000);

  // Auto-solve CAPTCHA with OCR
  if (captchaSolver.isAvailable()) {
    _emitEvent({ type: 'captcha-solving', accountId: account.id, label: account.label });

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const captchaText = await captchaSolver.solveCaptcha(page);
        await page.fill(SEL.captchaInput, captchaText);
        await page.click(SEL.submitBtn);

        // Wait for redirect (login success)
        const success = await page.waitForURL(url => {
          const href = typeof url === 'string' ? url : url.href;
          return href.includes('loginstate') || href.includes('/personal');
        }, { timeout: 10000 }).then(() => true).catch(() => false);

        if (success) {
          console.log(`[${account.id}] CAPTCHA auto-solved on attempt ${attempt}`);
          _emitEvent({ type: 'captcha-solved', accountId: account.id, label: account.label });
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(2000);
          return;
        }

        // Login failed (wrong CAPTCHA), the page stays on login form
        console.log(`[${account.id}] CAPTCHA attempt ${attempt} wrong, retrying...`);
        // Re-fill credentials (page may have cleared them)
        await page.waitForSelector(SEL.username, { timeout: 5000 }).catch(() => {});
        await page.fill(SEL.username, account.cardNumber).catch(() => {});
        await page.fill(SEL.password, account.password).catch(() => {});
        await page.waitForTimeout(1000);
      } catch (err) {
        console.error(`[${account.id}] Auto-solve attempt ${attempt} error: ${err.message}`);
      }
    }

    console.log(`[${account.id}] Auto-solve failed after all attempts`);
  }

  // All auto-solve attempts failed
  throw new Error('CAPTCHA auto-solve failed — could not log in automatically');
}

async function _checkLogin(page) {
  try {
    // Many text indicators (登出, 歡迎來到您的個人書房, 該功能需要登入) are ALWAYS in the DOM
    // regardless of login state. Use VISIBILITY checks instead of text content.
    // When NOT logged in: CAPTCHA input and login button are visible
    // When logged in: CAPTCHA input is hidden, booklist items or data tables are visible
    const captchaVisible = await page.locator('input[name="captcha"]').isVisible().catch(() => false);
    if (captchaVisible) return false;  // login modal is showing → not logged in

    const loginBtnVisible = await page.locator('input#loginBtn').isVisible().catch(() => false);
    if (loginBtnVisible) return false;  // login button is showing → not logged in

    return true;  // no login prompt visible → session is valid
  } catch {
    return false;
  }
}

async function _scrapeBorrowedBooks(page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 });
  await page.waitForTimeout(1500);

  const borrowed = [];
  try {
    const items = await page.locator(SEL.bookItem).all();
    for (const item of items) {
      const parsed = await _parseBorrowedItem(item);
      if (parsed) borrowed.push(parsed);
    }
  } catch (err) {
    console.error('[scraper] Error scraping borrowed books:', err.message);
  }
  return borrowed;
}

async function _parseBorrowedItem(item) {
  try {
    // Title from h2 a
    const title = (await item.locator('h2 a').first().textContent())?.trim();
    if (!title) return null;

    // All li text for metadata
    const liTexts = await item.locator('li').allTextContents();
    const fullText = liTexts.join('\n');

    // Due date from span.word_red "應還日期 : 2026-03-31"
    const dueDateMatch = fullText.match(/應還日期\s*[:：]\s*(\d{4}-\d{2}-\d{2})/);
    const dueDate = dueDateMatch ? dueDateMatch[1] : null;

    // Renewal count "續借次數：0"
    const renewalMatch = fullText.match(/續借次數[:：]\s*(\d+)/);
    const renewalCount = renewalMatch ? parseInt(renewalMatch[1]) : 0;

    // Can renew: check if 續借 button exists (not grayed out)
    const renewBtn = await item.locator('a.btnstyle.bluebg, a[class*="renew"], button').filter({ hasText: /續借/ }).count();
    const canRenew = renewBtn > 0;

    // 預約人數（有人排隊就不能續借）
    const reserveMatch = fullText.match(/預約人數[:：]\s*(\d+)/);
    const reservationCount = reserveMatch ? parseInt(reserveMatch[1]) : 0;

    // Pickup branch (典藏地)
    const branchMatch = fullText.match(/典藏地[:：]\s*(.+)/);
    const branch = branchMatch ? branchMatch[1].trim() : null;

    return { title, dueDate, renewalCount, canRenew, reservationCount, branch };
  } catch {
    return null;
  }
}

async function _scrapeReservations(page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 });
  await page.waitForTimeout(1500);

  // Return ALL reservations with their status
  const reservations = [];
  try {
    const items = await page.locator(SEL.bookItem).all();
    for (const item of items) {
      const parsed = await _parseReservationItem(item);
      if (parsed) reservations.push(parsed);
    }
  } catch (err) {
    console.error('[scraper] Error scraping reservations:', err.message);
  }
  return reservations;
}

async function _parseReservationItem(item) {
  try {
    const title = (await item.locator('h2 a').first().textContent())?.trim();
    if (!title) return null;

    const liTexts = await item.locator('li').allTextContents();
    const fullText = liTexts.join('\n');

    // Pickup branch "取書館：XXX"
    const branchMatch = fullText.match(/取書館[:：]\s*(.+)/);
    const pickupBranch = branchMatch ? branchMatch[1].trim() : null;

    // Status from span.word_red
    const statusText = (await item.locator('span.word_red').allTextContents()).join(' ').trim();

    // Determine if ready for pickup
    // "已調出" = transferred to pickup branch (in transit)
    // "可取" / "可領取" / "待取" = available to pick up now
    const isReady = /可取|可領取|待取|已備妥|備妥/.test(statusText);
    const isInTransit = /已調出|調撥中/.test(statusText);

    // Extract queue position if waiting
    const queueMatch = statusText.match(/順位第\s*(\d+)\s*位/);
    const queuePosition = queueMatch ? parseInt(queueMatch[1]) : null;

    // Extract pickup deadline if present
    const deadlineMatch = statusText.match(/(\d{4}-\d{2}-\d{2})/);
    const pickupDeadline = deadlineMatch ? deadlineMatch[1] : null;

    return {
      title,
      pickupBranch,
      status: statusText.substring(0, 80),
      isReady,
      isInTransit,
      queuePosition,
      pickupDeadline,
    };
  } catch {
    return null;
  }
}

module.exports = { scrapeAll, scrapeAccount, setEmitter };

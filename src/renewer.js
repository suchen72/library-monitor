const { chromium } = require('playwright');
const fs = require('fs');
const { readAccounts, getSessionPath } = require('./dataStore');
const captchaSolver = require('./captchaSolver');

const BASE_URL = 'https://book.tpml.edu.tw';
const BORROWED_URL = BASE_URL + '/personal/list?action=getLendFile&form=QueryForm';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Renew specific books (or all) for a single account. One browser session.
 * @param {string} accountId - e.g. "account1"
 * @param {string[]} [titles] - specific titles to renew; omit or empty = renew all renewable
 * @returns {{ results: Array<{ title, success, message }> }}
 */
async function renewByAccount(accountId, titles) {
  const accounts = readAccounts();
  const account = accounts.find(a => a.id === accountId);
  if (!account) {
    return { results: [{ title: '(帳號)', success: false, message: `找不到帳號 ${accountId}` }] };
  }

  const results = [];
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await _loginAndNavigate(browser, account);
    const targetSet = titles?.length ? new Set(titles) : null; // null = renew all

    let hasMore = true;
    while (hasMore) {
      hasMore = false;
      const items = await page.locator('.booklist').all();

      for (const item of items) {
        const title = (await item.locator('h2 a').first().textContent())?.trim();
        if (!title) continue;

        // Skip if we already processed this title
        if (results.some(r => r.title === title)) continue;

        // Skip if not in target list
        if (targetSet && !targetSet.has(title)) continue;

        const renewBtn = item.locator('a.btnstyle.bluebg, a[class*="renew"], button').filter({ hasText: /續借/ }).first();
        const isVisible = await renewBtn.isVisible().catch(() => false);
        if (!isVisible) {
          results.push({ title, success: false, message: '不可續借' });
          continue;
        }

        // Click renew — opens a confirmation modal ("確定要續借？")
        await renewBtn.click();
        await page.waitForTimeout(1500);

        // The confirm button is <input type="button" value="確定"> — value attr, not textContent
        const confirmBtn = page.locator('input[type="button"][value="確定"]').first();
        const hasConfirm = await confirmBtn.isVisible().catch(() => false);

        if (!hasConfirm) {
          results.push({ title, success: false, message: '找不到確認續借按鈕' });
        } else {
          // Confirm triggers a GraphQL mutation `doContuineBook`. Listen for its response —
          // page text is unreliable (i18n templates contain "續借成功" / "失敗" verbatim).
          const renewRespPromise = page.waitForResponse(
            resp => resp.url().includes('/api/HyLibWS/graphql')
              && (resp.request().postData() || '').includes('doContuineBook'),
            { timeout: 15000 }
          ).catch(() => null);

          await confirmBtn.click();
          const renewResp = await renewRespPromise;

          let success = false;
          let message = '無法判斷續借結果';
          if (renewResp) {
            const json = await renewResp.json().catch(() => null);
            const r = json?.data?.doContuineBook;
            if (r) {
              success = !!r.success;
              message = success ? '續借成功' : (r.message || '續借失敗');
            }
          }
          results.push({ title, success, message });

          await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        }

        // Re-navigate for next book (modal may have changed DOM)
        await page.goto(BORROWED_URL, { waitUntil: 'networkidle', timeout: 20000 });
        await page.waitForTimeout(1500);
        hasMore = true;
        break; // restart item scan after re-navigate
      }
    }

    // Save session for reuse
    await page.context().storageState({ path: getSessionPath(account.id) });
    await browser.close();
  } catch (err) {
    await browser.close().catch(() => {});
    results.push({ title: '(錯誤)', success: false, message: err.message });
  } finally {
    await captchaSolver.terminate();
  }

  return { results };
}

/**
 * Renew a single book. Convenience wrapper — one browser, one login.
 */
async function renewBook(accountId, bookTitle) {
  const { results } = await renewByAccount(accountId, [bookTitle]);
  return results[0] || { success: false, message: '未知錯誤' };
}

/**
 * Renew all renewable books across all accounts.
 */
async function renewAll() {
  const accounts = readAccounts();
  const allResults = [];

  for (const account of accounts) {
    const { results } = await renewByAccount(account.id);
    for (const r of results) {
      allResults.push({ accountId: account.id, accountLabel: account.label, ...r });
    }
  }

  return { results: allResults };
}

// --- Login helper (reused from scraper pattern) ---

async function _loginAndNavigate(browser, account) {
  const sessionPath = getSessionPath(account.id);

  // Try session reuse
  if (fs.existsSync(sessionPath)) {
    const context = await browser.newContext({
      storageState: sessionPath,
      locale: 'zh-TW',
      userAgent: USER_AGENT,
    });
    const page = await context.newPage();
    await page.goto(BORROWED_URL, { waitUntil: 'networkidle', timeout: 20000 });

    const captchaVisible = await page.locator('input[name="captcha"]').isVisible().catch(() => false);
    const loginBtnVisible = await page.locator('input#loginBtn').isVisible().catch(() => false);
    if (!captchaVisible && !loginBtnVisible) {
      return page;
    }
    await context.close();
    fs.unlinkSync(sessionPath);
  }

  // Fresh login
  const context = await browser.newContext({ locale: 'zh-TW', userAgent: USER_AGENT });
  const page = await context.newPage();

  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });
  await page.locator('button.btn.btn-sm').filter({ hasText: '登入' }).first().click();
  await page.waitForSelector('input#username', { timeout: 10000 });
  await page.fill('input#username', account.cardNumber);
  await page.fill('input#password', account.password);
  await page.waitForTimeout(2000);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const captchaText = await captchaSolver.solveCaptcha(page);
    await page.fill('input[name="captcha"]', captchaText);
    await page.click('input#loginBtn');

    const success = await page.waitForURL(url => {
      const href = typeof url === 'string' ? url : url.href;
      return href.includes('loginstate') || href.includes('/personal');
    }, { timeout: 10000 }).then(() => true).catch(() => false);

    if (success) {
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);
      await page.goto(BORROWED_URL, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(1500);
      await context.storageState({ path: sessionPath });
      return page;
    }

    await page.waitForSelector('input#username', { timeout: 5000 }).catch(() => {});
    await page.fill('input#username', account.cardNumber).catch(() => {});
    await page.fill('input#password', account.password).catch(() => {});
    await page.waitForTimeout(1000);
  }

  throw new Error('CAPTCHA auto-solve failed');
}

/**
 * Auto-renew books due today across all accounts.
 * @param {object} data - scraped data from readData()
 */
async function autoRenew(data) {
  const { getAutoRenewTargets } = require('./notifier');
  const targets = getAutoRenewTargets(data);
  const allResults = [];

  if (targets.length === 0) {
    console.log('[renewer] No books due today for auto-renewal');
    return { results: allResults };
  }

  const accounts = readAccounts();
  for (const { accountId, titles } of targets) {
    const account = accounts.find(a => a.id === accountId);
    const label = account?.label || accountId;
    console.log(`[renewer] Auto-renewing ${titles.length} book(s) for ${label}`);
    const { results } = await renewByAccount(accountId, titles);
    for (const r of results) {
      allResults.push({ accountId, accountLabel: label, ...r });
    }
  }

  return { results: allResults };
}

module.exports = { renewBook, renewByAccount, renewAll, autoRenew };

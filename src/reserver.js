const { chromium } = require('playwright');
const fs = require('fs');
const { readAccounts, getSessionPath } = require('./dataStore');
const captchaSolver = require('./captchaSolver');

const BASE_URL = 'https://book.tpml.edu.tw';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Default pickup branch: I22親子美育數位館
const DEFAULT_PICKUP_BRANCH = process.env.DEFAULT_PICKUP_BRANCH || '114';

/**
 * Reserve a book for a specific account.
 * @param {string} accountId - e.g. "account1"
 * @param {string} bookId - book detail ID from catalog (e.g. "768442")
 * @param {string} [pickupBranch] - pickup branch value (default: DEFAULT_PICKUP_BRANCH)
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function reserveBook(accountId, bookId, pickupBranch) {
  const accounts = readAccounts();
  const account = accounts.find(a => a.id === accountId);
  if (!account) {
    return { success: false, message: `找不到帳號 ${accountId}` };
  }

  const branch = pickupBranch || DEFAULT_PICKUP_BRANCH;
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await _loginAndNavigateToBook(browser, account, bookId);

    // Persistently remove iRead app promo overlay via MutationObserver
    await page.evaluate(() => {
      const removeOverlays = () => {
        document.querySelectorAll('.login_lightbox, .overlay, [class*="lightbox"]').forEach(el => el.remove());
      };
      removeOverlays();
      new MutationObserver(removeOverlays).observe(document.body, { childList: true, subtree: true });
    });

    // Auto-accept dialogs (reservation success/error alerts)
    let dialogMessage = '';
    page.on('dialog', async dialog => {
      dialogMessage = dialog.message();
      await dialog.accept();
    });

    // 1. Click callVolId checkbox (force: true to bypass any remaining overlay)
    const checkbox = page.locator('input[name="callVolId"]').first();
    if (!await checkbox.isVisible().catch(() => false)) {
      await browser.close();
      return { success: false, message: '找不到預約勾選框，可能此書無法預約' };
    }
    await checkbox.click({ force: true });
    await page.waitForTimeout(1000);

    // 2. Click the reserve button
    const reserveBtn = page.locator('a.btnstyle.orangebg').filter({ hasText: /預.*約/ }).first();
    if (!await reserveBtn.isVisible().catch(() => false)) {
      await browser.close();
      return { success: false, message: '找不到預約按鈕' };
    }
    await reserveBtn.click({ force: true, timeout: 5000 });
    await page.waitForTimeout(3000);

    // 3. Select pickup branch
    const branchSelect = page.locator('select[name="selectpickupKS"]');
    if (!await branchSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      await browser.close();
      return { success: false, message: '找不到取書館選單，可能未成功登入' };
    }
    await branchSelect.selectOption(branch);
    await page.waitForTimeout(500);

    // 4. Click "確定預約" submit button
    const submitBtn = page.locator('input[type="submit"][value="確定預約"]');
    if (!await submitBtn.isVisible().catch(() => false)) {
      await browser.close();
      return { success: false, message: '找不到確定預約按鈕' };
    }
    await submitBtn.click();
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // 5. Check result — dialog message or page content
    if (dialogMessage.includes('預約成功') || dialogMessage.includes('已成功')) {
      await page.context().storageState({ path: getSessionPath(account.id) });
      await browser.close();
      return { success: true, message: '預約成功' };
    }

    const bodyText = await page.textContent('body');
    if (bodyText.includes('預約成功') || bodyText.includes('已成功')) {
      await page.context().storageState({ path: getSessionPath(account.id) });
      await browser.close();
      return { success: true, message: '預約成功' };
    }

    if (dialogMessage.includes('已預約過') || bodyText.includes('已預約過')) {
      await browser.close();
      return { success: false, message: '此書已預約過' };
    }
    if (bodyText.includes('預約已額滿') || bodyText.includes('超過預約上限')) {
      await browser.close();
      return { success: false, message: '預約額度已滿' };
    }

    await page.context().storageState({ path: getSessionPath(account.id) });
    await browser.close();
    return { success: false, message: dialogMessage || '預約結果無法確認，請到圖書館網站查看' };
  } catch (err) {
    await browser.close().catch(() => {});
    return { success: false, message: err.message };
  } finally {
    await captchaSolver.terminate();
  }
}

// --- Login and navigate to book detail page ---

async function _loginAndNavigateToBook(browser, account, bookId) {
  const sessionPath = getSessionPath(account.id);
  const bookUrl = `${BASE_URL}/bookDetail/${bookId}`;

  // Try session reuse
  if (fs.existsSync(sessionPath)) {
    const context = await browser.newContext({
      storageState: sessionPath,
      locale: 'zh-TW',
      userAgent: USER_AGENT,
    });
    const page = await context.newPage();
    await page.goto(bookUrl, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);

    // Verify login by checking for "登出" link
    const isLoggedIn = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      return links.some(a => a.textContent.trim() === '登出');
    });
    if (isLoggedIn) {
      return page;
    }
    console.log('[reserve] Session expired, re-logging in...');
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
      await page.goto(bookUrl, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(2000);
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

module.exports = { reserveBook };

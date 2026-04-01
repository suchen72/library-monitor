const Tesseract = require('tesseract.js');

const MAX_RETRIES = 3;

let _worker = null;

async function getWorker() {
  if (!_worker) {
    _worker = await Tesseract.createWorker('eng');
    await _worker.setParameters({
      tessedit_char_whitelist: '0123456789',
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    });
  }
  return _worker;
}

/**
 * Auto-solve CAPTCHA on the library login page using Tesseract OCR.
 * Screenshots the CAPTCHA image element, runs OCR, returns recognized digits.
 *
 * @param {import('playwright').Page} page - Playwright page with login modal open
 * @returns {string} Recognized CAPTCHA text
 * @throws {Error} If all retries fail
 */
async function solveCaptcha(page) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[captcha] Attempt ${attempt}/${MAX_RETRIES}: extracting image...`);

      const imageBuffer = await extractCaptchaImage(page);
      if (!imageBuffer) throw new Error('Could not extract CAPTCHA image');

      console.log(`[captcha] Image extracted (${(imageBuffer.length / 1024).toFixed(1)}KB), running OCR...`);

      const text = await recognizeWithTesseract(imageBuffer);
      console.log(`[captcha] OCR returned: "${text}"`);

      // Clean up: remove spaces, keep only digits
      const cleaned = text.replace(/\s/g, '').replace(/[^0-9]/g, '');

      if (/^\d{4,6}$/.test(cleaned)) {
        console.log(`[captcha] Valid CAPTCHA: ${cleaned}`);
        return cleaned;
      }

      console.log(`[captcha] Invalid format "${cleaned}" (expected 4-6 digits), retrying...`);
    } catch (err) {
      console.error(`[captcha] Attempt ${attempt} error: ${err.message}`);
    }

    // Refresh CAPTCHA for next attempt
    if (attempt < MAX_RETRIES) {
      await refreshCaptcha(page);
    }
  }

  throw new Error(`CAPTCHA auto-solve failed after ${MAX_RETRIES} attempts`);
}

async function extractCaptchaImage(page) {
  // Wait for the CAPTCHA image to load
  await page.waitForTimeout(2000);

  // Try multiple selectors for the CAPTCHA image element
  const selectors = [
    'img[src*="captcha"]',
    'img[alt*="驗證"]',
    'img[alt*="captcha"]',
    '.captcha img',
    '#captchaImg',
    'img[src^="data:image"]',
  ];

  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      return await el.screenshot();
    }
  }

  // Fallback: find <img> near the captcha input
  const nearImg = page.locator('input[name="captcha"]').locator('..').locator('img').first();
  if (await nearImg.isVisible().catch(() => false)) {
    return await nearImg.screenshot();
  }

  // Try broader: any img in the login modal/form area
  const formImgs = await page.locator('.modal img, .login img, form img, .lightbox img').all();
  for (const img of formImgs) {
    const box = await img.boundingBox().catch(() => null);
    // CAPTCHA images are typically small (50-200px wide)
    if (box && box.width > 40 && box.width < 300 && box.height > 20 && box.height < 100) {
      return await img.screenshot();
    }
  }

  // Last resort: screenshot area above captcha input
  return await screenshotCaptchaArea(page);
}

async function screenshotCaptchaArea(page) {
  const captchaInput = page.locator('input[name="captcha"]');
  if (!await captchaInput.isVisible().catch(() => false)) return null;

  const box = await captchaInput.boundingBox();
  if (!box) return null;

  return await page.screenshot({
    clip: {
      x: Math.max(0, box.x - 20),
      y: Math.max(0, box.y - 80),
      width: 250,
      height: 70,
    },
  });
}

async function recognizeWithTesseract(imageBuffer) {
  const worker = await getWorker();
  const { data: { text } } = await worker.recognize(imageBuffer);
  return text.trim();
}

async function refreshCaptcha(page) {
  // Click the CAPTCHA image to refresh (common pattern)
  const selectors = [
    'img[src*="captcha"]',
    'img[alt*="驗證"]',
    'img[alt*="captcha"]',
    '.captcha img',
    '#captchaImg',
  ];

  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click();
      await page.waitForTimeout(1500);
      return;
    }
  }

  // Fallback: refresh button
  const refreshBtn = page.locator('a, button').filter({ hasText: /換|重新|refresh/i }).first();
  if (await refreshBtn.isVisible().catch(() => false)) {
    await refreshBtn.click();
    await page.waitForTimeout(1500);
  }
}

function isAvailable() {
  return true; // Tesseract OCR is always available (no API key needed)
}

async function terminate() {
  if (_worker) {
    await _worker.terminate();
    _worker = null;
  }
}

module.exports = { solveCaptcha, isAvailable, terminate };

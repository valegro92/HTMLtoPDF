'use strict';

const puppeteer = require('puppeteer');

// ── Browser singleton con promise lock ──
let browser = null;
let browserPromise = null;

async function getBrowser() {
  if (browser?.connected) return browser;
  if (browserPromise) return browserPromise;

  const launchOpts = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--font-render-hinting=none',
    ],
  };

  // Su Fly.io (e in genere con Chromium di sistema) usa il path esplicito
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  browserPromise = puppeteer.launch(launchOpts).then(b => {
    browser = b;
    browserPromise = null;
    b.on('disconnected', () => { browser = null; });
    console.log(`🚀 Browser avviato (executablePath: ${launchOpts.executablePath ?? 'bundled'})`);
    return b;
  }).catch(err => {
    browserPromise = null;
    throw err;
  });

  return browserPromise;
}

// ── URL interni da bloccare (anti-SSRF) ──
const BLOCKED_HOSTS = /^https?:\/\/(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0)/i;

/**
 * Crea e prepara una nuova pagina Puppeteer.
 *
 * @param {import('puppeteer').Browser} browserInstance
 * @param {string} html
 * @param {Set<string>} allowedResourceTypes - Set dei tipi di risorsa permessi
 * @returns {Promise<import('puppeteer').Page>}
 */
async function setupPage(browserInstance, html, allowedResourceTypes) {
  const page = await browserInstance.newPage();

  // ── Logging diagnostico: console errori, eccezioni JS, richieste fallite ──
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error' || t === 'warning') {
      console.log(`[page-${t}] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => console.log('[page-error]', err.message));
  page.on('requestfailed', (req) => {
    const errText = req.failure()?.errorText;
    if (errText && errText !== 'net::ERR_BLOCKED_BY_CLIENT' && errText !== 'net::ERR_ABORTED') {
      console.log(`[req-failed] ${req.url()} — ${errText}`);
    }
  });

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    const type = req.resourceType();

    if (BLOCKED_HOSTS.test(url)) return req.abort();
    if (!allowedResourceTypes.has(type)) return req.abort();
    req.continue();
  });

  // deviceScaleFactor: 2 → testo nitido nei PDF/PNG
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle2', timeout: 15000 });

  // ── Disabilita animazioni/transizioni per render deterministico ──
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
    }`,
  });

  // ── Aspetta web fonts + tempo per JIT runtime (Tailwind CDN, ecc.) ──
  try {
    await page.evaluate(() => document.fonts && document.fonts.ready);
  } catch (_) { /* document.fonts non disponibile: ignora */ }
  await new Promise(r => setTimeout(r, 800));

  return page;
}

/**
 * Espone il riferimento al browser singleton (usato da server.js per il
 * graceful shutdown e per azzerare il riferimento in caso di errore).
 */
function getBrowserRef() {
  return browser;
}

function clearBrowserRef() {
  browser = null;
}

module.exports = { getBrowser, setupPage, getBrowserRef, clearBrowserRef };

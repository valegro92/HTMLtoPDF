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

  // Intercetta MutationObserver prima degli script della pagina, così possiamo
  // disconnetterli tutti in freezeJsExecution (evita che il framework JS ri-attivi
  // la slide 0 tramite observer quando cambiamo visibility con setProperty).
  await page.evaluateOnNewDocument(() => {
    const _orig = MutationObserver.prototype.observe;
    const _list = [];
    MutationObserver.prototype.observe = function () {
      _list.push(this);
      return _orig.apply(this, arguments);
    };
    window.__killObservers = function () {
      _list.forEach(function (o) { try { o.disconnect(); } catch (_) {} });
      _list.length = 0;
    };
  });

  // ── Logging diagnostico: console errori, eccezioni JS, richieste fallite ──
  // Filtra warning rumorosi noti che non sono nostri (Tailwind CDN, sandbox iframe)
  const NOISY_LOGS = [
    'cdn.tailwindcss.com should not be used in production',
    'allow-scripts and allow-same-origin',
  ];
  page.on('console', (msg) => {
    const t = msg.type();
    if (t !== 'error' && t !== 'warning') return;
    const text = msg.text();
    if (NOISY_LOGS.some(s => text.includes(s))) return;
    console.log(`[page-${t}] ${text}`);
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

  // deviceScaleFactor: 2 → testo nitido nei PDF/PNG; 1440px per layout desktop wide
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
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
  } catch (_) {}
  await new Promise(r => setTimeout(r, 800));

  // ── Scroll per triggerare immagini lazy-loaded, poi ritorna in cima ──
  try {
    await page.evaluate(async () => {
      const maxH = Math.min(document.body.scrollHeight, 30000);
      const step = 700;
      for (let y = step; y <= maxH; y += step) {
        window.scrollTo(0, y);
        await new Promise(r => setTimeout(r, 40));
      }
      window.scrollTo(0, 0);
    });
  } catch (_) {}

  // ── Aspetta immagini che lo scroll ha triggerato ──
  try {
    await page.evaluate(() => {
      const pending = Array.from(document.querySelectorAll('img')).filter(i => !i.complete);
      if (!pending.length) return;
      return Promise.all(pending.map(img => new Promise(r => {
        img.addEventListener('load', r, { once: true });
        img.addEventListener('error', r, { once: true });
        setTimeout(r, 3000);
      })));
    });
  } catch (_) {}

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

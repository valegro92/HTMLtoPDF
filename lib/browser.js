'use strict';

const puppeteer = require('puppeteer');

const IS_RENDER = !!process.env.RENDER;

// ── Browser singleton con promise lock ──
let browser = null;
let browserPromise = null;

async function getBrowser() {
  if (browser?.connected) return browser;
  if (browserPromise) return browserPromise;

  browserPromise = puppeteer.launch({
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
  }).then(b => {
    browser = b;
    browserPromise = null;
    b.on('disconnected', () => { browser = null; });
    console.log(`🚀 Browser avviato (Render: ${IS_RENDER})`);
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

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    const type = req.resourceType();

    // Blocca URL interni (SSRF)
    if (BLOCKED_HOSTS.test(url)) {
      return req.abort();
    }
    // Permetti solo tipi sicuri
    if (!allowedResourceTypes.has(type)) {
      return req.abort();
    }
    req.continue();
  });

  await page.setViewport({ width: 1280, height: 900 });
  await page.setContent(html, { waitUntil: 'networkidle2', timeout: 15000 });

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

const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_RENDER = !!process.env.RENDER;
const MAX_CONCURRENT = 2;

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Routing: landing su /, app su /app ──
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));

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
const ALLOWED_TYPES = new Set(['document', 'stylesheet', 'font', 'image']);

// ── Dimensioni pagina in px a 96 DPI ──
const PAGE_PX = {
  A4:     { w: 794, h: 1123 },
  Letter: { w: 816, h: 1056 },
  A3:     { w: 1123, h: 1587 },
};

// ── Concorrenza ──
let activeConversions = 0;

// ── Health check ──
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    browser: browser?.connected ? 'connected' : 'disconnected',
    activeConversions,
    maxConcurrent: MAX_CONCURRENT,
  });
});

// ── Endpoint principale ──
app.post('/convert', async (req, res) => {
  if (activeConversions >= MAX_CONCURRENT) {
    return res.status(429).json({ error: 'Server occupato, riprova tra qualche secondo.' });
  }

  const { html, format = 'A4', fitToPage = false } = req.body;

  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'Campo "html" mancante o non valido.' });
  }

  const validFormats = ['A4', 'Letter', 'A3', 'Auto'];
  const pageFormat = validFormats.includes(format) ? format : 'A4';
  const isAuto = pageFormat === 'Auto';

  activeConversions++;
  let page = null;
  try {
    const b = await getBrowser();
    page = await b.newPage();

    // Blocca script e risorse pericolose, permetti font e immagini
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      const type = req.resourceType();

      // Blocca URL interni (SSRF)
      if (BLOCKED_HOSTS.test(url)) {
        return req.abort();
      }
      // Permetti solo tipi sicuri
      if (!ALLOWED_TYPES.has(type)) {
        return req.abort();
      }
      req.continue();
    });

    await page.setViewport({ width: 1280, height: 900 });
    await page.setContent(html, { waitUntil: 'networkidle2', timeout: 15000 });

    let pdfOpts = {
      printBackground: true,
      margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
    };

    if (isAuto) {
      // 1. Detect slide mode: figli diretti del body con stesse dimensioni
      const slideInfo = await page.evaluate(() => {
        const children = Array.from(document.body.children).filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 100 && r.height > 100;
        });
        if (children.length < 2) return null;

        const first = children[0].getBoundingClientRect();
        const allSameSize = children.every(el => {
          const r = el.getBoundingClientRect();
          return Math.abs(r.width - first.width) / first.width < 0.1
              && Math.abs(r.height - first.height) / first.height < 0.1;
        });

        if (!allSameSize) return null;
        return { count: children.length, w: Math.ceil(first.width), h: Math.ceil(first.height) };
      });

      if (slideInfo) {
        // Slide mode: una pagina PDF per ogni slide
        await page.evaluate(() => {
          document.body.style.margin = '0';
          document.body.style.padding = '0';
          document.body.style.background = 'white';
          document.body.style.display = 'block';
          Array.from(document.body.children).forEach((el, i, arr) => {
            el.style.pageBreakAfter = (i < arr.length - 1) ? 'always' : 'auto';
            el.style.pageBreakInside = 'avoid';
            el.style.margin = '0';
            el.style.boxShadow = 'none';
            el.style.borderRadius = '0';
          });
        });

        pdfOpts.width = slideInfo.w + 'px';
        pdfOpts.height = slideInfo.h + 'px';

      } else {
        // Pagina singola: logica Auto originale
        const finalDims = await page.evaluate(() => {
          const body = document.body;
          const children = Array.from(body.children);
          let main = body;
          if (children.length > 0) {
            main = children.reduce((best, el) => {
              const r = el.getBoundingClientRect();
              const bestR = best.getBoundingClientRect();
              return (r.width * r.height) > (bestR.width * bestR.height) ? el : best;
            });
          }

          body.style.margin = '0';
          body.style.padding = '0';
          body.style.display = 'block';

          if (main !== body) {
            main.style.maxWidth = '100%';
            main.style.width = '100%';
            main.style.margin = '0';
            main.style.borderRadius = '0';
          }

          return {
            w: Math.ceil(main.getBoundingClientRect().width),
            h: Math.ceil(main.getBoundingClientRect().height),
          };
        });

        await page.setViewport({ width: finalDims.w, height: 900 });
        await new Promise(r => setTimeout(r, 300));

        const scrollDims = await page.evaluate(() => ({
          w: document.body.scrollWidth,
          h: document.body.scrollHeight,
        }));

        pdfOpts.width = scrollDims.w + 'px';
        pdfOpts.height = scrollDims.h + 'px';
      }

    } else if (fitToPage) {
      const dims = await page.evaluate(() => ({
        w: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
        h: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
      }));

      const target = PAGE_PX[pageFormat];
      const scale = Math.min(target.w / dims.w, target.h / dims.h, 1);

      if (scale < 1) {
        pdfOpts.scale = scale;
      }
      pdfOpts.format = pageFormat;
    } else {
      pdfOpts.format = pageFormat;
    }

    const pdfResult = await page.pdf(pdfOpts);
    const pdfBuffer = Buffer.from(pdfResult);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="output.pdf"',
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  } catch (err) {
    console.error('❌ Errore conversione PDF:', err.message, err.stack);
    if (browser && !browser.connected) {
      browser = null;
    }
    res.status(500).json({ error: `Conversione fallita: ${err.message}` });
  } finally {
    activeConversions--;
    if (page) await page.close().catch(() => {});
  }
});

// ── Graceful shutdown ──
async function shutdown() {
  console.log('⏹️  Chiusura in corso...');
  if (browser) await browser.close().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ── Startup con warm-up browser ──
app.listen(PORT, async () => {
  console.log(`✅ Server attivo su http://localhost:${PORT}`);
  try {
    await getBrowser();
    console.log('🌐 Browser pronto');
  } catch (err) {
    console.error('⚠️  Warm-up browser fallito:', err.message);
  }
});

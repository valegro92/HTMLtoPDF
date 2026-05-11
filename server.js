const express = require('express');
const PptxGenJS = require('pptxgenjs');
const path = require('path');
const crypto = require('crypto');

const { getBrowser, setupPage, getBrowserRef, clearBrowserRef } = require('./lib/browser');
const { SLIDE_DETECTION_JS } = require('./lib/slide-detection');
const substackSync = require('./lib/substack-sync');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_CONCURRENT = 2;

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth: accesso riservato agli iscritti all'Officina ──
const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
  const s = crypto.randomBytes(32).toString('hex');
  console.warn('⚠️  SESSION_SECRET non impostato — le sessioni scadono ad ogni restart');
  return s;
})();

const DEFAULT_ALLOWED = [
  'valegro92@gmail.com',
  'gianlucascarpellini@gmail.com',
  'stefferri@icloud.com',
  'lorenzo.gant@gmail.com',
  'g.ambrosino@demetraform.it',
  'l-albertini@bluewin.ch',
  'francesca.gaudino@bakermckenzie.com',
  'fscm.saiani@gmail.com',
  'armando.delucia@crmpartners.it',
  'avv.roberto.barsanti@gmail.com',
  'info@nicolalorenzini.it',
].join(',');

// Allowlist mutable: union di DEFAULT_ALLOWED (hardcoded) + ALLOWED_EMAILS env var
// + lista syncata da Substack (substack-sync). Il sync è best-effort; se fallisce
// la lista DEFAULT_ALLOWED rimane attiva.
const baseAllowed = (process.env.ALLOWED_EMAILS || DEFAULT_ALLOWED)
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
let ALLOWED_EMAILS = new Set(baseAllowed);

function rebuildAllowedEmails(syncedEmails) {
  const next = new Set(baseAllowed);
  if (Array.isArray(syncedEmails)) {
    for (const e of syncedEmails) {
      if (e && /@/.test(e)) next.add(e.toLowerCase().trim());
    }
  }
  ALLOWED_EMAILS = next;
  console.log(`✅ Allowlist aggiornata: ${next.size} email totali (${baseAllowed.length} hardcoded + ${(syncedEmails || []).length} Substack)`);
}

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'valegro92@gmail.com').toLowerCase();

function makeSessionToken(email) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(email.toLowerCase()).digest('hex');
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return Object.fromEntries(
    raw.split(';').map(c => {
      const [k, ...v] = c.trim().split('=');
      return [k.trim(), v.join('=')];
    }).filter(([k]) => k)
  );
}

function isValidSession(req) {
  const cookies = parseCookies(req);
  const email = cookies['sess_email'];
  const token = cookies['sess_token'];
  if (!email || !token) return false;
  try {
    const expected = makeSessionToken(decodeURIComponent(email));
    const actual = Buffer.from(token.length === expected.length ? token : '0'.repeat(expected.length));
    return crypto.timingSafeEqual(Buffer.from(expected), actual) &&
           ALLOWED_EMAILS.has(decodeURIComponent(email).toLowerCase());
  } catch { return false; }
}

const COOKIE_OPTS = `; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 24 * 90}`;

// ── Routing: landing su /, login su /login, app su /app (protetta) ──
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.post('/auth/login', (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email mancante.' });
  }
  const normalized = email.trim().toLowerCase();
  if (!ALLOWED_EMAILS.has(normalized)) {
    return res.status(403).json({ error: 'Email non autorizzata. Sei iscritto all\'Officina?' });
  }
  const token = makeSessionToken(normalized);
  res.setHeader('Set-Cookie', [
    `sess_email=${encodeURIComponent(normalized)}${COOKIE_OPTS}`,
    `sess_token=${token}${COOKIE_OPTS}`,
  ]);
  res.json({ ok: true });
});

app.post('/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', [
    `sess_email=; Path=/; HttpOnly; Max-Age=0`,
    `sess_token=; Path=/; HttpOnly; Max-Age=0`,
  ]);
  res.json({ ok: true });
});

app.get('/app', (req, res) => {
  if (!isValidSession(req)) return res.redirect('/login?next=/app');
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// ── Admin: solo ADMIN_EMAIL può vedere status sync e triggerare sync manuale ──
function isAdmin(req) {
  if (!isValidSession(req)) return false;
  const cookies = parseCookies(req);
  const email = decodeURIComponent(cookies['sess_email'] || '').toLowerCase();
  return email === ADMIN_EMAIL;
}

app.get('/admin/sync-status', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  res.json({
    publication: substackSync.PUBLICATION,
    syncIntervalMs: substackSync.SYNC_INTERVAL_MS,
    cookieConfigured: !!process.env.SUBSTACK_COOKIE,
    allowedEmailsCount: ALLOWED_EMAILS.size,
    baseAllowedCount: baseAllowed.length,
    lastSync: substackSync.getLastSync(),
  });
});

app.post('/admin/sync-now', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  const r = await substackSync.syncOnce();
  if (r && r.ok && Array.isArray(r.emails)) rebuildAllowedEmails(r.emails);
  // Non rispediamo il body raw nelle attempts (può contenere dati Substack)
  // a meno che ?debug=1 esplicito.
  if (req.query.debug !== '1' && r && r.attempts) {
    r.attempts = r.attempts.map(a => ({ ...a, bodyTextSample: a.bodyTextSample ? `[${(a.bodyTextSample || '').length} chars]` : undefined }));
  }
  res.json({ result: r, allowedEmailsCount: ALLOWED_EMAILS.size });
});

// ── Congela esecuzione JS della pagina prima dei screenshot per-slide.
// Le presentazioni JS (es. listener su keydown + setInterval/setTimeout) re-resettano
// lo state della slide corrente sovrascrivendo il nostro toggle visibility.
// Killiamo timers/intervals/RAFs e overrideiamo le funzioni globali per impedire
// nuove pianificazioni; disabilitiamo anche animations/transitions CSS.
async function freezeJsExecution(page) {
  await page.evaluate(() => {
    // Disconnetti tutti i MutationObserver registrati dal tracker iniettato in setupPage.
    // I framework JS usano MutationObserver (non timer) per ri-attivare la slide attiva
    // quando rileviamo che gli stili sono cambiati: questo blocca quel meccanismo.
    if (typeof window.__killObservers === 'function') window.__killObservers();

    // Kill running timers/intervals (gli ID partono da 1 e crescono)
    const maxTimer = setTimeout(() => {}, 0);
    for (let i = 0; i <= maxTimer; i++) {
      try { clearTimeout(i); clearInterval(i); } catch (_) {}
    }
    // Kill running RAFs
    const maxRaf = requestAnimationFrame(() => {});
    for (let i = 0; i <= maxRaf; i++) {
      try { cancelAnimationFrame(i); } catch (_) {}
    }
    // Block all future scheduling
    window.setTimeout = function () { return 0; };
    window.setInterval = function () { return 0; };
    window.requestAnimationFrame = function () { return 0; };
    window.queueMicrotask = function () {};
    // Disabilita animations/transitions per render istantaneo
    const style = document.createElement('style');
    style.textContent = '*,*::before,*::after { animation: none !important; transition: none !important; }';
    document.head.appendChild(style);
  });
}

// ── Tipi di risorsa permessi per la conversione PDF ──
const ALLOWED_TYPES = new Set(['document', 'stylesheet', 'font', 'image', 'script']);

// ── Dimensioni pagina in px a 96 DPI ──
const PAGE_PX = {
  A4:     { w: 794, h: 1123 },
  Letter: { w: 816, h: 1056 },
  A3:     { w: 1123, h: 1587 },
};

// ── Concorrenza con coda graceful ──
// Invece di rispondere 429 immediato quando MAX_CONCURRENT è pieno, le richieste
// si mettono in coda con un timeout. Così PDF + PPTX + PNG cliccati in sequenza
// rapida non danno errore: il server li serializza dietro le quinte.
let activeConversions = 0;
const slotWaiters = [];
const SLOT_QUEUE_TIMEOUT_MS = 25000;

function acquireSlot(timeoutMs = SLOT_QUEUE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (activeConversions < MAX_CONCURRENT) {
      activeConversions++;
      return resolve();
    }
    let triggered = false;
    const waiter = () => {
      if (triggered) return;
      triggered = true;
      clearTimeout(timer);
      activeConversions++;
      resolve();
    };
    const timer = setTimeout(() => {
      if (triggered) return;
      triggered = true;
      const idx = slotWaiters.indexOf(waiter);
      if (idx !== -1) slotWaiters.splice(idx, 1);
      reject(new Error('SLOT_TIMEOUT'));
    }, timeoutMs);
    slotWaiters.push(waiter);
  });
}

function releaseSlot() {
  activeConversions--;
  const next = slotWaiters.shift();
  if (next) next();
}

// ── Helper: sanitizzazione filename derivato da titolo HTML ──
const MAX_FILENAME_LEN = 80;
function safeFileName(title, fallback) {
  if (!title) return fallback || 'output';
  return title.replace(/[^a-zA-Z0-9À-ÿ\s-]/g, '').replace(/\s+/g, '_').substring(0, MAX_FILENAME_LEN);
}

// ── Helper: imposta header download (Content-Type, Disposition con filename UTF-8, Length) ──
function setDownloadHeaders(res, { fileName, contentType, contentLength }) {
  const encoded = encodeURIComponent(fileName);
  const headers = {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encoded}`,
  };
  if (contentLength != null) headers['Content-Length'] = contentLength;
  res.set(headers);
}

// ── Helper: inietta detector + esegue __detectContent in page context ──
async function detectInPage(page, opts = {}) {
  await page.addScriptTag({ content: SLIDE_DETECTION_JS });
  return page.evaluate((o) => window.__detectContent(o), opts);
}

// ── Health check ──
app.get('/health', (req, res) => {
  const b = getBrowserRef();
  res.json({
    status: 'ok',
    browser: b?.connected ? 'connected' : 'disconnected',
    activeConversions,
    maxConcurrent: MAX_CONCURRENT,
  });
});

// ── Endpoint debug: ritorna lo scoring del detector senza generare output ──
// Auth-protected (uguale a /app). Body: { html, minSlides? }
app.post('/detect', async (req, res) => {
  if (!isValidSession(req)) return res.status(401).json({ error: 'Non autorizzato.' });
  const { html } = req.body;
  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'Campo "html" mancante o non valido.' });
  }
  const minSlides = Number.isInteger(req.body.minSlides) && req.body.minSlides > 0
    ? req.body.minSlides
    : 2;

  try { await acquireSlot(); }
  catch { return res.status(429).json({ error: 'Server occupato, riprova tra qualche secondo.' }); }

  let page = null;
  try {
    const b = await getBrowser();
    page = await setupPage(b, html, ALLOWED_TYPES);
    const result = await detectInPage(page, { minSlides, debug: true, extractSlides: false });
    res.json(result);
  } catch (err) {
    console.error('❌ Errore /detect:', err.message);
    const b = getBrowserRef();
    if (b && !b.connected) clearBrowserRef();
    res.status(500).json({ error: `Detection fallita: ${err.message}` });
  } finally {
    releaseSlot();
    if (page) await page.close().catch(() => {});
  }
});

// ── Endpoint principale ──
app.post('/convert', async (req, res) => {
  const { html, format = 'A4', fitToPage = false, singlePage = false } = req.body;

  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'Campo "html" mancante o non valido.' });
  }

  const validFormats = ['A4', 'Letter', 'A3', 'Auto'];
  const pageFormat = validFormats.includes(format) ? format : 'A4';
  const isAuto = pageFormat === 'Auto';

  try { await acquireSlot(); }
  catch { return res.status(429).json({ error: 'Server occupato, riprova tra qualche secondo.' }); }

  let page = null;
  try {
    const b = await getBrowser();
    page = await setupPage(b, html, ALLOWED_TYPES);

    let pdfOpts = {
      printBackground: true,
      margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
    };

    // Estrai titolo SUBITO (prima di eventuali setContent che sostituiscono il DOM)
    const docTitle = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      if (h1) return h1.textContent.trim();
      const title = document.querySelector('title');
      if (title) return title.textContent.trim();
      return '';
    });

    if (isAuto) {
      // 1. Score-based detection (skip se singlePage=true)
      // detection = { mode: 'presentation'|'document'|'infographic'|'dashboard'|'email'|'unknown',
      //               confidence, recommendedFormat, rects?, overlapping?, slideW?, slideH? }
      let detection = null;
      if (!singlePage) {
        await page.addScriptTag({ content: SLIDE_DETECTION_JS });
        detection = await page.evaluate(() => window.__detectContent({ minSlides: 3 }));
      }
      const slideCapture = (detection && detection.mode === 'presentation' && detection.rects)
        ? { rects: detection.rects, overlapping: detection.overlapping, slideW: detection.slideW, slideH: detection.slideH }
        : null;

      if (slideCapture) {
        // ═══ Slide mode: screenshot pixel-perfect per ogni slide → PDF assemblato ═══
        console.log(`📄 PDF Slide mode (screenshot): ${slideCapture.rects.length} slide (${slideCapture.slideW}x${slideCapture.slideH}px)`);

        // Congela JS framework prima del loop screenshot
        await freezeJsExecution(page);

        // Stream-style: converte ogni screenshot in stringa data-URI e droppa il
        // buffer subito → evita di tenere ~25MB di Buffer + ~33MB base64 in heap
        // contemporaneamente (rilevante su VM da 1GB con 2 conversioni concorrenti).
        const slideParts = [];
        for (let i = 0; i < slideCapture.rects.length; i++) {
          if (slideCapture.overlapping) {
            await page.evaluate((idx) => {
              const result = window.__detectSlides();
              if (!result || !result.slideElements) return;
              result.slideElements.forEach((el, j) => {
                const visible = j === idx;
                el.style.setProperty('visibility', visible ? 'visible' : 'hidden', 'important');
                el.style.setProperty('opacity', visible ? '1' : '0', 'important');
                el.style.setProperty('display', visible ? 'block' : 'none', 'important');
              });
            }, i);
            // RAF è stato overridden da freezeJsExecution → Node setTimeout per attendere repaint
            await new Promise(r => setTimeout(r, 80));
          }
          const rect = slideCapture.overlapping ? slideCapture.rects[0] : slideCapture.rects[i];
          const png = await page.screenshot({
            type: 'png',
            clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
          });
          slideParts.push(`<div class="pdf-slide"><img src="data:image/png;base64,${Buffer.from(png).toString('base64')}"></div>`);
        }

        // Costruisci PDF: wrapper HTML con un'immagine full-bleed per slide + page-break
        const slideW = slideCapture.slideW;
        const slideH = slideCapture.slideH;
        const slidesHtml = slideParts.join('');
        const wrapperHtml = `<!DOCTYPE html><html><head><style>
          *,*::before,*::after { margin:0; padding:0; box-sizing:border-box; }
          html, body { background: #fff; }
          .pdf-slide { width: ${slideW}px; height: ${slideH}px; page-break-after: always; page-break-inside: avoid; overflow: hidden; }
          .pdf-slide:last-child { page-break-after: auto; }
          .pdf-slide img { display: block; width: 100%; height: 100%; object-fit: cover; }
        </style></head><body>${slidesHtml}</body></html>`;
        await page.setContent(wrapperHtml, { waitUntil: 'load' });
        pdfOpts.width = slideW + 'px';
        pdfOpts.height = slideH + 'px';

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

    const fileName = `${safeFileName(docTitle, 'output')}.pdf`;
    const pdfResult = await page.pdf(pdfOpts);
    const pdfBuffer = Buffer.from(pdfResult);

    setDownloadHeaders(res, {
      fileName,
      contentType: 'application/pdf',
      contentLength: pdfBuffer.length,
    });
    res.end(pdfBuffer);
  } catch (err) {
    console.error('❌ Errore conversione PDF:', err.message, err.stack);
    const b = getBrowserRef();
    if (b && !b.connected) clearBrowserRef();
    res.status(500).json({ error: `Conversione fallita: ${err.message}` });
  } finally {
    releaseSlot();
    if (page) await page.close().catch(() => {});
  }
});

// ── Endpoint PPTX: converte HTML in PowerPoint (slide native o screenshot) ──
app.post('/convert-pptx', async (req, res) => {
  const { html } = req.body;
  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'Campo "html" mancante o non valido.' });
  }

  // Tipi permessi per PPTX — include 'script' per contenuti dinamici (Chart.js, ecc.)
  const PPTX_ALLOWED = new Set(['document', 'stylesheet', 'font', 'image', 'script']);

  try { await acquireSlot(); }
  catch { return res.status(429).json({ error: 'Server occupato, riprova tra qualche secondo.' }); }

  let page = null;
  try {
    const b = await getBrowser();
    page = await setupPage(b, html, PPTX_ALLOWED);

    // ── FASE 1: Rileva tipo di contenuto via scoring ──
    await page.addScriptTag({ content: SLIDE_DETECTION_JS });
    const slideData = await page.evaluate(() => {
      const docTitle = (() => {
        const h1 = document.querySelector('h1');
        if (h1) return h1.textContent.trim();
        const t = document.querySelector('title');
        if (t) return t.textContent.trim();
        return 'Presentazione';
      })();

      const det = window.__detectContent({ minSlides: 2 });

      if (det && det.mode === 'presentation' && det.rects && det.rects.length >= 2) {
        // det.slideW/slideH già Math.ceil in extractSlideElements → no double-ceil
        return {
          mode: 'slides',
          title: docTitle,
          slideW: det.slideW,
          slideH: det.slideH,
          rects: det.rects,
          overlapping: det.overlapping,
        };
      }

      // document / infographic / dashboard / email / unknown → screenshot fallback
      return {
        mode: 'screenshot',
        title: docTitle,
        detectedMode: det ? det.mode : 'unknown',
        pageW: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
        pageH: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
      };
    });

    if (!slideData) {
      return res.status(400).json({ error: 'Impossibile analizzare il documento HTML.' });
    }

    // ── FASE 2: Costruisci PPTX ──
    const pptx = new PptxGenJS();
    const docTitle = slideData.title || 'Documento';
    pptx.title = docTitle;

    if (slideData.mode === 'slides') {
      // ═══ MODALITÀ SLIDE: screenshot pixel-perfect per ogni slide ═══
      const inchW = slideData.slideW / 96;
      const inchH = slideData.slideH / 96;
      pptx.defineLayout({ name: 'CUSTOM', width: inchW, height: inchH });
      pptx.layout = 'CUSTOM';

      console.log(`📊 PPTX Slide mode: ${slideData.rects.length} slide (${slideData.slideW}x${slideData.slideH}px)`);

      // Congela JS framework prima del loop (il framework re-resetterebbe lo state)
      await freezeJsExecution(page);

      for (let i = 0; i < slideData.rects.length; i++) {
        // Per layout absolute-positioned: mostra solo la slide corrente
        // Usa setProperty('important') per battere CSS .slide:not(.active) { visibility:hidden !important }
        if (slideData.overlapping) {
          await page.evaluate((idx) => {
            const result = window.__detectSlides(2);
            if (!result || !result.slideElements) return;
            result.slideElements.forEach((el, j) => {
              const visible = j === idx;
              el.style.setProperty('visibility', visible ? 'visible' : 'hidden', 'important');
              el.style.setProperty('opacity', visible ? '1' : '0', 'important');
              el.style.setProperty('display', visible ? 'block' : 'none', 'important');
            });
          }, i);
          // RAF overridden → usa Node setTimeout per repaint
          await new Promise(r => setTimeout(r, 80));
        }

        const rect = slideData.overlapping ? slideData.rects[0] : slideData.rects[i];
        const screenshotRaw = await page.screenshot({
          type: 'png',
          clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
        });
        const screenshotB64 = Buffer.from(screenshotRaw).toString('base64');

        const slide = pptx.addSlide();
        slide.addImage({
          data: `image/png;base64,${screenshotB64}`,
          x: 0, y: 0,
          w: inchW, h: inchH,
        });
      }

    } else {
      // ═══ MODALITÀ SCREENSHOT (dashboard, pagine, documenti) ═══
      const pageW = Math.min(slideData.pageW, 1400);
      const pageH = slideData.pageH;
      const chunkH = 720; // altezza di ogni "slide" in px

      // Viewport largo per rendere la pagina completa
      await page.setViewport({ width: pageW, height: chunkH });
      // Attendi reflow dopo resize
      await new Promise(r => setTimeout(r, 300));

      // Ricalcola altezza dopo reflow
      const finalH = await page.evaluate(() =>
        Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
      );

      const numChunks = Math.ceil(finalH / chunkH);
      const cappedChunks = Math.min(numChunks, 50);
      const slideInchW = pageW / 96;
      const slideInchH = chunkH / 96;
      pptx.defineLayout({ name: 'CUSTOM', width: slideInchW, height: slideInchH });
      pptx.layout = 'CUSTOM';

      console.log(`📸 Modalità SCREENSHOT: ${cappedChunks} pagine (${pageW}x${finalH}px, chunk ${chunkH}px)`);

      for (let i = 0; i < cappedChunks; i++) {
        const clipH = Math.min(chunkH, finalH - i * chunkH);
        const screenshotRaw = await page.screenshot({
          type: 'png',
          clip: { x: 0, y: i * chunkH, width: pageW, height: clipH },
        });
        const screenshotB64 = Buffer.from(screenshotRaw).toString('base64');

        const slide = pptx.addSlide();
        slide.background = { color: 'FFFFFF' };
        slide.addImage({
          data: `image/png;base64,${screenshotB64}`,
          x: 0, y: 0,
          w: slideInchW,
          h: (clipH / 96),
        });
      }
    }

    // ── Genera e invia PPTX ──
    const pptxBuffer = await pptx.write({ outputType: 'nodebuffer' });
    const fileName = `${safeFileName(docTitle, 'presentazione')}.pptx`;

    console.log(`✅ PPTX generato: ${fileName} (${(pptxBuffer.length / 1024).toFixed(0)}KB)`);

    setDownloadHeaders(res, {
      fileName,
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      contentLength: pptxBuffer.length,
    });
    res.end(pptxBuffer);
  } catch (err) {
    console.error('❌ Errore conversione PPTX:', err.message, err.stack);
    const b = getBrowserRef();
    if (b && !b.connected) clearBrowserRef();
    res.status(500).json({ error: `Conversione PPTX fallita: ${err.message}` });
  } finally {
    releaseSlot();
    if (page) await page.close().catch(() => {});
  }
});

// ── Endpoint PNG: screenshot per-slide (ZIP) o pagina intera ──
app.post('/convert-png', async (req, res) => {
  const { html } = req.body;
  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'Campo "html" mancante o non valido.' });
  }

  // Stessi tipi permessi di PPTX (include script per contenuti dinamici)
  const PNG_ALLOWED = new Set(['document', 'stylesheet', 'font', 'image', 'script']);

  try { await acquireSlot(); }
  catch { return res.status(429).json({ error: 'Server occupato, riprova tra qualche secondo.' }); }

  let page = null;
  try {
    const b = await getBrowser();
    page = await setupPage(b, html, PNG_ALLOWED);

    // ── Detect content type via scoring ──
    await page.addScriptTag({ content: SLIDE_DETECTION_JS });

    const slideInfo = await page.evaluate(() => {
      const det = window.__detectContent({ minSlides: 2 });
      if (!det || det.mode !== 'presentation' || !det.rects || det.rects.length < 2) return null;
      // det.slideW/slideH già Math.ceil in extractSlideElements
      return { count: det.rects.length, slideW: det.slideW, slideH: det.slideH };
    });

    // Titolo documento per nome file
    const docTitle = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      if (h1) return h1.textContent.trim();
      const t = document.querySelector('title');
      if (t) return t.textContent.trim();
      return '';
    });
    const safeName = safeFileName(docTitle, 'output');

    if (slideInfo) {
      // ═══ MODALITÀ SLIDE: uno screenshot per slide → ZIP ═══
      console.log(`🖼️  PNG Slide mode: ${slideInfo.count} slide (${slideInfo.slideW}x${slideInfo.slideH}px)`);

      // Misura prima i rect nel viewport corrente per determinare overlapping.
      // NOTA: NON impostiamo viewport=slideH*count perché il body con height:100vh
      // si stira al viewport → slide con height:100% diventano enormi → screenshot
      // pieni di vuoto. Lo screenshot clip funziona anche fuori dal viewport corrente.
      const slideRects = await page.evaluate((count) => {
        const result = window.__detectSlides(2);
        if (!result || !result.slideElements) return [];
        return result.slideElements.slice(0, count).map(el => {
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        });
      }, slideInfo.count);

      // Slide absolute-positioned (JS presentation style): same x AND y → screenshot one at a time
      const overlapping = slideRects.length >= 2 &&
        Math.abs(slideRects[0].y - slideRects[1].y) < 10 &&
        Math.abs(slideRects[0].x - slideRects[1].x) < 10;

      // Per slide non-overlapping (carousel verticale stacked), allarga viewport
      // alla bounding box totale così tutte le slide sono renderizzate prima dei screenshot.
      if (!overlapping && slideRects.length > 0) {
        const maxRight  = Math.max(...slideRects.map(r => r.x + r.w));
        const maxBottom = Math.max(...slideRects.map(r => r.y + r.h));
        await page.setViewport({ width: maxRight + 50, height: maxBottom + 50 });
        await new Promise(r => setTimeout(r, 200));
      }

      // Congela JS framework prima del loop
      await freezeJsExecution(page);

      const pngs = [];
      for (let i = 0; i < slideRects.length; i++) {
        if (overlapping) {
          await page.evaluate((idx) => {
            const result = window.__detectSlides(2);
            if (!result || !result.slideElements) return;
            result.slideElements.forEach((el, j) => {
              const visible = j === idx;
              el.style.setProperty('visibility', visible ? 'visible' : 'hidden', 'important');
              el.style.setProperty('opacity', visible ? '1' : '0', 'important');
              el.style.setProperty('display', visible ? 'block' : 'none', 'important');
            });
          }, i);
          // RAF overridden → usa Node setTimeout per repaint
          await new Promise(r => setTimeout(r, 80));
        }
        const rect = overlapping ? slideRects[0] : slideRects[i];
        const png = await page.screenshot({
          type: 'png',
          omitBackground: true,
          clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
        });
        pngs.push(png);
      }

      // Assembla ZIP
      const archiver = require('archiver');
      const zipName = `${safeName}.zip`;
      setDownloadHeaders(res, { fileName: zipName, contentType: 'application/zip' });
      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.pipe(res);
      for (let i = 0; i < pngs.length; i++) {
        archive.append(Buffer.from(pngs[i]), { name: `slide-${String(i + 1).padStart(2, '0')}.png` });
      }
      await archive.finalize();
      console.log(`✅ PNG ZIP generato: ${zipName} (${pngs.length} slide)`);

    } else {
      // ═══ MODALITÀ PAGINA SINGOLA: screenshot fullPage ═══
      const scrollDims = await page.evaluate(() => ({
        w: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
        h: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
      }));

      await page.setViewport({ width: scrollDims.w, height: scrollDims.h });
      await new Promise(r => setTimeout(r, 200));

      const png = await page.screenshot({ type: 'png', omitBackground: true, fullPage: true });
      const pngBuf = Buffer.from(png);

      const pngFileName = `${safeName}.png`;
      console.log(`✅ PNG singolo generato: ${pngFileName} (${(pngBuf.length / 1024).toFixed(0)}KB)`);

      setDownloadHeaders(res, {
        fileName: pngFileName,
        contentType: 'image/png',
        contentLength: pngBuf.length,
      });
      res.end(pngBuf);
    }
  } catch (err) {
    console.error('❌ Errore conversione PNG:', err.message, err.stack);
    const b = getBrowserRef();
    if (b && !b.connected) clearBrowserRef();
    res.status(500).json({ error: `Conversione PNG fallita: ${err.message}` });
  } finally {
    releaseSlot();
    if (page) await page.close().catch(() => {});
  }
});

// ── Graceful shutdown ──
async function shutdown() {
  console.log('⏹️  Chiusura in corso...');
  const b = getBrowserRef();
  if (b) await b.close().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ── Startup con warm-up browser + Substack sync ──
app.listen(PORT, async () => {
  console.log(`✅ Server attivo su http://localhost:${PORT}`);
  try {
    await getBrowser();
    console.log('🌐 Browser pronto');
  } catch (err) {
    console.error('⚠️  Warm-up browser fallito:', err.message);
  }

  // Avvia sync Substack in background. Se SUBSTACK_COOKIE non è settato il primo
  // sync logga 'reason' e non fa nulla. Se sync ha successo, ALLOWED_EMAILS viene
  // ricostruita con union(baseAllowed, syncedEmails).
  substackSync.startBackgroundSync(rebuildAllowedEmails);
  if (process.env.SUBSTACK_COOKIE) {
    console.log(`🔄 Substack sync attivo (publication=${substackSync.PUBLICATION}, every ${Math.round(substackSync.SYNC_INTERVAL_MS / 60000)}min)`);
  } else {
    console.log('ℹ️  SUBSTACK_COOKIE non impostato — sync Substack disattivata, uso solo allowlist hardcoded');
  }
});

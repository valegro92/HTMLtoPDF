const express = require('express');
const PptxGenJS = require('pptxgenjs');
const path = require('path');
const crypto = require('crypto');

const { getBrowser, setupPage, getBrowserRef, clearBrowserRef } = require('./lib/browser');
const { SLIDE_DETECTION_JS } = require('./lib/slide-detection');

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
].join(',');

const ALLOWED_EMAILS = new Set(
  (process.env.ALLOWED_EMAILS || DEFAULT_ALLOWED)
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
);

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

// ── Tipi di risorsa permessi per la conversione PDF ──
const ALLOWED_TYPES = new Set(['document', 'stylesheet', 'font', 'image', 'script']);

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
  const b = getBrowserRef();
  res.json({
    status: 'ok',
    browser: b?.connected ? 'connected' : 'disconnected',
    activeConversions,
    maxConcurrent: MAX_CONCURRENT,
  });
});

// ── Endpoint principale ──
app.post('/convert', async (req, res) => {
  if (activeConversions >= MAX_CONCURRENT) {
    return res.status(429).json({ error: 'Server occupato, riprova tra qualche secondo.' });
  }

  const { html, format = 'A4', fitToPage = false, singlePage = false } = req.body;

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
    page = await setupPage(b, html, ALLOWED_TYPES);

    let pdfOpts = {
      printBackground: true,
      margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
    };

    if (isAuto) {
      // 1. Detect slide mode: 3 strategie (vertical, slider/carousel, deep search)
      //    Saltato se singlePage=true → tratta sempre come pagina singola
      let slideInfo = null;
      if (!singlePage) {
        await page.addScriptTag({ content: SLIDE_DETECTION_JS });
        slideInfo = await page.evaluate(() => {
          const result = window.__detectSlides();
          if (!result) return null;

          const { slideElements, slideW, slideH, wrapperEl } = result;

          // Applica CSS per layout multi-pagina PDF
          // 1. Imposta il wrapper come layout verticale (block)
          document.body.style.margin = '0';
          document.body.style.padding = '0';
          document.body.style.background = 'white';
          document.body.style.display = 'block';
          document.body.style.overflow = 'visible';

          if (wrapperEl && wrapperEl !== document.body) {
            wrapperEl.style.display = 'block';
            wrapperEl.style.transform = 'none';
            wrapperEl.style.overflow = 'visible';
            wrapperEl.style.width = 'auto';
            wrapperEl.style.margin = '0';
            wrapperEl.style.padding = '0';
          }

          // 2. Ogni slide diventa una pagina PDF
          slideElements.forEach((el, i) => {
            el.style.pageBreakAfter = (i < slideElements.length - 1) ? 'always' : 'auto';
            el.style.pageBreakInside = 'avoid';
            el.style.margin = '0';
            el.style.boxShadow = 'none';
            el.style.borderRadius = '0';
            el.style.transform = 'none';
            el.style.position = 'relative';
            el.style.left = '0';
            el.style.top = 'auto';
            el.style.display = 'block';
            el.style.width = slideW + 'px';
            el.style.minHeight = slideH + 'px';
          });

          return { count: slideElements.length, w: Math.ceil(slideW), h: Math.ceil(slideH) };
        });
      }

      if (slideInfo) {
        // Slide mode: una pagina PDF per ogni slide
        console.log(`📄 PDF Slide mode: ${slideInfo.count} slide (${slideInfo.w}x${slideInfo.h}px)`);
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

    // Estrai titolo dal documento per il nome file
    const docTitle = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      if (h1) return h1.textContent.trim();
      const title = document.querySelector('title');
      if (title) return title.textContent.trim();
      return '';
    });
    const safeName = docTitle
      ? docTitle.replace(/[^a-zA-Z0-9À-ÿ\s-]/g, '').replace(/\s+/g, '_').substring(0, 80)
      : 'output';
    const fileName = `${safeName}.pdf`;

    const pdfResult = await page.pdf(pdfOpts);
    const pdfBuffer = Buffer.from(pdfResult);

    const encodedName = encodeURIComponent(fileName);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodedName}`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  } catch (err) {
    console.error('❌ Errore conversione PDF:', err.message, err.stack);
    const b = getBrowserRef();
    if (b && !b.connected) clearBrowserRef();
    res.status(500).json({ error: `Conversione fallita: ${err.message}` });
  } finally {
    activeConversions--;
    if (page) await page.close().catch(() => {});
  }
});

// ── Endpoint PPTX: converte HTML in PowerPoint (slide native o screenshot) ──
app.post('/convert-pptx', async (req, res) => {
  if (activeConversions >= MAX_CONCURRENT) {
    return res.status(429).json({ error: 'Server occupato, riprova tra qualche secondo.' });
  }

  const { html } = req.body;
  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'Campo "html" mancante o non valido.' });
  }

  // Tipi permessi per PPTX — include 'script' per contenuti dinamici (Chart.js, ecc.)
  const PPTX_ALLOWED = new Set(['document', 'stylesheet', 'font', 'image', 'script']);

  activeConversions++;
  let page = null;
  try {
    const b = await getBrowser();
    page = await setupPage(b, html, PPTX_ALLOWED);
    // Attendi rendering JS (Chart.js, ecc.)
    await new Promise(r => setTimeout(r, 500));

    // ── FASE 1: Rileva tipo di contenuto e estrai dati ──
    await page.addScriptTag({ content: SLIDE_DETECTION_JS });
    const slideData = await page.evaluate(() => {
      // ── Utilities ──
      function rgbToHex(rgb) {
        if (!rgb || rgb === 'transparent' || rgb === 'rgba(0, 0, 0, 0)') return null;
        const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return null;
        return ((1 << 24) + (parseInt(m[1]) << 16) + (parseInt(m[2]) << 8) + parseInt(m[3]))
          .toString(16).slice(1).toUpperCase();
      }
      function isTransparent(c) {
        return !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
      }
      function mapFAIcon(className) {
        const map = {
          'fa-check': '✓', 'fa-file': '📄', 'fa-cubes': '🧊',
          'fa-microscope': '🔬', 'fa-cloud': '☁', 'fa-recycle': '♻',
          'fa-seedling': '🌱', 'fa-map': '📍', 'fa-envelope': '✉',
          'fa-chart': '📊', 'fa-book': '📚', 'fa-helmet': '⛑',
          'fa-users': '👥', 'fa-file-contract': '📋', 'fa-star': '⭐',
          'fa-lightbulb': '💡', 'fa-gear': '⚙', 'fa-arrow': '→',
          'fa-circle': '●', 'fa-square': '■', 'fa-heart': '♥',
          'fa-phone': '📞', 'fa-globe': '🌐', 'fa-lock': '🔒',
          'fa-rocket': '🚀', 'fa-wrench': '🔧', 'fa-shield': '🛡',
        };
        for (const [key, val] of Object.entries(map)) {
          if (className.includes(key)) return val;
        }
        return '•';
      }

      function extractRichText(el) {
        const parts = [];
        function walkInline(node) {
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            if (text.trim() || (text.includes(' ') && parts.length > 0)) {
              const parent = node.parentElement;
              const style = getComputedStyle(parent);
              parts.push({
                text, bold: parseInt(style.fontWeight) >= 600,
                italic: style.fontStyle === 'italic',
                color: rgbToHex(style.color) || '333333',
                fontSize: Math.round(parseFloat(style.fontSize) * 0.75),
              });
            }
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const style = getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden') return;
            if (node.tagName === 'I' && node.className && node.className.includes('fa-')) {
              const iStyle = getComputedStyle(node);
              parts.push({
                text: mapFAIcon(node.className) + ' ', bold: false, italic: false,
                color: rgbToHex(iStyle.color) || 'F39C12',
                fontSize: Math.round(parseFloat(iStyle.fontSize) * 0.75),
              });
              return;
            }
            if (node.tagName === 'BR') {
              parts.push({ text: '\n', bold: false, italic: false, color: '333333', fontSize: 12 });
              return;
            }
            for (const child of node.childNodes) walkInline(child);
          }
        }
        walkInline(el);
        return parts;
      }

      function isTextBlock(el) {
        const tag = el.tagName.toLowerCase();
        if (['h1','h2','h3','h4','h5','h6','p','li','td','th','label','button'].includes(tag)) return true;
        if (tag === 'div' || tag === 'span' || tag === 'a') {
          for (const child of el.children) {
            const d = getComputedStyle(child).display;
            if (['block','flex','grid','table','list-item'].includes(d)) return false;
          }
          const hasText = Array.from(el.childNodes).some(n =>
            n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0
          );
          if (hasText) return true;
          if (el.children.length > 0 && el.textContent.trim().length > 0) return true;
        }
        return false;
      }

      function extractSlide(slideEl, slideW, slideH) {
        const slideRect = slideEl.getBoundingClientRect();
        const elements = [];
        const processed = new WeakSet();
        function markProcessed(el) {
          processed.add(el);
          el.querySelectorAll('*').forEach(d => processed.add(d));
        }
        function walk(el) {
          if (processed.has(el)) return;
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return;
          if (rect.width < 2 || rect.height < 2) return;
          const x = rect.left - slideRect.left;
          const y = rect.top - slideRect.top;
          const w = rect.width;
          const h = rect.height;
          if (x + w < 0 || y + h < 0 || x > slideW + 10 || y > slideH + 10) return;

          const bgColor = style.backgroundColor;
          if (!isTransparent(bgColor) && el !== slideEl) {
            const hex = rgbToHex(bgColor);
            const slideBg = rgbToHex(getComputedStyle(slideEl).backgroundColor) || 'FFFFFF';
            if (hex && hex !== slideBg) {
              elements.push({ type: 'shape', x, y, w, h, fill: hex, borderRadius: parseFloat(style.borderRadius) || 0 });
            }
          }
          const blWidth = parseFloat(style.borderLeftWidth);
          if (blWidth >= 3 && !isTransparent(style.borderLeftColor)) {
            elements.push({ type: 'shape', x, y, w: blWidth, h, fill: rgbToHex(style.borderLeftColor) || 'F39C12' });
          }
          if (el.tagName === 'HR') {
            elements.push({ type: 'shape', x, y: y + h/2, w, h: 1, fill: rgbToHex(style.borderTopColor) || 'CCCCCC' });
            markProcessed(el); return;
          }
          if (el.tagName === 'IMG') {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = rect.width;
              canvas.height = rect.height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(el, 0, 0, rect.width, rect.height);
              const dataUrl = canvas.toDataURL('image/png');
              elements.push({ type: 'image', x, y, w: rect.width, h: rect.height, dataUrl });
            } catch (e) { /* cross-origin: skip */ }
            markProcessed(el); return;
          }
          if (el.tagName === 'CANVAS' || el.tagName === 'SVG') {
            markProcessed(el); return;
          }
          if (isTextBlock(el)) {
            const fullText = el.textContent.trim();
            if (fullText) {
              const richParts = extractRichText(el);
              if (richParts.length > 0) {
                let align = style.textAlign;
                if (style.display === 'flex' && style.justifyContent === 'center') align = 'center';
                let valign = 'top';
                const ps = el.parentElement ? getComputedStyle(el.parentElement) : null;
                if (ps && ps.display === 'flex' && ps.alignItems === 'center') valign = 'middle';
                elements.push({ type: 'text', x, y, w, h, parts: richParts,
                  align: align === 'center' ? 'center' : align === 'right' ? 'right' : 'left',
                  valign, isBullet: el.tagName === 'LI' });
                markProcessed(el);
              }
            }
            return;
          }
          for (const child of el.children) walk(child);
        }
        walk(slideEl);
        return { bgColor: rgbToHex(getComputedStyle(slideEl).backgroundColor) || 'FFFFFF', elements };
      }

      // ── Titolo documento ──
      const docTitle = (() => {
        const h1 = document.querySelector('h1');
        if (h1) return h1.textContent.trim();
        const t = document.querySelector('title');
        if (t) return t.textContent.trim();
        return 'Presentazione';
      })();

      // ── DETECTION: trova slide candidates ──
      const detection = window.__detectSlides();

      // ── Se trovate slide → estrai contenuto nativo ──
      if (detection && detection.slideElements && detection.slideElements.length >= 2) {
        const { slideElements, slideW, slideH } = detection;
        return {
          mode: 'slides',
          title: docTitle,
          slideW, slideH,
          slides: slideElements.map(el => extractSlide(el, slideW, slideH)),
        };
      }

      // ── Nessuna slide → modalità screenshot ──
      return {
        mode: 'screenshot',
        title: docTitle,
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
      // ═══ MODALITÀ SLIDE NATIVE (editabili) ═══
      const inchW = slideData.slideW / 96;
      const inchH = slideData.slideH / 96;
      pptx.defineLayout({ name: 'CUSTOM', width: inchW, height: inchH });
      pptx.layout = 'CUSTOM';
      const sx = inchW / slideData.slideW;
      const sy = inchH / slideData.slideH;

      console.log(`📊 Modalità SLIDE: ${slideData.slides.length} slide (${slideData.slideW}x${slideData.slideH}px)`);

      for (const slideInfo of slideData.slides) {
        const slide = pptx.addSlide();
        slide.background = { color: slideInfo.bgColor };

        for (const el of slideInfo.elements) {
          if (el.type === 'shape') {
            const opts = {
              x: el.x * sx, y: el.y * sy, w: el.w * sx, h: el.h * sy,
              fill: { color: el.fill },
            };
            if (el.borderRadius > 0) opts.rectRadius = Math.min(el.borderRadius * sx, 0.3);
            slide.addShape('rect', opts);
          }
          if (el.type === 'image') {
            slide.addImage({
              data: el.dataUrl,
              x: el.x * sx, y: el.y * sy,
              w: el.w * sx, h: el.h * sy,
            });
          }
          if (el.type === 'text') {
            const textParts = el.parts.map(p => ({
              text: p.text,
              options: {
                bold: p.bold, italic: p.italic, color: p.color,
                fontSize: Math.max(p.fontSize, 6), fontFace: 'Open Sans',
              },
            }));
            if (textParts.length === 0) continue;
            slide.addText(textParts, {
              x: el.x * sx, y: el.y * sy,
              w: Math.max(el.w * sx, 0.5), h: Math.max(el.h * sy, 0.3),
              align: el.align || 'left', valign: el.valign || 'top',
              wrap: true, margin: [2, 4, 2, 4], paraSpaceAfter: 2,
            });
          }
        }
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
    const safeName = docTitle
      ? docTitle.replace(/[^a-zA-Z0-9À-ÿ\s-]/g, '').replace(/\s+/g, '_').substring(0, 80)
      : 'presentazione';
    const fileName = `${safeName}.pptx`;

    console.log(`✅ PPTX generato: ${fileName} (${(pptxBuffer.length / 1024).toFixed(0)}KB)`);

    const encodedName = encodeURIComponent(fileName);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodedName}`,
      'Content-Length': pptxBuffer.length,
    });
    res.end(pptxBuffer);
  } catch (err) {
    console.error('❌ Errore conversione PPTX:', err.message, err.stack);
    const b = getBrowserRef();
    if (b && !b.connected) clearBrowserRef();
    res.status(500).json({ error: `Conversione PPTX fallita: ${err.message}` });
  } finally {
    activeConversions--;
    if (page) await page.close().catch(() => {});
  }
});

// ── Endpoint PNG: screenshot per-slide (ZIP) o pagina intera ──
app.post('/convert-png', async (req, res) => {
  if (activeConversions >= MAX_CONCURRENT) {
    return res.status(429).json({ error: 'Server occupato, riprova tra qualche secondo.' });
  }

  const { html } = req.body;
  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'Campo "html" mancante o non valido.' });
  }

  // Stessi tipi permessi di PPTX (include script per contenuti dinamici)
  const PNG_ALLOWED = new Set(['document', 'stylesheet', 'font', 'image', 'script']);

  activeConversions++;
  let page = null;
  try {
    const b = await getBrowser();
    page = await setupPage(b, html, PNG_ALLOWED);
    // Attendi rendering JS
    await new Promise(r => setTimeout(r, 500));

    // ── Detect slide mode ──
    await page.addScriptTag({ content: SLIDE_DETECTION_JS });

    const slideInfo = await page.evaluate(() => {
      const result = window.__detectSlides();
      if (!result || !result.slideElements || result.slideElements.length < 2) return null;
      return {
        count: result.slideElements.length,
        slideW: Math.ceil(result.slideW),
        slideH: Math.ceil(result.slideH),
      };
    });

    // Titolo documento per nome file
    const docTitle = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      if (h1) return h1.textContent.trim();
      const t = document.querySelector('title');
      if (t) return t.textContent.trim();
      return '';
    });
    const safeName = docTitle
      ? docTitle.replace(/[^a-zA-Z0-9À-ÿ\s-]/g, '').replace(/\s+/g, '_').substring(0, 80)
      : 'output';

    if (slideInfo) {
      // ═══ MODALITÀ SLIDE: uno screenshot per slide → ZIP ═══
      console.log(`🖼️  PNG Slide mode: ${slideInfo.count} slide (${slideInfo.slideW}x${slideInfo.slideH}px)`);

      // Imposta viewport abbastanza grande da contenere tutte le slide
      await page.setViewport({ width: slideInfo.slideW, height: slideInfo.slideH * slideInfo.count + 200 });
      await new Promise(r => setTimeout(r, 200));

      // Ottieni i bounding rect di ogni slide rilevata (stessa logica di __detectSlides)
      const rects = await page.evaluate((count) => {
        const result = window.__detectSlides();
        if (!result || !result.slideElements) return [];
        return result.slideElements.slice(0, count).map(el => {
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        });
      }, slideInfo.count);

      const pngs = [];
      for (const rect of rects) {
        const png = await page.screenshot({
          type: 'png',
          clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
        });
        pngs.push(png);
      }

      // Assembla ZIP
      const archiver = require('archiver');
      res.set({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="slides.zip"`,
      });
      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.pipe(res);
      for (let i = 0; i < pngs.length; i++) {
        archive.append(Buffer.from(pngs[i]), { name: `slide-${String(i + 1).padStart(2, '0')}.png` });
      }
      await archive.finalize();
      console.log(`✅ PNG ZIP generato: ${pngs.length} slide`);

    } else {
      // ═══ MODALITÀ PAGINA SINGOLA: screenshot fullPage ═══
      const scrollDims = await page.evaluate(() => ({
        w: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
        h: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
      }));

      await page.setViewport({ width: scrollDims.w, height: scrollDims.h });
      await new Promise(r => setTimeout(r, 200));

      const png = await page.screenshot({ type: 'png', fullPage: true });
      const pngBuf = Buffer.from(png);

      console.log(`✅ PNG singolo generato: ${safeName}.png (${(pngBuf.length / 1024).toFixed(0)}KB)`);

      res.set({
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="${safeName}.png"`,
        'Content-Length': pngBuf.length,
      });
      res.end(pngBuf);
    }
  } catch (err) {
    console.error('❌ Errore conversione PNG:', err.message, err.stack);
    const b = getBrowserRef();
    if (b && !b.connected) clearBrowserRef();
    res.status(500).json({ error: `Conversione PNG fallita: ${err.message}` });
  } finally {
    activeConversions--;
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

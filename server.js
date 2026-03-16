const express = require('express');
const puppeteer = require('puppeteer');
const PptxGenJS = require('pptxgenjs');
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

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
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

// ── Endpoint PPTX: converte HTML slide in PowerPoint nativo editabile ──
app.post('/convert-pptx', async (req, res) => {
  if (activeConversions >= MAX_CONCURRENT) {
    return res.status(429).json({ error: 'Server occupato, riprova tra qualche secondo.' });
  }

  const { html } = req.body;
  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'Campo "html" mancante o non valido.' });
  }

  activeConversions++;
  let page = null;
  try {
    const b = await getBrowser();
    page = await b.newPage();

    await page.setRequestInterception(true);
    page.on('request', (intercepted) => {
      const url = intercepted.url();
      const type = intercepted.resourceType();
      if (BLOCKED_HOSTS.test(url)) return intercepted.abort();
      if (!ALLOWED_TYPES.has(type)) return intercepted.abort();
      intercepted.continue();
    });

    await page.setViewport({ width: 1280, height: 900 });
    await page.setContent(html, { waitUntil: 'networkidle2', timeout: 15000 });

    // ── Estrai struttura slide dal DOM ──
    const slideData = await page.evaluate(() => {
      // Utility: converti rgb/rgba CSS in hex senza #
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

      // Mappa icone Font Awesome → emoji unicode
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

      // Estrai rich text (inline formatting) da un elemento
      function extractRichText(el) {
        const parts = [];
        function walkInline(node) {
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            if (text.trim() || (text.includes(' ') && parts.length > 0)) {
              const parent = node.parentElement;
              const style = getComputedStyle(parent);
              parts.push({
                text: text,
                bold: parseInt(style.fontWeight) >= 600,
                italic: style.fontStyle === 'italic',
                color: rgbToHex(style.color) || '333333',
                fontSize: Math.round(parseFloat(style.fontSize) * 0.75), // px → pt
              });
            }
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const style = getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden') return;

            // Font Awesome icons → unicode
            if (node.tagName === 'I' && node.className && node.className.includes('fa-')) {
              const icon = mapFAIcon(node.className);
              const iStyle = getComputedStyle(node);
              parts.push({
                text: icon + ' ',
                bold: false,
                italic: false,
                color: rgbToHex(iStyle.color) || 'F39C12',
                fontSize: Math.round(parseFloat(iStyle.fontSize) * 0.75),
              });
              return;
            }

            // <br> → newline
            if (node.tagName === 'BR') {
              parts.push({ text: '\n', bold: false, italic: false, color: '333333', fontSize: 12 });
              return;
            }

            for (const child of node.childNodes) {
              walkInline(child);
            }
          }
        }
        walkInline(el);
        return parts;
      }

      // Determina se un elemento è un "text block" (foglia testuale)
      function isTextBlock(el) {
        const tag = el.tagName.toLowerCase();
        const explicitTextTags = ['h1','h2','h3','h4','h5','h6','p','li','td','th','label','button'];
        if (explicitTextTags.includes(tag)) return true;

        // Div senza figli block-level → text block
        if (tag === 'div' || tag === 'span' || tag === 'a') {
          for (const child of el.children) {
            const d = getComputedStyle(child).display;
            if (['block','flex','grid','table','list-item'].includes(d)) return false;
          }
          // Ha testo diretto?
          const hasText = Array.from(el.childNodes).some(n =>
            n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0
          );
          if (hasText) return true;
          // Oppure ha solo inline children con testo
          if (el.children.length > 0 && el.textContent.trim().length > 0) return true;
        }
        return false;
      }

      // ── Detect slide containers ──
      const allChildren = Array.from(document.body.children).filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 100 && r.height > 100;
      });

      if (allChildren.length < 1) return null;

      // Titolo documento
      const docTitle = (() => {
        const h1 = document.querySelector('h1');
        if (h1) return h1.textContent.trim();
        const title = document.querySelector('title');
        if (title) return title.textContent.trim();
        return 'Presentazione';
      })();

      const firstRect = allChildren[0].getBoundingClientRect();
      const slideW = firstRect.width;
      const slideH = firstRect.height;

      // ── Estrai elementi da ogni slide ──
      function extractSlide(slideEl) {
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

          // Fuori dai bordi della slide → skip
          if (x + w < 0 || y + h < 0 || x > slideW + 10 || y > slideH + 10) return;

          // 1. Shape: elemento con background visibile
          const bgColor = style.backgroundColor;
          if (!isTransparent(bgColor) && el !== slideEl) {
            const hex = rgbToHex(bgColor);
            // Skip bianco su sfondo bianco
            const slideBg = rgbToHex(getComputedStyle(slideEl).backgroundColor) || 'FFFFFF';
            if (hex && hex !== slideBg) {
              elements.push({
                type: 'shape',
                x, y, w, h,
                fill: hex,
                borderRadius: parseFloat(style.borderRadius) || 0,
              });
            }
          }

          // 2. Accent: border-left significativo
          const blWidth = parseFloat(style.borderLeftWidth);
          if (blWidth >= 3 && !isTransparent(style.borderLeftColor)) {
            elements.push({
              type: 'shape',
              x: x, y, w: blWidth, h,
              fill: rgbToHex(style.borderLeftColor) || 'F39C12',
            });
          }

          // 3. HR → linea sottile
          if (el.tagName === 'HR') {
            const borderColor = rgbToHex(style.borderTopColor) || 'CCCCCC';
            elements.push({
              type: 'shape',
              x, y: y + h / 2, w, h: 1,
              fill: borderColor,
            });
            markProcessed(el);
            return;
          }

          // 4. IMG → segnaposto (non possiamo estrarre immagini esterne facilmente)
          if (el.tagName === 'IMG') {
            // Per ora skip, le immagini non vengono convertite
            markProcessed(el);
            return;
          }

          // 5. Text block → estrai rich text
          if (isTextBlock(el)) {
            const fullText = el.textContent.trim();
            if (fullText) {
              const richParts = extractRichText(el);
              if (richParts.length > 0) {
                // Detect alignment
                let align = style.textAlign;
                if (style.display === 'flex') {
                  if (style.justifyContent === 'center') align = 'center';
                }

                // Detect vertical align for flex containers
                let valign = 'top';
                const parentStyle = el.parentElement ? getComputedStyle(el.parentElement) : null;
                if (parentStyle && parentStyle.display === 'flex') {
                  if (parentStyle.alignItems === 'center') valign = 'middle';
                }

                elements.push({
                  type: 'text',
                  x, y, w, h,
                  parts: richParts,
                  align: align === 'center' ? 'center' : align === 'right' ? 'right' : 'left',
                  valign,
                  isBullet: el.tagName === 'LI',
                });

                markProcessed(el);
              }
            }
            return;
          }

          // Ricorri nei figli
          for (const child of el.children) {
            walk(child);
          }
        }

        walk(slideEl);

        return {
          bgColor: rgbToHex(getComputedStyle(slideEl).backgroundColor) || 'FFFFFF',
          elements,
        };
      }

      return {
        title: docTitle,
        slideW,
        slideH,
        slides: allChildren.map(extractSlide),
      };
    });

    if (!slideData || !slideData.slides || slideData.slides.length === 0) {
      return res.status(400).json({ error: 'Nessuna slide trovata. L\'HTML deve contenere elementi slide.' });
    }

    console.log(`📊 Estratte ${slideData.slides.length} slide (${slideData.slideW}x${slideData.slideH}px)`);

    // ── Costruisci PPTX con pptxgenjs ──
    const pptx = new PptxGenJS();

    // Imposta dimensioni slide (px → inches a 96 DPI)
    const inchW = slideData.slideW / 96;
    const inchH = slideData.slideH / 96;
    pptx.defineLayout({ name: 'CUSTOM', width: inchW, height: inchH });
    pptx.layout = 'CUSTOM';
    pptx.title = slideData.title;

    // Fattore di scala px → inches
    const sx = inchW / slideData.slideW;
    const sy = inchH / slideData.slideH;

    for (const slideInfo of slideData.slides) {
      const slide = pptx.addSlide();
      slide.background = { color: slideInfo.bgColor };

      for (const el of slideInfo.elements) {
        if (el.type === 'shape') {
          const shapeOpts = {
            x: el.x * sx,
            y: el.y * sy,
            w: el.w * sx,
            h: el.h * sy,
            fill: { color: el.fill },
          };
          if (el.borderRadius > 0) {
            shapeOpts.rectRadius = Math.min(el.borderRadius * sx, 0.3);
          }
          slide.addShape('rect', shapeOpts);
        }

        if (el.type === 'text') {
          // Costruisci array di text parts per pptxgenjs
          const textParts = el.parts.map(p => ({
            text: p.text,
            options: {
              bold: p.bold,
              italic: p.italic,
              color: p.color,
              fontSize: Math.max(p.fontSize, 6), // minimo 6pt
              fontFace: 'Open Sans',
            },
          }));

          if (textParts.length === 0) continue;

          const textOpts = {
            x: el.x * sx,
            y: el.y * sy,
            w: Math.max(el.w * sx, 0.5),
            h: Math.max(el.h * sy, 0.3),
            align: el.align || 'left',
            valign: el.valign || 'top',
            wrap: true,
            margin: [2, 4, 2, 4], // piccolo margine pt
            paraSpaceAfter: 2,
          };

          // I bullet li hanno già l'icona nel testo grazie alla FA→emoji conversion
          slide.addText(textParts, textOpts);
        }
      }
    }

    // Genera buffer PPTX
    const pptxBuffer = await pptx.write({ outputType: 'nodebuffer' });

    const safeName = slideData.title
      ? slideData.title.replace(/[^a-zA-Z0-9À-ÿ\s-]/g, '').replace(/\s+/g, '_').substring(0, 80)
      : 'presentazione';
    const fileName = `${safeName}.pptx`;

    console.log(`✅ PPTX generato: ${fileName} (${(pptxBuffer.length / 1024).toFixed(0)}KB, ${slideData.slides.length} slide)`);

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': pptxBuffer.length,
    });
    res.end(pptxBuffer);
  } catch (err) {
    console.error('❌ Errore conversione PPTX:', err.message, err.stack);
    if (browser && !browser.connected) browser = null;
    res.status(500).json({ error: `Conversione PPTX fallita: ${err.message}` });
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

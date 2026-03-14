const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_RENDER = !!process.env.RENDER;

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let browser = null;

async function getBrowser() {
  if (!browser || !browser.connected) {
    const launchOpts = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
      ],
    };

    // Su Render, Puppeteer scarica Chrome in una cache specifica
    if (IS_RENDER) {
      const cacheDir = process.env.PUPPETEER_CACHE_DIR || '/opt/render/.cache/puppeteer';
      const fs = require('fs');
      // Trova l'eseguibile Chrome nella cache di Render
      const findChrome = (dir) => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isFile() && (entry.name === 'chrome' || entry.name === 'headless_shell')) return fullPath;
            if (entry.isDirectory()) {
              const found = findChrome(fullPath);
              if (found) return found;
            }
          }
        } catch { /* ignore */ }
        return null;
      };
      const chromePath = findChrome(cacheDir);
      if (chromePath) {
        console.log(`🌐 Chrome trovato: ${chromePath}`);
        launchOpts.executablePath = chromePath;
      }
    }

    browser = await puppeteer.launch(launchOpts);
    console.log(`🚀 Browser avviato (Render: ${IS_RENDER})`);
  }
  return browser;
}

// Dimensioni pagina in px a 96 DPI
const PAGE_PX = {
  A4:     { w: 794, h: 1123 },
  Letter: { w: 816, h: 1056 },
  A3:     { w: 1123, h: 1587 },
};

app.post('/convert', async (req, res) => {
  const { html, format = 'A4', fitToPage = false } = req.body;

  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'Campo "html" mancante o non valido.' });
  }

  const validFormats = ['A4', 'Letter', 'A3', 'Auto'];
  const pageFormat = validFormats.includes(format) ? format : 'A4';
  const isAuto = pageFormat === 'Auto';

  let page = null;
  try {
    const b = await getBrowser();
    page = await b.newPage();

    await page.setViewport({ width: 1280, height: 900 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    let pdfOpts = {
      printBackground: true,
      margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
    };

    if (isAuto) {
      // Trova l'elemento principale del contenuto e usa le sue dimensioni
      const contentBox = await page.evaluate(() => {
        // Cerca il primo figlio diretto del body che contiene il contenuto
        const body = document.body;
        const children = Array.from(body.children);
        // Prendi il contenitore principale (il più grande)
        let main = body;
        if (children.length > 0) {
          main = children.reduce((best, el) => {
            const r = el.getBoundingClientRect();
            const bestR = best.getBoundingClientRect();
            return (r.width * r.height) > (bestR.width * bestR.height) ? el : best;
          });
        }
        const rect = main.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          w: Math.ceil(rect.width),
          h: Math.ceil(rect.height),
        };
      });

      // Riposiziona viewport alla larghezza del contenuto + padding
      const padding = 0;
      const vpWidth = contentBox.w + padding * 2;
      await page.setViewport({ width: vpWidth, height: 900 });

      // Rimuovi sfondo body, centra il contenuto senza margini laterali
      await page.evaluate(() => {
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.body.style.display = 'block';
        // Cerca il container e rimuovi max-width/centering
        const main = Array.from(document.body.children).reduce((best, el) => {
          const r = el.getBoundingClientRect();
          const bestR = best.getBoundingClientRect();
          return (r.width * r.height) > (bestR.width * bestR.height) ? el : best;
        });
        if (main !== document.body) {
          main.style.maxWidth = '100%';
          main.style.width = '100%';
          main.style.margin = '0';
          main.style.borderRadius = '0';
        }
      });

      // Aspetta reflow
      await new Promise(r => setTimeout(r, 300));

      // Ri-misura dopo le modifiche
      const finalDims = await page.evaluate(() => ({
        w: document.body.scrollWidth,
        h: document.body.scrollHeight,
      }));

      // PDF con dimensioni esatte del contenuto (in px, Puppeteer accetta 'Xpx')
      pdfOpts.width = finalDims.w + 'px';
      pdfOpts.height = finalDims.h + 'px';

    } else if (fitToPage) {
      // Scala il contenuto per farlo entrare nella pagina scelta
      const dims = await page.evaluate(() => ({
        w: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
        h: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
      }));

      const target = PAGE_PX[pageFormat];
      const scale = Math.min(target.w / dims.w, target.h / dims.h, 1);

      if (scale < 1) {
        await page.evaluate((z) => {
          document.documentElement.style.zoom = z;
        }, scale);
        await new Promise(r => setTimeout(r, 200));
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
    console.error('Errore conversione PDF:', err.message);
    res.status(500).json({ error: `Conversione fallita: ${err.message}` });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

process.on('SIGINT', async () => {
  if (browser) await browser.close();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Server attivo su http://localhost:${PORT}`);
});

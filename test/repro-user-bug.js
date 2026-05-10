'use strict';

/**
 * Riproduce il caso utente: HTML con .slide{position:absolute; opacity:0; visibility:hidden},
 * .slide.active{opacity:1; visibility:visible; z-index:10}.
 *
 * Simula esattamente il flusso server.js /convert-png slide loop:
 *  1. setupPage (con visibility forcing via extractSlideElements)
 *  2. detectContent → mode=presentation, popola cache __lastDetectedSlides
 *  3. freezeJsExecution (kill timers/observers)
 *  4. per ogni slide: evaluate visibility toggle via __detectSlides()
 *  5. screenshot clip
 *
 * Salva ogni screenshot per ispezione visiva.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const DETECTOR = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'content-detector.js'), 'utf8',
);
const HTML = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'user-ux-analyzer.html'), 'utf8',
);
const OUT_DIR = path.join(__dirname, '..', '/tmp', 'repro-screenshots');
fs.mkdirSync(OUT_DIR, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const allowed = new Set(['document', 'stylesheet', 'font', 'image', 'script']);
    if (!allowed.has(req.resourceType())) return req.abort();
    req.continue();
  });

  await page.setContent(HTML, { waitUntil: 'networkidle2', timeout: 15000 });
  // Replica setupPage: disabilita transitions sennò setProperty('transform') ritarda
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important; animation-delay: 0s !important;
      transition-duration: 0s !important; transition-delay: 0s !important;
    }`,
  });
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await new Promise(r => setTimeout(r, 800));

  await page.addScriptTag({ content: DETECTOR });

  // STEP 1: detect (popola cache)
  const det = await page.evaluate(() => window.__detectContent({ minSlides: 2, debug: true, extractSlides: true }));
  console.log(`Detection: mode=${det.mode} confidence=${det.confidence}`);
  console.log(`Rects (${det.rects ? det.rects.length : 0}):`, JSON.stringify(det.rects));
  console.log(`overlapping=${det.overlapping} slideW=${det.slideW} slideH=${det.slideH}`);

  if (det.mode !== 'presentation' || !det.rects) {
    console.log('NOT a presentation, aborting repro');
    await browser.close();
    process.exit(1);
  }

  // STEP 2: verifica shim
  const shimResult = await page.evaluate(() => {
    const r = window.__detectSlides();
    return r ? {
      hasSlideElements: !!r.slideElements,
      slideElementsCount: r.slideElements ? r.slideElements.length : 0,
      slideW: r.slideW,
      slideH: r.slideH,
    } : null;
  });
  console.log('Shim __detectSlides():', JSON.stringify(shimResult));

  // STEP 3: screenshot per ogni slide (overlapping mode)
  if (det.overlapping) {
    console.log('\nScreenshot loop (overlapping, visibility toggle):');
    for (let i = 0; i < det.rects.length; i++) {
      const ok = await page.evaluate((idx) => {
        const result = window.__detectSlides();
        if (!result || !result.slideElements) return { ok: false, reason: 'no slideElements' };
        let toggled = 0;
        result.slideElements.forEach((el, j) => {
          const visible = j === idx;
          el.style.setProperty('visibility', visible ? 'visible' : 'hidden', 'important');
          el.style.setProperty('opacity', visible ? '1' : '0', 'important');
          el.style.setProperty('display', visible ? 'block' : 'none', 'important');
          toggled++;
        });
        return { ok: true, toggled, totalSlides: result.slideElements.length };
      }, i);
      await new Promise(r => setTimeout(r, 100));
      console.log(`  slide ${i+1}: toggle=${JSON.stringify(ok)}`);

      const rect = det.overlapping ? det.rects[0] : det.rects[i];
      const png = await page.screenshot({
        type: 'png',
        omitBackground: true,
        clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
      });
      const filePath = path.join(OUT_DIR, `slide-${String(i+1).padStart(2,'0')}.png`);
      fs.writeFileSync(filePath, png);
      console.log(`  → written ${filePath} (${(png.length / 1024).toFixed(0)}KB)`);
    }
  }

  await browser.close();
  console.log('\nDONE — screenshots in', OUT_DIR);
})();

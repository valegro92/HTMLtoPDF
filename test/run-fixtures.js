'use strict';

/**
 * Test runner per il content-detector sulle fixture HTML.
 * Apre ogni fixture in headless Chrome, esegue __detectContent, e verifica
 * le aspettative (mode + confidence minima).
 *
 * Run: `node test/run-fixtures.js`  (richiede Chrome installato — usa
 * PUPPETEER_EXECUTABLE_PATH se presente, altrimenti il bundled Chrome).
 *
 * Exit code: 0 se tutti i test passano, 1 se qualcuno fallisce, 2 se Chrome
 * non è disponibile.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const DETECTOR_SCRIPT = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'content-detector.js'),
  'utf8',
);
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// Aspettative per ogni fixture: mode atteso (string o array di alternativi)
// + soglia minima di confidence. Il "NOT-presentation" su landing è importante
// per evitare il falso positivo storico su <section> full-viewport.
const EXPECTATIONS = {
  'reveal-deck.html':               { mode: 'presentation', minConfidence: 0.50 },
  'swiper-carousel.html':           { mode: 'presentation', minConfidence: 0.40 },
  // .slide:not(.active){display:none!important} → rect 0×0 sulle nascoste,
  // similar_size_viewport_kids non spara → confidence più bassa ma mode OK
  'reveal-with-active.html':        { mode: 'presentation', minConfidence: 0.35 },
  // Cover verticale 720×1280 + 4 slide orizzontali 1280×720 → similar non spara
  'mixed-cover-slide.html':         { mode: 'presentation', minConfidence: 0.25 },
  'a4-report.html':                 { mode: 'document',     minConfidence: 0.40 },
  'email-template.html':            { mode: 'email',        minConfidence: 0.40 },
  'infographic-long.html':          { mode: 'infographic',  minConfidence: 0.30 },
  'dashboard-fixed.html':           { mode: 'dashboard',    minConfidence: 0.30 },
  'landing-hero-features-cta.html': { mode: ['document', 'infographic', 'unknown'], minConfidence: 0 },
};

async function runFixture(browser, fixtureName) {
  const html = fs.readFileSync(path.join(FIXTURES_DIR, fixtureName), 'utf8');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  await page.setRequestInterception(true);
  const allowed = new Set(['document', 'stylesheet', 'font', 'image', 'script']);
  page.on('request', (req) => {
    if (!allowed.has(req.resourceType())) return req.abort();
    req.continue();
  });

  try {
    await page.setContent(html, { waitUntil: 'networkidle2', timeout: 10000 });
  } catch (_) {
    // Alcune fixture caricano CDN che possono timeout — la struttura DOM è già a posto
  }
  await page.addScriptTag({ content: DETECTOR_SCRIPT });
  const result = await page.evaluate(() =>
    window.__detectContent({ minSlides: 2, debug: true, extractSlides: true }),
  );
  // Sanity: per presentation, il shim __detectSlides() deve ritornare un oggetto
  // con slideElements (Array DOM). Era rotto: tornava .elements rompendo il loop
  // visibility-toggle nei 3 endpoint server.
  const slideShim = await page.evaluate(() => {
    const r = window.__detectSlides && window.__detectSlides();
    if (!r) return null;
    return {
      hasSlideElements: Array.isArray(r.slideElements) || (r.slideElements && r.slideElements.length !== undefined),
      slideElementsCount: r.slideElements ? r.slideElements.length : 0,
      hasSlideW: typeof r.slideW === 'number',
      hasSlideH: typeof r.slideH === 'number',
    };
  });
  result.__slideShim = slideShim;
  await page.close();
  return result;
}

function check(result, expected) {
  const expectedModes = Array.isArray(expected.mode) ? expected.mode : [expected.mode];
  const modeOk = expectedModes.includes(result.mode);
  const confOk = result.confidence >= expected.minConfidence;
  // Per presentation, valida anche shape del return (slideElements + slideW/H).
  // Era il bug: il shim ritornava {elements,w,h}, server.js leggeva slideElements.
  const shimOk = result.mode !== 'presentation' || (
    result.__slideShim &&
    result.__slideShim.hasSlideElements &&
    result.__slideShim.slideElementsCount >= 2 &&
    result.__slideShim.hasSlideW &&
    result.__slideShim.hasSlideH
  );
  return { modeOk, confOk, shimOk, allOk: modeOk && confOk && shimOk };
}

function fmt(s, len) {
  s = String(s);
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      ...(process.env.PUPPETEER_EXECUTABLE_PATH && { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }),
    });
  } catch (err) {
    console.error('❌ Puppeteer launch failed:', err.message);
    console.error('Imposta PUPPETEER_EXECUTABLE_PATH se Chrome è in path non standard.');
    process.exit(2);
  }

  const fixtures = Object.keys(EXPECTATIONS);
  const results = [];

  console.log('\n┌─ Detector test (9 fixture) ────────────────────────────────────────────────────┐\n');
  for (const fixture of fixtures) {
    process.stdout.write(`  ${fmt(fixture, 38)} `);
    try {
      const result = await runFixture(browser, fixture);
      const expected = EXPECTATIONS[fixture];
      const c = check(result, expected);
      const expectedStr = Array.isArray(expected.mode) ? expected.mode.join('|') : expected.mode;
      const status = c.allOk ? '✓' : '✗';
      console.log(`${status} ${fmt(result.mode, 13)} conf=${result.confidence.toFixed(2)}  (expect: ${expectedStr}, ≥${expected.minConfidence})`);
      results.push({ fixture, expected, result, check: c });
    } catch (err) {
      console.log(`✗ ERROR: ${err.message}`);
      results.push({ fixture, error: err.message });
    }
  }

  await browser.close();

  const passed = results.filter(r => r.check && r.check.allOk).length;
  const total = results.length;
  console.log(`\n└─ ${passed}/${total} passed ${'─'.repeat(Math.max(0, 64 - String(passed + '/' + total).length))}┘\n`);

  const failed = results.filter(r => r.error || (r.check && !r.check.allOk));
  if (failed.length) {
    console.log('Failed details:');
    failed.forEach(r => {
      if (r.error) {
        console.log(`  • ${r.fixture}: ERROR — ${r.error}`);
        return;
      }
      const sigList = (r.result.signals || []).map(s => `${s.name}(+${s.weight}→${s.mode})`).join(', ');
      console.log(`  • ${r.fixture}`);
      console.log(`      got:    ${r.result.mode} conf=${r.result.confidence}`);
      console.log(`      expect: ${JSON.stringify(r.expected)}`);
      console.log(`      scores: ${JSON.stringify(r.result.scores)}`);
      console.log(`      fired:  ${sigList || '(none)'}\n`);
    });
    process.exit(1);
  }
  process.exit(0);
})();

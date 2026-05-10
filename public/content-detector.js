/**
 * content-detector.js — modulo isomorfo (browser + Puppeteer page context).
 *
 * Espone:
 *   window.__detectContent({ minSlides?, debug?, viewport? }) → result
 *   window.__detectSlides(minSlides) → { slideElements, slideW, slideH } | null  (compat shim)
 *
 * Architettura: signal table additiva pesata. Per ogni input HTML calcoliamo signal
 * indipendenti, sommiamo per ogni "modalità" candidata, e scegliamo il vincitore con
 * gating su confidence + margine sul secondo posto. Sotto soglia → mode 'unknown' →
 * fallback screenshot universale (mai fallisce).
 *
 * Modalità: presentation | document | infographic | dashboard | email | unknown
 */
(function (global) {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────
  // SIGNAL TABLE — additiva, pesata 1-10. Pesi negativi = exclusion signals.
  // ─────────────────────────────────────────────────────────────────────────
  const SIGNALS = [
    // ── presentation ──
    { name: 'marker_class_2plus',         mode: 'presentation', weight: 10, fn: c => c.markerCount >= 2 },
    { name: 'data_slide_attr_2plus',      mode: 'presentation', weight:  9, fn: c => c.dataSlideCount >= 2 },
    { name: 'presentation_script',        mode: 'presentation', weight:  8, fn: c => c.hasPresentationScript },
    { name: 'meta_generator_slides',      mode: 'presentation', weight:  7, fn: c => /reveal|gamma|slides|impress|spectacle|deck\.js|swiper/i.test(c.metaGenerator || '') },
    { name: 'similar_size_viewport_kids', mode: 'presentation', weight:  6, fn: c => c.similarSizedViewportChildren >= 2 },
    { name: 'aspect_16_9_candidates',     mode: 'presentation', weight:  5, fn: c => c.candidateAspect16x9 },
    { name: 'absolute_overlapping_kids',  mode: 'presentation', weight:  6, fn: c => c.absoluteOverlappingChildren >= 2 },
    { name: 'has_header_footer',          mode: 'presentation', weight: -4, fn: c => c.hasHeaderTag && c.hasFooterTag },

    // ── document ──
    { name: 'css_at_page_rule',           mode: 'document',     weight:  9, fn: c => c.hasAtPage },
    { name: 'aspect_paper_size',          mode: 'document',     weight:  6, fn: c => c.bodyAspectRatioMatchesPaper },
    { name: 'multi_h2_h3_with_article',   mode: 'document',     weight:  5, fn: c => c.h2h3Count >= 2 && c.hasArticle },
    { name: 'page_break_after_block',     mode: 'document',     weight:  5, fn: c => c.hasPageBreakAfter },
    { name: 'has_header_and_footer_doc',  mode: 'document',     weight:  3, fn: c => c.hasHeaderTag && c.hasFooterTag },

    // ── infographic ──
    { name: 'tall_no_slide_markers',      mode: 'infographic',  weight:  6, fn: c => c.bodyHeightRatio > 3 && c.markerCount === 0 },
    { name: 'many_imgs_svgs',             mode: 'infographic',  weight:  4, fn: c => (c.imgCount + c.svgCount) > 8 },
    { name: 'high_grid_flex_density',     mode: 'infographic',  weight:  3, fn: c => c.gridFlexDensity > 0.3 },

    // ── email ──
    { name: 'outer_table_with_nested',    mode: 'email',        weight:  8, fn: c => c.hasOuterTable && c.nestedTableCount >= 3 },
    { name: 'inline_style_high_density',  mode: 'email',        weight:  5, fn: c => c.inlineStyleRatio > 0.4 },

    // ── dashboard ──
    { name: 'canvas_chart_fixed_viewport',mode: 'dashboard',    weight:  6, fn: c => c.canvasCount >= 1 && c.bodyHeightRatio < 1.5 },
    { name: 'body_height_near_viewport',  mode: 'dashboard',    weight:  4, fn: c => c.bodyHeightRatio > 0.8 && c.bodyHeightRatio < 1.2 },
  ];

  const MAX_WEIGHTS = SIGNALS.reduce((acc, s) => {
    if (s.weight > 0) acc[s.mode] = (acc[s.mode] || 0) + s.weight;
    return acc;
  }, {});

  const FORMAT_BY_MODE = {
    presentation: 'PPTX',
    document:     'PDF',
    infographic:  'PNG',
    dashboard:    'PNG',
    email:        'PDF',
    unknown:      'PDF',
  };

  // ─────────────────────────────────────────────────────────────────────────
  // SLIDE MARKER REGEX — allineato a slide-detection.js
  // ─────────────────────────────────────────────────────────────────────────
  const SLIDE_MARKER_RE = /(^|[\s_-])(slide|carousel-item|swiper-slide|reveal-section|presentation-page)([\s_-]|$)/i;

  function classOf(el) {
    if (!el || !el.className) return '';
    return (typeof el.className === 'string') ? el.className : (el.className.baseVal || '');
  }

  function hasSlideMarker(el) {
    if (!el) return false;
    if (SLIDE_MARKER_RE.test(classOf(el))) return true;
    if (el.dataset && (el.dataset.slide !== undefined || el.dataset.slideIndex !== undefined)) return true;
    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONTEXT BUILDER — robusto a doc senza layout (DOMParser client-side)
  // ─────────────────────────────────────────────────────────────────────────
  function safeGetComputedStyle(el) {
    try {
      const w = (typeof window !== 'undefined') ? window : null;
      if (!w || !w.getComputedStyle || !el.ownerDocument || el.ownerDocument !== w.document) return null;
      return w.getComputedStyle(el);
    } catch (_) { return null; }
  }

  function rectOf(el) {
    try { return el.getBoundingClientRect(); } catch (_) { return { x: 0, y: 0, left: 0, top: 0, width: 0, height: 0 }; }
  }

  function buildContext(doc, viewport) {
    const body = doc.body;
    const docElement = doc.documentElement;
    const ctx = {};

    // ── Marker counts ──
    let markerCount = 0;
    let dataSlideCount = 0;
    const candidateMarkers = doc.querySelectorAll('[class], [data-slide], [data-slide-index]');
    candidateMarkers.forEach(el => {
      if (SLIDE_MARKER_RE.test(classOf(el))) markerCount++;
      if (el.dataset && (el.dataset.slide !== undefined || el.dataset.slideIndex !== undefined)) dataSlideCount++;
    });
    ctx.markerCount = markerCount;
    ctx.dataSlideCount = dataSlideCount;

    // ── Presentation script (Reveal/Impress/Swiper/Deck.js/Spectacle) ──
    const scripts = doc.querySelectorAll('script[src]');
    let hasPresentationScript = false;
    scripts.forEach(s => {
      const src = s.getAttribute('src') || '';
      if (/reveal|impress|swiper|deck\.js|spectacle/i.test(src)) hasPresentationScript = true;
    });
    ctx.hasPresentationScript = hasPresentationScript;

    // ── Meta generator ──
    const metaGen = doc.querySelector('meta[name="generator"]');
    ctx.metaGenerator = metaGen ? (metaGen.getAttribute('content') || '') : '';

    // ── Body dimensions + aspect ──
    const bodyW = Math.max(body ? body.scrollWidth : 0, docElement ? docElement.scrollWidth : 0);
    const bodyH = Math.max(body ? body.scrollHeight : 0, docElement ? docElement.scrollHeight : 0);
    const vw = (viewport && viewport.w) || (typeof window !== 'undefined' ? window.innerWidth : 1440);
    const vh = (viewport && viewport.h) || (typeof window !== 'undefined' ? window.innerHeight : 900);
    ctx.bodyW = bodyW;
    ctx.bodyH = bodyH;
    ctx.vw = vw;
    ctx.vh = vh;
    ctx.bodyHeightRatio = vh > 0 ? bodyH / vh : 0;
    ctx.bodyAspect = bodyH > 0 ? bodyW / bodyH : 0;
    // A4 (210/297 ≈ 0.707), Letter (8.5/11 ≈ 0.773)
    ctx.bodyAspectRatioMatchesPaper = (
      Math.abs(ctx.bodyAspect - 0.707) < 0.05 ||
      Math.abs(ctx.bodyAspect - 0.773) < 0.05
    );

    // ── Sized children + similar size + aspect 16:9 (layout-dependent) ──
    let similarSizedViewportChildren = 0;
    let candidateAspect16x9 = false;
    if (body && vh > 0) {
      const minH = Math.max(500, vh * 0.6);
      const sizedKids = Array.from(body.children).filter(el => {
        const r = rectOf(el);
        return r.width > 200 && r.height > minH;
      });
      if (sizedKids.length >= 2) {
        const f = rectOf(sizedKids[0]);
        const allSimilar = sizedKids.every(el => {
          const r = rectOf(el);
          return Math.abs(r.width - f.width) / Math.max(f.width, 1) < 0.15 &&
                 Math.abs(r.height - f.height) / Math.max(f.height, 1) < 0.15;
        });
        if (allSimilar) {
          similarSizedViewportChildren = sizedKids.length;
          if (f.height > 0) {
            const aspect = f.width / f.height;
            candidateAspect16x9 = Math.abs(aspect - (16 / 9)) < 0.18;
          }
        }
      }
    }
    ctx.similarSizedViewportChildren = similarSizedViewportChildren;
    ctx.candidateAspect16x9 = candidateAspect16x9;

    // ── Absolute-positioned overlapping children (JS presentation pattern) ──
    let absoluteOverlappingChildren = 0;
    if (body) {
      // Limit to direct + grandchild nodes for perf
      const candidates = Array.from(body.children).flatMap(el => [el, ...Array.from(el.children || [])]);
      const absKids = candidates.filter(el => {
        const cs = safeGetComputedStyle(el);
        return cs && cs.position === 'absolute';
      });
      if (absKids.length >= 2) {
        const r0 = rectOf(absKids[0]);
        absoluteOverlappingChildren = absKids.filter(el => {
          const r = rectOf(el);
          return Math.abs(r.x - r0.x) < 10 && Math.abs(r.y - r0.y) < 10;
        }).length;
      }
    }
    ctx.absoluteOverlappingChildren = absoluteOverlappingChildren;

    // ── @page CSS rule (in stylesheets or inline <style>) ──
    let hasAtPage = false;
    try {
      const sheets = doc.styleSheets ? Array.from(doc.styleSheets) : [];
      for (const sheet of sheets) {
        try {
          const rules = sheet.cssRules || [];
          for (const rule of rules) {
            const ctorName = rule.constructor && rule.constructor.name;
            if (ctorName === 'CSSPageRule' || (rule.cssText && /^\s*@page\b/i.test(rule.cssText))) {
              hasAtPage = true;
              break;
            }
          }
        } catch (_) { /* CORS */ }
        if (hasAtPage) break;
      }
    } catch (_) {}
    if (!hasAtPage) {
      const styles = doc.querySelectorAll('style');
      for (const style of styles) {
        if (/@page\b/i.test(style.textContent || '')) { hasAtPage = true; break; }
      }
    }
    ctx.hasAtPage = hasAtPage;

    // ── Document structure ──
    ctx.h2h3Count = doc.querySelectorAll('h2, h3').length;
    ctx.hasArticle = doc.querySelectorAll('article').length > 0;
    ctx.hasHeaderTag = doc.querySelectorAll('body > header, body > * > header').length > 0;
    ctx.hasFooterTag = doc.querySelectorAll('body > footer, body > * > footer').length > 0;

    // ── page-break-after on block elements (sample first 100) ──
    let hasPageBreakAfter = false;
    const blocks = doc.querySelectorAll('div, section, article, p, h1, h2, h3');
    const sampleBlocks = Math.min(blocks.length, 100);
    for (let i = 0; i < sampleBlocks; i++) {
      const cs = safeGetComputedStyle(blocks[i]);
      if (cs && (cs.pageBreakAfter === 'always' || cs.breakAfter === 'page')) {
        hasPageBreakAfter = true;
        break;
      }
    }
    // Fallback: scan inline style attributes
    if (!hasPageBreakAfter) {
      for (let i = 0; i < sampleBlocks; i++) {
        const sa = blocks[i].getAttribute('style') || '';
        if (/page-break-after\s*:\s*always|break-after\s*:\s*page/i.test(sa)) {
          hasPageBreakAfter = true;
          break;
        }
      }
    }
    ctx.hasPageBreakAfter = hasPageBreakAfter;

    // ── Email signals ──
    const allTables = doc.querySelectorAll('table');
    let outerTableW = 0;
    let nestedTableCount = 0;
    if (allTables.length > 0) {
      const first = allTables[0];
      outerTableW = rectOf(first).width;
      // Layout-less fallback: width attribute or CSS width in style
      if (!outerTableW || outerTableW < 1) {
        const widthAttr = parseInt(first.getAttribute('width') || '0', 10);
        const widthFromStyle = (first.getAttribute('style') || '').match(/width\s*:\s*(\d+)/i);
        outerTableW = widthAttr || (widthFromStyle ? parseInt(widthFromStyle[1], 10) : 0);
      }
      nestedTableCount = first.querySelectorAll('table').length;
    }
    ctx.hasOuterTable = outerTableW > 500;
    ctx.nestedTableCount = nestedTableCount;

    // ── Inline style ratio ──
    const allEls = doc.querySelectorAll('body *');
    const sampleEls = Math.min(allEls.length, 200);
    let inlineStyleCount = 0;
    for (let i = 0; i < sampleEls; i++) {
      if (allEls[i].getAttribute('style')) inlineStyleCount++;
    }
    ctx.inlineStyleRatio = sampleEls > 0 ? inlineStyleCount / sampleEls : 0;

    // ── Image / SVG / Canvas counts ──
    ctx.imgCount = doc.querySelectorAll('img').length;
    ctx.svgCount = doc.querySelectorAll('svg').length;
    ctx.canvasCount = doc.querySelectorAll('canvas').length;

    // ── Grid/flex density ──
    let gridFlexDensity = 0;
    const containers = doc.querySelectorAll('div, section, main, article, nav, header, footer, aside');
    const sampleContainers = Math.min(containers.length, 100);
    if (sampleContainers > 0) {
      let count = 0;
      for (let i = 0; i < sampleContainers; i++) {
        const cs = safeGetComputedStyle(containers[i]);
        if (cs && (cs.display === 'grid' || cs.display === 'flex')) count++;
      }
      gridFlexDensity = count / sampleContainers;
    }
    ctx.gridFlexDensity = gridFlexDensity;

    return ctx;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SLIDE EXTRACTION — riproduce le 4 strategie di slide-detection.js.
  // MUTA il DOM (transform, overflow, visibility); usare solo server-side.
  // ─────────────────────────────────────────────────────────────────────────
  function extractSlideElements(doc, minSlides) {
    minSlides = minSlides || 3;

    // Reset transform (carousel) e overflow:hidden (slider container)
    doc.querySelectorAll('*').forEach(el => {
      const cs = safeGetComputedStyle(el);
      if (!cs) return;
      if (cs.transform && cs.transform !== 'none' && el.children.length > 2) {
        el.style.transform = 'none';
      }
      if (cs.overflow === 'hidden' && (el === doc.body || el.children.length > 2)) {
        el.style.overflow = 'visible';
      }
    });

    function getSized(parent) {
      const vh = (typeof window !== 'undefined' ? window.innerHeight : 900) || 900;
      const minH = Math.max(500, vh * 0.6);
      return Array.from(parent.children).filter(el => {
        const r = rectOf(el);
        return r.width > 200 && r.height > minH;
      });
    }
    function similar(els) {
      if (els.length < 2) return false;
      const f = rectOf(els[0]);
      return els.every(el => {
        const r = rectOf(el);
        return Math.abs(r.width - f.width) / Math.max(f.width, 1) < 0.15 &&
               Math.abs(r.height - f.height) / Math.max(f.height, 1) < 0.15;
      });
    }
    function getMarked(parent) {
      return Array.from(parent.children).filter(el => {
        const r = rectOf(el);
        return hasSlideMarker(el) && r.width > 100 && r.height > 100;
      });
    }
    function depth(el) {
      let d = 0, cur = el;
      while (cur && cur !== doc.body) { d++; cur = cur.parentElement; }
      return d;
    }

    // ── Strategy 0: explicit markers ──
    const allMarked = doc.querySelectorAll(
      '[class*="slide"], [class*="carousel-item"], [class*="swiper-slide"], [data-slide], [data-slide-index]'
    );
    if (allMarked.length >= 2) {
      const byParent = new Map();
      allMarked.forEach(el => {
        if (!hasSlideMarker(el)) return;
        const p = el.parentElement;
        if (!p) return;
        const arr = byParent.get(p) || [];
        arr.push(el);
        byParent.set(p, arr);
      });
      let bestParent = null, bestCount = 0;
      byParent.forEach((arr, p) => {
        if (arr.length > bestCount) { bestCount = arr.length; bestParent = p; }
      });
      if (bestParent && bestCount >= 2) {
        // Force visibility (override CSS like .slide:not(.active) { visibility:hidden!important })
        const bestKids = byParent.get(bestParent) || [];
        bestKids.forEach(el => {
          const cs = safeGetComputedStyle(el);
          if (cs && cs.display === 'none') el.style.setProperty('display', 'block', 'important');
          el.style.setProperty('visibility', 'visible', 'important');
          el.style.setProperty('opacity', '1', 'important');
        });
        const markedKids = getMarked(bestParent);
        if (markedKids.length >= 2 && similar(markedKids)) {
          const r = rectOf(markedKids[0]);
          return { elements: markedKids, w: Math.ceil(r.width), h: Math.ceil(r.height), wrapper: bestParent };
        }
      }
    }

    // ── Strategy 1: direct body children sized like viewport ──
    const bodyKids = getSized(doc.body);
    if (bodyKids.length >= minSlides && similar(bodyKids)) {
      const r = rectOf(bodyKids[0]);
      return { elements: bodyKids, w: Math.ceil(r.width), h: Math.ceil(r.height), wrapper: doc.body };
    }

    // ── Strategy 2: wrapper child ──
    for (const child of Array.from(doc.body.children)) {
      const wKids = getSized(child);
      if (wKids.length >= minSlides && similar(wKids)) {
        const r = rectOf(wKids[0]);
        return { elements: wKids, w: Math.ceil(r.width), h: Math.ceil(r.height), wrapper: child };
      }
    }

    // ── Strategy 3: deep search depth ≤ 3 ──
    const containers = doc.querySelectorAll('div, section, main, article');
    for (const c of containers) {
      if (depth(c) > 3) continue;
      const k = getSized(c);
      if (k.length >= minSlides && similar(k)) {
        const r = rectOf(k[0]);
        return { elements: k, w: Math.ceil(r.width), h: Math.ceil(r.height), wrapper: c };
      }
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN: detectContent
  // ─────────────────────────────────────────────────────────────────────────
  function detectContent(opts) {
    opts = opts || {};
    const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
    if (!doc || !doc.body) {
      return { mode: 'unknown', confidence: 0, recommendedFormat: 'PDF', fallbackMode: 'screenshot' };
    }
    const minSlides = opts.minSlides || 2;
    const debug = !!opts.debug;
    const viewport = opts.viewport || {};

    const ctx = buildContext(doc, viewport);

    const scores = { presentation: 0, document: 0, infographic: 0, dashboard: 0, email: 0 };
    const fired = [];
    SIGNALS.forEach(sig => {
      let triggered = false;
      try { triggered = !!sig.fn(ctx); } catch (_) { triggered = false; }
      if (triggered) {
        scores[sig.mode] = (scores[sig.mode] || 0) + sig.weight;
        if (debug) fired.push({ name: sig.name, mode: sig.mode, weight: sig.weight });
      }
    });

    // Pick winner with confidence + margin gating
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [winnerMode, winnerScore] = sorted[0];
    const secondScore = (sorted[1] && sorted[1][1]) || 0;
    const maxPossible = MAX_WEIGHTS[winnerMode] || 1;
    const confidence = Math.max(0, Math.min(1, winnerScore / maxPossible));
    const margin = winnerScore > 0 ? (winnerScore - secondScore) / winnerScore : 0;

    let mode = winnerMode;
    if (winnerScore <= 0 || confidence < 0.30 || margin < 0.15) {
      mode = 'unknown';
    }

    // For presentation, also extract slide elements; if extraction fails, downgrade.
    let slideData = null;
    if (mode === 'presentation' && opts.extractSlides !== false) {
      slideData = extractSlideElements(doc, minSlides);
      if (!slideData) mode = 'unknown';
    }

    const result = {
      mode,
      confidence: Math.round(confidence * 100) / 100,
      recommendedFormat: FORMAT_BY_MODE[mode] || 'PDF',
      pageDimensions: {
        w: ctx.bodyW,
        h: ctx.bodyH,
        aspect: ctx.bodyAspect,
        isA4: Math.abs(ctx.bodyAspect - 0.707) < 0.05,
        isLetter: Math.abs(ctx.bodyAspect - 0.773) < 0.05,
      },
      fallbackMode: 'screenshot',
    };

    if (slideData) {
      const rects = slideData.elements.map(el => {
        const r = rectOf(el);
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
      });
      const overlapping = rects.length >= 2 &&
        Math.abs(rects[0].y - rects[1].y) < 10 &&
        Math.abs(rects[0].x - rects[1].x) < 10;
      result.slideW = slideData.w;
      result.slideH = slideData.h;
      result.rects = rects;
      result.overlapping = overlapping;
      // slideElements (DOM nodes) volutamente NON nel result: non serializzabili
      // attraverso page.evaluate. Server può ri-estrarre via extractSlideElements.
    }

    if (debug) {
      result.scores = scores;
      result.signals = fired;
      result.maxWeights = MAX_WEIGHTS;
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COMPAT SHIM: __detectSlides (mantiene API legacy per slide-detection.js)
  // ─────────────────────────────────────────────────────────────────────────
  function detectSlides(minSlides) {
    if (typeof document === 'undefined' || !document.body) return null;
    return extractSlideElements(document, minSlides || 3);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EXPORT (UMD-lite)
  // ─────────────────────────────────────────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { detectContent, detectSlides, SIGNALS, MAX_WEIGHTS, FORMAT_BY_MODE };
  } else {
    global.__detectContent = detectContent;
    global.__detectSlides = detectSlides;
    global.__contentDetectorSignals = SIGNALS;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

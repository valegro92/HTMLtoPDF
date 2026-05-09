'use strict';

/**
 * Codice JS iniettato nella pagina Puppeteer per rilevare le slide.
 *
 * Definisce la funzione globale `detectSlides()` che:
 *  1. Resetta transform e overflow:hidden su slider/carousel containers
 *  2. Cerca slide candidates con 3 strategie (E-Lab, inRebus, deep-search)
 *  3. Ritorna `{ slideElements, slideW, slideH }` oppure `null` se non trovate
 *
 * Usata da entrambi gli endpoint /convert (PDF) e /convert-pptx (PowerPoint).
 */
const SLIDE_DETECTION_JS = `
(function () {
  // Marker espliciti: classi/attributi che indicano slide vere
  var SLIDE_MARKER_REGEX = /(^|[\\s_-])(slide|carousel-item|swiper-slide|reveal-section|presentation-page)([\\s_-]|$)/i;

  function hasSlideMarker(el) {
    if (!el || !el.getAttribute) return false;
    var cls = el.className && typeof el.className === 'string' ? el.className : '';
    if (SLIDE_MARKER_REGEX.test(cls)) return true;
    if (el.dataset && (el.dataset.slide !== undefined || el.dataset.slideIndex !== undefined)) return true;
    if (el.getAttribute('role') === 'presentation' && el.children && el.children.length > 0) return false;
    return false;
  }

  function getSizedChildren(parent) {
    var vh = window.innerHeight || 900;
    return Array.from(parent.children).filter(function (el) {
      var r = el.getBoundingClientRect();
      // Altezza minima: 60% del viewport o 500px (slide vere ≈ viewport)
      var minH = Math.max(500, vh * 0.6);
      return r.width > 200 && r.height > minH;
    });
  }

  function getMarkedChildren(parent) {
    return Array.from(parent.children).filter(function (el) {
      var r = el.getBoundingClientRect();
      return hasSlideMarker(el) && r.width > 100 && r.height > 100;
    });
  }

  function areSimilarSize(elements) {
    if (elements.length < 2) return false;
    var first = elements[0].getBoundingClientRect();
    return elements.every(function (el) {
      var r = el.getBoundingClientRect();
      return Math.abs(r.width - first.width) / first.width < 0.15
          && Math.abs(r.height - first.height) / first.height < 0.15;
    });
  }

  function depthFromBody(el) {
    var d = 0, cur = el;
    while (cur && cur !== document.body) { d++; cur = cur.parentElement; }
    return d;
  }

  // minSlides: soglia minima per riconoscere un insieme come "slide deck"
  // PDF usa 3 (evita falsi positivi su landing page con sezioni simili)
  // PPTX/PNG usano 2 (un deck da 2 slide è valido per export nativo)
  function detectSlides(minSlides) {
    minSlides = minSlides || 3;
    // Reset transform e overflow:hidden per slider orizzontali (inRebus style)
    document.querySelectorAll('*').forEach(function (el) {
      var s = getComputedStyle(el);
      if (s.transform && s.transform !== 'none' && el.children.length > 2) {
        el.style.transform = 'none';
      }
      if (s.overflow === 'hidden' && (el === document.body || el.children.length > 2)) {
        el.style.overflow = 'visible';
      }
    });

    var slideElements = null;
    var slideW = 0, slideH = 0;
    var wrapperEl = null;

    // ── Strategy 0 (priority): Marker espliciti (.slide, .carousel-item, .swiper-slide, ecc.) ──
    var markedAnywhere = document.querySelectorAll(
      '[class*="slide"], [class*="carousel-item"], [class*="swiper-slide"], [data-slide], [data-slide-index]'
    );
    if (markedAnywhere.length >= 2) {
      // Trova il parent comune che contiene il maggior numero di marked children
      var byParent = new Map();
      markedAnywhere.forEach(function (el) {
        if (!hasSlideMarker(el)) return;
        var p = el.parentElement;
        if (!p) return;
        var arr = byParent.get(p) || [];
        arr.push(el);
        byParent.set(p, arr);
      });
      var bestParent = null, bestCount = 0;
      byParent.forEach(function (arr, p) {
        if (arr.length > bestCount) { bestCount = arr.length; bestParent = p; }
      });
      if (bestParent && bestCount >= 2) {
        // Force visibility on all marked children: overrides CSS rules like
        // .slide:not(.active) { visibility:hidden !important; opacity:0 !important }
        // so getBoundingClientRect returns the layout rect for hidden slides.
        var bestKids = byParent.get(bestParent) || [];
        bestKids.forEach(function (el) {
          var s = getComputedStyle(el);
          if (s.display === 'none') el.style.setProperty('display', 'block', 'important');
          el.style.setProperty('visibility', 'visible', 'important');
          el.style.setProperty('opacity', '1', 'important');
        });
        var markedKids = getMarkedChildren(bestParent);
        if (markedKids.length >= 2 && areSimilarSize(markedKids)) {
          slideElements = markedKids;
          wrapperEl = bestParent;
          var rm = markedKids[0].getBoundingClientRect();
          slideW = rm.width; slideH = rm.height;
        }
      }
    }

    // ── Strategy 1: Figli diretti del body, ≥minSlides e dimensioni viewport ──
    if (!slideElements) {
      var bodyChildren = getSizedChildren(document.body);
      if (bodyChildren.length >= minSlides && areSimilarSize(bodyChildren)) {
        slideElements = bodyChildren;
        wrapperEl = document.body;
        var r1 = bodyChildren[0].getBoundingClientRect();
        slideW = r1.width; slideH = r1.height;
      }
    }

    // ── Strategy 2: Figli di un wrapper (slider/carousel) ──
    if (!slideElements) {
      var bodyChildrenAll = Array.from(document.body.children);
      for (var i = 0; i < bodyChildrenAll.length; i++) {
        var wrapperChildren = getSizedChildren(bodyChildrenAll[i]);
        if (wrapperChildren.length >= minSlides && areSimilarSize(wrapperChildren)) {
          slideElements = wrapperChildren;
          wrapperEl = bodyChildrenAll[i];
          var r2 = wrapperChildren[0].getBoundingClientRect();
          slideW = r2.width; slideH = r2.height;
          break;
        }
      }
    }

    // ── Strategy 3: Deep search ≥minSlides figli simili viewport-size, max profondità 3 ──
    if (!slideElements) {
      var allContainers = document.querySelectorAll('div, section, main, article');
      for (var j = 0; j < allContainers.length; j++) {
        var container = allContainers[j];
        if (depthFromBody(container) > 3) continue;
        var children = getSizedChildren(container);
        if (children.length >= minSlides && areSimilarSize(children)) {
          slideElements = children;
          wrapperEl = container;
          var r3 = children[0].getBoundingClientRect();
          slideW = r3.width; slideH = r3.height;
          break;
        }
      }
    }

    if (!slideElements) return null;
    return { slideElements: slideElements, slideW: slideW, slideH: slideH, wrapperEl: wrapperEl };
  }

  window.__detectSlides = detectSlides; // callable as __detectSlides(minSlides)
  window.__getSizedChildren = getSizedChildren;
  window.__areSimilarSize = areSimilarSize;
  window.__depthFromBody = depthFromBody;
})();
`;

module.exports = { SLIDE_DETECTION_JS };

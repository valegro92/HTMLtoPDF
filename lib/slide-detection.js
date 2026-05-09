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
  function getSizedChildren(parent) {
    return Array.from(parent.children).filter(function (el) {
      var r = el.getBoundingClientRect();
      // Altezza minima 300px: esclude celle di grid/layout (col-card, ecc.)
      return r.width > 200 && r.height > 300;
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

  function detectSlides() {
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

    // Strategy 1: Figli diretti del body con dimensioni simili (E-Lab style)
    var bodyChildren = getSizedChildren(document.body);
    if (bodyChildren.length >= 2 && areSimilarSize(bodyChildren)) {
      slideElements = bodyChildren;
      wrapperEl = document.body;
      var r1 = bodyChildren[0].getBoundingClientRect();
      slideW = r1.width; slideH = r1.height;
    }

    // Strategy 2: Figli di un wrapper (slider/carousel — inRebus style)
    if (!slideElements) {
      for (var i = 0; i < bodyChildren.length; i++) {
        var wrapperChildren = getSizedChildren(bodyChildren[i]);
        if (wrapperChildren.length >= 2 && areSimilarSize(wrapperChildren)) {
          slideElements = wrapperChildren;
          wrapperEl = bodyChildren[i];
          var r2 = wrapperChildren[0].getBoundingClientRect();
          slideW = r2.width; slideH = r2.height;
          break;
        }
      }
    }

    // Strategy 3: Cerca contenitori con 2+ figli simili — max profondità 3
    // (profondità > 3 = elementi interni di layout, non slide vere)
    if (!slideElements) {
      var allContainers = document.querySelectorAll('div, section, main, article');
      for (var j = 0; j < allContainers.length; j++) {
        var container = allContainers[j];
        if (depthFromBody(container) > 3) continue;
        var children = getSizedChildren(container);
        if (children.length >= 2 && areSimilarSize(children)) {
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

  window.__detectSlides = detectSlides;
  window.__getSizedChildren = getSizedChildren;
  window.__areSimilarSize = areSimilarSize;
  window.__depthFromBody = depthFromBody;
})();
`;

module.exports = { SLIDE_DETECTION_JS };

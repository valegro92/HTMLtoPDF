'use strict';

/**
 * Compat shim: la logica di detection è ora in /public/content-detector.js
 * (modulo isomorfo riusato anche dal client app.html via <script>).
 * Qui leggiamo il file da disco una volta e lo esponiamo come stringa
 * per `page.addScriptTag({ content })`.
 *
 * Espone window.__detectSlides (back-compat) e window.__detectContent (nuovo).
 */
const fs = require('fs');
const path = require('path');

const DETECTOR_PATH = path.join(__dirname, '..', 'public', 'content-detector.js');
const CONTENT_DETECTOR_JS = fs.readFileSync(DETECTOR_PATH, 'utf8');

module.exports = {
  // Alias mantenuto per back-compat (server.js continua a richiederlo come SLIDE_DETECTION_JS)
  SLIDE_DETECTION_JS: CONTENT_DETECTOR_JS,
  CONTENT_DETECTOR_JS,
  DETECTOR_PATH,
};

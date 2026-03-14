const { join } = require('path');

/**
 * Cache Chrome nella cartella del progetto,
 * così funziona sia in locale che su Render/cloud
 */
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};

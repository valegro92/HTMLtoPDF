# CLAUDE.md — HTML to PDF Converter

## Panoramica
Strumento gratuito de **La Cassetta degli AI-trezzi** che converte codice HTML (tipicamente generato da AI) in PDF pixel-perfect con anteprima live.

Live: deploy su Render.com (free tier).

## Struttura
```
HTMLtoPDF/
├── server.js          # Express + Puppeteer — endpoint /convert e /convert-pptx, browser singleton
├── package.json       # express + puppeteer + pptxgenjs + archiver, node >=18
├── render.yaml        # Deploy config Render.com
├── lib/
│   ├── browser.js        # (futuro) browser singleton estratto da server.js
│   └── slide-detection.js # (futuro) logica di rilevamento slide estratta da server.js
├── public/
│   ├── landing.html   # Landing page promozionale → route /
│   ├── app.html       # App editor + anteprima + genera PDF/PPTX → route /app
│   └── logo.jpg       # Logo La Cassetta degli AI-trezzi
└── README.md
```

## Architettura server (server.js)

- **Express** con body parser limit 4MB
- **Puppeteer** browser singleton con promise lock (lazy init, auto-reconnect su disconnect) — logica destinata a essere estratta in `lib/browser.js`
- **Anti-SSRF**: regex blocca localhost, reti private (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x)
- **Tipi risorsa permessi**: document, stylesheet, font, image (tutto il resto abortito); per `/convert-pptx` è permesso anche `script` (per Chart.js e contenuti dinamici)
- **Concorrenza**: max 2 conversioni simultanee, ritorna 429 se pieno
- **Graceful shutdown** su SIGINT/SIGTERM

### Endpoint POST /convert
Body JSON: `{ html, format, fitToPage, singlePage }`

**Formati supportati:**
| Formato | Comportamento |
|---------|--------------|
| Auto | Misura contenuto, PDF si adatta (ideale per infografiche) |
| A4 | 794x1123 px (96 DPI) |
| Letter | 816x1056 px |
| A3 | 1123x1587 px |

**fitToPage**: se true + formato fisso, scala il contenuto per entrare nella pagina.

**singlePage**: se true con formato Auto, disabilita la slide detection e tratta sempre il contenuto come pagina singola.

**Flusso Auto (con slide detection)**: rileva elementi slide candidati con 3 strategie (figli diretti del body, figli di wrapper/carousel, ricerca in profondità ≤3) — logica destinata a essere estratta in `lib/slide-detection.js`. Se trovate ≥2 slide simili: applica `pageBreakAfter` e genera un PDF multi-pagina. Altrimenti (pagina singola): trova container principale → reset margin/padding → misura → imposta viewport → ri-misura scrollWidth/Height → genera PDF con quelle dimensioni.

### Endpoint POST /convert-pptx
Body JSON: `{ html }`

Converte HTML in un file PowerPoint (.pptx) tramite `pptxgenjs`. Supporta due modalità:

**Modalità slide native** (se rilevate ≥2 slide con dimensioni simili):
- Estrae testo ricco (con bold, italic, colore, dimensione font), forme con sfondo colorato e bordi sinistri decorativi
- Icone FontAwesome mappate in emoji Unicode
- Ogni slide HTML diventa una slide PPTX editabile in PowerPoint
- Dimensioni layout adattate alla dimensione in pixel delle slide originali (px → pollici a 96 DPI)

**Modalità screenshot** (fallback — dashboard, pagine lunghe, documenti):
- Renderizza la pagina completa e la spezza in chunk da 720px di altezza
- Massimo 50 chunk (equivalente a ~36.000px di altezza)
- Ogni chunk diventa una slide PPTX con immagine PNG embedded
- Larghezza cappata a 1400px

In entrambe le modalità il nome file viene derivato dal `<h1>` o `<title>` del documento.

### Endpoint POST /convert-png
Body JSON: `{ html }`

Converte HTML in immagine/i PNG tramite Puppeteer. Usa la stessa logica di slide detection degli altri endpoint:

**Se ≥2 slide rilevate**: ritorna un archivio ZIP (`application/zip`) contenente `slide-01.png`, `slide-02.png`, ecc. — uno screenshot per slide. Il file ZIP è generato con la libreria `archiver`.

**Se pagina singola**: ritorna direttamente un singolo file PNG (`image/png`) con lo screenshot dell'intera pagina.

Il nome del file scaricato viene derivato dal `<h1>` o `<title>` del documento.

### Altri endpoint
- `GET /` → landing.html
- `GET /app` → app.html
- `GET /health` → stato browser, conversioni attive

## Frontend — app.html
- **Single-file** vanilla HTML/CSS/JS, zero dipendenze frontend
- Layout: header (logo + controlli) + due pannelli affiancati (textarea HTML | iframe anteprima)
- Anteprima live con debounce 400ms
- Toggle "Adatta a pagina" (nascosto quando formato = Auto)
- Spinner loading + toast errori
- Download automatico del PDF via blob URL
- Bottone `📊 PPTX` che chiama `/convert-pptx` e scarica il file .pptx risultante

## Landing page — landing.html
- Pagina marketing: hero, blocco problema, 3 step come funziona, 4 formati, CTA finale
- Colore accent: `#2bb5a3` (teal), background: `#3a3a3a`, cards: `#2e2e2e`
- Responsive: grid 3 col → 1 col sotto 700px
- Link a Substack: lacassettadegliaitrezzi.substack.com

## Design system
- Font: system stack (-apple-system, BlinkMacSystemFont, Segoe UI, Roboto)
- Accent: `#2bb5a3`, hover: `#1f9e8f`
- Background: `#3a3a3a`, surface: `#2e2e2e`, border: `#1f5c5c`
- Testo: `#e0e0e0`, muted: `#aaa` / `#888` / `#666`
- Border radius: 6-12px
- Mono (editor): SF Mono, Fira Code, Consolas

## Comandi
```bash
npm install        # Installa dipendenze + Chrome (postinstall)
npm start          # Avvia server su porta 3000 (o $PORT)
```

## Deploy (Fly.io)
- `fly.toml`: shared-cpu-1x, 1 GB RAM, regione `fra` (Frankfurt), always-on (`min_machines_running = 1`)
- `Dockerfile`: base `node:20-slim` + Chromium di sistema; `npm ci --ignore-scripts` salta il postinstall Chrome
- Env var `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` settata nel Dockerfile
- Primo deploy: `fly apps create <nome>` → aggiorna `app` in `fly.toml` → `fly deploy`
- **Vantaggio vs Render free**: nessun cold start, la macchina resta sempre attiva

### Comandi Fly.io utili
```bash
fly logs          # log in tempo reale
fly status        # stato macchine
fly ssh console   # shell nella VM
```

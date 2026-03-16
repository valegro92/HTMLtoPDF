# CLAUDE.md — HTML to PDF Converter

## Panoramica
Strumento gratuito de **La Cassetta degli AI-trezzi** che converte codice HTML (tipicamente generato da AI) in PDF pixel-perfect con anteprima live.

Live: deploy su Render.com (free tier).

## Struttura
```
HTMLtoPDF/
├── server.js          # Express + Puppeteer — endpoint /convert, browser singleton
├── package.json       # express + puppeteer, node >=18
├── render.yaml        # Deploy config Render.com
├── public/
│   ├── landing.html   # Landing page promozionale → route /
│   ├── app.html       # App editor + anteprima + genera PDF → route /app
│   └── logo.jpg       # Logo La Cassetta degli AI-trezzi
└── README.md
```

## Architettura server (server.js)

- **Express** con body parser limit 4MB
- **Puppeteer** browser singleton con promise lock (lazy init, auto-reconnect su disconnect)
- **Anti-SSRF**: regex blocca localhost, reti private (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x)
- **Tipi risorsa permessi**: document, stylesheet, font, image (tutto il resto abortito)
- **Concorrenza**: max 2 conversioni simultanee, ritorna 429 se pieno
- **Graceful shutdown** su SIGINT/SIGTERM

### Endpoint POST /convert
Body JSON: `{ html, format, fitToPage }`

**Formati supportati:**
| Formato | Comportamento |
|---------|--------------|
| Auto | Misura contenuto, PDF si adatta (ideale per infografiche) |
| A4 | 794x1123 px (96 DPI) |
| Letter | 816x1056 px |
| A3 | 1123x1587 px |

**fitToPage**: se true + formato fisso, scala il contenuto per entrare nella pagina.

**Flusso Auto**: trova container principale → reset margin/padding → misura → imposta viewport → ri-misura scrollWidth/Height → genera PDF con quelle dimensioni.

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

## Deploy (Render.com)
- render.yaml: web service, node runtime, free plan
- Build: `npm install` (postinstall scarica Chrome)
- Start: `npm start`
- Env var `RENDER` settata automaticamente da Render

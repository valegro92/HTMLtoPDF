# HTML → PDF Converter

Convertitore HTML-to-PDF pixel-perfect con anteprima live. Uno strumento de **[La Cassetta degli AI-trezzi](https://lacassettadegliaitrezzi.substack.com/)**.

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![Puppeteer](https://img.shields.io/badge/Puppeteer-23+-40B5A4?logo=puppeteer&logoColor=white)
![Deploy](https://img.shields.io/badge/Deploy-Render-46E3B7?logo=render&logoColor=white)

## Cosa fa

Incolla HTML grezzo → vedi l'anteprima in tempo reale → scarica un PDF perfetto.

**Formati supportati:**
- **Auto** — il PDF si adatta esattamente al contenuto (ideale per infografiche, poster, banner)
- **A4 / Letter / A3** — formati pagina standard
- **Adatta a pagina** — scala il contenuto per farlo entrare nel formato scelto

## Avvio locale

```bash
git clone https://github.com/valegro92/HTMLtoPDF.git
cd HTMLtoPDF
npm install
npm start
```

Apri [http://localhost:3000](http://localhost:3000).

## Deploy su Render (gratis)

L'app è pronta per il deploy su [Render.com](https://render.com) con il piano gratuito:

1. Fai fork o collega questo repo al tuo account Render
2. Clicca **"New Web Service"** → seleziona il repo
3. Render auto-detecta Node.js e usa il `render.yaml` incluso
4. Clicca **"Deploy"** → online in ~3 minuti

> L'app si addormenta dopo 15 minuti di inattivita e impiega ~30s per risvegliarsi alla prima richiesta.

## Come funziona

```
Browser (HTML input)
    │
    ├── Anteprima live (iframe, aggiornata in tempo reale)
    │
    └── POST /convert ──► Express server
                              │
                              ├── Puppeteer carica l'HTML in Chromium headless
                              ├── Genera PDF con le opzioni scelte
                              └── Ritorna il file PDF
```

## Stack

| Componente | Tecnologia |
|---|---|
| Frontend | HTML/CSS/JS vanilla (file singolo) |
| Backend | Express.js |
| PDF Engine | Puppeteer (Chromium headless) |
| Hosting | Render.com (free tier) |

## Licenza

MIT

---

Fatto con ♻️ da [La Cassetta degli AI-trezzi](https://lacassettadegliaitrezzi.substack.com/)

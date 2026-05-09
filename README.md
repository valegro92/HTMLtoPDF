# HTML → PDF Converter

Trasforma qualsiasi codice HTML in PDF, PPTX o PNG impaginati correttamente, con anteprima live in tempo reale.

Uno strumento gratuito de **[La Cassetta degli AI-trezzi](https://lacassettadegliaitrezzi.substack.com/)** — la newsletter sull'adozione AI nelle PMI italiane.

## Come funziona

1. Incolla (o trascina) il tuo HTML nel pannello sinistro
2. L'anteprima si aggiorna istantaneamente nel pannello destro
3. Scegli il formato e clicca su uno dei bottoni **PDF / PPTX / PNG**

## Formati disponibili

| Formato | Ideale per |
|---|---|
| **PDF Auto** | Infografiche, poster, banner — il PDF si adatta al contenuto |
| **PDF A4 / Letter / A3** | Documenti, report, lettere, stampa |
| **PPTX** | Presentazioni native editabili (con rilevamento slide automatico) |
| **PNG** | Singola immagine o ZIP con una PNG per slide |

Scorciatoie:
- **⌘/Ctrl + Enter** → genera PDF
- **Drag & drop** di un file `.html` direttamente sull'editor

## Stack

- **Express.js** + **Puppeteer** (Chromium headless)
- **pptxgenjs** per export PowerPoint nativo
- **archiver** per ZIP di PNG
- Frontend vanilla HTML/CSS/JS — un singolo file, zero dipendenze frontend
- Deploy automatico su **Fly.io** via GitHub Actions

---

Fatto con ♻️ da [La Cassetta degli AI-trezzi](https://lacassettadegliaitrezzi.substack.com/)

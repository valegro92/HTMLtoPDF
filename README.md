# HTML → PDF Converter

Converte HTML grezzo in PDF pixel-perfect usando Puppeteer.

## Avvio

```bash
npm install && npm start
```

Apri [http://localhost:3000](http://localhost:3000).

## Come funziona

1. Incolla il tuo HTML nel pannello sinistro
2. L'anteprima si aggiorna in tempo reale nel pannello destro
3. Scegli il formato pagina (A4 / Letter / A3)
4. Clicca **Genera PDF** per scaricare il risultato

## Stack

- **Frontend**: HTML/CSS/JS vanilla (file singolo)
- **Backend**: Express + Puppeteer
- Tutto gira in locale, nessun servizio esterno
